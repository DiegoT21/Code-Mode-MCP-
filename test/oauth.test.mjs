// Sign-in (OAuth) of a remote MCP server behind the gateway, against the SDK's example server with OAuth
// (its demo login approves at once). No network needed.
//   node --test test/oauth.test.mjs

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'code-mode-oauth-'))
process.env.CODE_MODE_HOME = path.join(TMP, 'home')
const MCP_PORT = 3456
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const example = path.join(APP, 'node_modules', '@modelcontextprotocol', 'sdk', 'dist', 'esm', 'examples', 'server', 'simpleStreamableHttp.js')

const { saveServers, loadServers } = await import('../lib/config.mjs')
const { inspect, startSignIn, finishSignIn } = await import('../lib/mcp.mjs')
const { Runner } = await import('../lib/runner.mjs')

let server
test.before(async () => {
  server = spawn(process.execPath, [example, '--oauth'], { env: { ...process.env, MCP_PORT: String(MCP_PORT), MCP_AUTH_PORT: String(MCP_PORT + 1) }, stdio: 'pipe' })
  await new Promise((ok, fail) => {
    const t = setTimeout(() => fail(new Error('example server did not start')), 20000)
    server.stdout.on('data', (d) => /listening on port/i.test(String(d)) && /MCP/.test(String(d)) && (clearTimeout(t), ok()))
  })
  saveServers({ remote: { type: 'http', url: `http://localhost:${MCP_PORT}/mcp`, headers: {} } })
})

test('a remote server that needs sign-in is reported, not broken', async () => {
  const r = await inspect('remote', loadServers().remote)
  assert.equal(r.state, 'unavailable')
  assert.equal(r.needsSignIn, true)
})

test('sign in once, then the gateway uses the saved session', { timeout: 60000 }, async () => {
  const s = loadServers().remote
  const start = await startSignIn('remote', s)
  assert.ok(start.url, 'gives a login URL to open')
  // The demo login approves at once and redirects to our callback with ?code=
  const res = await fetch(start.url, { redirect: 'manual' })
  const back = new URL(res.headers.get('location'))
  assert.match(back.pathname, /^\/oauth\/callback\/remote$/)
  const done = await finishSignIn('remote', s, back.searchParams.get('code'))
  assert.equal(done.ok, true)
  assert.ok(done.tools > 0)

  const after = await inspect('remote', s)
  assert.equal(after.state, 'connected')
  const runner = new Runner()
  const r = await runner.run("return await mcp.call('remote', 'greet', { name: 'Ada' })", { source: 'cli' })
  await runner.close()
  assert.equal(r.ok, true, r.error)
  assert.match(JSON.stringify(r.result), /Ada/)
  const saved = fs.readFileSync(path.join(process.env.CODE_MODE_HOME, 'oauth', 'remote.json'), 'utf8')
  assert.match(saved, /access_token/)
})

test.after(() => {
  server?.kill()
  fs.rmSync(TMP, { recursive: true, force: true })
})
