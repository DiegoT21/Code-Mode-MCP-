// Chrome driven by code (Playwright) instead of a browser MCP: the script opens the page, measures or tests
// what it needs and returns only the result. Uses the browser already installed (Chrome, then Edge), so
// nothing is downloaded.

import { chromium } from 'playwright-core'

export const SCREENS = {
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  tablet: { width: 768, height: 1024, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  desktop: { width: 1440, height: 900, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
}
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'

async function launch(visible) {
  const errors = []
  for (const channel of ['chrome', 'msedge', 'chromium']) {
    try {
      return await chromium.launch({ channel, headless: !visible })
    } catch (e) {
      errors.push(`${channel}: ${String(e.message).split('\n')[0]}`)
    }
  }
  throw new Error(`No Chrome or Edge found. Install Google Chrome. (${errors.join(' | ')})`)
}

// Returns { browser, context, page, errors, failed }: console errors and failed network requests
export async function open({ screen = 'desktop', visible = false } = {}) {
  const p = SCREENS[screen] ?? SCREENS.desktop
  const browser = await launch(visible)
  const context = await browser.newContext({
    viewport: { width: p.width, height: p.height },
    deviceScaleFactor: p.deviceScaleFactor,
    isMobile: p.isMobile,
    hasTouch: p.hasTouch,
    ...(p.isMobile && { userAgent: MOBILE_UA }),
    ignoreHTTPSErrors: true,
  })
  const page = await context.newPage()
  const errors = []
  const failed = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text().slice(0, 300)))
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText ?? 'failed'} ${r.url().slice(0, 150)}`))
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url().slice(0, 150)}`))
  return { browser, context, page, errors, failed }
}

// Load timings of the current page (ms) and transferred weight (KB)
export async function timings(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        let lcp = 0
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) lcp = Math.max(lcp, e.startTime)
        }).observe({ type: 'largest-contentful-paint', buffered: true })
        let cls = 0
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value
        }).observe({ type: 'layout-shift', buffered: true })
        setTimeout(() => {
          const nav = performance.getEntriesByType('navigation')[0]
          const fcp = performance.getEntriesByName('first-contentful-paint')[0]
          const kb = performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), nav?.transferSize || 0) / 1024
          resolve({ ttfb: Math.round(nav?.responseStart ?? 0), fcp: Math.round(fcp?.startTime ?? 0), lcp: Math.round(lcp), cls: Number(cls.toFixed(3)), load: Math.round(nav?.loadEventEnd ?? 0), kb: Math.round(kb) })
        }, 1500)
      }),
  )
}

// One-shot check of a URL: status, title, timings, errors. Used by `code-mode-mcp check <url>`.
export async function check(url, { screen = 'desktop', screenshot } = {}) {
  const s = await open({ screen })
  try {
    const res = await s.page.goto(url, { waitUntil: 'load', timeout: 60000 })
    const out = { url, status: res?.status() ?? null, title: await s.page.title(), ...(await timings(s.page)) }
    if (screenshot) await s.page.screenshot({ path: screenshot })
    if (s.errors.length) out.consoleErrors = s.errors.slice(0, 10)
    if (s.failed.length) out.failedRequests = [...new Set(s.failed)].slice(0, 10)
    return out
  } finally {
    await s.browser.close()
  }
}
