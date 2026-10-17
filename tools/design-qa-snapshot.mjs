// Static-snapshot harness for the design QA DOM layer.
// The plugin's capture / compare / DOM-measurement stages each launch their own Chromium against an
// http URL, and the live renderer cannot mount there (file:// CORS-blocks its ES assets, an http host
// hits "Module node:fs has been externalized" — evidence in tools/probe-renderer-in-chromium.mjs).
// So we freeze one real frame: the serialized live DOM plus the built CSS the page actually loaded,
// inlined, served from 127.0.0.1. That gives the plugin's own code a deterministic document to measure.
// Read-only against the app: the DOM is cloned before serialization; nothing touches the live document.
// Usage:
//   node tools/design-qa-snapshot.mjs                    # write .design-qa/harness/<screen>.html
//   node tools/design-qa-snapshot.mjs --serve            # host the harness (default port 4390)
//   node tools/design-qa-snapshot.mjs --verify           # measure every anchor live vs in the snapshot
//   node tools/design-qa-snapshot.mjs --css-root <dir>   # inline CSS from that build dir instead of ~/yandu-hot
//   node tools/design-qa-snapshot.mjs --axe              # run axe in headless chromium against the snapshot
//                                                        # (needs --serve running); writes reports/a11y-snapshot.json
//                                                        # so it never overwrites the live-window a11y.json.
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const cwd = process.cwd()
const port = process.env.CDP_PORT || '9225'
const host = '127.0.0.1'
const cli = Object.fromEntries(process.argv.slice(2).reduce((acc, arg, i, all) => {
  if (!arg.startsWith('--')) return acc
  const key = arg.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())
  const next = all[i + 1]
  acc.push([key, next && !next.startsWith('--') ? next : true])
  return acc
}, []))
const servePort = Number(cli.port || 4390)
const screenName = typeof cli.screen === 'string' ? cli.screen : 'app-shell'
function pluginRoot() {
  const base = path.join(os.homedir(), '.qoder/plugins/cache/qoder-marketplace/design-review')
  const version = readdirDirectories(base).sort().pop()
  const root = path.join(base, version || '')
  if (!existsSync(path.join(root, 'shared/lib/config.mjs'))) throw new Error(`design-review plugin not found under ${base}`)
  return root
}
function readdirDirectories(base) {
  const { readdirSync } = require('node:fs')
  return readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name)
}
// A local rebuild changes the vite content hash, so the href the live page reports no longer names a file
// on disk. Resolve by hash when it matches; otherwise fall back to the single same-stem stylesheet in the build.
function resolveStylesheet(clean) {
  const baseDir = cssRoot || hotRenderer
  const exact = path.resolve(baseDir, clean)
  if (!exact.startsWith(baseDir + path.sep)) throw new Error(`stylesheet ${clean} would escape ${baseDir}`)
  if (existsSync(exact)) return { file: exact, substituted: false }
  if (!cssRoot) throw new Error(`stylesheet ${clean} is not readable from ${baseDir}`)
  const stem = /^(.*)-[^-]*\.css$/u.exec(path.basename(clean))
  const dir = path.dirname(exact)
  const candidates = existsSync(dir) ? readdirSync(dir).filter(name => stem && new RegExp(`^${stem[1]}-[^-]*\\.css$`, 'u').test(name)) : []
  if (candidates.length !== 1) throw new Error(`--css-root ${dir}: expected exactly one ${stem ? stem[1] : clean} stylesheet, found ${candidates.length}`)
  return { file: path.join(dir, candidates[0]), substituted: true }
}

const root = pluginRoot()
const { loadConfig, screenUrl } = await import(pathToFileURL(path.join(root, 'shared/lib/config.mjs')).href)
const { chromium } = require(path.join(root, 'node_modules/playwright-core'))
const config = await loadConfig({ args: { config: typeof cli.config === 'string' ? cli.config : undefined } })
const screen = config.screens.find(entry => entry.name === screenName)
if (!screen) {
  console.error(`screen "${screenName}" is not configured in ${config.__meta.configPath}`)
  process.exit(2)
}

const harnessDir = path.join(config.project.outputDir, 'harness')
const snapshotPath = path.join(harnessDir, `${screenName}.html`)
const snapshotMetaPath = path.join(harnessDir, `${screenName}.snapshot.json`)
const hotRenderer = path.join(os.homedir(), 'yandu-hot', 'renderer')
const cssRoot = typeof cli.cssRoot === 'string' ? path.resolve(cwd, cli.cssRoot) : null
const snapshotUrl = `http://${host}:${servePort}/harness/${screenName}.html`
const anchors = [
  ...(Array.isArray(config.uiAlignment?.anchors) ? config.uiAlignment.anchors : []),
  ...(Array.isArray(config.uiAlignment?.elements) ? config.uiAlignment.elements : []),
  ...(Array.isArray(config.uiAlignment?.checks) ? config.uiAlignment.checks : []),
].filter(target => target?.selector && (Array.isArray(target.screens) ? target.screens.includes(screenName) : true))

// Mirrors audit-ui-alignment.mjs's module-local cssKeyForExpected closely enough to compare the two
// documents against each other; pass/fail semantics stay owned by the plugin.
const ALIASES = { x: 'x', y: 'y', left: 'x', top: 'y', width: 'width', height: 'height', minHeight: 'height', minWidth: 'width', maxHeight: 'height', maxWidth: 'width', text: 'textContent', textIncludes: 'textContent', textExact: 'textContent', textRegex: 'textContent' }
const GEOMETRY = new Set(['x', 'y', 'width', 'height'])
const STYLE_KEYS = ['display', 'position', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'backgroundColor', 'borderColor', 'borderRadius', 'boxShadow', 'opacity', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'gap', 'alignItems', 'justifyContent', 'textAlign', 'whiteSpace', 'overflow', 'textOverflow']

async function attachLive() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const target = targets.find(t => t.type === 'page' && /^file:\/\/.*renderer\/index\.html/u.test(t.url))
  if (!target) throw new Error(`no renderer page target on CDP port ${port}`)
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
  const page = browser.contexts().flatMap(c => c.pages()).find(candidate => candidate.url() === target.url)
  if (!page) { await browser.close(); throw new Error('renderer target not reachable over CDP') }
  return { browser, page, target }
}

async function measure(page, selector, keys) {
  return page.evaluate(({ selector, keys, aliases }) => {
    const element = document.querySelector(selector)
    if (!element) return { exists: false }
    const computed = window.getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const out = {
      exists: true,
      count: document.querySelectorAll(selector).length,
      x: Number(rect.x.toFixed(2)), y: Number(rect.y.toFixed(2)),
      width: Number(rect.width.toFixed(2)), height: Number(rect.height.toFixed(2)),
      textContent: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    }
    for (const key of keys) out[key] = computed[key]
    for (const [expectedKey, actualKey] of Object.entries(aliases)) out[expectedKey] = out[actualKey]
    return out
  }, { selector, keys, aliases: ALIASES })
}

if (cli.serve) {
  mkdirSync(harnessDir, { recursive: true })
  const routes = { '/harness/': harnessDir, '/hot/': path.join(os.homedir(), 'yandu-hot') }
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' }
  // Unknown paths get an unmistakable page rather than a bare "not found": the plugin's capture stage
  // happily photographs any http response, and a 2026-10-17 run turned the live screen's file:// url into
  // a 7 KB "not found" frame that compared as a real capture. Status stays 404 and the body says who owns it.
  const notFound = name => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>not a capture target</title></head>`
    + `<body style="margin:0;padding:24px;font:13px -apple-system,sans-serif;background:#fff0ee;color:#a33d36">`
    + `<b>404 — ${name}</b><br>this host serves only /harness/ and /hot/. The live window is frame-grabbed over CDP by tools/design-qa-cdp.mjs, not captured here.</body></html>`
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://${host}`)
    const entry = Object.entries(routes).find(([prefix]) => url.pathname.startsWith(prefix))
    if (!entry || request.method !== 'GET') { response.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(notFound(url.pathname)); return }
    const [prefix, baseDir] = entry
    const target = path.resolve(baseDir, url.pathname.slice(prefix.length))
    if (!target.startsWith(path.resolve(baseDir) + path.sep)) { response.writeHead(403).end('forbidden'); return }
    try {
      const body = await readFile(target)
      response.writeHead(200, { 'content-type': types[path.extname(target)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body)
    } catch {
      response.writeHead(404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(notFound(url.pathname))
    }
  })
  server.listen(servePort, host, () => console.log(JSON.stringify({ serving: harnessDir, url: snapshotUrl, hotRenderer: true })))
  process.on('SIGTERM', () => server.close())
  await new Promise(resolve => server.on('close', resolve))
} else if (cli.verify) {
  if (!existsSync(snapshotPath)) { console.error(`no snapshot at ${snapshotPath}; build it first`); process.exit(2) }
  if (anchors.length === 0) { console.error('no anchors configured for this screen in design.qa.yaml'); process.exit(2) }
  const { browser: liveBrowser, page: livePage } = await attachLive()
  const liveViewport = await livePage.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const launched = await chromium.launch({ headless: true })
  const context = await launched.newContext({ viewport: screen.app?.viewport || { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  const snapPage = await context.newPage()
  try {
    await snapPage.goto(snapshotUrl, { waitUntil: screen.app?.waitUntil || 'load', timeout: 45000 })
    if (screen.app?.waitForSelector) await snapPage.waitForSelector(screen.app.waitForSelector, { timeout: 15000 })
    const rows = []
    for (const anchor of anchors) {
      const keys = Object.keys(anchor.expected || {}).map(key => ALIASES[key] || key)
      const live = await measure(livePage, anchor.selector, STYLE_KEYS)
      const snap = await measure(snapPage, anchor.selector, STYLE_KEYS)
      for (const key of STYLE_KEYS) {
        const same = String(live[key]) === String(snap[key])
        rows.push({ selector: anchor.selector, key, live: live[key], snapshot: snap[key], status: !live.exists || !snap.exists ? 'MISSING' : same ? 'ok' : 'DRIFT' })
      }
      for (const key of keys.filter(name => GEOMETRY.has(name))) {
        const delta = Math.abs(Number(live[key]) - Number(snap[key]))
        rows.push({
          selector: anchor.selector, key: `${key}(px)`, live: live[key], snapshot: snap[key],
          status: !live.exists || !snap.exists ? 'MISSING' : delta <= 1 ? 'ok'
            : `DRIFT-GEOMETRY (live window ${liveViewport.width}x${liveViewport.height} vs configured ${(screen.app?.viewport || {}).width}x${(screen.app?.viewport || {}).height})`,
        })
      }
    }
    const drift = rows.filter(row => row.status === 'DRIFT' || row.status === 'MISSING' || row.status.startsWith('DRIFT'))
    console.log(JSON.stringify({ snapshotUrl, liveViewport, snapshotViewport: screen.app?.viewport, anchors: anchors.length, compared: rows.length, drift: drift.length, rows: drift.length ? rows.filter(row => row.status !== 'ok') : rows.map(({ selector, key, status }) => ({ selector, key, status })) }, null, 2))
    process.exitCode = drift.length ? 1 : 0
  } finally {
    await context.close(); await launched.close(); await liveBrowser.close()
  }
} else if (cli.axe) {
  // CSS-only regressions (contrast, typography) are measurable on the frozen frame, so a colour/token fix
  // can be verified without restarting the live window. The DOM half of that frame is still the old React
  // tree: structural rules such as `region` only clear once the new bundle actually runs.
  if (!existsSync(snapshotPath)) { console.error(`no snapshot at ${snapshotPath}; build it first`); process.exit(2) }
  const axePath = path.join(root, 'node_modules', 'axe-core', 'axe.min.js')
  if (!existsSync(axePath)) { console.error(`axe-core is not installed at ${axePath}`); process.exit(2) }
  const axeSource = readFileSync(axePath, 'utf8')
  let probe
  try {
    probe = await fetch(snapshotUrl)
  } catch {
    probe = null
  }
  if (!probe?.ok) {
    console.error(`snapshot host is not serving ${snapshotUrl}; start it with: node tools/design-qa-snapshot.mjs --screen shell-snapshot --serve`)
    process.exit(2)
  }
  const launched = await chromium.launch({ headless: true })
  const context = await launched.newContext({ viewport: screen.app?.viewport || { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' })
  const page = await context.newPage()
  try {
    await page.goto(snapshotUrl, { waitUntil: screen.app?.waitUntil || 'load', timeout: 45000 })
    if (screen.app?.waitForSelector) await page.waitForSelector(screen.app.waitForSelector, { timeout: 15000 })
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
        meta: { screen: screenName, url: snapshotUrl, ruleId: violation.id, helpUrl: violation.helpUrl, nodes: violation.nodes.length },
      }
    })
    const generatedAt = new Date().toISOString()
    const reportsDir = path.join(config.project.outputDir, 'reports')
    mkdirSync(reportsDir, { recursive: true })
    const outPath = path.join(reportsDir, 'a11y-snapshot.json')
    writeFileSync(outPath, JSON.stringify({
      ok: findings.every(f => f.severity !== 'blocker' && f.severity !== 'major'),
      generatedAt,
      scans: [{
        screen: screenName, url: snapshotUrl,
        viewport: { ...(screen.app?.viewport || { width: 1440, height: 900 }), devicePixelRatio: 1 },
        violations: result.violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, help: v.help, helpUrl: v.helpUrl, nodes: v.nodes.map(n => ({ target: n.target, html: n.html, failureSummary: n.failureSummary })) })),
        passes: result.passes?.length || 0, incomplete: result.incomplete?.length || 0, inapplicable: result.inapplicable?.length || 0,
      }],
      findings,
    }, null, 2) + '\n')
    console.log(JSON.stringify({
      wrote: outPath, screen: screenName, url: snapshotUrl, generatedAt,
      snapshotCss: JSON.parse(readFileSync(snapshotMetaPath, 'utf8')).stylesheets?.map(s => `${path.basename(s.file)}${s.hashSubstituted ? ' (hash-substituted)' : ''}`),
      violations: result.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, targets: v.nodes.map(n => n.target?.join(' ')), ratios: v.nodes.map(n => /contrast of ([\d.]+)/u.exec(n.failureSummary || '')?.[1]).filter(Boolean) })),
      passes: result.passes?.length || 0, incomplete: result.incomplete?.length || 0,
    }, null, 2))
    process.exitCode = findings.some(f => f.severity === 'blocker' || f.severity === 'major') ? 1 : 0
  } finally {
    await context.close(); await launched.close()
  }
} else {
  const { browser, page, target } = await attachLive()
  try {
    const mounted = await page.evaluate(() => (document.getElementById('root')?.childElementCount || 0) > 0)
    if (!mounted) throw new Error('renderer is not mounted; refusing to snapshot a blank frame')
    const sheetHrefs = await page.evaluate(() => [...document.querySelectorAll('link[rel="stylesheet"]')].map(link => link.getAttribute('href') || ''))
    const inlined = []
    for (const href of sheetHrefs) {
      const clean = href.replace(/^[./]+/, '').split('?')[0]
      const { file, substituted } = resolveStylesheet(clean)
      const css = readFileSync(file, 'utf8')
      if (/<\/style>/iu.test(css)) throw new Error(`stylesheet ${href} contains </style>; cannot inline safely`)
      inlined.push({ href, file, bytes: statSync(file).size, substituted, css })
    }
    const frame = await page.evaluate(() => {
      const doc = document.documentElement.cloneNode(true)
      doc.querySelectorAll('script, link[rel="stylesheet"], link[rel="modulepreload"], link[rel="icon"], link[rel="apple-touch-icon"]').forEach(node => node.remove())
      if (!doc.querySelector('head')) doc.prepend(document.createElement('head'))
      return {
        html: doc.outerHTML,
        state: {
          theme: document.documentElement.dataset.theme || 'light',
          effects: document.documentElement.dataset.effects || '',
          title: document.title,
          pageRoot: (() => { const el = document.querySelector('main > *'); return el ? `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]}` : null })(),
          buildStamp: (document.querySelector('.build-stamp')?.textContent || '').trim(),
          viewport: { width: window.innerWidth, height: window.innerHeight },
        },
      }
    })
    const head = /<head[^>]*>/iu.exec(frame.html)
    if (!head) throw new Error('serialized document has no <head> to inject styles into')
    const styleTags = inlined.map(sheet => `<style data-source="${sheet.file}">\n${sheet.css}\n</style>`).join('\n')
    const baseTag = `<base href="http://${host}:${servePort}/hot/renderer/">`
    const html = `<!DOCTYPE html>\n${frame.html.slice(0, head.index + head[0].length)}${baseTag}${styleTags}${frame.html.slice(head.index + head[0].length)}`
    mkdirSync(harnessDir, { recursive: true })
    writeFileSync(snapshotPath, html)
    const meta = {
      screen: screenName,
      generatedAt: new Date().toISOString(),
      sourceUrl: target.url,
      snapshotUrl,
      servedUrlExpected: screenUrl(config, screen),
      liveViewport: frame.state.viewport,
      configuredViewport: screen.app?.viewport || null,
      state: frame.state,
      cssRoot: cssRoot || null,
      stylesheets: inlined.map(sheet => ({ href: sheet.href, file: sheet.file, bytes: sheet.bytes, hashSubstituted: sheet.substituted })),
      htmlBytes: Buffer.byteLength(html),
      anchorSelectors: anchors.map(anchor => anchor.selector),
    }
    writeFileSync(snapshotMetaPath, JSON.stringify(meta, null, 2) + '\n')
    console.log(JSON.stringify({ wrote: snapshotPath, meta: snapshotMetaPath, htmlBytes: meta.htmlBytes, stylesheets: meta.stylesheets, liveViewport: meta.liveViewport, configuredViewport: meta.configuredViewport, state: frame.state }, null, 2))
    if (meta.configuredViewport && (meta.configuredViewport.width !== meta.liveViewport.width || meta.configuredViewport.height !== meta.liveViewport.height)) {
      console.error('NOTE: configuredViewport differs from the live window — geometry assertions will drift until design.qa.yaml viewport matches.')
    }
  } finally {
    await browser.close()
  }
}
