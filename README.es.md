# Code Mode MCP

**Un MCP para todos tus MCP.** Un panel local con una puerta que pone todos los servidores MCP de tu IA
detrás de un solo servidor con tres herramientas. Tu IA deja de cargar decenas de definiciones y de recibir
resultados enormes: escribe un poco de código que llama a las herramientas y solo le vuelve lo que necesita.

[Read in English](README.md)

```
npx github:DiegoT21/Code-Mode-MCP-
```

Eso abre el panel en http://localhost:4777. Pulsa **Setup → Pasar a Code Mode**. Listo.

---

## Por qué

Cada servidor MCP que conectas cuesta tokens dos veces:

1. **Definiciones.** El nombre, la descripción y los parámetros de cada herramienta viven en el contexto de
   la IA. Un servidor con 26 herramientas bien documentadas puede pesar 6.000 tokens antes de que preguntes nada.
2. **Resultados.** Con MCP clásico cada resultado entra completo a la conversación: una página web, un
   documento, una lista larga… aunque la IA solo necesitara un número.

El **modo código** arregla las dos cosas. La IA ve una puerta chica (`search_tools`, `describe_tool`,
`run_code`), busca la herramienta que necesita y corre un código corto que la llama, filtra y devuelve una
respuesta pequeña. Los datos intermedios se quedan en tu computadora. En nuestras pruebas: 36% menos tokens
al buscar documentación, 94% al consultar una escena 3D y 97% al revisar una página web.

## Qué hace el botón de Setup

1. Busca la configuración de MCP de las apps de IA de tu computadora: **Claude Code, Claude Desktop, Cursor,
   VS Code, Windsurf, Gemini CLI**. Muestra cada servidor (nunca los valores de claves o tokens).
2. Eliges qué servidores pasar (todos, por defecto). Un clic:
   - respalda cada archivo de configuración en `~/.code-mode-mcp/backups`,
   - pasa los servidores al panel (`~/.code-mode-mcp/servers.json`),
   - deja a cada app con un solo servidor, `code-mode` (la puerta). Nada más del archivo cambia.
   - opcional: instala el skill `code-mode` en Claude Code, que le enseña a trabajar con código.
3. Reinicia tus apps de IA. **Deshacer todo** devuelve cada servidor a donde estaba.

¿Quieres que un servidor siga directo (para trabajo muy interactivo, como una escena 3D en vivo)? Desmárcalo.

## Las tres herramientas de la puerta

| Herramienta | Qué hace |
|---|---|
| `search_tools(query)` | Busca herramientas en todos los servidores detrás de la puerta. Sin texto, lista los servidores. |
| `describe_tool(server, tool)` | Descripción completa y esquema de parámetros de una herramienta. |
| `run_code(code)` | Corre JavaScript (con `await`) y devuelve solo lo que el código devuelve. |

Dentro de `run_code`:

```js
// llamar cualquier herramienta de cualquier servidor
const issues = await mcp.call('github', 'list_issues', { repo: 'dueño/repo', state: 'open' })
return issues.filter((i) => i.labels.some((l) => l.name === 'bug')).map((i) => i.title).slice(0, 10)
```

- `mcp.call(servidor, herramienta, args)`, `mcp.callRaw(...)`, `mcp.search(texto)`, `mcp.servers()`
- `browser.page({ screen: 'mobile' | 'tablet' | 'desktop' })` → una página de Playwright en tu Chrome (o
  Edge) instalado, que se cierra al final; `browser.timings()` → TTFB, FCP, LCP, CLS, peso. **Reemplaza a un MCP de navegador.**
- `blender.run(escena, codigoPython)` → corre Python en Blender sin abrirlo (opcional, si Blender está instalado)
- `log(...)` → líneas extra en la respuesta
- Devuelve un objeto de imagen MCP (`{ type: 'image', data, mimeType }`) cuando la IA de verdad necesita ver algo.

## El panel

| Pestaña | |
|---|---|
| **Setup** | El botón de arriba, la ruta de Blender y Deshacer. |
| **Inventario** | Servidores detrás de la puerta con cada herramienta, sus parámetros y su peso en tokens; servidores que siguen directos en cada app; skills de Claude Code; registro de cambios. |
| **Consumo** | Consumo real de tokens de Claude Code en esta computadora (de sus registros locales): costo equivalente, ahorro por caché, por día, por proyecto, qué herramientas metieron más tokens al contexto. |
| **Sandbox** | Corre exactamente lo que corre `run_code` y compara sus tokens con MCP clásico. |
| **Historial** | Cada `run_code` (de tu IA o del sandbox) con duración, resultado, errores y tokens. |
| **Cómo funciona** | Explicaciones cortas, en español e inglés. |

## Línea de comandos

```bash
npx github:DiegoT21/Code-Mode-MCP- <comando>     # o: npm i -g github:DiegoT21/Code-Mode-MCP-  y luego  code-mode-mcp <comando>
```

| Comando | |
|---|---|
| *(ninguno)* | Abre el panel |
| `setup` / `setup --apply` / `setup --undo` | Lo mismo que el botón de Setup, desde la terminal |
| `add <nombre> --config '<json>' [--env NOMBRE]` | Prueba un servidor y lo agrega detrás de la puerta. Claves: `--env NOMBRE` toma el valor de tu terminal; nunca van en `--config`. |
| `remove <nombre>` | Quita un servidor (queda un respaldo) |
| `list` | Servidores detrás de la puerta, herramientas y peso en tokens |
| `skill-add <carpeta>` / `skill-remove <nombre>` | Skills de Claude Code |
| `run <archivo.js>` | Corre código como `run_code` e imprime el resultado |
| `check <url> [--screen mobile]` | Revisión rápida de una página con el Chrome instalado |
| `usage [--days 7]` | Consumo de tokens de Claude Code |
| `gateway` | El servidor MCP en sí (es lo que arrancan tus apps de IA) |

## App de escritorio

Opcional. GitHub Actions compila instaladores para Windows, macOS y Linux y los pone en
[Releases](https://github.com/DiegoT21/Code-Mode-MCP-/releases). Es el mismo panel en su propia ventana;
igual necesita Node.js. Los instaladores **no tienen firma digital**: Smart App Control de Windows puede
bloquearlos y macOS va a advertir. Si pasa, usa `npx`: hace lo mismo.

## Requisitos

- Node.js 20 o más nuevo
- Google Chrome o Microsoft Edge (para las herramientas de navegador)
- Blender (opcional)

## Seguridad y privacidad

- Todo corre en tu computadora. El panel solo escucha en `127.0.0.1` y rechaza cambios que vengan de otras páginas web.
- Setup respalda cada archivo de configuración antes de tocarlo y solo cambia su parte de MCP. Deshacer lo devuelve.
- Las claves y tokens de tus servidores quedan en `~/.code-mode-mcp/servers.json` (solo tu usuario puede leerlo)
  y nunca se muestran en el panel.
- `run_code` corre en un contexto de JavaScript aparte, sin `require`, `process` ni acceso a archivos, pero
  **no es una caja fuerte**: puede llamar cualquier herramienta de tus servidores, como ya podía tu IA.
- La pestaña Consumo lee los registros locales de Claude Code y guarda solo números, nunca el texto de tus conversaciones.

## Desinstalar

Pulsa **Deshacer todo** en Setup (o `npx github:DiegoT21/Code-Mode-MCP- setup --undo`) y borra `~/.code-mode-mcp`.

## Límites

- Los tokens son estimados (≈ 3,5 caracteres por token): sirven para comparar. El costo de Consumo viene de Claude Code.
- Consumo solo cubre Claude Code; las demás apps no guardan registros locales de tokens.
- Los conectores de claude.ai (Gmail, Drive…) viven en tu cuenta de claude.ai y no se pueden pasar aquí.

## Desarrollo

```bash
git clone https://github.com/DiegoT21/Code-Mode-MCP-.git && cd Code-Mode-MCP-
npm install
npm test            # setup, puerta y deshacer contra configuraciones falsas (necesita internet para npx)
npm start           # el panel
cd escritorio && npm install && npm run dev   # app de escritorio (necesita Rust)
```

Licencia MIT.
