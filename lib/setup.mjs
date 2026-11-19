// The Setup button. plan() shows what was found; apply() moves the chosen MCP servers into the panel and
// leaves only the Code Mode gateway in each AI client; undo() puts everything back.
// Every file is backed up before it is touched, and only its MCP section changes.

import fs from 'node:fs'
import path from 'node:path'
import { CLIENTS, GATEWAY_NAME, readClient, writeClientServers, normalize, denormalize, safeView, detect } from './clients.mjs'
import { APP_DIR, PATHS, ensureHome, backup, loadServers, saveServers, readJson, writeJson, gatewayCommand, runningFromNpx, appendLog } from './config.mjs'

const SKILL_SRC = path.join(APP_DIR, 'skills', 'code-mode', 'SKILL.md')

export function status() {
  const done = readJson(PATHS.setup, null)
  return { applied: !!done, at: done?.at ?? null, appDir: done?.appDir ?? null, clients: done ? Object.keys(done.clients) : [], panelServers: Object.keys(loadServers()) }
}

export function plan() {
  return { clients: detect(), status: status(), npx: runningFromNpx() }
}

// Copy of the app in a fixed place when started with npx (its cache folder can disappear)
export function stableAppDir() {
  if (!runningFromNpx()) return APP_DIR
  const dest = PATHS.stableApp
  fs.rmSync(dest, { recursive: true, force: true })
  fs.cpSync(APP_DIR, dest, { recursive: true, filter: (src) => !/[\\/](\.git|escritorio|test)([\\/]|$)/.test(src.slice(APP_DIR.length)) })
  // npx installs the dependencies next to the package (…/_npx/<id>/node_modules/*), not inside it
  const siblings = path.dirname(APP_DIR)
  if (path.basename(siblings) === 'node_modules' && !fs.existsSync(path.join(dest, 'node_modules', '@modelcontextprotocol'))) {
    for (const entry of fs.readdirSync(siblings)) {
      if (entry === path.basename(APP_DIR) || entry === '.bin' || entry.startsWith('.package-lock')) continue
      fs.cpSync(path.join(siblings, entry), path.join(dest, 'node_modules', entry), { recursive: true })
    }
  }
  return dest
}

// selection: { [clientId]: ['server', ...] }   options: { skill: true }
export function apply(selection = {}, { skill = true } = {}) {
  ensureHome()
  const previous = readJson(PATHS.setup, null)
  const appDir = stableAppDir()
  const gw = gatewayCommand(appDir)
  const registry = loadServers()
  const record = previous ?? { at: null, appDir, clients: {}, registryAdded: [], skillInstalled: false }
  record.at = new Date().toISOString()
  record.appDir = appDir
  const summary = []

  for (const client of CLIENTS) {
    const names = selection[client.id]
    if (!names) continue
    const r = readClient(client)
    if (!r.readable) {
      summary.push({ client: client.name, error: 'config file is not valid JSON; not touched' })
      continue
    }
    const rawSection = r.json?.[client.key] ?? {}
    const moved = []
    for (const name of names) {
      if (name === GATEWAY_NAME || !rawSection[name]) continue
      const s = normalize(rawSection[name])
      let regName = name
      if (registry[regName] && JSON.stringify(registry[regName]) !== JSON.stringify(s)) regName = `${name}-${client.id}`
      if (!registry[regName]) {
        registry[regName] = s
        record.registryAdded.push(regName)
      }
      moved.push({ name, regName, raw: rawSection[name] })
    }
    const hadGateway = !!rawSection[GATEWAY_NAME]
    const bak = backup(client.file, client.id)
    writeClientServers(client, (sec) => {
      for (const m of moved) delete sec[m.name]
      sec[GATEWAY_NAME] = denormalize(client, { type: 'stdio', command: gw.command, args: gw.args, env: {} })
    })
    const rec = (record.clients[client.id] ??= { file: client.file, backups: [], moved: [], hadGateway })
    rec.backups.push(bak)
    rec.moved.push(...moved)
    summary.push({ client: client.name, moved: moved.map((m) => m.regName), gateway: GATEWAY_NAME, backup: bak })
  }

  saveServers(registry)
  if (skill && selection['claude-code']) {
    const dest = path.join(CLIENTS.find((c) => c.id === 'claude-code').skills, 'code-mode')
    if (fs.existsSync(SKILL_SRC) && !fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true })
      fs.copyFileSync(SKILL_SRC, path.join(dest, 'SKILL.md'))
      record.skillInstalled = dest
    }
  }
  writeJson(PATHS.setup, record, { private: true })
  appendLog(PATHS.installs, { action: 'setup', detail: summary.map((s) => `${s.client}: ${s.moved?.length ?? 0} moved`).join('; ') })
  return { ok: true, summary, panelServers: Object.keys(registry), restart: 'Restart your AI apps (or open a new session) so they load the gateway.' }
}

export function undo() {
  const record = readJson(PATHS.setup, null)
  if (!record) return { ok: false, error: 'Nothing to undo' }
  const summary = []
  for (const [id, rec] of Object.entries(record.clients)) {
    const client = CLIENTS.find((c) => c.id === id)
    if (!client) continue
    try {
      const bak = backup(client.file, `${id}-before-undo`)
      const restored = []
      writeClientServers(client, (sec) => {
        if (!rec.hadGateway) delete sec[GATEWAY_NAME]
        for (const m of rec.moved) {
          if (sec[m.name]) continue // the user added it again meanwhile: keep theirs
          sec[m.name] = m.raw
          restored.push(m.name)
        }
      })
      summary.push({ client: client.name, restored, backup: bak })
    } catch (e) {
      summary.push({ client: client.name, error: String(e.message) })
    }
  }
  const registry = loadServers()
  for (const n of record.registryAdded ?? []) delete registry[n]
  saveServers(registry)
  if (record.skillInstalled) fs.rmSync(record.skillInstalled, { recursive: true, force: true })
  fs.renameSync(PATHS.setup, path.join(PATHS.backups, `setup-undone.${Date.now()}.json`))
  appendLog(PATHS.installs, { action: 'undo-setup', detail: summary.map((s) => `${s.client}: ${s.restored?.length ?? 0} restored`).join('; ') })
  return { ok: true, summary, restart: 'Restart your AI apps so they load the servers again.' }
}

// Servers in the panel, shown safely
export function panelServers() {
  return Object.entries(loadServers()).map(([n, s]) => safeView(n, s))
}
