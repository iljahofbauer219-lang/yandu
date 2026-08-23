// 探针6：错误触发因果定位（Jersey 商品）
// ① 清空 input 后按钮是否 disabled（验证 React state 更新）
// ② removeAttribute + dispatchEvent click 是否触发 handler
// ③ 兜底：React fiber onClick 直调
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

  const BTN = '.ebay-market-actions button.primary'
  const INPUT = '.ebay-market-controls input'
  const snap = tag => page.evaluate(`(() => ({
    tag: '${tag}',
    inputValue: document.querySelector('${INPUT}')?.value ?? null,
    btnDisabled: document.querySelector('${BTN}')?.disabled ?? null,
    btnText: document.querySelector('${BTN}')?.textContent.trim(),
    errorPresent: Boolean(document.querySelector('.ebay-error-notice'))
  }))()`)

  console.log(JSON.stringify(await snap('init')))
  // ① 清空 input
  await page.evaluate(`(() => { const el = document.querySelector('${INPUT}'); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; setter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await page.waitForTimeout(500)
  console.log(JSON.stringify(await snap('after-clear')))
  // 深处滚动
  const scrollBefore = await page.evaluate(`(() => { const ws = document.querySelector('.ebay-workspace'); ws.scrollTop = ws.scrollHeight; return Math.round(ws.scrollTop) })()`)
  await page.waitForTimeout(400)
  // ② removeAttribute + dispatchEvent
  await page.evaluate(`(() => { const b = document.querySelector('${BTN}'); b.removeAttribute('disabled'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })()`)
  await page.waitForTimeout(800)
  console.log(JSON.stringify(await snap('after-dispatch')))
  // ③ fiber onClick 直调
  const fiberResult = await page.evaluate(`(() => {
    const b = document.querySelector('${BTN}')
    const key = Object.keys(b).find(k => k.startsWith('__reactProps'))
    if (!key || !b[key] || typeof b[key].onClick !== 'function') return 'no-onclick'
    try { b[key].onClick({ preventDefault() {}, stopPropagation() {}, currentTarget: b, target: b }); return 'called' } catch (e) { return 'err:' + e.message }
  })()`)
  await page.waitForTimeout(1500)
  const after = await page.evaluate(`(() => {
    const el = document.querySelector('.ebay-error-notice')
    const ws = document.querySelector('.ebay-workspace')
    const r = el ? el.getBoundingClientRect() : null
    return {
      fiberResult: null,
      errorPresent: Boolean(el),
      errorText: el ? el.textContent.trim().slice(0, 120) : null,
      errorBox: r ? { y: Math.round(r.y), bottom: Math.round(r.bottom), height: Math.round(r.height) } : null,
      inViewport: r ? (r.height > 0 && r.y >= 0 && r.bottom <= window.innerHeight + 1) : false,
      scrollTopBefore: ${scrollBefore},
      scrollTopAfter: Math.round(ws.scrollTop),
      viewport: window.innerHeight
    }
  })()`)
  after.fiberResult = fiberResult
  console.log(JSON.stringify(after, null, 1))
  // 恢复
  if (after.errorPresent) await page.click('.ebay-error-notice button').catch(() => {})
  await page.evaluate(`(() => { const el = document.querySelector('${INPUT}'); const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; setter.call(el, 'Jersey Display Frame'); el.dispatchEvent(new Event('input', { bubbles: true })) })()`)
  await page.waitForTimeout(300)
  await app.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e && e.message); process.exit(1) })
