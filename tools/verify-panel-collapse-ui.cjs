/**
 * 全局侧栏收起/展开 端到端 UI 验收（真实 Electron 渲染进程 + Playwright）。
 * 覆盖：标题栏统一开关、面板内收起按钮、收起后展开轨、按区域独立持久化、
 * 货盘仓库目录库 / AI采集工作台 / 图片工作室（左+右面板）三处双栏区域。
 * 后端 API 用 page.route 拦截鉴权回放 mock，其余放行到不可解析 host 快速失败。
 *
 * 运行：node tools/verify-panel-collapse-ui.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const ARTIFACTS = path.resolve(__dirname, '../artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const ownerProfile = {
  id: 'pc-ui-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'pc-ui-org', name: '收起展开验收组织' }, roles: [], permissions: 'ALL', stores: null
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-collapse-ui-'))
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
      localStorage.setItem('sourcing.server-url:v1', 'https://panel-collapse-mock.invalid')
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'pc-ui-owner', refreshToken: 'pc-ui-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
      localStorage.removeItem('app-panel-collapse:v1')
    }, { profile: ownerProfile })
    await page.reload()
    await page.waitForTimeout(1200)

    const titlebarToggle = (label) => page.locator('.app-titlebar-actions button', { hasText: label }).first()
    const count = (selector) => page.locator(selector).count()
    const visible = async (selector) => (await count(selector)) > 0 && await page.locator(selector).first().isVisible()

    // ── 区域 1：货盘仓库 · 产品目录库 ──
    console.log('货盘仓库 · 产品目录库')
    await page.locator('.sidebar').getByRole('button', { name: '货盘仓库', exact: true }).click()
    await page.waitForSelector('.candidate-page', { timeout: 8000 })
    await page.waitForTimeout(400)
    assert('展开态：目录库面板可见', await visible('.catalog-panel'))
    assert('展开态：标题栏出现「收起」开关', await titlebarToggle('收起').isVisible())
    assert('展开态：面板内收起按钮可见', await visible('.catalog-panel .panel-collapse-toggle'))
    await page.screenshot({ path: path.join(ARTIFACTS, 'panel-collapse-01-pallet-expanded.png') })

    await titlebarToggle('收起').click()
    await page.waitForTimeout(500)
    assert('标题栏收起后：目录库面板卸载', (await count('.catalog-panel')) === 0)
    assert('标题栏收起后：容器进入 side-collapsed', (await count('.candidate-page.side-collapsed')) === 1)
    assert('标题栏收起后：展开轨可见', await visible('.candidate-page > .panel-expand-rail'))
    assert('标题栏收起后：标题栏开关变为「展开」', await titlebarToggle('展开').isVisible())
    await page.screenshot({ path: path.join(ARTIFACTS, 'panel-collapse-02-pallet-collapsed.png') })

    await page.locator('.candidate-page > .panel-expand-rail').click()
    await page.waitForTimeout(500)
    assert('展开轨点击后：目录库面板恢复', await visible('.catalog-panel'))

    await page.locator('.catalog-panel .panel-collapse-toggle').click()
    await page.waitForTimeout(500)
    assert('面板内按钮收起：目录库面板卸载', (await count('.catalog-panel')) === 0)

    await page.reload()
    await page.waitForTimeout(1200)
    await page.locator('.sidebar').getByRole('button', { name: '货盘仓库', exact: true }).click()
    await page.waitForSelector('.candidate-page', { timeout: 8000 })
    await page.waitForTimeout(400)
    assert('刷新后保持收起（localStorage 持久化）', (await count('.catalog-panel')) === 0 && (await count('.candidate-page.side-collapsed')) === 1)
    await page.screenshot({ path: path.join(ARTIFACTS, 'panel-collapse-03-pallet-persisted.png') })
    await page.locator('.candidate-page > .panel-expand-rail').click()
    await page.waitForTimeout(500)
    assert('持久化收起后可再展开', await visible('.catalog-panel'))

    // ── 区域 2：AI采集 · 采集工作台（独立状态，默认展开） ──
    console.log('AI采集 · 采集工作台')
    await page.locator('.sidebar').getByRole('button', { name: '货盘采集', exact: true }).click()
    await page.waitForSelector('.ai-collect-page', { timeout: 8000 })
    await page.locator('.ai-collect-card').first().click()
    await page.waitForSelector('.workspace', { timeout: 8000 })
    await page.waitForTimeout(400)
    assert('采集工作台默认展开（与货盘仓库状态独立）', await visible('.task-panel'))
    await titlebarToggle('收起').click()
    await page.waitForTimeout(500)
    assert('标题栏收起作用于当前页：采集工作台面板卸载', (await count('.task-panel')) === 0 && (await count('.workspace.side-collapsed')) === 1)
    assert('采集工作台收起后展开轨可见', await visible('.workspace > .panel-expand-rail'))
    await page.screenshot({ path: path.join(ARTIFACTS, 'panel-collapse-04-tasks-collapsed.png') })
    await page.locator('.workspace > .panel-expand-rail').click()
    await page.waitForTimeout(500)
    assert('采集工作台展开轨恢复面板', await visible('.task-panel'))

    // ── 区域 3：图片工作室（左工具面板 + 右设置面板） ──
    console.log('AI美工 · 图片工作室')
    await page.locator('.sidebar').getByRole('button', { name: 'AI美工', exact: true }).click()
    await page.waitForSelector('.ai-crossborder-page', { timeout: 8000 })
    await page.getByText('AI生图', { exact: true }).first().click()
    await page.waitForSelector('.image-studio', { timeout: 8000 })
    await page.waitForTimeout(400)
    assert('图片工作室左面板可见', await visible('.image-tool-panel'))
    assert('图片工作室右设置面板可见', await visible('.image-settings'))
    await page.locator('.image-tool-panel .panel-collapse-toggle').click()
    await page.waitForTimeout(500)
    assert('左面板收起：工具面板卸载', (await count('.image-tool-panel')) === 0 && (await count('.image-studio.side-collapsed')) === 1)
    await page.locator('.image-settings .panel-collapse-toggle').click()
    await page.waitForTimeout(500)
    assert('右面板收起：设置面板卸载且容器右收起', (await count('.image-settings')) === 0 && (await count('.image-editor.side-right-collapsed')) === 1)
    await page.screenshot({ path: path.join(ARTIFACTS, 'panel-collapse-05-image-studio-collapsed.png') })
    await page.locator('.image-studio > .panel-expand-rail').click()
    await page.waitForTimeout(300)
    await page.locator('.image-editor > .panel-expand-rail').click()
    await page.waitForTimeout(500)
    assert('左右面板均可经展开轨恢复', await visible('.image-tool-panel') && await visible('.image-settings'))

    // ── 响应式：小屏（<1280）无存档时默认收起；深色主题样式 ──
    console.log('响应式小屏与深色主题')
    await page.setViewportSize({ width: 1100, height: 800 })
    await page.evaluate(() => localStorage.removeItem('app-panel-collapse:v1'))
    await page.reload()
    await page.waitForTimeout(1200)
    await page.locator('.sidebar').getByRole('button', { name: '货盘仓库', exact: true }).click()
    await page.waitForSelector('.candidate-page', { timeout: 8000 })
    await page.waitForTimeout(400)
    assert('小屏（<1280）无存档时默认收起', (await count('.catalog-panel')) === 0 && (await count('.candidate-page.side-collapsed')) === 1)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => {
      localStorage.setItem('app-theme:v1', 'dark')
      localStorage.setItem('app-panel-collapse:v1', JSON.stringify({ 'pallet-catalog': false }))
    })
    await page.reload()
    await page.waitForTimeout(1200)
    await page.locator('.sidebar').getByRole('button', { name: '货盘仓库', exact: true }).click()
    await page.waitForSelector('.candidate-page', { timeout: 8000 })
    await page.waitForTimeout(400)
    assert('深色主题生效', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')
    assert('深色主题下展开态正常', await visible('.catalog-panel') && await visible('.catalog-panel .panel-collapse-toggle'))
    await page.screenshot({ path: path.join(ARTIFACTS, 'panel-collapse-06-dark-expanded.png') })

    assert('渲染进程无未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error('pageErrors:', pageErrors.slice(0, 5))
  } catch (error) {
    failures += 1
    console.error('验收中断：', error)
  } finally {
    await app.close().catch(() => {})
  }
  console.log(failures === 0 ? 'PASS 全局侧栏收起/展开验收通过' : `FAIL ${failures} 项未通过`)
  process.exit(failures === 0 ? 0 : 1)
})()
