// 探针5：CDP Input.dispatchMouseEvent 无视口限制点击（Jersey 商品）
// 流程：记录按钮坐标（浅滚动时）→ 清空 query → 深处滚动 → 移除 disabled → CDP 可信鼠标事件点击原坐标
const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
delete process.env.ELECTRON_RUN_AS_NODE
const ROOT = path.resolve(__dirname, '..')

;(async () => {
  const app = await electron.launch({
    executablePath: path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
    args: ['.'], cwd: ROOT,
    env: { ...process.env, CODEX_UI_TEST: '1' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const existing = await page.evaluate(() => ({
    tokens: localStorage.getItem('sourcing.auth.tokens:v1'),
    profile: localStorage.getItem('sourcing.auth.profile:v1')
  }))
  if (!(existing.tokens && existing.profile)) {
    await page.evaluate(() => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'qa', refreshToken: 'qa', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify({ id: 'qa', email: '13400000000', name: '标题验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null }))
    })
  }
  const profile = JSON.parse(existing.profile || 'null') || { name: '标题验收' }
  await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }))
  await page.reload()
  await page.waitForSelector('.app-titlebar', { timeout: 30000 })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForTimeout(600)

  await page.click('.sidebar button:has-text("AI跨境")')
  await page.waitForSelector('.ai-crossborder-page', { timeout: 15000 })
  await page.click('.ai-crossborder-card:has-text("eBay")')
  await page.waitForSelector('.ai-crossborder-card:has-text("平台登录")', { timeout: 15000 })
  await page.click('.ai-crossborder-card:has-text("平台登录")')
  await page.waitForSelector('.ebay-platform-page', { timeout: 20000 })
  await page.waitForSelector('.ebay-business-nav', { timeout: 15000 })
  await page.click('.ebay-business-nav button:has-text("本地产品")')
  await page.waitForSelector('.ebay-local-products-layout', { timeout: 15000 })
  await page.waitForTimeout(800)
  const card = page.locator('.ebay-local-product-card', { hasText: 'Jersey Display Frame' }).first()
  await card.scrollIntoViewIfNeeded()
  await card.locator('.ebay-card-actions button.primary').click()
  await page.waitForSelector('.ebay-title-workbench', { timeout: 20000 })
  await page.waitForTimeout(800)

  // 清空 query
  await page.evaluate(`(() => { const el = document.querySelector('.ebay-market-controls input'); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await page.waitForTimeout(400)
  // 深处滚动
  const scrollBefore = await page.evaluate(`(() => { const ws = document.querySelector('.ebay-workspace'); ws.scrollTop = ws.scrollHeight; return { scrollTop: Math.round(ws.scrollTop), scrollHeight: Math.round(ws.scrollHeight), clientHeight: Math.round(ws.clientHeight) } })()`)
  await page.waitForTimeout(400)
  // 移除 disabled
  await page.evaluate(`(() => { document.querySelector('.ebay-market-actions button.primary').removeAttribute('disabled') })()`)
  // 深处滚动后取按钮当前视口坐标（可能为负）
  const btnRect = await page.evaluate(`(() => { const r = document.querySelector('.ebay-market-actions button.primary').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`)
  const cx = btnRect.x
  const cy = btnRect.y
  // CDP 可信鼠标事件（无视口边界限制）
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 })
  await page.waitForTimeout(2200)
  const state = await page.evaluate(`(() => {
    const el = document.querySelector('.ebay-error-notice')
    const ws = document.querySelector('.ebay-workspace')
    const r = el ? el.getBoundingClientRect() : null
    return {
      errorPresent: Boolean(el),
      errorText: el ? el.textContent.trim().slice(0, 120) : null,
      errorBox: r ? { y: Math.round(r.y), bottom: Math.round(r.bottom), height: Math.round(r.height) } : null,
      inViewport: r ? (r.height > 0 && r.y >= 0 && r.bottom <= window.innerHeight + 1) : false,
      scrollTopAfter: Math.round(ws.scrollTop),
      btnDisabled: document.querySelector('.ebay-market-actions button.primary')?.disabled
    }
  })()`)
  console.log(JSON.stringify({ cx: Math.round(cx), cy: Math.round(cy), scrollBefore, state }, null, 1))
  // 恢复
  if (state.errorPresent) await page.click('.ebay-error-notice button')
  await page.evaluate(`(() => { const el = document.querySelector('.ebay-market-controls input'); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; setter.call(el, 'Jersey Display Frame'); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await page.waitForTimeout(300)
  await app.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e && e.message); process.exit(1) })