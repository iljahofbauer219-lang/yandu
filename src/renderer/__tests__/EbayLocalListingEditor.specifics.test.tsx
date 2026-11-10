import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import EbayLocalListingEditor from '../EbayLocalListingEditor'
import type { EbayItemSpecificSlot, EbaySuggestedSpecificsCard } from '../../shared/ebayItemSpecificsModel'
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
  name: '', group: 'ESSENTIAL', groupLabel: '', control: 'MENU', required: false, placeholder: 'Search or enter your own',
  placeholderShown: '', maxLength: 0, value: '', suggested: '', counter: '', meta: '', metaKind: '', options: [], y: 0, ...patch
})

// placeholderShown 一律照 shared 的判据填：菜单行画线上原值（没原值就空），输入行画自身占位原文。
const SLOTS: EbayItemSpecificSlot[] = [

  slot({ name: 'Brand', required: true, value: 'Unbranded', placeholderShown: 'Unbranded', y: 1547 }),
  slot({ name: 'Type', placeholderShown: '', y: 1603 }),
  slot({ name: 'Model', control: 'TEXT', placeholder: 'Enter your own', placeholderShown: 'Enter your own', suggested: 'Suzuki Grand Vitara II 2.0 J20A 95200-64JB1 95200-64JB0', y: 1659 }),
  slot({ name: 'Item Width', group: 'OPTIONAL', placeholderShown: '', y: 2046 }),
  slot({ name: 'California Prop 65 Warning', group: 'OPTIONAL', control: 'TEXTAREA', placeholder: 'Enter your own', placeholderShown: 'Enter your own', maxLength: 800, counter: '0/800', y: 2773 }),
  slot({ name: 'UPC', group: 'OPTIONAL', control: 'TEXT', placeholder: '', placeholderShown: '', value: 'Does not apply', y: 3201 })
]

const sectionOf=(slots: typeof SLOTS, extra: Record<string, unknown>={}) => ({ slots, groups: [] as Array<{ name: string; blurb: string }>, toggleExpandedText: '', toggleCollapsedText: '', customActionText: '', collapsedSlotNames: [] as string[], ...extra })

/** 2026-11-09 15:17 现网 ITEM SPECIFICS 段顶部的 eBay.ai 建议卡（截图 R6/C01-ebay-live-item-specifics.png），条件渲染、重载后可能不再出现。 */
const CARD: EbaySuggestedSpecificsCard = {
  title: 'Suggested item specifics',
  blurb: 'Quickly add item specifics using info from your photos and title, powered by eBay.ai—this helps buyers find your item faster.',
  items: [
    { name: 'Year Manufactured', value: '2020', checked: false },
    { name: 'Number of Compressors', value: '1', checked: false }
  ],
  applyAll: 'Apply all'
}

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

/** React 输出的属性顺序不是测试对象：按 name 取整枚 input/textarea 标签，再断言同标签内的其它属性。 */
const controlTag = (band: string, name: string) =>
  (band.match(new RegExp(`<(?:input|textarea)[^>]*name="${name}"[^>]*>`)) ?? [])[0] ?? ''

describe('EbayLocalListingEditor · 05 类目属性段（现网清单态）', () => {
  it('读到清单就按现网两个分组渲染，行序照清单序', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSection: sectionOf(SLOTS) })} />))
    const heads = [...band.matchAll(/<h3[^>]*>([^<]+)<\/h3>/g)].map(match => match[1])
    expect(heads).toEqual(['Essential', 'Optional'])
    const names = [...band.matchAll(/class(?:Name)?="ebay-specific-label[^"]*"[^>]*>([^<]+)/g)].map(match => match[1])
    expect(names.slice(0, 6)).toEqual(['Brand', 'Type', 'Model', 'Item Width', 'California Prop 65 Warning', 'UPC'])
  })

  it('必填星号只给现网标了必填的行，别的行一个都不加', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSection: sectionOf(SLOTS) })} />))
    const starred = [...band.matchAll(/<span class(?:Name)?="ebay-specific-label([^"]*)"[^>]*>([^<]+)</g)]
      .filter(match => /required/.test(match[1])).map(match => match[2])
    expect(starred).toEqual(['Brand'])
    expect(band).toContain('aria-label="eBay 必填属性"')
  })

  it('菜单槽是同形读数框：照现网画法只画选中值、不画 eBay 的检索占位，也绝不渲染候选列表', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [] }), { attributeSection: sectionOf(SLOTS) })} />))
    expect(band).toContain('class="ebay-specific-menu"')
    expect(band).toContain('class="ebay-specific-menu-caret"')
    // 现网箭头是 <svg class="icon icon--16"> 的 16×16，渲染出来就是同一形状，不再拿文字三角凑数
    expect(band).toMatch(/<svg class="ebay-specific-menu-caret" viewBox="0 0 16 16" width="16" height="16"/)
    // 现网菜单按钮只画选中值：Brand 画 Unbranded，Type 没选中就什么都不画
    expect(controlTag(band, 'Brand')).toContain('placeholder="Unbranded"')
    expect(controlTag(band, 'Type')).toContain('placeholder=""')
    expect(band).not.toContain('placeholder="Search or enter your own"')
    expect(band).not.toContain('<select')
    expect(band).not.toContain('<option')
    expect(band).not.toMatch(/role="listbox"|role="combobox"/)
  })

  it('菜单槽的线上原值画黑字不画占位灰：现网 fake-menu-button 实测 color rgb(25,25,25)', () => {
    // 真机取证 2026-11-09 19:52：现网 Brand 按钮 shownText=Unbranded、color:rgb(25,25,25)、font 14/400，
    // 而 Model 这类输入框的 placeholderColor 才是 rgb(112,112,112)。同形读数框把线上原值当占位画会整块变灰。
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [] }), { attributeSection: sectionOf(SLOTS) })} />))
    expect(controlTag(band, 'Brand')).toContain('ebay-specific-menu-input--live')
    // 只有菜单行的线上原值走黑字；输入行仍按现网占位灰，不给它挂这个标记。
    expect(controlTag(band, 'Model')).not.toContain('ebay-specific-menu-input--live')
    expect(controlTag(band, 'Type')).not.toContain('ebay-specific-menu-input--live')
  })

  it('本地已记录的同名值优先显示，eBay 线上原值另起一行如实标出，不冒充本地值', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSection: sectionOf(SLOTS) })} />))
    expect(band).toMatch(/name="Brand"[\s\S]{0,160}?value="OEM"/)
    expect(band).toContain('eBay 线上原值：Unbranded')
    // 逐行切片断言：现网该行没值（Item Width）就绝不冒出「eBay 线上原值」，有值（UPC）就如实标出，不整段一刀切。
    const rows = band.split('ebay-specific-row--slot').slice(1)
    const rowOf = (name: string) => rows.find(chunk => chunk.includes(`name="${name}"`)) ?? ''
    expect(rowOf('Item Width')).not.toContain('eBay 线上原值：')
    expect(rowOf('UPC')).toContain('eBay 线上原值：Does not apply')
  })

  it('长文本槽是 textarea，计数按当前长度/现网 maxLength 现算，不照抄页面原文的 0/800', () => {
    const empty = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [] }), { attributeSection: sectionOf(SLOTS) })} />))
    expect(empty).toContain('<textarea')
    expect(empty).toMatch(/maxLength="800"/)
    expect(empty).toContain('0/800')
    const typed = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [{ name: 'California Prop 65 Warning', value: 'Warning: cancer risk', source: 'MANUAL' }] }), { attributeSection: sectionOf(SLOTS) })} />))
    expect(typed).toContain('20/800')
  })

  it('建议值只在现网给出建议的行出现，文案与现网同形且点得到', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSection: sectionOf(SLOTS) })} />))
    expect(band).toContain('Suggested: Suzuki Grand Vitara II 2.0 J20A 95200-64JB1 95200-64JB0')
    expect(band).not.toMatch(/Suggested: *<\/|Suggested: *Unbranded/)
    expect(band.match(/ebay-specific-suggested/g)).toHaveLength(1)
  })

  it('本地有但现网清单里没有的属性仍然显示，不静默丢数据', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [{ name: '压缩机类型', value: '涡旋', source: 'SOURCE_PAGE' }] }), { attributeSection: sectionOf(SLOTS) })} />))
    expect(band).toContain('本地已记录但不在现网清单')
    expect(band).toMatch(/name="压缩机类型"[\s\S]{0,160}?value="涡旋"/)
  })

  it('没读到清单时退回本地清单态，且点名「尚未读取」而不是谎报类目没有属性', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSection: sectionOf([]) })} />))
    expect(band).toContain('尚未读取现网类目属性')
    expect(band).toContain('从 Seller Hub 读取政策与类目属性')
    expect(band).not.toContain('class="ebay-specific-menu"')
  })

  it('读回来是空清单时如实点名「这一次没读到槽位」，不混成「还没读过」', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSection: sectionOf([]), attributeSlotsAt: '2026-11-09T06:00:00.000Z' })} />))
    expect(band).toContain('没有回现网类目属性槽位')
    expect(band).toContain('这次读取')
    expect(band).not.toContain('尚未读取现网类目属性')
  })

  it('现网清单态不再挂 6 项截断：现网整段全展开，只有本地清单态才用显示更多', () => {
    const many: EbayItemSpecificSlot[] = Array.from({ length: 12 }, (_, index) => slot({ name: `Attr${index}`, group: index < 2 ? 'ESSENTIAL' : 'OPTIONAL' }))
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [] }), { attributeSection: sectionOf(many) })} />))
    expect(band).toContain('Attr11')
    expect(band).not.toContain('显示更多')
  })

  it('清单带读取时间上屏：槽位只活在本次会话，操作员得知道这份清单是什么时候开页读回的', () => {
    const at = '2026-11-09T06:00:00.000Z'
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSection: sectionOf(SLOTS), attributeSlotsAt: at })} />))
    expect(band).toContain(`现网清单读取于 ${new Date(at).toLocaleString('zh-CN',{hour12:false})}`)
    // 没给时间就绝不编一个「刚刚」，也不把时间行谎报成已读取
    const unstamped = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(), { attributeSection: sectionOf(SLOTS) })} />))
    expect(unstamped).not.toContain('现网清单读取于')
  })
})

describe('EbayLocalListingEditor · 05 段顶部 Suggested item specifics 卡片', () => {
  const bandWith = (over: Partial<ComponentProps<typeof EbayLocalListingEditor>>) =>
    specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [] }), over)} />))

  it('读到卡片就照现网画：标题、说明、逐项建议原文与 Apply all，整块排在 Essential 分组之前', () => {
    const band = bandWith({ attributeSection: sectionOf(SLOTS), suggestedCard: CARD })
    expect(band).toContain('Suggested item specifics')
    expect(band).toContain('powered by eBay.ai')
    expect(band).toContain('Year Manufactured: 2020')
    expect(band).toContain('Number of Compressors: 1')
    expect(band).toContain('Apply all')
    expect(band.indexOf('ebay-specifics-ai-card')).toBeLessThan(band.indexOf('>Essential<'))
  })

  it('逐项建议画成勾选框行，选中态照抄现网原文：这张草稿上两项都没勾', () => {
    const band = bandWith({ attributeSection: sectionOf(SLOTS), suggestedCard: CARD })
    expect(band.match(/type="checkbox"/g)).toHaveLength(2)
    expect(band).not.toMatch(/type="checkbox"[^>]*checked/)
    // 容器 class 是 items，带引号的 item" 只勾得出逐行 label，不会把容器自己当成第一行
    const rows = band.split('ebay-specifics-ai-item"').slice(1, 3)
    expect(rows[0]).toContain('Year Manufactured: 2020')
    expect(rows[1]).toContain('Number of Compressors: 1')
  })

  it('现网勾着的建议项保持勾着上屏，不把用户的勾选态抹平成未勾', () => {
    const band = bandWith({ attributeSection: sectionOf(SLOTS), suggestedCard: { ...CARD, items: [{ ...CARD.items[0], checked: true }, CARD.items[1]] } })
    expect(band).toMatch(/type="checkbox"[^>]*checked/)
  })

  it('没读到卡片就一块都不画：绝不凭标题拼一张假卡片出来', () => {
    const band = bandWith({ attributeSection: sectionOf(SLOTS) })
    expect(band).not.toContain('Suggested item specifics')
    expect(band).not.toContain('Apply all')
    expect(band).not.toContain('ebay-specifics-ai-card')
  })

  it('Apply all 只在现网有这句原文时出现，其余卡片内容照旧', () => {
    const band = bandWith({ attributeSection: sectionOf(SLOTS), suggestedCard: { ...CARD, applyAll: '' } })
    expect(band).not.toContain('Apply all')
    expect(band).toContain('Year Manufactured: 2020')
  })

  it('卡片只在操作员明确点/勾时才写值：勾选框与按钮都带上要写的属性名', () => {
    const band = bandWith({ attributeSection: sectionOf(SLOTS), suggestedCard: CARD })
    expect(band).toMatch(/name="Year Manufactured"/)
    expect(band).toMatch(/name="Number of Compressors"/)
    expect(band).toContain('ebay-specifics-ai-apply')
    // 卡片里的建议值不许预先落进属性行：Year Manufactured 在清单里没这一行，本地也不该凭空多出值
    expect(band).not.toMatch(/value="2020"/)
  })

  it('标题与说明是两块元素：现网说明是灰色独立一段，不许折进加粗标题里', () => {
    const band = bandWith({ attributeSection: sectionOf(SLOTS), suggestedCard: CARD })
    expect(band).toMatch(/ebay-specifics-ai-title">Suggested item specifics<\/h4>/)
    expect(band).toMatch(/<p class="ebay-specifics-ai-blurb">Quickly add item specifics/)
  })
})

describe('EbayLocalListingEditor · 05 段接线（App.tsx 会话状态，不落库）', () => {
  const appSource = () => readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

  it('槽位清单与建议卡按产品 id 存在同一份会话状态里，两个编辑器调用点都接上清单、卡片与读取时间', () => {
    const app = appSource()
    expect(app).toContain('useState<Record<string,{section:EbayItemSpecificsSection;card:EbaySuggestedSpecificsCard|null;at:string}>>({})')
    const callSites = app.split('\n').filter(line => line.includes('<EbayLocalListingEditor'))
    expect(callSites).toHaveLength(2)
    callSites.forEach(line => {
      expect(line).toContain('attributeSection={')
      expect(line).toContain('attributeSlotsAt={')
      expect(line).toContain('suggestedCard={')
    })
  })

  it('读取成功即把现网槽位、建议卡与 inspectedAt 一起入会话状态；切店铺即清空（清单不落库，重启后要再读一次）', () => {
    const app = appSource()
    const reader = app.slice(app.indexOf('const readBusinessPoliciesFor='))
    const body = reader.slice(0, reader.indexOf('const localCategoryBackfillAttempted'))
    expect(body).toContain('requirements.attributeSection')
    expect(body).toContain('card:requirements.suggestedCard')
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

  it('读数框把箭头做成现网那枚 16×16 chevron 的原形，值仍由 input 承载', () => {
    expect(source()).toContain('ebay-specific-menu')
    expect(source()).toContain('ebay-specific-menu-caret')
    // 现网是 <svg class="icon icon--16"> 16×16，不是文字三角；页内仍不伪造候选列表
    expect(source()).toMatch(/<svg[^>]*ebay-specific-menu-caret/)
    expect(source()).not.toContain('>▾<')
    expect(css()).toMatch(/\.ebay-specific-menu\{[^}]*position:relative/)
    const caret = (css().match(/\.ebay-specific-menu-caret\{[^}]*\}/g) ?? []).join('')
    expect(caret).toContain('width:16px')
    expect(caret).toContain('height:16px')
    expect(caret).toContain('right:20px')
  })

  it('菜单控件照现网按钮实测画：灰底 #f7f7f7、0.6px #8f8f8f 边框、8px 圆角、40 高、左 20px、14px 字号', () => {
    const menu = (css().match(/\.ebay-specific-menu input\{[^}]*\}/g) ?? []).join('')
    for (const declaration of ['background:#f7f7f7', 'border:.6px solid #8f8f8f', 'border-radius:8px', 'height:40px', 'padding:0 36px 0 20px', 'font-size:14px', 'color:#191919']) {
      expect(menu, declaration).toContain(declaration)
    }
  })

  it('菜单槽线上原值的占位色改画现网按钮字色 #191919，并挂段落 id 才不被全局占位样式顶掉', () => {
    // 真机取证 2026-11-09 19:52：现网 fake-menu-button 的 shownText 是按钮自身文字（color rgb(25,25,25)），
    // 只有 textbox__control 的 placeholder 才是 rgb(112,112,112)。同形读数框用 placeholder 承载线上原值，
    // 不显式改色就会整块画成占位灰，与真页一眼就能看出差别。
    const live = (css().match(/#ebay-revise-specifics[^{]*ebay-specific-menu-input--live[^{]*\{[^}]*\}/g) ?? []).join('')
    expect(live, '缺少段落 id 作用域的菜单原值配色规则').toContain('color:#191919')
    expect(live).toContain('::placeholder')
  })

  it('镜像段的控件抬到区块 id 特异性，才压得住全局可读性层的 (0,2,1) input 规则', () => {
    // 真机取证 2026-11-09 17:52：ui-readability.css 的 input:not([type=checkbox]):not([type=radio]) 把
    // .ebay-specific-menu input 的 padding/font-size 全覆盖掉了，实测值 0 12px / 13px。
    expect(readFileSync(path.resolve(process.cwd(), 'src/renderer/ui-readability.css'), 'utf8')).toMatch(/input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\),select\{/)
    const scoped = (css().match(/#ebay-revise-specifics[^{]*input[^{]*\{[^}]*\}/g) ?? []).join('')
    expect(scoped, '缺少区块 id 作用域的 input 规则').toContain('font-size:14px')
    expect(scoped).toContain('padding:0 36px 0 20px')
  })

  it('建议卡每条规则都挂在段落 id 下：现网 14px 才压得住 .ebay-platform-page :where(label,p) 的 12px', () => {
    // 真机取证 2026-11-09 18:59：全局那条 (0,1,0) 排在镜像段样式之后，同特异度按顺序取胜，
    // 勾选项与说明行实测被顶回 12px。
    const readability = readFileSync(path.resolve(process.cwd(), 'src/renderer/ui-readability.css'), 'utf8')
    expect(readability).toMatch(/\.ebay-platform-page :where\(label,summary\)\{font-size:12px/)
    for (const selector of ['.ebay-specifics-ai-card', '.ebay-specifics-ai-title', '.ebay-specifics-ai-blurb', '.ebay-specifics-ai-items', '.ebay-specifics-ai-item', '.ebay-specifics-ai-item input', '.ebay-specifics-ai-apply']) {
      expect(css(), `${selector} 未挂段落 id`).toContain(`#ebay-revise-specifics ${selector}{`)
    }
  })

  it('镜像段控件清掉全局 input 的 5px 上外边距：现网实测控件顶与行顶偏移 0', () => {
    // 真机取证 2026-11-09 19:02：现网 6 行 fake-menu-button/input 的 controlTop-fieldTop 全是 0（Model 行 1px），
    // styles.css 那条裸 input{margin-top:5px} 只声明 margin，镜像规则不写它就静默生效。
    const legacy = readFileSync(path.resolve(process.cwd(), 'src/renderer/styles.css'), 'utf8')
    expect(legacy).toMatch(/\}\s*input\s*\{[^}]*margin-top:5px/)
    const scoped = (css().match(/#ebay-revise-specifics[^{]*(input|textarea)[^{]*\{[^}]*\}/g) ?? []).join('')
    expect(scoped, '缺少 margin:0').toContain('margin:0')
  })

  it('建议卡照现网卡片实测画：透明底、0.6px #e5e5e5 描边、8px 圆角、24px 16px 内边距、外边距 8px 0 32px', () => {
    const card = (css().match(/\.ebay-specifics-ai-card\{[^}]*\}/g) ?? []).join('')
    for (const declaration of ['background:transparent', 'border:.6px solid #e5e5e5', 'border-radius:8px', 'padding:24px 16px', 'display:block', 'margin:8px 0 32px']) {
      expect(card, declaration).toContain(declaration)
    }
  })

  it('卡片标题与说明的间距照现网两段 <p> 实测：上 3px 下 3px，再叠外层提示块的 8px 上下外边距', () => {
    // 现网：提示块 margin 8px 0、p margin 3px 0；镜像段没有提示块这一层，把它的外边距并进 p 的 margin。
    const title = (css().match(/\.ebay-specifics-ai-title\{[^}]*\}/g) ?? []).join('')
    for (const declaration of ['font-size:14px', 'font-weight:600', 'line-height:20px', 'margin:11px 0 3px']) {
      expect(title, declaration).toContain(declaration)
    }
    const blurb = (css().match(/\.ebay-specifics-ai-blurb\{[^}]*\}/g) ?? []).join('')
    for (const declaration of ['font-size:14px', 'line-height:20px', 'color:#707070', 'margin:3px 0 11px']) {
      expect(blurb, declaration).toContain(declaration)
    }
  })

  it('逐项建议按现网 auto-fit 网格排开，勾选框 18×18、条目自身上 16 右 24，不加现网没有的主题色', () => {
    expect(css()).toMatch(/\.ebay-specifics-ai-items\{[^}]*grid-template-columns:repeat\(auto-fit,minmax\(280px,max-content\)\)/)
    expect(css()).toMatch(/\.ebay-specifics-ai-items\{[^}]*margin:0 2px/)
    const item = (css().match(/\.ebay-specifics-ai-item\{[^}]*\}/g) ?? []).join('')
    expect(item).toContain('font-size:14px')
    expect(item).toContain('gap:12px')
    expect(item).toContain('display:flex')
    expect(item).toContain('margin:16px 24px 0 0')
    const box = (css().match(/\.ebay-specifics-ai-item input\{[^}]*\}/g) ?? []).join('')
    expect(box).toContain('width:18px')
    expect(box).toContain('height:18px')
    expect(box).not.toContain('accent-color')
  })

  it('Apply all 按现网 strong 的读画笔：14px 700 #191919 下划线，不带按钮底', () => {
    const apply = (css().match(/\.ebay-specifics-ai-apply\{[^}]*\}/g) ?? []).join('')
    for (const declaration of ['font-size:14px', 'font-weight:700', 'color:#191919', 'text-decoration:underline', 'background:none', 'margin-top:16px']) {
      expect(apply, declaration).toContain(declaration)
    }
  })
})

describe('EbayLocalListingEditor · 05 段 AddItem 现网形状镜像', () => {
  const pillSlot = { name: 'Vintage Part', group: 'OPTIONAL' as const, groupLabel: 'Additional (optional)', control: 'YESNO' as const, required: false, placeholder: '', placeholderShown: '', maxLength: 0, value: '', suggested: '', counter: '', meta: '~ 209 searches', metaKind: 'SEARCH_COUNT' as const, options: [{ text: 'Yes', pressed: false }, { text: 'No', pressed: false }], y: 2177 }
  const trendSlot = { ...pillSlot, name: 'Seat Type', control: 'MENU' as const, options: [], meta: 'Trending', metaKind: 'TRENDING' as const }
  const section = sectionOf([pillSlot, trendSlot], {
    groups: [{ name: 'Required', blurb: 'Buyers need these details to find your item.' }, { name: 'Additional (optional)', blurb: 'Buyers also search for these details.' }],
    toggleExpandedText: 'Show less',
    toggleCollapsedText: 'Show more',
    customActionText: 'Add custom item specific',
    collapsedSlotNames: ['Seat Type']
  })
  it('组标题与说明句照现网原文画，行归到各自组下', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [] }), { attributeSection: section })} />))
    expect(band).toContain('Additional (optional)')
    expect(band).toContain('Buyers also search for these details.')
    expect(band.indexOf('Required')).toBeLessThan(band.indexOf('Vintage Part'))
  })
  it('Yes/No 双 pill 照画且选中态跟本地值走：没值时两个都不压', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [] }), { attributeSection: section })} />))
    const row = band.slice(band.indexOf('Vintage Part'))
    expect(row).toContain('ebay-specific-pills')
    expect(row.match(/ebay-specific-pill[" ]/g)?.length).toBeGreaterThanOrEqual(2)
    expect(row).not.toContain('ebay-specific-pill--on')
  })
  it('标签旁 meta 照抄：搜索量与 Trending 两类画法分开', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [] }), { attributeSection: section })} />))
    expect(band).toContain('ebay-specific-meta--trending')
    expect(band).toContain('~ 209 searches')
  })
  it('折叠开关与加属性按钮照抄原文：读回折叠态行名时开关才可点', () => {
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [] }), { attributeSection: section })} />))
    expect(band).toContain('Show less')
    expect(band).toContain('Add custom item specific')
    const toggle = band.slice(band.indexOf('ebay-specific-toggle'))
    expect(toggle.slice(0, toggle.indexOf('</button>'))).not.toContain('disabled')
  })
  it('没读回折叠态行名时开关只当读数画：禁用且不编折叠范围', () => {
    const readOnly = sectionOf([trendSlot], { groups: [], toggleExpandedText: 'Show less', toggleCollapsedText: '', customActionText: '', collapsedSlotNames: [] })
    const band = specificsBand(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({ itemSpecifics: [] }), { attributeSection: readOnly })} />))
    const toggle = band.slice(band.indexOf('ebay-specific-toggle'))
    expect(toggle.slice(0, toggle.indexOf('</button>'))).toContain('disabled')
  })
  it('新形状样式挂段落 id 作用域：pill 半径 20 与灰底照现网实测', () => {
    const live = readFileSync(path.resolve(process.cwd(), 'src/renderer/ebay-local-listing-editor.css'), 'utf8')
    expect(live).toContain('#ebay-revise-specifics .ebay-specific-pill{')
    expect(live).toContain('border-radius:20px')
    expect(live).toContain('.ebay-specific-group-blurb{')
    expect(live).toContain('#ebay-revise-specifics .ebay-specific-meta{')
  })
})

describe('05 段清单持久化与静默自读（D 批接线守卫）', () => {
  const preloadSource = () => readFileSync(path.resolve(process.cwd(), 'src/preload/preload.ts'), 'utf8')
  const mainSource = () => readFileSync(path.resolve(process.cwd(), 'src/main/main.ts'), 'utf8')
  const appSource = () => readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
  it('preload 暴露按产品取持久化清单的通道，读取 IPC 带产品 id', () => {
    expect(preloadSource()).toContain("localProductSpecificsSection: (productId:string)")
    expect(preloadSource()).toContain("localProductRequirements: (storeId:string,listingId:string,title:string,categoryId='',productId='')")
  })
  it('读取成功即按产品落库：section、来源与时间三样一起写，失败只点名不阻断', () => {
    const body = mainSource()
    expect(body).toContain('database.saveEbaySpecificsSection({productId,storeId,section:requirements.attributeSection,sourceUrl:requirements.sourceUrl,readAt:requirements.inspectedAt})')
    expect(body).toContain("ipcMain.handle('ebay:local-products:specifics-section'")
  })
  it('静默自读不切浏览器表面：silent 选项守住 setActiveTab，且每产品每会话至多一次', () => {
    const app = appSource()
    expect(app).toContain("const readBusinessPoliciesFor=async(product:EbayLocalProduct|null,busyKey:string,options:{silent?:boolean}={})=>{")
    expect(app).toContain("if(!options.silent)setActiveTab('browser')")
    expect(app).toContain("specificsAutoReadDone.current[lp.id]=true")
    expect(app).toContain("void readBusinessPoliciesFor(lp,'publish-read-policies',{silent:true})")
  })
  it('进编辑器先库态兜底种子：持久化读取时间直接当段头时间戳，不谎报本次会话读取', () => {
    const app = appSource()
    expect(app).toContain('const persisted=await window.desktop.ebay.localProductSpecificsSection(product.id)')
    expect(app).toContain('{section:persisted.section,card:null,at:persisted.readAt}')
  })
})
