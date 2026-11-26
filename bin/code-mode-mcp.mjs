#!/usr/bin/env node
// Code Mode MCP — command line.
//
//   code-mode-mcp                         open the panel (http://localhost:4777)
//   code-mode-mcp --app                   open it in its own window (Edge/Chrome app mode)
//   code-mode-mcp shortcut [--remove]     desktop + Start menu shortcut that opens it as an app (Windows)
//   code-mode-mcp gateway                 run the MCP gateway on stdio (this is what AI clients start)
//   code-mode-mcp setup                   show what Setup would move
//   code-mode-mcp setup --apply           move every MCP server of every AI client into the panel
//   code-mode-mcp setup --undo            put everything back
//   code-mode-mcp list                    MCP servers in the panel, with tools and token cost
//   code-mode-mcp add <name> --config '<json>' [--env NAME ...] [--force]
//   code-mode-mcp remove <name>
//   code-mode-mcp skill-add <folder|SKILL.md> [--force]     (Claude Code skills)
//   code-mode-mcp skill-remove <name>
//   code-mode-mcp run <file.js>           run code like run_code does, print only the result
//   code-mode-mcp check <url> [--screen mobile|tablet|desktop] [--screenshot file.png]
//   code-mode-mcp usage [--days 7|30|0]   Claude Code token usage on this computer
//
// --config is the server as it goes in an mcpServers list, e.g.
//   '{"command":"npx","args":["-y","@upstash/context7-mcp"]}'   or   '{"type":"http","url":"https://…/mcp"}'
// Keys never go in --config: --env NAME takes the value from the NAME variable of this terminal.

import fs from 'node:fs'
import path from 'node:path'

let [cmd = 'open', ...rest] = process.argv.slice(2)
if (cmd.startsWith('--')) {
  rest = [cmd, ...rest]
  cmd = 'open'
}
const WITH_VALUE = new Set(['--config', '--config-file', '--env', '--screen', '--screenshot', '--days', '--port', '--name'])
const opt = (n) => {
  const i = rest.indexOf(`--${n}`)
  return i >= 0 ? rest[i + 1] : undefined
}
const opts = (n) => rest.flatMap((a, i) => (a === `--${n}` ? [rest[i + 1]] : []))
const flag = (n) => rest.includes(`--${n}`)
let positional
for (let i = 0; i < rest.length; i++) {
  if (WITH_VALUE.has(rest[i])) i++
  else if (!rest[i].startsWith('--')) {
    positional = rest[i]
    break
  }
}
const print = (v, code = 0) => {
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  process.exit(code)
}
const fail = (msg) => print({ ok: false, error: msg }, 1)

switch (cmd) {
  case 'gateway': {
    const { startGateway } = await import('../lib/gateway.mjs')
    await startGateway()
    break
  }

  case 'open':
  case 'panel': {
    if (opt('port')) process.env.CODE_MODE_PORT = opt('port')
    const { startPanel } = await import('../server.mjs')
    await startPanel({ open: !flag('no-open'), app: flag('app') })
    break
  }

  case 'launch': {
    // Used by the shortcut: start the panel in the background (no console) and quit
    const { launchDetached } = await import('../lib/appwindow.mjs')
    launchDetached()
    process.exit(0)
  }

  case 'shortcut': {
    const a = await import('../lib/appwindow.mjs')
    if (flag('remove')) print(a.removeShortcuts())
    const { stableAppDir } = await import('../lib/setup.mjs')
    print(a.createShortcuts(stableAppDir()))
    break
  }

  case 'setup': {
    const s = await import('../lib/setup.mjs')
    if (flag('undo')) print(s.undo())
    const p = s.plan()
    if (!flag('apply')) {
      print({
        status: p.status,
        clients: p.clients.filter((c) => c.found).map((c) => ({ client: c.name, file: c.file, servers: c.servers.map((x) => x.name + (x.isGateway ? ' (gateway)' : '')) })),
        next: 'Run again with --apply to move them all into the panel.',
      })
    }
    const selection = {}
    for (const c of p.clients) if (c.found) selection[c.id] = c.servers.filter((x) => !x.isGateway).map((x) => x.name)
    print(s.apply(selection))
    break
  }

  case 'list': {
    const { loadServers } = await import('../lib/config.mjs')
    const { inspect } = await import('../lib/mcp.mjs')
    const servers = loadServers()
    const list = await Promise.all(Object.entries(servers).map(([n, s]) => inspect(n, s)))
    print({ servers: list.map((s) => ({ name: s.name, state: s.state, tools: s.tools.length, tokens: s.tokensTotal, ...(s.reason && { reason: s.reason }) })), tokensIfLoadedDirectly: list.reduce((a, s) => a + s.tokensTotal, 0) })
    break
  }

  case 'add': {
    const name = positional
    if (!name || !/^[\w.-]+$/.test(name)) fail('Invalid name (letters, numbers, dot, dash, underscore)')
    const { loadServers, saveServers, appendLog, PATHS } = await import('../lib/config.mjs')
    const { normalize, safeView } = await import('../lib/clients.mjs')
    const { inspect } = await import('../lib/mcp.mjs')
    const servers = loadServers()
    if (servers[name] && !flag('force')) fail(`"${name}" already exists. Use --force to replace it.`)
    const rawText = opt('config-file') ? fs.readFileSync(opt('config-file'), 'utf8') : opt('config')
    if (!rawText) fail('Missing --config (or --config-file) with the server JSON')
    let raw
    try {
      raw = JSON.parse(rawText)
    } catch (e) {
      fail(`--config is not valid JSON: ${e.message}`)
    }
    if (raw.env && Object.values(raw.env).some((v) => String(v).length)) fail('Do not put values in "env": use --env NAME (taken from this terminal)')
    const s = normalize(raw)
    const missing = []
    for (const n of opts('env')) {
      s.env ??= {}
      s.env[n] = process.env[n] ?? ''
      if (!process.env[n]) missing.push(n)
    }
    const r = await inspect(name, s)
    if (r.state !== 'connected' && !r.needsSignIn && !missing.length && !flag('force')) print({ ok: false, error: 'The server did not answer; not added. Use --force to add it anyway.', reason: r.reason }, 1)
    servers[name] = s
    saveServers(servers)
    appendLog(PATHS.installs, { action: 'add-mcp', name, server: safeView(name, s), tools: r.tools.length, tokens: r.tokensTotal })
    print({ ok: true, added: name, tools: r.tools.length, tokensIfLoadedDirectly: r.tokensTotal, ...(r.needsSignIn && { signIn: 'This server asks you to sign in: open the panel → Inventory → ' + name + ' → Sign in.' }), ...(missing.length && { missingValues: missing, note: `Put the values in ${PATHS.servers} → ${name} → env` }) })
    break
  }

  case 'remove': {
    const { loadServers, saveServers, appendLog, PATHS, backup } = await import('../lib/config.mjs')
    const servers = loadServers()
    if (!servers[positional]) fail(`No server "${positional}" in the panel`)
    const bak = backup(PATHS.servers, 'servers')
    delete servers[positional]
    saveServers(servers)
    appendLog(PATHS.installs, { action: 'remove-mcp', name: positional })
    print({ ok: true, removed: positional, backup: bak })
    break
  }

  case 'skill-add':
  case 'skill-remove': {
    const { CLIENTS, skillDescription } = await import('../lib/clients.mjs')
    const { appendLog, PATHS } = await import('../lib/config.mjs')
    const { tokens } = await import('../lib/tokens.mjs')
    const dir = CLIENTS.find((c) => c.id === 'claude-code').skills
    if (cmd === 'skill-remove') {
      const dest = path.join(dir, positional ?? '')
      if (!positional || !fs.existsSync(dest)) fail(`No skill "${positional}"`)
      const bak = path.join(PATHS.backups, `skill-${positional}-${Date.now()}`)
      fs.cpSync(dest, bak, { recursive: true })
      fs.rmSync(dest, { recursive: true, force: true })
      appendLog(PATHS.installs, { action: 'remove-skill', name: positional })
      print({ ok: true, removed: positional, backup: bak })
    }
    if (!positional) fail('Missing the skill folder or SKILL.md')
    const src = path.resolve(positional)
    const isFile = fs.existsSync(src) && fs.statSync(src).isFile()
    const md = isFile ? src : path.join(src, 'SKILL.md')
    if (!fs.existsSync(md)) fail(`Not found: ${md}`)
    const text = fs.readFileSync(md, 'utf8')
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
    const description = skillDescription(fm ?? '')
    if (!description) fail('SKILL.md needs a front matter with "description:" (that is how the AI knows when to use it)')
    const name = opt('name') ?? fm.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? path.basename(isFile ? path.dirname(src) : src)
    if (!/^[\w.-]+$/.test(name)) fail(`Invalid skill name: ${name}`)
    const dest = path.join(dir, name)
    if (fs.existsSync(dest) && !flag('force')) fail(`Skill "${name}" exists. Use --force to replace it (a backup is kept).`)
    if (fs.existsSync(dest)) {
      fs.cpSync(dest, path.join(PATHS.backups, `skill-${name}-${Date.now()}`), { recursive: true })
      fs.rmSync(dest, { recursive: true, force: true })
    }
    if (isFile) {
      fs.mkdirSync(dest, { recursive: true })
      fs.copyFileSync(src, path.join(dest, 'SKILL.md'))
    } else fs.cpSync(src, dest, { recursive: true })
    const t = { always: tokens(`${name}: ${description}`), whenUsed: tokens(text) }
    appendLog(PATHS.installs, { action: 'add-skill', name, tokens: t.always })
    print({ ok: true, added: name, path: dest, tokens: t })
    break
  }

  case 'run': {
    if (!positional) fail('Missing the .js file')
    const { Runner } = await import('../lib/runner.mjs')
    const runner = new Runner()
    const r = await runner.run(fs.readFileSync(positional, 'utf8'), { source: 'cli', title: path.basename(positional) })
    await runner.close()
    print(r.ok ? { result: r.result, ...(r.logs.length && { logs: r.logs }), tokens: { here: r.comparison.code.total, classic: r.comparison.classic.total } } : { error: r.error }, r.ok ? 0 : 1)
    break
  }

  case 'check': {
    if (!positional) fail('Missing the URL')
    const { check } = await import('../lib/browser/browser.mjs')
    print(await check(positional, { screen: opt('screen') ?? 'desktop', screenshot: opt('screenshot') }))
    break
  }

  case 'usage': {
    const { usage } = await import('../lib/usage.mjs')
    const { readJson, PATHS } = await import('../lib/config.mjs')
    const u = await usage({ days: Number(opt('days') ?? 30), history: readJson(PATHS.history, []) })
    print({ from: u.desde, to: u.hasta, sessions: u.totales.sesiones, costUsd: Math.round(u.totales.costo), tokensRead: u.totales.entradaTotal, fromCache: `${(u.totales.pctCache * 100).toFixed(1)}%`, tokensWritten: u.totales.o, savedByCacheUsd: Math.round(u.totales.ahorroCacheUsd) })
    break
  }

  default:
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'))
}
