/**
 * 正式入库三操作端到端 UI 验收（真实 Electron 渲染进程 + Playwright）。
 * fixture：1 条 ACTIVE 与 1 条 PENDING_REVIEW 的 GIGACLOUD 正式入库商品。
 * 覆盖：下载图文 / 本仓入库 / 下架产品、退回再确认、下架原因及恢复上架。
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
const PENDING_TITLE = 'FIXTURE Review Pending Delta Bed 400002'

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
    page.on('dialog', dialog => dialog.accept())
    await page.waitForLoadState('domcontentloaded')

    await page.evaluate(({ profile, serverUrl }) => {
      localStorage.setItem('sourcing.server-url:v1', serverUrl)
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'wr-ui-owner', refreshToken: 'wr-ui-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile, serverUrl: mockUrl })
    await page.reload()
    await page.waitForTimeout(1200)

    // 进入大健云仓正式入库
    await page.locator('.sidebar').getByRole('button', { name: '货盘采集', exact: true }).click()
    const gigaCloudCard = page.locator('.ai-collect-card', { hasText: '大健云仓' })
    await gigaCloudCard.waitFor({ state: 'visible', timeout: 8000 })
    await gigaCloudCard.click()
    await page.waitForTimeout(700)
    await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '正式入库' }).click()
    await page.waitForTimeout(700)

    // 默认视图与分段顺序：进入即激活「入库处理」，全部产品置于末位
    const switchBar = page.locator('.supply-warehouse-page .candidate-view-switch')
    assert('进入正式入库默认激活入库处理', (await switchBar.locator('button.active').first().innerText()).includes('入库处理'))
    const segmentOrder = (await switchBar.locator('button').allInnerTexts()).map(text => text.replace(/\s*\d+\s*$/, '').trim())
    assert('分段顺序为入库处理/正式入库/下架产品/全部产品', segmentOrder.join(',') === '入库处理,正式入库,下架产品,全部产品')

    // 待复核二级闸口：每张卡固定提供下载图文、本仓入库、下架产品三项操作
    const pendingSection = page.locator('.warehouse-pending-review')
    assert('正式入库展示待复核区', await pendingSection.count() === 1)
    const pendingCard = pendingSection.locator('article', { hasText: PENDING_TITLE })
    assert('待复核卡展示种子商品', await pendingCard.count() === 1)
    assert('待复核卡提供下载图文', await pendingCard.getByRole('button', { name: '下载图文', exact: true }).count() === 1)
    assert('待复核卡提供查看页面', await pendingCard.getByRole('button', { name: '查看页面', exact: true }).count() === 1)
    assert('待复核卡提供本仓入库', await pendingCard.getByRole('button', { name: '本仓入库', exact: true }).count() === 1)
    assert('待复核卡不再提供下架产品', await pendingCard.getByRole('button', { name: '下架产品', exact: true }).count() === 0)
    await pendingCard.locator('button.product-image').click()
    await page.waitForTimeout(1200)
    const openedSource = await page.locator('.address-bar input').waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)
    const addressValue = openedSource ? await page.locator('.address-bar input').inputValue() : '(no address bar)'
    assert('入库处理主图开内嵌浏览器回原网址', openedSource && new URL(addressValue).hostname === 'www.gigab2b.com')
    await page.locator('.sidebar').getByRole('button', { name: '货盘采集', exact: true }).click()
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).click()
    await page.waitForTimeout(700)
    await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '正式入库' }).click()
    await page.waitForTimeout(700)
    await pendingCard.getByRole('button', { name: '本仓入库', exact: true }).click()
    await page.waitForTimeout(800)
    assert('本仓入库后待复核区清空', await page.locator('.warehouse-pending-review').count() === 0)

    // 顶部工具条：目录管理保留、进入AI选品与说明文字移除、分段按钮齐备
    const heading = page.locator('.supply-warehouse-page .warehouse-heading').first()
    assert('工具条保留目录管理', await heading.getByRole('button', { name: '目录管理', exact: true }).count() === 1)
    for (const name of ['全部产品', '入库处理', '正式入库', '下架产品']) {
      assert(`工具条含${name}`, await heading.getByRole('button', { name }).count() === 1)
    }
    assert('图文下载环节已移除', await heading.getByRole('button', { name: '图文下载' }).count() === 0)
    assert('工具条移除进入AI选品', await heading.getByRole('button', { name: '进入AI选品', exact: true }).count() === 0)
    assert('说明文字已移除', !(await page.locator('.supply-warehouse-page').first().innerText()).includes('商品入库不代表已实际采购'))
    assert('本仓入库后正式入库分段计数为2', (await heading.getByRole('button', { name: '正式入库' }).innerText()).includes('2'))
    assert('本仓入库后入库处理分段计数为0', (await heading.getByRole('button', { name: '入库处理' }).innerText()).trim().endsWith('0'))

    // 四分段均为阶段视图：入库处理仅待确认队列；正式入库展示 ACTIVE 卡；下架产品空态
    await heading.getByRole('button', { name: '入库处理' }).click()
    await page.waitForTimeout(300)
    assert('入库处理视图隐藏正式网格', await page.locator('section.supply-warehouse-page > .warehouse-product-grid').count() === 0)
    await heading.getByRole('button', { name: '正式入库' }).click()
    await page.waitForTimeout(300)
    assert('正式入库视图展示种子商品卡', await page.locator('section.supply-warehouse-page > .warehouse-product-grid article', { hasText: FIXTURE_TITLE }).count() === 1)
    await heading.getByRole('button', { name: '下架产品' }).click()
    await page.waitForTimeout(300)
    assert('下架产品视图空态提示', (await page.locator('.supply-warehouse-page').first().innerText()).includes('暂无下架产品'))
    await heading.getByRole('button', { name: '全部产品' }).click()
    await page.waitForTimeout(300)
    assert('全部产品视图展示正式网格', await page.locator('section.supply-warehouse-page > .warehouse-product-grid').count() === 1)

    // 正式入库 ACTIVE 卡：地区货盘下拉、抄送货盘、下架产品
    const card = page.locator('.warehouse-product-grid article', { hasText: FIXTURE_TITLE })
    assert('正式入库展示种子商品卡', await card.count() === 1)
    assert('ACTIVE 卡提供地区货盘下拉', await card.locator('.warehouse-region-select select').count() === 1)
    assert('ACTIVE 卡提供抄送货盘', await card.getByRole('button', { name: '抄送货盘', exact: true }).count() === 1)
    assert('ACTIVE 卡提供下架产品', await card.getByRole('button', { name: '下架产品', exact: true }).count() === 1)
    assert('ACTIVE 卡提供下载图文按钮', await card.getByRole('button', { name: '下载图文', exact: true }).count() === 1)
    assert('ACTIVE 卡提供查看页面按钮', await card.getByRole('button', { name: '查看页面', exact: true }).count() === 1)
    assert('ACTIVE 卡提供原址按钮', await card.getByRole('button', { name: /原址/ }).count() === 1)
    assert('正式入库卡地区行提供重读数据', await card.getByRole('button', { name: '重读数据', exact: true }).count() === 1)
    await card.getByRole('button', { name: '重读数据', exact: true }).click()
    await card.getByRole('button', { name: '重读数据', exact: true }).waitFor({ state: 'visible', timeout: 90000 })
    assert('重读数据结束按钮恢复可用', await card.getByRole('button', { name: '重读数据', exact: true }).isEnabled())
    assert('正式入库卡复用候选卡范式 class', await card.evaluate(el => el.classList.contains('product-card') && el.classList.contains('candidate-product-card') && el.classList.contains('supply-source-card')))
    assert('正式入库卡主图为候选卡范式', await card.locator(':scope > button.product-image').count() === 1)
    assert('正式入库卡信息区为候选卡范式', await card.locator(':scope > div.product-info.supply-source-info').count() === 1)
    assert('正式入库卡主图与查看页面禁用态同步', await card.locator(':scope > button.product-image').isDisabled() === await card.getByRole('button', { name: '查看页面', exact: true }).isDisabled())
    assert('无下载记录时查看页面禁用', await card.getByRole('button', { name: '查看页面', exact: true }).isDisabled())

    // 打回优选：第二张 fixture 卡离开正式入库
    const secondCard = page.locator('.warehouse-product-grid article', { hasText: PENDING_TITLE })
    assert('正式入库卡提供打回优选', await secondCard.getByRole('button', { name: '打回优选', exact: true }).count() === 1)
    await secondCard.getByRole('button', { name: '打回优选', exact: true }).click()
    await page.waitForTimeout(800)
    assert('打回优选后该品离开正式入库', await page.locator('.warehouse-product-grid article', { hasText: PENDING_TITLE }).count() === 0)
    const warehouseAfterPreferred = await page.evaluate(() => window.desktop.warehouses.list())
    assert('打回优选后正式入库仅余 1 条', warehouseAfterPreferred.length === 1 && warehouseAfterPreferred[0].id === 'wh-fixture-r1')
    assert('ACTIVE 卡不再提供退回入库处理', await card.getByRole('button', { name: '退回入库处理', exact: true }).count() === 0)
    await card.locator('.warehouse-region-select select').selectOption('美国货盘')
    await page.waitForTimeout(500)
    await page.locator('.warehouse-product-grid article', { hasText: FIXTURE_TITLE }).getByRole('button', { name: '抄送货盘', exact: true }).click()
    await page.waitForFunction(async () => (await window.desktop.inbound.list()).some(entry => entry.origin === 'WAREHOUSE'), null, { timeout: 15000 })

    // 货盘仓库入库处理：抄送行带来源与地区徽标；地区选品分组可见
    await page.locator('.sidebar').getByRole('button', { name: '货盘仓库', exact: true }).click()
    await page.waitForTimeout(800)
    await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '入库处理', exact: true }).click()
    await page.waitForTimeout(800)
    const inboundCard = page.locator('.product-card', { hasText: FIXTURE_TITLE })
    assert('抄送生成入库处理待确认卡', await inboundCard.count() === 1)
    assert('入库处理来源徽标为正式入库抄送', (await inboundCard.innerText()).includes('正式入库抄送'))
    assert('入库处理卡展示美国货盘徽标', (await inboundCard.innerText()).includes('美国货盘'))
    await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '地区选品', exact: true }).click()
    await page.waitForTimeout(600)
    assert('地区选品展示美国货盘分组', (await page.locator('.candidate-catalog-main').innerText()).includes('美国货盘'))
    await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '入库处理', exact: true }).click()
    await page.waitForTimeout(600)
    await page.locator('.product-card', { hasText: FIXTURE_TITLE }).getByRole('button', { name: '确认入库', exact: true }).click()
    await page.waitForTimeout(800)
    const palletBack = await page.evaluate(() => window.desktop.pallet.list())
    assert('确认后货盘存放 1 条', palletBack.length === 1 && palletBack[0].warehouseProductId === 'wh-fixture-r1')
    await page.screenshot({ path: path.join(ARTIFACTS, '02-copy-pallet-roundtrip.png') })

    // 下架 → 下架产品视图三按钮：更新产品 / 重新上架 / 删除产品
    await page.locator('.sidebar').getByRole('button', { name: '货盘采集', exact: true }).click()
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).waitFor({ state: 'visible', timeout: 8000 })
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).click()
    await page.waitForTimeout(700)
    await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '正式入库' }).click()
    await page.waitForTimeout(700)
    await heading.getByRole('button', { name: '正式入库' }).click()
    await page.waitForTimeout(300)
    const activeCard2 = page.locator('.warehouse-product-grid article', { hasText: FIXTURE_TITLE })
    await activeCard2.getByRole('button', { name: '下架产品', exact: true }).click()
    const delistDialog = page.getByRole('dialog', { name: '下架产品' })
    assert('下架弹窗要求必选原因', await delistDialog.getByText('下架原因（必选）', { exact: true }).count() === 1)
    await delistDialog.getByRole('button', { name: '确认下架', exact: true }).click()
    assert('未选原因时确认下架被拒', await delistDialog.locator('.eliminate-dialog-error').count() === 1)
    await delistDialog.getByRole('button', { name: '供应商停售', exact: true }).click()
    await delistDialog.getByRole('button', { name: '确认下架', exact: true }).click()
    await page.waitForTimeout(700)
    assert('下架后正式入库卡消失', await page.locator('.warehouse-product-grid article', { hasText: FIXTURE_TITLE }).count() === 0)

    // 下架产品阶段视图：三按钮齐备并可重新上架
    await heading.getByRole('button', { name: '下架产品' }).click()
    await page.waitForTimeout(300)
    const wsDelistedCard = page.locator('.supply-warehouse-page .delisted-product-card', { hasText: FIXTURE_TITLE })
    assert('下架产品视图展示下架卡', await wsDelistedCard.count() === 1)
    assert('下架卡提供更新产品', await wsDelistedCard.getByRole('button', { name: '更新产品', exact: true }).count() === 1)
    assert('下架卡提供重新上架', await wsDelistedCard.getByRole('button', { name: '重新上架', exact: true }).count() === 1)
    assert('下架卡提供删除产品', await wsDelistedCard.getByRole('button', { name: '删除产品', exact: true }).count() === 1)
    await wsDelistedCard.getByRole('button', { name: '重新上架', exact: true }).click()
    await page.waitForTimeout(700)
    assert('重新上架后下架视图清空', await page.locator('.supply-warehouse-page .delisted-product-card', { hasText: FIXTURE_TITLE }).count() === 0)

    // 再次下架，供货盘仓库入口同步验证
    await heading.getByRole('button', { name: '正式入库' }).click()
    await page.waitForTimeout(300)
    await page.locator('.warehouse-product-grid article', { hasText: FIXTURE_TITLE }).getByRole('button', { name: '下架产品', exact: true }).click()
    await page.getByRole('dialog', { name: '下架产品' }).getByRole('button', { name: '供应商停售', exact: true }).click()
    await page.getByRole('dialog', { name: '下架产品' }).getByRole('button', { name: '确认下架', exact: true }).click()
    await page.waitForTimeout(700)

    await page.locator('.sidebar').getByRole('button', { name: '货盘仓库', exact: true }).click()
    await page.waitForTimeout(700)
    await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '下架产品', exact: true }).click()
    await page.waitForTimeout(700)
    const delistedCard = page.locator('.delisted-product-card', { hasText: FIXTURE_TITLE })
    assert('下架产品页展示真实商品', await delistedCard.count() === 1)
    assert('下架产品页展示原因', (await delistedCard.innerText()).includes('供应商停售'))
    assert('下架产品页提供更新产品', await delistedCard.getByRole('button', { name: '更新产品', exact: true }).count() === 1)
    assert('下架产品页提供重新上架', await delistedCard.getByRole('button', { name: '重新上架', exact: true }).count() === 1)
    assert('下架产品页提供删除产品', await delistedCard.getByRole('button', { name: '删除产品', exact: true }).count() === 1)
    await delistedCard.getByRole('button', { name: '重新上架', exact: true }).click()
    await page.waitForTimeout(700)
    assert('重新上架后下架产品页清空', await page.locator('.delisted-product-card').count() === 0)
    const warehouseRestored = await page.evaluate(() => window.desktop.warehouses.list())
    assert('重新上架后商品状态为 ACTIVE', warehouseRestored.some(entry => entry.id === 'wh-fixture-r1' && entry.status === 'ACTIVE'))

    // 再次下架后永久删除
    await page.locator('.sidebar').getByRole('button', { name: '货盘采集', exact: true }).click()
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).waitFor({ state: 'visible', timeout: 8000 })
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).click()
    await page.waitForTimeout(700)
    await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '正式入库' }).click()
    await page.waitForTimeout(700)
    await heading.getByRole('button', { name: '正式入库' }).click()
    await page.waitForTimeout(300)
    await page.locator('.warehouse-product-grid article', { hasText: FIXTURE_TITLE }).getByRole('button', { name: '下架产品', exact: true }).click()
    await page.getByRole('dialog', { name: '下架产品' }).getByRole('button', { name: '库存不足', exact: true }).click()
    await page.getByRole('dialog', { name: '下架产品' }).getByRole('button', { name: '确认下架', exact: true }).click()
    await page.waitForTimeout(700)
    await page.locator('.sidebar').getByRole('button', { name: '货盘仓库', exact: true }).click()
    await page.waitForTimeout(700)
    await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '下架产品', exact: true }).click()
    await page.waitForTimeout(700)
    await page.locator('.delisted-product-card', { hasText: FIXTURE_TITLE }).getByRole('button', { name: '删除产品', exact: true }).click()
    await page.waitForTimeout(700)
    assert('删除后下架产品页清空', await page.locator('.delisted-product-card', { hasText: FIXTURE_TITLE }).count() === 0)
    const warehouseAfterDelete = await page.evaluate(() => window.desktop.warehouses.list())
    assert('删除后正式入库不含该商品', !warehouseAfterDelete.some(entry => entry.id === 'wh-fixture-r1'))
    await page.screenshot({ path: path.join(ARTIFACTS, '03-delist-restore.png') })

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
