// 验证：A 标题归一新语义（触发消息优先/正文优先/历史不串位）+ B Amazon 搜索页解析脚本 + 事实块构建
// 运行：先 npx esbuild src/shared/selectionExtract.ts src/shared/amazonScraper.ts --bundle=false ... 见命令
const { chromium } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const fs = require('node:fs')

const bundle = fs.readFileSync('/tmp/selection-market-bundle.js', 'utf8')

const amazonFixture = `
<div id="s-results">
  <div data-component-type="s-search-result" data-asin="B0AAA00001">
    <h2><a><span>Equine Shampoo Concentrate 32 oz</span></a></h2>
    <span class="a-price"><span class="a-offscreen">$19.95</span></span>
    <i class="a-icon-star"><span class="a-icon-alt">4.6 out of 5 stars</span></i>
    <a class="a-link-normal" href="/product-reviews/B0AAA00001"><span class="a-size-base">12,345</span></a>
  </div>
  <div data-component-type="s-search-result" data-asin="B0AAA00002">
    <h2><a><span>Horse Mane Shampoo &amp; Conditioner</span></a></h2>
    <span class="a-price"><span class="a-offscreen">$9.99</span></span>
    <i class="a-icon-star"><span class="a-icon-alt">4.3 out of 5 stars</span></i>
    <a class="a-link-normal" href="/customerReviews/B0AAA00002"><span class="a-size-base">876</span></a>
  </div>
  <div data-component-type="s-search-result" data-asin="">
    <h2><span>无 asin 卡片应被跳过</span></h2>
  </div>
</div>
`

const oldUserMsg = '我在1688看到一款商品，商品信息如下：\n- 标题：跨境自动激光逗猫玩具智能调节角度激光逗猫器LED红光镭射猫猫玩具\n- 价格：¥22.00\n请帮我分析这款产品在亚马逊美国站是否有机会。\n目标平台：Amazon'
const newUserMsg = '我在1688看到一款商品，商品信息如下：\n- 标题：跨境马洗发水宠物马屁护发素沐浴露洗马清洁液马匹毛发柔顺清洗液\n- 价格：¥16.00\n请帮我分析这款产品在亚马逊美国站是否有机会。\n目标平台：Amazon美国站'
const oldReport = '# 跨境自动激光逗猫玩具智能调节角度激光逗猫器LED红光镭射猫猫玩具 · Amazon美国站选品分析报告\n\n## 第一部分：本品基础信息解析'
const newReport = '# 旧错误标题 · Amazon美国站选品分析报告\n\n## 第一部分：本品基础信息解析'

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent(`<div id="root">${amazonFixture}</div><script>${bundle}</script>`)
  const result = await page.evaluate(({ oldUserMsg, newUserMsg, oldReport, newReport }) => {
    const S = window.__sel
    const h1 = (text) => (text.match(/^#\s+(.+)$/m) || [])[1] || ''
    // A1：同会话先问激光逗猫玩具、后问马洗发水 → 新报告标题必须取触发消息（马洗发水）
    const fixed = S.normalizeSelectionReport(newReport, newUserMsg)
    // A2：报告正文含产品名时正文优先
    const contentNamed = '# x · Amazon美国站选品分析报告\n\n产品名称：某品牌马洗发水浓缩液\n## 第一部分：本品基础信息解析'
    const named = S.normalizeSelectionReport(contentNamed, newUserMsg)
    // A3：非报告内容原样返回
    const plain = S.normalizeSelectionReport('普通对话回复', newUserMsg)
    // A4：历史归一模拟（按触发消息逐条归一）：旧报告配旧消息、新报告配新消息
    const histOld = S.normalizeSelectionReport(oldReport, oldUserMsg)
    const histNew = S.normalizeSelectionReport(oldReport, newUserMsg)
    // B1：搜索页解析（直接调用导出函数，页面上下文执行）
    const samples = S.extractAmazonSamples(document)
    // B2：captcha 场景返回 null（动态注入验证码表单）
    const captchaBox = document.createElement('div')
    captchaBox.innerHTML = '<form action="/errors/validateCaptcha"></form>'
    document.body.appendChild(captchaBox)
    const captcha = S.extractAmazonSamples(document)
    captchaBox.remove()
    // B3：事实块
    const block = samples && samples.length ? S.buildMarketFactBlock('horse shampoo', samples) : ''
    return {
      fixedH1: h1(fixed),
      namedH1: h1(named),
      plainUnchanged: plain === '普通对话回复',
      histOldH1: h1(histOld),
      histNewH1: h1(histNew),
      sampleCount: samples ? samples.length : -1,
      firstSample: samples ? samples[0] : null,
      secondReviews: samples && samples[1] ? samples[1].reviews : null,
      captchaNull: captcha === null,
      blockHasPrice: /零售价格区间：\$9\.99–\$19\.95｜中位价 \$14\.97｜均价 \$14\.97/.test(block),
      blockHasTopAsin: /B0AAA00001/.test(block) && /B0AAA00002/.test(block),
      blockHasRule: /证据等级标「事实」/.test(block)
    }
  }, { oldUserMsg, newUserMsg, oldReport, newReport })
  await browser.close()

  const checks = [
    ['A：新报告标题=触发产品（马洗发水）', result.fixedH1.includes('跨境马洗发水宠物马屁护发素') && !result.fixedH1.includes('激光逗猫')],
    ['A：报告正文产品名优先', result.namedH1.includes('某品牌马洗发水浓缩液')],
    ['A：非报告内容不被改写', result.plainUnchanged],
    ['A：历史归一旧报告配旧消息=旧产品名', result.histOldH1.includes('激光逗猫')],
    ['A：历史归一新触发=新产品名（不串位）', result.histNewH1.includes('跨境马洗发水') && !result.histNewH1.includes('激光逗猫')],
    ['B：搜索页解析 2 条有效样本（跳过空 asin）', result.sampleCount === 2],
    ['B：样本字段 asin/price/rating/reviews 解析', result.firstSample && result.firstSample.asin === 'B0AAA00001' && result.firstSample.price === 19.95 && result.firstSample.rating === 4.6 && result.firstSample.reviews === 12345],
    ['B：customerReviews 链接评论量解析', result.secondReviews === 876],
    ['B：captcha 场景返回 null', result.captchaNull],
    ['B：事实块含价格区间/中位价', result.blockHasPrice],
    ['B：事实块含高评论样本 ASIN', result.blockHasTopAsin],
    ['B：事实块含证据等级指引', result.blockHasRule]
  ]
  let failed = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) failed++
  }
  console.log(JSON.stringify(result, null, 2))
  process.exit(failed ? 1 : 0)
})()
