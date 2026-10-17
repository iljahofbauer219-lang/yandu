// Probe: can the built Electron renderer mount inside a plain headless Chromium?
// Run: node tools/probe-renderer-in-chromium.mjs [url]
import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const require = createRequire(import.meta.url)
function resolvePackage(name) {
  const pluginRoot = path.join(os.homedir(), '.qoder/plugins/cache/qoder-marketplace/design-review')
  const pluginDirs = readdirSync(pluginRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(pluginRoot, entry.name, 'node_modules', name))
  const repoDirs = [path.join(process.cwd(), 'server', 'node_modules', name)]
  const candidates = process.env.PW_PREFER === 'plugin' ? [...pluginDirs, ...repoDirs] : [...repoDirs, ...pluginDirs]
  for (const candidate of candidates) if (existsSync(candidate)) return candidate
  throw new Error(`cannot resolve ${name}`)
}
const { chromium } = require(resolvePackage('playwright-core'))
const url = process.argv[2] || 'file:///Users/zyc/yandu-hot/renderer/index.html'

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 240)) })
page.on('pageerror', error => consoleErrors.push(`pageerror: ${String(error.message).slice(0, 240)}`))
let navigateError = null
try {
  await page.goto(url, { waitUntil: 'load', timeout: 30000 })
} catch (error) {
  navigateError = error.message.slice(0, 240)
}
await page.waitForTimeout(3000)
const state = await page.evaluate(() => ({
  ready: document.readyState,
  rootExists: !!document.getElementById('root'),
  rootChildren: document.getElementById('root')?.childElementCount ?? 0,
  bodyTextLength: document.body?.innerText?.trim().length ?? 0,
}))
console.log(JSON.stringify({ url, navigateError, state, consoleErrors: consoleErrors.slice(0, 8) }, null, 2))
await browser.close()
