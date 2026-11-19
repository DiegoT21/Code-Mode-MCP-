# Code Mode MCP

**One MCP for all your MCPs.** A local panel + gateway that moves every MCP server your AI uses behind a
single server with three tools. Your AI stops loading dozens of tool definitions and stops receiving huge
tool results: it writes a little code that calls the tools and gets back only what it needs.

[Leer en español](README.es.md)

```
npx github:DiegoT21/Code-Mode-MCP-
```

That opens the panel at http://localhost:4777. Press **Setup → Move into Code Mode**. Done.

---

## Why

Every MCP server you connect costs tokens twice:

1. **Definitions.** The name, description and parameters of every tool sit in the AI's context. A server
   with 26 well-documented tools can weigh 6,000 tokens before you ask anything.
2. **Results.** With classic MCP every result enters the conversation in full: a web page, a document, a
   long list — even when the AI only needed one number.

**Code mode** fixes both. The AI sees one small gateway (`search_tools`, `describe_tool`, `run_code`), finds the
tool it needs, and runs a short script that calls it, filters and returns a small answer. Intermediate data
stays on your computer. In our tests: 36% fewer tokens on a docs lookup, 94% on a 3D scene query, 97% on a
web page check.

## What the Setup button does

1. Finds the MCP config of the AI apps on your computer: **Claude Code, Claude Desktop, Cursor, VS Code,
   Windsurf, Gemini CLI**. Shows each server (never the values of keys or tokens).
2. You pick which servers to move (all by default). One click:
   - backs up every config file to `~/.code-mode-mcp/backups`,
   - moves the servers into the panel (`~/.code-mode-mcp/servers.json`),
   - leaves each app with one server, `code-mode` (the gateway). Nothing else in the file changes.
   - optionally installs the `code-mode` skill in Claude Code, which teaches it to work in code.
3. Restart your AI apps. **Undo everything** puts all the servers back where they were.

Want a server to stay direct (for very interactive work, like a live 3D scene)? Untick it.

## The gateway's three tools

| Tool | What it does |
|---|---|
| `search_tools(query)` | Finds tools across every server behind the gateway. Empty query lists the servers. |
| `describe_tool(server, tool)` | Full description and input schema of one tool. |
| `run_code(code)` | Runs JavaScript (top-level `await`) and returns only what the code returns. |

Inside `run_code`:

```js
// call any tool of any server
const issues = await mcp.call('github', 'list_issues', { repo: 'owner/name', state: 'open' })
return issues.filter((i) => i.labels.some((l) => l.name === 'bug')).map((i) => i.title).slice(0, 10)
```

- `mcp.call(server, tool, args)`, `mcp.callRaw(...)`, `mcp.search(query)`, `mcp.servers()`
- `browser.page({ screen: 'mobile' | 'tablet' | 'desktop' })` → a Playwright page on your installed Chrome
  (or Edge), closed at the end; `browser.timings()` → TTFB, FCP, LCP, CLS, weight. **Replaces a browser MCP.**
- `blender.run(sceneFile, pythonCode)` → runs Python in Blender without opening it (optional, if Blender is installed)
- `log(...)` → extra lines in the answer
- Return an MCP image object (`{ type: 'image', data, mimeType }`) when the AI really needs to see something.

## The panel

| Tab | |
|---|---|
| **Setup** | The one button above, Blender path, Undo. |
| **Inventory** | Servers behind the gateway with every tool, its parameters and its token weight; servers still direct in each app; Claude Code skills; change log. |
| **Usage** | Real token usage of Claude Code on this computer (from its local logs): equivalent cost, cache savings, per day, per project, which tools put the most tokens in the context. |
| **Sandbox** | Run exactly what `run_code` runs, and compare its tokens with classic MCP. |
| **History** | Every `run_code` (from your AI or the sandbox) with duration, result, errors and tokens. |
| **How it works** | Short explanations, in English and Spanish. |

## Command line

```bash
npx github:DiegoT21/Code-Mode-MCP- <command>     # or: npm i -g github:DiegoT21/Code-Mode-MCP-  then  code-mode-mcp <command>
```

| Command | |
|---|---|
| *(none)* | Open the panel |
| `setup` / `setup --apply` / `setup --undo` | Same as the Setup button, from the terminal |
| `add <name> --config '<json>' [--env NAME]` | Test a server and add it behind the gateway. Keys: `--env NAME` takes the value from your terminal; never put them in `--config`. |
| `remove <name>` | Remove a server (backup kept) |
| `list` | Servers behind the gateway, tools and token weight |
| `skill-add <folder>` / `skill-remove <name>` | Claude Code skills |
| `run <file.js>` | Run code like `run_code` and print the result |
| `check <url> [--screen mobile]` | Quick page check with the installed Chrome |
| `usage [--days 7]` | Claude Code token usage |
| `gateway` | The MCP server itself (this is what your AI apps start) |

## Desktop app

Optional. Installers for Windows, macOS and Linux are built by GitHub Actions and attached to
[Releases](https://github.com/DiegoT21/Code-Mode-MCP-/releases). It is the same panel in its own window; it
still needs Node.js. The installers are **not code-signed**: Windows Smart App Control can block them and
macOS will warn. If that happens, use `npx` — it does the same thing.

## Requirements

- Node.js 20 or newer
- Google Chrome or Microsoft Edge (for the browser tools)
- Blender (optional)

## Safety and privacy

- Everything runs on your computer. The panel listens on `127.0.0.1` only and refuses changes from other websites.
- Setup backs up each config file before touching it and only changes its MCP section. Undo restores it.
- Keys and tokens of your servers are kept in `~/.code-mode-mcp/servers.json` (readable only by your user)
  and never shown in the panel.
- `run_code` runs in a separate JavaScript context without `require`, `process` or file access, but it is
  **not a security sandbox**: it can call any tool of your servers, like your AI already could.
- The Usage tab reads Claude Code's local logs and stores only numbers, never the text of your conversations.

## Uninstall

Press **Undo everything** in Setup (or `npx github:DiegoT21/Code-Mode-MCP- setup --undo`), then delete
`~/.code-mode-mcp`.

## Limits

- Token numbers are estimates (≈ 3.5 characters per token), good for comparing. Usage cost comes from Claude Code.
- Usage only covers Claude Code; the other apps do not keep local token logs.
- Connectors of claude.ai (Gmail, Drive…) live in your claude.ai account and cannot be moved here.

## Development

```bash
git clone https://github.com/DiegoT21/Code-Mode-MCP-.git && cd Code-Mode-MCP-
npm install
npm test            # setup, gateway and undo against fake configs (needs network for npx)
npm start           # the panel
cd escritorio && npm install && npm run dev   # desktop app (needs Rust)
```

MIT License.
