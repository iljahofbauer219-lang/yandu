/**
 * ERP P5 巡盘 + 通知中心 端到端 UI 验收（真实 Electron 渲染进程 + Playwright）。
 * 对照方案 P5 验收标准的可视部分：待确认变更（改价/改库存 diff、已发布标红、APPLY/DISMISS）+
 * 通知中心（PATROL_URGENT 标红、未读计数、生成早间汇总、立即巡盘、标记已读）。
 *
 * 后端 API 用 page.route 拦截并回放确定性 mock（无需真实服务器/密钥/网络），
 * 截图落 artifacts/，作为最终交付报告的端到端功能验证截图。
 *
 * 运行：node tools/verify-erp-p5-ui.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const { MENU_PERMISSION_TREE, hasMenuAccess, toggleMenuCard } = require('../src/shared/menuPermissionTree.ts')
const { PERMISSION_CODE_SET, PERMISSION_LABELS } = require('../server/src/modules/rbac/permissions.ts')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const ARTIFACTS = path.resolve(__dirname, '../artifacts/warehouse-hub')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const ownerProfile = {
  id: 'p5-ui-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'p5-ui-org', name: 'P5验收组织' }, roles: [], permissions: 'ALL', stores: null
}

const capabilities = { canViewSource: true, canCollect: true, canEdit: true, canPricing: true, canResolveChanges: true }

// 产品库/采集池 mock（含各状态）
const products = {
  items: [
    { id: 'prod-pub', titleOriginal: '已发布·宠物美容刷', sourceProductId: 'S-PUB-1', sourceUrl: 'https://1688.com/p/1', sourceSku: 'SKU-PUB', supplier: { name: '1688' }, costPrice: 18, currency: 'CNY', stockQuantity: 100, status: 'PUBLISHED', changeFlag: 1, images: [{ id: 'i1', localPath: '/media/a.jpg', url: '/media/a.jpg', imageType: 'MAIN', isSelected: 1, sortOrder: 0, platform: null }] },
    { id: 'prod-ready', titleOriginal: '待加工·宠物碗', sourceProductId: 'S-COL-1', sourceUrl: 'https://1688.com/p/2', sourceSku: 'SKU-COL', supplier: { name: '1688' }, costPrice: 8, currency: 'CNY', stockQuantity: 50, status: 'COLLECTED', changeFlag: 0, images: [] }
  ],
  total: 2, page: 1, pageSize: 100
}

// 待确认变更 mock：一个已发布（标红）改价，一个未发布改库存
let changesState = {
  items: [
    { productId: 'prod-pub', titleOriginal: '已发布·宠物美容刷', status: 'PUBLISHED', published: true, lastCrawledAt: '2026-09-25T01:00:00.000Z', changes: [{ id: 'c1', field: 'costPrice', oldValue: '20', newValue: '18', createdAt: '2026-09-25T01:00:00.000Z' }] },
    { productId: 'prod-col', titleOriginal: '待加工·宠物碗', status: 'COLLECTED', published: false, lastCrawledAt: '2026-09-25T01:00:00.000Z', changes: [{ id: 'c2', field: 'stockQuantity', oldValue: '50', newValue: '0', createdAt: '2026-09-25T01:00:00.000Z' }] }
  ],
  total: 2, page: 1, pageSize: 100
}

// 通知中心 mock：紧急 + 普通 + 汇总
let notificationsState = {
  items: [
    { id: 'n1', kind: 'PATROL_URGENT', title: '【标红】已发布产品货盘变更：宠物美容刷（成本价）', body: {}, productId: 'prod-pub', urgent: true, read: false, readAt: null, createdAt: '2026-09-25T01:00:05.000Z' },
    { id: 'n2', kind: 'PATROL_CHANGE', title: '货盘变更：宠物碗（库存）', body: {}, productId: 'prod-col', urgent: false, read: false, readAt: null, createdAt: '2026-09-25T01:00:06.000Z' }
  ],
  total: 2, unread: 2, page: 1, pageSize: 100
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-p5-ui-'))
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: path.resolve(__dirname, '..'), env: { ...process.env, CODEX_UI_TEST: '1', YANDU_HOT_DIR: path.join(userDataDir, 'no-hot') } })
  let failures = 0
  const assert = (name, cond) => { if (cond) console.log(`  ✔ ${name}`); else { failures += 1; console.error(`  ✘ ${name}`) } }
  try {
    const hubPerm = 'menu.warehouse.hub'
    const warehouseNode = MENU_PERMISSION_TREE.find(node => node.code === 'menu.warehouse')
    assert('前端权限树登记货盘仓库', warehouseNode.cards.some(card => card.code === hubPerm && card.label === '货盘仓库'))
    assert('后端权限码表允许保存货盘仓库权限', PERMISSION_CODE_SET.has(hubPerm))
    assert('后端权限标签为 AI仓库·货盘仓库', PERMISSION_LABELS[hubPerm] === 'AI仓库·货盘仓库')
    assert('只有货盘仓库权限也能进入父菜单', hasMenuAccess(code => code === hubPerm, warehouseNode))
    const selected = toggleMenuCard([], warehouseNode, hubPerm, true)
    assert('新子权限可勾选且不被后端过滤', selected.every(code => PERMISSION_CODE_SET.has(code)))

    let currentProfile = ownerProfile
    let erpRequests = 0
    const pageErrors = []
    const page = await app.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded')

    // 拦截鉴权 + 全部 ERP API，回放确定性 mock
    await page.route('**/api/**', async route => {
      const req = route.request()
      const url = new URL(req.url())
      const p = url.pathname
      const method = req.method()
      if (p.startsWith('/api/erp/')) erpRequests += 1
      if (p === '/api/auth/me') return route.fulfill(json(currentProfile))
      if (p === '/api/erp/capabilities') return route.fulfill(json(capabilities))
      if (p === '/api/erp/products') return route.fulfill(json(products))
      if (p === '/api/erp/changes' && method === 'GET') return route.fulfill(json(changesState))
      if (p.startsWith('/api/erp/changes/') && p.endsWith('/resolve')) {
        const productId = decodeURIComponent(p.split('/')[4])
        changesState = { ...changesState, items: changesState.items.filter(i => i.productId !== productId), total: changesState.items.filter(i => i.productId !== productId).length }
        return route.fulfill(json({ productId, action: 'APPLY', applied: ['costPrice'], status: 'PUBLISHED', changeFlag: 0 }))
      }
      if (p === '/api/erp/notifications' && method === 'GET') return route.fulfill(json(notificationsState))
      if (p === '/api/erp/notifications/summary') {
        notificationsState = {
          items: [{ id: 'n0', kind: 'MORNING_SUMMARY', title: '早间巡盘汇总：2 项变更，1 项命中已发布（需优先），2 个产品待确认', body: {}, productId: null, urgent: false, read: false, readAt: null, createdAt: '2026-09-25T08:00:00.000Z' }, ...notificationsState.items],
          total: notificationsState.total + 1, unread: notificationsState.unread + 1, page: 1, pageSize: 100
        }
        return route.fulfill(json({ orgId: 'p5-ui-org', windowStart: '2026-09-24T08:00:00.000Z', generatedAt: '2026-09-25T08:00:00.000Z', totalChanges: 2, urgentChanges: 1, pendingProducts: 2, byField: { costPrice: 1, stockQuantity: 1 }, notificationId: 'n0' }))
      }
      if (p === '/api/erp/notifications/read-all') {
        notificationsState = { ...notificationsState, items: notificationsState.items.map(n => ({ ...n, read: true, readAt: '2026-09-25T09:00:00.000Z' })), unread: 0 }
        return route.fulfill(json({ updated: 2 }))
      }
      if (p.startsWith('/api/erp/notifications/') && p.endsWith('/read')) {
        const id = decodeURIComponent(p.split('/')[4])
        notificationsState = { ...notificationsState, items: notificationsState.items.map(n => n.id === id ? { ...n, read: true, readAt: '2026-09-25T09:00:00.000Z' } : n) }
        notificationsState.unread = notificationsState.items.filter(n => !n.read).length
        return route.fulfill(json({ ...notificationsState.items.find(n => n.id === id) }))
      }
      if (p === '/api/erp/patrol/run') return route.fulfill(json({ orgId: 'p5-ui-org', scanned: 3, serverChannel: 2, clientChannel: 1, changed: 2, urgent: 1, plan: { total: 3, batchSize: 2, concurrency: 3, batchCount: 1, maxInFlight: 3 }, pool: { processed: 2, failed: 0, peakConcurrency: 2, gapsMs: [5] } }))
      // 其余 /api 调用放行到不可解析的 mock host → fetch 快速失败，渲染层按调用粒度容错（不阻塞主界面）
      return route.continue()
    })

    await page.evaluate(({ profile }) => {
      localStorage.setItem('sourcing.server-url:v1', 'https://erp-p5-mock.invalid')
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'p5-ui-owner', refreshToken: 'p5-ui-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile })
    await page.reload()
    await page.waitForTimeout(1200)

    // 进入 AI 仓库工作台
    const nav = page.getByRole('button', { name: 'AI仓库' }).first()
    await nav.click()
    await page.waitForTimeout(700)
    await page.getByText('ERP 产品仓库工作台', { exact: false }).waitFor({ timeout: 5000 })
    await page.screenshot({ path: path.join(ARTIFACTS, 'erp-p5-01-pool.png') })
    assert('进入 AI 仓库工作台（采集池）', true)

    // 货盘仓库同级入口：图标一致性、路由、高亮、键盘操作、占位页与返回
    const hubNav = page.locator('.sidebar').getByRole('button', { name: '货盘仓库', exact: true })
    const hubVisible = await hubNav.isVisible()
    assert('侧边栏展示货盘仓库同级入口', hubVisible)
    if (!hubVisible) throw new Error('缺少货盘仓库入口，无法继续导航验收')
    assert('入口复用非空 SVG 图标', await hubNav.locator('svg path').count() > 0)
    const hubIconBox = await hubNav.locator('svg').boundingBox()
    const parentIconBox = await nav.locator('svg').boundingBox()
    const hubBox = await hubNav.boundingBox()
    const parentBox = await nav.boundingBox()
    const sidebarBox = await page.locator('.sidebar').boundingBox()
    assert('图标可见且与父菜单同尺寸', !!hubIconBox && !!parentIconBox && hubIconBox.width === parentIconBox.width && hubIconBox.height === parentIconBox.height && hubIconBox.width > 0)
    assert('入口与父菜单同尺寸且不溢出侧边栏', !!hubBox && !!parentBox && !!sidebarBox && hubBox.width === parentBox.width && hubBox.height === parentBox.height && hubBox.x >= sidebarBox.x && hubBox.x + hubBox.width <= sidebarBox.x + sidebarBox.width)
    assert('父页激活时同级入口不高亮', !(await hubNav.evaluate(el => el.classList.contains('nav-active'))))
    const beforeHubRequests = erpRequests
    await hubNav.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('heading', { name: '产品目录库', exact: true }).waitFor()
    await page.waitForTimeout(500)
    assert('货盘仓库稳定停留且渲染三区布局', await page.locator('.candidate-page').isVisible() && await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button').count() === 9)
    assert('同级关系：货盘仓库页激活时AI仓库不高亮', !(await nav.evaluate(el => el.classList.contains('nav-active'))))
    assert('货盘仓库激活高亮', await hubNav.evaluate(el => el.classList.contains('nav-active')))
    assert('占位页不发起 ERP 业务请求', erpRequests === beforeHubRequests)
    await page.screenshot({ path: path.join(ARTIFACTS, 'warehouse-hub-active.png') })
    await nav.click()
    await page.getByText('ERP 产品仓库工作台', { exact: false }).waitFor()
    assert('返回父页后取消货盘仓库高亮', !(await hubNav.evaluate(el => el.classList.contains('nav-active'))))
    await page.locator('.sidebar').getByRole('button', { name: 'CB资讯', exact: true }).click()
    assert('切换其他模块后同级入口仍可见', await hubNav.count() === 1)
    assert('切换其他模块后取消父菜单高亮', !(await nav.evaluate(el => el.classList.contains('nav-active'))))
    await nav.click()
    await page.getByText('ERP 产品仓库工作台', { exact: false }).waitFor()

    // 产品库 tab
    await page.getByRole('button', { name: '产品库' }).first().click()
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(ARTIFACTS, 'erp-p5-02-products.png') })
    assert('产品库 tab 渲染', await page.getByText('已发布·宠物美容刷').first().count() > 0)

    // 待确认变更 tab
    await page.getByRole('button', { name: '待确认变更' }).first().click()
    await page.waitForTimeout(600)
    assert('待确认变更列出 2 项', await page.locator('.erp-change-card').count() === 2)
    assert('已发布变更标红（erp-change-urgent）', await page.locator('.erp-change-card.erp-change-urgent').count() === 1)
    assert('展示字段级 diff（成本价 20→18）', await page.getByText('成本价').first().count() > 0)
    await page.screenshot({ path: path.join(ARTIFACTS, 'erp-p5-03-changes.png') })

    // APPLY 采纳变更
    await page.getByRole('button', { name: '采纳新值' }).first().click()
    await page.waitForTimeout(700)
    assert('APPLY 后待确认列表减为 1 项', await page.locator('.erp-change-card').count() === 1)
    await page.screenshot({ path: path.join(ARTIFACTS, 'erp-p5-04-changes-applied.png') })

    // 通知中心 tab
    await page.getByRole('button', { name: '通知中心' }).first().click()
    await page.waitForTimeout(600)
    assert('通知中心列出通知', await page.locator('.erp-notification').count() >= 2)
    assert('紧急通知标红（erp-notification-urgent）', await page.locator('.erp-notification.erp-notification-urgent').count() === 1)
    assert('未读计数显示', await page.getByText('未读 2').first().count() > 0)
    await page.screenshot({ path: path.join(ARTIFACTS, 'erp-p5-05-notifications.png') })

    // 生成早间汇总
    await page.getByRole('button', { name: '生成早间汇总' }).first().click()
    await page.waitForTimeout(700)
    assert('早间汇总通知出现', await page.getByText('早间巡盘汇总', { exact: false }).first().count() > 0)
    await page.screenshot({ path: path.join(ARTIFACTS, 'erp-p5-06-summary.png') })

    // 立即巡盘
    await page.getByRole('button', { name: '立即巡盘' }).first().click()
    await page.waitForTimeout(700)
    assert('巡盘结果回执可见（扫描/双通道/并发）', await page.getByText('巡盘完成', { exact: false }).first().count() > 0)
    await page.screenshot({ path: path.join(ARTIFACTS, 'erp-p5-07-patrol-run.png') })

    // 全部已读
    await page.getByRole('button', { name: '全部已读' }).first().click()
    await page.waitForTimeout(600)
    assert('全部已读后未读=0', await page.getByText('未读 0').first().count() > 0)
    await page.screenshot({ path: path.join(ARTIFACTS, 'erp-p5-08-read-all.png') })

    // 使用独立测试会话切换权限，不连接生产服务、不修改真实角色
    const permissionCases = [
      { name: '父权限', permissions: ['menu.cb-news', 'menu.warehouse'], parent: true, hub: true },
      { name: '仅货盘仓库子权限', permissions: [hubPerm], parent: true, hub: true },
      { name: '仅其他仓库子权限', permissions: ['menu.cb-news', 'menu.warehouse.products'], parent: true, hub: false },
      { name: '无仓库权限', permissions: ['menu.cb-news'], parent: false, hub: false },
      { name: '主帐号', permissions: [], isOwner: true, parent: true, hub: true },
      { name: 'ALL授权', permissions: 'ALL', parent: true, hub: true }
    ]
    for (const testCase of permissionCases) {
      currentProfile = { ...ownerProfile, isOwner: !!testCase.isOwner, permissions: testCase.permissions }
      await page.evaluate(profile => localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile)), currentProfile)
      await page.reload()
      await page.locator('.sidebar').waitFor()
      const parentNav = page.locator('.sidebar').getByRole('button', { name: 'AI仓库', exact: true })
      assert(`${testCase.name}：父菜单权限正确`, (await parentNav.count() > 0) === testCase.parent)
      if (testCase.parent) {
        await parentNav.click()
        await page.getByText('ERP 产品仓库工作台', { exact: false }).waitFor()
      }
      assert(`${testCase.name}：子菜单权限正确`, (await hubNav.count() > 0) === testCase.hub)
      if (testCase.hub) {
        await hubNav.click()
        await page.getByRole('heading', { name: '产品目录库', exact: true }).waitFor()
        assert(`${testCase.name}：可进入且保持高亮`, await hubNav.evaluate(el => el.classList.contains('nav-active')))
        assert(`${testCase.name}：同级父菜单不高亮`, !(await parentNav.evaluate(el => el.classList.contains('nav-active'))))
      }
    }
    assert('验收过程无渲染进程未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error(pageErrors)
  } catch (error) {
    failures += 1
    console.error('[verify-erp-p5-ui] 异常：', error)
  } finally {
    console.log(`\n[verify-erp-p5-ui] 失败 ${failures} 项；截图输出 → ${ARTIFACTS}`)
    await app.close()
    process.exit(failures === 0 ? 0 : 1)
  }
})()
