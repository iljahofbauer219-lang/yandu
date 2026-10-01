/**
 * 淘汰产品机制 端到端 UI 验收（真实 Electron 渲染进程 + Playwright + node:sqlite 种子）。
 * 覆盖：优选页黄框统一入口、卡片按钮精简（无待复核）、淘汰原因对话框、淘汰记录归集页、
 * 重新启用回滚决策、采集侯选淘汰、预检查过滤开关持久化。
 *
 * 运行：node tools/verify-elimination-ui.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const { DatabaseSync } = require('node:sqlite')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const ARTIFACTS = path.resolve(__dirname, '../artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const ownerProfile = {
  id: 'elim-ui-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'elim-ui-org', name: '淘汰验收组织' }, roles: [], permissions: 'ALL', stores: null
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

const EXECUTABLE = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const launchApp = (userDataDir) => electron.launch({ executablePath: EXECUTABLE, args: ['.', `--user-data-dir=${userDataDir}`], cwd: path.resolve(__dirname, '..'), env: { ...process.env, CODEX_UI_TEST: '1' } })

async function mockAuth(page) {
  await page.route('**/api/**', async route => {
    const p = new URL(route.request().url()).pathname
    if (p === '/api/auth/me') return route.fulfill(json(ownerProfile))
    return route.continue()
  })
  await page.evaluate(({ profile }) => {
    localStorage.setItem('sourcing.server-url:v1', 'https://elimination-mock.invalid')
    localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'elim-ui-owner', refreshToken: 'elim-ui-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
    localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
  }, { profile: ownerProfile })
  await page.reload()
  await page.waitForTimeout(1200)
}

;(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'elimination-ui-'))
  let failures = 0
  const assert = (name, cond) => { if (cond) console.log(`  ✔ ${name}`); else { failures += 1; console.error(`  ✘ ${name}`) } }

  // 阶段 1：空库启动一次，触发 schema 创建后关闭
  const boot = await launchApp(userDataDir)
  try {
    const bootPage = await boot.firstWindow()
    await bootPage.waitForLoadState('domcontentloaded')
    await bootPage.waitForTimeout(800)
    await bootPage.evaluate(() => window.desktop.selections.list())
    await bootPage.waitForTimeout(500)
  } finally {
    await boot.close().catch(() => {})
  }

  // 阶段 2：种子数据（1 条优选 PENDING + 1 条供应候选）
  const dbPath = path.join(userDataDir, 'sourcing-data.sqlite')
  const now = new Date().toISOString()
  const seed = new DatabaseSync(dbPath)
  seed.prepare(`INSERT OR REPLACE INTO selection_tasks (id, payload, stage, created_at) VALUES (?, '{}', 'SUPPLY_LIST_COMPLETED', ?)`).run('task-seed', now)
  seed.prepare(`INSERT OR REPLACE INTO selection_records (id, task_id, ozon_url, comparison_id, decision, reason, payload, updated_at) VALUES (?, 'task-seed', ?, NULL, 'PENDING', NULL, ?, ?)`).run(
    'sel-seed-1', 'https://elim.example/sel1',
    JSON.stringify({ id: 'sel-seed-1', taskId: 'task-seed', sourceArea: 'SUPPLY', sourceUrl: 'https://elim.example/sel1', productId: 'ELIM1001', platformCode: 'GIGACLOUD', title: '淘汰验证商品A', imageUrl: '', priceText: '$10.00', score: 90, category: '家具', subcategory: '卧室家具', tertiaryCategory: '床架及床底', decision: 'PENDING', reason: '', recommendation: '验收种子', riskFlags: [], updatedAt: now }),
    now)
  seed.prepare(`INSERT OR REPLACE INTO supply_candidates (task_id, url, payload, score, selected, sort_order, deleted_at) VALUES ('task-seed', ?, ?, 90, 0, 0, NULL)`).run(
    'https://elim.example/cand1',
    JSON.stringify({ platformCode: 'GIGACLOUD', productId: 'ELIM2001', url: 'https://elim.example/cand1', title: '淘汰验证候选B', imageUrl: '', priceText: '$20.00', salesText: '', shippingFeeText: '', supplierName: '种子供应商', supplierBadges: [], categoryTopRank: null, returnRate: null, networkSalesCount: null, serviceRating: null, serviceDetails: {}, dataCompleteness: 100, score: 90, grade: 'A', dimensionScores: {}, recommendation: '', riskFlags: [], selected: false, promotionText: '', sellableInventory: 10, gigaIndex: 90 }))
  seed.prepare(`INSERT OR REPLACE INTO candidate_collection_runs (id, task_id, candidate_area, platform_code, collection_method, source_entry, requested_count, collected_count, new_count, updated_count, selected_count, status, started_at, completed_at) VALUES ('run-seed', 'task-seed', 'SUPPLY', 'GIGACLOUD', 'KEYWORD', '验收种子', 1, 1, 1, 0, 0, 'COMPLETED', ?, ?)`).run(now, now)
  seed.prepare(`INSERT OR REPLACE INTO candidate_collection_records (candidate_area, candidate_key, collection_run_id, platform_code, collection_method, source_entry, source_rank, collected_at) VALUES ('SUPPLY', 'GIGACLOUD:https://elim.example/cand1', 'run-seed', 'GIGACLOUD', 'KEYWORD', '验收种子', 0, ?)`).run(now)
  seed.close()

  // 阶段 3：带种子启动，执行 UI 断言
  const app = await launchApp(userDataDir)
  try {
    const pageErrors = []
    const page = await app.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('dialog', dialog => dialog.accept())
    await page.waitForLoadState('domcontentloaded')
    await mockAuth(page)

    const count = (selector) => page.locator(selector).count()
    const topNav = (name) => page.locator('.selection-module-nav button', { hasText: name }).first()
    const queryDb = (sql, params = []) => {
      const handle = new DatabaseSync(dbPath, { readOnly: true })
      try { return handle.prepare(sql).all(...params) } finally { handle.close() }
    }

    // 进入选品模块：AI采集顶页 → 大健云仓卡片 → tasks → 顶部导航
    console.log('优选产品 · 按钮与淘汰流程')
    await page.locator('.sidebar').getByRole('button', { name: 'AI采集', exact: true }).click()
    await page.waitForSelector('.ai-collect-page', { timeout: 8000 })
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).first().click()
    await page.waitForSelector('.workspace', { timeout: 8000 })
    assert('AI采集页顶部导航不展示「淘汰产品」Tab', (await topNav('淘汰产品').count()) === 0)
    await topNav('优选产品').click()
    await page.waitForSelector('.selection-workbench', { timeout: 8000 })
    await page.waitForTimeout(400)

    assert('优选页标题栏不再展示「淘汰产品」入口', (await page.locator('.selection-heading button', { hasText: '淘汰产品' }).count()) === 0)
    assert('优选页顶部导航不再展示「淘汰产品」Tab', (await topNav('淘汰产品').count()) === 0)
    assert('黄框旧按钮「从AI候选导入」已移除', (await page.locator('.selection-heading button', { hasText: '从AI候选导入' }).count()) === 0)
    assert('黄框旧按钮「进入正式入库」已移除', (await page.locator('.selection-heading button', { hasText: '进入正式入库' }).count()) === 0)
    assert('卡片按钮已移除「待复核」', (await page.locator('.selection-decisions button', { hasText: '待复核' }).count()) === 0)
    assert('卡片保留「淘汰」按钮', (await page.locator('.selection-decisions button', { hasText: '淘汰' }).count()) >= 1)

    await page.locator('.selection-decisions button', { hasText: '淘汰' }).first().click()
    await page.waitForSelector('.eliminate-dialog', { timeout: 5000 })
    const dialogMeta = await page.locator('.eliminate-dialog-meta').innerText()
    assert('对话框展示平台/ID/URL 关键信息', dialogMeta.includes('GIGACLOUD') && dialogMeta.includes('https://elim.example/sel1'))
    await page.screenshot({ path: path.join(ARTIFACTS, 'elimination-05-meta.png') })
    await page.locator('.eliminate-dialog textarea').fill('利润不足，验收淘汰')
    await page.screenshot({ path: path.join(ARTIFACTS, 'elimination-01-dialog.png') })
    await page.locator('.eliminate-dialog button', { hasText: '确认淘汰' }).click()
    await page.waitForTimeout(700)
    assert('淘汰对话框关闭且统计「已淘汰」为 1', (await count('.eliminate-dialog')) === 0 && (await page.locator('.selection-stats button', { hasText: '已淘汰' }).locator('b').innerText()) === '1')

    // 数据流转：SQLite 行级字段 + 决策联动
    const selRow = queryDb(`SELECT * FROM eliminated_products WHERE origin='SELECTION'`)[0]
    assert('SQLite 淘汰行字段完整（平台/ID/URL/标题/原因/操作人/状态/时间）', Boolean(selRow) && selRow.platform_code === 'GIGACLOUD' && selRow.product_id === 'ELIM1001' && selRow.source_url === 'https://elim.example/sel1' && selRow.title === '淘汰验证商品A' && selRow.reason === '利润不足，验收淘汰' && String(selRow.operator).includes('老板') && selRow.status === 'ACTIVE' && Boolean(selRow.eliminated_at))
    const selDecision = queryDb(`SELECT decision FROM selection_records WHERE id='sel-seed-1'`)[0]
    assert('SELECTION 原记录 decision 联动为 REJECTED', Boolean(selDecision) && selDecision.decision === 'REJECTED')

    // 淘汰产品归集页（入口仅在采集侧二级导航）
    console.log('淘汰产品页 · 归集 / 重新启用 / 开关')
    await topNav('采集侯选').click()
    await page.waitForSelector('.candidate-page', { timeout: 8000 })
    assert('采集侯选页顶部导航不展示「淘汰产品」Tab', (await topNav('淘汰产品').count()) === 0)
    assert('采集侯选页含页内「淘汰产品」入口', await page.locator('.eliminated-entry-link').isVisible())
    await page.screenshot({ path: path.join(ARTIFACTS, 'elimination-06-ozon-entry.png') })
    await page.locator('.eliminated-entry-link').click()
    await page.waitForSelector('.eliminated-page', { timeout: 8000 })
    await page.waitForTimeout(400)
    const rowText = await page.locator('.eliminated-row').first().innerText()
    assert('归集页展示淘汰记录（标题/URL/原因/操作人）', rowText.includes('淘汰验证商品A') && rowText.includes('https://elim.example/sel1') && rowText.includes('利润不足，验收淘汰') && rowText.includes('老板'))
    assert('页头说明点明采集侯选为主、优选同样支持', (await page.locator('.eliminated-heading p').innerText()).includes('采集侯选'))
    assert('列表行展示 ACTIVE 状态标签', rowText.includes('淘汰生效 ACTIVE'))
    assert('顶部导航存在「淘汰产品」Tab', await topNav('淘汰产品').isVisible())
    await page.screenshot({ path: path.join(ARTIFACTS, 'elimination-02-list.png') })

    await page.locator('.eliminated-row button', { hasText: '重新启用' }).first().click()
    await page.waitForTimeout(700)
    assert('重新启用后 ACTIVE 列表清空', (await count('.eliminated-row')) === 0)
    await page.locator('.eliminated-stats button', { hasText: '全部记录' }).click()
    await page.waitForTimeout(300)
    assert('全部记录可见 REENABLED 状态标签', (await page.locator('.eliminated-row').first().innerText()).includes('已重新启用 REENABLED'))
    assert('REENABLED 行不展示重新启用按钮（仅 ACTIVE 可见）', (await page.locator('.eliminated-row', { hasText: '已重新启用 REENABLED' }).locator('button', { hasText: '重新启用' }).count()) === 0)
    assert('REENABLED 行仍展示删除记录按钮', (await page.locator('.eliminated-row', { hasText: '已重新启用 REENABLED' }).locator('button', { hasText: '删除记录' }).count()) === 1)

    await topNav('优选产品').click()
    await page.waitForSelector('.selection-workbench', { timeout: 8000 })
    await page.waitForTimeout(400)
    assert('重新启用后优选决策回滚为待复核', (await page.locator('.selection-stats button', { hasText: '待复核' }).locator('b').innerText()) === '1')

    // 采集侯选淘汰
    console.log('采集侯选 · 删除改淘汰')
    await topNav('采集侯选').click()
    await page.waitForSelector('.candidate-page', { timeout: 8000 })
    await page.waitForTimeout(500)
    const card = page.locator('.supply-source-card', { hasText: '淘汰验证候选B' }).first()
    assert('候选卡片操作为「淘汰」且无「删除」', (await card.locator('.candidate-next-actions button', { hasText: '淘汰' }).count()) === 1 && (await card.locator('.candidate-next-actions button', { hasText: '删除' }).count()) === 0)
    await card.locator('.candidate-next-actions button', { hasText: '淘汰' }).click()
    await page.waitForSelector('.eliminate-dialog', { timeout: 5000 })
    await page.locator('.eliminate-dialog button', { hasText: '确认淘汰' }).click()
    await page.waitForTimeout(900)
    assert('候选淘汰后 ALL 视图不再展示该候选', (await page.locator('.supply-source-card', { hasText: '淘汰验证候选B' }).count()) === 0)
    await page.locator('.candidate-filterbar select').nth(1).selectOption('DELETED')
    await page.waitForTimeout(500)
    assert('已删除视图可见淘汰候选卡片（is-deleted）', (await page.locator('.supply-source-card.is-deleted', { hasText: '淘汰验证候选B' }).count()) === 1)

    // 数据流转：候选软删标记 + CANDIDATE 淘汰行
    const candRow = queryDb(`SELECT deleted_at FROM supply_candidates WHERE url='https://elim.example/cand1'`)[0]
    assert('CANDIDATE 原记录软删标记已写入', Boolean(candRow) && Boolean(candRow.deleted_at))
    const candElim = queryDb(`SELECT * FROM eliminated_products WHERE origin='CANDIDATE'`)[0]
    assert('SQLite 存在 CANDIDATE 来源淘汰行', Boolean(candElim) && candElim.source_url === 'https://elim.example/cand1' && candElim.status === 'ACTIVE')

    await page.locator('.eliminated-entry-link').click()
    await page.waitForSelector('.eliminated-page', { timeout: 8000 })
    await page.waitForTimeout(400)
    assert('候选淘汰记录归集（默认 ACTIVE 视图）', (await page.locator('.eliminated-row', { hasText: '淘汰验证候选B' }).count()) === 1)

    // 预检查过滤开关持久化
    await page.locator('.eliminated-filter-toggle input').click()
    await page.waitForTimeout(400)
    await page.reload()
    await page.waitForTimeout(1200)
    // 刷新后 React 路由重置：重新导航回淘汰产品页
    await page.locator('.sidebar').getByRole('button', { name: 'AI采集', exact: true }).click()
    await page.waitForSelector('.ai-collect-page', { timeout: 8000 })
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).first().click()
    await page.waitForSelector('.workspace', { timeout: 8000 })
    await topNav('采集侯选').click()
    await page.waitForSelector('.candidate-page', { timeout: 8000 })
    await page.locator('.eliminated-entry-link').click()
    await page.waitForSelector('.eliminated-page', { timeout: 8000 })
    await page.waitForTimeout(600)
    assert('预检查过滤开关状态持久化（关闭后刷新保持）', !(await page.locator('.eliminated-filter-toggle input').isChecked()))
    await page.screenshot({ path: path.join(ARTIFACTS, 'elimination-03-page.png') })

    // 查询筛选 + 批量管理
    console.log('淘汰产品页 · 搜索筛选与批量管理')
    await page.locator('.eliminated-stats button', { hasText: '全部记录' }).click()
    await page.waitForTimeout(300)
    await page.locator('.eliminated-filters input').fill('淘汰验证候选B')
    await page.waitForTimeout(300)
    assert('搜索筛选命中单条记录', (await count('.eliminated-row')) === 1)
    await page.locator('.eliminated-filters input').fill('')
    await page.waitForTimeout(300)
    assert('清空搜索后恢复全部记录', (await count('.eliminated-row')) === 2)
    await page.locator('.eliminated-filters button', { hasText: '批量管理' }).click()
    await page.waitForTimeout(300)
    assert('批量模式展示批量条', await page.locator('.eliminated-batchbar').isVisible())
    await page.locator('.eliminated-batchbar input[type=checkbox]').click()
    await page.waitForTimeout(300)
    assert('全选后已选计数为 2', (await page.locator('.eliminated-batchbar').innerText()).includes('已选 2 条'))
    await page.locator('.eliminated-batchbar button', { hasText: '删除已选记录' }).click()
    await page.waitForTimeout(700)
    assert('批量删除后记录清空', (await count('.eliminated-row')) === 0)
    await page.screenshot({ path: path.join(ARTIFACTS, 'elimination-04-batch.png') })

    assert('渲染进程无未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error('pageErrors:', pageErrors.slice(0, 5))
  } catch (error) {
    failures += 1
    console.error('验收中断：', error)
  } finally {
    await app.close().catch(() => {})
  }
  console.log(failures === 0 ? 'PASS 淘汰产品机制验收通过' : `FAIL ${failures} 项未通过`)
  process.exit(failures === 0 ? 0 : 1)
})()
