// 知识库守卫验收第三组：启动补跑 —— app ready 后 60s 对错过周期的 daily 技能自动补跑（trigger=catchup）
const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')
const ROOT = path.resolve(__dirname, '..')
const qaProfile = { id: 'qa', email: '13400000000', name: '守卫验收3', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null }
const pollUntil = async (probe, timeoutMs, intervalMs = 3000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value) return value
    if (Date.now() > deadline) throw new Error('pollUntil 超时')
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}

;(async () => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-guardian-catchup-'))
  fs.writeFileSync(path.join(srcDir, '补跑样例.md'), '# 补跑验收\n\n内容。\n', 'utf8')
  const executablePath = path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-guardian3-'))
  const t0 = Date.now()
  const app = await electron.launch({ executablePath, args: ['--user-data-dir=' + userDataDir, '.'], cwd: ROOT })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  for (const p of ['**/api/auth/me', '**/api/members/pending', '**/api/members', '**/api/roles']) {
    await page.route(p, route => route.fulfill({ status: 200, contentType: 'application/json', body: p.endsWith('/me') ? JSON.stringify(qaProfile) : '[]' }))
  }
  await page.evaluate(profile => {
    localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'qa', refreshToken: 'qa', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
    localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
  }, qaProfile)
  await page.reload()
  await page.waitForSelector('.app-titlebar', { timeout: 20000 })

  // 新建 daily 技能（lastRunAt 缺失 → 视为错过当日周期，应在启动 60s 后被补跑）
  const skill = await page.evaluate(async args => {
    const kb = await window.desktop.kb.createCustom({ name: '守卫补跑验收库', description: '知识库守卫补跑验收临时库' })
    return window.desktop.kbGuardian.create({ name: '补跑验收技能', sourcePath: args.srcDir, fileExts: ['.md'], targetKbId: kb.id, targetKbName: kb.name, frequency: 'daily', enabled: true })
  }, { srcDir })
  console.log(`SKILL_CREATED_AT=${((Date.now() - t0) / 1000).toFixed(0)}s`)

  const logs = await pollUntil(async () => {
    const list = await page.evaluate(id => window.desktop.kbGuardian.logs(id), skill.id)
    return list.length ? list : null
  }, 240000)
  console.log(`CATCHUP_LOG_AT=${((Date.now() - t0) / 1000).toFixed(0)}s`)
  console.log('CATCHUP_LOG=' + JSON.stringify({ trigger: logs[0].trigger, status: logs[0].status, added: logs[0].added }))
  const assert = (name, cond) => console.log(`${name}=${cond ? 'PASS' : 'FAIL'}`)
  assert('C1_CATCHUP_TRIGGERED', logs[0].trigger === 'catchup' && logs[0].status === 'ok' && logs[0].added === 1)

  // 清理验收临时库
  await page.evaluate(async () => {
    const view = await window.desktop.kb.list()
    const kb = view.customs.find(item => item.name === '守卫补跑验收库')
    if (kb) await window.desktop.kb.remove(kb.id)
  }).catch(() => {})
  await app.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
