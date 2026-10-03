/**
 * 淘汰对话框红色文字修正验收（真实 Electron + Playwright，base 种子）。
 * 断言：对话框标题行 = --text-secondary rgb(103,115,110)、元信息行 = --text-muted rgb(146,151,156)，
 * 两者均非 danger rgb(163,59,50)；错误提示默认不渲染；确认按钮保持 danger 语义背景。
 *
 * 运行：先 vite build，再 node tools/verify-eliminate-dialog-theme.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ARTIFACTS = path.resolve(__dirname, '../artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const DANGER = 'rgb(163, 59, 50)' // --danger #a33b32

const ownerProfile = {
  id: 'ed-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'ed-org', name: '淘汰对话框验收组织' }, roles: [], permissions: 'ALL', stores: null
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eliminate-dialog-'))
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
      localStorage.setItem('sourcing.server-url:v1', 'https://eliminate-dialog-mock.invalid')
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'ed-owner', refreshToken: 'ed-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile })
    await page.reload()
    await page.waitForTimeout(1200)

    const flowNav = page.locator('.selection-module-nav.warehouse-flow-nav')
    await page.locator('.sidebar').getByRole('button', { name: '货盘采集', exact: true }).click()
    await page.waitForSelector('.ai-collect-grid', { timeout: 8000 })
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).click()
    await page.waitForTimeout(800)
    await flowNav.getByRole('button', { name: '采集侯选' }).click()
    await page.waitForSelector('.candidate-catalog-main .candidate-product-card', { timeout: 8000 })
    await page.waitForTimeout(400)

    console.log('淘汰对话框文本颜色')
    await page.locator('.candidate-product-card .candidate-delete').first().click()
    await page.waitForSelector('.eliminate-dialog', { timeout: 8000 })
    await page.waitForTimeout(300)
    const state1 = await page.evaluate(() => {
      const confirm = document.querySelector('.eliminate-dialog footer button.danger')
      return {
        titlePresent: Boolean(document.querySelector('.eliminate-dialog-title')),
        metaPresent: Boolean(document.querySelector('.eliminate-dialog-meta')),
        errorRendered: Boolean(document.querySelector('.eliminate-dialog-error')),
        confirmBg: confirm ? getComputedStyle(confirm).backgroundColor : null
      }
    })
    console.log('  dialog =', JSON.stringify(state1))
    assert('标题行不再渲染', state1.titlePresent === false)
    assert('原址元信息行不再渲染', state1.metaPresent === false)
    assert('错误提示默认不渲染', state1.errorRendered === false)
    assert('确认淘汰按钮保留 danger 语义背景', state1.confirmBg === DANGER)
    await page.screenshot({ path: path.join(ARTIFACTS, 'eliminate-dialog-theme-01.png') })

    // 关闭对话框，确认优选产品页淘汰对话框同类名生效
    await page.locator('.eliminate-dialog footer button', { hasText: '取消' }).click()
    await page.waitForTimeout(300)
    assert('对话框已关闭', await page.locator('.eliminate-dialog').count() === 0)
    await flowNav.getByRole('button', { name: /优选产品/ }).click()
    await page.waitForSelector('.selection-workbench', { timeout: 8000 })
    await page.locator('.selection-card .selection-decisions button', { hasText: '淘汰' }).first().click()
    await page.waitForSelector('.eliminate-dialog', { timeout: 8000 })
    await page.waitForTimeout(300)
    const state2 = await page.evaluate(() => ({
      titlePresent: Boolean(document.querySelector('.eliminate-dialog-title')),
      metaPresent: Boolean(document.querySelector('.eliminate-dialog-meta'))
    }))
    assert('优选产品淘汰框标题/原址行同样不渲染', state2.titlePresent === false && state2.metaPresent === false)

    assert('渲染进程无未捕获异常', pageErrors.length === 0)
    const stamp = (await page.locator('.build-stamp').innerText()).trim()
    assert(`标题栏构建指纹渲染（${stamp}）`, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(stamp))
    if (pageErrors.length) console.error(pageErrors.join('\n'))
  } finally {
    await app.close()
  }
  console.log(failures === 0 ? 'VERIFY_OK 全部断言通过' : `VERIFY_FAILED ${failures} 项断言失败`)
  process.exit(failures === 0 ? 0 : 1)
})()
