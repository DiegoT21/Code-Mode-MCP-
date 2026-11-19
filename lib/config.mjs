// Where Code Mode MCP keeps its things. Everything lives in the user's home, never in the app folder:
//
//   ~/.code-mode-mcp/
//     servers.json        MCP servers moved into the panel (the gateway connects to these). Contains env
//                         values (keys), so it is written with user-only permissions and never shown.
//     settings.json       optional: { blenderPath, blenderScenes, language }
//     history.json        sandbox / run_code runs
//     installs.json       install log (cli add/remove)
//     setup.json          what the Setup button changed, for Undo
//     backups/            copies of every config file before it is touched
//     cache/              inventory and token-usage caches
//     app/                stable copy of the app when it was started with npx (configs point here)
//
// CODE_MODE_HOME overrides the folder (used by the tests).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const HOME = process.env.CODE_MODE_HOME ?? path.join(os.homedir(), '.code-mode-mcp')
export const PATHS = {
  home: HOME,
  servers: path.join(HOME, 'servers.json'),
  settings: path.join(HOME, 'settings.json'),
  history: path.join(HOME, 'history.json'),
  installs: path.join(HOME, 'installs.json'),
  setup: path.join(HOME, 'setup.json'),
  backups: path.join(HOME, 'backups'),
  cache: path.join(HOME, 'cache'),
  stableApp: path.join(HOME, 'app'),
}
export const PORT = Number(process.env.CODE_MODE_PORT ?? 4777)

export function ensureHome() {
  fs.mkdirSync(PATHS.backups, { recursive: true })
  fs.mkdirSync(PATHS.cache, { recursive: true })
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

// Atomic write: temp file + rename, so a crash never leaves a half-written config
export function writeJson(file, value, { private: priv = false } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), priv ? { mode: 0o600 } : undefined)
  JSON.parse(fs.readFileSync(tmp, 'utf8'))
  fs.renameSync(tmp, file)
}

export function backup(file, label) {
  ensureHome()
  if (!fs.existsSync(file)) return null
  const safe = label.replace(/[^\w.-]+/g, '-')
  const dest = path.join(PATHS.backups, `${safe}.${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  fs.copyFileSync(file, dest)
  try {
    fs.chmodSync(dest, 0o600)
  } catch {}
  return dest
}

// MCP servers that live in the panel (the gateway's downstream servers)
export const loadServers = () => readJson(PATHS.servers, {})
export const saveServers = (s) => writeJson(PATHS.servers, s, { private: true })

export const loadSettings = () => readJson(PATHS.settings, {})
export const saveSettings = (s) => writeJson(PATHS.settings, s)

export function appendLog(file, entry, max = 500) {
  const list = readJson(file, [])
  list.unshift({ date: new Date().toISOString(), ...entry })
  writeJson(file, list.slice(0, max))
}

// Command the AI clients use to start the gateway. With npx the package lives in a temporary cache, so
// Setup first copies the app to ~/.code-mode-mcp/app and points the configs there.
export function gatewayCommand(appDir = APP_DIR) {
  return { command: process.execPath, args: [path.join(appDir, 'bin', 'code-mode-mcp.mjs'), 'gateway'] }
}
export const runningFromNpx = () => /[\\/]_npx[\\/]/.test(APP_DIR)
