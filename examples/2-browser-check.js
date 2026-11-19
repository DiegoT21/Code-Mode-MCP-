// title: Check a web page on mobile (browser in code mode)
// title_es: Revisar una página en celular (navegador en modo código)
// needs: browser
// Opens the page in your installed Chrome with a phone screen, measures it and returns a small object.
// The HTML and the page tree never reach the conversation.

const page = await browser.page({ screen: 'mobile' })
await page.goto('https://example.com', { waitUntil: 'load' })
return {
  title: await page.title(),
  ...(await browser.timings()),
  links: await page.locator('a[href]').count(),
}
