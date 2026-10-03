/**
 * 单链接采集展示与归类验收（真实 Electron + Playwright）。
 * fixture（methods 模式）：KEYWORD 任务 m1/m2；PRODUCT_URL 任务 m3/m4；m5 无溯源记录（启动迁移/回填补齐）。
 * 断言：
 *  A 采集入口：GIGACLOUD+关键词 → 插件引导可见、无关键词输入；切单链接 → 引导隐藏、链接输入+当前页面按钮可见、归类提示可见；切回关键词 → 引导恢复。
 *  B 候选页：全部 5 卡；单链接采集 Tab 恰 3 卡（m3/m4/m5，源标签均含"单链接采集"）；关键词 Tab 恰 2 卡；切回全部 5 卡。
 *
 * 运行：先 vite build + tsc -p tsconfig.main.json，再 node tools/verify-product-url-tab.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ARTIFACTS = path.resolve(__dirname, '../artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const M1 = 'FIXTURE KW One 900001'
const M2 = 'FIXTURE KW Two 900002'
const M3 = 'FIXTURE URL Three 900003'
const M4 = 'FIXTURE URL Four 900004'
const M5 = 'FIXTURE URL Five Legacy 900005'
const NOTE = '内置插件选择确认与单链接采集任务的商品均归入采集候选的“单链接采集”分类'

const ownerProfile = {
  id: 'pu-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'pu-org', name: '单链接归类验收组织' }, roles: [], permissions: 'ALL', stores: null
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-url-tab-'))
  const dbPath = path.join(userDataDir, 'sourcing-data.sqlite')

  const seed = spawnSync(executablePath, [path.resolve(__dirname, 'fixture-seed-preferred-exclusion.cjs'), dbPath, 'methods'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8'
  })
  if (seed.status !== 0) {
    console.error('fixture 种子失败：', seed.stdout, seed.stderr)
    process.exit(1)
  }
  console.log(seed.stdout.trim())

  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: path.resolve(__dirname, '..'), env: { ...process.env, CODEX_UI_TEST: '1' } })
  let failures = 0
  const assert = (name, cond) => { if (cond) console.log(`  ✔ ${name}`); else { failures += 1; console.error(`  ✘ ${name}`) } }
  try {
    const pageErrors = []
    const page = await app.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    await page.route('**/api/**', async route => {
      const p = new URL(route.request().url()).pathname
      if (p === '/api/auth/me') return route.fulfill(json(ownerProfile))
      return route.continue()
    })
    await page.evaluate(({ profile }) => {
      localStorage.setItem('sourcing.server-url:v1', 'https://product-url-tab-mock.invalid')
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'pu-owner', refreshToken: 'pu-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile })
    await page.reload()
    await page.waitForTimeout(1200)

    const flowNav = page.locator('.selection-module-nav.warehouse-flow-nav')
    const candidateCards = page.locator('.candidate-catalog-main .product-grid .candidate-product-card')
    await page.locator('.sidebar').getByRole('button', { name: '货盘采集', exact: true }).click()
    await page.waitForSelector('.ai-collect-grid', { timeout: 8000 })
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).click()
    await page.waitForTimeout(800)

    // ── A 采集入口 UI 与归类口径 ──
    console.log('采集入口 UI 一致性')
    const methodSelect = page.locator('.task-config-card .compact-select-field select').first()
    const entryCard = page.locator('.task-config-card', { hasText: '采集入口' })
    assert('关键词模式下采集方式下拉可见', await methodSelect.isVisible())
    assert('关键词模式下插件引导可见', await page.locator('.collector-entry-guide').count() === 1)
    assert('关键词模式下无关键词输入（插件驱动）', await page.locator('.config-card-body input[placeholder="例如：宠物食品"]').count() === 0)
    assert('归类提示可见', (await entryCard.innerText()).includes(NOTE))
    await methodSelect.selectOption('PRODUCT_URL')
    await page.waitForTimeout(400)
    assert('单链接模式下插件引导隐藏', await page.locator('.collector-entry-guide').count() === 0)
    assert('单链接模式下链接输入与当前页面按钮可见', await page.locator('.url-input-row input[type="url"]').isVisible() && await page.locator('.url-input-row button', { hasText: '当前页面' }).isVisible())
    assert('单链接模式下归类提示仍可见', (await entryCard.innerText()).includes(NOTE))
    await methodSelect.selectOption('KEYWORD')
    await page.waitForTimeout(400)
    assert('切回关键词后插件引导恢复', await page.locator('.collector-entry-guide').count() === 1)

    // ── B 候选页方法 Tab 精确过滤 ──
    console.log('方法 Tab 过滤与统一展示')
    await flowNav.getByRole('button', { name: '采集侯选' }).click()
    await page.waitForSelector('.candidate-catalog-main', { timeout: 8000 })
    await page.waitForTimeout(500)
    assert('全部商品 5 卡', await candidateCards.count() === 5)
    assert('页头小标为采集候选', (await page.locator('.warehouse-page-heading small').innerText()).trim() === '采集候选')
    assert('页头副文本已删除', await page.getByText('候选数据只归属于当前仓库').count() === 0)
    assert('方法 Tab 位于页头内', await page.locator('.warehouse-page-heading .candidate-view-switch').count() === 1)
    assert('标题旁徽标=当前筛选数 5', (await page.locator('.candidate-heading-title-row em').innerText()).trim() === '5')
    await page.locator('.candidate-view-switch button', { hasText: '单链接采集' }).click()
    await page.waitForTimeout(500)
    assert('单链接采集 Tab 恰 3 卡（含回填的 m5）', await candidateCards.count() === 3)
    assert('徽标联动 3', (await page.locator('.candidate-heading-title-row em').innerText()).trim() === '3')
    const urlTabText = await page.locator('.candidate-catalog-main').innerText()
    assert('单链接 Tab 含 m3/m4/m5 且不含 m1/m2', urlTabText.includes(M3) && urlTabText.includes(M4) && urlTabText.includes(M5) && !urlTabText.includes(M1) && !urlTabText.includes(M2))
    const sourceTags = await page.locator('.candidate-product-card .original-price').allInnerTexts()
    assert('3 卡源标签均为单链接采集', sourceTags.length === 3 && sourceTags.every(text => text.includes('单链接采集')))
    await page.screenshot({ path: path.join(ARTIFACTS, 'product-url-tab-01.png') })
    await page.locator('.candidate-view-switch button', { hasText: '关键词搜索' }).click()
    await page.waitForTimeout(500)
    assert('关键词 Tab 恰 2 卡', await candidateCards.count() === 2)
    assert('徽标联动 2', (await page.locator('.candidate-heading-title-row em').innerText()).trim() === '2')
    const kwTabText = await page.locator('.candidate-catalog-main').innerText()
    assert('关键词 Tab 含 m1/m2', kwTabText.includes(M1) && kwTabText.includes(M2))
    await page.locator('.candidate-view-switch button', { hasText: '全部商品' }).click()
    await page.waitForTimeout(500)
    assert('切回全部 5 卡', await candidateCards.count() === 5)

    assert('渲染进程无未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error(pageErrors.join('\n'))
  } finally {
    await app.close()
  }
  console.log(failures === 0 ? 'VERIFY_OK 全部断言通过' : `VERIFY_FAILED ${failures} 项断言失败`)
  process.exit(failures === 0 ? 0 : 1)
})()
