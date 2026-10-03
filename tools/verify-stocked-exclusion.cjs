/**
 * 已正式入库商品永久排除出采集候选 端到端验收（真实 Electron + Playwright）。
 * fixture（stocked 模式）：候选 u1..u6；优选 u1(PENDING)/u4(APPROVED)/u5(PENDING)；正式入库 u4。
 * 场景：
 *  1 初始采集候选仅 u2/u3/u6（u1/u5 优选、u4 优选+入库 被排除）；优选产品 3；正式入库 1。
 *  2 采集候选对 u2 点优选 → 立即消失（剩 2），优选产品出现 u2（4 项）。
 *  3 优选产品对 u2 点候选 → 重回采集候选（3 卡）。
 *  4 优选产品对 u4（APPROVED+入库）点候选 → 选品记录删除（优选产品 2 项），
 *    但采集候选仍 3 卡（u4 不回流），正式入库仍 1（入库去重生效）。
 *
 * 运行：先 vite build + tsc -p tsconfig.main.json，再 node tools/verify-stocked-exclusion.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ARTIFACTS = path.resolve(__dirname, '../artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const T1 = 'FIXTURE Alpha Gaming Loft Bed 1070409' // 优选 PENDING
const T2 = 'FIXTURE Beta Twin Bunk Bed 861654'
const T3 = 'FIXTURE Gamma Daybed Trundle 1125049'
const T4 = 'FIXTURE Delta Storage Bed 2001001' // 优选 APPROVED + 正式入库
const T5 = 'FIXTURE Epsilon Canopy Bed 2001002' // 优选 PENDING
const T6 = 'FIXTURE Zeta Loft Bed with Desk 2001003'

const ownerProfile = {
  id: 'se-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'se-org', name: '入库排除验收组织' }, roles: [], permissions: 'ALL', stores: null
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocked-exclusion-'))
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
      localStorage.setItem('sourcing.server-url:v1', 'https://stocked-exclusion-mock.invalid')
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'se-owner', refreshToken: 'se-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile })
    await page.reload()
    await page.waitForTimeout(1200)

    const flowNav = page.locator('.selection-module-nav.warehouse-flow-nav')
    const candidateCards = page.locator('.candidate-catalog-main .product-grid .candidate-product-card')
    const selectionCards = page.locator('.selection-card')
    const mainText = async () => (await page.locator('.candidate-catalog-main').innerText())
    const badge = async (name) => (await flowNav.getByRole('button', { name }).locator('em').innerText()).trim()
    const goCandidates = async () => { await flowNav.getByRole('button', { name: '采集侯选' }).click(); await page.waitForTimeout(500) }
    const goSelection = async () => { await flowNav.getByRole('button', { name: /优选产品/ }).click(); await page.waitForSelector('.selection-workbench', { timeout: 8000 }); await page.waitForTimeout(400) }

    await page.locator('.sidebar').getByRole('button', { name: '货盘采集', exact: true }).click()
    await page.waitForSelector('.ai-collect-grid', { timeout: 8000 })
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).click()
    await page.waitForTimeout(800)

    // ── 初始状态 ──
    console.log('初始排除状态')
    await goCandidates()
    assert('采集候选仅 u2/u3/u6 共 3 卡', await candidateCards.count() === 3)
    const text0 = await mainText()
    assert('u1/u4/u5 均不在采集候选', !text0.includes(T1) && !text0.includes(T4) && !text0.includes(T5))
    assert('u2/u3/u6 在采集候选', text0.includes(T2) && text0.includes(T3) && text0.includes(T6))
    assert('页头计数 3', (await page.locator('.warehouse-page-heading em').innerText()).trim() === '3')
    const summary0 = await page.locator('.candidate-zone-summary').innerText()
    assert('摘要候选商品/当前显示 3', summary0.includes('候选商品 3') && summary0.includes('当前显示 3'))
    assert('优选产品徽标 2（APPROVED 已隐藏）', await badge(/优选产品/) === '2')
    assert('正式入库徽标 1', await badge(/正式入库/) === '1')
    await page.screenshot({ path: path.join(ARTIFACTS, 'stocked-exclusion-01-candidates.png') })

    // ── 场景1：点优选立即消失 ──
    console.log('场景1 优选后立即消失')
    await page.locator('.candidate-product-card', { hasText: T2 }).locator('.candidate-next-actions button.search-1688').click()
    await page.waitForSelector('.selection-workbench', { timeout: 8000 })
    await page.waitForTimeout(400)
    assert('优选产品出现 u2 共 3 项（不含 APPROVED）', await selectionCards.count() === 3)
    await goCandidates()
    assert('u2 立即消失剩 2 卡', await candidateCards.count() === 2)
    assert('候选仅剩 u3/u6', !(await mainText()).includes(T2))

    // ── 场景3：返回AI候选恢复 ──
    console.log('场景3 返回AI候选恢复')
    await goSelection()
    await page.locator('.selection-card', { hasText: T2 }).getByRole('button', { name: '候选', exact: true }).click()
    await page.waitForTimeout(400)
    assert('优选产品回落 2 项', await selectionCards.count() === 2)
    await goCandidates()
    assert('u2 重回采集候选共 3 卡', await candidateCards.count() === 3 && (await mainText()).includes(T2))

    // ── 入库去重：APPROVED+入库商品在优选产品隐藏且无返回入口 ──
    console.log('入库去重 无返回入口')
    await goSelection()
    assert('u4（APPROVED+入库）不在优选产品列表', await page.locator('.selection-card', { hasText: T4 }).count() === 0)
    assert('正式入库徽标仍 1', await badge(/正式入库/) === '1')
    await goCandidates()
    assert('u4 不回流：采集候选仍 3 卡', await candidateCards.count() === 3)
    const text4 = await mainText()
    assert('采集候选不含 u4 且含 u2/u3/u6', !text4.includes(T4) && text4.includes(T2) && text4.includes(T3) && text4.includes(T6))
    await page.screenshot({ path: path.join(ARTIFACTS, 'stocked-exclusion-02-stocked-kept.png') })

    assert('渲染进程无未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error(pageErrors.join('\n'))
  } finally {
    await app.close()
  }
  console.log(failures === 0 ? 'VERIFY_OK 全部断言通过' : `VERIFY_FAILED ${failures} 项断言失败`)
  process.exit(failures === 0 ? 0 : 1)
})()
