// 微探针：检索按钮 dispatch-click 行为定位
// a) 非空 query（按钮启用）时 dispatch click → handler 是否触发（busy 文案/notice）
// b) React 版本与根节点事件委托
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

  const meta = await page.evaluate(`(() => ({
    reactVersion: window.React ? window.React.version : null,
    rootKeys: Object.keys(document.getElementById('root') || {}).filter(k => k.startsWith('__react')).slice(0, 5),
    btnText: document.querySelector('.ebay-market-actions button.primary')?.textContent.trim(),
    btnDisabled: document.querySelector('.ebay-market-actions button.primary')?.disabled,
    query: document.querySelector('.ebay-market-controls input')?.value
  }))()`)
  console.log('META:', JSON.stringify(meta))

  // a) 按钮启用状态下 dispatch click（query 非空）— 观察 busy 文案，判定 handler 是否触发
  await page.evaluate(`(() => { const b = document.querySelector('.ebay-market-actions button.primary'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })()`)
  await page.waitForTimeout(400)
  const afterDispatch = await page.evaluate(`(() => ({
    btnText: document.querySelector('.ebay-market-actions button.primary')?.textContent.trim(),
    errorPresent: Boolean(document.querySelector('.ebay-error-notice')),
    successPresent: Boolean(document.querySelector('.ebay-success-notice'))
  }))()`)
  console.log('AFTER_DISPATCH_ENABLED:', JSON.stringify(afterDispatch))
  // 若触发了真实检索（busy 或后续 notice），等待结束并关闭 notice；不等待 OMKAR 全流程太久
  await page.waitForTimeout(8000)
  const later = await page.evaluate(`(() => ({
    btnText: document.querySelector('.ebay-market-actions button.primary')?.textContent.trim(),
    error: document.querySelector('.ebay-error-notice')?.textContent.trim().slice(0, 120) || null,
    success: document.querySelector('.ebay-success-notice')?.textContent.trim().slice(0, 120) || null
  }))()`)
  console.log('LATER:', JSON.stringify(later))
  await app.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e && e.message); process.exit(1) })
