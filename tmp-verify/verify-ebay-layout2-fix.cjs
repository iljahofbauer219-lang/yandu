// 验证任务#5：两处回归修复 + eBay 店铺采集页不回退（只读验证，不改业务代码）
// 修复1: styles.css `.warehouse-dashboard-card header` 补 display:flex 等
// 修复2: theme-dark.css L79 暗色 publishing/comparison 区块背景 rgba(255,255,255,.06)
// 说明: 经 grep 全量核实，warehouse-dashboard / publishing(CENTER) / sourcing 比价页
//       在当前 UI 中无任何导航入口（App.tsx 不存在 setPage('warehouse-dashboard')，
//       publishing 仅能经 image-studio 带选品进入，comparison 页需先有供应仓候选数据）。
//       按任务预案，前 3 项采用「真实 CSS + 注入同结构 DOM」的 computed 断言；
//       第 4 项 eBay 店铺采集页走真实 UI 导航复核。
const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')

const OUT = __dirname
const qaProfile = { id: 'qa', email: '13400000000', name: '布局验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null }
const results = []
const log = (key, data) => { results.push({ key, ...data }); console.log(key + '=' + JSON.stringify(data)) }

// —— 注入结构 1：仓库总览卡片（与 App.tsx L1391-1392 同结构）——
const CARD_HTML = `
<section class="warehouse-dashboard" id="qa-inject-card" style="position:fixed;inset:0;z-index:9999;background:var(--bg,#f5f6f7);overflow:auto;padding:16px 18px;">
  <div class="warehouse-dashboard-grid">
    <article class="warehouse-dashboard-card">
      <header><div><b>1688供应仓</b><small>货源采集与候选管理</small></div><i class="idle">空闲</i></header>
      <dl><div><dt>采集候选</dt><dd>0</dd></div><div><dt>优选产品</dt><dd>0</dd></div><div><dt>待比价</dt><dd>0</dd></div><div><dt>正式入库</dt><dd>0</dd></div></dl>
      <p>暂无采集任务记录</p>
      <footer><button>查看本地候选</button><button class="primary">进入1688</button></footer>
    </article>
  </div>
</section>`

// —— 注入结构 2：Ozon 发布工作区三栏（与 App.tsx L1562 同结构骨架）——
const PUBLISH_HTML = `
<div class="publishing-layout" id="qa-inject-publish" style="position:fixed;inset:0;z-index:9999;">
  <aside class="publishing-control"><div class="publish-card"><b>Ozon发布账号</b></div></aside>
  <main class="publishing-workspace"><div class="publishing-heading"><div><b>Ozon商品发布</b><small>从Ozon平台选品库生成发布草稿</small></div></div></main>
  <aside class="publishing-checklist"><div><b>发布资料检查</b></div></aside>
</div>`

// —— 注入结构 3：AI比价页（与 App.tsx L1709 SupplyPlatformComparisonWorkspace 同结构骨架）——
const COMPARISON_HTML = `
<section class="warehouse-comparison-page" id="qa-inject-compare" style="position:fixed;inset:0;z-index:9999;">
  <aside><small>WAREHOUSE PRICE RULES</small><h2>1688 · AI比价</h2></aside>
  <main><div class="warehouse-page-heading"><b>1688货源横向对比</b></div></main>
</section>`

;(async () => {
  // 本脚本以 ELECTRON_RUN_AS_NODE 方式运行；启动被测 Electron 前必须移除该变量，否则子进程以 node 模式启动
  delete process.env.ELECTRON_RUN_AS_NODE
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-ebay-layout2-'))
  const app = await electron.launch({ executablePath, args: ['--user-data-dir=' + userDataDir, '.'], cwd: path.resolve(__dirname, '..') })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  // —— dev 会话登录（复用任务#3模式）——
  await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
  await page.evaluate(profile => {
    localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'qa', refreshToken: 'qa', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
    localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
  }, qaProfile)
  await page.reload()
  await page.waitForSelector('.app-titlebar', { timeout: 30000 })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(600)

  // ===== 检查项 1：仓库总览卡片头部（亮色）=====
  const theme0 = await page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  const m1 = await page.evaluate(html => {
    document.body.insertAdjacentHTML('beforeend', html)
    const header = document.querySelector('#qa-inject-card .warehouse-dashboard-card header')
    const left = header.querySelector('div')
    const badge = header.querySelector('i')
    const cs = getComputedStyle(header)
    const lr = left.getBoundingClientRect(), br = badge.getBoundingClientRect()
    const out = {
      theme: document.documentElement.getAttribute('data-theme'),
      headerDisplay: cs.display,
      headerAlignItems: cs.alignItems,
      headerJustify: cs.justifyContent,
      left: { x: Math.round(lr.x), yCenter: Math.round(lr.y + lr.height / 2) },
      badge: { x: Math.round(br.x), yCenter: Math.round(br.y + br.height / 2) },
      sameLine: Math.abs((lr.y + lr.height / 2) - (br.y + br.height / 2)) <= 4,
      badgeRightOfDiv: br.x > lr.x,
      cardWidth: Math.round(header.closest('.warehouse-dashboard-card').getBoundingClientRect().width)
    }
    return out
  }, CARD_HTML)
  log('CHECK1_WAREHOUSE_CARD', m1)
  await page.screenshot({ path: path.join(OUT, 'ebay-layout2-01-warehouse-card.png') })
  await page.evaluate(() => document.getElementById('qa-inject-card').remove())

  // ===== 检查项 2：暗色 Ozon 发布工作区 =====
  await page.click('.titlebar-theme-wrap > button')
  await page.waitForSelector('.titlebar-theme-menu', { timeout: 5000 })
  await page.click('.titlebar-theme-menu button:has-text("深色")')
  await page.waitForTimeout(800)
  const m2 = await page.evaluate(html => {
    document.body.insertAdjacentHTML('beforeend', html)
    const ws = document.querySelector('#qa-inject-publish main.publishing-workspace')
    const control = document.querySelector('#qa-inject-publish aside.publishing-control')
    const checklist = document.querySelector('#qa-inject-publish aside.publishing-checklist')
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      workspaceBg: getComputedStyle(ws).backgroundColor,
      workspaceBorder: getComputedStyle(ws).borderColor,
      controlBg: getComputedStyle(control).backgroundColor,
      checklistBg: getComputedStyle(checklist).backgroundColor
    }
  }, PUBLISH_HTML)
  log('CHECK2_PUBLISHING_DARK', m2)
  await page.screenshot({ path: path.join(OUT, 'ebay-layout2-02-publishing-dark.png') })
  await page.evaluate(() => document.getElementById('qa-inject-publish').remove())

  // ===== 检查项 3：暗色 AI 比价页 =====
  const m3 = await page.evaluate(html => {
    document.body.insertAdjacentHTML('beforeend', html)
    const pageEl = document.querySelector('#qa-inject-compare')
    const aside = pageEl.querySelector(':scope > aside')
    const main = pageEl.querySelector(':scope > main')
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      mainBg: getComputedStyle(main).backgroundColor,
      mainBorder: getComputedStyle(main).borderColor,
      asideBg: getComputedStyle(aside).backgroundColor,
      asideBorder: getComputedStyle(aside).borderColor
    }
  }, COMPARISON_HTML)
  log('CHECK3_COMPARISON_DARK', m3)
  await page.screenshot({ path: path.join(OUT, 'ebay-layout2-03-comparison-dark.png') })
  await page.evaluate(() => document.getElementById('qa-inject-compare').remove())

  // 切回浅色
  await page.click('.titlebar-theme-wrap > button')
  await page.waitForSelector('.titlebar-theme-menu', { timeout: 5000 })
  await page.click('.titlebar-theme-menu button:has-text("浅色")')
  await page.waitForTimeout(600)

  // ===== 检查项 4：eBay 店铺采集页不回退（亮色，真实 UI 导航）=====
  await page.click('.sidebar button:has-text("AI跨境")')
  await page.waitForSelector('.ai-crossborder-page', { timeout: 15000 })
  await page.click('.ai-crossborder-card:has-text("eBay")')
  await page.waitForSelector('.ai-crossborder-card:has-text("平台登录")', { timeout: 15000 })
  await page.click('.ai-crossborder-card:has-text("平台登录")')
  await page.waitForSelector('.ebay-platform-page', { timeout: 20000 })
  await page.waitForTimeout(800)
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
  await page.waitForTimeout(2000)
  const m4 = await page.evaluate(`(() => {
    const wb = document.querySelector('.ebay-login-workbench')
    const panel = document.querySelector('.ebay-browser-panel')
    if (!wb || !panel) return { missing: !wb ? 'workbench' : 'panel' }
    const wr = wb.getBoundingClientRect(), pr = panel.getBoundingClientRect()
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      workbench: { x: Math.round(wr.x), y: Math.round(wr.y), width: Math.round(wr.width), height: Math.round(wr.height), right: Math.round(wr.right), bottom: Math.round(wr.bottom) },
      panel: { x: Math.round(pr.x), y: Math.round(pr.y), width: Math.round(pr.width), height: Math.round(pr.height), right: Math.round(pr.right), bottom: Math.round(pr.bottom) },
      sameTop: Math.abs(wr.y - pr.y) <= 2,
      panelGap: Math.round(pr.x - wr.right),
      panelBottomInViewport: pr.bottom <= window.innerHeight + 1,
      viewport: { width: window.innerWidth, height: window.innerHeight }
    }
  })()`)
  log('CHECK4_EBAY_COLLECTION', m4)
  await page.screenshot({ path: path.join(OUT, 'ebay-layout2-04-collection.png') })

  await app.close()
  fs.writeFileSync(path.join(OUT, 'ebay-layout2-results.json'), JSON.stringify(results, null, 2))
  console.log('DONE')
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); fs.writeFileSync(path.join(OUT, 'ebay-layout2-results.json'), JSON.stringify(results, null, 2)); process.exit(1) })
