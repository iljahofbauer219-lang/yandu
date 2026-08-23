const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/stage4-amazon-comparability')
fs.mkdirSync(outputDir, { recursive: true })

const checks = []
const assert = (id, passed, detail) => {
  checks.push({ id, passed: Boolean(passed), detail })
  if (!passed) throw new Error(`${id}: ${detail}`)
}

;(async () => {
  console.log('STAGE4 UI: launching Electron')
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage4-amazon-electron-'))
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' } })
  try {
    console.log('STAGE4 UI: Electron launched')
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const qaProfile = {
      id: 'stage4-qa', email: 'stage4@example.test', name: '阶段4验收', isOwner: true,
      status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
      org: { id: 'stage4-org', name: '阶段4组织' }, roles: [], permissions: 'ALL', stores: null
    }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
    await page.evaluate(profile => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'stage4', refreshToken: 'stage4', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
      const now = new Date().toISOString()
      const info = {
        url: 'https://detail.1688.com/offer/stage4.html', analysisDate: '2026-08-10',
        title: '跨境猫狗通用宠物免洗擦拭精华清洁套装', price: '¥2.50', seller: '阶段4供应商',
        images: ['https://example.test/product.jpg'], detailText: '宠物液体免洗擦浴精华，挤出后擦浴清洁。', detailSource: '详情模块DOM',
        imageOcrText: 'PET WASH FREE SCRUB ESSENCE 30ml', visualProductForm: '湿巾', visualUseMethod: '擦拭', visualTargetObject: '猫狗', visualConfidence: 96,
        confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '挤出液体后免洗擦浴', confirmedTargetObject: '猫狗',
        identityResolutionNote: '以包装出液口、详情说明和实物形态为准'
      }
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({ __draft__: { info, collapsed: false, confirmed: true, confirmedAt: now, updatedAt: now } }))
    }, qaProfile)

    await app.evaluate(({ ipcMain }) => {
      globalThis.__stage4Qa = { deriveCalls: [], searchCalls: [], browserCalls: [], asks: [], mode: 'fixtures' }
      const replace = (channel, handler) => { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
      replace('ai-employee:derive-amazon-keywords', (_event, intent) => {
        globalThis.__stage4Qa.deriveCalls.push(intent)
        return ['pet grooming wipes', 'Waterless Pet Shampoo', 'No Rinse Pet Cleanser', 'Waterless Pet Body Wash']
      })
      const fixture = {
        'waterless pet shampoo': [
          { asin: 'DIRECT001', title: 'Waterless Pet Shampoo No Rinse Body Cleanser for Dogs and Cats', price: 20, rating: 4.5, reviews: 100 },
          { asin: 'WIPE00001', title: 'Pet Grooming Wipes for Dog and Cat Body Cleaning', price: 9, rating: 4.8, reviews: 9000 },
          { asin: 'BRUSH0001', title: 'Pet Grooming Cleaning Brush for Dogs', price: 7, rating: 4.7, reviews: 8000 }
        ],
        'no rinse pet cleanser': [
          { asin: 'DIRECT001', title: 'Waterless Pet Shampoo No Rinse Body Cleanser for Dogs and Cats', price: 20, rating: 4.5, reviews: 100 },
          { asin: 'DIRECT002', title: 'No Rinse Dog Cleanser Waterless Bath Wash', price: 30, rating: 4.2, reviews: 200 },
          { asin: 'WIPE00002', title: 'Deodorizing Pet Wipes for Dog Cleaning and Grooming', price: 13, rating: 4.6, reviews: 7000 }
        ],
        'waterless pet body wash': [
          { asin: 'DIRECT003', title: 'Cat and Dog Body Wash Waterless Shampoo', price: 40, rating: 4.4, reviews: 300 },
          { asin: 'DENTAL001', title: 'Dog Dental Tooth Cleaning Kit', price: 8, rating: 4.3, reviews: 6000 }
        ]
      }
      replace('amazon-data-source:search', (_event, keyword) => {
        globalThis.__stage4Qa.searchCalls.push(keyword)
        return globalThis.__stage4Qa.mode === 'empty' ? { samples: null, error: 'fixture empty' } : { samples: fixture[keyword] || [] }
      })
      replace('ai-employee:amazon-market-stats', (_event, keyword) => {
        globalThis.__stage4Qa.browserCalls.push(keyword)
        return null
      })
      // 详情与评论证据由各自阶段独立验收，本阶段只覆盖样本可比性与检索词清洗。
      replace('ai-employee:amazon-listing-evidence', () => [])
      replace('ai-employee:amazon-review-evidence', () => [])
      replace('ai-employee:ask', (_event, request) => {
        globalThis.__stage4Qa.asks.push(request.query)
        return { ok: true, content: '# 宠物免洗擦浴精华 · Amazon美国站选品分析报告\n\n## 第一部分：本品基础信息解析\n- 产品名称：宠物免洗擦浴精华\n- 产品形态：液体精华\n\n## 第二部分：Amazon 市场分析\n- 数据范围：按系统样本审计结论执行' }
      })
    })

    await page.reload()
    await page.waitForTimeout(1200)
    if (await page.getByRole('button', { name: '登 录' }).count()) throw new Error('隔离会话未进入主界面')
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '产品分析师' }).click()
    await page.getByText('已确认锁定', { exact: true }).waitFor()
    assert('identity-lock-visible', await page.getByText(/宠物免洗擦浴精华 · 液体精华/).count() > 0, '界面显示人工锁定的液体形态')

    const textarea = page.locator('.ai-employee-floating-composer textarea[placeholder^="向 "]')
    await textarea.fill('请生成 Amazon 美国站完整选品报告')
    await page.getByRole('button', { name: '发送' }).click()
    await page.getByRole('region', { name: 'Amazon 样本可比性审计' }).waitFor({ timeout: 15000 })
    await page.getByText('宠物免洗擦浴精华 · Amazon美国站选品分析报告', { exact: false }).waitFor({ timeout: 15000 })

    const audit = page.getByRole('region', { name: 'Amazon 样本可比性审计' })
    const auditText = (await audit.innerText()).replace(/\s+/g, ' ')
    assert('audit-counts-visible', /原始样本 8/.test(auditText) && /ASIN 去重 7/.test(auditText) && /DIRECT 3/.test(auditText) && /ADJACENT 2/.test(auditText) && /已排除 2/.test(auditText), auditText)
    assert('three-clean-keywords-visible', ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash'].every(keyword => auditText.includes(keyword)) && !auditText.includes('pet grooming wipes'), auditText)
    assert('low-confidence-visible', auditText.includes('结论置信度：低') && auditText.includes('不得写成 TOP50'), auditText)

    const qa = await app.evaluate(() => globalThis.__stage4Qa)
    assert('locked-intent-sent', qa.deriveCalls.length === 1 && qa.deriveCalls[0].productForm === '液体精华' && qa.deriveCalls[0].excludedTerms.includes('pet wipes'), JSON.stringify(qa.deriveCalls[0]))
    assert('three-queries-only', JSON.stringify(qa.searchCalls) === JSON.stringify(['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash']), qa.searchCalls.join(' | '))
    const firstQuery = qa.asks[0]
    const reportText = await page.locator('.ai-employee-message.assistant').last().innerText()
    assert('direct-only-statistics', ['$20.00', '$30.00', '$40.00'].every(price => reportText.includes(price)) && !reportText.includes('Pet Grooming Wipes for Dog and Cat Body Cleaning'), 'DIRECT 价格统计为 20/30/40，湿巾未混入直接竞品表')
    assert('adjacent-and-excluded-policy', firstQuery.length > 0 && auditText.includes('ADJACENT 2') && auditText.includes('已排除 2') && reportText.includes('DIRECT样本仅作可比竞品'), '替代方案和不可比样本不混入DIRECT结论')
    assert('report-finished-no-stale-progress', await page.getByText(/正在依据本品身份锁|正在抓取 Amazon 市场样本/).count() === 0, '报告返回后无抓取中提示')

    await page.screenshot({ path: path.join(outputDir, '01-comparability-audit.png'), fullPage: true })

    await app.evaluate(() => { globalThis.__stage4Qa.mode = 'empty' })
    await textarea.fill('重新生成一次并明确当前样本限制')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForFunction(() => {
      const region = document.querySelector('[aria-label="Amazon 样本可比性审计"]')
      return region && /原始样本\s*0/.test(region.textContent || '')
    }, null, { timeout: 15000 })
    const emptyText = (await audit.innerText()).replace(/\s+/g, ' ')
    assert('empty-sample-audited', /原始样本 0/.test(emptyText) && /DIRECT 0/.test(emptyText) && /结论置信度：低/.test(emptyText), emptyText)
    const qaAfterEmpty = await app.evaluate(() => globalThis.__stage4Qa)
    assert('empty-sample-fallback-tried', qaAfterEmpty.browserCalls.length === 6 && JSON.stringify(qaAfterEmpty.browserCalls.slice(-3)) === JSON.stringify(['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash']), qaAfterEmpty.browserCalls.join(' | '))
    assert('empty-query-explicit-limit', qaAfterEmpty.asks.length >= 2 && qaAfterEmpty.asks.at(-1).length > 0, '零样本时仍发送受控补充请求，报告由系统事实包降级')
    await page.screenshot({ path: path.join(outputDir, '02-empty-sample-limit.png'), fullPage: true })

    await page.setViewportSize({ width: 1100, height: 720 })
    await page.waitForTimeout(300)
    const layout = await audit.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, right: element.getBoundingClientRect().right, viewport: window.innerWidth }))
    assert('narrow-layout-no-overflow', layout.scrollWidth <= layout.width + 1 && layout.right <= layout.viewport + 1, JSON.stringify(layout))
    await page.screenshot({ path: path.join(outputDir, '03-narrow-layout.png'), fullPage: true })

    const indexHtml = fs.readFileSync(path.join(root, 'dist/renderer/index.html'), 'utf8')
    const expectedAssets = [...indexHtml.matchAll(/(?:src|href)="([^"]+\/assets\/[^"]+)"/g)].map(match => match[1])
    const loadedAssets = await page.evaluate(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(node => node.getAttribute('src') || node.getAttribute('href')).filter(Boolean))
    assert('latest-assets', expectedAssets.length === 2 && expectedAssets.every(asset => loadedAssets.includes(asset)), `实际加载 ${loadedAssets.join(', ')}`)

    const report = { generatedAt: new Date().toISOString(), expectedAssets, loadedAssets, checks, counters: { derive: qaAfterEmpty.deriveCalls.length, search: qaAfterEmpty.searchCalls.length, browserFallback: qaAfterEmpty.browserCalls.length, ask: qaAfterEmpty.asks.length }, layout }
    fs.writeFileSync(path.join(outputDir, 'stage4-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await app.close()
  }
})().catch(error => { console.error(error); process.exit(1) })
