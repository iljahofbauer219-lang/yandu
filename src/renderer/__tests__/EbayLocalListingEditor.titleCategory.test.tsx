import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import EbayLocalListingEditor from '../EbayLocalListingEditor'
import type { EbayLocalProduct, EbayLocalProductUpdateInput } from '../../shared/contracts'
import { formValuesFromInput, requiredFormGaps } from '../../shared/ebayListingForm'

/**
 * 标题段与类目段 = eBay 现网 AddItem 页 TITLE / ITEM CATEGORY 两段的复刻，逐字取自 2026-11-11 的 DOM 导出
 * （~/.yandu-acceptance/2026-11-11-G1/G1-title-category.json 与 G1-title-body.json，draftId=5310629665620&mode=AddItem）。
 * 现网硬事实（未加工）：
 *   · TITLE 段（.summary__title，padding 32px 24px 0）：H2「Title」16px/700 + uppercase；右侧灰胶囊
 *     「See title options」12px/700、bg rgb(247,247,247)、radius 50、h32；字段标签「Item title」14px/400 深色；
 *     输入框外层 .textbox--large：bg rgb(247,247,247)、border 0.6px solid rgb(143,143,143)、radius 8、h46、宽 975；
 *     计数「72/80」12px/400 rgb(112,112,112)，右对齐贴在输入框下方（另有 clipped 读屏文「72 of 80 characters」）。
 *   · ITEM CATEGORY 段（.summary__category，同 padding）：H2「Item category」16px/700 + uppercase；
 *     右侧「Edit」13.33px/400 图标按钮 radius 16；左栏类目值是下划线 fake-link 14px/400，下面一行
 *     .value-secondary 面包屑「in eBay Motors > …」14px/400 rgb(112,112,112)；右栏 H3「Store category」16px/700，
 *     值「家居」同样是下划线 fake-link 14px/400。
 * 用户口径：与图片1红框内容一致，且「上面是英文，下面是标中文对照」。
 * 类目值与面包屑是数据不是文案：照本地存的路径如实画，不编 eBay 的短标签（现网值链「Seats」是 eBay 自己的缩写，本地没有）。
 */

const TITLE = '2PC Universal Bucket Racing Seats PVC Leather Reclinable Red Stitch Pair'
const CATEGORY_PATH = 'eBay Motors > Parts & Accessories > Car & Truck Parts & Accessories > Interior Parts & Accessories > Seats, Parts & Accessories'

const product = { id: 'lp1', storeId: 's1', listingId: 'T1', title: TITLE, imageUrl: '', imageUrls: [], price: '9.9', currency: 'USD', quantity: 12, status: 'ACTIVE', versionCount: 1, updatedAt: '', categoryId: 'home', categoryName: '家居', snapshot: { details: { url: '', itemSpecifics: [], condition: 'New', imageUrls: [], quantity: '12', paymentPolicy: '', shippingPolicy: '', returnPolicy: '', itemLocation: '', postalCode: '', listingFormat: 'FIXED_PRICE', descriptionText: 'x' }, media: [], sourceListing: {} as never, completeness: 100, missingFields: [], contentHash: '', capturedAt: '', id: 'snap1', localProductId: 'lp1', version: 1 } } as unknown as EbayLocalProduct

const draftOf = (over: Partial<EbayLocalProductUpdateInput> = {}): EbayLocalProductUpdateInput => ({
  title: TITLE, descriptionText: 'desc', descriptionHtml: '', price: '9.9', currency: 'USD', media: [],
  quantity: '12', condition: 'New', listingFormat: 'FIXED_PRICE', sku: 'SEAT-001', itemLocation: 'Guangdong, CN', postalCode: '528000',
  itemSpecifics: [], ...over
})

const noop = vi.fn()
const platformCategory = {
  options: [{ categoryId: 'c1', name: CATEGORY_PATH, soldCount: 0 }],
  busy: false, error: '', pick: 'c1', savedId: 'c1', savedName: CATEGORY_PATH,
  setPick: noop, refresh: noop, confirm: noop
}
const props = (draft: EbayLocalProductUpdateInput, over: Partial<ComponentProps<typeof EbayLocalListingEditor>> = {}): ComponentProps<typeof EbayLocalListingEditor> => ({
  inline: true, product, draft, saving: false, uploading: false, preparing: false, readingPolicies: false, businessPolicies: [],
  categories: [{ categoryId: 'home', name: '家居', level: 1 } as never],
  onChange: noop, onSave: noop, onClose: noop, onUpload: noop, onPrepare: noop, onSetCategory: noop, onAutoClassify: noop, onReadPolicies: noop,
  policyCarrierItemId: '189035181453', onPolicyCarrierItemIdChange: noop,
  gaps: requiredFormGaps([], formValuesFromInput(draft)), platformCategory, ...over
})

const html = renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf())} />)
const band = (name: string, next: string) => {
  const start = html.indexOf(`id="ebay-revise-${name}"`)
  expect(start, `段 ${name} 必须存在`).toBeGreaterThan(-1)
  return html.slice(start, html.indexOf(`id="ebay-revise-${next}"`, start))
}
const decode = (value: string) => value.replace(/&amp;/g, '&').replace(/&#x27;/g, "'")
const enLines = (scope: string) => [...scope.matchAll(/class="ebay-en"[^>]*>([^<]*)</g)].map(match => decode(match[1]))
const zhLines = (scope: string) => [...scope.matchAll(/class="ebay-zh"[^>]*>([^<]*)</g)].map(match => decode(match[1]))

const titleBand = band('title', 'category')
const categoryBand = band('category', 'condition').replace(/&amp;/g,'&').replace(/&gt;/g,'>').replace(/&lt;/g,'<')
const css = readFileSync(path.join(__dirname, '..', 'ebay-local-listing-editor.css'), 'utf8')
const source = readFileSync(path.join(__dirname, '..', 'EbayLocalListingEditor.tsx'), 'utf8')

describe('EbayLocalListingEditor · 标题段照现网 TITLE 复刻（英上中下）', () => {
  it('现网原文逐字且按现网顺序：段题 → 标题选项 → 字段标签 → 计数', () => {
    expect(enLines(titleBand)).toEqual(['Title', 'See title options', 'Item title', `${TITLE.length}/80`])
    expect(zhLines(titleBand)).toEqual(['标题', '查看标题选项', '物品标题', `80 个字符中的 ${TITLE.length} 个`])
  })

  it('计数从段头胶囊移到输入框下方同位（现网 72/80 就在框下右对齐），SKU 开关照旧是本地语义', () => {
    expect(titleBand).toContain('ebay-title-counter')
    expect(titleBand).toContain('data-ebay-counter="title"')
    expect(titleBand.indexOf('ebay-title-counter')).toBeGreaterThan(titleBand.indexOf('maxlength="80"'))
    expect(titleBand).toContain('role="switch"')
    expect(titleBand).toContain('data-ebay-counter="sku"')
    expect(titleBand).toContain('自定义编号（SKU）')
  })

  it('CSS 按现网量测：输入框灰底细边圆角 8 高 46、计数 12px 灰、段题 uppercase', () => {
    expect(css).toMatch(/\.ebay-title-input\{[^}]*background:#f7f7f7[^}]*border:\.6px solid #8f8f8f[^}]*border-radius:8px/)
    expect(css).toMatch(/\.ebay-title-counter\{[^}]*font-size:12px[^}]*color:#707070/)
    expect(css).toContain('#ebay-revise-title .ebay-revise-band-head h2,#ebay-revise-category .ebay-revise-band-head h2{text-transform:uppercase}')
  })
})

describe('EbayLocalListingEditor · 类目段照现网 ITEM CATEGORY 复刻（英上中下）', () => {
  it('段题、Edit、Store category 逐字，中文对照紧随其下', () => {
    expect(enLines(categoryBand)).toEqual(['Item category', 'Edit', 'Store category'])
    expect(zhLines(categoryBand)).toEqual(['类目', '编辑', '店铺类目'])
  })

  it('左栏照现网画「值链 + in 开头面包屑」两行，右栏画店铺类目值链；数据照本地存的路径不编短标签', () => {
    const leaf = CATEGORY_PATH.split(' > ').pop() as string
    expect(categoryBand).toContain('class="ebay-value-link"')
    expect(categoryBand).toContain(leaf)
    expect(categoryBand).toContain(`in ${CATEGORY_PATH}`)
    expect(categoryBand).toContain('class="ebay-value-secondary"')
    expect(categoryBand).toContain('家居')
    expect(categoryBand).not.toContain('>Seats<')
  })

  it('本地选择控件照旧保留：平台类目下拉与重新获取/确定、店铺类目 select 与自动分类', () => {
    expect(categoryBand).toContain('aria-label="本地产品类目"')
    expect(categoryBand).toContain('重新获取')
    expect(categoryBand).toContain('确定')
    expect(categoryBand).toContain('自动分类')
  })

  it('CSS 按现网量测：值链下划线 14px、面包屑 14px 灰', () => {
    expect(css).toMatch(/\.ebay-value-link\{[^}]*font-size:14px[^}]*text-decoration:underline/)
    expect(css).toMatch(/\.ebay-value-secondary\{[^}]*font-size:14px[^}]*color:#707070/)
  })

  it('段序守卫不变：现网动作只画文字不做假按钮', () => {
    expect(source).toContain('ebay-band-action-pill')
    expect(source).not.toContain('<button type="button" className="ebay-band-action-pill"')
  })
})
