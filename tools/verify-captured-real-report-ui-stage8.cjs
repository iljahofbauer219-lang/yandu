const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/stage8-real-ragflow-report')
const reportPath = path.join(outputDir, 'actual-ragflow-report.md')
const correctionMarker = '> 系统质量修正：未抓取或无法复算的字段已降级为“待验证”；未新增任何事实。'
const capturedReport = fs.readFileSync(reportPath, 'utf8').replace(new RegExp(`(?:${correctionMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*){2,}`, 'g'), correctionMarker)
const preSanitizerPath = path.join(outputDir, 'actual-ragflow-report-pre-final-sanitizer.md')
if (!fs.existsSync(preSanitizerPath)) fs.writeFileSync(preSanitizerPath, capturedReport)
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage8-captured-report-'))
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: root, env: { ...process.env, AMAZON_SCRAPER_API_URL: endpoint, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const profile = { id: 'stage8-captured', email: 'stage8-captured@example.test', name: '阶段8真实报告终验', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'stage8-org', name: '阶段8组织' }, roles: [], permissions: 'ALL', stores: null }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }))
    await page.evaluate(value => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'stage8', refreshToken: 'stage8', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(value))
      const now = new Date().toISOString()
      const info = {
        url: 'https://detail.1688.com/offer/1006746849261.html', analysisDate: '2026-08-10', title: '跨境猫狗通用宠物免洗擦拭精华清洁套装宠物免水洗除臭留香定制', price: '¥2.50', seller: '广州宠本生物科技有限公司', images: ['https://example.test/product.jpg'],
        detailText: '宠物液体免洗擦浴精华，30ml一袋，挤出液体后擦浴清洁，适用猫狗。', detailSource: '详情模块DOM', imageOcrText: 'PET WASH FREE SCRUB ESSENCE 30ml', visualProductForm: '液体精华', visualUseMethod: '免洗擦浴', visualTargetObject: '猫狗', visualConfidence: 96,
        confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '挤出液体后免洗擦浴', confirmedTargetObject: '猫狗', identityResolutionNote: '以包装出液口、详情说明和实物形态为准', attributes: ['规格：30ml一袋', '品牌：其他']
      }
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({ __draft__: { info, collapsed: false, confirmed: true, confirmedAt: now, updatedAt: now } }))
    }, profile)
    await app.evaluate(({ ipcMain }, content) => {
      globalThis.__stage8CapturedQa = { asks: [] }
      const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      replace('ai-employee:derive-amazon-keywords', () => ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash'])
      replace('ai-employee:ask', (_event, request) => {
        globalThis.__stage8CapturedQa.asks.push(request.query)
        return { ok: true, content }
      })
    }, capturedReport)
    await page.reload()
    await page.waitForTimeout(1000)
    await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.save({ apiKey: 'stage8-captured', site: 'US', pages: 1, maxSamples: 24, cacheHours: 1 }))
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '选品分析师' }).click()
    await page.getByText('已确认锁定', { exact: true }).waitFor()
    await page.locator('.ai-employee-floating-composer textarea').fill('请生成 Amazon 美国站完整报告')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForFunction(() => {
      const last = [...document.querySelectorAll('.ai-employee-message.assistant')].at(-1)
      return last && !last.querySelector('.typing')
    }, null, { timeout: 60000 })
    const qa = await app.evaluate(() => globalThis.__stage8CapturedQa)
    const message = page.locator('.ai-employee-message.assistant').last()
    const text = (await message.innerText()).replace(/\s+/g, ' ')
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem('yd.aiEmployee.history') || '[]'))
    const latest = history.find(item => item.roleName === '选品分析师')
    const finalMarkdown = String([...(latest?.messages || [])].reverse().find(item => item.role === 'assistant')?.content || '')
    fs.writeFileSync(reportPath, finalMarkdown)

    assert('captured-real-report-replayed', qa.asks.length >= 1 && qa.asks.length <= 3, `asks=${qa.asks.length}`)
    assert('formal-report-accepted', !text.includes('报告未通过正式报告质量校验') && finalMarkdown.length > 9000, `length=${finalMarkdown.length}`)
    assert('identity-title-correct', finalMarkdown.startsWith('# 宠物免洗擦浴精华 · Amazon美国站选品分析报告'), finalMarkdown.slice(0, 80))
    assert('unsupported-risk-redacted', !finalMarkdown.includes("Vet's Best发起专利投诉") && /风险预警\s*\|\s*待验证/.test(finalMarkdown), '专利投诉和监管新规已降级')
    assert('data-insufficient-selected', /❓\s*数据不足，不能判定\s*\|\s*是/.test(finalMarkdown), '缺包装尺寸和毛重时未输出正向入场')
    assert('transparent-system-correction', finalMarkdown.includes('系统质量修正'), '报告标记确定性降级')

    await message.scrollIntoViewIfNeeded()
    const actionText = (await message.locator('.ai-markdown-answer-actions').innerText()).replace(/\s+/g, ' ')
    assert('report-actions-visible', actionText.includes('复制回答') && actionText.includes('转为文档编辑') && actionText.includes('更多'), actionText)
    await page.screenshot({ path: path.join(outputDir, '02-captured-real-report-actions.png') })
    await message.getByRole('button', { name: /转为文档编辑/ }).click()
    const documentCard = page.locator('.ai-markdown-document-card').last()
    await documentCard.waitFor({ timeout: 15000 })
    assert('convert-to-document-operable', await documentCard.isVisible(), '真实报告已生成文档卡片')
    await documentCard.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await page.screenshot({ path: path.join(outputDir, '03-captured-real-report-document.png') })

    const expectedAssets = fs.readFileSync(path.join(root, 'dist/renderer/index.html'), 'utf8').match(/(?:src|href)="([^"]+\.(?:js|css))"/g)?.map(value => value.match(/"([^"]+)"/)?.[1]).filter(Boolean) || []
    const loadedAssets = await page.evaluate(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(element => element.getAttribute('src') || element.getAttribute('href')).filter(Boolean))
    assert('latest-assets-loaded', expectedAssets.every(asset => loadedAssets.includes(asset)), `expected=${expectedAssets.join(',')} loaded=${loadedAssets.join(',')}`)

    const report = { generatedAt: new Date().toISOString(), source: 'captured real RAGFlow report', checks, askCount: qa.asks.length, rawLength: finalMarkdown.length, expectedAssets, loadedAssets }
    fs.writeFileSync(path.join(outputDir, 'captured-real-report-ui-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await app.close()
    await new Promise(resolve => server.close(resolve))
  }
})().catch(error => { server.close(() => {}); console.error(error); process.exit(1) })
