const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/stage6-baseline-closure')
fs.mkdirSync(outputDir, { recursive: true })
const checks = []
const assert = (id, passed, detail) => {
  checks.push({ id, passed: Boolean(passed), detail })
  if (!passed) throw new Error(`${id}: ${detail}`)
}

;(async () => {
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage6-baseline-electron-'))
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const launchedViewport = await page.evaluate(() => ({ innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }))
    assert('launched-window-fit', launchedViewport.scrollWidth <= launchedViewport.innerWidth && launchedViewport.scrollHeight <= launchedViewport.innerHeight, JSON.stringify(launchedViewport))
    const qaProfile = { id: 'stage6-qa', email: 'stage6@example.test', name: '阶段6验收', isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, org: { id: 'stage6-org', name: '阶段6组织' }, roles: [], permissions: 'ALL', stores: null }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
    await page.evaluate(profile => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'stage6', refreshToken: 'stage6', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
      const now = new Date().toISOString()
      const info = {
        url: 'https://detail.1688.com/offer/stage6.html', analysisDate: '2026-08-10', title: '宠物免洗擦浴精华', price: '¥2.50', seller: '阶段6供应商',
        images: ['https://example.test/product.jpg'], detailText: '宠物液体免洗擦浴精华，挤出后擦浴清洁。', detailSource: '详情模块DOM', imageOcrText: 'PET WASH FREE SCRUB ESSENCE 30ml',
        visualProductForm: '液体精华', visualUseMethod: '免洗擦浴', visualTargetObject: '猫狗', visualConfidence: 96,
        confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '挤出液体后免洗擦浴', confirmedTargetObject: '猫狗', identityResolutionNote: '以包装出液口和详情说明为准'
      }
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({ __draft__: { info, collapsed: false, confirmed: true, confirmedAt: now, updatedAt: now } }))
    }, qaProfile)
    await app.evaluate(({ ipcMain }) => {
      globalThis.__stage6Qa = { exports: [], asks: 0, searches: 0 }
      const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      replace('ai-employee:derive-amazon-keywords', () => ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash'])
      replace('amazon-data-source:search', (_event, keyword) => {
        const batch = globalThis.__stage6Qa.searches++
        return {
          samples: Array.from({ length: 18 }, (_, index) => ({
            asin: `S6${String(batch).padStart(2, '0')}${String(index).padStart(7, '0')}`,
            title: `Waterless Pet Shampoo No Rinse Liquid Cleanser 30ml for Dogs and Cats ${batch}-${index}`,
            price: 18 + index / 10,
            rating: 4.2,
            reviews: 120 + index,
            query: keyword,
            sponsored: false,
            source: 'api'
          }))
        }
      })
      replace('ai-employee:amazon-market-stats', () => null)
      // 阶段 6 仅验收报告交付；详情/评论采集在阶段 1 与 4 单独覆盖，避免这里触发真实浏览器请求。
      replace('ai-employee:amazon-listing-evidence', () => [])
      replace('ai-employee:amazon-review-evidence', () => [])
      replace('ai-employee:ask', () => {
        globalThis.__stage6Qa.asks += 1
        return { ok: true, content: '# 宠物免洗擦浴精华 · Amazon美国站选品分析报告\n\n## 第一部分：本品基础信息解析\n- 产品形态：液体精华\n\n## 第二部分：Amazon 市场分析\n- TOP50均价：待验证\n- 月销量：U，待验证\n\n## 结论\n❓ 数据不足，不能判定' }
      })
      replace('listing:export', (_event, request) => {
        globalThis.__stage6Qa.exports.push(request)
        return { canceled: false, filePath: request.format === 'word' ? '/tmp/stage6-report.docx' : '/tmp/stage6-report.md' }
      })
    })
    await page.reload()
    await page.waitForTimeout(1000)
    if (await page.getByRole('button', { name: '登 录' }).count()) throw new Error('隔离会话未进入主界面')
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '产品分析师' }).click()
    await page.getByText('已确认锁定', { exact: true }).waitFor()
    const textarea = page.locator('.ai-employee-floating-composer textarea[placeholder^="向 "]')
    await textarea.fill('请生成 Amazon 美国站选品报告')
    await page.getByRole('button', { name: '发送' }).click()
    await page.getByText('宠物免洗擦浴精华 · Amazon美国站选品分析报告', { exact: false }).waitFor({ timeout: 20000 })
    assert('report-title-preserved', await page.getByText('待命名产品 · Amazon美国站选品分析报告', { exact: false }).count() === 0, '报告保持“宠物免洗擦浴精华”')
    const assistant = page.locator('.ai-employee-message.assistant').last()
    await assistant.getByRole('button', { name: '••• 更多' }).click()
    const menu = assistant.getByRole('menu', { name: '更多回复操作' })
    await menu.waitFor()
    const menuText = (await menu.innerText()).replace(/\s+/g, ' ')
    assert('real-more-menu-visible', menuText.includes('下载 Word') && menuText.includes('下载 Markdown') && menuText.includes('收藏回复'), menuText)
    assert('placeholder-removed', await page.getByText('更多回复操作将在后续阶段接入。', { exact: true }).count() === 0, '旧占位文案不存在')
    await page.screenshot({ path: path.join(outputDir, '01-real-more-menu.png'), fullPage: true })

    await menu.getByRole('menuitem', { name: '收藏回复' }).click()
    await assistant.getByRole('status').filter({ hasText: '已收藏这条回复' }).waitFor()
    const favoriteCount = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('yd.aiEmployee.favorite:')).length)
    assert('favorite-persisted', favoriteCount === 1, `favorite keys=${favoriteCount}`)
    await assistant.getByRole('button', { name: '••• 更多' }).click()
    await menu.getByRole('menuitem', { name: '取消收藏' }).click()
    const favoriteAfterCancel = await page.evaluate(() => Object.keys(localStorage).filter(key => key.startsWith('yd.aiEmployee.favorite:')).length)
    assert('favorite-full-cycle', favoriteAfterCancel === 0, `favorite keys=${favoriteAfterCancel}`)

    await assistant.getByRole('button', { name: '••• 更多' }).click()
    await page.keyboard.press('Escape')
    assert('more-menu-escape-close', await menu.count() === 0, 'Esc 后菜单关闭')
    await assistant.getByRole('button', { name: '••• 更多' }).click()
    await menu.getByRole('menuitem', { name: '下载 Word' }).click()
    await assistant.getByRole('status').filter({ hasText: 'stage6-report.docx' }).waitFor()
    await assistant.getByRole('button', { name: '••• 更多' }).click()
    await menu.getByRole('menuitem', { name: '下载 Markdown' }).click()
    await assistant.getByRole('status').filter({ hasText: 'stage6-report.md' }).waitFor()
    const qaAfterExports = await app.evaluate(() => globalThis.__stage6Qa)
    assert('more-menu-exports-work', qaAfterExports.exports.length === 2 && qaAfterExports.exports[0].format === 'word' && qaAfterExports.exports[1].format === 'markdown', JSON.stringify(qaAfterExports.exports.map(item => item.format)))

    await assistant.getByRole('button', { name: '✎ 转为文档编辑' }).click()
    const documentCard = assistant.getByRole('region', { name: '已生成的报告文档' })
    await documentCard.waitFor()
    const editor = documentCard.getByRole('textbox', { name: '报告文档编辑区' })
    await editor.fill((await editor.inputValue()) + '\n\n阶段6编辑验收。')
    await documentCard.getByRole('button', { name: '完成编辑' }).click()
    const documentPrompt = documentCard.locator('[aria-label="基于文档的提问建议"] button').first()
    await documentPrompt.click()
    assert('document-flow-regression', (await textarea.inputValue()).includes('请优先核验这份报告中的待验证数据'), await textarea.inputValue())
    await page.screenshot({ path: path.join(outputDir, '02-document-workflow.png'), fullPage: true })

    await page.setViewportSize({ width: 1100, height: 720 })
    await page.getByRole('button', { name: 'AI总部' }).click()
    await page.getByRole('heading', { name: 'AI总部' }).waitFor()
    const llmCard = page.locator('.ai-crossborder-card.clickable').filter({ hasText: '大模型API Key' })
    await llmCard.waitFor()
    const minViewport = await page.evaluate(() => {
      const heading = [...document.querySelectorAll('h2')].find(node => node.textContent === 'AI总部')
      const card = [...document.querySelectorAll('.ai-crossborder-card')].find(node => node.textContent?.includes('大模型API Key'))
      const rect = node => node ? node.getBoundingClientRect() : null
      const overflows = [...document.querySelectorAll('body *')].map(node => ({ node: node.tagName, className: node.className, rect: rect(node) })).filter(item => item.rect && item.rect.bottom > innerHeight + 1).sort((a, b) => b.rect.bottom - a.rect.bottom).slice(0, 8)
      return { innerWidth, innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, heading: rect(heading), card: rect(card), overflows }
    })
    assert('hq-minimum-window-fit', minViewport.scrollWidth <= 1100 && minViewport.scrollHeight <= 720 && minViewport.heading?.top >= 56 && minViewport.card?.bottom <= 720, JSON.stringify(minViewport))
    await page.screenshot({ path: path.join(outputDir, '03-ai-hq-1100x720.png'), fullPage: true })
    await llmCard.click()
    await page.getByText('大模型API Key', { exact: true }).waitFor()
    const amazonCard = page.locator('.ai-crossborder-card.clickable').filter({ hasText: 'Amazon 数据源配置' })
    await amazonCard.click()
    await page.getByRole('heading', { name: '数据源与凭据' }).waitFor()
    await page.getByRole('button', { name: '返回 大模型API Key' }).click()
    await page.getByText('大模型API Key', { exact: true }).waitFor()
    await page.getByRole('button', { name: '返回 AI总部' }).click()
    await page.getByRole('heading', { name: 'AI总部' }).waitFor()
    assert('amazon-card-round-trip', await llmCard.count() === 1, '通过大模型API Key进入Amazon配置页并返回AI总部正常')

    const indexHtml = fs.readFileSync(path.join(root, 'dist/renderer/index.html'), 'utf8')
    const expectedAssets = [...indexHtml.matchAll(/(?:src|href)="([^"]+\/assets\/[^"]+)"/g)].map(match => match[1])
    const loadedAssets = await page.evaluate(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(node => node.getAttribute('src') || node.getAttribute('href')).filter(Boolean))
    assert('latest-assets', expectedAssets.length === 2 && expectedAssets.every(asset => loadedAssets.includes(asset)), `实际加载 ${loadedAssets.join(', ')}`)
    const report = { generatedAt: new Date().toISOString(), launchedViewport, minViewport, expectedAssets, loadedAssets, checks, counters: { asks: qaAfterExports.asks, exports: qaAfterExports.exports.length } }
    fs.writeFileSync(path.join(outputDir, 'stage6-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await app.close()
  }
})().catch(error => { console.error(error); process.exit(1) })
