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
const zlib = require('node:zlib')

// 最小 1x1 PNG 生成器：供产品页图集资产 mock 返回真实可解码图片
function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = Array.from({ length: 256 }, (_, n) => {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      return c >>> 0
    })
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function makePng1x1(r, g, b) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(1, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const idat = zlib.deflateSync(Buffer.from([0, r, g, b]))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

function startMockServer(routes) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://local').pathname
    const chunks = []
    req.on('data', chunk => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      const route = routes[pathname]
      if (route && route.__raw !== undefined) {
        res.setHeader('content-type', route.__type || 'application/octet-stream')
        res.end(route.__raw)
        return
      }
      res.setHeader('content-type', 'application/json')
      if (!route) { res.statusCode = 404; res.end(JSON.stringify({ message: 'not mocked' })); return }
      const payload = typeof route === 'function' ? route(raw) : route
      if (payload && typeof payload === 'object' && payload.__status) {
        res.statusCode = payload.__status
        const rest = { ...payload }
        delete rest.__status
        res.end(JSON.stringify(rest))
        return
      }
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

  const routes = {
    '/api/auth/me': ownerProfile,
    '/api/erp/capabilities': { canViewSource: true, canCollect: true, canEdit: true, canPricing: true, canResolveChanges: true },
    '/api/erp/products': { items: [], total: 0, page: 1, pageSize: 100 },
    // 百炼 mock：生图模型清单 + 千问核心商品词/候选变体（按请求体分流），qwen-mt 返回译文
    '/models': { data: [{ id: 'wan2.7-image-pro' }] },
    '/chat/completions': raw => {
      const body = JSON.parse(raw || '{}')
      if (raw.includes('MARKETING_FACTS_V1')) {
        return { choices: [{ message: { content: JSON.stringify({ purchaseReason: 'Solid pine loft bed frees floor space in small rooms', painPoints: ['Wobbly frames feel unsafe at night', 'Heavy loads bend weak frames'], scenarios: ['Small bedroom', 'Guest room'] }) } }] }
      }
      const userContent = String(body.messages?.[1]?.content || '')
      if (userContent.includes('"coreQuery"')) {
        const core = JSON.parse(userContent).coreQuery || 'racing seat'
        return { choices: [{ message: { content: JSON.stringify([`${core} pair`, `${core} set`, `bucket ${core}`]) } }] }
      }
      const model = String(body.model || '')
      if (model.includes('deepseek') && String(body.messages?.[0]?.content || '').includes('高转化详情页')) {
        const content = {
          overview: 'A loft bed frame built from a solid pine frame with guard rail, designed for small bedrooms.',
          benefits: [
            { painPoint: 'Wobbly loft beds feel unsafe at night', solution: 'Solid pine frame with guard rail keeps the platform steady', customerBenefit: 'Sleepers feel settled on a steady platform', evidenceFactIds: ['F001'] },
            { painPoint: 'Heavy loads bend weak frames', solution: 'Frame rated for Max Load 120 kg', customerBenefit: 'Suitable for adults and heavy mattresses', evidenceFactIds: ['F002'] },
            { painPoint: 'Rolling off the edge in sleep', solution: 'Guard rail design surrounds the sleeping area', customerBenefit: 'Helps sleepers stay within the rail boundary', evidenceFactIds: ['F003'] }
          ],
          scenarios: [
            { title: 'Small bedroom', description: 'The loft bed frame frees floor space under the platform in a small bedroom', evidenceFactIds: ['F001'] },
            { title: 'Guest room', description: 'Guard rail design suits a guest room where guests are unfamiliar with the bed', evidenceFactIds: ['F003'] },
            { title: 'Studio apartment', description: 'Solid pine frame fits a studio apartment needing steady sleeping furniture', evidenceFactIds: ['F001'] }
          ],
          storyboard: []
        }
        return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }
      }
      const content = model.includes('qwen-mt') ? '2件装 通用型桶形赛车座椅 红色缝线 PVC皮革' : 'Loft Bed Frame'
      return { choices: [{ message: { content } }] }
    },
    // 服务器产品页 meta（登录列表路由）：供『生成详情内容方案』事实回落验收
    '/api/product-pages': { items: [ {
      pageId: 'pp-verify-1', warehouseProductId: 'wh-fixture-p1', warehouseCode: 'GIGACLOUD',
      descriptionText: 'Solid pine frame with guard rail. Suitable for small bedrooms.',
      specs: [ { key: 'Material', value: 'Solid pine' }, { key: 'Max Load', value: '120 kg' } ],
      features: ['Guard rail design'],
      images: [ { name: 'i-01.png', contentType: 'image/png' }, { name: 'i-02.png', contentType: 'image/png' } ]
    } ] },
    // 公开产品页与图集资产（二进制）：供『读取产品原图』合并快照媒体验收
    '/product-pages/pp-verify-1': { __raw: '<html><body><section class="pp-gallery"><div class="pp-stage"><img class="pp-shot" src="assets/i-01.png" alt="a"><img class="pp-shot pp-shot-2" src="assets/i-02.png" alt="b"></div></section></body></html>', __type: 'text/html; charset=utf-8' },
    '/product-pages/pp-verify-1/assets/i-01.png': { __raw: makePng1x1(255, 0, 0), __type: 'image/png' },
    '/product-pages/pp-verify-1/assets/i-02.png': { __raw: makePng1x1(0, 128, 0), __type: 'image/png' },
    // Omkar 检索 mock：12 条成交样本，覆盖 racing seat pair/set 与 bucket racing seat 变体
    '/ebay/items/search': { listings: [
      ...[0, 1, 2, 3, 4, 5].map(i => ({ name: `Black Racing Seat Pair Adjustable ${i}`, price: { amount: '120.00' }, url: `https://www.ebay.com/itm/vp${i}`, listing_id: `vp${i}`, condition: 'New', units_sold: '5', delivery_info: { raw: 'Free shipping' } })),
      ...[0, 1, 2, 3].map(i => ({ name: `Racing Seat Set Recline Suede ${i}`, price: { amount: '98.50' }, url: `https://www.ebay.com/itm/vs${i}`, listing_id: `vs${i}`, condition: 'New', units_sold: '3', delivery_info: { raw: 'Free shipping' } })),
      ...[0, 1].map(i => ({ name: `Bucket Racing Seat Pair Carbon ${i}`, price: { amount: '150.00' }, url: `https://www.ebay.com/itm/vb${i}`, listing_id: `vb${i}`, condition: 'New', units_sold: '8', delivery_info: { raw: 'Free shipping' } }))
    ] }
  }
  const mockServer = await startMockServer(routes)
  const mockUrl = `http://127.0.0.1:${mockServer.address().port}`
  // 百炼多模态生图 mock：万相走异步任务流，每次调用返回一张唯一 mock 资产图，并记录请求体供提示词/参照断言
  let generatedImageSeq = 0
  let pollSeq = 0
  const imagePayloads = []
  routes['/api/v1/services/aigc/image-generation/generation'] = raw => {
    generatedImageSeq += 1
    const body = JSON.parse(raw || '{}')
    const content = body?.input?.messages?.[0]?.content || []
    imagePayloads.push({
      prompt: String((content.find(item => item && item.text) || {}).text || ''),
      refs: content.filter(item => item && item.image).map(item => item.image)
    })
    return { output: { task_id: 'task-verify', task_status: 'PENDING' } }
  }
  routes['/api/v1/tasks/task-verify'] = () => {
    pollSeq += 1
    const asset = `i-0${((pollSeq - 1) % 2) + 1}.png`
    return { output: { task_status: 'SUCCEEDED', results: [{ url: `${mockUrl}/product-pages/pp-verify-1/assets/${asset}?variant=${pollSeq}` }] } }
  }
  routes['/__image-payloads'] = () => ({ payloads: imagePayloads })
  // 零度API mock：按模式分流 503 无通道 / 成功，覆盖瞬时重试、链内降级、整链无通道自动跨厂商三场景
  let linduoMode = 'default'
  const linduoCalls = {}
  const resetLinduoCalls = () => { for (const key of Object.keys(linduoCalls)) delete linduoCalls[key] }
  routes['/__linduo-mode'] = raw => { linduoMode = String(JSON.parse(raw || '{}').mode || 'default'); return { ok: true, mode: linduoMode } }
  routes['/v1/models'] = { data: [], object: 'list' }
  routes['/v1/images/generations'] = raw => {
    const body = JSON.parse(raw || '{}')
    const model = String(body.model || '')
    linduoCalls[model] = (linduoCalls[model] || 0) + 1
    const seq = linduoCalls[model]
    const fail = linduoMode === 'all-fail'
      || (linduoMode === 'gemini-only' && model !== 'gemini-2.5-flash-image-preview')
      || (linduoMode === 'gpt-always-fail' && model === 'gpt-image-1')
      || (linduoMode === 'default' && model === 'gpt-image-1' && seq <= 2)
    if (fail) {
      return { __status: 503, error: { message: `No available channel for model ${model} under group auto (distributor) (request id: req-${model}-${seq})` } }
    }
    pollSeq += 1
    return { data: [{ url: `${mockUrl}/product-pages/pp-verify-1/assets/i-0${((pollSeq - 1) % 2) + 1}.png?linduo=${pollSeq}` }] }
  }
  const bananaPayloads = []
  for (const model of ['nano-banana-2', 'nano-banana-pro']) {
    routes[`/v1beta/models/${model}:generateContent`] = raw => {
      const body = JSON.parse(raw)
      bananaPayloads.push({ model, body })
      linduoCalls[model] = (linduoCalls[model] || 0) + 1
      if (linduoMode === 'all-fail' || linduoMode === 'gemini-only') return { __status: 503, error: { message: 'No available channel' } }
      return { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: makePng1x1(bananaPayloads.length % 255, 100, 200).toString('base64') } }] } }] }
    }
  }
  fs.writeFileSync(path.join(userDataDir, 'server-config.json'), JSON.stringify({ serverUrl: mockUrl }, null, 2))

  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: path.resolve(__dirname, '..'), env: { ...process.env, CODEX_UI_TEST: '1', YANDU_REAL_IMAGE_MODELS: '1', YANDU_HOT_DIR: path.join(userDataDir, 'no-hot'), BAILIAN_BASE_URL: mockUrl, BAILIAN_API_KEY: 'verify-bailian-key', LINDUO_BASE_URL: `${mockUrl}/v1`, LINDUO_API_KEY: 'verify-linduo-key', YANDU_LINDUO_RETRY_DELAYS: '300,300', EBAY_SCRAPER_API_URL: `${mockUrl}/ebay/items/search`, DEEPSEEK_API_KEY: 'verify-deepseek-key', DEEPSEEK_BASE_URL: mockUrl } })
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

    // 存 Omkar 测试 Key（主进程加密落盘），检索走 mock Omkar 通道
    await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.save({ apiKey: 'verify-omkar-key', site: 'US', pages: 1, maxSamples: 24, cacheHours: 1 }))

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
    await page.locator('.ebay-revise-overlay').getByRole('button', { name: '自动分类' }).click()
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
    // 候选市场词=核心词短语变体+成交佐证：展开核对区断言变体与回数，且无关单词不再出现
    await page.locator('.ebay-market-keyword-review summary').click()
    const reviewText = await page.locator('.ebay-market-keyword-review').innerText()
    assert('候选市场词为核心词短语变体（含成交佐证）', reviewText.includes('racing seat pair') && reviewText.includes('bucket racing seat'))
    assert('候选市场词不再出现 black 等无关单词', !reviewText.includes('black'))
    // 确认一个候选词后：本地产品无采集原标题也应以快照标题回落，生成按钮可用且无原标题占位
    await page.locator('.ebay-market-keyword-review article').first().getByRole('button', { name: '确认使用' }).click()
    await page.waitForTimeout(1000)
    const genBtn = page.getByRole('button', { name: /生成六套标题方案|换一批六套标题方案/ })
    assert('确认候选词后生成六套标题方案按钮可用', await genBtn.count() === 1 && !(await genBtn.isDisabled()))
    assert('本地产品不再显示原标题尚未取得占位', await page.getByText('原标题尚未取得').count() === 0)
    // 确认采用此标题：PALLET- 合成 listing 不在线上产品表，主进程必须回落本地快照，不得误报『原商品已不存在』
    const confirmOutcome = await page.evaluate(async () => {
      const connectors = new Set(['a', 'an', 'and', 'by', 'for', 'from', 'in', 'of', 'on', 'the', 'to', 'with'])
      const words = (value) => String(value || '').toLowerCase().replace(/&/g, ' and ').match(/[a-z0-9]+/g) || []
      const message = (reason) => String(reason && reason.message ? reason.message : reason)
      try {
        const stores = await window.desktop.ebay.stores()
        const storeId = stores.length ? stores[0].id : ''
        const products = storeId ? await window.desktop.ebay.localProducts(storeId) : []
        const product = products.find((item) => String(item.listingId).startsWith('PALLET-'))
        if (!product) return { ok: false, message: '验收前置数据缺失：没有 PALLET 本地产品' }
        const snapshot = await window.desktop.ebay.marketResearch(storeId, product.listingId)
        if (!snapshot) return { ok: false, message: '验收前置数据缺失：该产品没有市场快照' }
        const source = product.snapshot.sourceListing
        const originalTitle = String(source.originalTitle || '').trim() || String(source.title || '').trim()
        const confirmed = [...snapshot.keywords, ...snapshot.combinations, ...(snapshot.coreVariants || [])].filter((item) => item.factStatus === 'CONFIRMED')
        if (!confirmed.length) return { ok: false, message: '验收前置数据缺失：没有已确认市场词' }
        const termWords = words(confirmed[0].term)
        const used = new Set(termWords)
        let title = confirmed[0].term
        for (const word of words(originalTitle).filter((item) => !used.has(item) && !connectors.has(item))) {
          if ((`${title} ${word}`).length > 78) break
          title += ` ${word}`
        }
        const payload = { storeId, listingId: product.listingId, researchSnapshotId: snapshot.id, originalTitle, selectedTitle: title, selectedVariantId: 'BALANCED', variants: [{ id: 'BALANCED', name: '综合推荐型', title, keywords: [], rationale: '验收脚本构造' }], verifiedFacts: [] }
        try {
          const decision = await window.desktop.ebay.confirmTitleDecision(payload)
          const stored = await window.desktop.ebay.titleDecision(storeId, product.listingId)
          return { ok: true, message: '', title, storeId, listingId: product.listingId, storedTitle: stored ? stored.selectedTitle : '', auditPassed: Boolean(decision && decision.audit && decision.audit.passed) }
        } catch (reason) {
          return { ok: false, message: message(reason), title, storeId, listingId: product.listingId }
        }
      } catch (reason) {
        return { ok: false, message: `验收前置数据异常：${message(reason)}` }
      }
    })
    assert('本地货盘产品确认采用此标题保存成功（不再误报原商品已不存在）', confirmOutcome.ok === true)
    assert('确认后的标题决策可回读', Boolean(confirmOutcome.ok && confirmOutcome.storedTitle === confirmOutcome.title))
    if (!confirmOutcome.ok) console.error(`确认采用此标题失败：${confirmOutcome.message}`)
    // 图片环节快照同步：PALLET 产品无线上 listing，更新快照应回落本地产品而非抛『线上产品不存在』
    const syncOutcome = await page.evaluate(async ({ storeId, listingId }) => {
      try {
        const product = await window.desktop.ebay.downloadLocalProduct(storeId, listingId)
        return { ok: true, message: '', versionCount: product.versionCount, mediaCount: product.snapshot.media.length, imageUrls: product.snapshot.sourceListing.imageUrls || [] }
      } catch (reason) {
        return { ok: false, message: String(reason && reason.message ? reason.message : reason), versionCount: 0, mediaCount: 0, imageUrls: [] }
      }
    }, { storeId: confirmOutcome.storeId || '', listingId: confirmOutcome.listingId || '' })
    assert('PALLET 产品更新本地快照不再报线上产品不存在', syncOutcome.ok === true)
    assert('PALLET 快照合并产品页全部原图图集（读取产品原图回落）', syncOutcome.ok === true && syncOutcome.mediaCount >= 3 && syncOutcome.imageUrls.some(url => String(url).includes('/product-pages/pp-verify-1/assets/')))
    if (!syncOutcome.ok) console.error(`更新本地快照失败：${syncOutcome.message}`)
    // 生成详情内容方案：PALLET 产品无 eBay 详情，事实源回落服务器产品页（mock /api/product-pages + 公开页解析）
    const contentOutcome = await page.evaluate(async ({ storeId, listingId }) => {
      try {
        const result = await window.desktop.ebay.optimizeContent({ listingId, originalTitle: 'FIXTURE Pallet Alpha Loft Bed 300001', selectedTitle: 'Loft Bed Frame With Guard Rail Solid Pine', categoryName: '卧室家具', itemSpecifics: [], sourceDescription: '' }, 'ac-ui-owner')
        const products = await window.desktop.ebay.localProducts(storeId)
        const product = products.find(item => item.listingId === listingId)
        return { ok: true, message: '', factCount: result.sourceFacts.length, labels: [...new Set(result.sourceFacts.map(item => item.sourceLabel))], snapshotDescription: product ? product.snapshot.details.descriptionText : '' }
      } catch (reason) {
        return { ok: false, message: String(reason && reason.message ? reason.message : reason), factCount: 0, labels: [], snapshotDescription: '' }
      }
    }, { storeId: confirmOutcome.storeId || '', listingId: confirmOutcome.listingId || '' })
    assert('生成详情内容方案读取服务器产品页事实成功', contentOutcome.ok === true && contentOutcome.factCount > 0)
    assert('详情事实标注服务器产品页且描述回写本地快照', contentOutcome.labels.includes('服务器产品页原始详情') && String(contentOutcome.snapshotDescription).includes('Solid pine'))
    if (!contentOutcome.ok) console.error(`生成详情内容方案失败：${contentOutcome.message}`)
    // 图片优化环节：原图按钮改名『读取产品原图』，旧 eBay 文案下线
    await page.locator('button', { hasText: '图片优化' }).first().click()
    await page.waitForTimeout(1500)
    assert('原图按钮改名为读取产品原图', await page.getByRole('button', { name: /读取产品原图|重新读取产品原图|正在读取…/ }).count() === 1)
    assert('旧文案读取eBay全部原图不再出现', await page.getByRole('button', { name: /读取eBay全部原图|重新读取eBay原图/ }).count() === 0)
    assert('选图区展示产品页合并图集', await page.locator('.ebay-original-gallery-extra article').count() >= 3)
    // 简化七步图片优化：事实卡自动 → 模式 → 一键生成 → 采纳 → 保留回显
    await page.locator('.ebay-source-select-heading').getByRole('button', { name: '确定' }).click()
    await page.waitForTimeout(800)
    assert('图片优化简化面板标题在位', await page.getByText('图片优化 · 简化流程').count() === 1)
    assert('营销事实卡自动产出（购买理由/痛点/场景）', await page.getByText('购买理由：').waitFor({ state: 'visible', timeout: 30000 }).then(() => true).catch(() => false))
    assert('两种出图模式可选（纯图片/图文结合）', await page.getByText('纯图片（适合 eBay）').count() === 1 && await page.getByText('图片和文字结合（适合亚马逊）').count() === 1)
    // 四类图片各自独立张数（主图/细节/痛点/场景），不再共用单一「每类图片数」
    assert('四类数量输入独立（主图/细节/痛点/场景）', await page.getByLabel('主图图片数').count() === 1 && await page.getByLabel('细节图片数').count() === 1 && await page.getByLabel('痛点图片数').count() === 1 && await page.getByLabel('场景图片数').count() === 1)
    assert('旧单一每类图片数输入已下线', await page.getByLabel('每类图片数').count() === 0)
    const defaultCounts = await page.locator('.ebay-stage-count-input input').evaluateAll(items => items.map(item => Number(item.value)))
    assert('四类数量默认主图3/细节3/痛点2/场景2', JSON.stringify(defaultCounts) === JSON.stringify([3, 3, 2, 2]))
    assert('按钮文案含四类各自张数', await page.getByRole('button', { name: /一键生成（主图 3 · 细节 3 · 痛点 2 · 场景 2）/ }).count() === 1)
    await page.getByLabel('主图图片数').fill('4')
    assert('改主图张数后按钮文案即时更新', await page.getByRole('button', { name: /一键生成（主图 4 · 细节 3 · 痛点 2 · 场景 2）/ }).count() === 1)
    await page.getByRole('button', { name: /一键生成（主图 4/ }).click()
    assert('一键生成产出候选图网格', await page.locator('.ebay-stage-gen-cell').first().waitFor({ state: 'visible', timeout: 60000 }).then(() => true).catch(() => false))
    const countsByCategory = await page.locator('.ebay-stage-generated').evaluateAll(groups => groups.map(group => group.querySelectorAll('.ebay-stage-gen-item').length))
    assert('一键生成按四类各自设置出图（主图4/细节3/痛点2/场景2）', JSON.stringify(countsByCategory) === JSON.stringify([4, 3, 2, 2]))
    await page.locator('.ebay-stage-generated').first().screenshot({ path: path.join(ARTIFACTS, 'ebay-stage-category-counts.png') }).catch(() => {})
    // 生图请求体断言：参照非空且在上限内、白底子句只约束主图、痛点/场景含事实卡原文与互斥机位
    const captured = await (await fetch(`${mockUrl}/__image-payloads`)).json()
    const bodies = captured.payloads || []
    const shotLine = body => (body.prompt.match(/Shot requirement: (.+)/) || [])[1] || ''
    const heroBodies = bodies.filter(body => body.prompt.startsWith('Create 主图'))
    const productBodies = bodies.filter(body => body.prompt.startsWith('Create 产品细节图'))
    const painBodies = bodies.filter(body => body.prompt.startsWith('Create 痛点解决图'))
    const sceneBodies = bodies.filter(body => body.prompt.startsWith('Create 应用场景图'))
    assert('生图请求体按卡捕获（11 卡）', bodies.length === 11)
    assert('每卡参照非空且在模型上限内', bodies.every(body => body.refs.length >= 1 && body.refs.length <= 8))
    assert('主图提示词保留纯白底约束', heroBodies.length === 4 && heroBodies.every(body => body.prompt.includes('plain clean white background')))
    assert('痛点/场景提示词不再误加纯白底且带互斥机位', painBodies.length === 2 && sceneBodies.length === 2 && [...painBodies, ...sceneBodies].every(body => !body.prompt.includes('plain clean white background') && body.prompt.includes('Framing:')))
    assert('痛点提示词含事实卡痛点原文', painBodies.every(body => /Wobbly frames feel unsafe at night|Heavy loads bend weak frames/.test(body.prompt)))
    assert('场景提示词含事实卡场景原文', sceneBodies.every(body => /Small bedroom|Guest room/.test(body.prompt)))
    assert('细节卡提示词构图互不相同', new Set(productBodies.map(shotLine)).size === productBodies.length && productBodies.length === 3)
    await page.locator('.ebay-stage-gen-item').first().click()
    await page.waitForTimeout(800)
    assert('采纳后出现已保留图片区', await page.getByText('⑥ 已保留图片').count() === 1)
    await page.locator('.ebay-business-nav').getByRole('button', { name: '本地产品' }).click()
    await page.waitForTimeout(800)
    await page.locator('.ebay-local-card-actions').getByRole('button', { name: 'AI优化' }).first().click()
    await page.waitForTimeout(1200)
    await page.locator('button', { hasText: '图片优化' }).first().click()
    await page.waitForTimeout(1200)
    assert('重进环节回显已保留图片', await page.getByText('⑥ 已保留图片').count() === 1 && await page.locator('.ebay-stage-confirmed-grid img').count() >= 1)
    const restoredCounts = await page.locator('.ebay-stage-count-input input').evaluateAll(items => items.map(item => Number(item.value)))
    assert('重进环节回显四类各自张数设置', JSON.stringify(restoredCounts) === JSON.stringify([4, 3, 2, 2]))
    // 旧版单一 perCount 持久值自动迁移为四类同值（改写 localStorage 为旧结构后重进）
    const migrated = await page.evaluate(() => {
      const key = Object.keys(localStorage).find(item => item.startsWith('ebay-image-simplified:v1:'))
      if (!key) return false
      const current = JSON.parse(localStorage.getItem(key))
      localStorage.setItem(key, JSON.stringify({ mode: current.mode, perCount: 2, facts: current.facts, generated: current.generated, keptByCategory: current.keptByCategory }))
      return true
    })
    assert('旧版持久结构可写入（迁移前置条件）', migrated === true)
    await page.locator('.ebay-business-nav').getByRole('button', { name: '本地产品' }).click()
    await page.waitForTimeout(800)
    await page.locator('.ebay-local-card-actions').getByRole('button', { name: 'AI优化' }).first().click()
    await page.waitForTimeout(1200)
    await page.locator('button', { hasText: '图片优化' }).first().click()
    await page.waitForTimeout(1200)
    const legacyMigratedCounts = await page.locator('.ebay-stage-count-input input').evaluateAll(items => items.map(item => Number(item.value)))
    assert('旧单一每类图片数持久值自动迁移为四类同值', JSON.stringify(legacyMigratedCounts) === JSON.stringify([2, 2, 2, 2]))
    const bananaReference = `data:image/png;base64,${makePng1x1(200, 50, 20).toString('base64')}`
    const bananaDb = new DatabaseSync(path.join(userDataDir, 'sourcing-data.sqlite'))
    for (const row of bananaDb.prepare('SELECT id, payload FROM ebay_local_product_snapshots').all()) {
      const snapshot = JSON.parse(row.payload)
      snapshot.sourceListing.imageUrl = bananaReference
      snapshot.sourceListing.imageUrls = [bananaReference]
      snapshot.media = []
      bananaDb.prepare('UPDATE ebay_local_product_snapshots SET payload = ? WHERE id = ?').run(JSON.stringify(snapshot), row.id)
    }
    bananaDb.close()
    await page.reload()
    await page.locator('.sidebar').getByRole('button', { name: 'AI跨境', exact: true }).click()
    await page.locator('.ai-crossborder-grid .ai-crossborder-card', { hasText: 'eBay' }).click()
    await page.locator('.ebay-business-nav').getByRole('button', { name: '本地产品' }).click()
    await page.locator('.ebay-local-card-actions').getByRole('button', { name: 'AI优化' }).first().click()
    await page.locator('button', { hasText: '图片优化' }).first().click()
    if (await page.locator('.ebay-source-collapsed-bar').count()) await page.locator('.ebay-source-collapsed-bar').click()
    await page.locator('.ebay-original-gallery-extra article img[src^="data:image/"]').first().waitFor({ state: 'visible' })
    for (const article of await page.locator('.ebay-original-gallery-extra article').all()) {
      const embedded = (await article.locator('img').getAttribute('src')).startsWith('data:image/')
      const selected = await article.locator('.ebay-source-pick.selected').count() > 0
      if (embedded !== selected) await article.locator('.ebay-source-pick').click()
    }
    await page.locator('.ebay-source-select-heading').getByRole('button', { name: '确定' }).click()
    for (const model of ['nano-banana-2', 'nano-banana-pro']) {
      await page.locator('.ebay-stage-model-select select').selectOption(model)
      for (const label of ['主图图片数', '细节图片数', '痛点图片数', '场景图片数']) await page.getByLabel(label).fill('1')
      await page.locator('.ebay-stage-section').getByRole('button', { name: /一键生成/ }).click()
      const waitForBanana = () => page.waitForFunction(id => {
        const error = document.querySelector('.ebay-stage-error')
        if (error) throw new Error(error.textContent)
        const key = Object.keys(localStorage).find(key => key.startsWith('ebay-image-simplified:v1:'))
        const generated = key ? JSON.parse(localStorage.getItem(key)).generated || [] : []
        return generated.length === 4 && generated.every(image => image.model === id) && Array.from(document.querySelectorAll('.ebay-stage-gen-item img')).every(image => image.complete && image.naturalWidth > 0) && !document.querySelector('.ebay-stage-gen-regen:disabled')
      }, model, { timeout: 600000 })
      await waitForBanana()
      assert(`${model} 下拉选择后四类生成成功且实际模型一致`, await page.locator('.ebay-stage-gen-item').count() === 4)
      const before = await page.locator('.ebay-stage-gen-item img').first().getAttribute('src')
      await page.locator('.ebay-stage-gen-regen').first().click()
      await page.waitForFunction(src => document.querySelector('.ebay-stage-gen-item img')?.getAttribute('src') !== src && !document.querySelector('.ebay-stage-gen-regen:disabled'), before, { timeout: 300000 })
      assert(`${model} 单张重生成成功且未切换模型`, await page.locator('.ebay-stage-model-select select').inputValue() === model)
      const payloads = bananaPayloads.filter(item => item.model === model)
      assert(`${model} Gemini 请求携带参照图与1K/2K参数`, payloads.length === 5 && payloads.every(item => item.body.contents[0].parts.some(part => part.inlineData?.data)) && payloads.some(item => item.body.generationConfig.imageConfig.imageSize === '2K') && payloads.some(item => item.body.generationConfig.imageConfig.imageSize === '1K'))
      await page.screenshot({ path: path.join(ARTIFACTS, `${model}.png`) })
      await page.locator('.ebay-business-nav').getByRole('button', { name: '本地产品' }).click()
      await page.locator('.ebay-local-card-actions').getByRole('button', { name: 'AI优化' }).first().click()
      await page.locator('button', { hasText: '图片优化' }).first().click()
      await waitForBanana()
      assert(`${model} 重新进入后四张本地图片均可解码显示`, await page.locator('.ebay-stage-gen-item img').count() === 4)
    }
    // 零度API 无通道三场景：瞬时重试成功 / 链内改用存活模型 / 整链无通道自动跨厂商改用万相（均不出红条）
    const retryOutcome = await page.evaluate(() => window.desktop.image.generate({ model: 'gpt-image-1', prompt: 'harness retry probe', count: 1, size: '1K', referenceImageUrls: [] }).then(r => ({ ok: true, model: r.model || '', notice: r.notice || '', urls: r.imageUrls.length })).catch(reason => ({ ok: false, model: '', notice: String(reason && reason.message ? reason.message : reason), urls: 0 })))
    assert('零度无通道瞬时错误自动重试后成功', retryOutcome.ok === true && retryOutcome.model === 'gpt-image-1' && retryOutcome.notice.includes('已自动重试'))
    await fetch(`${mockUrl}/__linduo-mode`, { method: 'POST', body: JSON.stringify({ mode: 'gpt-always-fail' }) })
    const fallbackOutcome = await page.evaluate(() => window.desktop.image.generate({ model: 'gpt-image-1', prompt: 'harness fallback probe', count: 1, size: '1K', referenceImageUrls: [] }).then(r => ({ ok: true, model: r.model || '', notice: r.notice || '' })).catch(reason => ({ ok: false, model: '', notice: String(reason && reason.message ? reason.message : reason) })))
    assert('零度持续无通道自动降级同厂商模型并显式告知', fallbackOutcome.ok === true && fallbackOutcome.model === 'imagen-4.0' && fallbackOutcome.notice.includes('已改用 Imagen 4.0'))
    // 面板自动恢复等待：出图集合确有变化/分组数达标 + 无红条 + 提示条含指定中文说明
    const waitForAutoSwitch = async (noticeText, options = {}) => {
      const baselineSrcs = await page.locator('.ebay-stage-gen-item img').evaluateAll(items => items.map(item => item.getAttribute('src') || '').join('|'))
      return page.waitForFunction(args => {
        const notice = document.querySelector('.ebay-stage-gen-notice')
        const groups = document.querySelectorAll('.ebay-stage-generated').length
        const srcs = Array.from(document.querySelectorAll('.ebay-stage-gen-item img')).map(item => item.getAttribute('src') || '').join('|')
        if (args.growth && srcs === args.baselineSrcs) return false
        if (args.minGroups && groups < args.minGroups) return false
        return !document.querySelector('.ebay-stage-error') && Boolean(notice && notice.textContent.includes(args.noticeText))
      }, { baselineSrcs, noticeText, growth: Boolean(options.growth), minGroups: options.minGroups || 0 }, { timeout: 90000 }).then(() => true).catch(() => false)
    }
    await fetch(`${mockUrl}/__linduo-mode`, { method: 'POST', body: JSON.stringify({ mode: 'gemini-only' }) })
    await page.locator('.ebay-stage-model-select select').selectOption('gpt-image-1')
    resetLinduoCalls()
    await page.locator('.ebay-stage-gen-regen').first().click()
    assert('零度链内自动改用存活模型出图并提示，无红条', await waitForAutoSwitch('已改用 Gemini 2.5 Flash Image', { growth: true }) === true)
    assert('链内降级后下拉框跟随实际出图模型', await page.locator('.ebay-stage-model-select select').inputValue() === 'gemini-2.5-flash-image-preview')
    assert('链内降级跳过 TTL 内已确认无通道的 gpt-image-1', (linduoCalls['gpt-image-1'] || 0) === 0 && (linduoCalls['imagen-4.0'] || 0) === 3)
    await fetch(`${mockUrl}/__linduo-mode`, { method: 'POST', body: JSON.stringify({ mode: 'all-fail' }) })
    await page.locator('.ebay-stage-model-select select').selectOption('gpt-image-1')
    resetLinduoCalls()
    await page.locator('.ebay-stage-gen-regen').first().click()
    assert('零度整链无通道自动改用万相 2.7 Pro 出图，无红条', await waitForAutoSwitch('已自动改用 万相 2.7 Pro', { growth: true }) === true)
    assert('跨厂商恢复后下拉框切到万相 2.7 Pro', await page.locator('.ebay-stage-model-select select').inputValue() === 'wan2.7-image-pro')
    assert('整链无通道时 gpt 与 imagen 不再重复打上游', (linduoCalls['gpt-image-1'] || 0) === 0 && (linduoCalls['imagen-4.0'] || 0) === 0 && (linduoCalls['gemini-2.5-flash-image-preview'] || 0) === 3)
    await page.locator('.ebay-stage-model-select select').selectOption('gpt-image-1')
    for (const index of [0, 1, 2, 3]) await page.locator('.ebay-stage-count-input input').nth(index).fill('1')
    resetLinduoCalls()
    await page.locator('.ebay-stage-section').getByRole('button', { name: /一键生成/ }).click()
    assert('选 GPT-Image-1 一键生成四类图自动出 4 张且不再提示错误', await waitForAutoSwitch('已自动改用 万相 2.7 Pro', { minGroups: 4 }) === true && await page.locator('.ebay-stage-gen-item').count() === 4)
    assert('一键生成整链无通道时零次探测零度死模型', Object.keys(linduoCalls).length === 0)
    await page.screenshot({ path: path.join(ARTIFACTS, 'ebay-linduo-auto-recovery.png') })
    await fetch(`${mockUrl}/__linduo-mode`, { method: 'POST', body: JSON.stringify({ mode: 'default' }) })
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
