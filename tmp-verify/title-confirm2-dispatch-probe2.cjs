// 探针2：a) dispatchEvent 点击启用的模式切换按钮是否触发 React onClick（判定 disabled 是否为拦截原因）
//        b) 恢复核心商品词为 "Ergonomic Spinal Posture"（清除上一轮失败脚本残留的 " verify" 后缀）
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

  // a) dispatchEvent 点击启用按钮（描述优化模式切换）
  const beforeMode = await page.evaluate(`document.querySelector('.ebay-optimize-layout aside button.active')?.textContent.trim() || null`)
  await page.evaluate(`(() => { const b = Array.from(document.querySelectorAll('.ebay-optimize-layout aside button')).find(x => x.textContent.includes('描述优化')); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })()`)
  await page.waitForTimeout(500)
  const afterMode = await page.evaluate(`document.querySelector('.ebay-optimize-layout aside button.active')?.textContent.trim() || null`)
  // 切回标题优化
  await page.click('.ebay-optimize-layout aside button:has-text("标题优化")')
  await page.waitForTimeout(400)

  // b) 恢复核心商品词
  await page.fill('.ebay-market-controls input', 'Ergonomic Spinal Posture')
  await page.waitForTimeout(500)
  const restored = await page.evaluate(`(() => ({ query: document.querySelector('.ebay-market-controls input').value, stale: Boolean(document.querySelector('.ebay-market-stale')), marketLabel: document.querySelector('.ebay-market-latest header small')?.textContent.trim() || null }))()`)
  console.log(JSON.stringify({ beforeMode, afterMode, dispatchOnEnabledWorks: beforeMode !== afterMode, restored }))
  await app.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e && e.message); process.exit(1) })
