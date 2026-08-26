// 验证「砚都跨境采集助手」扩展的 1688 一键分析功能
// 1. 加载扩展（MV3） 2. 打开真实 1688 商品页 3. content script 提取 4. MaxKB 智能体分析 5. 截图
// 阶段 3.6 切到 MaxKB：MAXKB_SOURCING_APPLICATION_ID + secret_key → /chat/api/{app}/chat/completions
const { chromium } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')

const EXT_DIR = path.resolve(__dirname, '../browser-extension')
const CHROME = path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1234/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
const PRODUCT_URL = 'https://detail.1688.com/offer/677442502491.html'
const MAXKB_URL = 'http://114.55.149.192:8080'
const MAXKB_TOKEN = 'agent-9bd465c72fe21d328d51ceefa18ef679'
const APPLICATION_ID = '01a02f8c-66d2-7803-b02b-e67d1cc6e02b'

;(async () => {
  const context = await chromium.launchPersistentContext('', {
    executablePath: CHROME,
    headless: false,
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1400,1000',
    ],
  })

  // 1. 找到扩展 service worker
  let worker = null
  for (let i = 0; i < 15; i++) {
    const workers = context.serviceWorkers()
    const w = workers.find(w => w.url().includes('chrome-extension://'))
    if (w) { worker = w; break }
    await context.waitForEvent('serviceworker', { timeout: 3000 }).catch(() => {})
  }
  if (!worker) throw new Error('未找到扩展 service worker')
  const extId = new URL(worker.url()).host
  console.log('扩展 ID:', extId)

  // 2. 打开 1688 商品页
  const page = await context.newPage()
  await page.goto(PRODUCT_URL, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(5000)
  await page.screenshot({ path: path.resolve(__dirname, '../output/playwright/ext-01-1688-page.png') })

  // 3. 通过 service worker 触发 content script 提取
  const extractResult = await worker.evaluate(async (urlMatch) => {
    const tabs = await chrome.tabs.query({ url: urlMatch })
    if (!tabs.length) return { ok: false, message: '未找到 1688 标签页' }
    return chrome.tabs.sendMessage(tabs[0].id, { type: 'EXTRACT_1688' })
  }, '*://detail.1688.com/*')

  console.log('提取结果:')
  console.log(JSON.stringify(extractResult, null, 2).slice(0, 1500))

  if (!extractResult?.ok) throw new Error('商品信息提取失败')
  const info = extractResult.info
  const fields = ['title', 'price', 'seller', 'moq', 'shipFrom', 'deals']
  for (const f of fields) if (info[f]) console.log(`  ${f}: ${info[f]}`)
  console.log(`  attributes: ${info.attributes?.length || 0} 项, images: ${info.images?.length || 0} 张`)

  // 4. 保存 MaxKB 配置并调用智能体（模拟 popup 的 ANALYZE_1688 消息路径：
  // worker 内直接调用与 service-worker.js 相同的 fetch 逻辑；popup→worker 的消息路径另测）
  await worker.evaluate(async ({ url, token, appId }) => {
    await chrome.storage.local.set({ maxkbUrl: url, maxkbToken: token, maxkbAppId: appId })
  }, { url: MAXKB_URL, token: MAXKB_TOKEN, appId: APPLICATION_ID })
  
  const t0 = Date.now()
  const analyzeResult = await worker.evaluate(async ({ url, token, appId, prompt }) => {
    const response = await fetch(`${url}/chat/api/${appId}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        messages: [{ role: 'user', content: prompt }],
        stream: false
      })
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) return { ok: false, message: body.message || `分析请求失败（${response.status}）` }
    const content = body?.data?.content || body?.choices?.[0]?.message?.content
    if (!content) return { ok: false, message: '智能体未返回内容' }
    return { ok: true, content }
  }, { url: MAXKB_URL, token: MAXKB_TOKEN, appId: APPLICATION_ID, prompt: extractResult.prompt })
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)

  if (!analyzeResult?.ok) throw new Error(`智能体分析失败: ${analyzeResult?.message || '未知错误'}`)
  console.log(`\n智能体分析成功（耗时 ${elapsed}s），报告长度: ${analyzeResult.content.length} 字符`)
  console.log('报告预览:')
  console.log(analyzeResult.content.slice(0, 800))

  // 5. 打开 popup 页面截图（验证 UI 可加载）
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await popup.waitForTimeout(1500)
  await popup.screenshot({ path: path.resolve(__dirname, '../output/playwright/ext-02-popup.png') })
  console.log('\npopup 截图完成')

  fs.writeFileSync(path.resolve(__dirname, '../output/playwright/ext-report.json'), JSON.stringify({
    extId, productUrl: PRODUCT_URL, extract: extractResult, analyzeLength: analyzeResult.content.length, elapsedSec: elapsed,
  }, null, 2))

  await context.close()
  console.log('\n✅ 扩展端到端验证通过')
})().catch(error => { console.error('❌', error.message); process.exit(1) })
