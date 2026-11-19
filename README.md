<p align="center">
  <img src="public/logo.svg" alt="" width="84" height="84">
</p>

<h1 align="center">Code Mode MCP</h1>

<p align="center">
  <b>One MCP for all your MCPs.</b><br>
  Your AI loads 3 small tools instead of dozens, calls the rest through code,<br>
  and only the answer comes back — big tool results never flood the chat.
</p>

<p align="center">
  <code>npx github:DiegoT21/Code-Mode-MCP-</code>
</p>

<p align="center">
  <a href="https://github.com/DiegoT21/Code-Mode-MCP-/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/DiegoT21/Code-Mode-MCP-?color=2f6f5e"></a>
  <a href="https://github.com/DiegoT21/Code-Mode-MCP-/actions/workflows/test.yml"><img alt="Tests" src="https://github.com/DiegoT21/Code-Mode-MCP-/actions/workflows/test.yml/badge.svg"></a>
  <img alt="Node 20+" src="https://img.shields.io/badge/node-20%2B-2f6f5e">
  <img alt="Windows · macOS · Linux" src="https://img.shields.io/badge/Windows%20%C2%B7%20macOS%20%C2%B7%20Linux-supported-2f6f5e">
  <a href="LICENSE"><img alt="MIT" src="https://img.shields.io/badge/license-MIT-2f6f5e"></a>
</p>

<p align="center">
  <b>Works with</b> Claude Code · Claude Desktop · Cursor · VS Code · Windsurf · Gemini CLI
  <br>
  <a href="README.es.md">Leer en español</a>
</p>

---

## Two ways MCP wastes tokens

1. **Definitions.** Many AI apps (Cursor, VS Code, Claude Desktop…) send **every tool definition** of every
   server into the context, on every conversation. Ten servers can mean 100+ tools and tens of thousands of
   tokens before you type a word. *(Claude Code already loads definitions lazily, so there this part is small.)*
2. **Results — in every app.** Each tool result lands in the chat **in full**: a whole web page, a long
   document, a giant JSON — even when the AI only needed one number. And it is re-read on every answer after that.

That is slower, more expensive, and leaves less room for the AI to think.

## Code Mode fixes it with one button

**Code Mode MCP** puts all your MCP servers behind a single gateway with three tiny tools. Your AI
searches for the tool it needs, writes a few lines of code that call it, and **only the answer comes back**.
Intermediate data stays on your computer.

```
npx github:DiegoT21/Code-Mode-MCP-
```

That opens a local panel. Press **Setup → Move into Code Mode**. It finds the MCP config of every AI app
on your computer, moves the servers into the panel, and leaves each app with one server: the gateway.
Backed up, and undoable with one click.

<p align="center"><img src="docs/screenshots/setup.png" alt="Setup: one button moves every MCP server into Code Mode" width="88%"></p>

## Measured, not promised

Same task, same servers (context7, memory, everything, sequential-thinking), counted three ways:
**all definitions** = an app that loads every definition (Cursor, VS Code, Claude Desktop…);
**deferred** = an app that loads only tool names and fetches a definition when used (Claude Code);
**Code Mode** = the gateway's 3 tools + the code + what it returns. Tokens ≈ 3.5 characters each.

| Task | All definitions | Deferred (Claude Code) | Code Mode |
|---|---:|---:|---:|
| Look up docs, keep only the relevant lines (2 calls) | ≈ 8,049 | ≈ 3,273 | **≈ 2,272** (−72% / −31%) |
| Read a large graph + docs, return a summary (2 calls) | ≈ 8,373 | ≈ 3,069 | **≈ 1,601** (−81% / −48%) |
| Check a web page (vs a browser MCP that returns the page snapshot)¹ | ≈ 7,000 | ≈ 3,400 | **≈ 210** (−97% / −94%) |
| Four calls with tiny results | ≈ 6,772 | ≈ 1,149 | ≈ 1,154 (−83% / **0%**) |

¹ Approximate: a typical page snapshot weighs ≈ 3,000 tokens per step.

**Honest summary:** in apps that load every definition, Code Mode saves a lot almost always. In Claude Code the
saving comes from **results**: big outputs (pages, documents, long lists) shrink a lot; tiny results don't change.
The panel measures every run both ways, and the **Usage** tab compares your real daily usage before and after you
set it up.

## How it works

<p align="center"><img src="docs/screenshots/how-it-works.png" alt="Classic MCP vs code mode" width="88%"></p>

The gateway gives your AI three tools:

| Tool | |
|---|---|
| `search_tools(query)` | Find tools across every server behind the gateway |
| `describe_tool(server, tool)` | See one tool's parameters |
| `run_code(code)` | Run JavaScript that calls the tools and returns only what matters |

```js
// What your AI writes inside run_code
const issues = await mcp.call('github', 'list_issues', { repo: 'acme/web', state: 'open' })
return issues
  .filter((i) => i.labels.some((l) => l.name === 'bug'))
  .map((i) => `#${i.number} ${i.title}`)
  .slice(0, 10)          // ← only these 10 lines reach the conversation
```

Also built in, no extra MCP needed:

- **Browser in code** — `browser.page({ screen: 'mobile' })` drives your installed Chrome with Playwright and
  `browser.timings()` gives TTFB / FCP / LCP / CLS. Replaces a browser MCP that would dump the page tree into the chat.
- **Blender in batch** — `blender.run(scene, python)` runs Python in Blender without opening it (if installed).
- **Images when they matter** — return an MCP image object and the AI gets the picture.

## A panel to see where your tokens go

<table>
<tr>
<td width="50%"><img src="docs/screenshots/inventory-tools.png" alt="Inventory: every tool with its parameters and token weight"></td>
<td width="50%"><img src="docs/screenshots/usage.png" alt="Usage: real Claude Code token usage per day, project and tool"></td>
</tr>
<tr>
<td><b>Inventory</b> — every server and tool, its parameters and how many tokens it would cost loaded directly.</td>
<td><b>Usage</b> — real Claude Code usage from its local logs: cost per day and project, cache savings, and which tools flood your context.</td>
</tr>
<tr>
<td><img src="docs/screenshots/sandbox.png" alt="Sandbox: run code mode and compare tokens"></td>
<td><img src="docs/screenshots/history.png" alt="History of every run"></td>
</tr>
<tr>
<td><b>Sandbox</b> — run exactly what your AI runs and compare it with classic MCP.</td>
<td><b>History</b> — every <code>run_code</code> from your AI, with duration, result, errors and tokens saved.</td>
</tr>
</table>

English and Spanish, light and dark mode, and it fits the window without scrolling.

## Quick start

```bash
npx github:DiegoT21/Code-Mode-MCP-
```

1. The panel opens at http://localhost:4777.
2. **Setup** shows the AI apps and MCP servers it found. Untick any server you want to keep direct.
3. Press the button, then restart your AI apps (or open a new session).
4. Ask your AI anything that uses your tools. Watch the savings in **History**.

Changed your mind? **Setup → Undo everything** puts every server back where it was.

<details>
<summary><b>Command line</b></summary>

| Command | |
|---|---|
| `code-mode-mcp` | Open the panel (`--app` for its own window) |
| `shortcut` · `shortcut --remove` | Desktop and Start menu shortcut that opens it as an app (Windows) |
| `setup` · `setup --apply` · `setup --undo` | The Setup button, from the terminal |
| `add <name> --config '<json>' [--env NAME]` | Test a server and add it behind the gateway. Keys come from your terminal with `--env`, never from the command line |
| `remove <name>` | Remove a server (backup kept) |
| `list` | Servers, tools and token weight |
| `skill-add <folder>` · `skill-remove <name>` | Claude Code skills |
| `run <file.js>` | Run code like `run_code` |
| `check <url> [--screen mobile]` | Quick page check with your Chrome |
| `usage [--days 7]` | Claude Code token usage |
| `gateway` | The MCP server itself (what your AI apps start) |

Use them as `npx github:DiegoT21/Code-Mode-MCP- <command>`, or install once with
`npm i -g github:DiegoT21/Code-Mode-MCP-`.
</details>

<details>
<summary><b>Desktop app</b></summary>

**No installer (recommended on Windows):** press **Setup → Create shortcut**, or run
`npx github:DiegoT21/Code-Mode-MCP- shortcut`. You get a *Code Mode MCP* shortcut on the desktop and in the Start
menu that opens the panel in its own window (Edge/Chrome app mode, no console) and stops it when you close the
window. On any system, `code-mode-mcp --app` opens that window.

**Installers** for Windows, macOS and Linux are on the [Releases](https://github.com/DiegoT21/Code-Mode-MCP-/releases/latest)
page. Same panel, in its own window; it still needs Node.js 20+. They are not code-signed, so Windows Smart App
Control or macOS Gatekeeper may block or warn. `npx` does exactly the same without an installer.
</details>

## Remote servers with sign-in

Remote MCP servers that ask you to sign in (OAuth) work behind the gateway. After Setup or `add`, open
**Inventory → the server → Sign in**: your browser opens the server's login page and comes back to the panel.
The session is kept in `~/.code-mode-mcp/oauth/` and the gateway renews it by itself. This needs servers that
follow the MCP sign-in standard (dynamic client registration); servers that require a pre-registered app must
stay direct.

## FAQ

**Does my AI get worse at using tools?**
No: it gets the same tools, found on demand. Models are very good at writing short code, and doing several
calls in one script is often more reliable than many separate tool calls.

**Is it safe?**
Everything runs locally. The panel only listens on `127.0.0.1`, rejects requests not addressed to `localhost`
(so a website cannot reach it through DNS rebinding) and refuses changes coming from other pages. Every config
file is backed up before it is touched and only its MCP section changes. Keys stay in
`~/.code-mode-mcp/servers.json` in your user folder and are never shown. `run_code` is **not** a security
sandbox: it is handed only `mcp`, `browser`, `blender` and `log`, but determined code can get out of that
context. Treat it like your AI's own terminal — it runs with your user's permissions.

**When should a server stay direct?**
When the AI must look and decide step by step in real time (a live 3D scene, an interactive browser session).
Untick it in Setup.

**What about claude.ai connectors (Gmail, Drive…)?**
They live in your claude.ai account and cannot be moved to a local gateway.

**How accurate are the numbers?**
Token counts are estimates (≈ 3.5 characters per token) — good for comparing, not for billing. The Usage
cost comes from Claude Code's own logs.

## Credits and prior art

The idea is not ours: **code mode** was described by [Cloudflare](https://blog.cloudflare.com/code-mode/) and by
Anthropic in [Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp), and MCP
gateways and proxies already exist. What this project adds is the packaging: one-click setup across six AI apps
with backups and undo, a local panel to see where your tokens go, browser and Blender helpers, and English and
Spanish docs.

## Limits

- Remote MCP servers that require signing in (OAuth): see *Remote servers with sign-in* below.
- Token counts are estimates. Usage cost comes from Claude Code's own logs and only covers Claude Code.
- The AI has to write a little code. Current models do it well, but sometimes still prefer direct calls.

## Requirements

Node.js 20+ · Google Chrome or Microsoft Edge (for the browser tools) · Blender (optional)

## Uninstall

**Setup → Undo everything** (or `npx github:DiegoT21/Code-Mode-MCP- setup --undo`), then delete `~/.code-mode-mcp`.

## Contributing

Issues and pull requests are welcome — especially support for more AI apps.

```bash
git clone https://github.com/DiegoT21/Code-Mode-MCP-.git && cd Code-Mode-MCP-
npm install
npm test     # Setup, gateway and Undo against fake configs
npm start    # the panel
```

If Code Mode saves you tokens, a ⭐ helps other people find it.

MIT License
