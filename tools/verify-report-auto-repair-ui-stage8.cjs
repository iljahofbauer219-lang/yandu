const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/stage8-real-ragflow-report')
fs.mkdirSync(outputDir, { recursive: true })
const checks = []
const assert = (id, passed, detail) => {
  checks.push({ id, passed: Boolean(passed), detail })
  if (!passed) throw new Error(`${id}: ${detail}`)
}
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage8-auto-repair-'))
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: root, env: { ...process.env, AMAZON_SCRAPER_API_URL: endpoint, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const profile = { id: 'stage8-repair', email: 'stage8@example.test', name: '阶段8自动修正', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'stage8-org', name: '阶段8组织' }, roles: [], permissions: 'ALL', stores: null }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }))
    await page.evaluate(value => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'stage8', refreshToken: 'stage8', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(value))
      const now = new Date().toISOString()
      const info = {
        url: 'https://detail.1688.com/offer/stage8.html', analysisDate: '2026-08-10', title: '宠物免洗擦浴精华', price: '¥2.50', seller: '阶段8供应商', images: ['https://example.test/product.jpg'],
        detailText: '液体免洗擦浴精华，30ml。', detailSource: '详情页', imageOcrText: 'PET WASH FREE SCRUB ESSENCE 30ml', visualProductForm: '液体精华', visualUseMethod: '免洗擦浴', visualTargetObject: '猫狗', visualConfidence: 96,
        confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '挤出液体后免洗擦浴', confirmedTargetObject: '猫狗', identityResolutionNote: '以详情与图片为准'
      }
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({ __draft__: { info, collapsed: false, confirmed: true, confirmedAt: now, updatedAt: now } }))
    }, profile)
    await app.evaluate(({ ipcMain }) => {
      globalThis.__stage8RepairQa = { asks: [] }
      const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      replace('ai-employee:derive-amazon-keywords', () => ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash'])
      replace('ai-employee:ask', (_event, request) => {
        globalThis.__stage8RepairQa.asks.push(request.query)
        if (globalThis.__stage8RepairQa.asks.length === 1) return { ok: true, content: '# 宠物免洗擦浴精华报告\n\n## 第一部分：本品基础信息解析\n- 产品形态：液体精华\n\n## 第二部分：市场\n- 月销量：8500\n\n⚠️ 有条件谨慎入场' }
        return { ok: true, content: '# 宠物免洗擦浴精华 · Amazon美国站选品分析报告\n\n## 第一部分：本品基础信息解析\n- 产品名称：宠物免洗擦浴精华\n- 产品形态：液体精华\n\n## 第二部分：Amazon 市场分析\n- 月销量、销售额、BSR和趋势：待验证\n\n## 第三部分：竞品对比\n- DIRECT 样本依系统数据\n\n## 第四部分：竞店分析\n- 待验证\n\n## 第五部分：盈利判定\n- 包装重量与 FBA 费用：待验证\n\n## 第六部分：产品改良\n- 待验证\n\n❓ 数据不足，不能判定' }
      })
    })
    await page.reload()
    await page.waitForTimeout(1000)
    await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.save({ apiKey: 'stage8-key', site: 'US', pages: 1, maxSamples: 24, cacheHours: 1 }))
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '选品分析师' }).click()
    await page.getByText('已确认锁定', { exact: true }).waitFor()
    await page.locator('.ai-employee-floating-composer textarea').fill('请生成 Amazon 美国站完整报告')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForFunction(() => {
      const last = [...document.querySelectorAll('.ai-employee-message.assistant')].at(-1)
      return last && !last.querySelector('.typing')
    }, null, { timeout: 30000 })
    const qa = await app.evaluate(() => globalThis.__stage8RepairQa)
    const text = (await page.locator('.ai-employee-message.assistant').last().innerText()).replace(/\s+/g, ' ')
    assert('one-repair-request', qa.asks.length === 2 && qa.asks[1].startsWith('【报告自动质量修正】'), `asks=${qa.asks.length}`)
    assert('repair-includes-original-issue', qa.asks[1].includes('月销量：8500') && qa.asks[1].includes('无证据数值'), '纠错请求包含原稿和校验问题')
    assert('repaired-report-accepted', text.includes('宠物免洗擦浴精华 · Amazon美国站选品分析报告') && text.includes('月销量、销售额、BSR和趋势：待验证') && !text.includes('报告未通过'), text)
    assert('repair-progress-cleared', await page.getByText(/正在自动修正|正在抓取/).count() === 0, '完成后无停滞状态')
    await page.screenshot({ path: path.join(outputDir, '01-auto-repair-accepted.png') })
    const report = { generatedAt: new Date().toISOString(), checks, askCount: qa.asks.length, assistantText: text }
    fs.writeFileSync(path.join(outputDir, 'auto-repair-ui-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await app.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { server.close(() => {}); console.error(error); process.exit(1) })
