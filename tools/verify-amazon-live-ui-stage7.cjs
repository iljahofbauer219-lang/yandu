const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
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

;(async () => {
  const sourceConfig = path.join(os.homedir(), 'Library/Application Support/cross-border-sourcing-desktop/amazon-data-source.json')
  if (!fs.existsSync(sourceConfig)) throw new Error('当前用户 Amazon 数据源配置不存在')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage7-amazon-live-ui-'))
  fs.copyFileSync(sourceConfig, path.join(userDataDir, 'amazon-data-source.json'))
  fs.chmodSync(path.join(userDataDir, 'amazon-data-source.json'), 0o600)
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const env = { ...process.env, CODEX_UI_TEST: '1', ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' }
  delete env.AMAZON_SCRAPER_API_URL
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${userDataDir}`, '.'], cwd: root, env })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const qaProfile = { id: 'stage7-live-qa', email: 'stage7-live@example.test', name: '阶段7真实源验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'stage7-live-org', name: '阶段7真实源组织' }, roles: [], permissions: 'ALL', stores: null }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
    await page.evaluate(profile => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'stage7-live', refreshToken: 'stage7-live', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
      const now = new Date().toISOString()
      const info = {
        url: 'https://detail.1688.com/offer/stage7-live.html', analysisDate: '2026-08-10', title: '跨境猫狗通用宠物免洗擦拭精华清洁套装', price: '¥2.50', seller: '阶段7供应商',
        images: ['https://example.test/product.jpg'], detailText: '宠物液体免洗擦浴精华，挤出后擦浴清洁。', detailSource: '详情模块DOM', imageOcrText: 'PET WASH FREE SCRUB ESSENCE 30ml',
        attributes: ['包装尺寸：10×8×2cm', '包装重量：40g'],
        visualProductForm: '液体精华', visualUseMethod: '免洗擦浴', visualTargetObject: '猫狗', visualConfidence: 96,
        confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '挤出液体后免洗擦浴', confirmedTargetObject: '猫狗', identityResolutionNote: '以包装出液口、详情说明和实物形态为准'
      }
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({ __draft__: { info, collapsed: false, confirmed: true, confirmedAt: now, updatedAt: now } }))
    }, qaProfile)
    await app.evaluate(({ ipcMain }) => {
      globalThis.__stage7LiveQa = { browserFallbacks: [], asks: [] }
      const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      replace('ai-employee:derive-amazon-keywords', () => ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash'])
      replace('ai-employee:amazon-market-stats', (_event, keyword) => { globalThis.__stage7LiveQa.browserFallbacks.push(keyword); return null })
      replace('ai-employee:ask', (_event, request) => {
        globalThis.__stage7LiveQa.asks.push(request.query)
        return { ok: true, content: '# 宠物免洗擦浴精华 · Amazon美国站选品分析报告\n\n## 第一部分：本品基础信息解析\n- 产品名称：宠物免洗擦浴精华\n- 产品形态：液体精华\n- 使用方式：挤出液体后免洗擦浴\n\n## 第二部分：Amazon 市场分析\n- 市场样本：以系统抓取并分类的 DIRECT 样本为准\n- 月销量、销售额和趋势：待验证（U）\n\n## 第三部分：竞品与差异化\n- 宠物湿巾只能作为 ADJACENT 替代方案，不回填本品形态。\n\n## 第四部分：单位经济\n- 未获得的 FBA 费用参数：待验证\n\n## 第五部分：合规与风险\n- 成分、标签与运输属性：待验证\n\n## 第六部分：入场决策\n❓ 数据不足，不能判定\n\n先补齐 FBA 费用、成分合规与供应链参数，再决定测试采购。' }
      })
    })
    await page.reload()
    await page.waitForTimeout(1200)
    assert('authenticated-main-ui', await page.getByRole('button', { name: 'AI员工' }).count() === 1, '隔离会话已进入主界面')
    const settings = await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.get())
    assert('copied-encrypted-config-active', settings.configured && settings.site === 'US', JSON.stringify(settings))
    // 应用默认已在 AI员工入口；直接进入产品分析师工作台，避免侧栏菜单触发远程入口跳转。
    await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '产品分析师' }).click()
    await page.getByText('已确认锁定', { exact: true }).waitFor()
    const textarea = page.locator('.ai-employee-composer-body > textarea')
    // 回归：曾选择 eBay 后再明确要求 Amazon，Amazon 事实块必须锁定本次报告平台。
    await page.getByRole('button', { name: 'eBay' }).click()
    await textarea.fill('请生成 Amazon 美国站完整选品报告')
    await page.getByRole('button', { name: '发送' }).click()
    const audit = page.getByRole('region', { name: 'Amazon 样本可比性审计' })
    await audit.waitFor({ timeout: 60000 })
    await page.waitForFunction(() => {
      const messages = [...document.querySelectorAll('.ai-employee-message.assistant')]
      const last = messages[messages.length - 1]
      return last && !last.querySelector('.typing')
    }, null, { timeout: 60000 })
    const auditText = (await audit.innerText()).replace(/\s+/g, ' ')
    const assistantText = (await page.locator('.ai-employee-message.assistant').last().innerText()).replace(/\s+/g, ' ')
    const qa = await app.evaluate(() => globalThis.__stage7LiveQa)
    const numberAfter = label => Number(auditText.match(new RegExp(`${label}\\s*(\\d+)`))?.[1] || 0)
    const raw = numberAfter('原始样本')
    const unique = numberAfter('ASIN 去重')
    const direct = numberAfter('DIRECT')
    const adjacent = numberAfter('ADJACENT')
    const excluded = numberAfter('已排除')
    assert('three-live-keywords-succeeded', /检索词成功 3\/3/.test(auditText) && raw >= 60, auditText)
    assert('live-samples-classified', direct > 0 && unique > 0 && unique <= raw && direct + adjacent + excluded <= unique, `raw=${raw},unique=${unique},direct=${direct},adjacent=${adjacent},excluded=${excluded}`)
    assert('adjacent-or-excluded-separated', adjacent + excluded > 0, `adjacent=${adjacent},excluded=${excluded}`)
    assert('browser-supplement-after-live-api', qa.browserFallbacks.length === 3, JSON.stringify(qa.browserFallbacks))
    assert('live-facts-enter-model', qa.asks[0].includes('DIRECT直接竞品') && qa.asks[0].includes('ADJACENT替代方案') && qa.asks[0].includes('ASIN去重'), '真实样本分类与去重已进入模型请求')
    assert('amazon-platform-lock-overrides-stale-chip', qa.asks[0].includes('目标平台：Amazon美国站') && !qa.asks[0].includes('目标平台：eBay'), 'Amazon 市场事实块使用唯一目标平台')
    assert('identity-preserved-in-report', assistantText.includes('宠物免洗擦浴精华 · Amazon美国站选品分析报告') && assistantText.includes('产品形态：液体精华') && assistantText.includes('宠物湿巾只能作为 ADJACENT') && !assistantText.includes('报告未通过正式报告质量校验'), assistantText)
    assert('progress-cleared-after-live-report', await page.getByText(/正在依据本品身份锁|正在抓取 Amazon 市场样本/).count() === 0, '报告返回后无停滞进度')
    await page.setViewportSize({ width: 1100, height: 720 })
    const lastAssistant = page.locator('.ai-employee-message.assistant').last()
    await lastAssistant.locator('h1').first().scrollIntoViewIfNeeded()
    await page.screenshot({ path: path.join(outputDir, '05-live-report-title.png') })
    await audit.scrollIntoViewIfNeeded()
    await audit.screenshot({ path: path.join(outputDir, '06-live-sample-audit.png') })
    const indexHtml = fs.readFileSync(path.join(root, 'dist/renderer/index.html'), 'utf8')
    const expectedAssets = [...indexHtml.matchAll(/(?:src|href)="([^"]+\/assets\/[^"]+)"/g)].map(match => match[1])
    const loadedAssets = await page.evaluate(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(node => node.getAttribute('src') || node.getAttribute('href')).filter(Boolean))
    assert('latest-assets-loaded', expectedAssets.length === 2 && expectedAssets.every(asset => loadedAssets.includes(asset)), `实际加载 ${loadedAssets.join(', ')}`)
    const report = { generatedAt: new Date().toISOString(), settings, checks, auditText, assistantText, expectedAssets, loadedAssets }
    fs.writeFileSync(path.join(outputDir, 'live-ui-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await app.close()
  }
})().catch(error => { console.error(error); process.exit(1) })
