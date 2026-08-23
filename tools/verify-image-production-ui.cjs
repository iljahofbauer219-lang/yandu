const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-phase1-electron-'))
  const app = await electron.launch({ executablePath, args: [`.`, `--user-data-dir=${userDataDir}`], cwd: path.resolve(__dirname, '..') })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const qaProfile = {
      id: 'phase1-ui-qa', email: 'qa@example.test', name: '阶段1验收', isOwner: true,
      status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
      org: { id: 'phase1-ui-qa-org', name: '阶段1验收组织' }, roles: [], permissions: 'ALL', stores: null
    }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
    await app.evaluate(({ app }) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
      const database = new DatabaseSync(`${app.getPath('userData')}/sourcing-data.sqlite`)
      database.exec('PRAGMA foreign_keys = OFF')
      const now = new Date().toISOString()
      database.prepare(`INSERT OR REPLACE INTO supply_warehouse_products
        (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, payload, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run('phase1-ui-product', '1688', 'phase1-ui-selection', 'https://example.test/product/phase1', 'SKU-PHASE1', '验收测试商品', '', '¥128.00', '验收供应商', '家居', '收纳', '桌面收纳', 'ACTIVE', '{}', now, now)
      database.close()
    })
    await page.evaluate(({ profile }) => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'phase1-ui-qa', refreshToken: 'phase1-ui-qa', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: qaProfile })
    await page.reload()
    await page.waitForTimeout(1200)
    if (await page.getByRole('button', { name: '登 录' }).count()) throw new Error('隔离测试会话未能进入主界面')
    const artNav = page.getByRole('button', { name: 'AI美工' }).first()
    if (await artNav.count()) await artNav.click()
    const imageEntry = page.getByText('AI生图', { exact: true }).first()
    if (await imageEntry.count()) await imageEntry.click()
    await page.waitForTimeout(600)
    await page.getByText('商品视觉生成', { exact: true }).waitFor({ timeout: 5000 })
    const requiredTexts = ['AI入库商品', '全套生成', '仅主图', '仅详情页', '生成历史', '本次生成清单']
    for (const text of requiredTexts) {
      if (!(await page.getByText(text, { exact: true }).count())) throw new Error(`界面缺少：${text}`)
    }
    const fullCount = await page.getByText('12张', { exact: true }).count()
    const mainCount = await page.getByText('5张', { exact: true }).count()
    const detailCount = await page.getByText('7张', { exact: true }).count()
    if (!fullCount || !mainCount || !detailCount) throw new Error('5+7清单数量未正确显示')
    await page.getByRole('button', { name: '前往AI入库' }).click()
    await page.getByRole('button', { name: 'AI做图' }).first().click()
    await page.getByText('商品事实确认', { exact: true }).waitFor()
    await page.getByRole('button', { name: '确认商品事实并生成清单' }).click()
    const taskCards = await page.locator('.production-task').count()
    if (taskCards !== 12) throw new Error(`逐图任务应为12个，实际为${taskCards}个`)
    await page.getByRole('button', { name: '确认并开始生成' }).first().click()
    await page.getByRole('heading', { name: '确认本次生成清单' }).waitFor()
    const modalTasks = await page.locator('.image-production-plan-list article').count()
    if (modalTasks !== 12) throw new Error(`确认弹窗应展示12个任务，实际为${modalTasks}个`)
    await page.getByRole('button', { name: '返回调整' }).click()
    fs.mkdirSync(path.resolve('output/playwright'), { recursive: true })
    const screenshot = path.resolve('output/playwright/image-production-phase1.png')
    await page.screenshot({ path: screenshot, fullPage: true })
    console.log(JSON.stringify({ title: await page.title(), requiredTexts, fullCount, mainCount, detailCount, factConfirmation: true, taskCards, modalTasks, screenshot }, null, 2))
  } finally {
    await app.close()
  }
})().catch(error => { console.error(error); process.exit(1) })
