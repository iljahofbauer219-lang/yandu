const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')
const qaProfile = { id: 'qa', email: '13400000000', name: '默认页验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null }
;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-default-'))
  const app = await electron.launch({ executablePath, args: ['--user-data-dir=' + userDataDir, '.'], cwd: path.resolve(__dirname, '..') })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
  await page.evaluate(profile => {
    localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'qa', refreshToken: 'qa', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
    localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
  }, qaProfile)
  await page.reload()
  await page.waitForSelector('.ai-employee-tab-bar', { timeout: 20000 })
  const state = await page.evaluate(() => ({
    aiEmployeeView: !!document.querySelector('.ai-employee-tab-bar'),
    homeActive: document.querySelector('.ai-employee-home-button')?.classList.contains('active') || false,
    greeting: !!document.querySelector('.ai-employee-greeting'),
    dashboardGone: !document.querySelector('.warehouse-dashboard'),
    sidebarActive: Array.from(document.querySelectorAll('nav button')).find(b => b.textContent.includes('AI员工'))?.classList.contains('nav-active') || false
  }))
  console.log('DEFAULT=' + JSON.stringify(state))
  await page.screenshot({ path: path.resolve(__dirname, '60-default-ai-employee.png') })
  await app.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
