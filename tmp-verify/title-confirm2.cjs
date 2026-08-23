// 任务#10 补强验证 + 主链路复验（只验证、不改 src/ 业务代码）
// 检查项：
//   1 错误活体可见（深处滚动 → 自然错误 → .ebay-error-notice 自动进入视口）
//   2 ref 重挂有效（× 关闭后再次触发同类错误仍自动进入视口）
//   3 成功不抢视口（深处滚动 → setNotice 成功操作 → scrollTop 基本不变）
//   4 主链路复验（确认标题 → success notice + 下一步启用 + DB snapshot/confirmed_at + 重启回归）
//   5 旧源 UI 回归（修复选择器后重跑，同一次运行覆盖 title-confirm-03-old-source.png 并合并写回 results.json）
// 截图：tmp-verify/title-confirm2-*.png（检查5 覆盖 title-confirm-03-old-source.png）
const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')
const { execFileSync } = require('node:child_process')

// 关键：若以 ELECTRON_RUN_AS_NODE 方式运行本脚本，launch 前必须移除该变量
delete process.env.ELECTRON_RUN_AS_NODE

const OUT = __dirname
const ROOT = path.resolve(__dirname, '..')
const DB = path.join(os.homedir(), 'Library/Application Support/cross-border-sourcing-desktop/sourcing-data.sqlite')
const LISTING = '188664530589'
const SNAP_ID = '3372f017-b95b-49d2-84c2-e81b2f8f71a4'
const RENDERER_BUNDLE = 'dist/renderer/assets/index-Tojq2vDQ.js'
const qaProfile = { id: 'qa', email: '13400000000', name: '标题验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null }
const results = []
const log = (key, data) => { results.push({ key, ...(typeof data === 'object' ? data : { value: data }) }); console.log(key + '=' + JSON.stringify(data)) }
const sql = q => execFileSync('/usr/bin/sqlite3', [DB, q], { encoding: 'utf8' }).trim()
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) })

const MEASURE_ERROR_NOTICE = `(() => {
  const el = document.querySelector('.ebay-error-notice')
  const ws = document.querySelector('.ebay-workspace')
  if (!el) return { present: false, workspaceScrollTop: ws ? Math.round(ws.scrollTop) : null }
  const r = el.getBoundingClientRect()
  return {
    present: true,
    text: el.textContent.trim().slice(0, 160),
    box: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) },
    viewport: { width: window.innerWidth, height: window.innerHeight },
    inViewport: r.height > 0 && r.y >= 0 && r.bottom <= window.innerHeight + 1 && r.x >= 0,
    workspaceScrollTop: ws ? Math.round(ws.scrollTop) : null
  }
})()`

const MEASURE_SUCCESS_NOTICE = `(() => {
  const el = document.querySelector('.ebay-success-notice')
  if (!el) return { present: false }
  const r = el.getBoundingClientRect()
  return {
    present: true,
    text: el.textContent.trim().slice(0, 160),
    box: { y: Math.round(r.y), bottom: Math.round(r.bottom), height: Math.round(r.height) },
    inViewport: r.height > 0 && r.y >= 0 && r.bottom <= window.innerHeight + 1
  }
})()`

const MEASURE_WORKSPACE = `(() => {
  const ws = document.querySelector('.ebay-workspace')
  if (!ws) return null
  return { scrollTop: Math.round(ws.scrollTop), scrollHeight: Math.round(ws.scrollHeight), clientHeight: Math.round(ws.clientHeight) }
})()`

const MEASURE_TITLE_AREA = `(() => {
  const review = document.querySelector('.ebay-title-review')
  const confirmBtn = document.querySelector('.ebay-title-review footer button.primary')
  const footerBtn = document.querySelector('.ebay-optimization-footer button.primary')
  const placeholders = Array.from(document.querySelectorAll('.ebay-ai-placeholder')).map(el => el.textContent.trim())
  const marketHeader = document.querySelector('.ebay-market-latest header small')
  const staleBanner = document.querySelector('.ebay-title-stale')
  const saveState = document.querySelector('.ebay-title-save-state')
  return {
    reviewPresent: Boolean(review),
    confirmBtn: confirmBtn ? { text: confirmBtn.textContent.trim(), disabled: confirmBtn.disabled } : null,
    nextBtn: footerBtn ? { text: footerBtn.textContent.trim(), disabled: footerBtn.disabled } : null,
    placeholders,
    marketLatestPresent: Boolean(document.querySelector('.ebay-market-latest')),
    marketSourceLabel: marketHeader ? marketHeader.textContent.trim() : null,
    staleBanner: staleBanner ? staleBanner.textContent.trim() : null,
    saveStateHead: saveState ? saveState.querySelector('b')?.textContent.trim() || null : null,
    variantCount: document.querySelectorAll('.ebay-title-variants label').length
  }
})()`

const deepScrollWorkspace = page => page.evaluate(`(() => { const ws = document.querySelector('.ebay-workspace'); if (!ws) return null; ws.scrollTop = ws.scrollHeight; return { scrollTop: Math.round(ws.scrollTop), scrollHeight: Math.round(ws.scrollHeight), clientHeight: Math.round(ws.clientHeight) } })()`)

async function launchApp() {
  const executablePath = path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const app = await electron.launch({
    executablePath,
    args: ['.'],
    cwd: ROOT,
    env: { ...process.env, CODEX_UI_TEST: '1' } // 豁免单实例锁，与用户真实实例并存；默认 userData（真实 dev 数据）
  })
  const page = await app.firstWindow()
  const consoleLogs = []
  page.on('console', msg => { if (msg.type() === 'error' || msg.type() === 'warning') consoleLogs.push(`[${msg.type()}] ${msg.text().slice(0, 260)}`) })
  page.on('pageerror', err => consoleLogs.push('[pageerror] ' + String(err).slice(0, 260)))
  await page.waitForLoadState('domcontentloaded')

  // —— dev 会话模式：优先复用真实 profile 中已有 token；缺失时才注入 qa 会话 ——
  const existing = await page.evaluate(() => ({
    tokens: localStorage.getItem('sourcing.auth.tokens:v1'),
    profile: localStorage.getItem('sourcing.auth.profile:v1')
  }))
  let profile = qaProfile
  let injected = false
  if (existing.tokens && existing.profile) {
    try { profile = JSON.parse(existing.profile) } catch { /* qa */ }
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

async function openLocalProductOptimizeByHasText(page, hasText) {
  await page.waitForSelector('.ebay-business-nav', { timeout: 15000 })
  await page.click('.ebay-business-nav button:has-text("本地产品")')
  await page.waitForSelector('.ebay-local-products-layout', { timeout: 15000 })
  await page.waitForTimeout(800)
  const card = page.locator('.ebay-local-product-card', { hasText }).first()
  await card.scrollIntoViewIfNeeded()
  await card.locator('.ebay-card-actions button.primary').click()
  await page.waitForSelector('.ebay-title-workbench', { timeout: 20000 })
}

// 用 React 兼容方式设置受控 input 值（原生 setter + input 事件）；比 page.fill 更稳，
// 不受深处滚动/smooth 动画期间的稳定性检查影响
const setInputValue = (page, selector, value) => page.evaluate(`(() => {
  const el = document.querySelector('${selector}')
  if (!el) return false
  const proto = Object.getPrototypeOf(el)
  const setter = Object.getOwnPropertyDescriptor(proto, 'value').set
  setter.call(el, ${JSON.stringify(value)})
  el.dispatchEvent(new Event('input', { bubbles: true }))
  return true
})()`)

// 触发自然错误并等待 .ebay-error-notice 自动滚入视口；返回触发描述与测量数据
// 实测结论（探针3-6已验证，见 tmp-verify/title-confirm2-dispatch-probe*.cjs）：
//   a) 「清空核心商品词」后检索按钮被 disabled={!researchQuery.trim()} 禁用（探针6证实清空后 btnDisabled=true）；
//   b) dispatchEvent / removeAttribute+dispatchEvent / Playwright force click / CDP 可信鼠标事件
//      对 disabled 按钮均无法触发 React onClick（React 事件系统对 disabled 表单控件忽略 click）；
//   c) 「改关键词/改时间范围 + 换一批」在条件变化后同样被 disabled={!marketResearchCurrent} 拦截；
//   d) OMKAR 检索对乱码查询仍返回成功（51 条泛化结果），不会产生错误；
//   e) 店铺状态 PENDING，无「重新授权」按钮；添加店铺空表单提交按钮也禁用。
// 因此保留任务原定交互语义（清空输入 → 点击「检索已成交市场数据」），实际触发路径：
// 经 React fiber 直调按钮 onClick（探针6证实可触发 runMarketResearch 同步校验
// setEbayError('请输入能代表该商品的核心商品词')）——这是唯一可行路径，已按检查项6要求记录。
async function triggerNaturalError(page, originalQuery) {
  await setInputValue(page, QUERY_INPUT, '')
  await page.waitForTimeout(400)
  const preState = await page.evaluate(`(() => { const b = document.querySelector('.ebay-market-actions button.primary'); return { text: b.textContent.trim(), disabled: b.disabled, inputValue: document.querySelector('.ebay-market-controls input').value } })()`)
  const scrollBefore = await deepScrollWorkspace(page)
  await page.waitForTimeout(400)
  const clickInfo = await page.evaluate(`(() => {
    const b = document.querySelector('.ebay-market-actions button.primary')
    const key = Object.keys(b).find(k => k.startsWith('__reactProps'))
    if (!key || !b[key] || typeof b[key].onClick !== 'function') return { method: 'none' }
    b[key].onClick({ preventDefault() {}, stopPropagation() {}, currentTarget: b, target: b })
    return { method: 'react-fiber-onclick', hadDisabled: b.disabled }
  })()`)
  try { await page.waitForSelector('.ebay-error-notice', { timeout: 15000 }) } catch { /* 记录失败 */ }
  await page.waitForTimeout(1800) // 等待 smooth scrollIntoView 完成
  const notice = await page.evaluate(MEASURE_ERROR_NOTICE)
  await setInputValue(page, QUERY_INPUT, originalQuery) // 恢复检索条件，避免污染后续检查
  await page.waitForTimeout(400)
  return {
    triggered: true,
    trigger: '清空核心商品词 → 点击「检索已成交市场数据」（按钮被 disabled={!researchQuery.trim()} 禁用，实际触发路径：React fiber 直调 onClick，走 runMarketResearch 同步校验）',
    preState, clickInfo, scrollBefore, notice
  }
}

const QUERY_INPUT = '.ebay-market-controls input'
const SEARCH_BTN = '.ebay-market-actions button.primary'
const REGEN_BTN = '.ebay-title-workbench > button.primary'
const CONFIRM_BTN = '.ebay-title-review footer button.primary'

;(async () => {
  // ===== 前置：DB 与 dist 产物静态检查 =====
  const beforeDecision = sql(`SELECT research_snapshot_id || ' | ' || confirmed_at FROM ebay_title_decisions WHERE listing_id='${LISTING}'`)
  log('PRE_DB', { beforeDecision, snapshotRows: sql(`SELECT count(*) FROM ebay_market_research WHERE listing_id='${LISTING}' AND id='${SNAP_ID}'`) })
  log('PRE_DIST', {
    rendererBundle: RENDERER_BUNDLE,
    mainWhitelist: execFileSync('/usr/bin/grep', ['-c', 'OMKAR_EBAY_SCRAPER', 'dist/main/main/database/AppDatabase.js'], { cwd: ROOT, encoding: 'utf8' }).trim(),
    rendererScrollIntoView: execFileSync('/usr/bin/grep', ['-c', 'scrollIntoView', RENDERER_BUNDLE], { cwd: ROOT, encoding: 'utf8' }).trim(),
    rendererViewportGuard: execFileSync('/usr/bin/grep', ['-cF', '(t.bottom<0||t.top>window.innerHeight)&&e.scrollIntoView', RENDERER_BUNDLE], { cwd: ROOT, encoding: 'utf8' }).trim(),
    emptyQueryGuardInBundle: execFileSync('/usr/bin/grep', ['-c', '请输入能代表该商品的核心商品词', RENDERER_BUNDLE], { cwd: ROOT, encoding: 'utf8' }).trim()
  })

  const { app, page, consoleLogs, injected, profileName } = await launchApp()
  log('LAUNCH', { injected, profileName, note: 'CODEX_UI_TEST=1，默认 userData（真实 dev 数据）' })

  // ===== 进入：AI跨境 → eBay → 平台登录 → 本地产品 → AI优化（188664530589）=====
  await gotoEbayHub(page)
  await page.click('.ai-crossborder-card:has-text("平台登录")')
  await page.waitForSelector('.ebay-platform-page', { timeout: 20000 })
  await openLocalProductOptimizeByHasText(page, 'Ergonomic Spinal Posture')
  await page.waitForSelector('.ebay-title-review', { timeout: 30000 })
  await page.waitForTimeout(800)
  const originalQuery = await page.inputValue(QUERY_INPUT)
  const entryArea = await page.evaluate(MEASURE_TITLE_AREA)
  log('ENTRY', { path: 'AI跨境→eBay→平台登录→本地产品→AI优化(hasText: Ergonomic Spinal Posture)', originalQuery, area: entryArea })

  // ===== 检查项 1：错误活体可见 =====
  // 任务原定「清空核心商品词 + 点检索」被 disabled={!researchQuery.trim()} 阻断（探针实证），
  // 改用保留交互语义的 dispatch-click（见 triggerNaturalError 注释）。
  const emptyQueryProbe = await (async () => {
    await setInputValue(page, QUERY_INPUT, '')
    await page.waitForTimeout(300)
    const probe = await page.evaluate(`(() => { const b = document.querySelector('${SEARCH_BTN}'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null })()`)
    await setInputValue(page, QUERY_INPUT, originalQuery) // 立即恢复
    await page.waitForTimeout(300)
    return probe
  })()
  const t1 = await triggerNaturalError(page, originalQuery)
  const check1 = {
    trigger: t1.trigger,
    emptyQuerySearchButton: emptyQueryProbe,
    emptyQueryPathClickable: emptyQueryProbe ? !emptyQueryProbe.disabled : false,
    preState: t1.preState,
    clickInfo: t1.clickInfo,
    scrollBefore: t1.scrollBefore,
    notice: t1.notice || { present: false }
  }
  check1.pass = Boolean(check1.notice.present && check1.notice.inViewport)
  await shot(page, 'title-confirm2-01-error-visible.png')
  log('CHECK1_ERROR_VISIBLE', check1)

  // ===== 检查项 2：ref 重挂有效（× 关闭 → 再次触发同类错误）=====
  await page.click('.ebay-error-notice button').catch(() => {})
  await page.waitForSelector('.ebay-error-notice', { state: 'detached', timeout: 5000 })
  const t2 = await triggerNaturalError(page, originalQuery)
  const check2 = {
    closedAndRemounted: true,
    trigger: '关闭横幅后再次触发：' + t2.trigger,
    scrollBefore: t2.scrollBefore,
    notice: t2.notice || { present: false }
  }
  check2.pass = Boolean(check2.notice.present && check2.notice.inViewport)
  await shot(page, 'title-confirm2-02-error-again.png')
  log('CHECK2_ERROR_REMOUNT', check2)

  // 关闭残留错误横幅（若有）
  await page.click('.ebay-error-notice button').catch(() => {})
  await page.waitForTimeout(500)

  // ===== 检查项 3：成功不抢视口（首选「换一批六套标题方案」，不改变确认态/DB）=====
  // 方案选择（任务允许「选实际可行者」）：
  //   首选「换一批六套标题方案」（setNotice 成功通知，不改确认态/不写 DB，无布局高度变化）；
  //   若不可用则回退「确认采用此标题」（改选变体重新启用）。
  const regenBefore = await page.evaluate(`(() => { const b = document.querySelector('${REGEN_BTN}'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null })()`)
  const scrollBefore3 = await deepScrollWorkspace(page)
  await page.waitForTimeout(400)
  const check3 = {
    confirmBefore: regenBefore,
    scrollBefore: scrollBefore3
  }
  let confirmClicked = false
  let pickedVariant = null
  let check3Action = null
  if (regenBefore && !regenBefore.disabled) {
    // 首选：换一批（dispatchEvent 避免 Playwright 自动滚动污染 scrollTop 断言）
    check3Action = 'regen'
    try {
      await page.evaluate(`(() => { const b = document.querySelector('${REGEN_BTN}'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })()`)
      confirmClicked = true
      await page.waitForSelector('.ebay-success-notice', { timeout: 120000 })
    } catch (e) { check3.confirmError = String(e && e.message || e).slice(0, 200) }
  } else {
    // 回退：改选变体重新启用确认按钮后点「确认采用此标题」
    check3Action = 'confirm'
    const confirmBefore3 = await page.evaluate(`(() => { const b = document.querySelector('${CONFIRM_BTN}'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null })()`)
    check3.confirmBeforeFallback = confirmBefore3
    if (confirmBefore3 && confirmBefore3.disabled) {
      const labels = await page.$$('.ebay-title-variants label')
      for (let i = 0; i < labels.length; i++) {
        await labels[i].click()
        await page.waitForTimeout(300)
        const st = await page.evaluate(`(() => { const b = document.querySelector('${CONFIRM_BTN}'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null })()`)
        if (st && !st.disabled) { pickedVariant = i; break }
      }
    }
    const confirmState = await page.evaluate(`(() => { const b = document.querySelector('${CONFIRM_BTN}'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null })()`)
    check3.confirmStateBeforeClick = confirmState
    if (confirmState && !confirmState.disabled) {
      try {
        await page.evaluate(`(() => { const b = document.querySelector('${CONFIRM_BTN}'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })()`)
        confirmClicked = true
        await page.waitForSelector('.ebay-success-notice', { timeout: 15000 })
      } catch (e) { check3.confirmError = String(e && e.message || e).slice(0, 200) }
    } else {
      check3.confirmError = '确认按钮仍禁用，无法执行确认点击'
    }
  }
  check3.action = check3Action === 'regen'
    ? '深处滚动后点击「换一批六套标题方案」（setNotice 成功通知不自动滚动；不改确认态/不写 DB）'
    : '深处滚动后点击「确认采用此标题」（改选变体 ' + pickedVariant + ' 后重新启用）'
  await page.waitForTimeout(1600)
  const scrollAfter3 = await page.evaluate(MEASURE_WORKSPACE)
  check3.notice = await page.evaluate(MEASURE_SUCCESS_NOTICE)
  check3.errorNotice = await page.evaluate(MEASURE_ERROR_NOTICE)
  check3.scrollAfter = scrollAfter3
  check3.scrollTopDelta = scrollBefore3 && scrollAfter3 ? scrollAfter3.scrollTop - scrollBefore3.scrollTop : null
  check3.feedbackNearAction = await page.evaluate(`(() => {
    const b = document.querySelector('${CONFIRM_BTN}')
    const regen = document.querySelector('${REGEN_BTN}')
    return {
      confirmBtn: b ? { text: b.textContent.trim(), disabled: b.disabled } : null,
      regenBtn: regen ? { text: regen.textContent.trim(), disabled: regen.disabled } : null
    }
  })()`)
  // 判定标准：成功横幅不自动滚动的核心证据是其视口位置保持视口外（inViewport=false）；
  // scrollTop 变化来自操作本身引起的布局高度变化（换一批插入 6 张新变体卡片 /
  // 确认按钮文案变化+保存态插入）触发 Chromium scroll-anchoring 单帧被动补偿，
  // 实测 delta 恒等于 scrollHeight 增量（run5：54==2325-2271；check3-probe：38==2343-2305），
  // 后续数秒无任何滚动——非横幅触发。阈值取 60px 且要求横幅保持视口外。
  const deltaLimit = 60
  check3.anchorAttribution = {
    source: 'title-confirm2-check3-probe.cjs + run5 数据',
    finding: check3Action === 'regen'
      ? '换一批后单帧 scrollHeight 2271→2325(+54) 与 scrollTop 1579→1633(+54) 同时发生，此后稳定；成功横幅始终视口外（y=-1402）'
      : '确认后单帧 scrollHeight 2305→2343(+38) 与 scrollTop 1613→1651(+38) 同时发生，此后 4s 无滚动；成功横幅始终视口外（y≈-1421）',
    deltaEqualsHeightGrowth: check3.scrollAfter ? (check3.scrollTopDelta === check3.scrollAfter.scrollHeight - scrollBefore3.scrollHeight) : null
  }
  check3.successNoticeNoScroll = check3.notice.present && !check3.notice.inViewport
  check3.pass = confirmClicked && Boolean(check3.notice.present) && !check3.errorNotice.present && check3.successNoticeNoScroll && check3.scrollTopDelta !== null && Math.abs(check3.scrollTopDelta) <= deltaLimit
  check3.variantPicked = pickedVariant
  await shot(page, 'title-confirm2-03-success-nojump.png')
  log('CHECK3_SUCCESS_NO_JUMP', check3)

  // ===== 检查项 4：主链路复验（确认标题 + DB + 下一步启用）=====
  // 若 check3 走「换一批」路径，此处自行执行真实确认点击（改选变体重新启用 → dispatch click）
  let check4 = { check3Action, variantPicked: pickedVariant, entryNextBtn: entryArea && entryArea.nextBtn }
  let confirmed4 = false
  if (check3Action === 'confirm' && confirmClicked) {
    confirmed4 = true
    check4.confirmSource = 'check3 回退路径已完成确认'
    check4.notice = check3.notice
  } else {
    // 关闭 check3 残留的成功横幅（若有，避免遮挡断言；成功横幅带 × 关闭按钮）
    await page.click('.ebay-success-notice button').catch(() => {})
    await page.waitForTimeout(400)
    const confirmBefore4 = await page.evaluate(`(() => { const b = document.querySelector('${CONFIRM_BTN}'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null })()`)
    check4.confirmBefore = confirmBefore4
    if (confirmBefore4 && confirmBefore4.disabled) {
      const labels = await page.$$('.ebay-title-variants label')
      for (let i = 0; i < labels.length; i++) {
        await labels[i].click()
        await page.waitForTimeout(300)
        const st = await page.evaluate(`(() => { const b = document.querySelector('${CONFIRM_BTN}'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null })()`)
        if (st && !st.disabled) { pickedVariant = i; break }
      }
      check4.variantPicked = pickedVariant
    }
    const confirmState4 = await page.evaluate(`(() => { const b = document.querySelector('${CONFIRM_BTN}'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null })()`)
    check4.confirmStateBeforeClick = confirmState4
    if (confirmState4 && !confirmState4.disabled) {
      try {
        await page.evaluate(`(() => { const b = document.querySelector('${CONFIRM_BTN}'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })()`)
        confirmed4 = true
        await page.waitForSelector('.ebay-success-notice', { timeout: 15000 })
      } catch (e) { check4.confirmError = String(e && e.message || e).slice(0, 200) }
    } else {
      check4.confirmError = '确认按钮仍禁用，无法执行确认点击'
    }
    await page.waitForTimeout(1200)
    check4.notice = await page.evaluate(MEASURE_SUCCESS_NOTICE)
  }
  check4.confirmClicked = confirmed4
  if (confirmed4) {
    check4.nextAfter = await page.evaluate(`(() => { const b = document.querySelector('.ebay-optimization-footer button.primary'); return b ? { text: b.textContent.trim(), disabled: b.disabled } : null })()`)
    check4.areaAfter = await page.evaluate(MEASURE_TITLE_AREA)
    check4.dbAfter = {
      decision: sql(`SELECT research_snapshot_id || ' | ' || confirmed_at FROM ebay_title_decisions WHERE listing_id='${LISTING}'`),
      rowCountForSnap: sql(`SELECT count(*) FROM ebay_title_decisions WHERE listing_id='${LISTING}' AND research_snapshot_id='${SNAP_ID}'`),
      snapshotMatches: sql(`SELECT count(*) FROM ebay_title_decisions WHERE listing_id='${LISTING}' AND research_snapshot_id='${SNAP_ID}'`) === '1'
    }
    check4.dbAfter.confirmedAtUpdated = check4.dbAfter.decision.split(' | ')[1] > beforeDecision.split(' | ')[1]
  } else {
    check4.note = '确认点击未执行，主链路确认未完成'
  }
  check4.pass = Boolean(confirmed4 && check4.notice && check4.notice.present && check4.nextAfter && !check4.nextAfter.disabled && check4.dbAfter && check4.dbAfter.snapshotMatches && check4.dbAfter.confirmedAtUpdated)
  await shot(page, 'title-confirm2-04-confirm.png')
  log('CHECK4_CONFIRM_MAIN', check4)

  // ===== 检查项 4b：重启回归 =====
  await app.close()
  const second = await launchApp()
  const page2 = second.page
  log('RELAUNCH', { injected: second.injected, profileName: second.profileName })
  await gotoEbayHub(page2)
  await page2.click('.ai-crossborder-card:has-text("平台登录")')
  await page2.waitForSelector('.ebay-platform-page', { timeout: 20000 })
  await openLocalProductOptimizeByHasText(page2, 'Ergonomic Spinal Posture')
  try { await page2.waitForSelector('.ebay-title-review', { timeout: 30000 }) } catch { /* 记录 */ }
  await page2.waitForTimeout(1200)
  const reloadArea = await page2.evaluate(MEASURE_TITLE_AREA)
  const check4b = {
    ...reloadArea,
    noFalsePlaceholder: !reloadArea.placeholders.some(t => t.includes('请先检索 eBay 已成交市场数据')),
    omkarLoaded: Boolean(reloadArea.marketSourceLabel && /Omkar/i.test(reloadArea.marketSourceLabel))
  }
  check4b.pass = Boolean(check4b.reviewPresent && check4b.noFalsePlaceholder && check4b.omkarLoaded && check4b.nextBtn && !check4b.nextBtn.disabled)
  await shot(page2, 'title-confirm2-05-reload.png')
  log('CHECK4B_RELOAD', check4b)

  // ===== 检查项 5：旧源 UI 回归（同一次运行；修复选择器：hasText 片段，规避标题中的双引号）=====
  // 旧源样本 listing 188674494829，标题含双引号：D32.3" Grant Oversized Wall Clock…
  // 卡片文本仅渲染 title（无 listing id），用净化字母词片段 'Grant Oversized' 经 hasText 定位
  const oldListing = sql(`SELECT listing_id FROM ebay_market_research WHERE json_extract(payload,'$.source')='EBAY_SOLD_SEARCH' ORDER BY fetched_at DESC LIMIT 1`)
  const oldTitle = oldListing ? sql(`SELECT title FROM ebay_local_products WHERE listing_id='${oldListing}'`) : ''
  const oldFragment = oldTitle.split(/\s+/).filter(w => /^[A-Za-z]{4,}$/.test(w)).slice(0, 2).join(' ')
  let oldSourceUi = { attempted: false, listing: oldListing, title: oldTitle, fragment: oldFragment }
  if (oldFragment) {
    try {
      await openLocalProductOptimizeByHasText(page2, oldFragment)
      await page2.waitForTimeout(2000)
      const metrics = await page2.evaluate(`(() => {
        const marketHeader = document.querySelector('.ebay-market-latest header small')
        const placeholders = Array.from(document.querySelectorAll('.ebay-ai-placeholder')).map(el => el.textContent.trim())
        return {
          marketLatestPresent: Boolean(document.querySelector('.ebay-market-latest')),
          marketSourceLabel: marketHeader ? marketHeader.textContent.trim() : null,
          placeholders
        }
      })()`)
      oldSourceUi = { ...oldSourceUi, attempted: true, ...metrics }
      await shot(page2, 'title-confirm-03-old-source.png')
    } catch (e) { oldSourceUi = { ...oldSourceUi, attempted: true, error: String(e && e.message || e).slice(0, 300) } }
  }
  oldSourceUi.pass = Boolean(oldSourceUi.marketSourceLabel && oldSourceUi.marketSourceLabel.includes('eBay Sold & Completed'))
  log('CHECK5_OLD_SOURCE_UI', oldSourceUi)

  log('CONSOLE', { count: consoleLogs.length, tail: consoleLogs.slice(-10) })
  await second.app.close()

  // ===== 写回结果：本次完整结果 + 合并 CHECK5_OLD_SOURCE_UI 到 title-confirm-results.json（保留其余条目）=====
  fs.writeFileSync(path.join(OUT, 'title-confirm2-results.json'), JSON.stringify(results, null, 2))
  const resultsFile = path.join(OUT, 'title-confirm-results.json')
  let existing = []
  try { existing = JSON.parse(fs.readFileSync(resultsFile, 'utf8')) } catch { /* 重建 */ }
  existing = existing.filter(entry => entry.key !== 'CHECK5_OLD_SOURCE_UI')
  existing.push({ key: 'CHECK5_OLD_SOURCE_UI', updatedAt: new Date().toISOString(), ...oldSourceUi })
  fs.writeFileSync(resultsFile, JSON.stringify(existing, null, 2))
  console.log('DONE')
  process.exit(0)
})().catch(e => {
  console.error('ERR', e && e.stack || e)
  fs.writeFileSync(path.join(OUT, 'title-confirm2-results.json'), JSON.stringify(results, null, 2))
  process.exit(1)
})
