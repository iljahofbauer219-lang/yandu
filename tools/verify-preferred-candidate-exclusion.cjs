/**
 * 采集候选排除已优选 端到端 UI 验收（真实 Electron 渲染进程 + Playwright）。
 * fixture：大健云仓 3 个候选（u1/u2/u3），u1 已优选 → 候选列表只应显示 u2/u3。
 * 覆盖：列表排除、页头/摘要计数、AI采集 hub 候选计数、优选→立即消失、
 * 优选产品“候选”返回→立即恢复、已删除空态文案、优选产品徽标。
 *
 * 运行：先 pnpm build（或 vite build + tsc -p tsconfig.main.json），再 node tools/verify-preferred-candidate-exclusion.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ARTIFACTS = path.resolve(__dirname, '../artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const T1 = 'FIXTURE Alpha Gaming Loft Bed 1070409' // 已优选
const T2 = 'FIXTURE Beta Twin Bunk Bed 861654'
const T3 = 'FIXTURE Gamma Daybed Trundle 1125049'

const ownerProfile = {
  id: 'pe-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'pe-org', name: '优选排除验收组织' }, roles: [], permissions: 'ALL', stores: null
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preferred-exclusion-'))
  const dbPath = path.join(userDataDir, 'sourcing-data.sqlite')

  const seed = spawnSync(executablePath, [path.resolve(__dirname, 'fixture-seed-preferred-exclusion.cjs'), dbPath], {
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
      localStorage.setItem('sourcing.server-url:v1', 'https://preferred-exclusion-mock.invalid')
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'pe-owner', refreshToken: 'pe-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile })
    await page.reload()
    await page.waitForTimeout(1200)

    const flowNav = page.locator('.selection-module-nav.warehouse-flow-nav')
    const candidateCards = page.locator('.candidate-catalog-main .product-grid .candidate-product-card')
    const mainText = async () => (await page.locator('.candidate-catalog-main').innerText())

    // ── AI采集 hub：大健云仓卡片候选计数已排除已优选（3-1=2） ──
    console.log('AI采集 hub 计数')
    await page.locator('.sidebar').getByRole('button', { name: 'AI采集', exact: true }).click()
    await page.waitForSelector('.ai-collect-grid', { timeout: 8000 })
    const gigaCard = page.locator('.ai-collect-card', { hasText: '大健云仓' })
    assert('大健云仓卡片候选计数为 2（排除已优选）', (await gigaCard.locator('.ai-collect-card-count').innerText()).includes('2'))

    // ── 进入大健云仓采集候选 ──
    console.log('采集候选列表排除')
    await gigaCard.click()
    await page.waitForTimeout(800)
    await flowNav.getByRole('button', { name: '采集侯选' }).click()
    await page.waitForSelector('.candidate-catalog-main', { timeout: 8000 })
    await page.waitForTimeout(600)
    assert('候选卡片数为 2（u1 被排除）', await candidateCards.count() === 2)
    const text = await mainText()
    assert('已优选商品 u1 不在候选列表', !text.includes(T1))
    assert('未优选商品 u2/u3 仍在候选列表', text.includes(T2) && text.includes(T3))
    assert('页头计数为 2', (await page.locator('.warehouse-page-heading em').innerText()).trim() === '2')
    const summary = await page.locator('.candidate-zone-summary').innerText()
    assert('摘要“候选商品/当前显示”为 2', summary.includes('候选商品 2') && summary.includes('当前显示 2'))
    assert('优选产品徽标为 1', (await flowNav.getByRole('button', { name: /优选产品/ }).locator('em').innerText()).trim() === '1')
    await page.screenshot({ path: path.join(ARTIFACTS, 'preferred-exclusion-01-candidates.png') })

    // ── 优选 u2 → 立即从候选列表消失 ──
    console.log('优选后立即移除')
    await page.locator('.candidate-product-card', { hasText: T2 }).locator('.candidate-next-actions button.search-1688').click()
    await page.waitForSelector('.selection-workbench', { timeout: 8000 })
    await page.waitForTimeout(400)
    assert('优选后自动进入优选产品且共 2 个', await page.locator('.selection-card').count() === 2)
    assert('优选产品徽标升为 2', (await flowNav.getByRole('button', { name: /优选产品/ }).locator('em').innerText()).trim() === '2')
    await flowNav.getByRole('button', { name: '采集侯选' }).click()
    await page.waitForTimeout(600)
    assert('u2 立即从候选列表消失（剩 1）', await candidateCards.count() === 1)
    const text2 = await mainText()
    assert('候选列表仅剩 u3', !text2.includes(T2) && text2.includes(T3))

    // ── 优选产品“候选”返回 → 立即恢复候选 ──
    console.log('返回AI候选后立即恢复')
    await flowNav.getByRole('button', { name: /优选产品/ }).click()
    await page.waitForSelector('.selection-workbench', { timeout: 8000 })
    await page.locator('.selection-card', { hasText: T2 }).getByRole('button', { name: '候选', exact: true }).click()
    await page.waitForTimeout(400)
    assert('返回后优选产品剩 1 个', await page.locator('.selection-card').count() === 1)
    await flowNav.getByRole('button', { name: '采集侯选' }).click()
    await page.waitForTimeout(600)
    assert('u2 立即恢复出现在候选列表（共 2）', await candidateCards.count() === 2)
    const text3 = await mainText()
    assert('恢复后列表含 u2/u3 且不含 u1', text3.includes(T2) && text3.includes(T3) && !text3.includes(T1))
    assert('优选产品徽标回落为 1', (await flowNav.getByRole('button', { name: /优选产品/ }).locator('em').innerText()).trim() === '1')
    await page.screenshot({ path: path.join(ARTIFACTS, 'preferred-exclusion-02-restored.png') })

    // ── 已删除视图：空态文案说明已优选不再重复显示 ──
    console.log('已删除视图与空态文案')
    await page.locator('.candidate-filterbar select').nth(1).selectOption('DELETED')
    await page.waitForTimeout(500)
    assert('已删除视图无候选卡片', await candidateCards.count() === 0)
    assert('空态提示已优选/已入库移入对应仓库', (await mainText()).includes('已优选或已正式入库商品已移入对应仓库，不再重复显示在采集候选'))
    await page.locator('.candidate-filterbar select').nth(1).selectOption('ALL')
    await page.waitForTimeout(500)
    assert('切回全部状态后候选恢复 2 个', await candidateCards.count() === 2)
    await page.screenshot({ path: path.join(ARTIFACTS, 'preferred-exclusion-03-final.png') })

    assert('渲染进程无未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error(pageErrors.join('\n'))
  } finally {
    await app.close()
  }
  console.log(failures === 0 ? 'VERIFY_OK 全部断言通过' : `VERIFY_FAILED ${failures} 项断言失败`)
  process.exit(failures === 0 ? 0 : 1)
})()
