// The gateway: ONE MCP server that the AI client sees instead of all the others. It offers three tools
// (search_tools, describe_tool, run_code) and talks to every MCP server moved into the panel. The AI loads
// three small definitions instead of dozens, and big tool results stay inside run_code.

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { Runner, setGatewayTokens, safeJson, MAX_RESULT_CHARS } from './runner.mjs'
import { loadServers, loadSettings } from './config.mjs'
import { toolCost } from './mcp.mjs'

export const TOOLS = [
  {
    name: 'search_tools',
    description:
      'Find tools across all MCP servers behind Code Mode. Returns server, tool and a one-line summary. Call with an empty query to list the servers. Use describe_tool for the input schema, then run_code to call them.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Words to look for in tool names and descriptions' }, limit: { type: 'number', description: 'Max results (default 15)' } },
    },
  },
  {
    name: 'describe_tool',
    description: 'Full description and JSON input schema of one tool.',
    inputSchema: { type: 'object', properties: { server: { type: 'string' }, tool: { type: 'string' } }, required: ['server', 'tool'] },
  },
  {
    name: 'run_code',
    description: [
      'Run JavaScript (async; top-level await) that calls MCP tools and returns ONLY what you need. Do several calls, loop, filter and summarize inside the code: intermediate results never enter the conversation.',
      'Available: await mcp.call(server, tool, args) → result (parsed JSON when possible; throws on tool error); mcp.callRaw(...) → raw MCP result; await mcp.search(query); mcp.servers();',
      "await browser.page({ screen: 'mobile'|'tablet'|'desktop' }) → Playwright page on the installed Chrome (closed at the end); await browser.timings() → TTFB/FCP/LCP/CLS;",
      'await blender.run(sceneFile, pythonCode) → what the script prints (Blender in batch mode, if installed); log(...) → extra lines in the answer.',
      `End with return <small value>. The answer is cut at ${MAX_RESULT_CHARS} characters. Returning an MCP image object ({type:'image',data,mimeType}) sends the image.`,
    ].join(' '),
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string', description: 'Body of an async function' }, timeout_seconds: { type: 'number', description: 'Default 120, max 600' } },
      required: ['code'],
    },
  },
]

export async function startGateway() {
  setGatewayTokens(TOOLS.reduce((a, t) => a + toolCost(t), 0))
  const runner = new Runner()
  const servers = Object.keys(loadServers())
  const settings = loadSettings()
  const server = new Server(
    { name: 'code-mode', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions:
        `Code Mode gateway. MCP servers behind it: ${servers.join(', ') || 'none yet (add them in the Code Mode panel)'}. ` +
        'Prefer one run_code that does all the calls and returns a short summary over many small calls. Use search_tools to find tools.' +
        (settings.blenderPath ? ' Blender batch mode is available via blender.run.' : ''),
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params
    try {
      if (name === 'search_tools') return text(await runner.search(String(args.query ?? ''), { limit: Math.min(50, Number(args.limit) || 15) }))
      if (name === 'describe_tool') return text(await runner.describe(String(args.server), String(args.tool)))
      if (name === 'run_code') {
        const timeoutMs = Math.min(600, Math.max(5, Number(args.timeout_seconds) || 120)) * 1000
        const r = await runner.run(String(args.code ?? ''), { timeoutMs, source: 'gateway' })
        const body = r.ok ? safeJson(r.result) : `Error: ${r.error}`
        const extra = [
          r.logs.length ? `\n--- log ---\n${r.logs.join('\n')}` : '',
          `\n--- ${r.calls.length} call(s), ${r.ms} ms; ≈${r.comparison.code.total} tokens here vs ≈${r.comparison.classic.total} with classic MCP ---`,
        ].join('')
        const content = [{ type: 'text', text: clip(body + extra) }, ...(r.images ?? []).map((i) => ({ type: 'image', data: i.data, mimeType: i.mimeType ?? 'image/png' }))]
        return { content, isError: !r.ok }
      }
      return { content: [{ type: 'text', text: `Unknown tool ${name}` }], isError: true }
    } catch (e) {
      return { content: [{ type: 'text', text: `Error: ${String(e?.message ?? e)}` }], isError: true }
    }
  })

  const transport = new StdioServerTransport()
  await server.connect(transport)
  const bye = async () => {
    await runner.close()
    process.exit(0)
  }
  process.stdin.on('close', bye)
  process.on('SIGTERM', bye)
  process.on('SIGINT', bye)
}

const text = (v) => ({ content: [{ type: 'text', text: clip(safeJson(v)) }] })
const clip = (s) => (s.length > MAX_RESULT_CHARS ? `${s.slice(0, MAX_RESULT_CHARS)}\n… (cut at ${MAX_RESULT_CHARS} characters: return less from run_code)` : s)
