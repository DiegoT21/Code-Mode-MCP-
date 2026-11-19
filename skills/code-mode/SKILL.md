---
name: code-mode
description: How to use the Code Mode MCP gateway (tools search_tools, describe_tool, run_code) and how to install new MCP servers or skills through it. Use whenever a task needs an MCP tool, a browser check, Blender batch work, or when the user asks to install, add or remove an MCP server or a skill.
---

# Code Mode MCP

The user's MCP servers live behind ONE gateway server called `code-mode`. Its three tools:

- `search_tools(query)` — find tools across all servers (empty query lists the servers).
- `describe_tool(server, tool)` — input schema of one tool.
- `run_code(code)` — JavaScript that calls the tools and returns only what matters.

## Work in code, return little

1. `search_tools` with a few words of what you need; `describe_tool` for the arguments.
2. ONE `run_code` that does every call, loops, filters and summarizes. Return a small object, not the raw
   results: intermediate data never enters the conversation, and that is where the savings come from.

```js
const issues = await mcp.call('github', 'list_issues', { repo: 'owner/name', state: 'open' })
return issues.filter((i) => i.labels.some((l) => l.name === 'bug')).map((i) => `#${i.number} ${i.title}`).slice(0, 20)
```

Also inside `run_code`: `await browser.page({ screen: 'mobile' })` (Playwright page on the installed Chrome,
closed at the end), `await browser.timings()`, `await blender.run(sceneFile, pythonCode)` (Blender in batch
mode, if installed) and `log(...)`. Returning an MCP image object (`{type:'image', data, mimeType}`) sends
the image, for when you really need to look.

When you need to look and decide step by step (a visual check, an interactive session), several small
`run_code` calls are fine. Never dump whole pages, files or tool outputs back.

## Installing MCP servers and skills

Everything goes through the panel's command line (never edit the AI clients' config files by hand):

```bash
code-mode-mcp add <name> --config '{"command":"npx","args":["-y","<package>"]}'   # tests it first
code-mode-mcp add <name> --config '{"type":"http","url":"https://…/mcp"}'
code-mode-mcp remove <name>
code-mode-mcp skill-add <folder-or-SKILL.md>      # Claude Code skills
code-mode-mcp list                                # what is in the panel and its token cost
```

If the command is not on the PATH, use `node <app folder>/bin/code-mode-mcp.mjs` (the folder is in the
gateway's command in the AI client config). API keys never go in `--config` or in the chat: use
`--env NAME` and let the user put the value in `~/.code-mode-mcp/servers.json`. New servers are available
to `run_code` right away; no restart needed. Plugins and connectors of claude.ai are added in claude.ai, not here.
