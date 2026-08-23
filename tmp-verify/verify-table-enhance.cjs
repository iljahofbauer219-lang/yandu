// 验证 reportEnhanceDom：字面 <br> 换行 + 空列移除 + 竞品链接真实化（dp 升级/描述列不加链/Tier2 标记）+ 回归项
// 运行：node tmp-verify/verify-table-enhance.cjs
const { chromium } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const fs = require('node:fs')

const bundle = fs.readFileSync('/tmp/report-enhance-bundle.js', 'utf8')

const fixture = `
<div id="root">
  <table>
    <thead><tr><th>竞店/品牌及链接</th><th>代表商品</th><th>店铺定位</th><th>品牌与内容能力</th><th>证据等级</th></tr></thead>
    <tbody>
      <tr><td>PetSafe</td><td>B000WCO7YW</td><td>专业宠物电子</td><td>强（A+、视频、品牌故事）</td><td>A</td></tr>
      <tr><td>FroliCat</td><td>B004QZ6X8K</td><td>猫专用玩具专家</td><td>中（基础A+）</td><td>E</td></tr>
    </tbody>
  </table>
  <table>
    <thead><tr><th>维度</th><th>本品</th><th>竞品1</th><th>竞品2</th><th>竞品3</th></tr></thead>
    <tbody>
      <tr><td>综合竞争力/威胁等级</td><td>待验证</td><td>极高</td><td>高</td><td>中低</td></tr>
      <tr><td>🔗 商品/品牌链接</td><td>—</td><td><a href="https://www.amazon.com/s?k=PetSafe">PetSafe</a></td><td><a href="https://www.amazon.com/s?k=FroliCat">FroliCat</a></td><td><a href="https://www.amazon.com/s?k=Catit">Catit</a></td></tr>
    </tbody>
  </table>
  <table>
    <thead><tr><th>维度</th><th>内容</th><th></th><th>来源</th></tr></thead>
    <tbody>
      <tr><td>需求价值</td><td>1. 主人不在家时猫咪无聊&lt;br&gt;2. 手动逗猫耗时耗力</td><td></td><td>行业常识</td></tr>
    </tbody>
  </table>
  <pre><code>let x = a&lt;br&gt;b</code></pre>
  <p>头程物流走 FBA 渠道</p>
</div>
<script>${bundle}</script>
`

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setContent(fixture)
  const result = await page.evaluate(() => {
    window.__enhance.enhanceReportDom(document.getElementById('root'))
    const tables = Array.from(document.querySelectorAll('#root table'))
    const hrefOf = (table, row, col) => tables[table].querySelector(`tbody tr:nth-child(${row}) td:nth-child(${col}) a`)?.getAttribute('href') || ''
    const anchorCount = (table, row, col) => tables[table].querySelectorAll(`tbody tr:nth-child(${row}) td:nth-child(${col}) a`).length
    return {
      part4BrandPetSafe: hrefOf(0, 1, 1),
      part4BrandFroliCat: hrefOf(0, 2, 1),
      part4PositioningAnchors: anchorCount(0, 1, 3) + anchorCount(0, 2, 3),
      part4CapabilityAnchors: anchorCount(0, 1, 4) + anchorCount(0, 2, 4),
      part4Evidence: (tables[0].querySelector('tbody tr:nth-child(1) td:nth-child(5)')?.textContent || '').trim(),
      linkRowPetSafe: hrefOf(1, 2, 3),
      linkRowFroliCat: hrefOf(1, 2, 4),
      linkRowCatit: hrefOf(1, 2, 5),
      linkRowCatitResolveMark: tables[1].querySelector('tbody tr:nth-child(2) td:nth-child(5) a')?.dataset.amazonResolve || '',
      linkRowDashAnchors: anchorCount(1, 2, 2),
      brCellBrCount: tables[2].querySelectorAll('tbody td:nth-child(2) br').length,
      brCellLiteral: (tables[2].querySelector('tbody td:nth-child(2)')?.textContent || '').includes('<br'),
      emptyColRemoved: Array.from(tables[2].rows).every(r => r.cells.length === 3),
      codeUntouched: (document.querySelector('#root pre code')?.textContent || '').includes('<br>'),
      glossaryAbbr: document.querySelectorAll('#root p abbr.report-abbr').length
    }
  })
  await browser.close()

  const checks = [
    ['图1：竞店列 PetSafe 升级为 dp 真实商品链', result.part4BrandPetSafe === 'https://www.amazon.com/dp/B000WCO7YW'],
    ['图1：竞店列 FroliCat 升级为 dp 真实商品链', result.part4BrandFroliCat === 'https://www.amazon.com/dp/B004QZ6X8K'],
    ['图1：店铺定位列无链接', result.part4PositioningAnchors === 0],
    ['图1：品牌与内容能力列无链接', result.part4CapabilityAnchors === 0],
    ['回归：证据等级 A → 分析假设', result.part4Evidence === '分析假设'],
    ['图2：链接行 PetSafe 升级为 dp 链', result.linkRowPetSafe === 'https://www.amazon.com/dp/B000WCO7YW'],
    ['图2：链接行 FroliCat 升级为 dp 链', result.linkRowFroliCat === 'https://www.amazon.com/dp/B004QZ6X8K'],
    ['图2：无交叉引用品牌 Catit 保留搜索链接', result.linkRowCatit === 'https://www.amazon.com/s?k=Catit'],
    ['图2：Catit 标记 Tier2 待解析', result.linkRowCatitResolveMark === 'Catit'],
    ['图2：本品列 — 不加链', result.linkRowDashAnchors === 0],
    ['回归：字面 <br> 转真实换行', result.brCellBrCount === 1 && !result.brCellLiteral],
    ['回归：全空列自动移除', result.emptyColRemoved],
    ['回归：代码块 <br> 保持原样', result.codeUntouched],
    ['回归：术语悬停注解生效', result.glossaryAbbr === 1]
  ]
  let failed = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) failed++
  }
  console.log(JSON.stringify(result, null, 2))
  process.exit(failed ? 1 : 0)
})()
