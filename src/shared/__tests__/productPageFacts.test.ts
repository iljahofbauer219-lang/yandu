import { describe, expect, it } from 'vitest'
import { cleanPageDescriptionText, parseProductPageFacts } from '../productPageFacts'

const PAGE_HTML = `
<body><div class="pp-wrap">
<section class="pp-gallery"><input type="radio" name="pp-g" id="pp-g-1" checked><div class="pp-stage"><img class="pp-shot pp-shot-1" src="assets/i-01.jpg" alt="x 1"><img class="pp-shot pp-shot-2" src="assets/i-02.png" alt="x 2"></div><div class="pp-thumbs"><label for="pp-g-1"><img class="pp-shot pp-shot-1" src="assets/i-01.jpg" alt="x 1"></label></div></section>
<section class="pp-desc pp-spec-section"><b>产品规格</b><table class="pp-specs"><tbody>
<tr><th scope="row">材质</th><td>PVC 皮革</td></tr>
<tr><th scope="row">颜色</th><td>红色缝线</td></tr>
</tbody></table></section>
<table class="pp-specs pp-fees"><tbody><tr><th scope="row">物流费</th><td>$23.35</td></tr></tbody></table>
<div class="pp-spec-groups"><section class="pp-spec-group"><b>参数组</b><div class="pp-spec-grid"><div><span>可售库存:</span>21</div></div></section></div>
<section class="pp-desc pp-features"><b>产品特点</b><ul><li>可调节滑轨</li><li> recline 靠背 </li></ul></section>
<section class="pp-desc"><b>图文描述</b><p>2件装桶形赛车座椅。</p><table class="pp-desc-table"><tbody><tr><td>含安装工具</td></tr></tbody></table></section>
</div></body>`

describe('服务器产品页事实解析', () => {
  it('规格/特点/图文描述入事实，费用表排除', () => {
    const facts = parseProductPageFacts(PAGE_HTML)
    expect(facts.specs).toEqual([
      { key: '材质', value: 'PVC 皮革' },
      { key: '颜色', value: '红色缝线' },
      { key: '可售库存', value: '21' }
    ])
    expect(facts.features).toEqual(['可调节滑轨', 'recline 靠背'])
    expect(facts.imageAssets).toEqual(['i-01.jpg', 'i-02.png'])
    expect(facts.descriptionText).toContain('2件装桶形赛车座椅。')
    expect(facts.descriptionText).toContain('含安装工具')
    expect(JSON.stringify(facts)).not.toContain('物流费')
  })

  it('空页面不产出事实', () => {
    const facts = parseProductPageFacts('<html><body></body></html>')
    expect(facts.specs).toEqual([])
    expect(facts.features).toEqual([])
    expect(facts.descriptionText).toBe('')
    expect(facts.imageAssets).toEqual([])
  })

  it('pp-videos 块解析出视频资产文件名', () => {
    const facts = parseProductPageFacts('<div class="pp-videos"><video controls preload="metadata" src="assets/v-01.mp4"></video><video controls src="assets/v-02.mp4"></video></div>')
    expect(facts.videoAssets).toEqual(['v-01.mp4', 'v-02.mp4'])
  })

  it('无视频块时 videoAssets 为 undefined', () => {
    const facts = parseProductPageFacts(PAGE_HTML)
    expect(facts.videoAssets).toBeUndefined()
  })

  it('描述行剔除原站导航碎片', () => {
    const cleaned = cleanPageDescriptionText('帮助中心\nBuyer中心\n消息中心(3)\n2件装桶形赛车座椅，含安装工具。\nUSA / $\nPVC 皮革材质')
    expect(cleaned.split('\n')).toEqual(['2件装桶形赛车座椅，含安装工具。', 'USA / $', 'PVC 皮革材质'])
  })

  it('描述行剔除成本侧栏行（单价/打包费/运费/物流费/预估总额/库存/时效/素材包/文件）', () => {
    const cleaned = cleanPageDescriptionText('单价(件) $235.00\n打包费 $3.90\n运费 $19.45~$61.90\n物流费 $23.35~$65.80 /件\n预估总额(含物流费) $282.68 /件\n可售库存 18\n一件代发时效 1-3个工作日\n下载素材包：已被下载 19 次\n文件\n座椅采用优质PVC皮革包裹，营造奢华赛车风格。')
    expect(cleaned.split('\n')).toEqual(['座椅采用优质PVC皮革包裹，营造奢华赛车风格。'])
  })
})
