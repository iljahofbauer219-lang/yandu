import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import EbayLocalListingEditor from '../EbayLocalListingEditor'
import type { EbayItemSpecificSlot } from '../../shared/ebayItemSpecificsModel'
import type { EbayLocalProduct, EbayLocalProductUpdateInput } from '../../shared/contracts'
import { formValuesFromInput, requiredFormGaps } from '../../shared/ebayListingForm'

/**
 * 05 类目属性段的「现网清单态」——按 2026-11-09 draftId=5306791224420 的 ITEM SPECIFICS 真页逐行钉住：
 * 两个 h3 分组（Essential / Optional）、只有 Brand 带必填星号、下拉是菜单按钮形状但绝不伪造候选列表、
 * Model 与 Voltage 下方有可点建议值、California Prop 65 Warning 是带 0/800 计数的 textarea、
 * UPC 行显示 eBay 线上原值。fixtures 全部照 R5-rows.json / R5-section.json 抄，不含任何编造取值。
 */

const product = { id: 'lp1', storeId: 's1', listingId: 'T1', title: 'Air Conditioner', imageUrl: '', imageUrls: [], price: '9.9', currency: 'USD', quantity: 12, status: 'ACTIVE', versionCount: 1, updatedAt: '', categoryId: '', categoryName: '', snapshot: { details: { url: '', itemSpecifics: [], condition: 'New', imageUrls: [], quantity: '12', paymentPolicy: '', shippingPolicy: '', returnPolicy: '', itemLocation: '', postalCode: '', listingFormat: 'FIXED_PRICE', descriptionText: 'x' }, media: [], sourceListing: {} as never, completeness: 100, missingFields: [], contentHash: '', capturedAt: '', id: 'snap1', localProductId: 'lp1', version: 1 } } as unknown as EbayLocalProduct

const slot = (patch: Partial<EbayItemSpecificSlot>): EbayItemSpecificSlot => ({
  name: '', group: 'ESSENTIAL', control: 'MENU', required: false, placeholder: 'Search or enter your own', maxLength: 0, value: '', suggested: '', counter: '', y: 0, ...patch
})

const SLOTS: EbayItemSpecificSlot[] = [
  slot({ name: 'Brand', required: true, value: 'Unbranded', y: 1547 }),
  slot({ name: 'Type', y: 1603 }),
  slot({ name: 'Model', control: 'TEXT', placeholder: 'Enter your own', suggested: 'Suzuki Grand Vitara II 2.0 J20A 95200-64JB1 95200-64JB0', y: 1659 }),
  slot({ name: 'Item Width', group: 'OPTIONAL', y: 2046 }),
  slot({ name: 'California Prop 65 Warning', group: 'OPTIONAL', control: 'TEXTAREA', placeholder: 'Enter your own', maxLength: 800, counter: '0/800', y: 2773 }),
  slot({ name: 'UPC', group: 'OPTIONAL', control: 'TEXT', placeholder: '', value: 'Does not apply', y: 3201 })
]

const draftOf = (over: Partial<EbayLocalProductUpdateInput> = {}): EbayLocalProductUpdateInput => ({
  title: 'Air Conditioner', descriptionText: 'desc', descriptionHtml: '', price: '9.9', currency: 'USD', media: [],
  quantity: '12', condition: 'New', listingFormat: 'FIXED_PRICE', sku: '', itemLocation: 'Guangdong, CN', postalCode: '528000',
  itemSpecifics: [{ name: 'Brand', value: 'OEM', source: 'SOURCE_PAGE', needsConfirmation: true }],
  ...over
})

const noop = vi.fn()
const props = (draft: EbayLocalProductUpdateInput, over: Partial<ComponentProps<typeof EbayLocalListingEditor>> = {}): ComponentProps<typeof EbayLocalListingEditor> => ({
  inline: true, product, draft, saving: false, uploading: false, preparing: false, readingPolicies: false, businessPolicies: [], categories: [],
  onChange: noop, onSave: noop, onClose: noop, onUpload: noop, onPrepare: noop, onSetCategory: noop, onAutoClassify: noop, onReadPolicies: noop,
  policyCarrierItemId: '189035181453', onPolicyCarrierItemIdChange: noop,
  gaps: requiredFormGaps([], formValuesFromInput(draft)), ...over
})

/** 只截 05 段自身的标记，避免别的段的 <select>/<option> 混进断言。 */
const specificsBand = (html: string) => {
  const start = html.indexOf('id="ebay-revise-specifics"')
  expect(start).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</section>', start))
}

describe('EbayLocalListingEditor · 05 类目属性段（现网清单态）', () => {
  it('读到清单就按现网两个分组渲染，行序照清单序', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSlots: SLOTS })} />))
    const heads = [...band.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map(match => match[1])
    expect(heads).toEqual(['Essential', 'Optional'])
    const names = [...band.matchAll(/class(?:Name)?="ebay-specific-label[^"]*"[^>]*>([^<]+)/g)].map(match => match[1])
    expect(names.slice(0, 6)).toEqual(['Brand', 'Type', 'Model', 'Item Width', 'California Prop 65 Warning', 'UPC'])
  })

  it('必填星号只给现网标了必填的行，别的行一个都不加', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSlots: SLOTS })} />))
    const starred = [...band.matchAll(/<span class(?:Name)?="ebay-specific-label([^"]*)"[^>]*>([^<]+)</g)]
      .filter(match => /required/.test(match[1])).map(match => match[2])
    expect(starred).toEqual(['Brand'])
    expect(band).toContain('aria-label="eBay 必填属性"')
  })

  it('菜单槽是同形读数框：带 eBay 面板占位原文与箭头，绝不渲染候选列表', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSlots: SLOTS })} />))
    expect(band).toContain('class="ebay-specific-menu"')
    expect(band).toContain('placeholder="Search or enter your own"')
    expect(band).toContain('class="ebay-specific-menu-caret"')
    expect(band).not.toContain('<select')
    expect(band).not.toContain('<option')
    expect(band).not.toMatch(/role="listbox"|role="combobox"/)
  })

  it('本地已记录的同名值优先显示，eBay 线上原值另起一行如实标出，不冒充本地值', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSlots: SLOTS })} />))
    expect(band).toMatch(/name="Brand"[\s\S]{0,160}?value="OEM"/)
    expect(band).toContain('eBay 线上原值：Unbranded')
    // 逐行切片断言：现网该行没值（Item Width）就绝不冒出「eBay 线上原值」，有值（UPC）就如实标出，不整段一刀切。
    const rows = band.split('ebay-specific-row--slot').slice(1)
    const rowOf = (name: string) => rows.find(chunk => chunk.includes(`name="${name}"`)) ?? ''
    expect(rowOf('Item Width')).not.toContain('eBay 线上原值：')
    expect(rowOf('UPC')).toContain('eBay 线上原值：Does not apply')
  })

  it('长文本槽是 textarea，计数按当前长度/现网 maxLength 现算，不照抄页面原文的 0/800', () => {
    const empty = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [] }), { attributeSlots: SLOTS })} />))
    expect(empty).toContain('<textarea')
    expect(empty).toMatch(/maxLength="800"/)
    expect(empty).toContain('0/800')
    const typed = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [{ name: 'California Prop 65 Warning', value: 'Warning: cancer risk', source: 'MANUAL' }] }), { attributeSlots: SLOTS })} />))
    expect(typed).toContain('20/800')
  })

  it('建议值只在现网给出建议的行出现，文案与现网同形且点得到', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSlots: SLOTS })} />))
    expect(band).toContain('Suggested: Suzuki Grand Vitara II 2.0 J20A 95200-64JB1 95200-64JB0')
    expect(band).not.toMatch(/Suggested: *<\/|Suggested: *Unbranded/)
    expect(band.match(/ebay-specific-suggested/g)).toHaveLength(1)
  })

  it('本地有但现网清单里没有的属性仍然显示，不静默丢数据', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [{ name: '压缩机类型', value: '涡旋', source: 'SOURCE_PAGE' }] }), { attributeSlots: SLOTS })} />))
    expect(band).toContain('本地已记录但不在现网清单')
    expect(band).toMatch(/name="压缩机类型"[\s\S]{0,160}?value="涡旋"/)
  })

  it('没读到清单时退回本地清单态，且点名「尚未读取」而不是谎报类目没有属性', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSlots: [] })} />))
    expect(band).toContain('尚未读取现网类目属性')
    expect(band).toContain('从 Seller Hub 读取政策与类目属性')
    expect(band).not.toContain('class="ebay-specific-menu"')
  })

  it('读回来是空清单时如实点名「这一次没读到槽位」，不混成「还没读过」', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSlots: [], attributeSlotsAt: '2026-11-09T06:00:00.000Z' })} />))
    expect(band).toContain('没有回现网类目属性槽位')
    expect(band).toContain('这次读取')
    expect(band).not.toContain('尚未读取现网类目属性')
  })

  it('现网清单态不再挂 6 项截断：现网整段全展开，只有本地清单态才用显示更多', () => {
    const many: EbayItemSpecificSlot[] = Array.from({ length: 12 }, (_, index) => slot({ name: `Attr${index}`, group: index < 2 ? 'ESSENTIAL' : 'OPTIONAL' }))
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [] }), { attributeSlots: many })} />))
    expect(band).toContain('Attr11')
    expect(band).not.toContain('显示更多')
  })

  it('清单带读取时间上屏：槽位只活在本次会话，操作员得知道这份清单是什么时候开页读回的', () => {
    const at = '2026-11-09T06:00:00.000Z'
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSlots: SLOTS, attributeSlotsAt: at })} />))
    expect(band).toContain(`现网清单读取于 ${new Date(at).toLocaleString('zh-CN',{hour12:false})}`)
    // 没给时间就绝不编一个「刚刚」，也不把时间行谎报成已读取
    const unstamped = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSlots: SLOTS })} />))
    expect(unstamped).not.toContain('现网清单读取于')
  })
})

describe('EbayLocalListingEditor · 05 段接线（App.tsx 会话状态，不落库）', () => {
  const appSource = () => readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

  it('槽位清单按产品 id 存在会话状态里，两个编辑器调用点都接上清单与读取时间', () => {
    const app = appSource()
    expect(app).toContain('useState<Record<string,{slots:EbayItemSpecificSlot[];at:string}>>({})')
    const callSites = app.split('\n').filter(line => line.includes('<EbayLocalListingEditor'))
    expect(callSites).toHaveLength(2)
    callSites.forEach(line => {
      expect(line).toContain('attributeSlots={')
      expect(line).toContain('attributeSlotsAt={')
    })
  })

  it('读取成功即把现网槽位与 inspectedAt 一起入会话状态；切店铺即清空（清单不落库，重启后要再读一次）', () => {
    const app = appSource()
    const reader = app.slice(app.indexOf('const readBusinessPoliciesFor='))
    const body = reader.slice(0, reader.indexOf('const localCategoryBackfillAttempted'))
    expect(body).toContain('requirements.attributeSlots')
    expect(body).toContain('requirements.inspectedAt')
    expect(body).toContain('setAttributeSlots(current=>({...current,[product.id')
    const reset = app.split('\n').find(line => line.includes('activeStoreIdRef.current=activeStore?.id')) ?? ''
    expect(reset).toContain('setAttributeSlots({})')
  })

  it('提示语跟着新按钮副本走，不再引用旧的「从 Seller Hub 读取政策」', () => {
    const app = appSource()
    expect(app).not.toMatch(/「从 Seller Hub 读取政策」/)
    expect(app).toContain('「从 Seller Hub 读取政策与类目属性」')
  })
})

describe('EbayLocalListingEditor · 05 段样式与真页实测对齐', () => {
  const css = () => readFileSync(path.resolve(process.cwd(), 'src/renderer/ebay-local-listing-editor.css'), 'utf8')
  const source = () => readFileSync(path.resolve(process.cwd(), 'src/renderer/EbayLocalListingEditor.tsx'), 'utf8')

  it('标签列 342px / 控件列 406px / 行距 56px 都按真页实测写死', () => {
    expect(css()).toMatch(/\.ebay-specific-row--slot\{[^}]*grid-template-columns:342px minmax\(0,406px\)/)
    expect(css()).toMatch(/\.ebay-specific-row--slot\{[^}]*gap:0 16px/)
    expect(css()).toMatch(/\.ebay-specific-row--slot\{[^}]*min-height:56px/)
  })

  it('控件显式压掉全局 38/40 最小高度，才可能等于真页的 404×38', () => {
    expect(css()).toMatch(/\.ebay-specific-row--slot (?:input|textarea)[^}]*min-height:0/)
  })

  it('读数框把箭头做成控件内的原文形状，值仍由 input 承载', () => {
    expect(source()).toContain('ebay-specific-menu')
    expect(source()).toContain('ebay-specific-menu-caret')
    expect(css()).toMatch(/\.ebay-specific-menu\{[^}]*position:relative/)
    expect(css()).toMatch(/\.ebay-specific-menu-caret\{[^}]*right:/)
  })
})
