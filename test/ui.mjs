// UI check of the panel, run with Playwright through the app's own browser module:
//   node test/ui.mjs [http://localhost:4779] [screenshots-folder]
// Use it against a panel started with fake configs (see test/backend.test.mjs for the variables).
// Checks: Setup moves the servers, every tab fits the window without page scroll, both languages, mobile.

import fs from 'node:fs'
import path from 'node:path'
import { open } from '../lib/browser/browser.mjs'

const URL_PANEL = process.argv[2] ?? 'http://localhost:4779'
const SHOTS = process.argv[3]
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true })
const shot = async (page, name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${name}.png`) })
const scrolls = (page) => page.evaluate(() => document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1)

const s = await open({ screen: 'desktop' })
const { page } = s
const r = { scroll: [] }
try {
  await page.setViewportSize({ width: 1280, height: 760 })
  await page.addInitScript(() => localStorage.setItem('cm-lang', 'en'))
  await page.goto(`${URL_PANEL}/#setup`)
  await page.locator('#setup-aplicar').waitFor({ timeout: 60000 })
  r.setupButton = await page.locator('#setup-aplicar').textContent()
  r.clientsFound = await page.locator('.cliente:not(.apagado) b').allTextContents()
  if (await scrolls(page)) r.scroll.push('setup')
  await shot(page, '1-setup-en')

  await page.click('#setup-aplicar')
  await page.locator('.activo').waitFor({ timeout: 60000 })
  r.afterSetup = (await page.locator('.ok-nota').textContent())?.trim()
  await shot(page, '2-setup-done-en')

  for (const tab of ['inventory', 'usage', 'sandbox', 'history', 'learn']) {
    await page.click(`[data-pestana="${tab}"]`)
    await page.waitForTimeout(tab === 'inventory' ? 15000 : 2500)
    if (await scrolls(page)) r.scroll.push(tab)
    await shot(page, `3-${tab}-en`)
  }
  await page.click('[data-pestana="inventory"]')
  r.inventoryItems = await page.locator('#inv-lista .item .nombre').allTextContents()

  // Sandbox: example 1 (list servers)
  await page.click('[data-pestana="sandbox"]')
  await page.selectOption('#sb-ejemplo', { index: 1 })
  await page.click('#sb-correr')
  await page.waitForFunction(() => !document.querySelector('#sb-correr').disabled, null, { timeout: 120000 })
  r.sandbox = (await page.locator('#sb-resultado .pastilla').first().textContent())?.trim()
  r.sandboxResult = (await page.locator('#sb-resultado pre.salida').first().textContent())?.slice(0, 200)
  await shot(page, '4-sandbox-en')

  // Spanish
  await page.click('[data-idioma="es"]')
  await page.click('[data-pestana="setup"]')
  await page.waitForTimeout(800)
  r.spanishTitle = await page.locator('#setup h2').first().textContent()
  if (await scrolls(page)) r.scroll.push('setup-es')
  await shot(page, '5-setup-es')

  // Undo
  page.once('dialog', (d) => d.accept())
  await page.click('#setup-deshacer')
  await page.waitForFunction(() => !document.querySelector('.activo'), null, { timeout: 30000 })
  r.afterUndo = (await page.locator('.ok-nota').textContent())?.trim()

  // Mobile
  await page.setViewportSize({ width: 390, height: 844 })
  for (const tab of ['setup', 'inventory', 'usage', 'sandbox', 'history', 'learn']) {
    await page.click(`[data-pestana="${tab}"]`)
    await page.waitForTimeout(800)
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) r.scroll.push(`mobile-sideways:${tab}`)
  }
  await page.click('[data-pestana="setup"]')
  await shot(page, '6-mobile-setup-es')
  if (s.errors.length) r.consoleErrors = s.errors.slice(0, 5)
} finally {
  await s.browser.close()
}
console.log(JSON.stringify(r, null, 2))
