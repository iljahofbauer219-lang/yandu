const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/stage7-amazon-live-source')
fs.mkdirSync(outputDir, { recursive: true })
const checks = []
const assert = (id, passed, detail) => {
  checks.push({ id, passed: Boolean(passed), detail })
  if (!passed) throw new Error(`${id}: ${detail}`)
}
const requests = []
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  requests.push({ query: url.searchParams.get('query') || '', page: url.searchParams.get('page') || '', hasApiKey: Boolean(request.headers['api-key']) })
  response.writeHead(503, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ detail: 'temporary upstream outage' }))
})

;(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const endpoint = `http://127.0.0.1:${server.address().port}/amazon/search`
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage7-amazon-failure-'))
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`, '.'],
    cwd: root,
    env: { ...process.env, CODEX_UI_TEST: '1', AMAZON_SCRAPER_API_URL: endpoint, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const qaProfile = { id: 'stage7-qa', email: 'stage7@example.test', name: '阶段7验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'stage7-org', name: '阶段7组织' }, roles: [], permissions: 'ALL', stores: null }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
    await page.evaluate(profile => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'stage7', refreshToken: 'stage7', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
      const now = new Date().toISOString()
      const info = {
        url: 'https://detail.1688.com/offer/stage7.html', analysisDate: '2026-08-10', title: '跨境猫狗通用宠物免洗擦拭精华清洁套装', price: '¥2.50', seller: '阶段7供应商',
        images: ['https://example.test/product.jpg'], detailText: '宠物液体免洗擦浴精华，挤出后擦浴清洁。', detailSource: '详情模块DOM', imageOcrText: 'PET WASH FREE SCRUB ESSENCE 30ml',
        visualProductForm: '液体精华', visualUseMethod: '免洗擦浴', visualTargetObject: '猫狗', visualConfidence: 96,
        confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '挤出液体后免洗擦浴', confirmedTargetObject: '猫狗', identityResolutionNote: '以包装出液口、详情说明和实物形态为准'
      }
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({ __draft__: { info, collapsed: false, confirmed: true, confirmedAt: now, updatedAt: now } }))
    }, qaProfile)
    await app.evaluate(({ ipcMain }) => {
      globalThis.__stage7Qa = { browserFallbacks: [], asks: [] }
      const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      replace('ai-employee:derive-amazon-keywords', () => ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash'])
      replace('ai-employee:amazon-market-stats', (_event, keyword) => { globalThis.__stage7Qa.browserFallbacks.push(keyword); return null })
      replace('ai-employee:ask', (_event, request) => {
        globalThis.__stage7Qa.asks.push(request.query)
        return { ok: true, content: '# 宠物免洗擦浴精华 · Amazon美国站选品分析报告\n\n## 第一部分：本品基础信息解析\n- 产品名称：宠物免洗擦浴精华\n- 产品形态：液体精华\n- 使用方式：挤出液体后免洗擦浴\n\n## 第二部分：Amazon 市场分析\n- 市场样本：待验证（U）\n- TOP50、月销量、销售额和趋势：数据不足，不能判定\n\n## 第三部分：竞品与差异化\n- 竞品样本：待验证\n\n## 第四部分：单位经济\n- 费用参数：待验证\n\n## 第五部分：合规与风险\n- 待验证\n\n## 第六部分：入场决策\n❓ 数据不足，不能判定\n\n补数任务：恢复 Amazon 数据源后重新抓取 3 个买家意图词，去重并区分 DIRECT、ADJACENT 和 NON_COMPARABLE。' }
      })
    })
    await page.reload()
    await page.waitForTimeout(1200)
    assert('authenticated-main-ui', await page.getByRole('button', { name: 'AI员工' }).count() === 1, '隔离会话已进入主界面')

    const saved = await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.save({ apiKey: 'stage7-test-key', site: 'US', pages: 1, maxSamples: 24, cacheHours: 1 }))
    assert('failure-config-saved', saved.configured && saved.pages === 1 && saved.maxSamples === 24, JSON.stringify(saved))
    const directFailure = await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.search('stage7 direct failure'))
    assert('http-503-surfaces-as-error', directFailure.samples === null && /HTTP 503/.test(directFailure.error || ''), JSON.stringify(directFailure))

    // 应用默认已在 AI员工入口；直接进入产品分析师工作台，避免侧栏菜单触发远程入口跳转。
    await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '产品分析师' }).click()
    await page.getByText('已确认锁定', { exact: true }).waitFor()
    const textarea = page.locator('.ai-employee-composer-body > textarea')
    await textarea.fill('请生成 Amazon 美国站完整选品报告')
    await page.getByRole('button', { name: '发送' }).click()
    const audit = page.getByRole('region', { name: 'Amazon 样本可比性审计' })
    await audit.waitFor({ timeout: 20000 })
    await page.waitForFunction(() => {
      const messages = [...document.querySelectorAll('.ai-employee-message.assistant')]
      const last = messages[messages.length - 1]
      return last && !last.querySelector('.typing')
    }, null, { timeout: 20000 })
    const auditText = (await audit.innerText()).replace(/\s+/g, ' ')
    const assistantText = (await page.locator('.ai-employee-message.assistant').last().innerText()).replace(/\s+/g, ' ')
    const qa = await app.evaluate(() => globalThis.__stage7Qa)
    assert('three-api-queries-attempted', requests.filter(item => item.query !== 'stage7 direct failure').length === 3 && requests.filter(item => item.query !== 'stage7 direct failure').every(item => item.hasApiKey), JSON.stringify(requests))
    assert('browser-fallback-after-api-failure', qa.browserFallbacks.length === 3, JSON.stringify(qa.browserFallbacks))
    assert('zero-sample-audit-visible', /原始样本 0/.test(auditText) && /检索词成功 0\/3/.test(auditText) && /结论置信度：低/.test(auditText), auditText)
    assert('zero-sample-gate-enters-model', qa.asks[0].includes('样本完整率：0%') && qa.asks[0].includes('研究样本基线未通过') && qa.asks[0].includes('❓ 数据不足，不能判定'), '低样本门禁已进入模型请求')
    assert('insufficient-data-report-accepted', assistantText.includes('❓ 数据不足，不能判定') && assistantText.includes('产品形态：液体精华') && !assistantText.includes('✅ 建议入场') && !assistantText.includes('报告未通过正式报告质量校验'), assistantText)
    assert('progress-cleared-after-report', await page.getByText(/正在依据本品身份锁|正在抓取 Amazon 市场样本/).count() === 0, '报告返回后无停滞进度')

    await page.setViewportSize({ width: 1100, height: 720 })
    const lastAssistant = page.locator('.ai-employee-message.assistant').last()
    await lastAssistant.locator('h1').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(outputDir, '02-live-source-failure-report-top.png') })
    await lastAssistant.locator('h2').filter({ hasText: '第六部分：入场决策' }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(outputDir, '03-live-source-failure-decision.png') })
    await audit.scrollIntoViewIfNeeded()
    await audit.screenshot({ path: path.join(outputDir, '04-live-source-failure-audit.png') })
    const indexHtml = fs.readFileSync(path.join(root, 'dist/renderer/index.html'), 'utf8')
    const expectedAssets = [...indexHtml.matchAll(/(?:src|href)="([^"]+\/assets\/[^"]+)"/g)].map(match => match[1])
    const loadedAssets = await page.evaluate(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(node => node.getAttribute('src') || node.getAttribute('href')).filter(Boolean))
    assert('latest-assets-loaded', expectedAssets.length === 2 && expectedAssets.every(asset => loadedAssets.includes(asset)), `实际加载 ${loadedAssets.join(', ')}`)
    const report = { generatedAt: new Date().toISOString(), endpoint, checks, requests, auditText, assistantText, expectedAssets, loadedAssets }
    fs.writeFileSync(path.join(outputDir, 'failure-ui-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await app.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { server.close(() => {}); console.error(error); process.exit(1) })
