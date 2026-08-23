// 验证任务#3：eBay 店铺采集页布局修复（main/header 选择器 scope 化）效果与回归面
// 只读验证，不改业务代码。截图输出到 tmp-verify/ebay-layout-*.png
const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')

const OUT = __dirname
const qaProfile = { id: 'qa', email: '13400000000', name: '布局验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null }
const results = []
const log = (key, data) => { results.push({ key, ...data }); console.log(key + '=' + JSON.stringify(data)) }

const box = selector => `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) }
})()`

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-ebay-layout-'))
  const app = await electron.launch({ executablePath, args: ['--user-data-dir=' + userDataDir, '.'], cwd: path.resolve(__dirname, '..') })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // —— 登录：复用 verify-sysadmin-layout.cjs 的 dev 会话模式 ——
  await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
  await page.evaluate(profile => {
    localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'qa', refreshToken: 'qa', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
    localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
  }, qaProfile)
  await page.reload()
  await page.waitForSelector('.app-titlebar', { timeout: 30000 })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(500)

  // —— 导航：AI跨境 → eBay → 平台登录 ——
  await page.click('.sidebar button:has-text("AI跨境")')
  await page.waitForSelector('.ai-crossborder-page', { timeout: 15000 })
  await page.click('.ai-crossborder-card:has-text("eBay")')
  await page.waitForSelector('.ai-crossborder-card:has-text("平台登录")', { timeout: 15000 })
  await page.click('.ai-crossborder-card:has-text("平台登录")')
  await page.waitForSelector('.ebay-platform-page', { timeout: 20000 })
  await page.waitForTimeout(800)

  // —— 无店铺时通过真实 UI 添加一个测试店铺（走真实 IPC）——
  const hasStore = await page.evaluate(() => Boolean(document.querySelector('.ebay-browser-layout')))
  if (!hasStore) {
    await page.click('.ebay-add-store-card')
    await page.waitForSelector('.ebay-store-dialog', { timeout: 10000 })
    const inputs = await page.$$('.ebay-store-dialog input')
    await inputs[0].fill('验收测试店')
    await inputs[1].fill('qa-test-user')
    await inputs[2].fill('qa-test-password-123')
    await page.click('.ebay-store-dialog button.primary')
    await page.waitForSelector('.ebay-browser-layout', { timeout: 30000 })
  }
  await page.waitForTimeout(2500)

  // ===== 检查项 1：店铺采集布局 =====
  const m1 = await page.evaluate(`(() => {
    const wb = document.querySelector('.ebay-login-workbench')
    const panel = document.querySelector('.ebay-browser-panel')
    const mainEl = document.querySelector('.app-shell > main')
    if (!wb || !panel) return { missing: !wb ? 'workbench' : 'panel' }
    const wr = wb.getBoundingClientRect(), pr = panel.getBoundingClientRect(), mr = mainEl ? mainEl.getBoundingClientRect() : null
    const rows = ['.ebay-browser-heading', '.ebay-browser-tabs', '.ebay-address-bar', '.ebay-browser-slot'].map(s => Boolean(document.querySelector(s)))
    const slot = document.querySelector('.ebay-browser-slot')
    const slotRect = slot ? slot.getBoundingClientRect() : null
    const webviews = Array.from(document.querySelectorAll('webview')).map(w => { const r = w.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })
    const cs = getComputedStyle(panel)
    const mainCs = mainEl ? getComputedStyle(mainEl) : null
    return {
      workbench: { x: Math.round(wr.x), y: Math.round(wr.y), width: Math.round(wr.width), height: Math.round(wr.height), right: Math.round(wr.right), bottom: Math.round(wr.bottom) },
      panel: { x: Math.round(pr.x), y: Math.round(pr.y), width: Math.round(pr.width), height: Math.round(pr.height), right: Math.round(pr.right), bottom: Math.round(pr.bottom) },
      main: mr ? { x: Math.round(mr.x), y: Math.round(mr.y), width: Math.round(mr.width), height: Math.round(mr.height), right: Math.round(mr.right), bottom: Math.round(mr.bottom) } : null,
      mainGridArea: mainCs ? mainCs.gridArea : null,
      panelGridRows: cs.gridTemplateRows,
      rowsPresent: rows,
      slot: slotRect ? { x: Math.round(slotRect.x), y: Math.round(slotRect.y), width: Math.round(slotRect.width), height: Math.round(slotRect.height) } : null,
      webviews,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    }
  })()`)
  log('CHECK1_COLLECTION', m1)
  await page.screenshot({ path: path.join(OUT, 'ebay-layout-01-collection.png') })

  // ===== 检查项 2：AI 客服页 =====
  await page.click('.sidebar button:has-text("AI总部")')
  await page.waitForSelector('.ai-crossborder-card:has-text("AI客服")', { timeout: 15000 })
  await page.click('.ai-crossborder-card:has-text("AI客服")')
  await page.waitForSelector('.support-workspace', { timeout: 15000 })
  await page.waitForTimeout(500)
  const m2 = await page.evaluate(`(() => {
    const conv = document.querySelector('.conversation-pane')
    const chat = document.querySelector('.chat-pane')
    const ctx = document.querySelector('.context-pane')
    const ws = document.querySelector('.support-workspace')
    if (!chat || !ws) return { missing: 'chat/workspace' }
    const cr = conv.getBoundingClientRect(), hr = chat.getBoundingClientRect(), xr = ctx.getBoundingClientRect(), wr = ws.getBoundingClientRect()
    const cs = getComputedStyle(ws)
    return {
      workspace: { x: Math.round(wr.x), y: Math.round(wr.y), width: Math.round(wr.width), height: Math.round(wr.height) },
      gridColumns: cs.gridTemplateColumns,
      conversation: { x: Math.round(cr.x), y: Math.round(cr.y), width: Math.round(cr.width), right: Math.round(cr.right) },
      chat: { x: Math.round(hr.x), y: Math.round(hr.y), width: Math.round(hr.width), height: Math.round(hr.height), right: Math.round(hr.right), bottom: Math.round(hr.bottom) },
      context: { x: Math.round(xr.x), y: Math.round(xr.y), width: Math.round(xr.width), right: Math.round(xr.right) },
      sameTop: Math.abs(cr.y - hr.y) <= 2 && Math.abs(hr.y - xr.y) <= 2,
      chatInMiddleColumn: Math.abs(hr.x - cr.right) <= 4 && Math.abs(xr.x - hr.right) <= 4,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    }
  })()`)
  log('CHECK2_SUPPORT', m2)
  await page.screenshot({ path: path.join(OUT, 'ebay-layout-02-support.png') })

  // ===== 检查项 3a：回归 —— eBay 其余 tab（线上产品 / 本地产品）=====
  await page.click('.sidebar button:has-text("AI跨境")')
  await page.waitForSelector('.ai-crossborder-card:has-text("eBay")', { timeout: 15000 })
  await page.click('.ai-crossborder-card:has-text("eBay")')
  await page.waitForSelector('.ai-crossborder-card:has-text("平台登录")', { timeout: 15000 })
  await page.click('.ai-crossborder-card:has-text("平台登录")')
  await page.waitForSelector('.ebay-platform-page', { timeout: 20000 })
  await page.waitForSelector('.ebay-business-nav', { timeout: 10000 })
  await page.click('.ebay-business-nav button:has-text("线上产品")')
  await page.waitForTimeout(1200)
  const m3 = await page.evaluate(`(() => {
    const mainEl = document.querySelector('.app-shell > main')
    const pageEl = document.querySelector('.ebay-platform-page')
    const heading = document.querySelector('.ebay-page-heading h2')
    return {
      tabTitle: heading ? heading.textContent : null,
      pageBox: pageEl ? (() => { const r = pageEl.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom) } })() : null,
      mainBox: mainEl ? (() => { const r = mainEl.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } })() : null,
      noHScroll: pageEl ? pageEl.scrollWidth <= pageEl.clientWidth + 2 : null,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    }
  })()`)
  log('CHECK3_TAB_ONLINE', m3)
  await page.screenshot({ path: path.join(OUT, 'ebay-layout-03-tab-online.png') })

  await page.click('.ebay-business-nav button:has-text("本地产品")')
  await page.waitForTimeout(1200)
  const m4 = await page.evaluate(`(() => {
    const pageEl = document.querySelector('.ebay-platform-page')
    const heading = document.querySelector('.ebay-page-heading h2')
    return {
      tabTitle: heading ? heading.textContent : null,
      pageBox: pageEl ? (() => { const r = pageEl.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom) } })() : null,
      noHScroll: pageEl ? pageEl.scrollWidth <= pageEl.clientWidth + 2 : null
    }
  })()`)
  log('CHECK3_TAB_LOCAL', m4)
  await page.screenshot({ path: path.join(OUT, 'ebay-layout-04-tab-local.png') })

  // ===== 检查项 3b：暗色主题下的店铺采集 =====
  await page.click('.ebay-business-nav button:has-text("店铺采集")')
  await page.waitForSelector('.ebay-browser-layout', { timeout: 15000 })
  await page.waitForTimeout(500)
  await page.click('.titlebar-theme-wrap > button')
  await page.waitForSelector('.titlebar-theme-menu', { timeout: 5000 })
  await page.click('.titlebar-theme-menu button:has-text("深色")')
  await page.waitForTimeout(800)
  const m5 = await page.evaluate(`(() => {
    const theme = document.documentElement.getAttribute('data-theme')
    const wb = document.querySelector('.ebay-login-workbench')
    const panel = document.querySelector('.ebay-browser-panel')
    const mainEl = document.querySelector('.app-shell > main')
    const pick = el => { const r = el.getBoundingClientRect(); const c = getComputedStyle(el); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom), bg: c.backgroundColor } }
    return {
      theme,
      workbench: wb ? pick(wb) : null,
      panel: panel ? pick(panel) : null,
      mainBg: mainEl ? getComputedStyle(mainEl).backgroundColor : null,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    }
  })()`)
  log('CHECK3_DARK', m5)
  await page.screenshot({ path: path.join(OUT, 'ebay-layout-05-dark.png') })

  // ===== 检查项 3c：窄窗（1050px）店铺采集 =====
  await page.click('.titlebar-theme-wrap > button')
  await page.waitForSelector('.titlebar-theme-menu', { timeout: 5000 })
  await page.click('.titlebar-theme-menu button:has-text("浅色")')
  await page.waitForTimeout(500)
  await page.setViewportSize({ width: 1050, height: 760 })
  await page.waitForTimeout(1000)
  const m6 = await page.evaluate(`(() => {
    const wb = document.querySelector('.ebay-login-workbench')
    const panel = document.querySelector('.ebay-browser-panel')
    const layout = document.querySelector('.ebay-browser-layout')
    const mainEl = document.querySelector('.app-shell > main')
    const r = el => el ? { x: Math.round(el.getBoundingClientRect().x), width: Math.round(el.getBoundingClientRect().width), right: Math.round(el.getBoundingClientRect().right), bottom: Math.round(el.getBoundingClientRect().bottom), height: Math.round(el.getBoundingClientRect().height) } : null
    return {
      layoutColumns: layout ? getComputedStyle(layout).gridTemplateColumns : null,
      workbench: r(wb),
      panel: r(panel),
      mainRight: mainEl ? Math.round(mainEl.getBoundingClientRect().right) : null,
      docHScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
      docScrollWidth: document.documentElement.scrollWidth,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    }
  })()`)
  log('CHECK3_NARROW', m6)
  await page.screenshot({ path: path.join(OUT, 'ebay-layout-06-narrow.png') })

  await app.close()
  fs.writeFileSync(path.join(OUT, 'ebay-layout-results.json'), JSON.stringify(results, null, 2))
  console.log('DONE')
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); fs.writeFileSync(path.join(OUT, 'ebay-layout-results.json'), JSON.stringify(results, null, 2)); process.exit(1) })
