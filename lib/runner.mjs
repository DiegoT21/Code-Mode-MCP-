// The engine behind run_code: keeps connections to the MCP servers in the panel, a searchable catalog of
// their tools, and runs JavaScript that calls them. Only what the code returns goes back to the AI.
//
// Note: the code runs in a separate V8 context without require/process/fs, but this is NOT a security
// sandbox. It runs with the same rights as the AI's own shell tools, on the user's own computer.

import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { PATHS, loadServers, readJson, writeJson, appendLog, loadSettings } from './config.mjs'
import { connect, toolCost, resultText, withTimeout } from './mcp.mjs'
import { tokens } from './tokens.mjs'

const CATALOG = path.join(PATHS.cache, 'catalog.json')
const CATALOG_MAX_AGE = 24 * 3600 * 1000
export const MAX_RESULT_CHARS = 20000

export class Runner {
  constructor() {
    this.clients = new Map()
    this.catalog = readJson(CATALOG, {}) // server → { at, tools: [{ name, description, inputSchema }] }
  }

  servers() {
    return loadServers()
  }

  async client(name) {
    const servers = this.servers()
    if (!servers[name]) throw new Error(`No MCP server named "${name}". Known: ${Object.keys(servers).join(', ') || 'none'}`)
    // The promise is stored, so concurrent calls share one connection
    if (!this.clients.has(name)) {
      const p = connect(name, servers[name]).then((c) => {
        c.onclose = () => this.clients.delete(name)
        return c
      })
      p.catch(() => this.clients.delete(name))
      this.clients.set(name, p)
    }
    return this.clients.get(name)
  }

  async tools(name, { fresh = false } = {}) {
    const hit = this.catalog[name]
    if (!fresh && hit && Date.now() - hit.at < CATALOG_MAX_AGE) return hit.tools
    const c = await this.client(name)
    const { tools } = await withTimeout(c.listTools(), 30000, `List tools of ${name}`)
    this.catalog[name] = { at: Date.now(), tools: tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? {} })) }
    try {
      writeJson(CATALOG, this.catalog)
    } catch {}
    return this.catalog[name].tools
  }

  // Loads the catalog of every server in the background (the gateway calls it when it starts), so the
  // first search does not wait for slow servers (e.g. npx downloading a package the first time)
  warmUp() {
    for (const s of Object.keys(this.servers())) this.toolsShared(s).catch(() => {})
  }

  // One load per server at a time, shared by everyone who asks
  toolsShared(name) {
    this.loading ??= new Map()
    const hit = this.catalog[name]
    if (hit && Date.now() - hit.at < CATALOG_MAX_AGE) return Promise.resolve(hit.tools)
    if (!this.loading.has(name)) this.loading.set(name, this.tools(name).finally(() => this.loading.delete(name)))
    return this.loading.get(name)
  }

  // Search every server's tools by words in the name or description. Servers that are still starting
  // after `waitMs` are reported as "loading" instead of making the AI wait.
  async search(query = '', { limit = 15, waitMs = 20000 } = {}) {
    const names = Object.keys(this.servers())
    const lists = await Promise.all(
      names.map(async (s) => {
        try {
          return { server: s, tools: await withTimeout(this.toolsShared(s), waitMs, s) }
        } catch (e) {
          const msg = String(e?.message ?? e)
          if (/no answer in/.test(msg) && this.loading?.has(s)) return { server: s, loading: true, tools: [] }
          return { server: s, error: msg.slice(0, 200), tools: [] }
        }
      }),
    )
    const pending = lists.filter((l) => l.loading).map((l) => l.server)
    const note = pending.length ? { stillLoading: pending, note: 'These servers are still starting (first run downloads them). Search again in a moment.' } : {}
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    if (!words.length) {
      return { servers: lists.map((l) => ({ server: l.server, tools: l.tools.length, ...(l.loading && { loading: true }), ...(l.error && { error: l.error }) })), ...note }
    }
    const hits = []
    for (const l of lists) {
      for (const t of l.tools) {
        const hay = `${l.server} ${t.name} ${t.description}`.toLowerCase()
        const score = words.reduce((a, w) => a + (t.name.toLowerCase().includes(w) ? 3 : 0) + (hay.includes(w) ? 1 : 0), 0)
        if (score) hits.push({ score, server: l.server, tool: t.name, summary: summary(t.description) })
      }
    }
    hits.sort((a, b) => b.score - a.score)
    return { matches: hits.slice(0, limit).map(({ score, ...h }) => h), total: hits.length, ...note }
  }

  async describe(server, tool) {
    const t = (await this.toolsShared(server)).find((x) => x.name === tool)
    if (!t) throw new Error(`"${server}" has no tool "${tool}"`)
    return { server, tool: t.name, description: t.description, inputSchema: t.inputSchema }
  }

  async close() {
    for (const p of this.clients.values()) await Promise.resolve(p).then((c) => c.close()).catch(() => {})
    this.clients.clear()
  }

  // Runs the code. Returns { ok, result, images, logs, calls, comparison, ms }
  async run(code, { timeoutMs = 120000, source = 'run_code', title } = {}) {
    const start = Date.now()
    const logs = []
    const calls = []
    const used = new Set()
    const log = (...a) => logs.length < 100 && logs.push(a.map((x) => (typeof x === 'string' ? x : safeJson(x))).join(' ').slice(0, 1000))
    let browserSession = null

    const call = async (server, tool, args = {}, raw = false) => {
      const c = await this.client(server)
      const t0 = Date.now()
      const r = await c.callTool({ name: tool, arguments: args }, undefined, { timeout: Math.max(5000, timeoutMs - (Date.now() - start)) })
      const text = resultText(r)
      used.add(`${server}\u0000${tool}`)
      calls.push({ server, tool, ms: Date.now() - t0, error: !!r.isError, tokensArgs: tokens(args), tokensResult: tokens(text) + (r.content ?? []).filter((x) => x.type === 'image').length * 1500 })
      if (raw) return r
      if (r.isError) throw new Error(`${server}.${tool}: ${text.slice(0, 500)}`)
      const images = (r.content ?? []).filter((x) => x.type === 'image')
      if (images.length && !text.trim()) return images.length === 1 ? images[0] : images
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }

    const sandbox = {
      mcp: {
        call: (s, t, a) => call(s, t, a),
        callRaw: (s, t, a) => call(s, t, a, true),
        search: (q, o) => this.search(q, o),
        describe: (s, t) => this.describe(s, t),
        servers: () => Object.keys(this.servers()),
      },
      browser: {
        page: async (opts = {}) => {
          if (!browserSession) {
            const { open } = await import('./browser/browser.mjs')
            browserSession = await open({ screen: opts.screen ?? 'desktop', visible: !!opts.visible })
          }
          return browserSession.page
        },
        timings: async () => {
          const { timings } = await import('./browser/browser.mjs')
          return browserSession ? timings(browserSession.page) : null
        },
      },
      blender: {
        run: async (scene, python) => (await import('./blender.mjs')).runBlender(scene, python, loadSettings()),
      },
      log,
      console: { log, info: log, warn: log, error: log },
      setTimeout,
      clearTimeout,
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      structuredClone,
    }
    const context = vm.createContext(sandbox, { name: 'code-mode' })
    let out
    try {
      const promise = vm.runInContext(`(async () => {\n${code}\n})()`, context, { filename: 'run_code.js', timeout: 10000 })
      const value = await withTimeout(Promise.resolve(promise), timeoutMs, 'run_code')
      const { result, images } = splitImages(value)
      out = { ok: true, result, images }
    } catch (e) {
      out = { ok: false, error: String(e?.stack ?? e?.message ?? e).replace(/\n\s+at .*node:internal.*$/gm, '').slice(0, 3000) }
    } finally {
      if (browserSession) {
        if (browserSession.errors.length) log(`browser console errors: ${browserSession.errors.slice(0, 5).join(' | ')}`)
        await browserSession.browser.close().catch(() => {})
      }
    }
    out.logs = logs
    out.calls = calls
    out.ms = Date.now() - start
    out.comparison = await this.compare(code, out, used)
    appendLog(PATHS.history, {
      source,
      title: title ?? firstLine(code),
      ms: out.ms,
      ok: out.ok,
      result: out.ok ? clip(safeJson(out.result), 4000) : null,
      error: out.ok ? null : clip(out.error, 4000),
      calls,
      tokens: { classic: out.comparison.classic.total, code: out.comparison.code.total },
      code: clip(code, 20000),
    }, 300)
    return out
  }

  // Classic MCP: every server's definitions loaded + every call's arguments and full result in the chat.
  // Code mode: the gateway's 3 tools + the definitions actually looked at + the code + what it returns.
  async compare(code, out, used) {
    let defsAll = 0
    let defsUsed = 0
    for (const s of Object.keys(this.servers())) {
      const list = this.catalog[s]?.tools ?? []
      for (const t of list) {
        const c = toolCost(t)
        defsAll += c
        if (used.has(`${s}\u0000${t.name}`)) defsUsed += c
      }
    }
    const roundTrips = out.calls.reduce((a, c) => a + c.tokensArgs + c.tokensResult, 0)
    const back = out.ok ? tokens(safeJson(out.result)) + (out.images?.length ?? 0) * 1500 : tokens(out.error)
    return {
      classic: { total: defsAll + roundTrips, parts: { definitions: defsAll, calls: roundTrips } },
      code: { total: GATEWAY_TOOLS_TOKENS + defsUsed + tokens(code) + back, parts: { gateway: GATEWAY_TOOLS_TOKENS, definitions: defsUsed, code: tokens(code), result: back } },
    }
  }
}

// Size of the gateway's own 3 tool definitions (filled in by gateway.mjs)
export let GATEWAY_TOOLS_TOKENS = 0
export const setGatewayTokens = (n) => (GATEWAY_TOOLS_TOKENS = n)

function summary(d = '') {
  const first = d.split(/(?<=[.!?])\s|\n/)[0] ?? ''
  return first.length > 140 ? `${first.slice(0, 137)}…` : first
}
function firstLine(code) {
  const l = code.split('\n').map((x) => x.trim()).find((x) => x && !x.startsWith('//')) ?? ''
  return l.slice(0, 80)
}
function clip(s, n) {
  return s && s.length > n ? `${s.slice(0, n)}\n… (cut)` : s
}
export function safeJson(v) {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v, null, 2) ?? String(v)
  } catch {
    return String(v)
  }
}
// MCP image contents returned by the code travel as real images
function splitImages(v) {
  const isImg = (x) => x && typeof x === 'object' && x.type === 'image' && typeof x.data === 'string'
  if (isImg(v)) return { result: '[image]', images: [v] }
  if (Array.isArray(v) && v.length && v.every(isImg)) return { result: `[${v.length} images]`, images: v }
  return { result: v, images: [] }
}

