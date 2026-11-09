import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 唯一真值源 = eBay 现网修改页逐段布局取证（2026-11-09，~/.yandu-acceptance/2026-11-09-R4/
 * P1-ebay-layout.json、P2-ebay-detail.json、P3-bands.json）。取证到的硬事实：
 *   · 内容列 DIV.root 居中 max-width:1024px、基准字号 14px、正文色 rgb(25,25,25)；
 *   · 段序 Photos & Video → Title → Item category → Variations → Item specifics → Condition
 *     → Description → Pricing → Shipping → Item disclosures（段名无数字编号）；
 *   · 每段 = 段名在左 + 文本动作在右（See photo options / See title options / Edit / See pricing options，x≈1170）；
 *   · 计数与字符数真实存在：10/25、72/80、8/50、0/800；
 *   · SKU 在 Title 段内以开关 + 输入框出现（Custom label (SKU)），不在状况段；
 *   · Item category 是左右两栏（左 eBay Item category、右 Store category）；
 *   · Item specifics = 建议属性勾选卡 + Apply all + 逐行「标签左 / 控件右 405px」+ Show more；
 *   · Quantity 与 Payment policy 归 Pricing 段，Item location 与 Return policy 归 Shipping 段的 Preferences。
 * 上一版只把自家卡片按顺序重排了一遍，段内几何与控件形态一律没动，被判定「没做好」；
 * 所以这里同时锁段序与段内结构标记：顺序漂了、或结构没落地，都必红。
 */
const source = readFileSync(path.join(__dirname, '..', 'EbayLocalListingEditor.tsx'), 'utf8')
// 组件名在文件顶部有 import，顺序断言必须只看 <main> 之后的 JSX 正文
const body = source.slice(source.indexOf('<main'))

const h2Sequence = () => [...body.matchAll(/<h2>([^<]+)<\/h2>/g)].map(match => match[1].trim())

/** 按段起始锚点切出该段源码：每个 `<section>` 都以自己的 id 打头，故用 id 做段界最稳。 */
const band = (name: string) => {
  const start = body.indexOf(`id="ebay-revise-${name}"`)
  expect(start, `段 ${name} 的锚点必须存在`).toBeGreaterThan(-1)
  const rest = body.slice(start)
  const next = rest.indexOf('id="ebay-revise-', 20)
  return next === -1 ? rest : rest.slice(0, next)
}

describe('本地产品编辑器 · 逐段复刻 eBay 现网修改页布局', () => {
  it('段序与 eBay 一致且不带数字编号（真页段名是 PHOTOS & VIDEO 这类，没有 01/02）', () => {
    expect(h2Sequence()).toEqual([
      '图片与视频',
      '标题',
      '类目',
      '变体',
      '类目属性',
      '状况',
      '描述',
      '定价',
      '运输与所在地',
      '其他 eBay 刊登选项'
    ])
    expect(body).not.toMatch(/<h2>\d{2}\s/)
    expect((body.match(/id="ebay-revise-/g) || []).length).toBe(10)
  })

  it('每一段都是「段名左 + 动作或读数右」的行式段头（eBay 段头几何，不是卡片右上角胶囊）', () => {
    expect((body.match(/className="ebay-revise-band-head"/g) || []).length).toBe(10)
    expect((body.match(/data-ebay-slot="section-action"/g) || []).length).toBe(10)
  })

  it('图片段复刻计数行与瓦片条（10/25 同位读数 + 小瓦片条 + 空位上传瓦片）', () => {
    const media = band('media')
    expect(media).toContain('data-ebay-counter="photos"')
    expect(media).toContain('className="ebay-photo-strip"')
    expect(media).toContain('className="ebay-photo-add"')
    // eBay 的每块瓦片都带删除，主图动作叫 Main
    expect(media).toContain('设为主图')
    expect(media).toContain('aria-label="删除媒体"')
  })

  it('标题段内 SKU 以开关 + 输入框出现，并带真页同位的字符数（eBay 的 Custom label 就在 Title 段）', () => {
    const title = band('title')
    expect(title).toContain('role="switch"')
    expect(title).toContain('data-ebay-counter="title"')
    expect(title).toContain('data-ebay-counter="sku"')
    expect(title).toContain('draft.sku')
    expect(title).toContain('maxLength={50}')
  })

  it('数量与刊登格式、付款政策都落在定价段（eBay 把 Quantity 与 Payment policy 归 Pricing）', () => {
    const pricing = band('pricing')
    expect(pricing).toContain("item.name==='quantity'")
    expect(pricing).toContain("'listingFormat'")
    expect(pricing).toContain('data-policy-kind="payment"')
    expect(pricing).toContain('className="ebay-pricing-aside"')
    expect(pricing).toContain('价格必须是大于 0')
  })

  it('状况段只剩 eBay 的 Item condition（上一版把数量/SKU 混在状况里，与真页不符）', () => {
    const condition = band('condition')
    expect(condition).toContain("item.name==='condition'")
    expect(condition).not.toContain('draft.sku')
    expect(condition).not.toContain('quantity')
  })

  it('类目属性段复刻建议勾选卡 + 全部采用 + 逐行「标签左/控件右」+ 显示更多', () => {
    const specifics = band('specifics')
    expect(specifics).toContain('className="ebay-specific-suggestions"')
    expect(specifics).toContain('全部采用')
    expect(specifics).toContain('className="ebay-specific-row"')
    expect(specifics).toContain('显示更多')
  })

  it('类目段是左右两栏，平台类目在左、店铺类目在右', () => {
    const category = band('category')
    expect(category).toContain('data-ebay-col="left"')
    expect(category).toContain('data-ebay-col="right"')
    expect(category.indexOf('CustomCategoryDropdown')).toBeLessThan(category.indexOf('aria-label="本地产品类目"'))
  })

  it('运输与所在地段含运输/退货政策、所在地读数与政策读取载体（eBay 的 Preferences/Your settings 位）', () => {
    const shipping = band('policies')
    expect(shipping).toContain('data-policy-kind="shipping"')
    expect(shipping).toContain('data-policy-kind="return"')
    expect(shipping).toContain('itemLocation')
    expect(shipping).toContain('postalCode')
    expect(shipping).toContain('data-policy-carrier')
    expect(shipping).toContain('className="ebay-your-settings"')
  })

  it('变体段与其他选项段是同位说明条：eBay 有段而无本地字段支撑的，如实说明而不臆造控件', () => {
    expect(band('variations')).toContain('className="ebay-note-band"')
    expect(band('others')).toContain('className="ebay-note-band"')
    expect(body).not.toContain('接受出价')
    expect(body).not.toContain('Allow offers')
  })

  it('门禁跳转的 section 键都指向真实存在的锚点（数量与格式→pricing、SKU→title、状况→condition、邮编→policies）', () => {
    const validate = source.slice(source.indexOf('function validateDraft'), source.indexOf('function mediaUrl'))
    expect(validate).toContain("error('pricing','数量必须是大于 0 的整数')")
    expect(validate).toContain("error('pricing','刊登格式只能是")
    expect(validate).toContain("error('title','自定义编号（SKU）不能超过 50 个字符')")
    expect(validate).not.toContain("'form'")
    for (const key of ['media', 'title', 'description', 'pricing', 'policies']) {
      expect(body).toContain(`id="ebay-revise-${key}"`)
    }
  })
})
