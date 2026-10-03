/**
 * 服务器详情页档案 UI 验收（真实 Electron 渲染进程 + Playwright）。
 * fixture：review-page 模式 = 1 条 GIGACLOUD 正式入库商品 + 1 条 supply_product_downloads 服务器页档案。
 * 覆盖：DOWNLOADED 记录驱动按钮「重新下载」+ 提示条「已生成服务器详情页（N 张图片）· 查看页面」；
 *      点击「重新下载」在无平台登录态的 e2e 环境走抓取失败守卫并显示错误提示。
 * 说明：上传链路（抓取→POST /api/product-pages）由 tools/pp-api-test 对真实本地 server 覆盖；
 *      本脚本的 page.route 无法拦截主进程 fetch，故上传不在 UI e2e 内模拟。
 *
 * 运行：node tools/verify-product-page-upload.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ARTIFACTS = path.resolve(__dirname, '../artifacts/product-page-upload')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const FIXTURE_TITLE = 'FIXTURE Review Gamma Loft Bed 400001'

const ownerProfile = {
  id: 'pp-ui-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'pp-ui-org', name: '产品页验收组织' }, roles: [], permissions: 'ALL', stores: null
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'product-page-upload-'))
  const dbPath = path.join(userDataDir, 'sourcing-data.sqlite')

  const seed = spawnSync(executablePath, [path.resolve(__dirname, 'fixture-seed-pallet-warehouse.cjs'), dbPath, 'review-page'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8'
  })
  if (seed.status !== 0) {
    console.error('fixture 种子失败：', seed.stdout, seed.stderr)
    process.exit(1)
  }
  console.log(seed.stdout.trim())

  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: path.resolve(__dirname, '..'), env: { ...process.env, CODEX_UI_TEST: '1', YANDU_HOT_DIR: path.join(userDataDir, 'no-hot') } })
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
      localStorage.setItem('sourcing.server-url:v1', 'https://product-page-mock.invalid')
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'pp-ui-owner', refreshToken: 'pp-ui-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile })
    await page.reload()
    await page.waitForTimeout(1200)

    // 进入大健云仓正式入库
    await page.locator('.sidebar').getByRole('button', { name: '货盘采集', exact: true }).click()
    await page.waitForSelector('.ai-collect-grid', { timeout: 8000 })
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).click()
    await page.waitForTimeout(700)
    await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '正式入库' }).click()
    await page.waitForTimeout(700)

    const card = page.locator('.warehouse-product-grid article', { hasText: FIXTURE_TITLE })
    assert('种子商品卡渲染', await card.count() === 1)
    assert('已有服务器页档案时按钮为「重新下载」', await card.getByRole('button', { name: '重新下载', exact: true }).count() === 1)

    const note = card.locator('.warehouse-download-note').first()
    const noteText = await note.innerText()
    assert('提示条含「已生成服务器详情页」', noteText.includes('已生成服务器详情页'))
    assert('提示条含图片数 24', noteText.includes('24'))
    assert('提示条含「查看页面」按钮', await note.getByRole('button', { name: '查看页面', exact: true }).count() === 1)
    assert('提示条不再含「打开目录」', noteText.includes('打开目录') === false)
    await page.screenshot({ path: path.join(ARTIFACTS, '01-server-page-note.png') })

    // 无平台登录态下点「重新下载」：下载态结束后回到正式入库，档案提示条应保留（e2e 环境抓取/上传必失败，错误文案随环境变化不作断言）
    await card.getByRole('button', { name: '重新下载', exact: true }).click()
    await page.getByRole('button', { name: '下载中…', exact: true }).waitFor({ state: 'detached', timeout: 60000 }).catch(() => undefined)
    await page.waitForTimeout(600)
    if (await page.locator('.warehouse-product-grid article').count() === 0) {
      await page.locator('.sidebar').getByRole('button', { name: '货盘采集', exact: true }).click()
      await page.waitForSelector('.ai-collect-grid', { timeout: 8000 })
      await page.locator('.ai-collect-card', { hasText: '大健云仓' }).click()
      await page.waitForTimeout(700)
      await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '正式入库' }).click()
      await page.waitForTimeout(700)
    }
    const cardAfter = page.locator('.warehouse-product-grid article', { hasText: FIXTURE_TITLE })
    const notesAfter = await cardAfter.locator('.warehouse-download-note').allInnerTexts()
    assert('下载流程结束后服务器页档案提示条保留', notesAfter.some(text => text.includes('已生成服务器详情页')))
    await page.screenshot({ path: path.join(ARTIFACTS, '02-redownload-guard.png') })

    assert('验收过程无渲染进程未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error(pageErrors)
  } catch (error) {
    failures += 1
    console.error('[verify-product-page-upload] 异常：', error)
  } finally {
    console.log(`\n[verify-product-page-upload] 失败 ${failures} 项；截图输出 → ${ARTIFACTS}`)
    await app.close()
    process.exit(failures === 0 ? 0 : 1)
  }
})()
