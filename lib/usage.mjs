// Real token usage, read from the logs Claude Code keeps on this computer:
// ~/.claude/projects/<project>/<session>.jsonl (and their subagents). Read-only.
//
// Each file is reduced to a small summary (messages with their token usage, tool calls with the size of
// their result, and the cost Claude Code computed) cached in ~/.code-mode-mcp/cache/usage.json, so only
// changed files are read again. The text of the conversations is never stored or shown.

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import os from 'node:os'
import { PATHS } from './config.mjs'
import { tokens } from './tokens.mjs'

const DIR = process.env.CODE_MODE_CLAUDE_PROJECTS ?? path.join(os.homedir(), '.claude', 'projects')
const CACHE = path.join(PATHS.cache, 'usage.json')
const VERSION = 2
const ZONA = Intl.DateTimeFormat().resolvedOptions().timeZone

const dia = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: ZONA })

function archivos(dir = DIR, salida = []) {
  let entradas = []
  try {
    entradas = fs.readdirSync(dir, { withFileTypes: true })
  } catch {}
  for (const e of entradas) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) archivos(p, salida)
    else if (e.name.endsWith('.jsonl')) salida.push(p)
  }
  return salida
}

function textoResultado(c) {
  if (typeof c === 'string') return { texto: c, imagenes: 0 }
  let texto = ''
  let imagenes = 0
  for (const x of c ?? []) {
    if (x.type === 'text') texto += x.text ?? ''
    else if (x.type === 'image') imagenes++
  }
  return { texto, imagenes }
}

// Lee un .jsonl y devuelve su resumen
async function resumir(archivo) {
  const mensajes = new Map() // id → { d, m, i, cw, cr, o } (la última línea de cada id trae el uso final)
  const usos = new Map() // tool_use_id → nombre
  const llamadas = [] // { id, n, t, d }
  let costo = null
  let cwd = null
  let inicio = null

  const rl = readline.createInterface({ input: fs.createReadStream(archivo, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const l of rl) {
    const esAsistente = l.includes('"type":"assistant"')
    const esUsuario = !esAsistente && l.includes('"type":"user"') && l.includes('"tool_result"')
    const esCosto = !esAsistente && !esUsuario && l.includes('"type":"cost-state"')
    if (!esAsistente && !esUsuario && !esCosto) continue
    let o
    try {
      o = JSON.parse(l)
    } catch {
      continue
    }
    if (o.type === 'cost-state') {
      costo = { usd: o.totalCostUSD ?? 0, modelos: o.modelUsage ?? {} }
      continue
    }
    cwd ??= o.cwd
    if (o.timestamp) inicio ??= o.timestamp
    if (o.type === 'assistant' && o.message) {
      const u = o.message.usage
      if (u && o.message.id && o.message.model !== '<synthetic>') {
        mensajes.set(o.message.id, {
          d: dia(o.timestamp),
          m: o.message.model,
          i: u.input_tokens ?? 0,
          cw: u.cache_creation_input_tokens ?? 0,
          cr: u.cache_read_input_tokens ?? 0,
          o: u.output_tokens ?? 0,
        })
      }
      for (const c of o.message.content ?? []) if (c.type === 'tool_use') usos.set(c.id, c.name)
    } else if (o.type === 'user' && Array.isArray(o.message?.content)) {
      for (const c of o.message.content) {
        if (c.type !== 'tool_result') continue
        const { texto, imagenes } = textoResultado(c.content)
        // Una imagen cuesta del orden de ~1.500 tokens; se cuenta así para no ignorarla
        llamadas.push({ id: c.tool_use_id, t: tokens(texto) + imagenes * 1500, d: dia(o.timestamp) })
      }
    }
  }
  for (const ll of llamadas) ll.n = usos.get(ll.id) ?? 'desconocida'
  return {
    proyecto: cwd ?? path.basename(path.dirname(archivo)),
    subagente: archivo.includes(`${path.sep}subagents${path.sep}`),
    inicio,
    costo,
    mensajes: [...mensajes].map(([id, v]) => ({ id, ...v })),
    llamadas,
  }
}

let enCurso = null

// Pone al día el caché (solo relee lo que cambió) y devuelve los resúmenes de todos los archivos
export function actualizar() {
  enCurso ??= (async () => {
    let cache = {}
    try {
      const c = JSON.parse(fs.readFileSync(CACHE, 'utf8'))
      if (c.version === VERSION) cache = c.archivos
    } catch {}
    const nuevo = {}
    let leidos = 0
    for (const a of archivos()) {
      let st
      try {
        st = fs.statSync(a)
      } catch {
        continue
      }
      const previo = cache[a]
      if (previo && previo.mtime === st.mtimeMs && previo.tam === st.size) {
        nuevo[a] = previo
        continue
      }
      try {
        nuevo[a] = { mtime: st.mtimeMs, tam: st.size, ...(await resumir(a)) }
        leidos++
      } catch {}
    }
    fs.mkdirSync(path.dirname(CACHE), { recursive: true })
    fs.writeFileSync(CACHE, JSON.stringify({ version: VERSION, archivos: nuevo }))
    return { archivos: nuevo, leidos }
  })().finally(() => (enCurso = null))
  return enCurso
}

// Pesos relativos de precio de la API (entrada = 1): escribir en caché por 1 h = 2, leer de caché = 0,1,
// salida = 5. Sirven para repartir el costo de cada sesión por día y para estimar lo que ahorró la caché.
const PESO = { i: 1, cw: 2, cr: 0.1, o: 5 }
const peso = (m) => m.i * PESO.i + m.cw * PESO.cw + m.cr * PESO.cr + m.o * PESO.o

const nombreProyecto = (p) => {
  if (/scratch|Claude-Data|[\\/]Temp[\\/]/i.test(p)) return 'Chats (no folder)'
  const partes = p.split(/[\\/]/).filter(Boolean)
  return partes.slice(-2).join('/')
}

function grupoHerramienta(n) {
  const m = n.match(/^mcp__(.+?)__/)
  if (!m) return 'Claude Code (built-in)'
  const s = m[1]
  if (s.startsWith('plugin_')) return `Plugin: ${s.replace(/^plugin_/, '').replace(/_/g, ' · ')}`
  if (/^[0-9a-f]{8}-/.test(s)) return 'claude.ai connector'
  if (s.startsWith('ccd_') || s === 'Claude_Browser' || s === 'terminal' || s === 'visualize') return 'Claude desktop app'
  if (s === 'code-mode') return 'Code Mode gateway'
  return `MCP: ${s}`
}

// Arma el resumen para la página. `dias`: 7, 30 o 0 (todo).
export async function usage({ days: dias = 30, history: historial = [], since = null } = {}) {
  const { archivos: todos, leidos } = await actualizar()
  const hoy = dia(Date.now())
  const desde = dias ? dia(Date.now() - (dias - 1) * 86400000) : '0000-00-00'
  const enRango = (d) => d >= desde && d <= hoy

  // Cada mensaje cuenta una sola vez aunque una sesión retomada o bifurcada lo repita en otro archivo
  const vistos = new Set()
  const llamadasVistas = new Set()
  const tot = { i: 0, cw: 0, cr: 0, o: 0, mensajes: 0, costo: 0, sesiones: 0 }
  const porDia = {}
  const porProyecto = {}
  const porModelo = {}
  const herr = {}
  let costoTotalConocido = 0
  let pesoTotalConocido = 0

  for (const r of Object.values(todos)) {
    const propios = r.mensajes.filter((m) => !vistos.has(m.id))
    for (const m of propios) vistos.add(m.id)
    // Costo de la sesión (Claude Code) repartido por día según el peso de cada mensaje
    const pesoSesion = r.mensajes.reduce((s, m) => s + peso(m), 0)
    const usdPorPeso = r.costo?.usd && pesoSesion ? r.costo.usd / pesoSesion : null
    if (usdPorPeso) {
      costoTotalConocido += r.costo.usd
      pesoTotalConocido += pesoSesion
    }
    let tocaRango = false
    for (const m of propios) {
      if (!enRango(m.d)) continue
      tocaRango = true
      const usd = usdPorPeso ? peso(m) * usdPorPeso : null
      tot.i += m.i
      tot.cw += m.cw
      tot.cr += m.cr
      tot.o += m.o
      tot.mensajes++
      const pd = (porDia[m.d] ??= { costo: 0, tokens: 0, sinCosto: 0, respuestas: 0, herr: 0 })
      pd.tokens += m.i + m.cw + m.cr + m.o
      pd.respuestas++
      const proy = nombreProyecto(r.proyecto)
      const pp = (porProyecto[proy] ??= { costo: 0, tokens: 0, sesiones: new Set() })
      pp.tokens += m.i + m.cw + m.cr + m.o
      pp.sesiones.add(r.subagente ? 'sub' : r.inicio)
      const pm = (porModelo[m.m] ??= { tokens: 0, salida: 0 })
      pm.tokens += m.i + m.cw + m.cr + m.o
      pm.salida += m.o
      if (usd != null) {
        tot.costo += usd
        pd.costo += usd
        pp.costo += usd
      } else pd.sinCosto += peso(m)
    }
    if (tocaRango && !r.subagente) tot.sesiones++
    for (const ll of r.llamadas) {
      if (llamadasVistas.has(ll.id) || !enRango(ll.d)) continue
      llamadasVistas.add(ll.id)
      const h = (herr[ll.n] ??= { nombre: ll.n, grupo: grupoHerramienta(ll.n), llamadas: 0, tokens: 0 })
      h.llamadas++
      h.tokens += ll.t
      ;(porDia[ll.d] ??= { costo: 0, tokens: 0, sinCosto: 0, respuestas: 0, herr: 0 }).herr += ll.t
    }
  }

  // Precio por "peso" promedio, para estimar costo de mensajes sin costo anotado y el ahorro por caché
  const usdPorPesoProm = pesoTotalConocido ? costoTotalConocido / pesoTotalConocido : 0
  const sinCosto = Object.values(porDia).reduce((s, d) => s + d.sinCosto, 0)
  for (const d of Object.values(porDia)) d.costo += d.sinCosto * usdPorPesoProm
  tot.costo += sinCosto * usdPorPesoProm
  // Si lo leído de la caché se hubiera pagado como entrada normal (peso 1 en vez de 0,1)
  const ahorroCacheUsd = tot.cr * (PESO.i - PESO.cr) * usdPorPesoProm

  const listaDias = []
  const n = dias || Math.min(90, Math.max(1, Math.round((Date.parse(hoy) - Date.parse(Object.keys(porDia).sort()[0] ?? hoy)) / 86400000) + 1))
  for (let k = n - 1; k >= 0; k--) {
    const d = dia(Date.now() - k * 86400000)
    listaDias.push({ dia: d, costo: porDia[d]?.costo ?? 0, tokens: porDia[d]?.tokens ?? 0 })
  }

  const grupos = {}
  for (const h of Object.values(herr)) {
    const g = (grupos[h.grupo] ??= { grupo: h.grupo, llamadas: 0, tokens: 0 })
    g.llamadas += h.llamadas
    g.tokens += h.tokens
  }

  // Ahorro del modo código: corridas del sandbox en el rango
  const corridas = historial.filter((h) => h.tokens && enRango(dia(h.date ?? h.fecha)))
  const sandbox = {
    corridas: corridas.length,
    clasico: corridas.reduce((s, h) => s + (h.tokens.classic ?? h.tokens.clasico ?? 0), 0),
    codigo: corridas.reduce((s, h) => s + (h.tokens.code ?? h.tokens.codigo ?? 0), 0),
    diferida: corridas.reduce((s, h) => s + (h.tokens.deferred ?? h.tokens.classic ?? h.tokens.clasico ?? 0), 0),
    desdeTuIA: corridas.filter((h) => h.source === 'gateway').length,
  }

  // Before / after Code Mode (the day Setup was applied): cost per active day and tool-result tokens per answer
  let antesDespues = null
  if (since) {
    const corte = dia(since)
    const lado = (f) => {
      const ds = Object.entries(porDia).filter(([d, v]) => f(d) && v.respuestas)
      const respuestas = ds.reduce((a, [, v]) => a + v.respuestas, 0)
      return {
        dias: ds.length,
        costoPorDia: ds.length ? ds.reduce((a, [, v]) => a + v.costo, 0) / ds.length : null,
        herrPorRespuesta: respuestas ? ds.reduce((a, [, v]) => a + v.herr, 0) / respuestas : null,
      }
    }
    // The setup day itself is mixed (part before, part after): it counts for neither side
    antesDespues = { desde: corte, antes: lado((d) => d < corte), despues: lado((d) => d > corte) }
  }

  const entradaTotal = tot.i + tot.cw + tot.cr
  return {
    antesDespues,
    dias,
    desde,
    hasta: hoy,
    archivosLeidos: leidos,
    archivos: Object.keys(todos).length,
    totales: {
      ...tot,
      entradaTotal,
      pctCache: entradaTotal ? tot.cr / entradaTotal : 0,
      ahorroCacheUsd,
    },
    porDia: listaDias,
    porProyecto: Object.entries(porProyecto)
      .map(([nombre, v]) => ({ nombre, costo: v.costo, tokens: v.tokens, sesiones: v.sesiones.size }))
      .sort((a, b) => b.costo - a.costo),
    porModelo: Object.entries(porModelo).map(([modelo, v]) => ({ modelo, ...v })).sort((a, b) => b.tokens - a.tokens),
    herramientas: Object.values(herr).sort((a, b) => b.tokens - a.tokens).slice(0, 12),
    gruposHerramientas: Object.values(grupos).sort((a, b) => b.tokens - a.tokens),
    sandbox,
  }
}
