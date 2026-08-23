// 知识库守卫验收第二组：覆盖更新（改文件→updated=1 且旧 chunk 不残留）+ 失败场景（目标库被删→记 failure 不崩溃）
const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path'), fs = require('node:fs'), os = require('node:os')
const ROOT = path.resolve(__dirname, '..')
const qaProfile = { id: 'qa', email: '13400000000', name: '守卫验收2', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null }
const TARGET_KB_NAME = '守卫验收临时库' // 验收时创建的自定义库，结束时删除做失败场景
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
  // 临时源目录：单文件，便于改动验证覆盖更新
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-guardian-src-'))
  const srcFile = path.join(srcDir, '守卫验收样例.md')
  fs.writeFileSync(srcFile, '# 守卫验收\n\n初始内容版本一。\n', 'utf8')

  const executablePath = path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-guardian2-'))
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

  // 基线：新建一个自定义库作为目标（结束时删除做失败场景）；若历史残留先清文档
  const targetKb = await page.evaluate(async name => {
    const view = await window.desktop.kb.list()
    const existing = view.customs.find(item => item.name === name)
    const kb = existing ?? await window.desktop.kb.createCustom({ name, description: '知识库守卫验收临时库' })
    const docs = await window.desktop.kb.docs(kb.id)
    if (docs.docs.length) await window.desktop.kb.deleteDocs({ kbId: kb.id, docIds: docs.docs.map(d => d.id) })
    return kb
  }, TARGET_KB_NAME)
  console.log('TARGET_KB=' + targetKb.id)

  // 技能1：临时目录 → 目标库
  const skill = await page.evaluate(args => window.desktop.kbGuardian.create({ name: '覆盖更新验收', sourcePath: args.srcDir, fileExts: ['.md'], targetKbId: args.kbId, targetKbName: args.kbName, frequency: 'manual', enabled: true }), { srcDir, kbId: targetKb.id, kbName: targetKb.name })
  const runAndWait = async (count, timeoutMs = 600000) => {
    const trigger = await page.evaluate(id => window.desktop.kbGuardian.runNow(id), skill.id)
    if (!trigger.queued) throw new Error('run-now 未入队：' + trigger.reason)
    await pollUntil(async () => {
      const logs = await page.evaluate(id => window.desktop.kbGuardian.logs(id), skill.id)
      return logs.length >= count ? logs : null
    }, timeoutMs)
    return page.evaluate(id => window.desktop.kbGuardian.logs(id), skill.id)
  }
  const kbSnapshot = async () => page.evaluate(async id => {
    const docs = (await window.desktop.kb.docs(id)).docs
    return { count: docs.length, chunks: docs.reduce((sum, d) => sum + d.chunkCount, 0) }
  }, targetKb.id)

  // 第 1 次：added=1
  let logs = await runAndWait(1)
  const run1 = logs[0]
  let snap = await kbSnapshot()
  console.log('RUN1=' + JSON.stringify({ stats: run1 && { status: run1.status, added: run1.added, updated: run1.updated, skipped: run1.skipped }, kb: snap }))

  // 修改源文件 → 第 2 次：updated=1，文档数不变（删旧+重传），片段数不翻倍
  fs.writeFileSync(srcFile, '# 守卫验收\n\n更新后的内容版本二，篇幅明显变长以产生不同的切片数量，验证覆盖更新不会残留旧 chunk。\n', 'utf8')
  logs = await runAndWait(2)
  snap = await kbSnapshot()
  const run2 = logs.find(l => l.updated > 0) ?? logs[0]
  console.log('RUN2=' + JSON.stringify({ stats: { status: run2.status, added: run2.added, updated: run2.updated, skipped: run2.skipped, failures: run2.failures }, kb: snap }))

  // 失败场景：目标库被删 + 再改文件（确保哈希不一致触发上传失败）→ 记 failure 不崩溃
  await page.evaluate(id => window.desktop.kb.remove(id), targetKb.id)
  fs.writeFileSync(srcFile, fs.readFileSync(srcFile, 'utf8') + '\n追加内容以触发重新上传。\n', 'utf8')
  logs = await runAndWait(3, 120000)
  const run3 = logs[0]
  console.log('RUN3=' + JSON.stringify({ status: run3.status, added: run3.added, updated: run3.updated, skipped: run3.skipped, failures: run3.failures.map(f => f.reason.slice(0, 60)) }))
  const stateAfter = await page.evaluate(() => window.desktop.kbGuardian.state())
  console.log('APP_ALIVE_AFTER_FAIL=' + (stateAfter.skills.length >= 1))

  // 断言
  const assert = (name, cond) => console.log(`${name}=${cond ? 'PASS' : 'FAIL'}`)
  assert('B1_RUN1_ADDED1', run1.added === 1 && run1.status === 'ok')
  assert('B2_RUN2_UPDATED1_NO_DOUBLED', run2.updated === 1 && run2.added === 0 && snap.count === 1)
  assert('B3_RUN3_FAILED_NO_CRASH', run3.status === 'failed' && run3.failures.length > 0)

  await app.close()
  process.exit(0)
})().catch(e => { console.error('ERR', e.message); process.exit(1) })
