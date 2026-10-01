/**
 * 已通过入库商品立即移出优选产品列表 端到端验收（真实 Electron + Playwright）。
 * fixture（stocked 模式）：候选 u1..u6；选品 u1(PENDING)/u4(APPROVED+入库)/u5(PENDING)。
 * 场景：
 *  1 优选产品初始仅 u1/u5 两卡（u4 隐藏）；统计无"已通过"；下拉无"已通过"；徽标 优选2/入库1。
 *  2 对 u1 点"通过"→ 列表立即剩 u5 一卡；优选徽标 1；入库徽标 2。
 *  3 正式入库 Tab 含 u1/u4 共 2 项。
 *  4 优选产品对 u5 点"候选"→ u5 回到采集候选（4 卡）；优选产品空态。
 *
 * 运行：先 vite build + tsc -p tsconfig.main.json，再 node tools/verify-approved-hidden.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ARTIFACTS = path.resolve(__dirname, '../artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const T1 = 'FIXTURE Alpha Gaming Loft Bed 1070409'
const T4 = 'FIXTURE Delta Storage Bed 2001001' // APPROVED + 入库
const T5 = 'FIXTURE Epsilon Canopy Bed 2001002'
const T6 = 'FIXTURE Zeta Loft Bed with Desk 2001003'

const ownerProfile = {
  id: 'ah-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'ah-org', name: '通过隐藏验收组织' }, roles: [], permissions: 'ALL', stores: null
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'approved-hidden-'))
  const dbPath = path.join(userDataDir, 'sourcing-data.sqlite')

  const seed = spawnSync(executablePath, [path.resolve(__dirname, 'fixture-seed-preferred-exclusion.cjs'), dbPath, 'stocked'], {
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
      localStorage.setItem('sourcing.server-url:v1', 'https://approved-hidden-mock.invalid')
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'ah-owner', refreshToken: 'ah-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile })
    await page.reload()
    await page.waitForTimeout(1200)

    const flowNav = page.locator('.selection-module-nav.warehouse-flow-nav')
    const selectionCards = page.locator('.selection-card')
    const candidateCards = page.locator('.candidate-catalog-main .product-grid .candidate-product-card')
    const badge = async (name) => (await flowNav.getByRole('button', { name }).locator('em').innerText()).trim()
    const goSelection = async () => { await flowNav.getByRole('button', { name: /优选产品/ }).click(); await page.waitForSelector('.selection-workbench', { timeout: 8000 }); await page.waitForTimeout(400) }
    const goCandidates = async () => { await flowNav.getByRole('button', { name: '采集侯选' }).click(); await page.waitForSelector('.candidate-catalog-main', { timeout: 8000 }); await page.waitForTimeout(500) }

    await page.locator('.sidebar').getByRole('button', { name: 'AI采集', exact: true }).click()
    await page.waitForSelector('.ai-collect-grid', { timeout: 8000 })
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).click()
    await page.waitForTimeout(800)

    // ── 初始：APPROVED 不在优选产品列表 ──
    console.log('初始隐藏状态')
    await goSelection()
    assert('优选产品仅 u1/u5 两卡', await selectionCards.count() === 2)
    const selText0 = await page.locator('.selection-main').innerText()
    assert('u4（APPROVED+入库）不在列表', !selText0.includes(T4) && selText0.includes(T1) && selText0.includes(T5))
    assert('统计行 3 项且无已通过', await page.locator('.selection-stats button').count() === 3 && !(await page.locator('.selection-stats').innerText()).includes('已通过'))
    const options = await page.locator('.selection-filters select option').allInnerTexts()
    assert('状态下拉无已通过选项', !options.includes('已通过'))
    assert('优选徽标 2 / 入库徽标 1', await badge(/优选产品/) === '2' && await badge(/正式入库/) === '1')
    await page.screenshot({ path: path.join(ARTIFACTS, 'approved-hidden-01-selection.png') })

    // ── 点通过：立即从列表移除并入正式入库 ──
    console.log('点通过后立即移除')
    await page.locator('.selection-card', { hasText: T1 }).getByRole('button', { name: '通过', exact: true }).click()
    await page.waitForTimeout(600)
    assert('u1 立即从优选产品移除（剩 u5 一卡）', await selectionCards.count() === 1 && !(await page.locator('.selection-main').innerText()).includes(T1))
    assert('优选徽标 1 / 入库徽标 2', await badge(/优选产品/) === '1' && await badge(/正式入库/) === '2')

    // ── 正式入库页可见 ──
    console.log('正式入库页可见')
    await flowNav.getByRole('button', { name: /正式入库/ }).click()
    await page.waitForSelector('.supply-warehouse-page', { timeout: 8000 })
    await page.waitForTimeout(400)
    const whText = await page.locator('.supply-warehouse-page').innerText()
    assert('正式入库含 u1/u4 共 2 项', await page.locator('.warehouse-product-grid article').count() === 2 && whText.includes(T1) && whText.includes(T4))
    await page.screenshot({ path: path.join(ARTIFACTS, 'approved-hidden-02-warehouse.png') })

    // ── 返回AI候选：回到采集候选而非优选产品 ──
    console.log('返回AI候选回到采集候选')
    await goSelection()
    await page.locator('.selection-card', { hasText: T5 }).getByRole('button', { name: '候选', exact: true }).click()
    await page.waitForTimeout(500)
    await goCandidates()
    const candText = await page.locator('.candidate-catalog-main').innerText()
    assert('u5 回到采集候选（4 卡含 u5/u6）', await candidateCards.count() === 4 && candText.includes(T5) && candText.includes(T6))
    await goSelection()
    assert('优选产品空态（0 卡）', await selectionCards.count() === 0 && (await page.locator('.selection-main').innerText()).includes('暂无选品商品'))

    assert('渲染进程无未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error(pageErrors.join('\n'))
  } finally {
    await app.close()
  }
  console.log(failures === 0 ? 'VERIFY_OK 全部断言通过' : `VERIFY_FAILED ${failures} 项断言失败`)
  process.exit(failures === 0 ? 0 : 1)
})()
