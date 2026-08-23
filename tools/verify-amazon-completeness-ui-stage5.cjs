const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/stage5-amazon-completeness')
fs.mkdirSync(outputDir, { recursive: true })
const checks = []
const assert = (id, passed, detail) => {
  checks.push({ id, passed: Boolean(passed), detail })
  if (!passed) throw new Error(`${id}: ${detail}`)
}

const keywords = ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash']
let serverMode = 'complete'
const requests = []
const cacheResults = page => Array.from({ length: 30 }, (_, index) => {
  const serial = page === 1 ? index : index < 5 ? index : index + 25
  return { asin: `CACHE${String(serial).padStart(5, '0')}`, title: `Cache verification product ${serial}`, price: `$${10 + serial}.00`, rating: '4.5', ratings_total: String(100 + serial) }
})
const completeResults = (query, page) => {
  const keywordIndex = Math.max(0, keywords.indexOf(query))
  const base = `${keywordIndex}${page}`
  const direct = Array.from({ length: 6 }, (_, index) => ({
    asin: `D${base}${String(index).padStart(6, '0')}`,
    title: `Waterless Pet Shampoo No Rinse Body Cleanser for Dogs and Cats ${base}-${index}`,
    price: `$${15 + keywordIndex * 6 + (page - 1) * 3 + index}.00`, rating: String(4.1 + (index % 5) / 10), ratings_total: String(120 + keywordIndex * 100 + page * 20 + index * 11)
  }))
  return [...direct,
    { asin: `S${base}000000`, title: `Sponsored Waterless Pet Shampoo No Rinse Cleanser ${base}`, price: '$12.00', rating: '4.7', ratings_total: '5000', is_sponsored: true },
    { asin: `W${base}000000`, title: `Pet Grooming Wipes for Dog and Cat Body Cleaning ${base}`, price: '$9.99', rating: '4.6', ratings_total: '8000' },
    { asin: `B${base}000000`, title: `Pet Grooming Cleaning Brush for Dogs ${base}`, price: '$7.99', rating: '4.4', ratings_total: '4000' }
  ]
}
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  const query = url.searchParams.get('query') || ''
  const page = Number(url.searchParams.get('page') || 1)
  requests.push({ query, page, apiKey: request.headers['api-key'] || '' })
  let results
  if (query === 'cache verification product') results = cacheResults(page)
  else if (serverMode === 'complete') results = completeResults(query, page)
  else results = page === 1 ? [{ asin: `LOW${Math.max(0, keywords.indexOf(query))}000000`, title: `Waterless Pet Shampoo No Rinse Body Cleanser ${query}`, price: '$15.00', rating: null, ratings_total: null }] : []
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ results }))
})

;(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  const endpoint = `http://127.0.0.1:${address.port}/amazon/search`
  console.log(`STAGE5 UI: fixture endpoint ${endpoint}`)
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage5-amazon-electron-'))
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: root, env: { ...process.env, AMAZON_SCRAPER_API_URL: endpoint, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const qaProfile = { id: 'stage5-qa', email: 'stage5@example.test', name: '阶段5验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'stage5-org', name: '阶段5组织' }, roles: [], permissions: 'ALL', stores: null }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
    await page.evaluate(profile => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'stage5', refreshToken: 'stage5', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
      const now = new Date().toISOString()
      const info = {
        url: 'https://detail.1688.com/offer/stage5.html', analysisDate: '2026-08-10', title: '跨境猫狗通用宠物免洗擦拭精华清洁套装', price: '¥2.50', seller: '阶段5供应商',
        images: ['https://example.test/product.jpg'], detailText: '宠物液体免洗擦浴精华，挤出后擦浴清洁。', detailSource: '详情模块DOM', imageOcrText: 'PET WASH FREE SCRUB ESSENCE 30ml',
        attributes: ['包装尺寸：10×8×2cm', '包装重量：40g'],
        visualProductForm: '液体精华', visualUseMethod: '免洗擦浴', visualTargetObject: '猫狗', visualConfidence: 96,
        confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '挤出液体后免洗擦浴', confirmedTargetObject: '猫狗', identityResolutionNote: '以包装出液口、详情说明和实物形态为准'
      }
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({ __draft__: { info, collapsed: false, confirmed: true, confirmedAt: now, updatedAt: now } }))
    }, qaProfile)
    await app.evaluate(({ ipcMain }) => {
      globalThis.__stage5Qa = { deriveCalls: [], asks: [] }
      const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      replace('ai-employee:derive-amazon-keywords', (_event, intent) => { globalThis.__stage5Qa.deriveCalls.push(intent); return ['pet grooming wipes', 'Waterless Pet Shampoo', 'No Rinse Pet Cleanser', 'Waterless Pet Body Wash'] })
      replace('ai-employee:amazon-market-stats', () => [])
      replace('ai-employee:amazon-listing-evidence', () => [])
      replace('ai-employee:amazon-review-evidence', () => [])
      replace('ai-employee:ask', (_event, request) => {
        globalThis.__stage5Qa.asks.push(request.query)
        if (globalThis.__stage5Qa.asks.length === 1) return { ok: true, content: '# 宠物免洗擦浴精华 · Amazon美国站选品分析报告\n\n## 第一部分：本品基础信息解析\n- 产品形态：液体精华\n\n## 第二部分：Amazon 市场分析\n- 价格按系统 DIRECT 样本 P25/中位数/P75 表达\n- 月销量、销售额和趋势：待验证\n\n## 入场结论\n✅ 建议入场' }
        return { ok: true, content: '# 宠物免洗擦浴精华 · Amazon美国站选品分析报告\n\n## 第一部分：本品基础信息解析\n- 产品形态：液体精华\n\n- TOP50均价：$19.99\n- 月销量：12000\n\n✅ 建议入场' }
      })
    })
    await page.reload()
    await page.waitForTimeout(1200)
    if (await page.getByRole('button', { name: '登 录' }).count()) throw new Error('隔离会话未进入主界面')

    const saved = await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.save({ apiKey: 'stage5-key', site: 'US', pages: 2, maxSamples: 48, cacheHours: 12 }))
    assert('configuration-saved', saved.configured && saved.pages === 2 && saved.maxSamples === 48 && saved.cacheHours === 12, JSON.stringify(saved))
    const beforeCacheRequests = requests.length
    const firstSearch = await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.search('cache verification product'))
    const afterFirstSearchRequests = requests.length
    const secondSearch = await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.search('cache verification product'))
    assert('two-pages-and-limit', firstSearch.meta?.pagesRequested === 2 && firstSearch.meta?.pagesFetched === 2 && firstSearch.meta?.rawCount === 60 && firstSearch.meta?.uniqueCount === 48 && firstSearch.meta?.truncated === true, JSON.stringify(firstSearch.meta))
    assert('cross-page-dedupe', firstSearch.samples?.length === 48 && new Set(firstSearch.samples.map(item => item.asin)).size === 48, `samples=${firstSearch.samples?.length}`)
    assert('cache-hit-no-network', secondSearch.meta?.cacheHit === true && requests.length === afterFirstSearchRequests && afterFirstSearchRequests - beforeCacheRequests === 2, JSON.stringify(secondSearch.meta))
    assert('api-key-transmitted', requests.slice(beforeCacheRequests, afterFirstSearchRequests).every(item => item.apiKey === 'stage5-key'), JSON.stringify(requests.slice(beforeCacheRequests, afterFirstSearchRequests)))

    await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.save({ apiKey: 'stage5-key', site: 'US', pages: 2, maxSamples: 48, cacheHours: 12 }))
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '产品分析师' }).click()
    await page.getByText('已确认锁定', { exact: true }).waitFor()
    const textarea = page.locator('.ai-employee-floating-composer textarea[placeholder^="向 "]')
    await textarea.fill('请生成 Amazon 美国站完整选品报告')
    await page.getByRole('button', { name: '发送' }).click()
    await page.getByRole('region', { name: 'Amazon 样本可比性审计' }).waitFor({ timeout: 20000 })
    await page.waitForFunction(() => {
      const messages = [...document.querySelectorAll('.ai-employee-message.assistant')]
      const last = messages[messages.length - 1]
      return last && !last.querySelector('.typing')
    }, null, { timeout: 20000 })
    const firstAssistantText = (await page.locator('.ai-employee-message.assistant').last().innerText()).replace(/\s+/g, ' ')
    console.log(`STAGE5 UI: first assistant ${firstAssistantText.slice(0, 500)}`)
    const audit = page.getByRole('region', { name: 'Amazon 样本可比性审计' })
    const completeAuditText = (await audit.innerText()).replace(/\s+/g, ' ')
    assert('complete-audit-counts', /原始样本 54/.test(completeAuditText) && /自然位 48/.test(completeAuditText) && /赞助位 6/.test(completeAuditText) && /DIRECT 36/.test(completeAuditText) && /ADJACENT 6/.test(completeAuditText) && /已排除 6/.test(completeAuditText), completeAuditText)
    assert('decision-grade-coverage', completeAuditText.includes('样本完整率 100%') && completeAuditText.includes('检索词成功 3/3') && completeAuditText.includes('核心字段覆盖 100%') && completeAuditText.includes('结论置信度：可决策'), completeAuditText)
    const qaComplete = await app.evaluate(() => globalThis.__stage5Qa)
    assert('controlled-model-receives-readonly-fact-package', qaComplete.asks[0]?.includes('只读事实包') && qaComplete.asks[0]?.includes('listingEvidence'), '模型补充必须基于只读事实包，价格与门禁由确定性渲染器处理')
    assert('decision-grade-report-accepted', firstAssistantText.includes('Amazon美国站选品分析报告') && firstAssistantText.includes('本品自评') && firstAssistantText.includes('液体精华') && !firstAssistantText.includes('报告未通过正式报告质量校验'), firstAssistantText)
    assert('progress-cleared', await page.getByText(/正在依据本品身份锁|正在抓取 Amazon 市场样本/).count() === 0, '报告返回后无停滞进度')
    await page.screenshot({ path: path.join(outputDir, '01-decision-grade-completeness.png'), fullPage: true })

    serverMode = 'low'
    await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.save({ apiKey: 'stage5-key', site: 'US', pages: 2, maxSamples: 48, cacheHours: 12 }))
    await textarea.fill('请再生成一次，并根据当前样本下结论')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForFunction(() => {
      const region = document.querySelector('[aria-label="Amazon 样本可比性审计"]')
      return region && /原始样本\s*3/.test(region.textContent || '') && /样本完整率\s*33%/.test(region.textContent || '')
    }, null, { timeout: 20000 })
    await page.waitForFunction(() => {
      const messages = [...document.querySelectorAll('.ai-employee-message.assistant')]
      const last = messages[messages.length - 1]
      return messages.length >= 2 && last && !last.querySelector('.typing')
    }, null, { timeout: 20000 })
    const lowAuditText = (await audit.innerText()).replace(/\s+/g, ' ')
    assert('low-audit-visible', lowAuditText.includes('原始样本 3') && lowAuditText.includes('DIRECT 3') && lowAuditText.includes('样本完整率 33%') && lowAuditText.includes('核心字段覆盖 33%') && lowAuditText.includes('结论置信度：低'), lowAuditText)
    const assistantText = (await page.locator('.ai-employee-message.assistant').last().innerText()).replace(/\s+/g, ' ')
    assert('unsupported-market-claims-rejected', assistantText.includes('❓ 数据不足，不能判定') && !assistantText.includes('TOP50均价：$19.99') && !assistantText.includes('月销量：12000'), assistantText)
    await page.screenshot({ path: path.join(outputDir, '02-low-data-report-rejected.png'), fullPage: true })

    await page.setViewportSize({ width: 1100, height: 720 })
    await page.waitForTimeout(300)
    const layout = await audit.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, right: element.getBoundingClientRect().right, viewport: window.innerWidth }))
    assert('narrow-layout-no-overflow', layout.scrollWidth <= layout.width + 1 && layout.right <= layout.viewport + 1, JSON.stringify(layout))
    await page.screenshot({ path: path.join(outputDir, '03-narrow-layout.png'), fullPage: true })

    const indexHtml = fs.readFileSync(path.join(root, 'dist/renderer/index.html'), 'utf8')
    const expectedAssets = [...indexHtml.matchAll(/(?:src|href)="([^"]+\/assets\/[^"]+)"/g)].map(match => match[1])
    const loadedAssets = await page.evaluate(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(node => node.getAttribute('src') || node.getAttribute('href')).filter(Boolean))
    assert('latest-assets', expectedAssets.length === 2 && expectedAssets.every(asset => loadedAssets.includes(asset)), `实际加载 ${loadedAssets.join(', ')}`)
    const qa = await app.evaluate(() => globalThis.__stage5Qa)
    const report = { generatedAt: new Date().toISOString(), endpoint, expectedAssets, loadedAssets, checks, counters: { derive: qa.deriveCalls.length, ask: qa.asks.length, httpRequests: requests.length }, completeAuditText, lowAuditText, layout }
    fs.writeFileSync(path.join(outputDir, 'stage5-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await app.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { server.close(() => {}); console.error(error); process.exit(1) })
