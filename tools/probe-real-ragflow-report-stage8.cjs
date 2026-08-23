const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/stage8-real-ragflow-report')
fs.mkdirSync(outputDir, { recursive: true })

;(async () => {
  const sourceUserData = path.join(os.homedir(), 'Library/Application Support/cross-border-sourcing-desktop')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage8-real-ragflow-'))
  for (const file of ['amazon-data-source.json', 'server-config.json']) {
    const source = path.join(sourceUserData, file)
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(userDataDir, file))
  }
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' }
  delete env.AMAZON_SCRAPER_API_URL
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: root, env })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const qaProfile = { id: 'stage8-real', email: 'stage8-real@example.test', name: '阶段8真实智能体', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'stage8-org', name: '阶段8隔离组织' }, roles: [], permissions: 'ALL', stores: null }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
    await page.evaluate(profile => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'stage8', refreshToken: 'stage8', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
      localStorage.setItem('yd.aiEmployee.chatModel:选品分析师', 'ragflow-agent')
      const now = new Date().toISOString()
      const info = {
        url: 'https://detail.1688.com/offer/1006746849261.html', analysisDate: '2026-08-10', title: '跨境猫狗通用宠物免洗擦拭精华清洁套装宠物免水洗除臭留香定制', price: '¥2.50', seller: '广州宠本生物科技有限公司', moq: '待验证', shipFrom: '广东',
        images: ['https://example.test/product.jpg'], detailText: '宠物液体免洗擦浴精华，30ml一袋，挤出液体后擦浴清洁，适用猫狗。', detailSource: '详情模块DOM', imageOcrText: 'PET WASH FREE SCRUB ESSENCE 30ml White peach flavor cat Romantic Tea Aroma dog',
        visualProductForm: '液体精华', visualUseMethod: '免洗擦浴', visualTargetObject: '猫狗', visualConfidence: 96,
        confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '挤出液体后免洗擦浴', confirmedTargetObject: '猫狗', identityResolutionNote: '以包装出液口、详情说明和实物形态为准',
        attributes: ['规格：30ml一袋', '品牌：其他']
      }
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({ __draft__: { info, collapsed: false, confirmed: true, confirmedAt: now, updatedAt: now } }))
    }, qaProfile)
    await page.reload()
    await page.waitForTimeout(1200)
    const settings = await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.get())
    if (!settings.configured) throw new Error('Amazon 真实数据源未配置')
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '选品分析师' }).click()
    await page.waitForTimeout(1500)
    const confirmedMarker = page.getByText('已确认锁定', { exact: true })
    if (!await confirmedMarker.count()) {
      const debug = {
        url: page.url(),
        body: (await page.locator('body').innerText()).slice(-3000),
        extractionStorage: await page.evaluate(() => localStorage.getItem('yd.aiEmployee.extractedByConversation:v1'))
      }
      fs.writeFileSync(path.join(outputDir, 'preflight-debug.json'), JSON.stringify(debug, null, 2))
      await page.screenshot({ path: path.join(outputDir, 'preflight-missing-identity.png') })
      throw new Error('隔离会话未加载已确认的商品身份')
    }
    const selectedModel = (await page.locator('.ai-employee-model-select').inputValue().catch(() => '')) || 'ragflow-agent'
    const textarea = page.locator('.ai-employee-floating-composer textarea')
    await textarea.fill('请分析这款产品在 Amazon 美国站是否有机会，严格按知识库六部分和全部固定表格输出完整评估报告。缺失数据必须写待验证，不得编造。')
    const startedAt = Date.now()
    await page.getByRole('button', { name: '发送' }).click()
    await page.getByRole('region', { name: 'Amazon 样本可比性审计' }).waitFor({ timeout: 90000 })
    await page.waitForFunction(() => {
      const messages = [...document.querySelectorAll('.ai-employee-message.assistant')]
      const last = messages[messages.length - 1]
      return last && !last.querySelector('.typing')
    }, null, { timeout: 520000 })
    const elapsedMs = Date.now() - startedAt
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem('yd.aiEmployee.history') || '[]'))
    const latest = history.find(item => item.roleName === '选品分析师')
    const assistant = [...(latest?.messages || [])].reverse().find(item => item.role === 'assistant')
    const rawMarkdown = String(assistant?.content || '')
    const visibleText = (await page.locator('.ai-employee-message.assistant').last().innerText()).replace(/\s+/g, ' ')
    const auditText = (await page.getByRole('region', { name: 'Amazon 样本可比性审计' }).innerText()).replace(/\s+/g, ' ')
    fs.writeFileSync(path.join(outputDir, 'actual-ragflow-report.md'), rawMarkdown)
    const summary = {
      generatedAt: new Date().toISOString(), elapsedMs, settings, selectedModel,
      rawLength: rawMarkdown.length,
      firstHeading: rawMarkdown.match(/^#\s+.+$/m)?.[0] || '',
      h2: [...rawMarkdown.matchAll(/^##\s+(.+)$/gm)].map(match => match[1]),
      tableCount: (rawMarkdown.match(/^\|.+\|$/gm) || []).filter((line, index, lines) => index === 0 || !/^\|[-:|\s]+\|$/.test(lines[index - 1] || '')).length,
      decisionMatches: rawMarkdown.match(/(?:✅\s*建议入场|⚠️?\s*有条件谨慎入场|❌\s*不建议入场|❓\s*数据不足[^。\n]*)/g) || [],
      auditText,
      visiblePreview: visibleText.slice(0, 1200),
      qualityRejected: visibleText.includes('报告未通过正式报告质量校验'),
      error: /^AI ⚠️/.test(visibleText) ? visibleText.slice(0, 500) : ''
    }
    fs.writeFileSync(path.join(outputDir, 'probe-summary.json'), JSON.stringify(summary, null, 2))
    console.log(JSON.stringify(summary, null, 2))
    if (!rawMarkdown) process.exitCode = 2
  } finally {
    await app.close()
  }
})().catch(error => { console.error(error); process.exit(1) })
