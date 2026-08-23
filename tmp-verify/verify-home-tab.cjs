const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')
const qaProfile = { id: 'qa', email: '13400000000', name: '首页验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null }
const state = page => page.evaluate(() => ({
  homeActive: document.querySelector('.ai-employee-home-button')?.classList.contains('active') || false,
  processActive: Array.from(document.querySelectorAll('.ai-employee-tab')).find(t => t.textContent.includes('工作处理'))?.classList.contains('active') || false,
  greeting: !!document.querySelector('.ai-employee-greeting'),
  workEmpty: !!document.querySelector('.ai-employee-work-empty'),
  composer: !!document.querySelector('.ai-employee-floating-composer'),
  archiveActive: Array.from(document.querySelectorAll('.ai-employee-tab')).find(t => t.textContent.includes('工作档案'))?.classList.contains('active') || false
}))
;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-hometab-'))
  const app = await electron.launch({ executablePath, args: ['--user-data-dir=' + userDataDir, '.'], cwd: path.resolve(__dirname, '..') })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
  await page.route('**/api/members/pending', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/members', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/roles', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.evaluate(profile => {
    localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'qa', refreshToken: 'qa', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
    localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
  }, qaProfile)
  await page.reload()
  await page.waitForSelector('.app-titlebar', { timeout: 20000 })
  await page.click('span.nav-label:has-text("AI员工")')
  await page.waitForSelector('.ai-employee-tab-bar', { timeout: 10000 })
  await page.waitForTimeout(400)
  console.log('ENTER=' + JSON.stringify(await state(page)))
  await page.screenshot({ path: path.resolve(__dirname, '56-home-default.png') })
  await page.click('.ai-employee-tab:has-text("工作处理")')
  await page.waitForTimeout(300)
  console.log('PROCESS_EMPTY=' + JSON.stringify(await state(page)))
  await page.screenshot({ path: path.resolve(__dirname, '57-process-empty.png') })
  await page.click('.ai-employee-work-empty-actions button:has-text("去智库首页")')
  await page.waitForTimeout(300)
  console.log('BACK_HOME=' + JSON.stringify(await state(page)))
  await page.click('.ai-employee-tab:has-text("工作处理")')
  await page.waitForTimeout(200)
  await page.click('.ai-employee-work-empty-actions button:has-text("查看工作档案")')
  await page.waitForTimeout(300)
  console.log('ARCHIVE=' + JSON.stringify(await state(page)))
  await app.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
