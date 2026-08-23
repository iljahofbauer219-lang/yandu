const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/amazon-listing-evidence')
fs.mkdirSync(outputDir, { recursive: true })
const checks = []
const assert = (id, passed, detail = '') => { checks.push({ id, passed, detail }); if (!passed) throw new Error(`${id}: ${detail}`) }
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ data: [] }))
})

;(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'amazon-listing-evidence-'))
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: root, env: { ...process.env, AMAZON_SCRAPER_API_URL: `http://127.0.0.1:${server.address().port}/amazon/search`, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const profile = { id: 'listing-evidence', email: 'listing@example.test', name: '详情页验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'listing-org', name: '详情页验收组织' }, roles: [], permissions: 'ALL', stores: null }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }))
    await page.evaluate(value => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'listing', refreshToken: 'listing', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(value))
      const now = new Date().toISOString()
      const info = { url: 'https://detail.1688.com/offer/listing.html', analysisDate: '2026-08-18', title: '宠物苦苹果喷雾', price: '¥6.50', detailText: '液体喷雾，适用于猫狗。', detailSource: '1688详情页', visualProductForm: '喷雾', visualUseMethod: '喷洒', visualTargetObject: '猫狗', visualConfidence: 96, confirmedProductName: '宠物苦苹果喷雾', confirmedProductForm: '喷雾', confirmedUseMethod: '喷洒', confirmedTargetObject: '猫狗', identityResolutionNote: '详情页确认' }
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({ __draft__: { info, collapsed: false, confirmed: true, confirmedAt: now, updatedAt: now } }))
    }, profile)
    await app.evaluate(({ ipcMain }) => {
      const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      replace('ai-employee:derive-amazon-keywords', () => ['pet bitter apple spray', 'pet anti chew spray', 'animal biting deterrent spray'])
      replace('ai-employee:amazon-market-stats', (_event, keyword) => Array.from({ length: 18 }, (_, index) => ({ asin: `B0A${keyword.length}${String(index).padStart(6, '0')}`.slice(0, 10), title: `Pet Bitter Apple Spray for Dogs and Cats ${index}`, price: 12 + index, rating: 4.4, reviews: 100 + index, query: keyword, source: 'browser' })))
      replace('ai-employee:amazon-listing-evidence', (_event, asins) => asins.slice(0, 5).map((asin, index) => ({ asin, url: `https://www.amazon.com/dp/${asin}`, capturedAt: '2026-08-18T08:00:00.000Z', source: 'browser', title: `Verified Bitter Apple Spray ${index}`, brand: `Verified Brand ${index}`, price: 14.99 + index, rating: 4.7, reviews: 500 + index, bsr: `#${index + 1} in Pet Supplies`, badges: ["Amazon's Choice"], bulletPoints: ['Bitter taste deterrent for dogs and cats', 'Spray bottle for easy training'], coupon: 'Save 10%', subscribeSave: null, variantSummary: 'Size: 8 fl oz', seller: 'Amazon.com', operations: ['优惠券：Save 10%', '变体：Size: 8 fl oz'] })))
      replace('ai-employee:amazon-review-evidence', (_event, asins) => asins.slice(0, 5).map((asin, index) => ({ asin, url: `https://www.amazon.com/product-reviews/${asin}?pageNumber=1`, capturedAt: '2026-08-18T08:00:00.000Z', source: 'browser', snippets: [{ rating: 4, title: `Visible review ${index}`, body: `Visible review body ${index}` }] })))
      replace('ai-employee:ask', () => ({ ok: true, content: JSON.stringify({ hypotheses: [], validationTasks: [], listingInsights: [{ asin: 'B0A2200000', observation: '页面同时呈现苦味喷雾、优惠券与8盎司变体。', learning: '验证小规格喷雾叠加优惠机制的转化表现。' }], improvementInsights: [{ direction: '规格/SKU拓展', proposal: '验证8盎司与小规格组合的测试方案。', asins: ['B0A2200000'] }] }) }))
    })
    await page.reload()
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '产品分析师' }).click()
    await page.getByText('已确认锁定', { exact: true }).waitFor()
    await page.locator('.ai-employee-floating-composer textarea[placeholder^="向 "]').fill('请生成 Amazon 美国站完整报告')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForFunction(() => document.querySelectorAll('.ai-employee-message.assistant').length > 0, null, { timeout: 30000 })
    const assistant = page.locator('.ai-employee-message.assistant').last()
    const text = await assistant.innerText()
    assert('报告仍显示Amazon美国站标题', text.includes('宠物苦苹果喷雾 · Amazon美国站选品分析报告'), text.slice(0, 250))
    assert('报告保留固定十一张表', await assistant.locator('table').count() === 11, `tables=${await assistant.locator('table').count()}`)
    assert('头部竞店表显示五条详情页证据', (text.match(/Verified Brand/g) || []).length === 5, text)
    assert('页面显示详情页品牌价格评分卖点与运营动作', text.includes('Verified Bitter Apple Spray') && text.includes('$14.99') && text.includes('4.7/500') && text.includes('Bitter taste deterrent') && text.includes('优惠券：Save 10%'), text)
    assert('页面显示详情页来源URL和采集日期', text.includes('https://www.amazon.com/dp/') && text.includes('2026-08-18'), text)
    assert('页面显示评论页原文样本、来源和非外推说明', text.includes('评论样本：Visible review 0 Visible review body 0') && text.includes('https://www.amazon.com/product-reviews/') && text.includes('不得外推为高频结论'), text)
    assert('页面要素归纳仅附加到已采集ASIN且保留待验证标记', text.includes('页面要素归纳（待验证）：页面同时呈现苦味喷雾、优惠券与8盎司变体。') && text.includes('验证小规格喷雾叠加优惠机制的转化表现。'), text)
    assert('6.1改良表显示受控方案且不伪造成本和效果', text.includes('页面要素归纳（待验证）：验证8盎司与小规格组合的测试方案。') && text.includes('DIRECT详情页：B0A2200000') && text.includes('待小批量验证'), text)
    const indexHtml = fs.readFileSync(path.join(root, 'dist/renderer/index.html'), 'utf8')
    const expectedAssets = [...indexHtml.matchAll(/(?:src|href)="([^"]+\/assets\/[^\"]+)"/g)].map(match => match[1])
    const loadedAssets = await page.evaluate(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(node => node.getAttribute('src') || node.getAttribute('href')).filter(Boolean))
    assert('Electron加载最新生产资源', expectedAssets.length === 2 && expectedAssets.every(asset => loadedAssets.includes(asset)), `expected=${expectedAssets.join(',')}; loaded=${loadedAssets.join(',')}`)
    await page.screenshot({ path: path.join(outputDir, '01-listing-evidence-report.png'), fullPage: true })
    console.log(JSON.stringify({ checks }, null, 2))
  } finally {
    await app.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { server.close(() => {}); console.error(error); process.exit(1) })
