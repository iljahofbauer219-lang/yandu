const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/stage6-controlled-enrichment')
fs.mkdirSync(outputDir, { recursive: true })
const checks = []
const assert = (id, passed, detail = '') => { checks.push({ id, passed, detail }); if (!passed) throw new Error(`${id}: ${detail}`) }
const server = http.createServer((_request, response) => {
  response.writeHead(400, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ detail: 'You have exceeded your monthly request limit of 100. Please upgrade your plan or wait until your limit resets.' }))
})

;(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const endpoint = `http://127.0.0.1:${server.address().port}/amazon/search`
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage6-enrichment-'))
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: root, env: { ...process.env, AMAZON_SCRAPER_API_URL: endpoint, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const profile = { id: 'stage6-enrichment', email: 'stage6@example.test', name: '阶段6验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'stage6-org', name: '阶段6组织' }, roles: [], permissions: 'ALL', stores: null }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }))
    await page.evaluate(value => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'stage6', refreshToken: 'stage6', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(value))
      const now = new Date().toISOString()
      const info = { url: 'https://detail.1688.com/offer/stage6.html', analysisDate: '2026-08-18', title: '宠物免洗擦浴精华', price: '¥6.50', seller: '阶段6供应商', detailText: '液体免洗擦浴精华，30ml。', detailSource: '详情页', visualProductForm: '液体精华', visualUseMethod: '免洗擦浴', visualTargetObject: '猫狗', visualConfidence: 96, confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '免洗擦浴', confirmedTargetObject: '猫狗', identityResolutionNote: '以详情与图片为准' }
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({ __draft__: { info, collapsed: false, confirmed: true, confirmedAt: now, updatedAt: now } }))
    }, profile)
    await app.evaluate(({ ipcMain }) => {
      globalThis.__stage6EnrichmentQa = { asks: 0 }
      const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      replace('ai-employee:derive-amazon-keywords', () => ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash'])
      replace('ai-employee:amazon-market-stats', (_event, keyword) => Array.from({ length: 18 }, (_, index) => ({ asin: `S6${keyword.length}${String(index).padStart(7, '0')}`, title: `Waterless Pet Shampoo Liquid Cleanser for Dogs and Cats ${index}`, price: 12 + index, rating: 4.5, reviews: 200 + index, query: keyword, source: 'browser' })))
      // 本脚本只验证受控 JSON 补充与降级报告；真实详情/评论采集分别由阶段 1、4 验收。
      replace('ai-employee:amazon-listing-evidence', () => [])
      replace('ai-employee:amazon-review-evidence', () => [])
      replace('ai-employee:ask', () => { globalThis.__stage6EnrichmentQa.asks += 1; return { ok: true, content: JSON.stringify({ hypotheses: ['液体免洗护理的小规格便携卖点需要通过样品反馈确认。'], validationTasks: ['抽取同类液体护理商品的规格和包装卖点，形成对比清单。'] }) } })
    })
    await page.reload()
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '产品分析师' }).click()
    await page.getByText('已确认锁定', { exact: true }).waitFor()
    await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.save({ apiKey: 'stage6-key', site: 'US', pages: 1, maxSamples: 24, cacheHours: 1 }))
    await page.locator('.ai-employee-floating-composer textarea[placeholder^="向 "]').fill('请生成 Amazon 美国站完整报告')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.ai-employee-message.assistant').length > 0, null, { timeout: 30000 })
    const assistant = page.locator('.ai-employee-message.assistant').last()
    const text = await assistant.innerText()
    const qa = await app.evaluate(() => globalThis.__stage6EnrichmentQa)
    assert('base-report-title-remains-amazon', text.includes('宠物免洗擦浴精华 · Amazon美国站选品分析报告'), text.slice(0, 300))
    assert('controlled-enrichment-visible', text.includes('受控分析补充') && text.includes('分析假设（待验证）') && text.includes('抽取同类液体护理商品'), text)
    assert('omkar-quota-fallback-visible-in-report', text.includes('OmkarCloud 当月请求额度已用尽') && text.includes('数据源状态'), text)
    assert('model-called-once-for-json-enrichment', qa.asks === 1, `asks=${qa.asks}`)
    assert('fixed-eleven-tables-remain-visible', await assistant.locator('table').count() === 11, `tables=${await assistant.locator('table').count()}`)
    const indexHtml = fs.readFileSync(path.join(root, 'dist/renderer/index.html'), 'utf8')
    const expectedAssets = [...indexHtml.matchAll(/(?:src|href)="([^"]+\/assets\/[^\"]+)"/g)].map(match => match[1])
    const loadedAssets = await page.evaluate(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(node => node.getAttribute('src') || node.getAttribute('href')).filter(Boolean))
    assert('latest-production-assets-loaded', expectedAssets.length === 2 && expectedAssets.every(asset => loadedAssets.includes(asset)), `expected=${expectedAssets.join(',')}; loaded=${loadedAssets.join(',')}`)
    await page.screenshot({ path: path.join(outputDir, '01-controlled-enrichment.png'), fullPage: true })
    console.log(JSON.stringify({ checks, askCount: qa.asks }, null, 2))
  } finally {
    await app.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { server.close(() => {}); console.error(error); process.exit(1) })
