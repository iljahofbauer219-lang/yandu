// 探针3：在 Jersey Display Frame 商品（188668034602）上用乱码核心商品词点「检索已成交市场数据」，
// 观察是触发 .ebay-error-notice（自然错误）还是成功。该商品不用于检查4/5。
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

  const originalQuery = await page.inputValue('.ebay-market-controls input')
  await page.fill('.ebay-market-controls input', 'zzqx nonsense gibberish 9999')
  await page.waitForTimeout(300)
  // 深处滚动后点击检索
  await page.evaluate(`(() => { const ws = document.querySelector('.ebay-workspace'); ws.scrollTop = ws.scrollHeight })()`)
  await page.waitForTimeout(400)
  await page.click('.ebay-market-actions button.primary')
  let outcome = 'unknown'
  try {
    await Promise.race([
      page.waitForSelector('.ebay-error-notice', { timeout: 45000 }).then(() => { outcome = 'error' }),
      page.waitForSelector('.ebay-success-notice', { timeout: 45000 }).then(() => { outcome = 'success' })
    ])
  } catch { outcome = 'timeout' }
  await page.waitForTimeout(1800)
  const state = await page.evaluate(`(() => {
    const err = document.querySelector('.ebay-error-notice')
    const ok = document.querySelector('.ebay-success-notice')
    const ws = document.querySelector('.ebay-workspace')
    return {
      error: err ? { text: err.textContent.trim().slice(0, 200), rect: err.getBoundingClientRect() } : null,
      success: ok ? ok.textContent.trim().slice(0, 160) : null,
      scrollTop: Math.round(ws.scrollTop),
      viewport: window.innerHeight
    }
  })()`)
  console.log(JSON.stringify({ originalQuery, outcome, state }, null, 1))
  await app.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e && e.message); process.exit(1) })
