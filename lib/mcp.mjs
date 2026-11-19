// Talking to MCP servers with the official SDK (@modelcontextprotocol/sdk).
// Env values are only used to start the server; they are never returned to the page.

import net from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { tokens } from './tokens.mjs'
import { safeView } from './clients.mjs'

export function withTimeout(promise, ms, what) {
  let t
  return Promise.race([promise, new Promise((_, rej) => (t = setTimeout(() => rej(new Error(`${what}: no answer in ${ms / 1000} s`)), ms)))]).finally(() => clearTimeout(t))
}

export function portOpen(port, host = '127.0.0.1', ms = 700) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host })
    const end = (ok) => {
      s.destroy()
      resolve(ok)
    }
    s.setTimeout(ms, () => end(false))
    s.once('connect', () => end(true))
    s.once('error', () => end(false))
  })
}

// Package runners (npx, uvx…) that start at the same time can install into the same cache at once and
// break each other (seen on Windows). Their starts are queued; once connected they run in parallel.
const RUNNER = /^(npx|npm|pnpm|yarn|bunx|uvx|cmd)$/i
let queue = Promise.resolve()

export function connect(name, s, opts = {}) {
  if (s.type !== 'stdio' || !RUNNER.test(String(s.command ?? ''))) return connectNow(name, s, opts)
  const turn = queue.then(() => connectNow(name, s, opts))
  queue = turn.catch(() => {})
  return turn
}

async function connectNow(name, s, { ms = 60000 } = {}) {
  const client = new Client({ name: 'code-mode-mcp', version: '1.0.0' })
  let transport
  if (s.type === 'http') transport = new StreamableHTTPClientTransport(new URL(s.url), { requestInit: { headers: s.headers ?? {} } })
  else if (s.type === 'sse') transport = new SSEClientTransport(new URL(s.url), { requestInit: { headers: s.headers ?? {} } })
  else {
    // On Windows, npx/uvx/etc. are .cmd files: they have to go through cmd /c
    let { command, args = [] } = s
    if (process.platform === 'win32' && /^(npx|npm|pnpm|yarn|bunx|uvx)$/i.test(command)) {
      args = ['/c', command, ...args]
      command = 'cmd'
    }
    transport = new StdioClientTransport({ command, args, env: { ...process.env, ...(s.env ?? {}) }, cwd: s.cwd, stderr: 'pipe' })
  }
  await withTimeout(client.connect(transport), ms, `Connect to ${name}`)
  return client
}

// Approximate cost of a tool in the model's context: name + description + schema
export const toolCost = (t) => tokens(JSON.stringify({ name: t.name, description: t.description ?? '', input_schema: t.inputSchema ?? {} }))

// Connect, list tools, close. Never throws: returns the state.
export async function inspect(name, s, { livePort } = {}) {
  const start = Date.now()
  const base = safeView(name, s)
  const live = livePort ? await portOpen(livePort) : null
  let client
  try {
    client = await connect(name, s)
    const info = client.getServerVersion()
    const instructions = client.getInstructions() ?? ''
    const { tools } = await withTimeout(client.listTools(), 30000, `List tools of ${name}`)
    const list = tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      params: Object.entries(t.inputSchema?.properties ?? {}).map(([p, sch]) => ({
        name: p,
        type: sch.type ?? (sch.anyOf ? sch.anyOf.map((x) => x.type).join(' | ') : '—'),
        required: (t.inputSchema?.required ?? []).includes(p),
        description: sch.description ?? '',
      })),
      tokens: toolCost(t),
    }))
    return {
      ...base,
      state: 'connected',
      live,
      server: info ? `${info.name} ${info.version}` : null,
      instructionsTokens: tokens(instructions),
      tools: list,
      schemas: tools.map((t) => ({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? {} })),
      tokensTotal: list.reduce((a, t) => a + t.tokens, 0) + tokens(instructions),
      tokensNamesOnly: tokens(list.map((t) => `mcp__${name}__${t.name}`).join('\n')),
      ms: Date.now() - start,
    }
  } catch (e) {
    return { ...base, state: 'unavailable', live, reason: String(e?.message ?? e).slice(0, 300), tools: [], tokensTotal: 0, tokensNamesOnly: 0, ms: Date.now() - start }
  } finally {
    await client?.close().catch(() => {})
  }
}

// Text of a tool result, as it would reach the model
export function resultText(r) {
  return (r?.content ?? [])
    .map((c) => (c.type === 'text' ? c.text : c.type === 'resource' ? (c.resource?.text ?? `[resource ${c.resource?.uri ?? ''}]`) : `[${c.type}${c.data ? `, ${Math.round(c.data.length * 0.75 / 1024)} KB` : ''}]`))
    .join('\n')
}
