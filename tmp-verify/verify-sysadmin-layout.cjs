const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')
const qaProfile = { id: 'qa', email: '13400000000', name: '系统管理布局验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null }
;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-sysadmin-'))
  const app = await electron.launch({ executablePath, args: ['--user-data-dir=' + userDataDir, '.'], cwd: path.resolve(__dirname, '..') })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
  await page.route('**/api/members/pending', route => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/members', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'm1', email: '13400000000', name: '主帐号', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: '2026-08-08T14:00:00Z', createdAt: '2026-01-01T00:00:00Z', roles: [{ id: 'r1', name: '主帐号', key: 'OWNER', permissions: ['menu.employee'] }, { id: 'r2', name: '自定义-测试', key: 'CUSTOM', permissions: ['menu.employee', 'menu.collect'], memberCount: 2 }] },
    { id: 'm2', email: '13800000000', name: '子帐号甲', isOwner: false, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, createdAt: '2026-02-01T00:00:00Z', roles: [{ id: 'r2', name: '自定义-测试', key: 'CUSTOM', permissions: ['menu.employee', 'menu.collect'], memberCount: 2 }] }
  ]) }))
  await page.route('**/api/roles', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
    { id: 'r1', name: '主帐号', key: 'OWNER', permissions: [], memberCount: 1 },
    { id: 'r2', name: '自定义-测试', key: 'CUSTOM', permissions: ['menu.employee', 'menu.collect'], memberCount: 2 }
  ]) }))
  await page.evaluate(profile => {
    localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'qa', refreshToken: 'qa', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
    localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
  }, qaProfile)
  await page.reload()
  await page.waitForSelector('.app-titlebar', { timeout: 20000 })
  await page.click('button[title="设置"]')
  await page.waitForSelector('.sysadmin-table', { timeout: 15000 })
  const members = await page.evaluate(() => {
    const pageEl = document.querySelector('.sysadmin-page')
    const table = document.querySelector('.sysadmin-table')
    const row = document.querySelector('.sysadmin-member-row .sysadmin-actions')
    const btns = row ? Array.from(row.querySelectorAll('button')) : []
    const ys = btns.map(b => Math.round(b.getBoundingClientRect().top))
    return {
      pageWidth: Math.round(pageEl.getBoundingClientRect().width),
      tableWidth: Math.round(table.getBoundingClientRect().width),
      actionsSingleLine: ys.length > 0 && ys.every(y => Math.abs(y - ys[0]) < 4),
      noHScroll: pageEl.scrollWidth <= pageEl.clientWidth + 2
    }
  })
  console.log('MEMBERS=' + JSON.stringify(members))
  await page.screenshot({ path: path.resolve(__dirname, '61-sysadmin-members-wide.png') })
  // 组织信息
  await page.click('.sysadmin-tabs button:has-text("组织信息")')
  await page.waitForSelector('.sysadmin-org-info', { timeout: 10000 })
  const org = await page.evaluate(() => {
    const dl = document.querySelector('.sysadmin-org-info')
    const items = dl.querySelectorAll('.org-item')
    const first = items[0]?.getBoundingClientRect()
    return { items: items.length, gridWidth: Math.round(dl.getBoundingClientRect().width), cardWidth: Math.round(first?.width || 0), cols: getComputedStyle(dl).gridTemplateColumns.split(' ').length }
  })
  console.log('ORG=' + JSON.stringify(org))
  await page.screenshot({ path: path.resolve(__dirname, '62-sysadmin-org-wide.png') })
  // 注册审核（空态）
  await page.click('.sysadmin-tabs button:has-text("注册审核")')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.resolve(__dirname, '63-sysadmin-review-wide.png') })
  // 深色模式
  await page.click('.sysadmin-tabs button:has-text("组织信息")')
  await page.click('.titlebar-theme-wrap > button')
  await page.click('.titlebar-theme-menu button:has-text("深色")')
  await page.waitForTimeout(300)
  await page.screenshot({ path: path.resolve(__dirname, '64-sysadmin-org-dark.png') })
  // 窄窗回归 1100
  await page.setViewportSize({ width: 1100, height: 760 })
  await page.waitForTimeout(300)
  const narrow = await page.evaluate(() => {
    const pageEl = document.querySelector('.sysadmin-page')
    return { noHScroll: pageEl.scrollWidth <= pageEl.clientWidth + 2 }
  })
  console.log('NARROW=' + JSON.stringify(narrow))
  await app.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
