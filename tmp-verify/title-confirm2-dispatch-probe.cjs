// 探针：清空核心商品词后，dispatchEvent 点击 disabled 的「检索已成交市场数据」能否触发 React onClick → setEbayError
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
  const card = page.locator('.ebay-local-product-card', { hasText: 'Ergonomic Spinal Posture' }).first()
  await card.scrollIntoViewIfNeeded()
  await card.locator('.ebay-card-actions button.primary').click()
  await page.waitForSelector('.ebay-title-workbench', { timeout: 20000 })
  await page.waitForTimeout(800)

  const originalQuery = await page.inputValue('.ebay-market-controls input')
  // 清空核心商品词
  await page.fill('.ebay-market-controls input', '')
  await page.waitForTimeout(300)
  const btnState = await page.evaluate(`(() => { const b = document.querySelector('.ebay-market-actions button.primary'); return { text: b.textContent.trim(), disabled: b.disabled } })()`)
  // dispatchEvent 模拟点击（任务原定交互：清空后点击检索）
  const dispatched = await page.evaluate(`(() => { const b = document.querySelector('.ebay-market-actions button.primary'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })); return true })()`)
  await page.waitForTimeout(900)
  const errorNotice = await page.evaluate(`(() => { const el = document.querySelector('.ebay-error-notice'); return el ? { present: true, text: el.textContent.trim().slice(0, 120) } : { present: false } })()`)
  console.log(JSON.stringify({ originalQuery, btnState, dispatched, errorNotice }))
  // 关闭横幅并恢复 query
  if (errorNotice.present) await page.click('.ebay-error-notice button')
  await page.fill('.ebay-market-controls input', originalQuery)
  await page.waitForTimeout(400)
  const restored = await page.evaluate(`(() => ({ query: document.querySelector('.ebay-market-controls input').value, errorPresent: Boolean(document.querySelector('.ebay-error-notice')) }))()`)
  console.log('RESTORED:', JSON.stringify(restored))
  await app.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e && e.message); process.exit(1) })
