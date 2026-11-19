// Code Mode MCP — panel logic (no framework).
'use strict'

const $ = (s, r = document) => r.querySelector(s)
const $$ = (s, r = document) => [...r.querySelectorAll(s)]
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const pref = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch {} },
}

// ── Language ──────────────────────────────────────────────────────────────────────────────────────
let LANG = pref.get('cm-lang') || ((navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en')
const t = (key, vars = {}) => String(window.TEXTS[LANG][key] ?? window.TEXTS.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
const locale = () => (LANG === 'es' ? 'es' : 'en-US')
const num = (n) => Math.round(n ?? 0).toLocaleString(locale())
const short = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)} k` : String(Math.round(n ?? 0)))
const big = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} k` : String(Math.round(n)))
const secs = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)
const longDate = (iso) => new Date(iso).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' })
const shortDate = (d) => new Date(`${d}T12:00:00`).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
const usd = (n) => `US$ ${(n ?? 0).toLocaleString(locale(), { maximumFractionDigits: n >= 100 ? 0 : 2, minimumFractionDigits: n >= 100 ? 0 : 2 })}`

function applyLanguage() {
  document.documentElement.lang = LANG
  for (const el of $$('[data-t]')) el.textContent = t(el.dataset.t)
  for (const el of $$('[data-t-html]')) el.innerHTML = t(el.dataset.tHtml)
  for (const b of $$('[data-idioma]')) b.setAttribute('aria-pressed', String(b.dataset.idioma === LANG))
  $('#sb-titulo').placeholder = LANG === 'es' ? 'Para encontrarlo en el historial' : 'To find it in the history'
}
for (const b of $$('[data-idioma]')) {
  b.addEventListener('click', () => {
    LANG = b.dataset.idioma
    pref.set('cm-lang', LANG)
    applyLanguage()
    rerender()
  })
}
function rerender() {
  if (inventory) paintInventory()
  paintSetup()
  paintLearn()
  fillExamples()
  if (!$('#usage').hidden) loadUsage()
  if (!$('#history').hidden) loadHistory()
  if (inventory) $('#fecha-inventario').textContent = t('checked', { date: longDate(inventory.date) })
}

async function api(route, options = {}) {
  const r = await fetch(route, { ...options, headers: { 'content-type': 'application/json', 'x-panel': '1', ...(options.headers ?? {}) } })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.error ?? `Error ${r.status}`)
  return data
}

// ── Tabs ──────────────────────────────────────────────────────────────────────────────────────────
const TABS = ['setup', 'inventory', 'usage', 'sandbox', 'history', 'learn']
function openTab(id) {
  for (const b of $$('.pestanas button')) b.setAttribute('aria-selected', String(b.dataset.pestana === id))
  for (const p of $$('.panel')) p.hidden = p.id !== id
  if (id === 'history') loadHistory()
  if (id === 'usage') loadUsage()
  if (id === 'setup') loadSetup()
  pref.set('cm-tab', id)
  history.replaceState(null, '', `#${id}`)
}
for (const b of $$('.pestanas button')) b.addEventListener('click', () => openTab(b.dataset.pestana))

function listItem({ id, name, extra = '', below = '', dot = '', current }) {
  return `<button class="item" type="button" data-id="${esc(id)}" aria-current="${id === current}">
    <span class="punto ${dot}"></span><span class="nombre">${esc(name)}</span><span class="extra">${extra}</span>${below ? `<span class="bajo">${below}</span>` : ''}</button>`
}

// ── Setup ─────────────────────────────────────────────────────────────────────────────────────────
let setupPlan = null
let setupMessage = ''

async function loadSetup() {
  try {
    setupPlan = await api('/api/setup/plan')
  } catch (e) {
    $('#setup').innerHTML = `<p class="nota">${esc(e.message)}</p>`
    return
  }
  paintSetup()
}

function paintSetup() {
  const p = setupPlan
  if (!p) return
  const st = p.status
  const found = p.clients.filter((c) => c.found)
  const movable = found.flatMap((c) => c.servers.filter((s) => !s.isGateway).map((s) => ({ client: c.id, name: s.name })))
  const catalog = inventory?.panel ?? []
  const known = (name) => catalog.find((s) => s.name === name)
  const blender = inventory?.codeTools?.blender

  const clientRows = p.clients.map((c) => {
    const servers = c.servers.filter((s) => !s.isGateway)
    const hasGw = c.servers.some((s) => s.isGateway)
    if (!c.found) return `<div class="cliente apagado"><b>${esc(c.name)}</b><span class="tenue chico-texto">${t('setup.notFound')}</span></div>`
    return `<div class="cliente">
      <div class="fila entre"><b>${esc(c.name)}</b>${hasGw ? `<span class="pastilla ok">${t('setup.gatewayThere')}</span>` : ''}</div>
      <code class="ruta">${esc(c.file)}</code>
      ${servers.length ? `<div class="checks">${servers.map((s) => `<label class="check"><input type="checkbox" data-cliente="${esc(c.id)}" value="${esc(s.name)}" checked /><span>${esc(s.name)}</span><small class="tenue">${s.type === 'stdio' ? esc(s.command ?? '') : esc(s.type)}</small></label>`).join('')}</div>` : `<p class="tenue chico-texto">${t('setup.noServers')}</p>`}
    </div>`
  }).join('')

  $('#setup').innerHTML = `
    <div class="setup">
      <div class="tarjeta setup-izq">
        <div><h2>${t('setup.title')}</h2><p class="tenue" style="margin-top:6px">${t('setup.intro')}</p></div>
        ${st.applied ? `<div class="activo"><span class="pastilla ok">${t('setup.applied')}</span><p class="chico-texto">${t('setup.appliedAt', { date: longDate(st.at), clients: st.clients.map((id) => p.clients.find((c) => c.id === id)?.name ?? id).join(', '), n: st.panelServers.length })}</p><button id="setup-deshacer" class="boton secundario peligro chico" type="button">${t('setup.undo')}</button></div>` : ''}
        <h3>${t('setup.found')}</h3>
        <div class="clientes desplazable">${found.length ? clientRows : `<p class="nota">${t('setup.noneFound')}</p>${clientRows}`}</div>
      </div>
      <div class="setup-der">
        <div class="tarjeta accion">
          <div class="antes-despues">
            <div><div class="etiqueta">${t('setup.before')}</div><div class="valor">${movable.length} MCP</div><div class="tenue chico-texto">${t('setup.allTools')}</div></div>
            <div class="flecha" aria-hidden="true">→</div>
            <div><div class="etiqueta">${t('setup.after')}</div><div class="valor acento">${t('setup.gw3')}</div><div class="tenue chico-texto">code-mode</div></div>
          </div>
          <label class="check"><input type="checkbox" id="setup-skill" checked /><span>${t('setup.skill')}</span></label>
          <button id="setup-aplicar" class="boton grande" type="button"></button>
          <p class="tenue chico-texto">${t('setup.safe')}</p>
          ${setupMessage ? `<p class="nota ok-nota">${setupMessage}</p>` : ''}
        </div>
        <div class="tarjeta">
          <h3>${t('setup.blender')}</h3>
          ${blender?.ok ? `<p class="chico-texto tenue">${t('setup.blenderFound', { path: esc(blender.path) })}</p>` : `<p class="chico-texto tenue">${t('setup.blenderMissing')}</p>
          <div class="fila"><input id="blender-ruta" type="text" placeholder="${process_hint()}" /></div>`}
          <div class="fila" style="margin-top:8px"><input id="blender-escenas" type="text" placeholder="${t('setup.scenes')}" value="${esc(state?.settings?.blenderScenes ?? '')}" /><button id="blender-guardar" class="boton secundario chico" type="button">${t('setup.save')}</button></div>
        </div>
      </div>
    </div>`

  const update = () => {
    const n = $$('#setup input[data-cliente]:checked').length
    const b = $('#setup-aplicar')
    b.textContent = n ? t('setup.go', { n }) : t('setup.nothing')
    b.disabled = !n
  }
  $$('#setup input[data-cliente]').forEach((i) => i.addEventListener('change', update))
  update()
  $('#setup-aplicar').addEventListener('click', applySetup)
  $('#setup-deshacer')?.addEventListener('click', undoSetup)
  $('#blender-guardar').addEventListener('click', saveBlender)
}
const process_hint = () => (navigator.platform.startsWith('Win') ? 'C:\\Program Files\\Blender Foundation\\Blender 4.x\\blender.exe' : '/Applications/Blender.app/Contents/MacOS/Blender')

async function applySetup() {
  const selection = {}
  for (const i of $$('#setup input[data-cliente]:checked')) (selection[i.dataset.cliente] ??= []).push(i.value)
  const b = $('#setup-aplicar')
  b.disabled = true
  b.textContent = t('setup.working')
  try {
    const r = await api('/api/setup/apply', { method: 'POST', body: JSON.stringify({ selection, skill: $('#setup-skill').checked }) })
    const moved = r.summary.reduce((a, s) => a + (s.moved?.length ?? 0), 0)
    setupMessage = `${t('setup.done', { n: moved })} ${t('setup.restart')}`
    await loadSetup()
    loadInventory(true)
  } catch (e) {
    setupMessage = esc(e.message)
    paintSetup()
  }
}
async function undoSetup() {
  if (!confirm(t('setup.undoConfirm'))) return
  await api('/api/setup/undo', { method: 'POST' })
  setupMessage = t('setup.undone')
  await loadSetup()
  loadInventory(true)
}
async function saveBlender(e) {
  const body = { blenderScenes: $('#blender-escenas').value.trim() }
  if ($('#blender-ruta')) body.blenderPath = $('#blender-ruta').value.trim()
  state.settings = await api('/api/settings', { method: 'POST', body: JSON.stringify(body) })
  e.target.textContent = t('setup.saved')
  loadInventory(false)
}

// ── Inventory ─────────────────────────────────────────────────────────────────────────────────────
let inventory = null
let state = null
let invSel = pref.get('cm-inv') || 'summary'

async function loadInventory(refresh = false) {
  $('#refrescar').disabled = true
  if (refresh || !inventory) $('#inv-detalle').innerHTML = `<div class="cargando">${t('loading')}</div>`
  try {
    inventory = await api(`/api/inventory${refresh ? '?refresh' : ''}`)
    $('#fecha-inventario').textContent = inventory.date ? t('checked', { date: longDate(inventory.date) }) : ''
    paintInventory()
    if (setupPlan) paintSetup()
  } catch (e) {
    $('#inv-detalle').innerHTML = `<p class="nota">${esc(e.message)}</p>`
  } finally {
    $('#refrescar').disabled = false
  }
}
$('#refrescar').addEventListener('click', () => loadInventory(true))

function paintInventory() {
  const inv = inventory
  const panel = inv.panel ?? []
  const direct = inv.clients.filter((c) => c.found && c.servers.some((s) => !s.isGateway))
  const ids = ['summary', ...panel.map((s) => `mcp:${s.name}`), ...direct.map((c) => `app:${c.id}`), 'code', 'skills', 'installs']
  if (!ids.includes(invSel)) invSel = 'summary'
  const a = invSel
  $('#inv-lista').innerHTML = [
    listItem({ id: 'summary', name: t('inv.summary'), dot: 'acento', current: a }),
    `<div class="grupo-titulo">${t('inv.panel')}</div>`,
    ...(panel.length ? panel.map((s) => listItem({ id: `mcp:${s.name}`, name: s.name, dot: s.state === 'connected' ? 'ok' : 'aviso', extra: `≈ ${short(s.tokensTotal)}`, below: s.state === 'connected' ? t('inv.tools', { n: s.tools.length }) : t('inv.unavailable'), current: a })) : [`<p class="tenue chico-texto" style="padding:4px 8px">${t('inv.empty')}</p>`]),
    ...(direct.length ? [`<div class="grupo-titulo">${t('inv.apps')}</div>`, ...direct.map((c) => listItem({ id: `app:${c.id}`, name: c.name, dot: 'aviso', below: `${c.servers.filter((s) => !s.isGateway).length} MCP`, current: a }))] : []),
    `<div class="grupo-titulo">${t('inv.other')}</div>`,
    listItem({ id: 'code', name: t('inv.code'), dot: inv.codeTools.browser.ok ? 'ok' : 'aviso', current: a }),
    listItem({ id: 'skills', name: t('inv.skills'), below: `${inv.skills.length}`, current: a }),
    listItem({ id: 'installs', name: t('inv.installs'), below: `${inv.installs.length}`, current: a }),
  ].join('')

  let html
  if (a === 'summary') html = detailSummary(inv)
  else if (a.startsWith('mcp:')) html = detailServer(panel.find((s) => `mcp:${s.name}` === a))
  else if (a.startsWith('app:')) html = detailApp(inv.clients.find((c) => `app:${c.id}` === a))
  else if (a === 'code') html = detailCode(inv.codeTools)
  else if (a === 'skills') html = detailSkills(inv.skills)
  else html = detailInstalls(inv.installs)
  $('#inv-detalle').innerHTML = html
}
$('#inv-lista').addEventListener('click', (e) => {
  const b = e.target.closest('.item')
  if (!b) return
  invSel = b.dataset.id
  pref.set('cm-inv', invSel)
  paintInventory()
})

function detailSummary(inv) {
  const panel = inv.panel ?? []
  const tools = panel.reduce((a, s) => a + s.tools.length, 0)
  const total = panel.reduce((a, s) => a + s.tokensTotal, 0)
  const max = Math.max(...panel.map((s) => s.tokensTotal), 1)
  return `
    <div class="encabezado"><h2>${t('inv.summary')}</h2></div>
    <div class="cifras">
      <div class="cifra"><div class="etiqueta">${t('inv.kpiPanel')}</div><div class="valor">${panel.filter((s) => s.state === 'connected').length} / ${panel.length}</div></div>
      <div class="cifra"><div class="etiqueta">${t('inv.kpiTools')}</div><div class="valor">${tools}</div></div>
      <div class="cifra"><div class="etiqueta">${t('inv.kpiDirect')}</div><div class="valor">≈ ${num(total)}</div><div class="detalle-cifra">${t('tokens')}</div></div>
      <div class="cifra"><div class="etiqueta">${t('inv.kpiGateway')}</div><div class="valor acento">≈ ${num(state?.gatewayTokens ?? 0)}</div><div class="detalle-cifra">${t('inv.kpiGatewayNote')}</div></div>
    </div>
    <div><h3>${t('inv.weights')}</h3><p class="tenue chico-texto" style="margin:2px 0 12px">${t('inv.weightsNote')}</p>
      <div class="barras desplazable">${panel.length ? panel.map((s) => `<div class="barra" data-tip="${esc(s.name)}: ${t('inv.tools', { n: s.tools.length })}"><span class="recorta">${esc(s.name)}</span><div class="pista"><div class="relleno" style="width:${(100 * s.tokensTotal) / max}%"></div></div><span class="num">≈ ${num(s.tokensTotal)}</span></div>`).join('') : `<p class="vacio">${t('inv.empty')}</p>`}</div>
    </div>`
}

function serverHeader(s) {
  const cmd = [s.command, ...(s.args ?? [])].filter(Boolean).join(' ') || s.url || ''
  const live = s.live == null ? '' : s.live ? `<span class="pastilla ok">${t('inv.live')}</span>` : `<span class="pastilla neutra">${t('inv.notLive')}</span>`
  return `<div class="encabezado">
      <div class="titulo"><h2>${esc(s.name)}</h2>${s.state === 'connected' ? `<span class="pastilla ok">${t('inv.connected')}</span>` : `<span class="pastilla aviso">${t('inv.notAvailable')}</span>`}${live}</div>
      <div class="datos">
        ${s.server ? `<span><b>${esc(s.server)}</b></span>` : ''}
        <span>${t('inv.tools', { n: `<b>${s.tools.length}</b>` })}</span>
        <span>${t('inv.inContext')}: <b>≈ ${num(s.tokensTotal)} ${t('tokens')}</b></span>
        <span>${t('inv.answered')} <b>${secs(s.ms)}</b></span>
      </div>
      <div class="datos"><span>${t('inv.command')}: <code>${esc(cmd)}</code></span>
        ${s.envNames?.length ? `<span>${t('inv.vars')}: ${s.envNames.map((n) => `<code>${esc(n)}</code>`).join(' ')} ${t('inv.hidden')}</span>` : ''}
        ${s.headerNames?.length ? `<span>${t('inv.headers')}: ${s.headerNames.map((n) => `<code>${esc(n)}</code>`).join(' ')} ${t('inv.hidden')}</span>` : ''}
      </div>
      ${s.state !== 'connected' ? `<p class="motivo">${esc(s.reason ?? '')}</p>` : ''}
    </div>`
}

function detailServer(s) {
  const max = Math.max(...s.tools.map((h) => h.tokens), 1)
  return `${serverHeader(s)}
    ${s.tools.length ? `<div class="desplazable tabla-movil"><table class="tabla-fija"><colgroup><col style="width:27%"><col style="width:39%"><col style="width:24%"><col style="width:10%"></colgroup><thead><tr><th>${t('inv.tool')}</th><th>${t('inv.desc')}</th><th>${t('inv.params')}</th><th class="num">${t('inv.tokens')}</th></tr></thead><tbody>
      ${[...s.tools].sort((x, y) => y.tokens - x.tokens).map((h) => `<tr>
        <td><code>${esc(h.name)}</code></td>
        <td class="desc"><span class="corta">${esc(h.description)}</span>${h.description.length > 160 ? `<button class="mas" type="button">${t('inv.seeAll')}</button>` : ''}</td>
        <td><div class="params">${h.params.length ? h.params.map((p) => `<span class="param${p.required ? ' req' : ''}" title="${esc(p.description)}">${esc(p.name)}: ${esc(p.type)}${p.required ? '' : '?'}</span>`).join('') : '<span class="tenue">—</span>'}</div></td>
        <td class="num">≈ ${num(h.tokens)}<span class="mini" style="width:${Math.max(3, (36 * h.tokens) / max)}px"></span></td>
      </tr>`).join('')}
    </tbody></table></div><p class="tenue chico-texto">${t('inv.paramsNote')}</p>` : ''}`
}

function detailApp(c) {
  const servers = c.servers.filter((s) => !s.isGateway)
  return `<div class="encabezado"><h2>${esc(c.name)}</h2><code class="ruta">${esc(c.file)}</code><p class="nota">${servers.length ? t('inv.directNote', { app: esc(c.name) }) : t('inv.noDirect')}</p></div>
    <div class="desplazable"><table><thead><tr><th>MCP</th><th>${t('inv.command')}</th><th>${t('inv.vars')}</th></tr></thead><tbody>
    ${servers.map((s) => `<tr><td><b>${esc(s.name)}</b></td><td><code>${esc([s.command, ...(s.args ?? [])].filter(Boolean).join(' ') || s.url || '')}</code></td><td>${s.envNames.map((n) => `<code>${esc(n)}</code>`).join(' ') || '—'}</td></tr>`).join('')}
    </tbody></table></div>`
}

function detailCode(ct) {
  return `<div class="encabezado"><h2>${t('inv.code')}</h2></div>
    <div class="desplazable">
      <div class="script"><div class="fila entre"><b>${t('inv.browser')}</b>${ct.browser.ok ? `<span class="pastilla ok">${t('inv.ready')}</span>` : `<span class="pastilla aviso">${t('inv.missing')}</span>`}</div><p>${t('inv.browserNote')}</p><code>const page = await browser.page({ screen: 'mobile' })</code></div>
      <div class="script"><div class="fila entre"><b>Blender</b>${ct.blender.ok ? `<span class="pastilla ok">${t('inv.ready')}</span>` : `<span class="pastilla neutra">${t('inv.missing')}</span>`}</div><p>${t('inv.blenderNote')}</p>${ct.blender.path ? `<code>${esc(ct.blender.path)}</code>` : ''}${ct.blender.scenes?.length ? `<p>${ct.blender.scenes.map((s) => `<code>${esc(s)}</code>`).join(' ')}</p>` : ''}</div>
    </div>`
}

function detailSkills(skills) {
  return `<div class="encabezado"><h2>${t('inv.skills')}</h2><p class="tenue">${t('inv.skillsNote')}</p></div>
    <div class="desplazable tabla-movil"><table><thead><tr><th>Skill</th><th>${t('inv.desc')}</th><th class="num">${t('inv.always')}</th><th class="num">${t('inv.whenUsed')}</th></tr></thead><tbody>
    ${skills.map((s) => `<tr><td><code>${esc(s.name)}</code></td><td class="desc"><span class="corta">${esc(s.description)}</span></td><td class="num">≈ ${num(s.tokensAlways)}</td><td class="num">≈ ${num(s.tokensWhenUsed)}</td></tr>`).join('')}
    </tbody></table></div>`
}

function detailInstalls(list) {
  return `<div class="encabezado"><h2>${t('inv.installs')}</h2><p class="tenue">${t('inv.installsNote')}</p></div>
    <div class="desplazable">${list.length ? `<table><thead><tr><th>${t('inv.date')}</th><th>${t('inv.what')}</th><th>${t('inv.detail')}</th></tr></thead><tbody>
    ${list.map((r) => `<tr><td style="white-space:nowrap">${esc(longDate(r.date))}</td><td><code>${esc(r.action)}</code></td><td>${esc(r.name ?? r.detail ?? '')}${r.tokens != null ? ` · ≈ ${num(r.tokens)} ${t('tokens')}` : ''}</td></tr>`).join('')}
    </tbody></table>` : `<p class="vacio">${t('inv.noInstalls')}</p>`}</div>`
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('.mas')
  if (!b) return
  const td = b.closest('.desc')
  td.classList.toggle('abierta')
  b.textContent = td.classList.contains('abierta') ? t('inv.seeLess') : t('inv.seeAll')
})

// ── Usage ─────────────────────────────────────────────────────────────────────────────────────────
let usageReq = 0
async function loadUsage() {
  const days = $('input[name="con-dias"]:checked').value
  const req = ++usageReq
  if (!$('#con-contenido .con-cifras')) $('#con-contenido').innerHTML = `<div class="cargando">${t('usage.loading')}</div>`
  try {
    const c = await api(`/api/usage?days=${days}`)
    if (req === usageReq) paintUsage(c)
  } catch (e) {
    $('#con-contenido').innerHTML = `<p class="nota">${esc(e.message)}</p>`
  }
}
for (const r of $$('input[name="con-dias"]')) r.addEventListener('change', () => { pref.set('cm-days', r.value); loadUsage() })
{
  const d = pref.get('cm-days')
  if (d && $(`input[name="con-dias"][value="${d}"]`)) $(`input[name="con-dias"][value="${d}"]`).checked = true
}

function paintUsage(c) {
  const T = c.totales
  if (!c.archivos) {
    $('#con-nota').textContent = ''
    $('#con-contenido').innerHTML = `<p class="nota">${t('usage.none')}</p>`
    return
  }
  const period = c.dias ? t('usage.period', { a: shortDate(c.desde), b: shortDate(c.hasta) }) : t('usage.since')
  $('#con-nota').textContent = t('usage.note', { s: T.sesiones, m: num(T.mensajes), period })
  const saved = Math.max(0, c.sandbox.clasico - c.sandbox.codigo)
  const maxDay = Math.max(...c.porDia.map((d) => d.costo), 0.01)
  const maxProj = Math.max(...c.porProyecto.map((p) => p.costo), 0.01)
  const maxGroup = Math.max(...c.gruposHerramientas.map((g) => g.tokens), 1)
  const every = Math.ceil(c.porDia.length / 6)
  const pct = (T.pctCache * 100).toFixed(1)
  $('#con-contenido').innerHTML = `
    <div class="con-cifras">
      <div class="cifra"><div class="etiqueta">${t('usage.cost')}</div><div class="valor">${usd(T.costo)}</div><div class="detalle-cifra">${t('usage.costNote')}</div></div>
      <div class="cifra"><div class="etiqueta">${t('usage.read')}</div><div class="valor">${big(T.entradaTotal)}</div><div class="detalle-cifra">${t('usage.readNote', { p: pct })}</div></div>
      <div class="cifra"><div class="etiqueta">${t('usage.written')}</div><div class="valor">${big(T.o)}</div><div class="detalle-cifra">${t('usage.writtenNote')}</div></div>
      <div class="cifra ahorro-cifra"><div class="etiqueta">${t('usage.cacheSaved')}</div><div class="valor">≈ ${usd(T.ahorroCacheUsd)}</div><div class="detalle-cifra">${t('usage.cacheNote')}</div></div>
      <div class="cifra ahorro-cifra"><div class="etiqueta">${t('usage.codeSaved')}</div><div class="valor">≈ ${big(saved)}</div><div class="detalle-cifra">${t('usage.codeNote', { n: c.sandbox.corridas })}</div></div>
    </div>
    <div class="con-grilla">
      <div class="tarjeta con-caja">
        <div class="fila entre"><h3>${t('usage.perDay')}</h3><span class="tenue chico-texto">${t('usage.max', { v: usd(maxDay) })}</span></div>
        <div class="columnas" role="img" aria-label="${t('usage.perDay')}">${c.porDia.map((d) => `<div class="col" data-tip="${esc(shortDate(d.dia))}: ${esc(usd(d.costo))} · ${esc(big(d.tokens))} ${t('tokens')}"><div class="col-barra" style="height:${d.costo ? Math.max(2, (100 * d.costo) / maxDay) : 0}%"></div></div>`).join('')}</div>
        <div class="eje">${c.porDia.map((d, i) => `<span>${i % every === 0 || i === c.porDia.length - 1 ? esc(shortDate(d.dia)) : ''}</span>`).join('')}</div>
      </div>
      <div class="tarjeta con-caja">
        <h3>${t('usage.perProject')}</h3>
        <div class="desplazable barras">${c.porProyecto.length ? c.porProyecto.map((p) => `<div class="barra" data-tip="${esc(p.nombre)}: ${esc(usd(p.costo))} · ${esc(big(p.tokens))} ${t('tokens')}"><span class="recorta">${esc(p.nombre)}</span><div class="pista"><div class="relleno" style="width:${(100 * p.costo) / maxProj}%"></div></div><span class="num">${usd(p.costo)}</span></div>`).join('') : `<p class="vacio">${t('usage.noData')}</p>`}</div>
      </div>
      <div class="tarjeta con-caja">
        <div class="fila entre"><h3>${t('usage.tools')}</h3><span class="tenue chico-texto">${t('usage.toolsNote')}</span></div>
        <div class="barras">${c.gruposHerramientas.slice(0, 4).map((g) => `<div class="barra" data-tip="${esc(g.grupo)}: ${num(g.llamadas)} · ≈ ${esc(big(g.tokens))}"><span class="recorta">${esc(g.grupo)}</span><div class="pista"><div class="relleno" style="width:${(100 * g.tokens) / maxGroup}%"></div></div><span class="num">≈ ${big(g.tokens)}</span></div>`).join('')}</div>
        <div class="desplazable"><table><thead><tr><th>${t('inv.tool')}</th><th class="num">${t('usage.calls')}</th><th class="num">${t('inv.tokens')}</th></tr></thead><tbody>
          ${c.herramientas.map((h) => `<tr><td><code>${esc(h.nombre.replace(/^mcp__/, ''))}</code></td><td class="num">${num(h.llamadas)}</td><td class="num">≈ ${big(h.tokens)}</td></tr>`).join('')}
        </tbody></table></div>
      </div>
      <div class="tarjeta con-caja con-explica">
        <h3>${t('usage.how')}</h3>
        <p>${t('usage.how1')}</p><p>${t('usage.how2', { p: pct, v: usd(T.ahorroCacheUsd) })}</p><p>${t('usage.how3')}</p><p class="tenue chico-texto">${t('usage.how4')}</p>
      </div>
    </div>`
}

const tip = document.createElement('div')
tip.className = 'globo'
tip.hidden = true
document.body.append(tip)
document.addEventListener('pointerover', (e) => {
  const el = e.target.closest('[data-tip]')
  if (!el) return (tip.hidden = true)
  tip.textContent = el.dataset.tip
  tip.hidden = false
})
document.addEventListener('pointermove', (e) => {
  if (tip.hidden) return
  tip.style.transform = `translate(${Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8)}px, ${Math.max(8, e.clientY - tip.offsetHeight - 12)}px)`
})

// ── Sandbox ───────────────────────────────────────────────────────────────────────────────────────
let examples = []
async function loadExamples() {
  examples = await api('/api/examples')
  fillExamples()
  if (!$('#sb-codigo').value) useExample(0)
}
function fillExamples() {
  const sel = $('#sb-ejemplo')
  const v = sel.value
  sel.innerHTML = `<option value="">${t('sb.blank')}</option>` + examples.map((e, i) => `<option value="${i}">${esc((LANG === 'es' && e.title_es) || e.title || e.file)}</option>`).join('')
  sel.value = v
}
function useExample(i) {
  const e = examples[i]
  if (!e) return
  $('#sb-ejemplo').value = String(i)
  $('#sb-codigo').value = e.code
  $('#sb-titulo').value = (LANG === 'es' && e.title_es) || e.title || ''
}
$('#sb-ejemplo').addEventListener('change', (e) => (e.target.value === '' ? ($('#sb-codigo').value = '') : useExample(Number(e.target.value))))
$('#sb-codigo').addEventListener('keydown', (e) => {
  if (e.key === 'Tab' && !e.shiftKey) {
    e.preventDefault()
    e.target.setRangeText('  ', e.target.selectionStart, e.target.selectionEnd, 'end')
  }
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) run()
})
$('#sb-correr').addEventListener('click', run)

let clock
async function run() {
  const b = $('#sb-correr')
  if (b.disabled) return
  b.disabled = true
  const start = Date.now()
  clearInterval(clock)
  clock = setInterval(() => ($('#sb-estado').textContent = t('sb.running', { t: secs(Date.now() - start) })), 250)
  $('#sb-resultado').innerHTML = `<div class="cargando">${t('sb.running', { t: '' })}</div>`
  try {
    const r = await api('/api/run', { method: 'POST', body: JSON.stringify({ code: $('#sb-codigo').value, title: $('#sb-titulo').value.trim() }) })
    paintResult(r)
    $('#sb-estado').textContent = t(r.ok ? 'sb.done' : 'sb.failed', { t: secs(r.ms) })
  } catch (e) {
    $('#sb-resultado').innerHTML = `<pre class="salida error">${esc(e.message)}</pre>`
    $('#sb-estado').textContent = ''
  } finally {
    clearInterval(clock)
    b.disabled = false
  }
}

function paintResult(r) {
  const out = []
  out.push(`<div class="fila entre"><h2>${t('sb.result')}</h2>${r.ok ? `<span class="pastilla ok">${t('sb.ok', { t: secs(r.ms) })}</span>` : `<span class="pastilla error">${t('sb.error', { t: secs(r.ms) })}</span>`}</div>`)
  if (r.comparison) out.push(paintComparison(r.comparison))
  if (r.ok) out.push(`<div><p class="tenue chico-texto" style="margin-bottom:6px">${t('sb.onlyThis')}</p><pre class="salida">${esc(typeof r.result === 'string' ? r.result : JSON.stringify(r.result, null, 2))}</pre>${(r.images ?? []).map((i) => `<img class="img-resultado" alt="" src="data:${esc(i.mimeType ?? 'image/png')};base64,${i.data}" />`).join('')}</div>`)
  else out.push(`<pre class="salida error">${esc(r.error)}</pre>`)
  if (r.calls?.length) {
    out.push(`<div><h3>${t('sb.calls')}</h3><table style="margin-top:4px"><thead><tr><th>${t('sb.server')}</th><th>${t('inv.tool')}</th><th class="num">${t('sb.duration')}</th><th class="num">${t('sb.fullResult')}</th></tr></thead><tbody>
    ${r.calls.map((l) => `<tr><td>${esc(l.server)}</td><td><code>${esc(l.tool)}</code>${l.error ? ' <span class="pastilla error">error</span>' : ''}</td><td class="num">${secs(l.ms)}</td><td class="num">≈ ${num(l.tokensResult)} ${t('tokens')}</td></tr>`).join('')}
    </tbody></table><p class="tenue chico-texto" style="margin-top:4px">${t('sb.callsNote')}</p></div>`)
  }
  if (r.logs?.length) out.push(`<div><h3>log()</h3><pre class="salida">${esc(r.logs.join('\n'))}</pre></div>`)
  $('#sb-resultado').innerHTML = out.join('')
}

function paintComparison(c) {
  const max = Math.max(c.classic.total, c.code.total, 1)
  const names = { definitions: 'part.definitions', calls: 'part.calls', gateway: 'part.gateway', code: 'part.code', result: 'part.result' }
  const side = (cls, name, d, codeSide) => {
    const parts = Object.entries(d.parts).map(([k, v]) => [t(codeSide && k === 'definitions' ? 'part.defsUsed' : names[k]), v])
    return `<div class="lado ${cls}"><div class="cabeza"><span>${name}</span><b>≈ ${num(d.total)} ${t('tokens')}</b></div>
      <div class="pista" style="width:${Math.max(2, (100 * d.total) / max)}%">${parts.filter(([, v]) => v > 0).map(([k, v]) => `<div class="pedazo" data-tip="${esc(k)}: ≈ ${num(v)}" style="width:${(100 * v) / (d.total || 1)}%"></div>`).join('')}</div>
      <ul>${parts.map(([k, v]) => `<li>${esc(k)}: ≈ ${num(v)}</li>`).join('')}</ul></div>`
  }
  const p = c.classic.total > 0 ? Math.round(100 * (1 - c.code.total / c.classic.total)) : 0
  return `<div class="comparacion"><p class="ahorro">${p > 0 ? t('sb.saving', { p }) : p < 0 ? t('sb.costMore', { p: -p }) : t('sb.same')}</p>
    ${side('clasico', t('sb.classic'), c.classic, false)}${side('codigo', t('sb.codeMode'), c.code, true)}</div>`
}

// ── History ───────────────────────────────────────────────────────────────────────────────────────
async function loadHistory() {
  const list = await api('/api/history').catch(() => [])
  $('#hist-lista').__list = list
  if (!list.length) {
    $('#hist-lista').innerHTML = `<p class="vacio" style="padding:10px 6px">${t('hist.empty')}</p>`
    return
  }
  $('#hist-lista').innerHTML = `<table class="historial-tabla"><thead><tr><th>${t('hist.date')}</th><th>${t('hist.source')}</th><th>${t('hist.title2')}</th><th class="num">${t('sb.duration')}</th><th>${t('hist.state')}</th><th class="num">${t('sb.classic')}</th><th class="num">${t('sb.codeMode').split(' (')[0]}</th><th class="num">${t('hist.saving')}</th></tr></thead><tbody>
    ${list.map((h, i) => {
      const p = h.tokens?.classic ? Math.round(100 * (1 - h.tokens.code / h.tokens.classic)) : null
      return `<tr class="entrada" data-i="${i}" tabindex="0" aria-expanded="false">
        <td style="white-space:nowrap">${esc(longDate(h.date))}</td><td>${esc(t(`src.${h.source}`))}</td><td>${esc(h.title)}</td><td class="num">${secs(h.ms)}</td>
        <td>${h.ok ? `<span class="pastilla ok">OK</span>` : '<span class="pastilla error">Error</span>'}</td>
        <td class="num">${h.tokens ? `≈ ${num(h.tokens.classic)}` : '—'}</td><td class="num">${h.tokens ? `≈ ${num(h.tokens.code)}` : '—'}</td><td class="num">${p == null ? '—' : `${p}%`}</td></tr>
      <tr class="detalle-fila" data-de="${i}" hidden><td colspan="8">
        ${h.ok ? `<b>${t('sb.result')}</b><pre>${esc(h.result)}</pre>` : `<b>Error</b><pre style="color:var(--error)">${esc(h.error)}</pre>`}
        ${h.calls?.length ? `<b>${t('sb.calls')}</b><pre>${esc(h.calls.map((l) => `${l.server}.${l.tool} — ${secs(l.ms)} — ≈ ${l.tokensResult} ${t('tokens')}${l.error ? ' — ERROR' : ''}`).join('\n'))}</pre>` : ''}
        <b>${t('hist.code')}</b><pre>${esc(h.code)}</pre>
        <button class="boton secundario chico" data-reusar="${i}" type="button">${t('hist.open')}</button>
      </td></tr>`
    }).join('')}</tbody></table>`
}
$('#hist-lista').addEventListener('click', (e) => {
  const r = e.target.closest('[data-reusar]')
  if (r) {
    const h = $('#hist-lista').__list[Number(r.dataset.reusar)]
    $('#sb-ejemplo').value = ''
    $('#sb-codigo').value = h.code
    $('#sb-titulo').value = h.title ?? ''
    openTab('sandbox')
    return
  }
  const row = e.target.closest('tr.entrada')
  if (row) toggleRow(row)
})
$('#hist-lista').addEventListener('keydown', (e) => {
  const row = e.target.closest('tr.entrada')
  if (row && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault()
    toggleRow(row)
  }
})
function toggleRow(row) {
  const d = $(`tr[data-de="${row.dataset.i}"]`)
  d.hidden = !d.hidden
  row.setAttribute('aria-expanded', String(!d.hidden))
}
$('#hist-borrar').addEventListener('click', async () => {
  if (!confirm(t('hist.confirm'))) return
  await api('/api/history', { method: 'DELETE' })
  loadHistory()
})

// ── How it works ──────────────────────────────────────────────────────────────────────────────────
let topic = Number(pref.get('cm-topic') ?? 0) || 0
function paintLearn() {
  const list = window.LEARN[LANG]
  if (topic < 0 || topic >= list.length) topic = 0
  $('#exp-lista').innerHTML = list.map((x, i) => listItem({ id: String(i), name: x.title, dot: i === 0 ? 'acento' : '', current: String(topic) })).join('')
  const x = list[topic]
  $('#exp-detalle').innerHTML = `<h2>${x.title}</h2><p class="texto${x.picture ? ' tenue' : ''}">${x.text}</p>${x.picture ? `<div class="diagrama">${picture()}</div>` : ''}
    <div class="navegar"><button class="boton secundario chico" type="button" data-tema="${topic - 1}" ${topic === 0 ? 'disabled' : ''}>${t('prev')}</button><span class="tenue chico-texto">${t('of', { a: topic + 1, b: list.length })}</span><button class="boton secundario chico" type="button" data-tema="${topic + 1}" ${topic === list.length - 1 ? 'disabled' : ''}>${t('next')}</button></div>`
}
const goTopic = (i) => { topic = i; pref.set('cm-topic', String(i)); paintLearn() }
$('#exp-lista').addEventListener('click', (e) => { const b = e.target.closest('.item'); if (b) goTopic(Number(b.dataset.id)) })
$('#exp-detalle').addEventListener('click', (e) => { const b = e.target.closest('[data-tema]'); if (b) goTopic(Number(b.dataset.tema)) })

function picture() {
  const es = LANG === 'es'
  const L = es
    ? { classic: 'MCP clásico', chat: 'Conversación', all: 'todo entra aquí', server: 'Servidores MCP', many: 'decenas de definiciones', calls: 'llamada 1, 2, 3…', full: 'resultados completos (miles de tokens)', code: 'Modo código', only: 'solo el código y el resumen', gw: 'Puerta code-mode', gwSub: 'busca, llama, filtra', heavy: 'MCP · Chrome · Blender', heavySub: 'el trabajo pesado', script: 'código', summary: 'resumen', every: 'todo' }
    : { classic: 'Classic MCP', chat: 'Conversation', all: 'everything comes in', server: 'MCP servers', many: 'dozens of definitions', calls: 'call 1, 2, 3…', full: 'full results (thousands of tokens)', code: 'Code mode', only: 'only the code and the summary', gw: 'code-mode gateway', gwSub: 'search, call, filter', heavy: 'MCP · Chrome · Blender', heavySub: 'the heavy work', script: 'code', summary: 'summary', every: 'everything' }
  return `<svg viewBox="0 0 860 300" role="img" aria-label="${L.classic} / ${L.code}">
  <defs><marker id="fc" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" class="flecha-clasico"/></marker><marker id="fk" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" class="flecha-codigo"/></marker></defs>
  <text x="0" y="20" class="negrita">${L.classic}</text>
  <rect x="0" y="34" width="190" height="86" rx="10" class="caja-claude"/><text x="95" y="72" text-anchor="middle" class="negrita">${L.chat}</text><text x="95" y="92" text-anchor="middle" class="t-tenue">${L.all}</text>
  <rect x="610" y="34" width="250" height="86" rx="10" class="caja"/><text x="735" y="72" text-anchor="middle" class="negrita">${L.server}</text><text x="735" y="92" text-anchor="middle" class="t-tenue">${L.many}</text>
  <path d="M190 52 H610" class="linea-clasico" marker-end="url(#fc)"/><text x="400" y="47" text-anchor="middle" class="t-tenue">${L.calls}</text>
  <path d="M610 100 H190" class="linea-clasico" marker-end="url(#fc)" stroke-width="6"/><text x="400" y="122" text-anchor="middle" class="t-tenue">${L.full}</text>
  <text x="0" y="176" class="negrita">${L.code}</text>
  <rect x="0" y="190" width="190" height="86" rx="10" class="caja-claude"/><text x="95" y="228" text-anchor="middle" class="negrita">${L.chat}</text><text x="95" y="248" text-anchor="middle" class="t-tenue">${L.only}</text>
  <rect x="300" y="190" width="220" height="86" rx="10" class="caja"/><text x="410" y="228" text-anchor="middle" class="negrita">${L.gw}</text><text x="410" y="248" text-anchor="middle" class="t-tenue">${L.gwSub}</text>
  <rect x="610" y="190" width="250" height="86" rx="10" class="caja"/><text x="735" y="228" text-anchor="middle" class="negrita">${L.heavy}</text><text x="735" y="248" text-anchor="middle" class="t-tenue">${L.heavySub}</text>
  <path d="M190 208 H300" class="linea-codigo" marker-end="url(#fk)"/><text x="245" y="203" text-anchor="middle" class="t-tenue">${L.script}</text>
  <path d="M520 208 H610" class="linea-codigo" marker-end="url(#fk)"/>
  <path d="M610 258 H520" class="linea-codigo" marker-end="url(#fk)" stroke-width="6"/><text x="565" y="290" text-anchor="middle" class="t-tenue">${L.every}</text>
  <path d="M300 258 H190" class="linea-codigo" marker-end="url(#fk)" stroke-width="1.5"/><text x="245" y="290" text-anchor="middle" class="t-tenue">${L.summary}</text>
</svg>`
}

// ── Start ─────────────────────────────────────────────────────────────────────────────────────────
applyLanguage()
paintLearn()
;(async () => {
  state = await api('/api/state').catch(() => ({ setup: {}, settings: {} }))
  if (state.settings?.language && !pref.get('cm-lang')) {
    LANG = state.settings.language
    applyLanguage()
    paintLearn()
  }
  loadExamples().catch(() => {})
  loadInventory(false)
  const first = location.hash.slice(1) || pref.get('cm-tab') || (state.setup?.applied ? 'inventory' : 'setup')
  openTab(TABS.includes(first) ? first : 'setup')
})()
