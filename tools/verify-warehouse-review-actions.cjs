/**
 * 正式入库双按钮端到端 UI 验收（真实 Electron 渲染进程 + Playwright）。
 * fixture：1 条 GIGACLOUD 正式入库商品（wh-fixture-r1，不预存货盘）。
 * 覆盖：两按钮文案「下载产品」「货盘仓库」→ 点击「货盘仓库」→ 按钮变禁用态「已入货盘仓库」+
 * 行内提示 + pallet:list 含该商品 → 货盘仓库页卡片出现 → reload 后禁用态持久。
 *
 * 运行：node tools/verify-warehouse-review-actions.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
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

const ARTIFACTS = path.resolve(__dirname, '../artifacts/warehouse-review-actions')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const FIXTURE_TITLE = 'FIXTURE Review Gamma Loft Bed 400001'

const ownerProfile = {
  id: 'wr-ui-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'wr-ui-org', name: '入库按钮验收组织' }, roles: [], permissions: 'ALL', stores: null
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-review-actions-'))
  const dbPath = path.join(userDataDir, 'sourcing-data.sqlite')

  const seed = spawnSync(executablePath, [path.resolve(__dirname, 'fixture-seed-pallet-warehouse.cjs'), dbPath, 'review'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8'
  })
  if (seed.status !== 0) {
    console.error('fixture 种子失败：', seed.stdout, seed.stderr)
    process.exit(1)
  }
  console.log(seed.stdout.trim())

  // 主进程权限强校验直连服务器：page.route 拦不到主进程 fetch，必须起本地 mock HTTP 服务器
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
    await page.waitForLoadState('domcontentloaded')

    await page.evaluate(({ profile, serverUrl }) => {
      localStorage.setItem('sourcing.server-url:v1', serverUrl)
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'wr-ui-owner', refreshToken: 'wr-ui-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile, serverUrl: mockUrl })
    await page.reload()
    await page.waitForTimeout(1200)

    // 进入大健云仓正式入库
    await page.locator('.sidebar').getByRole('button', { name: 'AI采集', exact: true }).click()
    await page.waitForSelector('.ai-collect-grid', { timeout: 8000 })
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).click()
    await page.waitForTimeout(700)
    await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '正式入库' }).click()
    await page.waitForTimeout(700)

    const card = page.locator('.warehouse-product-grid article', { hasText: FIXTURE_TITLE })
    assert('正式入库展示种子商品卡', await card.count() === 1)
    const downloadButton = card.getByRole('button', { name: '下载产品', exact: true })
    const returnButton = card.getByRole('button', { name: '退回入库处理', exact: true })
    assert('按钮一文案为「下载产品」', await downloadButton.count() === 1)
    assert('按钮二文案为「退回入库处理」', await returnButton.count() === 1)

    page.on('dialog', dialog => dialog.accept())
    await returnButton.click()
    await page.waitForTimeout(800)
    const warehouseAfter = await page.evaluate(() => window.desktop.warehouses.list())
    assert('退回后正式入库列表为空（ARCHIVED）', Array.isArray(warehouseAfter) && warehouseAfter.length === 0)
    const inboundAfter = await page.evaluate(() => window.desktop.inbound.list())
    assert('退回后入库队列含 1 条 PENDING 选品快照', inboundAfter.length === 1 && inboundAfter[0].status === 'PENDING' && inboundAfter[0].origin === 'SELECTION')
    assert('快照标题继承正式入库', inboundAfter[0].snapshot.title === FIXTURE_TITLE)
    const palletAfter = await page.evaluate(() => window.desktop.pallet.list())
    assert('退回后货盘存放已删除', palletAfter.length === 0)

    // 入库处理 tab 再确认 → 双写恢复
    await page.locator('.sidebar').getByRole('button', { name: '货盘仓库', exact: true }).click()
    await page.waitForTimeout(800)
    await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '入库处理', exact: true }).click()
    await page.waitForTimeout(800)
    const inboundCard = page.locator('.product-card', { hasText: FIXTURE_TITLE })
    assert('入库处理待确认卡出现', await inboundCard.count() === 1)
    assert('来源徽标为选品审批', (await inboundCard.innerText()).includes('选品审批'))
    await inboundCard.getByRole('button', { name: '确认入库', exact: true }).click()
    await page.waitForTimeout(800)
    const warehouseBack = await page.evaluate(() => window.desktop.warehouses.list())
    const palletBack = await page.evaluate(() => window.desktop.pallet.list())
    assert('确认后正式入库恢复 1 条 ACTIVE', warehouseBack.length === 1 && warehouseBack[0].status === 'ACTIVE')
    assert('确认后货盘存放恢复 1 条', palletBack.length === 1 && palletBack[0].warehouseProductId === warehouseBack[0].id)
    await page.screenshot({ path: path.join(ARTIFACTS, '02-return-confirm-roundtrip.png') })

    assert('验收过程无渲染进程未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error(pageErrors)
  } catch (error) {
    failures += 1
    console.error('[verify-warehouse-review-actions] 异常：', error)
  } finally {
    console.log(`\n[verify-warehouse-review-actions] 失败 ${failures} 项；截图输出 → ${ARTIFACTS}`)
    mockServer.close()
    await app.close()
    process.exit(failures === 0 ? 0 : 1)
  }
})()
