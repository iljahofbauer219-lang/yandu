/**
 * 1688 仓 AI比价页候选排除验收（真实 Electron + Playwright）。
 * fixture（sourcing 模式）：1688 候选 p1/p2/p3，p1 已优选（SUPPLY 选品记录）。
 * 断言：AI比价页列表仅 p2/p3（页头计数 2、不含 p1）；采集候选页 2 卡不含 p1。
 *
 * 运行：先 vite build + tsc -p tsconfig.main.json，再 node tools/verify-sourcing-exclusion.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ARTIFACTS = path.resolve(__dirname, '../artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const P1 = 'FIXTURE 1688 Alpha Sofa Bed 700001' // 已优选
const P2 = 'FIXTURE 1688 Beta Bunk Bed 700002'
const P3 = 'FIXTURE 1688 Gamma Daybed 700003'

const ownerProfile = {
  id: 'sx-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'sx-org', name: '比价排除验收组织' }, roles: [], permissions: 'ALL', stores: null
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sourcing-exclusion-'))
  const dbPath = path.join(userDataDir, 'sourcing-data.sqlite')

  const seed = spawnSync(executablePath, [path.resolve(__dirname, 'fixture-seed-preferred-exclusion.cjs'), dbPath, 'sourcing'], {
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
      localStorage.setItem('sourcing.server-url:v1', 'https://sourcing-exclusion-mock.invalid')
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'sx-owner', refreshToken: 'sx-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile })
    await page.reload()
    await page.waitForTimeout(1200)

    const flowNav = page.locator('.selection-module-nav.warehouse-flow-nav')
    await page.locator('.sidebar').getByRole('button', { name: 'AI采集', exact: true }).click()
    await page.waitForSelector('.ai-collect-grid', { timeout: 8000 })
    await page.locator('.ai-collect-card', { hasText: '1688' }).click()
    await page.waitForTimeout(800)

    // ── AI比价页：已优选 p1 不展示 ──
    console.log('1688 AI比价页排除')
    await flowNav.getByRole('button', { name: 'AI比价' }).click()
    await page.waitForSelector('.warehouse-comparison-page', { timeout: 8000 })
    await page.waitForTimeout(500)
    const listText = await page.locator('.warehouse-comparison-list').innerText()
    assert('AI比价列表仅 2 项', await page.locator('.warehouse-comparison-list article').count() === 2)
    assert('AI比价页头计数 2', (await page.locator('.warehouse-comparison-page .warehouse-page-heading em').innerText()).trim() === '2')
    assert('已优选 p1 不在AI比价列表', !listText.includes(P1))
    assert('p2/p3 仍在AI比价列表', listText.includes(P2) && listText.includes(P3))
    await page.screenshot({ path: path.join(ARTIFACTS, 'sourcing-exclusion-01.png') })

    // ── 采集候选页：同口径排除 ──
    console.log('1688 采集候选同口径')
    await flowNav.getByRole('button', { name: '采集侯选' }).click()
    await page.waitForSelector('.candidate-catalog-main', { timeout: 8000 })
    await page.waitForTimeout(500)
    const candText = await page.locator('.candidate-catalog-main').innerText()
    assert('采集候选 2 卡且不含 p1', await page.locator('.candidate-catalog-main .product-grid .candidate-product-card').count() === 2 && !candText.includes(P1))
    assert('采集候选含 p2/p3', candText.includes(P2) && candText.includes(P3))

    assert('渲染进程无未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error(pageErrors.join('\n'))
  } finally {
    await app.close()
  }
  console.log(failures === 0 ? 'VERIFY_OK 全部断言通过' : `VERIFY_FAILED ${failures} 项断言失败`)
  process.exit(failures === 0 ? 0 : 1)
})()
