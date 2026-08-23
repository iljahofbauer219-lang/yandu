const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')
const qaProfile = { id: 'qa', email: '13400000000', name: '窗口按钮验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null }
const controls = page => page.evaluate(() => {
  const bar = document.querySelector('.app-titlebar .win-window-controls')
  const buttons = bar ? Array.from(bar.querySelectorAll('button')).map(b => b.title) : []
  return { count: bar ? bar.querySelectorAll('button').length : 0, titles: buttons, closeExists: !!bar?.querySelector('.win-close') }
})
;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-winbtn-'))
  const app = await electron.launch({ executablePath, args: ['--user-data-dir=' + userDataDir, '.'], cwd: path.resolve(__dirname, '..') })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
  await page.evaluate(profile => {
    localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'qa', refreshToken: 'qa', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
    localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
  }, qaProfile)
  await page.reload()
  await page.waitForSelector('.app-titlebar', { timeout: 20000 })
  // 1) darwin 默认：不渲染自绘按钮组（回归）
  console.log('MAC_DEFAULT=' + JSON.stringify(await controls(page)))

  // 2) 模拟 win32：按钮组出现且功能可用
  await page.evaluate(() => localStorage.setItem('qa.platform', 'win32'))
  await page.reload()
  await page.waitForSelector('.app-titlebar .win-window-controls', { timeout: 15000 })
  console.log('WIN_CONTROLS=' + JSON.stringify(await controls(page)))
  await page.screenshot({ path: path.resolve(__dirname, '58-win-controls-titlebar.png') })
  // 最大化 → 图标切换为还原；再还原
  await page.click('.app-titlebar .win-window-controls button[title="最大化"]')
  await page.waitForTimeout(500)
  const maxState = await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; return { isMaximized: w.isMaximized() } })
  const restoreTitle = await page.evaluate(() => document.querySelector('.app-titlebar .win-window-controls button:nth-child(2)')?.title)
  console.log('MAXIMIZE=' + JSON.stringify({ ...maxState, secondButtonTitle: restoreTitle }))
  await page.click('.app-titlebar .win-window-controls button[title="向下还原"]')
  await page.waitForTimeout(500)
  console.log('RESTORE=' + JSON.stringify(await app.evaluate(({ BaseWindow }) => ({ isMaximized: BaseWindow.getAllWindows()[0].isMaximized() }))))
  // 最小化 → 恢复
  await page.click('.app-titlebar .win-window-controls button[title="最小化"]')
  await page.waitForTimeout(600)
  const minState = await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; return w.isMinimized() })
  console.log('MINIMIZE=' + JSON.stringify({ isMinimized: minState }))
  await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows()[0].restore())
  await page.waitForTimeout(400)

  // 3) 登录页（win32）右上角同样有控制按钮
  await page.evaluate(() => { localStorage.removeItem('sourcing.auth.tokens:v1'); localStorage.removeItem('sourcing.auth.profile:v1') })
  await page.reload()
  await page.waitForSelector('.auth-screen', { timeout: 15000 })
  const authControls = await page.evaluate(() => ({
    visible: !!document.querySelector('.auth-win-controls'),
    count: document.querySelectorAll('.auth-win-controls button').length
  }))
  console.log('LOGIN_CONTROLS=' + JSON.stringify(authControls))
  await page.screenshot({ path: path.resolve(__dirname, '59-win-controls-login.png') })

  // 4) 关闭按钮真实关闭窗口
  await page.click('.auth-win-controls .win-close')
  await page.waitForTimeout(800)
  const windowsLeft = await app.evaluate(({ BaseWindow }) => BaseWindow.getAllWindows().length).catch(() => 0)
  console.log('CLOSE=' + JSON.stringify({ windowsLeft }))
  await app.close().catch(() => {})
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
