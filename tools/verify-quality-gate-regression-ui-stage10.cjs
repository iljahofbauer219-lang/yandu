const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/stage10-quality-gate-regression')
const packagedExecutable = process.env.PACKAGED_EXECUTABLE || ''
fs.mkdirSync(outputDir, { recursive: true })
const checks = []
const assert = (id, passed, detail) => {
  checks.push({ id, passed: Boolean(passed), detail })
  if (!passed) throw new Error(`${id}: ${detail}`)
}

const reportFixture = [
  '# 宠物免洗擦浴精华 · Amazon美国站选品分析报告',
  '',
  '## 第一部分：本品基础信息解析',
  '- 产品名称：宠物免洗擦浴精华',
  '- 产品形态：液体精华',
  '',
  '## 第二部分：目标平台细分市场大盘调研',
  '- 月销量、销售额、BSR和历史趋势：U，待验证',
  '',
  '## 第三部分：本品与核心竞品多维对比',
  '- DIRECT 样本价格、评分和评论量以系统抓取为准。',
  '',
  '## 第四部分：头部竞店竞争实力拆解',
  '| 竞店/品牌及链接 | 代表商品 | 产品矩阵/价格 | 品牌与内容能力 | 仓配 |',
  '|---|---|---|---|---|',
  '| [TropiClean](https://www.amazon.com/s?k=TropiClean) | [B01EUNSD5G](https://www.amazon.com/dp/B01EUNSD5G) | $13.99 | 品牌认证与内容成熟 | FBA |',
  '',
  '## 第五部分：入市机会与盈利可行性判定',
  '❓ 数据不足，不能判定',
  '',
  '## 第六部分：产品改良方案与长期市场机会',
  '| 时间周期 | 核心策略 | 量化目标 | 继续/停止条件 |',
  '|---|---|---|---|',
  '| 短期（0–3月） | 补齐包装数据、小批量测试、切入Pet Shampoos类目 | 获取FBA费用、首月销量>100 | 待验证 |',
  "| 风险预警 | 同质化加剧、Vet's Best推小容量、FBA政策变更 | 月销量增速<10%持续2月 | 立即复盘 |",
  '',
  '## 数据来源、假设与待验证清单',
  '| 编号 | 数据/结论 | F/E/A/U | 来源/链接 | 待办/负责人 |',
  '|---|---|---|---|---|',
  '| 1 | 历史销量与趋势 | U | 待验证 | 运营补数 |'
].join('\n')

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  const query = url.searchParams.get('query') || 'query'
  const prefix = Buffer.from(query).toString('hex').slice(0, 4).toUpperCase()
  const results = Array.from({ length: 12 }, (_, index) => ({
    asin: `${prefix}${String(index).padStart(6, '0')}`.slice(0, 10),
    title: `Waterless Pet Shampoo No Rinse Body Cleanser for Dogs and Cats ${index}`,
    price: `$${12 + index}.99`, rating: '4.5', ratings_total: String(300 + index)
  }))
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ results }))
})

;(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const endpoint = `http://127.0.0.1:${server.address().port}/amazon/search`
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage10-quality-gate-'))
  const executablePath = packagedExecutable || path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const args = packagedExecutable ? [`--user-data-dir=${userDataDir}`] : ['.', `--user-data-dir=${userDataDir}`]
  const app = await electron.launch({ executablePath, args, cwd: root, env: { ...process.env, AMAZON_SCRAPER_API_URL: endpoint, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const profile = { id: 'stage10-gate', email: 'stage10@example.test', name: '质量门禁回归', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'stage10-org', name: '质量门禁组织' }, roles: [], permissions: 'ALL', stores: null }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }))
    await page.evaluate(value => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'stage10', refreshToken: 'stage10', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(value))
      const now = new Date().toISOString()
      const info = {
        url: 'https://detail.1688.com/offer/1006746849261.html', analysisDate: '2026-08-11', title: '宠物免洗擦浴精华', price: '¥2.50', seller: '广州宠本生物科技有限公司', images: ['https://example.test/product.jpg'],
        detailText: '袋装液体免洗擦浴精华，30ml，挤出液体后擦拭猫狗身体。', detailSource: '详情模块DOM', imageOcrText: 'PET WASH FREE SCRUB ESSENCE 30ml', visualProductForm: '液体精华', visualUseMethod: '免洗擦浴', visualTargetObject: '猫狗', visualConfidence: 96,
        confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '免洗擦浴', confirmedTargetObject: '猫狗', identityResolutionNote: '以图片、OCR和详情页为准'
      }
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({ __draft__: { info, collapsed: false, confirmed: true, confirmedAt: now, updatedAt: now } }))
    }, profile)
    await app.evaluate(({ ipcMain }, content) => {
      globalThis.__stage10GateQa = { asks: [] }
      const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      replace('ai-employee:derive-amazon-keywords', () => ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash'])
      replace('ai-employee:ask', (_event, request) => {
        globalThis.__stage10GateQa.asks.push(request.query)
        return { ok: true, content }
      })
    }, reportFixture)
    await page.reload()
    await page.waitForTimeout(900)
    await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.save({ apiKey: 'stage10-key', site: 'US', pages: 1, maxSamples: 24, cacheHours: 1 }))
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '选品分析师' }).click()
    await page.getByText('已确认锁定', { exact: true }).waitFor()
    await page.locator('.ai-employee-floating-composer textarea').fill('请生成 Amazon 美国站完整选品分析报告')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForFunction(() => {
      const last = [...document.querySelectorAll('.ai-employee-message.assistant')].at(-1)
      return last && !last.querySelector('.typing')
    }, null, { timeout: 30000 })

    const qa = await app.evaluate(() => globalThis.__stage10GateQa)
    const message = page.locator('.ai-employee-message.assistant').last()
    const text = (await message.innerText()).replace(/\s+/g, ' ')
    assert('single-generation-request', qa.asks.length === 1, `asks=${qa.asks.length}`)
    assert('former-tropiclean-false-positive-accepted', text.includes('TropiClean') && text.includes('B01EUNSD5G') && !text.includes('报告未通过正式报告质量校验'), text.slice(0, 800))
    assert('future-review-threshold-accepted', text.includes('月销量增速<10%持续2月') && text.includes('立即复盘'), text.slice(-600))
    assert('short-term-sales-target-accepted', text.includes('首月销量>100') && text.includes('短期（0–3月）'), text.slice(-700))
    assert('data-insufficient-decision-preserved', text.includes('数据不足，不能判定'), text.slice(-600))
    assert('no-failed-quality-notice', await page.getByText(/报告自动修正后仍未通过/).count() === 0, '无失败提示')

    await message.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(outputDir, '01-former-failure-now-accepted.png') })
    const expectedAssets = fs.readFileSync(path.join(root, 'dist/renderer/index.html'), 'utf8').match(/(?:src|href)="([^"]+\.(?:js|css))"/g)?.map(value => value.match(/"([^"]+)"/)?.[1]).filter(Boolean) || []
    const loadedAssets = await page.evaluate(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(element => element.getAttribute('src') || element.getAttribute('href')).filter(Boolean))
    assert('latest-production-assets-loaded', expectedAssets.every(asset => loadedAssets.includes(asset)), `expected=${expectedAssets.join(',')} loaded=${loadedAssets.join(',')}`)
    const result = { generatedAt: new Date().toISOString(), checks, askCount: qa.asks.length, expectedAssets, loadedAssets }
    fs.writeFileSync(path.join(outputDir, 'quality-gate-ui-report.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
  } finally {
    await app.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { server.close(() => {}); console.error(error); process.exit(1) })
