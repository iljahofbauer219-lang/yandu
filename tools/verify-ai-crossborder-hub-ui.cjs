/**
 * AI跨境 hub 页 UI 验收（真实 Electron 渲染进程 + Playwright）。
 * 覆盖：页头标题/副标题完整显示不被顶栏裁切、重复「功能建设中」占位块已删除、
 * 小窗口下不裁切、CB资讯兜底占位与 eBay hub 相邻页无回归。
 *
 * 运行：npm run build && node tools/verify-ai-crossborder-hub-ui.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const http = require('node:http')

function startMockServer(routes) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://local').pathname
    const body = routes[pathname]
    res.setHeader('content-type', 'application/json')
    if (!body) { res.statusCode = 404; res.end(JSON.stringify({ message: 'not mocked' })); return }
    res.end(JSON.stringify(body))
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

const ARTIFACTS = path.resolve(__dirname, '../artifacts/ai-crossborder-hub-ui')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const ownerProfile = {
  id: 'ac-ui-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'ac-ui-org', name: 'AI跨境页验收组织' }, roles: [], permissions: 'ALL', stores: null
}

const RECT_PROBE = () => {
  const pick = el => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, height: b.height } }
  const main = document.querySelector('.app-shell > main')
  const section = document.querySelector('section.ai-crossborder-page')
  if (!main || !section) return null
  const header = section.querySelector('.ai-crossborder-header')
  const h2 = header && header.querySelector('h2')
  const p = header && header.querySelector('p')
  return {
    main: pick(main), section: pick(section),
    header: header ? pick(header) : null,
    h2: h2 ? pick(h2) : null, p: p ? pick(p) : null,
    h2Text: h2 ? h2.textContent : '', pText: p ? p.textContent : ''
  }
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ac-hub-ui-'))

  const mockServer = await startMockServer({
    '/api/auth/me': ownerProfile,
    '/api/erp/capabilities': { canViewSource: true, canCollect: true, canEdit: true, canPricing: true, canResolveChanges: true },
    '/api/erp/products': { items: [], total: 0, page: 1, pageSize: 100 }
  })
  const mockUrl = `http://127.0.0.1:${mockServer.address().port}`
  fs.writeFileSync(path.join(userDataDir, 'server-config.json'), JSON.stringify({ serverUrl: mockUrl }, null, 2))

  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: path.resolve(__dirname, '..'), env: { ...process.env, CODEX_UI_TEST: '1', YANDU_HOT_DIR: path.join(userDataDir, 'no-hot') } })
  let failures = 0
  const assert = (name, cond) => { if (cond) console.log(`  ✔ ${name}`); else { failures += 1; console.error(`  ✘ ${name}`) } }
  try {
    const pageErrors = []
    const page = await app.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('dialog', dialog => dialog.accept())
    await page.waitForLoadState('domcontentloaded')

    await page.evaluate(({ profile, serverUrl }) => {
      localStorage.setItem('sourcing.server-url:v1', serverUrl)
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'ac-ui-owner', refreshToken: 'ac-ui-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile, serverUrl: mockUrl })
    await page.reload()
    await page.waitForTimeout(1200)

    // 进入 AI跨境 hub 页
    await page.locator('.sidebar').getByRole('button', { name: 'AI跨境', exact: true }).click()
    await page.locator('.ai-crossborder-grid').waitFor({ state: 'visible', timeout: 8000 })
    await page.waitForTimeout(400)

    // 绿框：重复占位块删除，仅保留一个 section
    assert('AI跨境页仅渲染一个 section', await page.locator('section.ai-crossborder-page').count() === 1)
    assert('AI跨境页不再出现功能建设中占位块', await page.locator('main').getByText('功能建设中').count() === 0)

    // 红框：页头标题与副标题完整显示，不被顶栏裁切
    let rects = await page.evaluate(RECT_PROBE)
    assert('页头 h2 完整显示不被顶栏裁切', Boolean(rects) && rects.h2.height > 10 && rects.h2.top >= rects.main.top - 0.5)
    assert('副标题完整显示且在 section 内', Boolean(rects) && rects.p.top >= rects.main.top - 0.5 && rects.header.bottom <= rects.section.bottom + 0.5)
    assert('页头文案正确', rects.h2Text === 'AI跨境' && rects.pText === '7大跨境电商平台智能运营中心')
    assert('七平台卡片齐备', await page.locator('.ai-crossborder-grid .ai-crossborder-card').count() === 7)
    assert('eBay 卡保留进入平台', await page.locator('.ai-crossborder-grid .ai-crossborder-card', { hasText: 'eBay' }).getByText('进入平台').count() === 1)
    assert('标题/描述/图片优化中转入口已删除', await page.locator('main').getByText('描述优化').count() === 0 && await page.locator('main').getByText('图片优化').count() === 0)
    await page.screenshot({ path: path.join(ARTIFACTS, 'ai-crossborder.png') })

    // 小窗口下页头仍不裁切（safe center 回退对齐起点）
    await page.setViewportSize({ width: 1000, height: 460 })
    await page.waitForTimeout(400)
    rects = await page.evaluate(RECT_PROBE)
    assert('小窗口下页头仍完整可见', Boolean(rects) && rects.h2.top >= rects.main.top - 0.5 && rects.header.top >= rects.section.top - 0.5)
    await page.screenshot({ path: path.join(ARTIFACTS, 'ai-crossborder-small.png') })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.waitForTimeout(400)

    // 相邻页回归：CB资讯兜底占位保留（侧边栏入口已移入 AI星球 hub 卡）
    await page.locator('.sidebar').getByRole('button', { name: 'AI星球', exact: true }).click()
    const cbCard = page.locator('.ai-crossborder-entries .ai-crossborder-card', { hasText: 'CB资讯' })
    await cbCard.waitFor({ state: 'visible', timeout: 8000 })
    await cbCard.click()
    await page.waitForTimeout(600)
    assert('CB资讯兜底占位保留', await page.locator('section.ai-crossborder-page').count() === 1 && await page.locator('main').getByText('功能建设中').count() === 1)
    rects = await page.evaluate(RECT_PROBE)
    assert('CB资讯页头完整显示', Boolean(rects) && rects.h2Text === 'CB资讯' && rects.h2.top >= rects.main.top - 0.5)

    // 相邻页回归：eBay 卡直连平台登录工作台，不经中转页
    await page.locator('.sidebar').getByRole('button', { name: 'AI跨境', exact: true }).click()
    await page.locator('.ai-crossborder-grid').waitFor({ state: 'visible', timeout: 8000 })
    await page.locator('.ai-crossborder-grid .ai-crossborder-card', { hasText: 'eBay' }).click()
    await page.locator('section.ebay-platform-page').waitFor({ state: 'visible', timeout: 8000 })
    await page.waitForTimeout(600)
    assert('eBay 卡直连平台登录工作台', await page.locator('section.ebay-platform-page').count() === 1)
    assert('直连后不再渲染中转页 section', await page.locator('section.ai-crossborder-page').count() === 0)
    await page.screenshot({ path: path.join(ARTIFACTS, 'ebay-login.png') })

    assert('无渲染进程异常', pageErrors.length === 0)
    if (pageErrors.length) console.error(pageErrors.join('\n'))
  } finally {
    await app.close().catch(() => {})
    mockServer.close()
  }
  console.log(failures === 0 ? 'AI跨境 hub 页验收通过' : `AI跨境 hub 页验收失败 ${failures} 项`)
  process.exit(failures === 0 ? 0 : 1)
})()
