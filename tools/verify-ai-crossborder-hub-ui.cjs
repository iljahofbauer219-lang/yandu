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
const { spawnSync } = require('node:child_process')

function startMockServer(routes) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://local').pathname
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const route = routes[pathname]
      res.setHeader('content-type', 'application/json')
      if (!route) { res.statusCode = 404; res.end(JSON.stringify({ message: 'not mocked' })); return }
      const payload = typeof route === 'function' ? route(raw) : route
      res.end(JSON.stringify(payload))
    })
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

  // 货盘 fixture 种子：供『我的货盘 → 送eBay → 本地产品』端到端断言
  const seed = spawnSync(executablePath, [path.resolve(__dirname, 'fixture-seed-pallet-warehouse.cjs'), path.join(userDataDir, 'sourcing-data.sqlite'), 'pallet'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8'
  })
  if (seed.status !== 0) {
    console.error('fixture 种子失败：', seed.stdout, seed.stderr)
    process.exit(1)
  }
  console.log(seed.stdout.trim())

  const mockServer = await startMockServer({
    '/api/auth/me': ownerProfile,
    '/api/erp/capabilities': { canViewSource: true, canCollect: true, canEdit: true, canPricing: true, canResolveChanges: true },
    '/api/erp/products': { items: [], total: 0, page: 1, pageSize: 100 },
    // 百炼 mock：生图模型清单 + 千问核心商品词（非 qwen-mt 模型返回确定名词短语，qwen-mt 返回译文）
    '/models': { data: [{ id: 'qwen-image-2.0' }] },
    '/chat/completions': raw => {
      const body = JSON.parse(raw || '{}')
      const content = String(body.model || '').includes('qwen-mt') ? '2件装 通用型桶形赛车座椅 红色缝线 PVC皮革' : 'Loft Bed Frame'
      return { choices: [{ message: { content } }] }
    }
  })
  const mockUrl = `http://127.0.0.1:${mockServer.address().port}`
  fs.writeFileSync(path.join(userDataDir, 'server-config.json'), JSON.stringify({ serverUrl: mockUrl }, null, 2))

  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: path.resolve(__dirname, '..'), env: { ...process.env, CODEX_UI_TEST: '1', YANDU_HOT_DIR: path.join(userDataDir, 'no-hot'), BAILIAN_BASE_URL: mockUrl } })
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

    // 旧包排查：顶栏构建戳必须为最新构建（10-09 旧打包版戳为 2026-10-09 01:49）
    const stamp = await page.locator('.build-stamp').innerText()
    assert('顶栏构建戳为最新构建而非10-09旧包', /2026-10-1[2-9]/.test(stamp) && !stamp.includes('2026-10-09'))
    assert('侧边栏无AI美工/AI视频独立入口', await page.locator('.sidebar').getByRole('button', { name: 'AI美工' }).count() === 0 && await page.locator('.sidebar').getByRole('button', { name: 'AI视频' }).count() === 0)

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

    // 采集链前端已移除：建测试店铺进入左栏工作台区核对
    await page.locator('.ebay-add-store-card').click()
    await page.locator('.ebay-store-dialog input').nth(0).fill('验收测试店')
    await page.locator('.ebay-store-dialog input').nth(1).fill('qa@example.test')
    await page.locator('.ebay-store-dialog input').nth(2).fill('qa-password-123')
    await page.locator('.ebay-store-dialog').getByRole('button', { name: '确认添加' }).click()
    await page.locator('.ebay-login-workbench').waitFor({ state: 'visible', timeout: 15000 })
    await page.waitForTimeout(1200)
    assert('左栏无待确认采集商品卡', await page.locator('.ebay-collection-draft-card').count() === 0 && await page.locator('main').getByText('待确认采集商品').count() === 0)
    assert('左栏无采集执行卡', await page.locator('.ebay-collection-execution').count() === 0 && await page.locator('main').getByText('采集执行', { exact: true }).count() === 0)
    assert('浏览器区无采集插件状态条', await page.locator('.ebay-browser-heading .built-in-collector-trigger').count() === 0)
    assert('01 平台与登录身份卡保留', await page.locator('main').getByText('平台与登录身份').count() === 1)
    // 种子类目树：供送入自动归类与手工改类断言（写入运行中实例的 WAL 库）
    const { DatabaseSync } = require('node:sqlite')
    const seedDb = new DatabaseSync(path.join(userDataDir, 'sourcing-data.sqlite'))
    const seedStoreId = seedDb.prepare('SELECT id FROM ebay_stores LIMIT 1').get().id
    const nowIso = new Date().toISOString()
    const insCat = seedDb.prepare(`INSERT INTO ebay_store_categories (store_id,category_id,name,parent_category_id,level,child_count,listing_count,sort_order,status,synced_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'ACTIVE',?,?)`)
    insCat.run(seedStoreId, 'vf-1', '家具', '', 1, 0, 0, 0, nowIso, nowIso)
    insCat.run(seedStoreId, 'vf-2', '卧室家具', 'vf-1', 2, 0, 0, 0, nowIso, nowIso)
    insCat.run(seedStoreId, 'vf-3', '高架床', 'vf-2', 3, 0, 0, 0, nowIso, nowIso)
    seedDb.close()
    const tabOrder = (await page.locator('.ebay-business-nav button b').allInnerTexts()).join(',')
    assert('页签顺序为店铺采集/本地产品/AI优化/优品仓库/线上发布/线上产品', tabOrder === '店铺采集,本地产品,AI优化,优品仓库,线上发布,线上产品')
    assert('默认仍停留店铺采集页签', await page.locator('.ebay-business-nav button.active b').innerText() === '店铺采集')
    await page.screenshot({ path: path.join(ARTIFACTS, 'ebay-workbench-no-collect.png') })
    await page.locator('.ebay-business-nav').getByRole('button', { name: '线上产品' }).click()
    await page.waitForTimeout(600)
    assert('线上产品页签可进入且同步按钮在工具栏', await page.locator('.ebay-toolbar').getByRole('button', { name: '同步目录' }).count() === 1 && await page.locator('.ebay-toolbar').getByRole('button', { name: '同步产品' }).count() === 1)
    await page.screenshot({ path: path.join(ARTIFACTS, 'ebay-library-tab.png') })

    // 瘦身：页头横条删除、Omkar chip 移店铺栏、小字说明删除
    assert('页头横条已删除', await page.locator('.ebay-page-heading').count() === 0)
    assert('Omkar chip 移至店铺栏右端', await page.locator('.ebay-store-bar .ebay-omkar-chip').count() === 1)
    assert('店铺栏小字说明已删除', await page.locator('.ebay-store-bar small').count() === 0)
    const sendError = await page.evaluate(() => window.desktop.myPallet.sendToEbay(undefined, 'not-in-pallet').then(() => '').catch(reason => String(reason && reason.message ? reason.message : reason)))
    assert('送入 IPC 已注册且缺货盘商品时中文全文报错', sendError.includes('我的货盘'))
    await page.locator('.ebay-business-nav').getByRole('button', { name: '本地产品' }).click()
    await page.waitForTimeout(500)
    assert('本地产品空态引导改为我的货盘送入', await page.locator('main').getByText('请在『我的货盘』选择产品点击“送eBay”').count() === 1)
    assert('本地目录小字说明已删除', await page.locator('main').getByText('沿用线上商品类目 · 独立持久化').count() === 0)
    await page.getByRole('button', { name: '前往我的货盘' }).click()
    await page.waitForTimeout(600)
    assert('空态动作跳转我的货盘页', await page.locator('.sidebar button.nav-active').innerText() === '我的货盘')
    await page.screenshot({ path: path.join(ARTIFACTS, 'my-pallet-entry.png') })

    // 端到端：fixture 货盘商品入我的货盘 → 点『送eBay』→ 直达 eBay 本地产品且可见
    const palletIds = await page.evaluate(() => window.desktop.pallet.list().then(items => items.filter(item => item.title.includes('FIXTURE Pallet Alpha')).map(item => item.warehouseProductId)))
    assert('fixture 货盘商品存在', palletIds.length === 1)
    await page.evaluate(ids => window.desktop.myPallet.add(ids), palletIds)
    await page.locator('.sidebar').getByRole('button', { name: '货盘仓库', exact: true }).click()
    await page.waitForTimeout(400)
    await page.locator('.sidebar').getByRole('button', { name: '我的货盘', exact: true }).click()
    const sendBtn = page.locator('main').getByRole('button', { name: '送eBay', exact: true }).first()
    await sendBtn.waitFor({ state: 'visible', timeout: 8000 })
    await sendBtn.click()
    await page.locator('.ebay-business-nav button.active b').waitFor({ state: 'visible', timeout: 10000 })
    assert('送入后直达 eBay 工作台本地产品页签', await page.locator('.sidebar button.nav-active').innerText() === 'AI跨境' && await page.locator('.ebay-business-nav button.active b').innerText() === '本地产品')
    await page.locator('main').getByText('FIXTURE Pallet Alpha Loft Bed 300001').first().waitFor({ state: 'visible', timeout: 8000 })
    assert('本地产品列表可见送入的 fixture 商品', await page.locator('main').getByText('FIXTURE Pallet Alpha Loft Bed 300001').count() >= 1)
    assert('本地卡展示货盘送入来源事实块', await page.locator('.ebay-local-product-card').getByText('原货盘').count() === 1)
    const catalogText = (await page.locator('.ebay-product-catalog').innerText()).replace(/\n/g, ' ')
    assert('送入时按源三级类目自动归入高架床', /高架\s*床?\s*1|高架床\s*1/.test(catalogText) && /未分类\s*0/.test(catalogText))
    await page.screenshot({ path: path.join(ARTIFACTS, 'ebay-local-sent.png') })
    await page.locator('.ebay-local-card-actions').getByRole('button', { name: '本地详情' }).click()
    await page.locator('.ebay-revise-overlay').waitFor({ state: 'visible', timeout: 8000 })
    assert('编辑器类目区显示自动分类结果', await page.locator('.ebay-revise-category-section header span').innerText() === '高架床')
    await page.getByRole('button', { name: '自动分类' }).click()
    await page.waitForTimeout(500)
    assert('自动分类重跑仍命中高架床', await page.locator('.ebay-revise-category-section header span').innerText() === '高架床')
    assert('自动分类成功 notice 中文全文', await page.locator('.ebay-success-notice').getByText('已自动归入『高架床』').count() === 1)
    await page.locator('.ebay-revise-category-row select').selectOption('vf-2')
    await page.waitForTimeout(500)
    assert('手工改类到卧室家具', await page.locator('.ebay-revise-category-section header span').innerText() === '卧室家具')
    await page.locator('.ebay-revise-overlay').getByRole('button', { name: '关闭编辑器' }).click()
    await page.waitForTimeout(500)
    const catalogAfter = (await page.locator('.ebay-product-catalog').innerText()).replace(/\n/g, ' ')
    assert('手工改类后树计数迁移', /卧室家具\s*1/.test(catalogAfter) && /高架床\s*0/.test(catalogAfter))
    await page.screenshot({ path: path.join(ARTIFACTS, 'ebay-local-category.png') })

    // PALLET 产品市场检索：不得再报『线上产品不存在』，且必须有可见结果或可见错误（非无反应）
    await page.locator('.ebay-local-card-actions').getByRole('button', { name: 'AI优化' }).click()
    await page.waitForTimeout(800)
    // 千问核心商品词：验收 mock 百炼返回确定名词短语 Loft Bed Frame，应预填进输入框（取代规则截断词）
    const llmPrefilled = await page.waitForFunction(() => { const el = document.querySelector('.ebay-market-controls input'); return Boolean(el) && el.value === 'Loft Bed Frame' }, null, { timeout: 20000 }).then(() => true).catch(() => false)
    assert('千问提取核心商品词预填输入框（mock 名词短语）', llmPrefilled)
    assert('核心商品词输入框预填非空建议词', (await page.locator('.ebay-market-controls input').inputValue()).trim().length > 0)
    await page.locator('.ebay-market-controls input').fill('racing seat')
    // 复现根因场景：先把工作区滚动到底，反馈条若仍被裁切即回归
    await page.evaluate(() => { const ws = document.querySelector('.ebay-workspace'); if (ws) ws.scrollTop = ws.scrollHeight })
    await page.getByRole('button', { name: '检索已成交市场数据' }).click()
    await Promise.race([
      page.locator('.ebay-success-notice').getByText('市场检索完成').waitFor({ timeout: 45000 }).catch(() => null),
      page.locator('.ebay-error-notice').waitFor({ timeout: 45000 }).catch(() => null)
    ])
    const researchError = await page.locator('.ebay-error-notice').count() ? await page.locator('.ebay-error-notice').innerText() : ''
    assert('PALLET 产品检索不再报线上产品不存在', !researchError.includes('线上产品不存在'))
    assert('检索有可见结果或可见错误（非无反应）', Boolean(researchError) || await page.locator('.ebay-success-notice').getByText('市场检索完成').count() === 1)
    const feedbackVisible = await page.evaluate(() => {
      const el = document.querySelector('.ebay-error-notice') || document.querySelector('.ebay-success-notice')
      if (!el) return false
      const host = el.closest('.ebay-workspace')
      const r = el.getBoundingClientRect()
      const hr = host ? host.getBoundingClientRect() : { top: 0, bottom: window.innerHeight }
      return r.height > 0 && r.bottom > hr.top + 1 && r.top < hr.bottom - 1
    })
    assert('检索反馈条在滚动视口内可见（未被裁切）', feedbackVisible)
    await page.screenshot({ path: path.join(ARTIFACTS, 'ebay-market-research.png') })

    assert('无渲染进程异常', pageErrors.length === 0)
    if (pageErrors.length) console.error(pageErrors.join('\n'))
  } finally {
    await app.close().catch(() => {})
    mockServer.close()
  }
  console.log(failures === 0 ? 'AI跨境 hub 页验收通过' : `AI跨境 hub 页验收失败 ${failures} 项`)
  process.exit(failures === 0 ? 0 : 1)
})()
