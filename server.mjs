// Code Mode MCP — the local panel. Listens only on 127.0.0.1.
// Started by `code-mode-mcp` (or `npm start`), or by the desktop app.

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { APP_DIR, PATHS, PORT, ensureHome, readJson, writeJson, loadServers, loadSettings, saveSettings } from './lib/config.mjs'
import { inspect } from './lib/mcp.mjs'
import { detect, CLIENTS, listSkills } from './lib/clients.mjs'
import { plan, apply, undo, status } from './lib/setup.mjs'
import { Runner, setGatewayTokens } from './lib/runner.mjs'
import { usage } from './lib/usage.mjs'
import { findBlender, listScenes } from './lib/blender.mjs'
import { tokens } from './lib/tokens.mjs'
import { TOOLS as GATEWAY_TOOLS } from './lib/gateway.mjs'
import { toolCost } from './lib/mcp.mjs'

const PUBLIC = path.join(APP_DIR, 'public')
const INVENTORY_CACHE = path.join(PATHS.cache, 'inventory.json')
const runner = new Runner()
setGatewayTokens(GATEWAY_TOOLS.reduce((a, x) => a + toolCost(x), 0))

// ── Inventory ─────────────────────────────────────────────────────────────────────────────────────
let inventory = null
let inventoryJob = null

async function buildInventory() {
  const servers = loadServers()
  const live = (n, s) => (/blender/i.test(n) && s.env?.BLENDER_PORT ? Number(s.env.BLENDER_PORT) : /blender/i.test(n) ? 9876 : undefined)
  const panel = await Promise.all(Object.entries(servers).map(([n, s]) => inspect(n, s, { livePort: live(n, s) })))
  // Feed the gateway's catalog so search_tools is instant
  const catalog = readJson(path.join(PATHS.cache, 'catalog.json'), {})
  for (const p of panel) {
    if (p.state === 'connected') catalog[p.name] = runner.catalog[p.name] = { at: Date.now(), tools: p.schemas }
    delete p.schemas
  }
  writeJson(path.join(PATHS.cache, 'catalog.json'), catalog)
  inventory = { date: new Date().toISOString(), panel }
  writeJson(INVENTORY_CACHE, inventory)
  return inventory
}

async function getInventory(refresh) {
  if (!inventory) inventory = readJson(INVENTORY_CACHE, null)
  const panelNames = Object.keys(loadServers()).sort().join()
  const stale = !inventory || inventory.panel.map((s) => s.name).sort().join() !== panelNames
  if (refresh || stale) {
    inventoryJob ??= buildInventory().finally(() => (inventoryJob = null))
    await inventoryJob
  }
  const settings = loadSettings()
  const blender = findBlender(settings)
  const cc = CLIENTS.find((c) => c.id === 'claude-code')
  return {
    ...inventory,
    clients: detect(),
    skills: listSkills(cc.skills).map((s) => ({ name: s.name, description: s.description, tokensAlways: tokens(`${s.name}: ${s.description}`), tokensWhenUsed: tokens(s.text) })),
    codeTools: {
      browser: { ok: fs.existsSync(path.join(APP_DIR, 'node_modules', 'playwright-core')) },
      blender: { ok: !!blender, path: blender, scenes: listScenes(settings) },
    },
    installs: readJson(PATHS.installs, []).slice(0, 100),
    setup: status(),
  }
}

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' }
const json = (res, code, data) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(data))
}
const body = (req) =>
  new Promise((resolve, reject) => {
    let b = ''
    req.on('data', (d) => {
      b += d
      if (b.length > 2e6) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {})
      } catch (e) {
        reject(e)
      }
    })
  })
// Only this page may change things (another website open in the browser cannot)
const ownRequest = (req) => req.headers['x-panel'] === '1' && (!req.headers.origin || [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`].includes(req.headers.origin))

const routes = {
  'GET /api/state': () => ({ setup: status(), settings: loadSettings(), panelServers: Object.keys(loadServers()).length, gatewayTokens: GATEWAY_TOOLS.reduce((a, x) => a + toolCost(x), 0) }),
  'GET /api/inventory': (req, url) => getInventory(url.searchParams.has('refresh')),
  'GET /api/setup/plan': () => plan(),
  'POST /api/setup/apply': async (req) => {
    const b = await body(req)
    const r = apply(b.selection ?? {}, { skill: b.skill !== false })
    buildInventory().catch(() => {})
    return r
  },
  'POST /api/setup/undo': () => undo(),
  'POST /api/settings': async (req) => {
    const b = await body(req)
    const s = { ...loadSettings() }
    for (const k of ['blenderPath', 'blenderScenes', 'language']) if (k in b) s[k] = b[k] || undefined
    saveSettings(s)
    return s
  },
  'POST /api/run': async (req) => {
    const b = await body(req)
    if (typeof b.code !== 'string') throw new Error('Missing code')
    return runner.run(b.code, { source: 'panel', title: b.title || undefined, timeoutMs: 240000 })
  },
  'GET /api/history': () => readJson(PATHS.history, []),
  'DELETE /api/history': () => (writeJson(PATHS.history, []), { ok: true }),
  'GET /api/usage': (req, url) => {
    const d = Number(url.searchParams.get('days'))
    return usage({ days: [0, 7, 30].includes(d) ? d : 30, history: readJson(PATHS.history, []) })
  },
  'GET /api/examples': () => {
    const dir = path.join(APP_DIR, 'examples')
    return fs.readdirSync(dir).filter((f) => f.endsWith('.js')).map((f) => {
      const text = fs.readFileSync(path.join(dir, f), 'utf8')
      const meta = Object.fromEntries([...text.matchAll(/^\/\/\s*(title|title_es|needs):\s*(.+)$/gm)].map((m) => [m[1], m[2].trim()]))
      return { file: f, ...meta, code: text }
    })
  },
}

export function startPanel({ open = true } = {}) {
  ensureHome()
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`)
    try {
      if (url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && !ownRequest(req)) return json(res, 403, { error: 'Not allowed' })
        const fn = routes[`${req.method} ${url.pathname}`]
        if (!fn) return json(res, 404, { error: 'Not found' })
        return json(res, 200, await fn(req, url))
      }
      const rel = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1))
      const file = path.resolve(PUBLIC, rel)
      if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404)
        return res.end('Not found')
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' })
      fs.createReadStream(file).pipe(res)
    } catch (e) {
      json(res, 500, { error: String(e?.message ?? e).slice(0, 500) })
    }
  })

  // Started by the desktop app: stop when the app is gone, even if it was killed
  const parent = Number(process.env.CODE_MODE_PARENT)
  if (parent) {
    setInterval(() => {
      try {
        process.kill(parent, 0)
      } catch {
        process.exit(0)
      }
    }, 3000).unref()
  }

  return new Promise((resolve, reject) => {
    server.once('error', (e) => {
      if (e.code === 'EADDRINUSE') {
        console.log(`Code Mode MCP is already running: http://localhost:${PORT}`)
        if (open) openBrowser(`http://localhost:${PORT}`)
        return resolve(null)
      }
      reject(e)
    })
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Code Mode MCP panel: http://localhost:${PORT}  (Ctrl+C to stop)`)
      if (open) openBrowser(`http://localhost:${PORT}`)
      getInventory(false).catch(() => {})
      resolve(server)
    })
  })
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]]
  spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
}

// `node server.mjs` directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.join(APP_DIR, 'server.mjs')) startPanel({ open: !process.argv.includes('--no-open') })
