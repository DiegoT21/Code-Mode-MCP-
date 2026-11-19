// "App mode" without an installer: the panel in its own window (no tabs, no address bar) using the Edge or
// Chrome already installed, and a desktop / Start menu shortcut that opens it. Edge, Chrome and Node are
// signed, so Windows Smart App Control lets them run (an unsigned installer it may block).

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { APP_DIR, PATHS } from './config.mjs'

export function findAppBrowser() {
  const env = process.env
  const candidates =
    process.platform === 'win32'
      ? [
          path.join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
          path.join(env.ProgramFiles ?? 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
          path.join(env.ProgramFiles ?? 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
          path.join(env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe'),
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
        : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium']
  return candidates.find((c) => c && fs.existsSync(c)) ?? null
}

// Opens the URL as an app window. Returns the browser process (or null if no Edge/Chrome was found).
// Its own profile folder makes it a separate window that lives until the user closes it.
export function openAppWindow(url) {
  const exe = findAppBrowser()
  if (!exe) return null
  const args = [`--app=${url}`, `--user-data-dir=${path.join(PATHS.home, 'app-window')}`, '--window-size=1280,800', '--no-first-run', '--no-default-browser-check']
  const child = spawn(exe, args, { stdio: 'ignore', windowsHide: false })
  child.on('error', () => {})
  return child
}

// Starts the panel in the background (no console window) and returns at once. Used by the shortcut.
export function launchDetached() {
  const child = spawn(process.execPath, [path.join(APP_DIR, 'bin', 'code-mode-mcp.mjs'), 'open', '--app'], { detached: true, stdio: 'ignore', windowsHide: true })
  child.unref()
}

// Desktop and Start menu shortcuts (Windows). appDir: a stable copy of the app (not an npx cache folder).
export function createShortcuts(appDir = APP_DIR) {
  if (process.platform !== 'win32') {
    return { ok: false, error: 'Shortcuts are only created on Windows. On macOS/Linux run: code-mode-mcp --app' }
  }
  const icon = path.join(appDir, 'public', 'icon.ico')
  const bin = path.join(appDir, 'bin', 'code-mode-mcp.mjs')
  const desktop = path.join(os.homedir(), 'Desktop')
  const startMenu = path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs')
  const targets = [desktop, startMenu].filter((d) => fs.existsSync(d)).map((d) => path.join(d, 'Code Mode MCP.lnk'))
  const q = (s) => `'${String(s).replace(/'/g, "''")}'`
  const script = targets
    .map((lnk) => [
      `$s = (New-Object -ComObject WScript.Shell).CreateShortcut(${q(lnk)})`,
      `$s.TargetPath = ${q(process.execPath)}`,
      `$s.Arguments = ${q(`"${bin}" launch`)}`,
      `$s.WorkingDirectory = ${q(appDir)}`,
      `$s.IconLocation = ${q(icon)}`,
      `$s.WindowStyle = 7`,
      `$s.Description = 'Code Mode MCP: one MCP for all your MCPs'`,
      '$s.Save()',
    ].join('; '))
    .join('; ')
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) return { ok: false, error: (r.stderr || r.stdout || 'PowerShell failed').trim().slice(0, 300) }
  return { ok: true, shortcuts: targets }
}

export function removeShortcuts() {
  const removed = []
  for (const d of [path.join(os.homedir(), 'Desktop'), path.join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs')]) {
    const lnk = path.join(d, 'Code Mode MCP.lnk')
    if (fs.existsSync(lnk)) {
      fs.rmSync(lnk)
      removed.push(lnk)
    }
  }
  return { ok: true, removed }
}
