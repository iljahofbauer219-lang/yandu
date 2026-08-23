// 知识库守卫 P1 运行时验收：新建技能(docs/→选品分析师知识库, 手动) → 立即执行 → 哈希跳过二次执行 → 日志断言
const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')
const ROOT = path.resolve(__dirname, '..')
const DOCS_DIR = path.join(ROOT, 'docs')
const qaProfile = { id: 'qa', email: '13400000000', name: '守卫验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null }
const TARGET_KB_NAME = '选品分析师知识库'

const countSourceFiles = (dir, exts) => {
  let n = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) n += countSourceFiles(full, exts)
    else if (exts.some(ext => entry.name.toLowerCase().endsWith(ext))) n += 1
  }
  return n
}
const expected = countSourceFiles(DOCS_DIR, ['.md', '.txt'])
console.log(`EXPECTED_FILES=${expected}`)

const guardianState = page => page.evaluate(() => window.desktop.kbGuardian.state())
// 轮询等待某条件成立（waitForFunction 不会 await Promise 返回值，改用 Node 侧轮询）
const pollUntil = async (probe, timeoutMs, intervalMs = 3000) => {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await probe()
    if (value) return value
    if (Date.now() > deadline) throw new Error('pollUntil 超时')
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
}
const kbDocsCount = (page, kbName) => page.evaluate(async name => {
  const view = await window.desktop.kb.list()
  const all = [...view.agents.map(slot => slot.kb).filter(Boolean), ...view.customs]
  const kb = all.find(item => item.name === name)
  if (!kb) return { found: false }
  const docs = await window.desktop.kb.docs(kb.id)
  return { found: true, docCount: docs.docs.length }
}, kbName)

;(async () => {
  const executablePath = path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-guardian-'))
  const app = await electron.launch({ executablePath, args: ['--user-data-dir=' + userDataDir, '.'], cwd: ROOT })
  app.process().on('exit', (code, signal) => console.log(`APP_EXIT code=${code} signal=${signal}`))
  app.process().stdout?.on('data', chunk => process.stdout.write('[MAIN-OUT] ' + chunk))
  app.process().stderr?.on('data', chunk => process.stdout.write('[MAIN-ERR] ' + chunk))
  const page = await app.firstWindow()
  page.on('pageerror', err => console.log('[PAGEERROR]', err.message))
  page.on('close', () => console.log('[PAGE_CLOSED]'))
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

  // 导航：AI星球 → 知识库
  await page.click('span.nav-label:has-text("AI星球")')
  await page.waitForSelector('.ai-crossborder-entries', { timeout: 10000 })
  await page.click('.ai-crossborder-card:has(b:has-text("知识库"))')
  await page.waitForSelector('.kb-hub-body', { timeout: 15000 })
  await page.waitForSelector('.kb-hub-section:has-text("守卫技能")', { timeout: 10000 })
  console.log('NAV_OK=true')
  // 幂等基线：清空目标库既有文档（经应用自身 kb API，同 guardian 删除链路）
  const cleaned = await page.evaluate(async name => {
    const view = await window.desktop.kb.list()
    const all = [...view.agents.map(slot => slot.kb).filter(Boolean), ...view.customs]
    const kb = all.find(item => item.name === name)
    if (!kb) return 'KB_NOT_FOUND'
    const docs = await window.desktop.kb.docs(kb.id)
    if (docs.docs.length) await window.desktop.kb.deleteDocs({ kbId: kb.id, docIds: docs.docs.map(d => d.id) })
    return 'CLEANED=' + docs.docs.length
  }, TARGET_KB_NAME)
  console.log(cleaned)
  await page.waitForTimeout(2000)
  await page.screenshot({ path: path.join(__dirname, 'guardian-01-empty.png') })

  // 新建技能：名称 + 源目录(直接键入) + 目标库 + 默认频率手动
  await page.click('.kb-hub-section:has-text("守卫技能") button:has-text("新建技能")')
  await page.waitForSelector('.kb-dialog:has(#kb-guardian-title)', { timeout: 5000 })
  await page.fill('.kb-dialog input[placeholder="例如：方法论文档同步"]', '验收技能')
  await page.fill('.kb-dialog input[placeholder="选择本地目录"]', DOCS_DIR)
  await page.waitForFunction(name => Array.from(document.querySelectorAll('.kb-dialog select option')).some(o => o.textContent === name), TARGET_KB_NAME, { timeout: 15000 })
  await page.selectOption('.kb-dialog select', { label: TARGET_KB_NAME })
  await page.click('.kb-dialog footer button.primary:has-text("保存")')
  await page.waitForSelector('.kb-card:has(.kb-card-icon.guardian)', { timeout: 10000 })
  const skillCardText = await page.textContent('.kb-card:has(.kb-card-icon.guardian)')
  console.log('SKILL_CARD=' + (skillCardText || '').replace(/\s+/g, ' ').slice(0, 120))
  const badgeBefore = await page.locator('.kb-badge.guardian').count()
  console.log('BADGE_BEFORE=' + badgeBefore)
  await page.screenshot({ path: path.join(__dirname, 'guardian-02-skill-created.png') })

  const skillId = (await guardianState(page)).skills[0]?.id
  if (!skillId) throw new Error('技能未创建成功')

  // 第一次执行：全部新增
  await page.click('.kb-card:has(.kb-card-icon.guardian) button:has-text("立即执行")')
  await pollUntil(async () => {
    const s = await guardianState(page)
    const sk = s.skills.find(item => item.id === skillId)
    return !!sk && !sk.running && !!sk.lastRunAt
  }, 600000)
  const after1 = (await guardianState(page)).skills.find(s => s.id === skillId)
  console.log('RUN1=' + JSON.stringify(after1?.lastStats))
  const docs1 = await kbDocsCount(page, TARGET_KB_NAME)
  console.log('DOCS_AFTER_RUN1=' + JSON.stringify(docs1))
  const logs1 = await page.evaluate(id => window.desktop.kbGuardian.logs(id), skillId)
  console.log('LOGS1=' + JSON.stringify(logs1.map(l => ({ status: l.status, trigger: l.trigger, added: l.added, updated: l.updated, skipped: l.skipped, failures: l.failures.length }))))
  await page.screenshot({ path: path.join(__dirname, 'guardian-03-run1.png') })

  // 第二次执行：全部跳过（哈希一致）；走 IPC 触发，避免 UI 按钮瞬时 disabled 导致点击空转
  const run2 = await page.evaluate(id => window.desktop.kbGuardian.runNow(id), skillId)
  console.log('RUN2_QUEUED=' + JSON.stringify(run2))
  await pollUntil(async () => {
    const logs = await page.evaluate(id => window.desktop.kbGuardian.logs(id), skillId)
    return logs.length >= 2
  }, 600000)
  const after2 = (await guardianState(page)).skills.find(s => s.id === skillId)
  console.log('RUN2=' + JSON.stringify(after2?.lastStats))
  const docs2 = await kbDocsCount(page, TARGET_KB_NAME)
  console.log('DOCS_AFTER_RUN2=' + JSON.stringify(docs2))
  await page.screenshot({ path: path.join(__dirname, 'guardian-04-run2.png') })

  // 日志抽屉
  await page.click('.kb-card:has(.kb-card-icon.guardian) button:has-text("日志")')
  await page.waitForSelector('.kb-guardian-logs .kb-guardian-log', { timeout: 8000 })
  const logCount = await page.locator('.kb-guardian-logs .kb-guardian-log').count()
  console.log('LOG_DRAWER_ENTRIES=' + logCount)
  await page.screenshot({ path: path.join(__dirname, 'guardian-05-logs.png') })
  await page.click('.kb-guardian-logs footer button.primary')

  // 断言汇总
  const assert = (name, cond) => console.log(`${name}=${cond ? 'PASS' : 'FAIL'}`)
  const s1 = after1?.lastStats, s2 = after2?.lastStats
  assert('A1_RUN1_ADDED_EQ_SOURCE', s1 && s1.added === expected && s1.updated === 0 && s1.skipped === 0)
  assert('A2_KB_DOCS_EQ_SOURCE', docs1.found && docs1.docCount === expected)
  assert('A3_RUN2_ALL_SKIPPED', s2 && s2.added === 0 && s2.updated === 0 && s2.skipped === expected)
  assert('A4_DOCS_NOT_DOUBLED', docs2.found && docs2.docCount === expected)
  const logsAll = await page.evaluate(id => window.desktop.kbGuardian.logs(id), skillId)
  assert('A5_LOG_OK', logsAll.length >= 2 && logsAll.every(l => l.status === 'ok' && l.failures.length === 0))
  assert('A6_BADGE_GUARDIAN_WRITTEN', badgeBefore >= 1)
  assert('A7_LOG_DRAWER_GE2', logCount >= 2)

  await app.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
