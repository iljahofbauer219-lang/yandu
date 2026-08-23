const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const fs = require('node:fs')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/stage5-deterministic-report')
fs.mkdirSync(outputDir, { recursive: true })
const checks = []
const assert = (id, passed, detail = '') => { checks.push({ id, passed, detail }); if (!passed) throw new Error(`${id}: ${detail}`) }
const server = http.createServer((request, response) => {
  const results = Array.from({ length: 18 }, (_, index) => ({
    asin: `TST${String(index).padStart(7, '0')}`,
    title: `Waterless Pet Shampoo No Rinse Cleanser for Dogs and Cats ${index}`,
    price: `$${12 + index}.99`, rating: '4.5', ratings_total: String(200 + index)
  }))
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ results }))
})

;(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const endpoint = `http://127.0.0.1:${server.address().port}/amazon/search`
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage5-render-'))
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: root, env: { ...process.env, AMAZON_SCRAPER_API_URL: endpoint, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const profile = { id: 'stage5-render', email: 'stage5@example.test', name: '阶段5验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'stage5-org', name: '阶段5组织' }, roles: [], permissions: 'ALL', stores: null }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }))
    await page.evaluate(value => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'stage5', refreshToken: 'stage5', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(value))
      const now = new Date().toISOString()
      const info = { url: 'https://detail.1688.com/offer/stage5.html', analysisDate: '2026-08-18', title: '宠物免洗擦浴精华', price: '¥6.50', seller: '阶段5供应商', detailText: '液体免洗擦浴精华，30ml。', detailSource: '详情页', visualProductForm: '液体精华', visualUseMethod: '免洗擦浴', visualTargetObject: '猫狗', visualConfidence: 96, confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '免洗擦浴', confirmedTargetObject: '猫狗', identityResolutionNote: '以详情与图片为准' }
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({ __draft__: { info, collapsed: false, confirmed: true, confirmedAt: now, updatedAt: now } }))
    }, profile)
    await app.evaluate(({ ipcMain }) => {
      globalThis.__stage5RendererQa = { asks: 0, starts: [] }
      const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      replace('ai-employee:derive-amazon-keywords', () => ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash'])
      replace('ai-employee:ask', (_event, request) => {
        globalThis.__stage5RendererQa.asks += 1
        globalThis.__stage5RendererQa.starts.push({ modelId: request.modelId, at: Date.now() })
        const delay = request.modelId === 'amazon-skills-agent' ? 5 : 180
        return new Promise(resolve => setTimeout(() => resolve({ ok: true, content: '不应调用模型' }), delay))
      })
    })
    await page.reload()
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '产品分析师' }).click()
    await page.getByText('已确认锁定', { exact: true }).waitFor()
    await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.save({ apiKey: 'stage5-key', site: 'US', pages: 1, maxSamples: 24, cacheHours: 1 }))
    await page.locator('.ai-employee-floating-composer textarea[placeholder^="向 "]').fill('请生成 Amazon 美国站完整报告')
    await page.getByRole('button', { name: '发送' }).click()
    await page.getByText('宠物免洗擦浴精华 · Amazon美国站选品分析报告', { exact: false }).waitFor({ timeout: 30000 })
    const assistant = page.locator('.ai-employee-message.assistant').last()
    const text = await assistant.innerText()
    const tableCount = await assistant.locator('table').count()
    const qa = await app.evaluate(() => globalThis.__stage5RendererQa)
    assert('deterministic-title', text.includes('宠物免洗擦浴精华 · Amazon美国站选品分析报告'), text.slice(0, 300))
    assert('all-template-sections-visible', ['第一部分：本品基础信息解析', '第二部分：目标平台细分市场大盘调研', '第三部分：本品与核心竞品多维对比', '第四部分：头部竞店竞争实力拆解', '第五部分：入市机会与盈利可行性判定', '第六部分：产品改良方案与长期市场机会'].every(section => text.includes(section)), text)
    assert('eleven-native-tables-visible', tableCount === 11, `tables=${tableCount}`)
    assert('invalid-model-output-falls-back-to-base-report', qa.asks >= 1 && !text.includes('受控分析补充'), `asks=${qa.asks}`)
    const repairStarts = qa.starts.filter(item => item.modelId !== 'amazon-skills-agent').map(item => item.at)
    assert('repair-models-run-in-parallel-after-primary-failure', repairStarts.length === 3 && Math.max(...repairStarts) - Math.min(...repairStarts) < 80, JSON.stringify(qa.starts))
    await page.getByRole('button', { name: '工作档案', exact: true }).click()
    const archiveItem = page.locator('.ai-employee-history-main').filter({ hasText: '宠物免洗擦浴精华 · Amazon美国站选品分析报告' })
    await archiveItem.waitFor()
    assert('report-persisted-to-work-archive', await archiveItem.count() === 1, `archiveItems=${await archiveItem.count()}`)
    await page.screenshot({ path: path.join(outputDir, '01-deterministic-report.png'), fullPage: true })
    console.log(JSON.stringify({ checks, tableCount, askCount: qa.asks }, null, 2))
  } finally {
    await app.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { server.close(() => {}); console.error(error); process.exit(1) })
