// 视觉验证：真实 CSS + 真实增强模块作用下的表格排版截图
// 运行：node tmp-verify/verify-table-visual.cjs
const { chromium } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const fs = require('node:fs')
const path = require('node:path')

const css = fs.readFileSync(path.resolve(__dirname, '../src/renderer/ai-employee.css'), 'utf8')
const bundle = fs.readFileSync('/tmp/report-enhance-bundle.js', 'utf8')

const fixture = `
<style>
  :root {
    --bg-panel: #ffffff; --bg-soft: #f2f5f4; --border-soft: #e2e8e5; --border-strong: #c9d4cf;
    --text-primary: #1d2724; --text-secondary: #5c6b66; --accent: #177e5b; --accent-soft: #e2f3ec; --accent-contrast: #0e6b4c;
  }
  body { margin: 0; padding: 28px; background: #fafbfb; font-family: -apple-system, 'PingFang SC', sans-serif; }
</style>
<style>${css}</style>
<div class="ai-employee-message assistant"><div class="ai-employee-bubble">
<div id="root" class="ai-markdown-content ai-markdown-answer">
  <section class="ai-markdown-table-card"><div class="ai-markdown-table-scroll">
  <table>
    <thead><tr><th>维度</th><th>关注点</th><th>内容</th><th>证据等级</th><th>来源</th><th>用途</th></tr></thead>
    <tbody>
      <tr><td>需求价值</td><td>可解决核心痛点</td><td>1. 主人不在家时猫咪无聊&lt;br&gt;2. 手动逗猫耗时耗力&lt;br&gt;3. 普通玩具易被猫咪厌倦</td><td>分析假设</td><td>行业常识</td><td>3–5条</td></tr>
      <tr><td>需求价值</td><td>用户核心购买理由</td><td>自动激光、智能调节角度、省时省力、激发猫咪狩猎本能</td><td>分析假设</td><td>产品标题与功能推导</td><td>转化卖点</td></tr>
    </tbody>
  </table>
  </div></section>
  <section class="ai-markdown-table-card"><div class="ai-markdown-table-scroll">
  <table>
    <thead><tr><th>Listing/ASIN</th><th>标准化价格</th><th>月销量/销售额估算</th><th>BSR/类目排名</th><th>评分/评论</th><th>上架时间</th><th>威胁等级</th><th></th><th>来源</th></tr></thead>
    <tbody>
      <tr><td>B000WCO7YW</td><td>$19.95</td><td>6,200 / $124k</td><td>#12 (Laser Toys)</td><td>4.3 / 28,500</td><td>2018-03</td><td>高</td><td></td><td>外部估算</td></tr>
      <tr><td>B004QZ6X8K</td><td>$24.99</td><td>3,800 / $95k</td><td>#18</td><td>4.1 / 12,300</td><td>2019-07</td><td>高</td><td></td><td>外部估算</td></tr>
      <tr><td>B09NVPXQ8L</td><td>$16.99</td><td>2,100 / $36k</td><td>#35</td><td>4.4 / 3,200</td><td>2021-11</td><td>中</td><td></td><td>外部估算</td></tr>
    </tbody>
  </table>
  </div></section>
  <section class="ai-markdown-table-card"><div class="ai-markdown-table-scroll">
  <table>
    <thead><tr><th>可选上架细分类目</th><th>类目月均搜索流量</th><th>平台流量/准入说明</th><th>广告CPC估算</th><th>类目竞争强度</th><th>推荐优先级</th><th>依据</th></tr></thead>
    <tbody>
      <tr><td>Pet Supplies &gt; Cats &gt; Toys &gt; Electronic Toys</td><td>≈45,000</td><td>主类目，流量最大，需合规</td><td>$0.85</td><td>高</td><td>首选</td><td>精准匹配产品功能</td></tr>
      <tr><td>Pet Supplies &gt; Cats &gt; Toys &gt; Laser Toys</td><td>≈28,000</td><td>子类目，转化率高</td><td>$0.75</td><td>中</td><td>首选</td><td>更精准，竞争略低</td></tr>
    </tbody>
  </table>
  </div></section>
</div>
</div></div>
<script>${bundle}</script>
`

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  await page.setContent(fixture)
  await page.evaluate(() => window.__enhance.enhanceReportDom(document.getElementById('root')))
  await page.waitForTimeout(200)
  const out = path.resolve(__dirname, 'table-enhance-visual.png')
  await page.screenshot({ path: out, fullPage: true })
  console.log('screenshot:', out)
  await browser.close()
})()
