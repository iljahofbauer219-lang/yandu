const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const http = require('node:http')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/stage9-packaged-production')
const executablePath = path.join(root, 'release/mac/砚都跨境.app/Contents/MacOS/砚都跨境')
const reportPath = path.join(root, 'output/playwright/stage8-real-ragflow-report/actual-ragflow-report.md')
const capturedReport = fs.readFileSync(reportPath, 'utf8')
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-stage9-packaged-'))
const editorMarker = '阶段9打包应用编辑与持久化验收。'
const checks = []
const assert = (id, passed, detail) => {
  checks.push({ id, passed: Boolean(passed), detail })
  if (!passed) throw new Error(`${id}: ${detail}`)
}

fs.mkdirSync(outputDir, { recursive: true })

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  const query = url.searchParams.get('query') || 'query'
  const prefix = Buffer.from(query).toString('hex').slice(0, 4).toUpperCase()
  const results = Array.from({ length: 12 }, (_, index) => ({
    asin: `${prefix}${String(index).padStart(6, '0')}`.slice(0, 10),
    title: `Waterless Pet Shampoo No Rinse Body Cleanser for Dogs and Cats ${index}`,
    price: `$${12 + index}.99`,
    rating: '4.5',
    ratings_total: String(300 + index)
  }))
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ results }))
})

const profile = {
  id: 'stage9-packaged', email: 'stage9-packaged@example.test', name: '阶段9打包应用终验',
  isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'stage9-org', name: '阶段9组织' }, roles: [], permissions: 'ALL', stores: null
}

const extractedInfo = {
  url: 'https://detail.1688.com/offer/1006746849261.html',
  analysisDate: '2026-08-10',
  title: '跨境猫狗通用宠物免洗擦拭精华清洁套装宠物免水洗除臭留香定制',
  price: '¥2.50', seller: '广州宠本生物科技有限公司',
  images: ['https://example.test/product.jpg'],
  detailText: '宠物液体免洗擦浴精华，30ml一袋，挤出液体后擦浴清洁，适用猫狗。',
  detailSource: '详情模块DOM', imageOcrText: 'PET WASH FREE SCRUB ESSENCE 30ml',
  visualProductForm: '液体精华', visualUseMethod: '免洗擦浴', visualTargetObject: '猫狗', visualConfidence: 96,
  confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华',
  confirmedUseMethod: '挤出液体后免洗擦浴', confirmedTargetObject: '猫狗',
  identityResolutionNote: '以包装出液口、详情说明和实物形态为准',
  attributes: ['规格：30ml一袋', '品牌：其他']
}

async function launchPackaged(endpoint, includeReport) {
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`],
    cwd: root,
    env: { ...process.env, AMAZON_SCRAPER_API_URL: endpoint, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }))
  await app.evaluate(({ ipcMain }, payload) => {
    globalThis.__stage9PackagedQa = { asks: [], exports: [] }
    const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
    replace('ai-employee:derive-amazon-keywords', () => ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash'])
    replace('ai-employee:ask', (_event, request) => {
      globalThis.__stage9PackagedQa.asks.push(request.query)
      return { ok: true, content: payload.report || '# 未配置报告' }
    })
    replace('listing:export', (_event, request) => {
      globalThis.__stage9PackagedQa.exports.push(request)
      return { canceled: false, filePath: `/tmp/stage9-packaged-report.${request.format === 'word' ? 'docx' : 'md'}` }
    })
  }, { report: includeReport ? capturedReport : '' })
  return { app, page }
}

async function openSelectionAnalyst(page) {
  await page.getByRole('button', { name: 'AI员工' }).click()
  await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '选品分析师' }).click()
}

;(async () => {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const endpoint = `http://127.0.0.1:${server.address().port}/amazon/search`

  let first
  try {
    first = await launchPackaged(endpoint, true)
    const { app, page } = first
    const packageState = await app.evaluate(({ app }) => ({ isPackaged: app.isPackaged, version: app.getVersion(), appPath: app.getAppPath() }))
    assert('packaged-runtime', packageState.isPackaged && packageState.appPath.endsWith('app.asar'), JSON.stringify(packageState))
    assert('packaged-version', packageState.version === '1.0.12', `version=${packageState.version}`)

    await page.evaluate(({ value, info }) => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'stage9', refreshToken: 'stage9', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(value))
      const now = new Date().toISOString()
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({ __draft__: { info, collapsed: false, confirmed: true, confirmedAt: now, updatedAt: now } }))
      localStorage.setItem('yd.stage9.packaged.sentinel', 'preserve-me')
    }, { value: profile, info: extractedInfo })
    await page.reload()
    await page.waitForTimeout(1000)
    await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.save({ apiKey: 'stage9-packaged', site: 'US', pages: 1, maxSamples: 24, cacheHours: 1 }))
    await openSelectionAnalyst(page)
    await page.getByText('已确认锁定', { exact: true }).waitFor()
    await page.locator('.ai-employee-floating-composer textarea').fill('请生成 Amazon 美国站完整报告')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForFunction(() => {
      const last = [...document.querySelectorAll('.ai-employee-message.assistant')].at(-1)
      return last && !last.querySelector('.typing')
    }, null, { timeout: 60000 })

    const message = page.locator('.ai-employee-message.assistant').last()
    const answerText = (await message.innerText()).replace(/\s+/g, ' ')
    assert('identity-title-visible', answerText.includes('宠物免洗擦浴精华 · Amazon美国站选品分析报告'), answerText.slice(0, 160))
    assert('formal-report-visible', !answerText.includes('报告未通过正式报告质量校验'), '正式报告通过身份与质量门禁')
    const actions = (await message.locator('.ai-markdown-answer-actions').innerText()).replace(/\s+/g, ' ')
    assert('report-actions-visible', actions.includes('复制回答') && actions.includes('转为文档编辑') && actions.includes('更多'), actions)
    await message.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(outputDir, '01-packaged-report-actions.png') })

    await message.getByRole('button', { name: /转为文档编辑/ }).click()
    const documentCard = message.getByRole('region', { name: '已生成的报告文档' })
    await documentCard.waitFor({ timeout: 15000 })
    const editor = documentCard.getByRole('textbox', { name: '报告文档编辑区' })
    await editor.fill(`${await editor.inputValue()}\n\n${editorMarker}`)
    await message.getByRole('status').filter({ hasText: '已自动保存' }).waitFor()
    await documentCard.getByRole('button', { name: '下载 Word' }).click()
    await message.getByRole('status').filter({ hasText: 'stage9-packaged-report.docx' }).waitFor()
    const prompts = documentCard.locator('.ai-markdown-document-prompts button')
    const promptCount = await prompts.count()
    const selectedPrompt = (await prompts.first().innerText()).replace(/\s*→\s*$/, '').trim()
    assert('document-prompts-valuable', promptCount >= 3 && /待验证|竞品|利润|合规|验证计划/.test(selectedPrompt), `count=${promptCount} first=${selectedPrompt}`)
    await prompts.first().click()
    assert('document-prompt-fills-composer', (await page.locator('.ai-employee-floating-composer textarea').inputValue()).includes(selectedPrompt), '提问建议已回填')
    await documentCard.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(outputDir, '02-packaged-document-edit.png') })

    const expectedAssets = fs.readFileSync(path.join(root, 'dist/renderer/index.html'), 'utf8').match(/(?:src|href)="([^"]+\.(?:js|css))"/g)?.map(value => value.match(/"([^"]+)"/)?.[1]).filter(Boolean) || []
    const loadedAssets = await page.evaluate(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(element => element.getAttribute('src') || element.getAttribute('href')).filter(Boolean))
    assert('packaged-latest-assets-loaded', expectedAssets.length === 2 && expectedAssets.every(asset => loadedAssets.includes(asset)), `expected=${expectedAssets.join(',')} loaded=${loadedAssets.join(',')}`)
    const firstQa = await app.evaluate(() => globalThis.__stage9PackagedQa)
    assert('packaged-ipc-flow', firstQa.asks.length >= 1 && firstQa.asks.length <= 3 && firstQa.exports.length === 1, `asks=${firstQa.asks.length} exports=${firstQa.exports.length}`)
  } finally {
    if (first?.app) await first.app.close()
  }

  let second
  try {
    second = await launchPackaged(endpoint, false)
    const { page } = second
    await page.reload()
    await page.waitForTimeout(800)
    const persisted = await page.evaluate(marker => ({
      sentinel: localStorage.getItem('yd.stage9.packaged.sentinel'),
      history: localStorage.getItem('yd.aiEmployee.history') || '',
      extracted: localStorage.getItem('yd.aiEmployee.extractedByConversation:v1') || '',
      documents: Object.entries(localStorage).filter(([key]) => key.startsWith('yd.aiEmployee.document:')).map(([key, value]) => ({ key, value }))
    }), editorMarker)
    assert('isolated-user-data-preserved', persisted.sentinel === 'preserve-me', `sentinel=${persisted.sentinel}`)
    assert('extracted-facts-preserved', persisted.extracted.includes('宠物免洗擦浴精华') && persisted.extracted.includes('液体精华'), `extractedLength=${persisted.extracted.length}`)
    assert('report-history-preserved', persisted.history.includes('宠物免洗擦浴精华'), `historyLength=${persisted.history.length}`)
    assert('document-edit-preserved', persisted.documents.some(item => item.value.includes(editorMarker)), `documentKeys=${persisted.documents.length}`)

    await openSelectionAnalyst(page)
    await page.getByRole('button', { name: '工作档案' }).click()
    const archivedReport = page.locator('.ai-employee-history-main').first()
    await archivedReport.waitFor()
    await archivedReport.click()
    const restoredMessage = page.locator('.ai-employee-message.assistant').last()
    await restoredMessage.waitFor()
    const restoredText = (await restoredMessage.innerText()).replace(/\s+/g, ' ')
    assert('archived-report-restored-in-ui', restoredText.includes('宠物免洗擦浴精华 · Amazon美国站选品分析报告'), restoredText.slice(0, 220))
    await restoredMessage.getByRole('button', { name: /转为文档编辑/ }).click()
    const restoredEditor = restoredMessage.getByRole('textbox', { name: '报告文档编辑区' })
    await restoredEditor.waitFor()
    assert('document-edit-restored-in-ui', (await restoredEditor.inputValue()).includes(editorMarker), '重启后编辑内容已恢复到界面')
    await restoredEditor.scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(outputDir, '03-packaged-restart-restored.png') })
  } finally {
    if (second?.app) await second.app.close()
    await new Promise(resolve => server.close(resolve))
  }

  const report = {
    generatedAt: new Date().toISOString(),
    packageVersion: '1.0.12',
    executablePath,
    isolatedUserDataDir: userDataDir,
    checks,
    passed: checks.filter(item => item.passed).length,
    total: checks.length
  }
  fs.writeFileSync(path.join(outputDir, 'stage9-packaged-ui-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
})().catch(error => { server.close(() => {}); console.error(error); process.exit(1) })
