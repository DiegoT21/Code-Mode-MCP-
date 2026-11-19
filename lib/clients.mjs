// AI clients that keep MCP servers in a JSON file on this computer, and how to read and change them.
// Only the MCP section of each file is touched; everything else in the file is kept as it was.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readJson, writeJson } from './config.mjs'

const home = os.homedir()
const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
const plat = process.platform
const macSupport = path.join(home, 'Library', 'Application Support')
const linuxConfig = process.env.XDG_CONFIG_HOME ?? path.join(home, '.config')
const byOs = (win, mac, linux) => (plat === 'win32' ? win : plat === 'darwin' ? mac : linux)

// key: where the servers are inside the file. format: how a remote server is written.
export const CLIENTS = [
  { id: 'claude-code', name: 'Claude Code', file: path.join(home, '.claude.json'), key: 'mcpServers', format: 'claude-code', skills: process.env.CODE_MODE_CLAUDE_SKILLS_DIR ?? path.join(home, '.claude', 'skills') },
  { id: 'claude-desktop', name: 'Claude Desktop', file: byOs(path.join(appData, 'Claude', 'claude_desktop_config.json'), path.join(macSupport, 'Claude', 'claude_desktop_config.json'), path.join(linuxConfig, 'Claude', 'claude_desktop_config.json')), key: 'mcpServers', format: 'stdio-only' },
  { id: 'cursor', name: 'Cursor', file: path.join(home, '.cursor', 'mcp.json'), key: 'mcpServers', format: 'url' },
  { id: 'vscode', name: 'VS Code', file: byOs(path.join(appData, 'Code', 'User', 'mcp.json'), path.join(macSupport, 'Code', 'User', 'mcp.json'), path.join(linuxConfig, 'Code', 'User', 'mcp.json')), key: 'servers', format: 'vscode' },
  { id: 'windsurf', name: 'Windsurf', file: path.join(home, '.codeium', 'windsurf', 'mcp_config.json'), key: 'mcpServers', format: 'serverUrl' },
  { id: 'gemini', name: 'Gemini CLI', file: path.join(home, '.gemini', 'settings.json'), key: 'mcpServers', format: 'url' },
]
for (const c of CLIENTS) if (process.env[`CODE_MODE_${c.id.replace('-', '_').toUpperCase()}_FILE`]) c.file = process.env[`CODE_MODE_${c.id.replace('-', '_').toUpperCase()}_FILE`]

export const GATEWAY_NAME = 'code-mode'

// One common shape for every server: { type: 'stdio', command, args, env, cwd } | { type: 'http'|'sse', url, headers }
export function normalize(entry = {}) {
  const url = entry.url ?? entry.serverUrl ?? entry.httpUrl
  if (url) return { type: entry.type === 'sse' ? 'sse' : 'http', url, headers: entry.headers ?? {} }
  return { type: 'stdio', command: entry.command, args: entry.args ?? [], env: entry.env ?? {}, ...(entry.cwd && { cwd: entry.cwd }) }
}

// Back to the client's own format
export function denormalize(client, s) {
  if (s.type === 'stdio') {
    const e = { command: s.command, args: s.args ?? [], ...(Object.keys(s.env ?? {}).length && { env: s.env }), ...(s.cwd && { cwd: s.cwd }) }
    return client.format === 'claude-code' || client.format === 'vscode' ? { type: 'stdio', ...e } : e
  }
  if (client.format === 'serverUrl') return { serverUrl: s.url, ...(Object.keys(s.headers ?? {}).length && { headers: s.headers }) }
  return { type: s.type, url: s.url, ...(Object.keys(s.headers ?? {}).length && { headers: s.headers }) }
}

// What can be shown about a server: never env or header values
export function safeView(name, s) {
  return {
    name,
    type: s.type,
    command: s.command ?? null,
    args: (s.args ?? []).map((a) => (/(key|token|secret|password)=/i.test(a) ? a.replace(/=.*/, '=•••') : a)),
    url: s.url ? s.url.replace(/([?&][^=]*(key|token|secret)[^=]*=)[^&]+/gi, '$1•••') : null,
    envNames: Object.keys(s.env ?? {}),
    headerNames: Object.keys(s.headers ?? {}),
  }
}

export function readClient(client) {
  const exists = fs.existsSync(client.file)
  const json = exists ? readJson(client.file, null) : null
  const raw = json?.[client.key] ?? {}
  const servers = {}
  for (const [name, entry] of Object.entries(raw)) servers[name] = normalize(entry)
  return { exists, readable: !exists || json != null, json, servers }
}

export function writeClientServers(client, change) {
  const json = fs.existsSync(client.file) ? readJson(client.file, null) : {}
  if (json == null) throw new Error(`${client.name}: ${client.file} is not valid JSON; not touched`)
  json[client.key] ??= {}
  change(json[client.key])
  writeJson(client.file, json)
}

// Skills (only Claude Code has them as files)
export function listSkills(dir) {
  let folders = []
  try {
    folders = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory())
  } catch {}
  return folders.map((d) => {
    let text = ''
    try {
      text = fs.readFileSync(path.join(dir, d.name, 'SKILL.md'), 'utf8')
    } catch {}
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? ''
    return { name: d.name, description: fm.match(/^description:\s*(.*)$/m)?.[1]?.replace(/^["']|["']$/g, '') ?? '', text }
  })
}

// Everything found on this computer
export function detect() {
  return CLIENTS.map((c) => {
    const r = readClient(c)
    return {
      id: c.id,
      name: c.name,
      file: c.file,
      found: r.exists,
      readable: r.readable,
      servers: Object.entries(r.servers).map(([n, s]) => ({ ...safeView(n, s), isGateway: n === GATEWAY_NAME })),
      skills: c.skills ? listSkills(c.skills).map((s) => ({ name: s.name, description: s.description })) : [],
    }
  })
}
