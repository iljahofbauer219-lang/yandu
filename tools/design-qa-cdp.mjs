// Design QA capture for the running Electron app, over CDP.
// The plugin's own capture/a11y stages launch a fresh Chromium against an HTTP URL; this renderer
// cannot mount there (file:// blocks its ES assets by CORS, an http host hits "node:fs has been
// externalized"), so we attach to the live instance and emit the plugin's own report schemas.
// Screens, viewports, ignore selectors and thresholds all come from design.qa.yaml.
// Read-only: no clicks, no navigation, no app state writes. The mask style is added and removed
// around the screenshot only.
// Usage: node tools/design-qa-cdp.mjs [--screen app-shell] [--baseline] [--config design.qa.yaml]
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const port = process.env.CDP_PORT || '9225'
const cli = Object.fromEntries(process.argv.slice(2).reduce((acc, arg, i, all) => {
  if (!arg.startsWith('--')) return acc
  const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  const next = all[i + 1]
  acc.push([key, next && !next.startsWith('--') ? next : true])
  return acc
}, []))

function pluginRoot() {
  const base = path.join(os.homedir(), '.qoder/plugins/cache/qoder-marketplace/design-review')
  const version = readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort().pop()
  const root = path.join(base, version || '')
  if (!existsSync(path.join(root, 'shared/lib/config.mjs'))) throw new Error(`design-review plugin config.mjs not found under ${base}`)
  return root
}

const root = pluginRoot()
const { loadConfig } = await import(pathToFileURL(path.join(root, 'shared/lib/config.mjs')).href)
const { expectedPathForScreen, actualPathForScreen, safeScreenName } = await import(pathToFileURL(path.join(root, 'shared/lib/screens.mjs')).href)
const { chromium } = require(path.join(root, 'node_modules/playwright-core'))
const axeSource = readFileSync(path.join(root, 'node_modules/axe-core/axe.min.js'), 'utf8')

const config = await loadConfig({ args: { config: typeof cli.config === 'string' ? cli.config : undefined } })
const screenName = typeof cli.screen === 'string' ? cli.screen : 'app-shell'
const screen = config.screens.find(entry => entry.name === screenName)
if (!screen) {
  console.error(`screen "${screenName}" is not configured in design.qa.yaml (have: ${config.screens.map(s => s.name).join(', ') || 'none'})`)
  process.exit(2)
}
const toActual = cli.baseline ? expectedPathForScreen : actualPathForScreen
const outPath = toActual(config, screen)
const metaPath = outPath.replace(/\.png$/u, '.meta.json')
const ignoreSelectors = screen.compare?.ignoreSelectors || []

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const target = targets.find(t => t.type === 'page' && /^file:\/\/.*renderer\/index\.html/u.test(t.url))
if (!target) { console.error(`no renderer page target on CDP port ${port}`); process.exit(1) }

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
const page = browser.contexts().flatMap(context => context.pages()).find(candidate => candidate.url() === target.url)
if (!page) { console.error('renderer page target is not reachable over CDP'); await browser.close(); process.exit(1) }

const readState = () => page.evaluate(() => {
  const active = document.querySelector('.sidebar nav .nav-active, .sidebar nav [aria-current]')
  const main = document.querySelector('main > *')
  const text = el => el ? String(el.textContent).trim().slice(0, 40) : null
  return {
    mounted: (document.getElementById('root')?.childElementCount || 0) > 0,
    theme: document.documentElement.dataset.theme || 'light',
    title: document.title,
    nav: text(active),
    pageRoot: main ? `${main.tagName.toLowerCase()}.${String(main.className).split(' ')[0]}` : null,
    buildStamp: text(document.querySelector('.build-stamp')),
    bodyTextLength: document.body.innerText.trim().length,
  }
})

const before = await readState()
if (!before.mounted) { console.error('renderer is not mounted; refusing to capture a blank frame'); await browser.close(); process.exit(1) }

let maskTag = null
if (ignoreSelectors.length) {
  maskTag = await page.addStyleTag({ content: ignoreSelectors.map(selector => `${selector} { visibility: hidden !important; }`).join('\n') })
}
try {
  // scale:'css' pins the PNG to the configured viewport no matter which display the window sits on.
  // Without it a Retina (dpr 2) display emits 2880x1732 against a 1440x866 baseline and the plugin
  // "normalizes" by upscaling the baseline, so the diff ratio measures resampling noise, not design.
  await page.screenshot({ path: outPath, fullPage: screen.app?.fullPage === true, animations: 'disabled', scale: 'css' })
} finally {
  if (maskTag) await page.evaluate(node => node.remove(), maskTag)
}
const viewport = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio }))

const result = await page.evaluate(async source => {
  const tag = document.createElement('script')
  tag.textContent = source
  document.head.append(tag)
  try {
    return await window.axe.run(document.documentElement, { resultTypes: ['violations', 'passes', 'incomplete', 'inapplicable'] })
  } finally {
    tag.remove()
    delete window.axe
  }
}, axeSource)

const severityOf = impact => impact === 'critical' ? 'blocker' : impact === 'serious' ? 'major' : impact === 'moderate' ? 'minor' : 'info'
const findings = result.violations.map(violation => {
  const node = violation.nodes[0]
  return {
    severity: severityOf(violation.impact),
    type: 'a11y',
    title: `${violation.id}: ${violation.help}`,
    selector: node?.target?.join(', '),
    evidence: node?.failureSummary || violation.description,
    observed: node?.html,
    expected: violation.description,
    impact: `axe impact: ${violation.impact || 'unknown'}`,
    recommendation: `Fix according to ${violation.helpUrl}`,
    verification: 'Re-run the accessibility scan and perform keyboard/manual review for the affected flow.',
    meta: { screen: screenName, url: target.url, ruleId: violation.id, helpUrl: violation.helpUrl, nodes: violation.nodes.length },
  }
})

const meta = { screen: screenName, url: target.url, viewport, state: before, ignoredSelectors: ignoreSelectors, capturedAt: new Date().toISOString() }
writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n')

const baselineMetaPath = expectedPathForScreen(config, screen).replace(/\.png$/u, '.meta.json')
const drift = !cli.baseline && existsSync(baselineMetaPath)
  ? (() => {
      const baseline = JSON.parse(readFileSync(baselineMetaPath, 'utf8'))
      return { nav: baseline.state.nav !== meta.state.nav, pageRoot: baseline.state.pageRoot !== meta.state.pageRoot, theme: baseline.state.theme !== meta.state.theme, viewport: baseline.viewport.width !== meta.viewport.width || baseline.viewport.height !== meta.viewport.height, buildStamp: baseline.state.buildStamp !== meta.state.buildStamp }
    })()
  : null

const screenshotsPath = path.join(config.project.outputDir, 'reports', 'screenshots.json')
// The plugin's own capture stage writes the same file for the http screens; merge by screen name so a
// live CDP capture does not silently drop the snapshot record (and vice versa).
const previous = existsSync(screenshotsPath) ? JSON.parse(readFileSync(screenshotsPath, 'utf8')) : { captures: [], findings: [] }
const mergedCaptures = [
  ...(Array.isArray(previous.captures) ? previous.captures : []).filter(entry => entry?.screen !== screenName),
  { screen: screenName, url: target.url, viewport, deviceScaleFactor: 1, fullPage: screen.app?.fullPage === true, path: outPath, masks: [], ignoreSelectors: meta.ignoredSelectors },
]
writeFileSync(screenshotsPath, JSON.stringify({
  ok: true,
  generatedAt: meta.capturedAt,
  captures: mergedCaptures,
  findings: [],
}, null, 2) + '\n')
writeFileSync(path.join(config.project.outputDir, 'reports', 'a11y.json'), JSON.stringify({
  ok: findings.every(f => f.severity !== 'blocker' && f.severity !== 'major'),
  generatedAt: meta.capturedAt,
  scans: [{
    screen: screenName, url: target.url, viewport,
    violations: result.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.map(n => ({ target: n.target, html: n.html, failureSummary: n.failureSummary })) })),
    passes: result.passes?.length || 0, incomplete: result.incomplete?.length || 0, inapplicable: result.inapplicable?.length || 0,
  }],
  findings,
}, null, 2) + '\n')

console.log(JSON.stringify({
  wrote: outPath,
  role: cli.baseline ? 'expected (baseline)' : 'actual',
  screen: safeScreenName(screenName),
  state: before,
  viewport,
  ignoredSelectors: ignoreSelectors,
  baselineDrift: drift,
  a11y: { violations: result.violations.length, bySeverity: findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] || 0) + 1 }), {}), passes: result.passes?.length || 0 },
}, null, 2))
await browser.close()
