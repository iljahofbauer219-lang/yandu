/**
 * 货盘仓库三区布局端到端 UI 验收（真实 Electron 渲染进程 + Playwright）。
 * 对照设计图：红区 7 Tab 顶栏 / 蓝区产品目录树 / 黄区产品列表；数据为 fixture 种子驱动（真实 pallet 表，2 条家具商品）。
 * 后端 API 用 page.route 拦截回放鉴权 mock（无需真实服务器/密钥/网络）。
 *
 * 运行：node tools/verify-pallet-warehouse-ui.cjs
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

const ARTIFACTS = path.resolve(__dirname, '../artifacts/pallet-warehouse')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const ownerProfile = {
  id: 'pw-ui-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'pw-ui-org', name: '货盘验收组织' }, roles: [], permissions: 'ALL', stores: null
}

const HUB_TABS = ['入库处理', '全部产品', '新品速递', '热销产品', '时节热品', '限时促销', '地区选品', '即将到货', '下架产品']

// 入库处理 Tab 的服务器采集池 mock（status=COLLECTED 原始采集 3 件）
const ERP_COLLECTED_MOCK = [
  { id: 'erp-c1', orgId: 'pw-ui-org', titleOriginal: '入库模拟产品 One', descriptionOriginal: '', costPrice: 12.5, shippingCost: null, currency: 'CNY', stockQuantity: null, dimensions: {}, weight: null, material: '', color: '', brand: '', category: '家具', variants: [], status: 'COLLECTED', changeFlag: 0, lastCrawledAt: null, createdAt: '2026-09-20T00:00:00.000Z', updatedAt: '2026-09-20T00:00:00.000Z', images: [], supplierId: 's1', sourceUrl: 'https://mock.invalid/c1', sourceProductId: 'C1001', sourceSku: '', collectedBy: 'owner', supplier: { id: 's1', code: '1688', name: '1688 模拟', patrolChannel: '' } },
  { id: 'erp-c2', orgId: 'pw-ui-org', titleOriginal: '入库模拟产品 Two', descriptionOriginal: '', costPrice: 33, shippingCost: null, currency: 'CNY', stockQuantity: null, dimensions: {}, weight: null, material: '', color: '', brand: '', category: '厨房用品', variants: [], status: 'COLLECTED', changeFlag: 0, lastCrawledAt: null, createdAt: '2026-09-21T00:00:00.000Z', updatedAt: '2026-09-21T00:00:00.000Z', images: [], supplierId: 's2', sourceUrl: 'https://mock.invalid/c2', sourceProductId: 'C2002', sourceSku: '', collectedBy: 'owner', supplier: { id: 's2', code: 'GIGACLOUD', name: '大健云仓模拟', patrolChannel: '' } },
  { id: 'erp-c3', orgId: 'pw-ui-org', titleOriginal: '入库模拟产品 Three', descriptionOriginal: '', costPrice: 8.8, shippingCost: null, currency: 'CNY', stockQuantity: null, dimensions: {}, weight: null, material: '', color: '', brand: '', category: '宠物用品', variants: [], status: 'COLLECTED', changeFlag: 0, lastCrawledAt: null, createdAt: '2026-09-22T00:00:00.000Z', updatedAt: '2026-09-22T00:00:00.000Z', images: [], supplierId: 's1', sourceUrl: 'https://mock.invalid/c3', sourceProductId: 'C3003', sourceSku: '', collectedBy: 'owner', supplier: { id: 's1', code: '1688', name: '1688 模拟', patrolChannel: '' } }
]

// 剩余 12 个二级类目：[名称, 三级登记数, 截图 slug]
const REMAINING_CATS = [
  ['外饰/改装/配件', 33, 'ext'],
  ['摩托车配附件', 30, 'moto'],
  ['车载电器', 18, 'elec'],
  ['车灯', 16, 'light'],
  ['美容养护', 18, 'care'],
  ['影音导航', 14, 'av'],
  ['安全/应急/自驾', 18, 'safety'],
  ['座垫脚垫', 16, 'cushion'],
  ['电动车', 16, 'ev'],
  ['汽车内饰改装', 16, 'refit'],
  ['汽车配件', 24, 'part'],
  ['整车', 12, 'vehicle']
]

// 汽摩及配件 23 个二级类目：[名称, 三级登记数, 截图 slug（仅 4 类出图）]
const QM_CATS = [
  ['发动系统', 18, 'engine'],
  ['电动车配件', 10, ''],
  ['车用仪表', 8, ''],
  ['电源、点火系统', 8, ''],
  ['冷却系统', 8, ''],
  ['行走系统', 10, ''],
  ['制动系统', 10, ''],
  ['传动系统', 10, ''],
  ['转向系统', 8, ''],
  ['库存汽摩配件', 6, ''],
  ['电动车控制器', 6, ''],
  ['摩托车', 10, 'moto'],
  ['商用车', 8, ''],
  ['汽摩产品制造设备', 8, ''],
  ['汽车维修设备', 10, ''],
  ['专用汽车', 8, ''],
  ['乘用车', 8, 'passenger'],
  ['加油站设备', 8, ''],
  ['汽摩及配件项目合作', 4, ''],
  ['停车场设备', 8, ''],
  ['汽摩及配件代理加盟', 4, ''],
  ['二手汽车', 6, ''],
  ['LED车灯', 8, 'led']
]

// 居家日用品 10 个二级类目：[名称, 三级登记数, 截图 slug（仅 2 类出图）]
const HOME_CATS = [
  ['居家日用', 18, 'daily'],
  ['挡风、遮阳、防雨工具', 8, ''],
  ['打火机及烟具', 8, ''],
  ['酒店用品', 8, ''],
  ['秤', 8, ''],
  ['保暖贴/怀炉/保暖用品', 8, ''],
  ['USB新奇特', 8, ''],
  ['收纳用品', 10, ''],
  ['清洁用具', 10, ''],
  ['厨房日用', 10, 'kitchen']
]

// 五金、工具 39 个二级类目：[名称, 三级登记数, 截图 slug（仅 3 类出图）]
const HW_CATS = [
  ['紧固件、连接件', 11, 'fastener'],
  ['电动工具', 6, 'power'],
  ['园林五金工具', 8, ''],
  ['通用五金配件', 8, ''],
  ['维护工具', 8, ''],
  ['磨具磨料', 8, ''],
  ['组合工具', 8, ''],
  ['手动扳手', 8, ''],
  ['手动工具', 8, ''],
  ['工具耗材', 8, ''],
  ['钳类工具', 8, ''],
  ['泵', 8, ''],
  ['仓储设备', 8, ''],
  ['刀', 8, ''],
  ['工具刷', 8, ''],
  ['运输搬运设备', 8, ''],
  ['手动螺丝刀', 8, ''],
  ['阀门', 8, ''],
  ['气焊、气割器材', 8, ''],
  ['塑料加工', 8, ''],
  ['钳工工具', 8, ''],
  ['管道及配件', 8, ''],
  ['工艺礼品五金', 8, ''],
  ['钳工工作台', 8, ''],
  ['模型、手板', 8, ''],
  ['减速机、变速机', 8, ''],
  ['库存五金、工具', 8, ''],
  ['3D打印机', 8, ''],
  ['模具标准件', 8, ''],
  ['离合器', 8, ''],
  ['防爆工具', 8, ''],
  ['量仪', 8, 'measure'],
  ['刃具', 8, ''],
  ['电子焊接工具', 8, ''],
  ['办公文教五金', 8, ''],
  ['制动器', 8, ''],
  ['作业平台', 8, ''],
  ['五金工具项目合作', 4, ''],
  ['适老工具', 8, '']
]

// 办公、文化 42 个二级类目：[名称, 三级登记数(6), 截图 slug（仅 3 类出图）]
const OFFICE_CATS = [
  ['工艺品', 6, ''],
  ['气氛、布置用品', 6, ''],
  ['书写工具', 6, 'writing'],
  ['学习文具', 6, ''],
  ['仿真园艺', 6, ''],
  ['钥匙配饰', 6, ''],
  ['纸品本册', 6, ''],
  ['圣诞用品', 6, ''],
  ['美术、书法、绘图用品', 6, ''],
  ['办公收纳', 6, ''],
  ['展示用品', 6, ''],
  ['装订、胶粘、桌面用品', 6, ''],
  ['节庆用品', 6, ''],
  ['办公设备', 6, 'equipment'],
  ['商务礼品', 6, ''],
  ['婚庆用品', 6, ''],
  ['手账', 6, ''],
  ['乐器', 6, 'music'],
  ['行政用品', 6, ''],
  ['创意礼品', 6, ''],
  ['工艺摆件', 6, ''],
  ['办公用纸', 6, ''],
  ['文化用品', 6, ''],
  ['动漫/影视/明星周边', 6, ''],
  ['财务用品', 6, ''],
  ['宗教用品', 6, ''],
  ['耗材', 6, ''],
  ['书籍、出版物', 6, ''],
  ['聚会/魔术/演出用品', 6, ''],
  ['祭祀/殡葬用品', 6, ''],
  ['教学模型、器材', 6, ''],
  ['民间工艺品', 6, ''],
  ['工艺品配件', 6, ''],
  ['邮票/钱币/纪念币', 6, ''],
  ['实验室用品', 6, ''],
  ['古董/古玩/收藏', 6, ''],
  ['学习类电子产品', 6, ''],
  ['春节用品', 6, ''],
  ['乐器配件', 6, ''],
  ['西洋乐器', 6, ''],
  ['民族乐器', 6, ''],
  ['MIDI乐器/电脑音乐', 6, '']
]


;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pallet-wh-ui-'))
  const dbPath = path.join(userDataDir, 'sourcing-data.sqlite')
  const seed = spawnSync(executablePath, [path.resolve(__dirname, 'fixture-seed-pallet-warehouse.cjs'), dbPath], {
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
    '/api/erp/products': { items: ERP_COLLECTED_MOCK, total: ERP_COLLECTED_MOCK.length, page: 1, pageSize: 100 }
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
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'pw-ui-owner', refreshToken: 'pw-ui-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile, serverUrl: mockUrl })
    await page.reload()
    await page.waitForTimeout(1200)

    // 进入货盘仓库
    await page.locator('.sidebar').getByRole('button', { name: '货盘仓库', exact: true }).click()
    await page.waitForTimeout(700)

    // 红区：7 Tab 顶栏
    const tabBar = page.locator('.selection-module-nav.warehouse-flow-nav')
    assert('顶部筛选栏渲染 9 个 Tab', await tabBar.getByRole('button').count() === 9)
    assert('顶栏首位为入库处理', (await tabBar.getByRole('button').nth(0).innerText()).includes('入库处理'))
    assert('顶栏次位为全部产品', (await tabBar.getByRole('button').nth(1).innerText()).includes('全部产品'))
    assert('pallet.add 直写链已移除', await page.evaluate(() => typeof window.desktop.pallet.add) === 'undefined')
    for (const tab of HUB_TABS) assert(`Tab 存在：${tab}`, await tabBar.getByRole('button', { name: tab, exact: true }).count() === 1)
    assert('默认选中全部产品', await tabBar.getByRole('button', { name: '全部产品', exact: true }).evaluate(el => el.classList.contains('active')))

    // 蓝区：产品目录树
    assert('左栏标题产品目录库', await page.getByRole('heading', { name: '产品目录库', exact: true }).isVisible())
    assert('左栏副标题与参考图一致', await page.getByText('大健云仓三级目录 · 支持人工调整', { exact: true }).isVisible())
    const allRow = page.locator('.catalog-all')
    assert('全部产品计数 2', (await allRow.innerText()).includes('2'))
    const furnitureRow = page.locator('.catalog-group button', { hasText: '家具' }).first()
    assert('家具计数 2', (await furnitureRow.innerText()).includes('2'))
    assert('零计数类目存在（花园与户外 0）', (await page.locator('.catalog-group button', { hasText: '花园与户外' }).first().innerText()).includes('0'))

    // 黄区：heading / switch / chips / 卡片
    assert('右栏 heading 小标 货盘仓库', await page.getByText('货盘仓库', { exact: true }).first().isVisible())
    assert('右栏 heading 全部货源 · 已存放', await page.getByText('全部货源 · 已存放', { exact: true }).isVisible())
    assert('标题旁徽标反映筛选数量=2', (await page.locator('.pallet-heading-title-row em').innerText()) === '2')
    assert('副文本已删除', await page.getByText('候选数据只归属于当前仓库').count() === 0)
    assert('方法 Tab 移入页头', await page.locator('.warehouse-page-heading .candidate-view-switch').count() === 1)
    assert('五段 switch 渲染', await page.locator('.candidate-view-switch button').count() === 5)
    assert('全部商品段默认 active', await page.locator('.candidate-view-switch button', { hasText: '全部商品' }).evaluate(el => el.classList.contains('active')))
    const chips = await page.locator('.candidate-zone-summary').innerText()
    assert('chips 含货盘商品 2 / 采集批次 — / 当前显示 2', chips.includes('货盘商品') && chips.includes('2') && chips.includes('—'))
    assert('商品卡渲染 2 张', await page.locator('.product-card').count() === 2)
    assert('真实商品无评分徽章', await page.locator('.score-badge').count() === 0)
    assert('首卡种子图已加载', await page.locator('.product-image img').first().evaluate(img => img.complete && img.naturalWidth > 0))
    await page.screenshot({ path: path.join(ARTIFACTS, '01-layout.png') })

    // 交互：Tab 切换空态
    await tabBar.getByRole('button', { name: '热销产品', exact: true }).click()
    await page.waitForTimeout(300)
    assert('热销产品 Tab 显示空态', await page.locator('.empty-state').isVisible())
    assert('空态时卡片为 0', await page.locator('.product-card').count() === 0)
    await page.screenshot({ path: path.join(ARTIFACTS, '02-empty.png') })
    await tabBar.getByRole('button', { name: '新品速递', exact: true }).click()
    await page.waitForTimeout(300)
    assert('新品速递仅显示近 1 周 1 卡', await page.locator('.product-card').count() === 1)
    assert('新品速递首卡 300001', (await page.locator('.product-card').first().innerText()).includes('300001'))
    assert('8 天前存放商品不进新品速递', (await page.locator('.candidate-catalog-main').innerText()).includes('300002') === false)
    await page.screenshot({ path: path.join(ARTIFACTS, '13-tab-newarrivals.png') })
    await tabBar.getByRole('button', { name: '全部产品', exact: true }).click()
    await page.waitForTimeout(300)
    assert('切回全部产品恢复 2 卡', await page.locator('.product-card').count() === 2)

    // 交互：类目过滤
    await page.locator('.catalog-group button', { hasText: '花园与户外' }).first().click()
    await page.waitForTimeout(300)
    assert('零计数类目显示空态', await page.locator('.empty-state').isVisible())
    await furnitureRow.click()
    await page.waitForTimeout(300)
    assert('家具类目恢复 2 卡', await page.locator('.product-card').count() === 2)
    assert('家具展开二级子项', await page.locator('.catalog-group > div button').count() === 3)
    assert('三级 flyout 展示', await page.locator('.tertiary-flyout').isVisible())
    assert('flyout 标题为首个二级类目', (await page.locator('.tertiary-flyout > div:first-child > b').innerText()) === '卧室家具')
    assert('flyout 三级选项 7 个', await page.locator('.tertiary-icon-grid button').count() === 7)
    await page.locator('.tertiary-icon-grid button', { hasText: '高架床' }).click()
    await page.waitForTimeout(300)
    assert('三级类目过滤为 1 卡', await page.locator('.product-card').count() === 1)
    assert('三级选中后 flyout 关闭', await page.locator('.tertiary-flyout').count() === 0)

    // 汽车用品类目体系：一级 → 14 二级 → 汽车内饰用品 35 三级图标
    const autoRow = page.locator('.catalog-group button', { hasText: '汽车用品' }).first()
    assert('一级汽车用品存在且计数 0', (await autoRow.innerText()).trim().endsWith('0'))
    await autoRow.click()
    await page.waitForTimeout(300)
    assert('汽车用品展开 14 个二级', await page.locator('.catalog-group > div button').count() === 14)
    await page.locator('.catalog-group > div button', { hasText: '汽车内饰用品' }).click()
    await page.waitForTimeout(300)
    assert('汽车内饰 flyout 标题正确', (await page.locator('.tertiary-flyout > div:first-child > b').innerText()) === '汽车内饰用品')
    assert('汽车内饰 flyout 35 个三级选项', await page.locator('.tertiary-icon-grid button').count() === 35)
    const tertiaryImgs = page.locator('.tertiary-icon-grid button i img')
    assert('每个三级选项均配置商品缩略图标', await tertiaryImgs.count() === 35)
    assert('三级图标图片全部加载成功', await tertiaryImgs.evaluateAll(imgs => imgs.every(img => img.complete && img.naturalWidth > 0)))
    assert('三级图标不再使用 emoji 占位', (await page.locator('.tertiary-icon-grid button i').evaluateAll(nodes => nodes.every(node => node.querySelector('img') !== null))))
    const firstIconImg = page.locator('.tertiary-icon-grid button i img').first()
    const iconRadius = await firstIconImg.evaluate(el => getComputedStyle(el).borderRadius)
    const iconBox = await firstIconImg.boundingBox()
    const discBox = await page.locator('.tertiary-icon-grid button i').first().boundingBox()
    assert('三级缩略图标为圆形裁切', iconRadius === '50%' || (!!iconBox && parseFloat(iconRadius) >= iconBox.width / 2 - 1))
    assert('圆形图标外露灰色圆底环', !!iconBox && !!discBox && iconBox.width < discBox.width && iconBox.height < discBox.height)
    assert('flyout 首项为其他汽车内饰用品', (await page.locator('.tertiary-icon-grid button span').first().innerText()) === '其他汽车内饰用品')
    assert('flyout 含方向盘套选项', await page.locator('.tertiary-icon-grid button', { hasText: '方向盘套' }).count() === 1)
    await page.screenshot({ path: path.join(ARTIFACTS, '04-auto-flyout.png') })
    await page.locator('.tertiary-icon-grid button', { hasText: '方向盘套' }).click()
    await page.waitForTimeout(300)
    assert('选中汽车三级后 flyout 关闭', await page.locator('.tertiary-flyout').count() === 0)
    assert('汽车三级类目右区空态', await page.locator('.empty-state').isVisible())
    assert('汽车三级当前显示 0', (await page.locator('.candidate-zone-summary span').last().innerText()).includes('0'))
    await page.screenshot({ path: path.join(ARTIFACTS, '03-auto-category.png') })

    // 车身及附件三级图标体系（27 项）
    await page.locator('.catalog-group > div button', { hasText: '车身及附件' }).click()
    await page.waitForTimeout(300)
    assert('车身及附件 flyout 标题正确', (await page.locator('.tertiary-flyout > div:first-child > b').innerText()) === '车身及附件')
    assert('车身及附件 flyout 27 个三级选项', await page.locator('.tertiary-icon-grid button').count() === 27)
    const bodyImgs = page.locator('.tertiary-icon-grid button i img')
    assert('车身及附件全部三级选项配置缩略图标', await bodyImgs.count() === 27)
    assert('车身及附件图标全部圆形裁切且加载', await bodyImgs.evaluateAll(imgs => imgs.every(img => { const r = getComputedStyle(img).borderRadius; const w = img.getBoundingClientRect().width; return img.complete && img.naturalWidth > 0 && (r === '50%' || parseFloat(r) >= w / 2 - 1) })))
    assert('车身及附件 flyout 首项为其他车身及附件', (await page.locator('.tertiary-icon-grid button span').first().innerText()) === '其他车身及附件')
    await page.screenshot({ path: path.join(ARTIFACTS, '06-body-flyout.png') })

    // 剩余 12 个二级类目：flyout 三级选项数量 + 全量圆形缩略图
    for (const [catName, catCount, catSlug] of REMAINING_CATS) {
      await page.locator('.catalog-group > div button', { hasText: catName }).click()
      await page.waitForTimeout(250)
      assert(`${catName} flyout ${catCount} 个三级选项`, await page.locator('.tertiary-icon-grid button').count() === catCount)
      const catImgs = page.locator('.tertiary-icon-grid button i img')
      assert(`${catName} 图标全部圆形裁切且加载`, await catImgs.evaluateAll(imgs => imgs.length > 0 && imgs.every(img => { const r = getComputedStyle(img).borderRadius; const w = img.getBoundingClientRect().width; return img.complete && img.naturalWidth > 0 && (r === '50%' || parseFloat(r) >= w / 2 - 1) })))
      await page.screenshot({ path: path.join(ARTIFACTS, `07-${catSlug}.png`) })
    }

    // 汽摩及配件一级类目：23 二级 + 三级图标循环
    const qmRow = page.locator('.catalog-group button', { hasText: '汽摩及配件' }).first()
    assert('一级汽摩及配件存在且计数 0', (await qmRow.innerText()).trim().endsWith('0'))
    await qmRow.click()
    await page.waitForTimeout(300)
    assert('汽摩及配件展开 23 个二级', await page.locator('.catalog-group > div button').count() === 23)
    for (const [catName, catCount, catSlug] of QM_CATS) {
      await page.locator('.catalog-group > div button span').filter({ hasText: new RegExp(`^${catName}$`) }).first().click()
      await page.waitForTimeout(250)
      assert(`汽摩-${catName} flyout ${catCount} 个三级选项`, await page.locator('.tertiary-icon-grid button').count() === catCount)
      const qmImgs = page.locator('.tertiary-icon-grid button i img')
      assert(`汽摩-${catName} 图标全部圆形裁切且加载`, await qmImgs.evaluateAll(imgs => imgs.length > 0 && imgs.every(img => { const r = getComputedStyle(img).borderRadius; const w = img.getBoundingClientRect().width; return img.complete && img.naturalWidth > 0 && (r === '50%' || parseFloat(r) >= w / 2 - 1) })))
      if (catSlug) await page.screenshot({ path: path.join(ARTIFACTS, `08-qm-${catSlug}.png`) })
    }

    // 居家日用品一级类目：10 二级 + 三级图标循环
    const homeRow = page.locator('.catalog-group button', { hasText: '居家日用品' }).first()
    assert('一级居家日用品存在且计数 0', (await homeRow.innerText()).trim().endsWith('0'))
    await homeRow.click()
    await page.waitForTimeout(300)
    assert('居家日用品展开 10 个二级', await page.locator('.catalog-group > div button').count() === 10)
    for (const [catName, catCount, catSlug] of HOME_CATS) {
      await page.locator('.catalog-group > div button span').filter({ hasText: new RegExp(`^${catName}$`) }).first().click()
      await page.waitForTimeout(250)
      assert(`居家-${catName} flyout ${catCount} 个三级选项`, await page.locator('.tertiary-icon-grid button').count() === catCount)
      const homeImgs = page.locator('.tertiary-icon-grid button i img')
      assert(`居家-${catName} 图标全部圆形裁切且加载`, await homeImgs.evaluateAll(imgs => imgs.length > 0 && imgs.every(img => { const r = getComputedStyle(img).borderRadius; const w = img.getBoundingClientRect().width; return img.complete && img.naturalWidth > 0 && (r === '50%' || parseFloat(r) >= w / 2 - 1) })))
      if (catSlug) await page.screenshot({ path: path.join(ARTIFACTS, `09-home-${catSlug}.png`) })
    }

    // 五金、工具一级类目：39 二级 + 三级图标循环
    const hwRow = page.locator('.catalog-group button', { hasText: '五金、工具' }).first()
    assert('一级五金、工具存在且计数 0', (await hwRow.innerText()).trim().endsWith('0'))
    await hwRow.click()
    await page.waitForTimeout(300)
    assert('五金、工具展开 39 个二级', await page.locator('.catalog-group > div button').count() === 39)
    for (const [catName, catCount, catSlug] of HW_CATS) {
      await page.locator('.catalog-group > div button span').filter({ hasText: new RegExp(`^${catName}$`) }).first().click()
      await page.waitForTimeout(250)
      assert(`五金-${catName} flyout ${catCount} 个三级选项`, await page.locator('.tertiary-icon-grid button').count() === catCount)
      const hwImgs = page.locator('.tertiary-icon-grid button i img')
      assert(`五金-${catName} 图标全部圆形裁切且加载`, await hwImgs.evaluateAll(imgs => imgs.length > 0 && imgs.every(img => { const r = getComputedStyle(img).borderRadius; const w = img.getBoundingClientRect().width; return img.complete && img.naturalWidth > 0 && (r === '50%' || parseFloat(r) >= w / 2 - 1) })))
      if (catSlug) await page.screenshot({ path: path.join(ARTIFACTS, `10-hw-${catSlug}.png`) })
    }

    // 办公、文化一级类目：42 二级 + 三级图标循环
    const officeRow = page.locator('.catalog-group button', { hasText: '办公、文化' }).first()
    assert('一级办公、文化存在且计数 0', (await officeRow.innerText()).trim().endsWith('0'))
    await officeRow.click()
    await page.waitForTimeout(300)
    assert('办公、文化展开 42 个二级', await page.locator('.catalog-group > div button').count() === 42)
    for (const [catName, catCount, catSlug] of OFFICE_CATS) {
      await page.locator('.catalog-group > div button span').filter({ hasText: new RegExp(`^${catName}$`) }).first().click()
      await page.waitForTimeout(250)
      assert(`办公-${catName} flyout ${catCount} 个三级选项`, await page.locator('.tertiary-icon-grid button').count() === catCount)
      const officeImgs = page.locator('.tertiary-icon-grid button i img')
      assert(`办公-${catName} 图标全部圆形裁切且加载`, await officeImgs.evaluateAll(imgs => imgs.length > 0 && imgs.every(img => { const r = getComputedStyle(img).borderRadius; const w = img.getBoundingClientRect().width; return img.complete && img.naturalWidth > 0 && (r === '50%' || parseFloat(r) >= w / 2 - 1) })))
      if (catSlug) await page.screenshot({ path: path.join(ARTIFACTS, `11-office-${catSlug}.png`) })
    }

    // 已删除一级类目不再显示（红框删除项）
    const REMOVED_CATS = ['健身与运动', '卫浴与水龙头', '厨房用品', '宠物用品', '玩具', '照明', '家居用品与装饰', '旅行用品']
    for (const name of REMOVED_CATS) {
      assert(`已删除类目 ${name} 不再显示`, await page.locator('.catalog-group button', { hasText: name }).count() === 0)
    }

    // 一级类目顺序断言（用户指定顺序）
    const catOrder = await page.locator('.catalog-group > button').evaluateAll(btns => btns.map(b => (b.querySelector('span')?.textContent || '').trim()))
    assert('一级类目顺序为指定 7 项顺序', JSON.stringify(catOrder) === JSON.stringify(['汽车用品', '汽摩及配件', '五金、工具', '花园与户外', '办公、文化', '居家日用品', '家具']))

    // 交互：搜索过滤
    await allRow.click()
    await page.locator('.candidate-filterbar input').fill('Alpha')
    await page.waitForTimeout(300)
    assert('搜索 Alpha 过滤为 1 卡', await page.locator('.product-card').count() === 1)
    assert('当前显示联动为 1', (await page.locator('.candidate-zone-summary').innerText()).includes('1'))
    await page.locator('.candidate-filterbar input').fill('')
    await page.waitForTimeout(300)
    assert('清空搜索恢复 2 卡', await page.locator('.product-card').count() === 2)

    // 交互：批量管理
    await page.getByRole('button', { name: '批量管理', exact: true }).click()
    await page.waitForTimeout(300)
    assert('批量管理展开 batchbar', await page.locator('.candidate-batchbar').isVisible())
    await page.locator('.candidate-batchbar input[type="checkbox"]').check()
    await page.waitForTimeout(200)
    assert('全选后已选 2 个', (await page.locator('.candidate-batchbar').innerText()).includes('2'))
    await page.getByRole('button', { name: '退出批量', exact: true }).click()
    await page.waitForTimeout(200)
    assert('退出批量收起 batchbar', await page.locator('.candidate-batchbar').count() === 0)

    // 入库处理 Tab：同步 COLLECTED mock → 待确认 3 卡 → 补标签/编辑/确认/驳回
    await tabBar.getByRole('button', { name: '入库处理', exact: true }).click()
    await page.waitForTimeout(900)
    assert('入库处理显示 3 卡待确认', await page.locator('.product-card').count() === 3)
    assert('入库处理 chips 待确认 3', (await page.locator('.candidate-zone-summary').innerText()).includes('3'))
    const inboundFirst = page.locator('.product-card').first()
    await inboundFirst.locator('.inbound-tag-input').fill('重点')
    await inboundFirst.locator('.product-tags button', { hasText: '添加' }).click()
    await page.waitForTimeout(300)
    assert('补标签后芯片出现', (await inboundFirst.locator('.product-tags').innerText()).includes('重点'))
    await inboundFirst.getByRole('button', { name: '重新编辑', exact: true }).click()
    await page.waitForTimeout(200)
    await inboundFirst.locator('.inbound-edit-form label').first().locator('input').fill('入库改题 Inbound Edited')
    await inboundFirst.getByRole('button', { name: '保存', exact: true }).click()
    await page.waitForTimeout(300)
    assert('编辑保存后卡面标题更新', (await inboundFirst.locator('.product-info b').innerText()).includes('入库改题 Inbound Edited'))
    await page.screenshot({ path: path.join(ARTIFACTS, '14-inbound-panel.png') })
    await inboundFirst.getByRole('button', { name: '确认入库', exact: true }).click()
    await page.waitForTimeout(400)
    assert('确认入库后待确认余 2 卡', await page.locator('.product-card').count() === 2)
    await page.screenshot({ path: path.join(ARTIFACTS, '14-inbound-confirmed.png') })
    const palletAfterConfirm = await page.evaluate(() => window.desktop.pallet.list())
    assert('确认入库双写货盘存放', palletAfterConfirm.some(entry => entry.title === '入库改题 Inbound Edited'))
    const warehouseAfterConfirm = await page.evaluate(() => window.desktop.warehouses.list())
    assert('确认入库双写正式入库', warehouseAfterConfirm.some(entry => entry.title === '入库改题 Inbound Edited' && entry.status === 'ACTIVE'))
    await page.locator('.product-card').first().getByRole('button', { name: '驳回', exact: true }).click()
    await page.waitForTimeout(300)
    assert('驳回后待确认余 1 卡', await page.locator('.product-card').count() === 1)
    await tabBar.getByRole('button', { name: '全部产品', exact: true }).click()
    await page.waitForTimeout(400)
    assert('全部产品含确认入库件共 3 卡', await page.locator('.product-card').count() === 3)

    assert('验收过程无渲染进程未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error(pageErrors)
  } catch (error) {
    failures += 1
    console.error('[verify-pallet-warehouse-ui] 异常：', error)
  } finally {
    console.log(`\n[verify-pallet-warehouse-ui] 失败 ${failures} 项；截图输出 → ${ARTIFACTS}`)
    mockServer.close()
    await app.close()
    process.exit(failures === 0 ? 0 : 1)
  }
})()
