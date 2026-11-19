// End-to-end test of the backend with a fake home: AI client configs, Setup, the gateway and Undo.
//   npm test
// Needs network the first time (npx downloads @upstash/context7-mcp). Never touches the real configs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'code-mode-test-'))
const files = {
  'claude-code': path.join(TMP, 'claude.json'),
  cursor: path.join(TMP, 'cursor-mcp.json'),
  vscode: path.join(TMP, 'vscode-mcp.json'),
}
const env = {
  CODE_MODE_HOME: path.join(TMP, 'home'),
  CODE_MODE_CLAUDE_CODE_FILE: files['claude-code'],
  CODE_MODE_CURSOR_FILE: files.cursor,
  CODE_MODE_VSCODE_FILE: files.vscode,
  CODE_MODE_CLAUDE_DESKTOP_FILE: path.join(TMP, 'none-desktop.json'),
  CODE_MODE_WINDSURF_FILE: path.join(TMP, 'none-windsurf.json'),
  CODE_MODE_GEMINI_FILE: path.join(TMP, 'none-gemini.json'),
  CODE_MODE_CLAUDE_SKILLS_DIR: path.join(TMP, 'skills'),
}
Object.assign(process.env, env)

const context7 = { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], env: { SECRET_TOKEN: 'never-show-this-123' } }
const original = {
  'claude-code': { other: { keep: true }, mcpServers: { context7 } },
  cursor: { mcpServers: { context7: { command: 'npx', args: ['-y', '@upstash/context7-mcp'] }, remote: { url: 'https://example.invalid/mcp' } } },
  vscode: { inputs: [], servers: { context7: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] } } },
}
for (const [k, v] of Object.entries(original)) fs.writeFileSync(files[k], JSON.stringify(v, null, 2))
const readFile = (k) => JSON.parse(fs.readFileSync(files[k], 'utf8'))

const { plan, apply, undo } = await import('../lib/setup.mjs')
const { loadServers } = await import('../lib/config.mjs')

test('detects the clients and their servers, without secret values', () => {
  const p = plan()
  const found = Object.fromEntries(p.clients.filter((c) => c.found).map((c) => [c.id, c.servers.map((s) => s.name)]))
  assert.deepEqual(found, { 'claude-code': ['context7'], cursor: ['context7', 'remote'], vscode: ['context7'] })
  assert.ok(!JSON.stringify(p).includes('never-show-this-123'))
})

test('apply moves the servers into the panel and leaves only the gateway', () => {
  const r = apply({ 'claude-code': ['context7'], cursor: ['context7', 'remote'], vscode: ['context7'] }, { skill: false })
  assert.equal(r.ok, true)
  const cc = readFile('claude-code')
  assert.deepEqual(Object.keys(cc.mcpServers), ['code-mode'])
  assert.deepEqual(cc.other, { keep: true }, 'the rest of the file is kept')
  assert.deepEqual(Object.keys(readFile('cursor').mcpServers), ['code-mode'])
  assert.deepEqual(Object.keys(readFile('vscode').servers), ['code-mode'])
  assert.equal(readFile('vscode').servers['code-mode'].type, 'stdio')
  const reg = loadServers()
  assert.ok(reg.context7 && reg.remote, 'servers are in the panel')
  assert.ok(Object.keys(reg).some((n) => n.startsWith('context7-')), 'a different config with the same name gets its own entry')
})

test('the gateway lists 3 tools, searches and runs code against a moved server', { timeout: 300000 }, async () => {
  const gw = readFile('claude-code').mcpServers['code-mode']
  const client = new Client({ name: 'test', version: '1' })
  await client.connect(new StdioClientTransport({ command: gw.command, args: gw.args, env: { ...process.env, ...env }, stderr: 'pipe' }))
  try {
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map((t) => t.name), ['search_tools', 'describe_tool', 'run_code'])
    // The first run may download the servers with npx (slow on a fresh machine): search until they answer
    let search
    for (let i = 0; i < 8; i++) {
      search = await client.callTool({ name: 'search_tools', arguments: { query: 'library docs' } }, undefined, { timeout: 120000 })
      if (!/stillLoading/.test(search.content[0].text)) break
    }
    assert.match(search.content[0].text, /context7/)
    const run = await client.callTool({
      name: 'run_code',
      arguments: { code: "const r = await mcp.call('context7', 'resolve-library-id', { libraryName: 'react', query: 'hooks' }); return { chars: String(r).length, hasReact: /react/i.test(String(r)) }" },
    }, undefined, { timeout: 180000 })
    assert.equal(run.isError, false, run.content[0].text)
    assert.match(run.content[0].text, /"hasReact": true/)
    assert.match(run.content[0].text, /calling the tools directly/)
    const bad = await client.callTool({ name: 'run_code', arguments: { code: "return require('fs')" } })
    assert.equal(bad.isError, true, 'no require inside run_code')
  } finally {
    await client.close()
  }
})

test('undo puts every client back as it was', () => {
  const r = undo()
  assert.equal(r.ok, true)
  assert.deepEqual(readFile('claude-code'), original['claude-code'])
  assert.deepEqual(readFile('cursor'), original.cursor)
  assert.deepEqual(readFile('vscode'), original.vscode)
  assert.deepEqual(loadServers(), {})
})

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }))
