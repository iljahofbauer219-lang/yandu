// 任务#8 补充验证：旧 EBAY_SOLD_SEARCH 快照商品在 AI优化页的市场数据加载（只读，不点击确认）
// 截图：tmp-verify/title-confirm-03-old-source.png
const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')
const { execFileSync } = require('node:child_process')
delete process.env.ELECTRON_RUN_AS_NODE

const OUT = __dirname
const DB = path.join(os.homedir(), 'Library/Application Support/cross-border-sourcing-desktop/sourcing-data.sqlite')
const qaProfile = { id: 'qa', email: '13400000000', name: '标题验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null }
const sql = q => execFileSync('/usr/bin/sqlite3', [DB, q], { encoding: 'utf8' }).trim()

;(async () => {
  const listing = sql(`SELECT listing_id FROM ebay_market_research WHERE json_extract(payload,'$.source')='EBAY_SOLD_SEARCH' ORDER BY fetched_at DESC LIMIT 1`)
  const title = sql(`SELECT title FROM ebay_local_products WHERE listing_id='${listing}'`)
  const fragment = title.split(/\s+/).filter(w => /^[A-Za-z]{4,}$/.test(w)).slice(0, 2).join(' ')
  console.log('OLD_SOURCE_LISTING=' + JSON.stringify({ listing, title, fragment }))

  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const app = await electron.launch({ executablePath, args: ['.'], cwd: path.resolve(__dirname, '..'), env: { ...process.env, CODEX_UI_TEST: '1' } })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  const existing = await page.evaluate(() => ({ tokens: localStorage.getItem('sourcing.auth.tokens:v1'), profile: localStorage.getItem('sourcing.auth.profile:v1') }))
  let profile = qaProfile
  if (!(existing.tokens && existing.profile)) {
    await page.evaluate(p => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'qa', refreshToken: 'qa', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(p))
    }, qaProfile)
  } else { try { profile = JSON.parse(existing.profile) } catch {} }
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
  const card = page.locator(`.ebay-local-product-card:has-text("${fragment}")`).first()
  await card.scrollIntoViewIfNeeded()
  await card.locator('.ebay-card-actions button.primary').click()
  await page.waitForSelector('.ebay-title-workbench', { timeout: 20000 })
  await page.waitForTimeout(2000)
  const metrics = await page.evaluate(`(() => {
    const marketHeader = document.querySelector('.ebay-market-latest header small')
    const summary = Array.from(document.querySelectorAll('.ebay-market-summary span')).map(el => el.textContent.trim())
    const placeholders = Array.from(document.querySelectorAll('.ebay-ai-placeholder')).map(el => el.textContent.trim())
    const terms = document.querySelector('.ebay-market-latest-terms')
    return {
      marketLatestPresent: Boolean(document.querySelector('.ebay-market-latest')),
      marketSourceLabel: marketHeader ? marketHeader.textContent.trim() : null,
      summary,
      placeholders,
      confirmedTermsVisible: terms ? terms.textContent.slice(0, 200) : null
    }
  })()`)
  console.log('OLD_SOURCE_UI=' + JSON.stringify(metrics))
  await page.screenshot({ path: path.join(OUT, 'title-confirm-03-old-source.png') })
  await app.close()
  console.log('DONE')
  process.exit(0)
})().catch(e => { console.error('ERR', e && e.message); process.exit(1) })
