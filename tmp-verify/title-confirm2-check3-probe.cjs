// CHECK3 归因探针：确认点击后 scrollTop +38px 的来源
// 假设：按钮文案变化（确认采用此标题→标题已确认）与保存态行导致 .ebay-workspace
// 内容高度增加，浏览器锚定滚动条比例引起 scrollTop 被动上移；成功横幅本身不触发滚动（其 y=-1421 视口外即为证据）。
// 方法：高频采样 scrollTop 与 scrollHeight；成功横幅不挂 ref，无法直接观测其 effect。
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
  await page.waitForSelector('.ebay-title-review', { timeout: 30000 })
  await page.waitForTimeout(800)

  const CONFIRM = '.ebay-title-review footer button.primary'
  // 已确认态 → 改选变体重新启用
  let st = await page.evaluate(`(() => { const b = document.querySelector('${CONFIRM}'); return { text: b.textContent.trim(), disabled: b.disabled } })()`)
  if (st.disabled) {
    const labels = await page.$$('.ebay-title-variants label')
    for (let i = 0; i < labels.length; i++) {
      await labels[i].click()
      await page.waitForTimeout(300)
      st = await page.evaluate(`(() => { const b = document.querySelector('${CONFIRM}'); return { text: b.textContent.trim(), disabled: b.disabled } })()`)
      if (!st.disabled) break
    }
  }
  // 安装采样器 + 滚动侦听（记录每一次 scrollTop 变化的时间与原因线索）
  await page.evaluate(`(() => {
    const ws = document.querySelector('.ebay-workspace')
    window.__samples = []
    const rec = (tag) => window.__samples.push({ t: performance.now(), tag, scrollTop: Math.round(ws.scrollTop), scrollHeight: Math.round(ws.scrollHeight), successPresent: Boolean(document.querySelector('.ebay-success-notice')), btnText: (document.querySelector('.ebay-title-review footer button.primary') || {}).textContent })
    let last = ws.scrollTop
    ws.addEventListener('scroll', () => { rec('scroll'); last = ws.scrollTop }, { passive: true })
    window.__rec = rec
    const iv = setInterval(() => rec('tick'), 100)
    window.__iv = iv
    rec('install')
  })()`)
  // 深处滚动
  const before = await page.evaluate(`(() => { const ws = document.querySelector('.ebay-workspace'); ws.scrollTop = ws.scrollHeight; return { scrollTop: Math.round(ws.scrollTop), scrollHeight: Math.round(ws.scrollHeight) } })()`)
  await page.waitForTimeout(500)
  await page.evaluate(`(() => window.__rec('deepscroll-done'))()`)
  // dispatch 确认点击
  await page.evaluate(`(() => { const b = document.querySelector('.ebay-title-review footer button.primary'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window })) })()`)
  await page.waitForTimeout(4000)
  await page.evaluate(`(() => clearInterval(window.__iv))()`)
  const out = await page.evaluate(`(() => {
    const s = window.__samples
    const first = s[0]
    return {
      samplesCount: s.length,
      series: s.map(x => ({ dt: Math.round(x.t - first.t), tag: x.tag, st: x.scrollTop, sh: x.scrollHeight, ok: x.successPresent, btn: (x.btnText || '').trim().slice(0, 10) }))
    }
  })()`)
  console.log(JSON.stringify({ before, ...out }, null, 0))
  // 恢复：再次确认回原变体不必要；直接关闭
  await app.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e && e.message); process.exit(1) })
