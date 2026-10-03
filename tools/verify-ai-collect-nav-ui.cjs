/**
 * AI采集模块导航站风格改版 端到端 UI 验收（真实 Electron 渲染进程 + Playwright）。
 * 对照方案验收标准：
 *  A. 顶页：标签栏（全部/国内/北美/欧洲/澳洲/中东/亚洲/拉美/非洲/市场平台 + 计数）、分区白卡（橙竖条标题 + N 个平台）、
 *     横向平台卡网格、tab 切换筛选与 active 高亮、点击平台卡进入采集工作台；
 *  B. 工作台「预采集产品」：高密度网址行列表（URL 单行省略、行操作、筛选/全选/清空/仅看已选）；
 *  C. 回归：AI总部等页仍为 .ai-crossborder-page 结构。
 * 后端 HTTP 用 page.route 回放鉴权 mock；tasks.create/tasks.preview 为 IPC，用 page.evaluate 桩替换。
 * 截图落 artifacts/，作为端到端功能验证证据。
 *
 * 运行：node tools/verify-ai-collect-nav-ui.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const ARTIFACTS = path.resolve(__dirname, '../artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const ownerProfile = {
  id: 'ac-ui-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'ac-ui-org', name: 'AI采集验收组织' }, roles: [], permissions: 'ALL', stores: null
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-collect-nav-ui-'))
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: path.resolve(__dirname, '..'), env: { ...process.env, CODEX_UI_TEST: '1' } })
  let failures = 0
  const assert = (name, cond) => { if (cond) console.log(`  ✔ ${name}`); else { failures += 1; console.error(`  ✘ ${name}`) } }
  try {
    const page = await app.firstWindow()
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded')

    await page.route('**/api/**', async route => {
      const p = new URL(route.request().url()).pathname
      if (p === '/api/auth/me') return route.fulfill(json(ownerProfile))
      return route.continue()
    })
    await page.evaluate(({ profile }) => {
      localStorage.setItem('sourcing.server-url:v1', 'https://ac-mock.invalid')
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'ac-ui-owner', refreshToken: 'ac-ui-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile })
    await page.reload()
    await page.waitForTimeout(1200)

    // ── A. 顶页 ──
    await page.getByRole('button', { name: 'AI采集' }).first().click()
    await page.waitForTimeout(700)
    await page.locator('.ai-collect-tabs').waitFor({ timeout: 5000 })
    assert('顶页渲染导航站式标签栏', await page.locator('.ai-collect-tabs .ai-collect-tab').count() === 10)
    assert('标签栏带平台计数徽章', (await page.locator('.ai-collect-tab').first().innerText()).includes('4'))
    assert('九个分区白卡（9 大货盘 + 市场平台）', await page.locator('.ai-collect-region').count() === 9)
    assert('分区标题含橙竖条与平台计数', await page.locator('.ai-collect-region-title .ai-collect-bar').count() === 9 && (await page.locator('.ai-collect-region-count').first().innerText()).includes('个平台'))
    assert('四个横向平台卡', await page.locator('.ai-collect-card').count() === 4)
    assert('平台卡带候选数徽章', (await page.locator('.ai-collect-card-count').first().innerText()).includes('候选'))
    assert('旧居中卡片结构已移除', await page.locator('.ai-collect-page .ai-crossborder-entries').count() === 0)
    await page.screenshot({ path: path.join(ARTIFACTS, 'ai-collect-nav-01-top.png') })

    await page.locator('.ai-collect-tab', { hasText: '国内货盘' }).click()
    await page.waitForTimeout(600)
    assert('tab 切换后 active 高亮国内货盘', (await page.locator('.ai-collect-tab.active').innerText()).includes('国内货盘'))
    assert('筛选后仅保留国内货盘分区', await page.locator('.ai-collect-region').count() === 1 && await page.locator('#ai-collect-region-DOMESTIC').count() === 1)
    await page.screenshot({ path: path.join(ARTIFACTS, 'ai-collect-nav-02-tab-domestic.png') })
    await page.locator('.ai-collect-tab', { hasText: '全部' }).click()
    await page.waitForTimeout(400)
    assert('切回全部恢复九个分区', await page.locator('.ai-collect-region').count() === 9)

    // ── B. 工作台网址行列表 ──
    await page.locator('.ai-collect-card', { hasText: '1688' }).click()
    await page.waitForTimeout(900)
    await page.getByText('采集工作台', { exact: false }).first().waitFor({ timeout: 5000 })
    assert('平台卡点击进入采集工作台', true)

    // 预采集列表由主进程 CODEX_UI_TEST mock 钩子（task:preview + 关键词 AC-UI-MOCK）回放确定性数据
    await page.locator('.task-panel input[placeholder="例如：宠物食品"]').fill('AC-UI-MOCK')
    await page.locator('.task-panel form button[type="submit"]').click()
    await page.waitForTimeout(1200)
    const diag = await page.evaluate(() => ({
      error: document.querySelector('.task-panel .error')?.textContent || '',
      hasCard: Boolean(document.querySelector('.collection-preview-card')),
      resultText: document.querySelector('.collection-result dd span')?.textContent || ''
    }))
    console.log('DIAG', JSON.stringify(diag))
    await page.locator('.collection-preview-list').waitFor({ timeout: 5000 })
    await page.waitForTimeout(400)
    assert('预采集产品渲染为高密度行列表', await page.locator('.collection-preview-row').count() === 3)
    assert('行内展示商品 URL（单行省略列）', (await page.locator('.collection-preview-row code').first().innerText()) === 'https://example.com/p/1')
    assert('标题行右侧已选/总计计数', (await page.locator('.collection-preview-count').innerText()).includes('已选 3 / 3'))
    assert('行操作含打开原址与复制网址', await page.locator('.collection-preview-row .row-action').count() === 6)
    const listStyle = await page.locator('.collection-preview-list').evaluate(el => { const s = getComputedStyle(el); return { maxHeight: s.maxHeight, overflowY: s.overflowY } })
    assert('列表容器 360px 上限且内部滚动', listStyle.maxHeight === '360px' && listStyle.overflowY === 'auto')
    await page.locator('.collection-preview-row').first().locator('.row-action[title="复制网址"]').click()
    await page.waitForTimeout(300)
    const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''))
    assert('复制网址写入剪贴板', clip === 'https://example.com/p/1')
    await page.locator('.collection-preview-card').scrollIntoViewIfNeeded()
    // 列表行居中于面板视口，避免被底部 sticky 的采集执行卡遮挡截图
    await page.evaluate(() => document.querySelector('.collection-preview-list')?.scrollIntoView({ block: 'center' }))
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(ARTIFACTS, 'ai-collect-nav-03-preview-list.png') })

    await page.locator('.collection-preview-tools input').fill('1688')
    await page.waitForTimeout(300)
    assert('筛选输入过滤网址行', await page.locator('.collection-preview-row').count() === 1)
    await page.locator('.collection-preview-tools input').fill('')
    await page.waitForTimeout(300)
    await page.locator('.collection-preview-tools button', { hasText: '清空' }).click()
    await page.waitForTimeout(300)
    assert('清空后计数归零且行去选中态', (await page.locator('.collection-preview-count').innerText()).includes('已选 0 / 3') && await page.locator('.collection-preview-row.selected').count() === 0)
    await page.locator('.collection-preview-tools button', { hasText: '全选' }).click()
    await page.waitForTimeout(300)
    assert('全选恢复选中态', await page.locator('.collection-preview-row.selected').count() === 3)
    await page.locator('.collection-preview-title button', { hasText: '仅看已选' }).click()
    await page.waitForTimeout(300)
    await page.locator('.collection-preview-row').first().locator('.row-check input').click()
    await page.waitForTimeout(300)
    assert('仅看已选联动行勾选', await page.locator('.collection-preview-row').count() === 2)

    // ── C. 回归 ──
    await page.setViewportSize({ width: 480, height: 700 })
    await page.getByRole('button', { name: 'AI采集' }).first().click()
    await page.waitForTimeout(600)
    const cols = await page.locator('.ai-collect-grid').first().evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)
    assert('窄窗口下平台卡网格自动折为单列', cols === 1)
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: 'AI总部' }).first().click()
    await page.waitForTimeout(700)
    assert('AI总部仍为 ai-crossborder-page 结构', await page.locator('section.ai-crossborder-page').count() >= 1 && (await page.locator('section.ai-crossborder-page h2').first().innerText()) === 'AI总部')

    const fatal = pageErrors.filter(message => !/fetch|network|load|Failed/i.test(message))
    assert('无致命渲染异常', fatal.length === 0)
    if (fatal.length) console.error(fatal.slice(0, 5))
  } catch (error) {
    failures += 1
    console.error(error)
  } finally {
    await app.close()
  }
  console.log(failures ? `FAIL (${failures})` : 'PASS')
  process.exit(failures ? 1 : 0)
})()
