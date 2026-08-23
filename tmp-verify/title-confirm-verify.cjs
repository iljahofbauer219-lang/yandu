// 验证任务#8：「确认采用此标题」修复效果运行时验证（只验证、不改业务代码）
// 修复点：1) AppDatabase 市场快照读取白名单追加 OMKAR_EBAY_SCRAPER
//         2) App.tsx 通知横幅(notice/ebayError) ref+useEffect scrollIntoView 自动进入视口
// 数据：真实 dev 数据 listing 188664530589 / 快照 3372f017-b95b-49d2-84c2-e81b2f8f71a4
// 截图：tmp-verify/title-confirm-*.png
const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')
const { execFileSync } = require('node:child_process')

// 关键：若以 ELECTRON_RUN_AS_NODE 方式运行本脚本，launch 前必须移除该变量
delete process.env.ELECTRON_RUN_AS_NODE

const OUT = __dirname
const DB = path.join(os.homedir(), 'Library/Application Support/cross-border-sourcing-desktop/sourcing-data.sqlite')
const LISTING = '188664530589'
const SNAP_ID = '3372f017-b95b-49d2-84c2-e81b2f8f71a4'
const qaProfile = { id: 'qa', email: '13400000000', name: '标题验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null }
const results = []
const log = (key, data) => { results.push({ key, ...(typeof data === 'object' ? data : { value: data }) }); console.log(key + '=' + JSON.stringify(data)) }
const sql = q => execFileSync('/usr/bin/sqlite3', [DB, q], { encoding: 'utf8' }).trim()
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) })

const MEASURE_TITLE_AREA = `(() => {
  const review = document.querySelector('.ebay-title-review')
  const confirmBtn = document.querySelector('.ebay-title-review footer button.primary')
  const footerBtn = document.querySelector('.ebay-optimization-footer button.primary')
  const placeholders = Array.from(document.querySelectorAll('.ebay-ai-placeholder')).map(el => el.textContent.trim())
  const marketLatest = document.querySelector('.ebay-market-latest')
  const marketHeader = document.querySelector('.ebay-market-latest header small')
  const staleBanner = document.querySelector('.ebay-title-stale')
  const saveState = document.querySelector('.ebay-title-save-state')
  const auditFooter = document.querySelector('.ebay-title-review footer > div')
  const variantCount = document.querySelectorAll('.ebay-title-variants label').length
  const marketTermHits = Array.from(document.querySelectorAll('.ebay-title-review small')).map(el => el.textContent).filter(t => t.includes('命中市场词'))
  return {
    reviewPresent: Boolean(review),
    confirmBtn: confirmBtn ? { text: confirmBtn.textContent.trim(), disabled: confirmBtn.disabled } : null,
    nextBtn: footerBtn ? { text: footerBtn.textContent.trim(), disabled: footerBtn.disabled } : null,
    placeholders,
    marketLatestPresent: Boolean(marketLatest),
    marketSourceLabel: marketHeader ? marketHeader.textContent.trim() : null,
    staleBanner: staleBanner ? staleBanner.textContent.trim() : null,
    saveState: saveState ? saveState.textContent.replace(/\\s+/g, ' ').trim() : null,
    auditFooter: auditFooter ? auditFooter.textContent.trim() : null,
    variantCount,
    marketTermHitsSample: marketTermHits.slice(0, 2)
  }
})()`

const MEASURE_NOTICE = `(() => {
  const notice = document.querySelector('.ebay-success-notice')
  const err = document.querySelector('.ebay-error-notice')
  const el = notice || err
  if (!el) return { present: false }
  const r = el.getBoundingClientRect()
  return {
    present: true,
    kind: notice ? 'success' : 'error',
    text: el.textContent.trim(),
    box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom) },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    inViewport: r.height > 0 && r.y >= 0 && r.bottom <= window.innerHeight + 1 && r.x >= 0
  }
})()`

async function launchApp() {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const app = await electron.launch({
    executablePath,
    args: ['.'],
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, CODEX_UI_TEST: '1' } // 豁免单实例锁，与用户真实实例并存；不传 --user-data-dir，使用真实 dev 数据
  })
  const page = await app.firstWindow()
  const consoleLogs = []
  page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') consoleLogs.push(`[${msg.type()}] ${msg.text().slice(0, 300)}`) })
  page.on('pageerror', err => consoleLogs.push('[pageerror] ' + String(err).slice(0, 300)))
  await page.waitForLoadState('domcontentloaded')

  // —— dev 会话模式：优先复用真实 profile 中已有 token（不污染真实会话）；缺失时才注入 qa 会话 ——
  const existing = await page.evaluate(() => ({
    tokens: localStorage.getItem('sourcing.auth.tokens:v1'),
    profile: localStorage.getItem('sourcing.auth.profile:v1')
  }))
  let profile = qaProfile
  let injected = false
  if (existing.tokens && existing.profile) {
    try { profile = JSON.parse(existing.profile) } catch { /* fall back to qa */ }
  } else {
    await page.evaluate(p => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'qa', refreshToken: 'qa', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(p))
    }, qaProfile)
    injected = true
  }
  await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }))
  await page.reload()
  await page.waitForSelector('.app-titlebar', { timeout: 30000 })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(600)
  return { app, page, consoleLogs, injected, profileName: profile.name || profile.email }
}

async function gotoEbayHub(page) {
  await page.click('.sidebar button:has-text("AI跨境")')
  await page.waitForSelector('.ai-crossborder-page', { timeout: 15000 })
  await page.click('.ai-crossborder-card:has-text("eBay")')
  await page.waitForSelector('.ai-crossborder-card:has-text("平台登录")', { timeout: 15000 })
}

async function openLocalProductOptimize(page, titleFragment) {
  await page.waitForSelector('.ebay-business-nav', { timeout: 15000 })
  await page.click('.ebay-business-nav button:has-text("本地产品")')
  await page.waitForSelector('.ebay-local-products-layout', { timeout: 15000 })
  await page.waitForTimeout(800)
  const card = page.locator(`.ebay-local-product-card:has-text("${titleFragment}")`).first()
  await card.scrollIntoViewIfNeeded()
  await card.locator('.ebay-card-actions button.primary').click()
  await page.waitForSelector('.ebay-title-workbench', { timeout: 20000 })
}

;(async () => {
  // ===== 检查项 0：前置 DB 状态 =====
  const beforeDecision = sql(`SELECT research_snapshot_id || ' | ' || confirmed_at FROM ebay_title_decisions WHERE listing_id='${LISTING}'`)
  const beforeSnapshot = sql(`SELECT id || ' | ' || json_extract(payload,'$.source') FROM ebay_market_research WHERE listing_id='${LISTING}'`)
  log('PRE_DB', { beforeDecision, beforeSnapshot })
  log('PRE_DIST', {
    mainWhitelist: execFileSync('/usr/bin/grep', ['-c', 'OMKAR_EBAY_SCRAPER', 'dist/main/main/database/AppDatabase.js'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }).trim(),
    rendererScroll: execFileSync('/usr/bin/grep', ['-c', 'scrollIntoView', 'dist/renderer/assets/index-V-6Bfp7q.js'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' }).trim()
  })

  const { app, page, consoleLogs, injected, profileName } = await launchApp()
  log('LAUNCH', { injected, profileName, note: 'CODEX_UI_TEST=1，默认 userData（真实 dev 数据）' })

  // ===== 检查项 1a：进入路径 A —— AI跨境 → eBay → 标题优化（独立工作台，商品网址启动）=====
  await gotoEbayHub(page)
  await page.click('.ai-crossborder-card:has-text("标题优化")')
  await page.waitForSelector('.ebay-title-url-form', { timeout: 20000 })
  await page.fill('.ebay-title-url-row input', `https://www.ebay.com/itm/${LISTING}`)
  await page.click('.ebay-title-url-row button.primary')
  let entryA = { path: 'AI跨境→eBay→标题优化→输入商品网址→读取产品' }
  try {
    await page.waitForSelector('.ebay-title-review', { timeout: 30000 })
    entryA = { ...entryA, ...(await page.evaluate(MEASURE_TITLE_AREA)) }
  } catch {
    entryA = { ...entryA, reviewTimeout: true, placeholders: await page.evaluate(`Array.from(document.querySelectorAll('.ebay-ai-placeholder')).map(el=>el.textContent.trim())`), urlError: await page.evaluate(`document.querySelector('.ebay-title-url-error')?.textContent||''`) }
  }
  log('CHECK1_ENTRY_A_URL', entryA)

  // ===== 检查项 1b/2：进入路径 B —— eBay平台 → AI优化（本地产品卡片进入），点击确认 =====
  await gotoEbayHub(page)
  await page.click('.ai-crossborder-card:has-text("平台登录")')
  await page.waitForSelector('.ebay-platform-page', { timeout: 20000 })
  await openLocalProductOptimize(page, 'Ergonomic Spinal Posture')
  // 等待市场快照与标题方案自动恢复（DB 持久化）
  let restored = null
  try { await page.waitForSelector('.ebay-title-review', { timeout: 30000 }); restored = await page.evaluate(MEASURE_TITLE_AREA) }
  catch { restored = await page.evaluate(MEASURE_TITLE_AREA) }
  log('CHECK1_ENTRY_B_PLATFORM', { path: 'AI跨境→eBay→平台登录→本地产品→AI优化(Ergonomic…)', ...restored })

  // 「下一步：描述优化」点击前状态
  const nextBefore = await page.evaluate(`(() => { const b = document.querySelector('.ebay-optimization-footer button.primary'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null })()`)
  log('CHECK2_NEXT_BEFORE', nextBefore)

  // 若确认按钮被禁用（审核未过），逐一套用变体寻找可通过审核的方案
  let confirmState = await page.evaluate(`(() => { const b = document.querySelector('.ebay-title-review footer button.primary'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null })()`)
  if (confirmState && confirmState.disabled && confirmState.text === '确认采用此标题') {
    const labels = await page.$$('.ebay-title-variants label')
    for (let i = 0; i < labels.length; i++) {
      await labels[i].click()
      await page.waitForTimeout(300)
      confirmState = await page.evaluate(`(() => { const b = document.querySelector('.ebay-title-review footer button.primary'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null })()`)
      if (confirmState && !confirmState.disabled) { log('CHECK2_VARIANT_FALLBACK', { pickedIndex: i, text: confirmState.text }); break }
    }
  }
  log('CHECK2_CONFIRM_BEFORE', confirmState)

  let check2 = { clicked: false }
  if (confirmState && !confirmState.disabled && confirmState.text === '确认采用此标题') {
    await page.click('.ebay-title-review footer button.primary')
    check2.clicked = true
    try { await page.waitForSelector('.ebay-success-notice', { timeout: 15000 }) } catch { /* 记录失败 */ }
    await page.waitForTimeout(1100) // smooth scroll 完成
    check2.notice = await page.evaluate(MEASURE_NOTICE)
    const nextAfter = await page.evaluate(`(() => { const b = document.querySelector('.ebay-optimization-footer button.primary'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null })()`)
    check2.nextAfter = nextAfter
    check2.areaAfter = await page.evaluate(MEASURE_TITLE_AREA)
    check2.dbAfter = {
      decision: sql(`SELECT research_snapshot_id || ' | ' || confirmed_at FROM ebay_title_decisions WHERE listing_id='${LISTING}'`),
      rowCount: sql(`SELECT count(*) FROM ebay_title_decisions WHERE listing_id='${LISTING}' AND research_snapshot_id='${SNAP_ID}'`)
    }
  } else {
    check2.errorNotice = await page.evaluate(MEASURE_NOTICE)
  }
  await shot(page, 'title-confirm-01-confirmed.png')
  log('CHECK2_CONFIRM_CLICK', check2)

  // ===== 检查项 3：错误横幅可见性机制佐证 =====
  log('CHECK3_ERROR_MECHANISM', {
    evidence: '机制同源佐证：App.tsx 中 notice 与 ebayError 共用 ebayNoticeRef（两处 ref={ebayNoticeRef}），同一 useEffect([notice,ebayError]) 触发 scrollIntoView({behavior:smooth,block:center})；dist 产物已含该调用；2a 成功即同机制对 ebayError 生效',
    sameRefCodePresent: true,
    naturalErrorTriggered: false
  })

  // ===== 检查项 5：旧源回归（DB 只读）——先取数，UI 回归在重启后顺路做 =====
  const oldSourceDb = {
    currentSoldSearch: sql(`SELECT count(*) FROM ebay_market_research WHERE json_extract(payload,'$.source')='EBAY_SOLD_SEARCH'`),
    historySoldSearch: sql(`SELECT count(*) FROM ebay_market_research_history WHERE json_extract(payload,'$.source')='EBAY_SOLD_SEARCH'`),
    sampleOldListing: sql(`SELECT listing_id FROM ebay_market_research WHERE json_extract(payload,'$.source')='EBAY_SOLD_SEARCH' ORDER BY fetched_at DESC LIMIT 1`)
  }
  log('CHECK5_OLD_SOURCE_DB', oldSourceDb)

  // ===== 检查项 4：重启回归 =====
  await app.close()
  const second = await launchApp()
  const page2 = second.page
  log('RELAUNCH', { injected: second.injected, profileName: second.profileName })
  await gotoEbayHub(page2)
  await page2.click('.ai-crossborder-card:has-text("平台登录")')
  await page2.waitForSelector('.ebay-platform-page', { timeout: 20000 })
  await openLocalProductOptimize(page2, 'Ergonomic Spinal Posture')
  let reloadArea = null
  try { await page2.waitForSelector('.ebay-title-review', { timeout: 30000 }) } catch { /* 记录 */ }
  await page2.waitForTimeout(1200)
  reloadArea = await page2.evaluate(MEASURE_TITLE_AREA)
  reloadArea.noFalsePlaceholder = !reloadArea.placeholders.some(t => t.includes('请先检索 eBay 已成交市场数据'))
  reloadArea.omkarLoaded = reloadArea.marketSourceLabel && /Omkar/i.test(reloadArea.marketSourceLabel)
  log('CHECK4_RELOAD', reloadArea)
  await shot(page2, 'title-confirm-02-reload.png')

  // ===== 检查项 5（UI）：旧 EBAY_SOLD_SEARCH 快照商品加载 =====
  let oldSourceUi = { attempted: false }
  if (oldSourceDb.sampleOldListing) {
    const oldTitle = sql(`SELECT title FROM ebay_local_products WHERE listing_id='${oldSourceDb.sampleOldListing}'`)
    if (oldTitle) {
      try {
        // 标题可能含引号等特殊字符，净化后取前两个词作为 has-text 片段
        const fragment = oldTitle.split(/\s+/).filter(w => /^[A-Za-z]{4,}$/.test(w)).slice(0, 2).join(' ')
        await openLocalProductOptimize(page2, fragment)
        await page2.waitForTimeout(1500)
        oldSourceUi = { attempted: true, listing: oldSourceDb.sampleOldListing, ...(await page2.evaluate(MEASURE_TITLE_AREA)) }
        await shot(page2, 'title-confirm-03-old-source.png')
      } catch (e) { oldSourceUi = { attempted: true, listing: oldSourceDb.sampleOldListing, error: e.message } }
    }
  }
  log('CHECK5_OLD_SOURCE_UI', oldSourceUi)

  log('CONSOLE', { count: consoleLogs.length, tail: consoleLogs.slice(-12) })
  await second.app.close()
  fs.writeFileSync(path.join(OUT, 'title-confirm-results.json'), JSON.stringify(results, null, 2))
  console.log('DONE')
  process.exit(0)
})().catch(e => {
  console.error('ERR', e && e.stack || e)
  fs.writeFileSync(path.join(OUT, 'title-confirm-results.json'), JSON.stringify(results, null, 2))
  process.exit(1)
})
