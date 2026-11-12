import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import EbayLocalListingEditor from '../EbayLocalListingEditor'
import type { EbayLocalProduct, EbayLocalProductUpdateInput } from '../../shared/contracts'
import { formValuesFromInput, requiredFormGaps } from '../../shared/ebayListingForm'

/**
 * 中国态口径：eBay 后台已是原生中文，内联编辑器页头与「图片和视频」段须与现网中文刊登页逐字一致
 * （2026-11-12 图1：完成物品刊登 / 图片和视频 / 您最多可添加 40 张图片和一段 1 分钟的视频。买家想要看到所有细节和角度。 /
 * 拍摄专业图片提示 / 查看图片选项 / n/25），且不再画英文对照行；美国态保持英上中下双语现状。
 */

const product = { id: 'lp1', storeId: 's1', listingId: 'T1', title: 'Seat Pair', imageUrl: '', imageUrls: [], price: '9.9', currency: 'USD', quantity: 12, status: 'ACTIVE', versionCount: 1, updatedAt: '', categoryId: 'home', categoryName: '家居', snapshot: { details: { url: '', itemSpecifics: [], condition: 'New', imageUrls: [], quantity: '12', paymentPolicy: '', shippingPolicy: '', returnPolicy: '', itemLocation: '', postalCode: '', listingFormat: 'FIXED_PRICE', descriptionText: 'x' }, media: [], sourceListing: {} as never, completeness: 100, missingFields: [], contentHash: '', capturedAt: '', id: 'snap1', localProductId: 'lp1', version: 1 } } as unknown as EbayLocalProduct

const draft: EbayLocalProductUpdateInput = {
  title: 'Seat Pair', descriptionText: 'desc', descriptionHtml: '', price: '9.9', currency: 'USD', media: [],
  quantity: '12', condition: 'New', listingFormat: 'FIXED_PRICE', sku: 'SEAT-001', itemLocation: 'Guangdong, CN', postalCode: '528000',
  itemSpecifics: []
}

const noop = vi.fn()
const props = (over: Partial<ComponentProps<typeof EbayLocalListingEditor>> = {}): ComponentProps<typeof EbayLocalListingEditor> => ({
  inline: true, product, draft, saving: false, uploading: false, preparing: false, readingPolicies: false, businessPolicies: [],
  categories: [{ categoryId: 'home', name: '家居', level: 1 } as never],
  onChange: noop, onSave: noop, onClose: noop, onUpload: noop, onPrepare: noop, onSetCategory: noop, onAutoClassify: noop, onReadPolicies: noop,
  policyCarrierItemId: '189035181453', onPolicyCarrierItemIdChange: noop,
  gaps: requiredFormGaps([], formValuesFromInput(draft)), ...over
})

const scope = (html: string, from: string, to: string) => {
  const start = html.indexOf(from)
  expect(start, `${from} 必须存在`).toBeGreaterThan(-1)
  const end = html.indexOf(to, start)
  return end === -1 ? html.slice(start) : html.slice(start, end)
}

describe('内联编辑器 · 中国态照现网原生中文逐字复刻', () => {
  const html = renderToStaticMarkup(<EbayLocalListingEditor {...props({ nativeChinese: true })} />)
  const pagehead = scope(html, 'ebay-revise-pagehead', 'id="ebay-revise-media"')
  const media = scope(html, 'id="ebay-revise-media"', 'id="ebay-revise-title"')

  it('页头只写「完成物品刊登」，无英文行', () => {
    expect(pagehead).toContain('完成物品刊登')
    expect(pagehead).not.toContain('Complete your listing')
    expect(pagehead).not.toContain('完成您的刊登')
    expect(pagehead).not.toContain('ebay-en')
  })

  it('媒体段标题与说明逐字等于现网中文', () => {
    expect(media).toContain('图片和视频')
    expect(media).toContain('您最多可添加 40 张图片和一段 1 分钟的视频。买家想要看到所有细节和角度。')
    expect(media).not.toContain('图片与视频')
    expect(media).not.toContain('最多可上传')
    expect(media).not.toContain('ebay-en')
  })

  it('提示链接与选项胶囊用现网中文措辞', () => {
    expect(media).toContain('拍摄专业图片提示')
    expect(media).toContain('查看图片选项')
    expect(media).not.toContain('专业拍照技巧')
    expect(media).not.toContain('查看照片选项')
    expect(media).not.toContain('Tips for taking pro photos')
    expect(media).not.toContain('See photo options')
  })

  it('计数只写 n/25，不写长句', () => {
    expect(media).toContain('0/25')
    expect(media).not.toContain('已上传')
  })

  it('选择文件按钮只留中文', () => {
    expect(media).toContain('选择文件')
    expect(media).not.toContain('>Select<')
  })
})

describe('内联编辑器 · 美国态双语现状不变', () => {
  const html = renderToStaticMarkup(<EbayLocalListingEditor {...props()} />)
  const pagehead = scope(html, 'ebay-revise-pagehead', 'id="ebay-revise-media"')
  const media = scope(html, 'id="ebay-revise-media"', 'id="ebay-revise-title"')

  it('页头仍英上中下', () => {
    expect(pagehead).toContain('Complete your listing')
    expect(pagehead).toContain('完成您的刊登')
  })

  it('媒体段仍英上中下与长句计数', () => {
    expect(media).toContain('Photos &amp; Video')
    expect(media).toContain('图片与视频')
    expect(media).toContain('已上传')
    expect(media).toContain('See photo options')
    expect(media).toContain('选择文件')
  })
})

describe('内联编辑器 · 语言态接线', () => {
  const appSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'App.tsx'), 'utf8') as string
  const editorSource = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'EbayLocalListingEditor.tsx'), 'utf8') as string

  it('两处挂载都按收货地国家传原生中文开关', () => {
    const mounts = appSource.match(/<EbayLocalListingEditor[^>]*>/g) || []
    expect(mounts.length).toBe(2)
    for (const mount of mounts) expect(mount).toContain("nativeChinese={ebayDeliveryCountry==='CN'}")
  })

  it('编辑器用上下文把开关传给 Bi，不在每个文案点重复传参', () => {
    expect(editorSource).toContain('createContext')
    expect(editorSource).toContain('nativeChinese')
  })
})
describe('内联编辑器 · 中国态红框区排版照现网（F1 量测）', () => {
  const html = renderToStaticMarkup(<EbayLocalListingEditor {...props({ nativeChinese: true })} />)
  const head = scope(html, 'ebay-revise-pagehead', 'class="ebay-media-counter"')
  const media = scope(html, 'id="ebay-revise-media"', 'id="ebay-revise-title"')

  it('根节点带中国态样式钩子', () => {
    expect(html).toContain('ebay-revise-native-cn')
  })

  it('页头与段标题为裸文本，继承 h1/h2 字号字重，不再套小灰字对照层', () => {
    expect(html).toContain('<h1>完成物品刊登</h1>')
    expect(media).toContain('<h2>图片和视频</h2>')
    expect(head).not.toContain('ebay-zh')
  })

  it('说明与拍摄专业图片提示同行在段头内，附加说明移出段头', () => {
    const bandHead = scope(html, 'class="ebay-revise-band-head"', 'class="ebay-media-counter"')
    expect(bandHead).toContain('您最多可添加 40 张图片和一段 1 分钟的视频。买家想要看到所有细节和角度。')
    expect(bandHead).toContain('拍摄专业图片提示')
    expect(bandHead).not.toContain('本地保存商品媒体')
    expect(media.indexOf('本地保存商品媒体')).toBeGreaterThan(media.indexOf('ebay-media-counter'))
  })

  it('美国态结构不变：对照层与段头内附加说明保留', () => {
    const us = renderToStaticMarkup(<EbayLocalListingEditor {...props()} />)
    expect(us).not.toContain('ebay-revise-native-cn')
    expect(us).toContain('ebay-zh')
    const usHead = scope(us, 'class="ebay-revise-band-head"', 'class="ebay-media-counter"')
    expect(usHead).toContain('本地保存商品媒体')
  })
})

describe('内联编辑器 · 中国态样式守卫（现网 F1 量测值）', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'ebay-local-listing-editor.css'), 'utf8') as string
  const block = (selector: string) => {
    const start = css.indexOf(selector)
    expect(start, `${selector} 必须存在`).toBeGreaterThan(-1)
    return css.slice(start, css.indexOf('}', start))
  }

  it('媒体段去卡片化：透明底、无边框圆角、padding 32px 24px 0', () => {
    const b = block('.ebay-revise-native-cn #ebay-revise-media')
    expect(b).toContain('background:transparent')
    expect(b).toContain('border:0')
    expect(b).toContain('border-radius:0')
    expect(b).toContain('padding:32px 24px 0')
  })

  it('段头去分隔线与非正 padding，说明与 tips 同行内联', () => {
    const head = block('.ebay-revise-native-cn .ebay-revise-band-head')
    expect(head).toContain('border-bottom:0')
    expect(head).toContain('padding:0')
    expect(block('.ebay-revise-native-cn #ebay-revise-media .ebay-revise-band-head h2')).toContain('text-transform:none')
    expect(block('.ebay-revise-native-cn .ebay-revise-band-head p')).toContain('display:inline')
    expect(block('.ebay-revise-native-cn .ebay-media-tips')).toContain('display:inline')
  })

  it('计数行与现网一致：h48、上距 24、左灰右_underline', () => {
    const counter = block('.ebay-revise-native-cn .ebay-media-counter')
    expect(counter).toContain('min-height:48px')
    expect(counter).toContain('margin:24px 0 0')
  })
})

/**
 * L1：中国态「标题 / 物品类别 / 款式」三段照现网原生中文刊登页逐字复刻
 * （2026-11-12 量测，~/.yandu-acceptance/2026-11-12-L1/，draftId=5318093449621&mode=AddItem）：
 *   · 标题段无自撰说明；计数可见行就是 n/80（12px #707070 贴框下右），长句只作读屏文；
 *   · 物品类别段：左栏值链＋在“…”中面包屑（14px #707070），右栏「店铺类别」16px/700＋裸文本值；
 *   · 款式段：无段头动作，段体是 ⓘ 信息带（bg #f7f7f7、pad 16、radius 8、图标 #0968f6），
 *     文案逐字「款式适用于出售具有多种不同尺寸、颜色的物品。不适用于此类别。」
 */
describe('内联编辑器 · 中国态标题/物品类别/款式三段照现网（L1 量测）', () => {
  const CATEGORY_PATH = 'eBay Motors > Parts & Accessories > Car & Truck Parts & Accessories > Interior Parts & Accessories > Seats, Parts & Accessories'
  const platformCategory = {
    options: [{ categoryId: 'c1', name: CATEGORY_PATH, soldCount: 0 }],
    busy: false, error: '', pick: 'c1', savedId: 'c1', savedName: CATEGORY_PATH,
    setPick: noop, refresh: noop, confirm: noop
  }
  const html = renderToStaticMarkup(<EbayLocalListingEditor {...props({ nativeChinese: true, platformCategory })} />)
  const title = scope(html, 'id="ebay-revise-title"', 'id="ebay-revise-category"')
  const category = scope(html, 'id="ebay-revise-category"', 'id="ebay-revise-variations"')
  const variations = scope(html, 'id="ebay-revise-variations"', 'id="ebay-revise-specifics"')

  it('标题段：裸中文段题、无自撰说明、计数可见行 n/80', () => {
    expect(title).toContain('<h2>标题</h2>')
    expect(title).toContain('查看标题选项')
    expect(title).toContain('物品标题')
    expect(title).toContain('>9/80<')
    expect(title).not.toContain('只保存买家在商品页看到的主标题。')
    expect(title).not.toContain('80 个字符中的')
    expect(title).not.toContain('ebay-en')
  })

  it('物品类别段：段题物品类别、面包屑在“…”中、右栏店铺类别＋裸文本值', () => {
    const escapedPath = CATEGORY_PATH.replace(/&/g, '&amp;').replace(/>/g, '&gt;')
    expect(category).toContain('<h2>物品类别</h2>')
    expect(category).toContain('编辑')
    expect(category).toContain(`在“${escapedPath}”中`)
    expect(category).toContain('店铺类别')
    expect((category.match(/class="ebay-value-link"/g) || []).length).toBe(2)
    expect(category).not.toContain('左栏平台类目')
    expect(category).not.toContain('ebay-en')
    expect(category).toContain('重新获取')
    expect(category).toContain('自动分类')
  })

  it('款式段：段题款式、无段头动作、ⓘ 信息带逐字现网文案', () => {
    expect(variations).toContain('<h2>款式</h2>')
    expect(variations).toContain('款式适用于出售具有多种不同尺寸、颜色的物品。不适用于此类别。')
    expect(variations).toContain('ebay-variations-notice')
    expect(variations).not.toContain('未启用')
    expect(variations).not.toContain('ebay-note-band')
    expect(variations).not.toContain('ebay-en')
  })

  it('美国态三段仍英上中下，款式段保留本地说明带', () => {
    const us = renderToStaticMarkup(<EbayLocalListingEditor {...props({ platformCategory })} />)
    const usTitle = scope(us, 'id="ebay-revise-title"', 'id="ebay-revise-category"')
    const usVariations = scope(us, 'id="ebay-revise-variations"', 'id="ebay-revise-specifics"')
    expect(usTitle).toContain('ebay-en')
    expect(usTitle).toContain('Title')
    expect(usVariations).toContain('Variations')
    expect(usVariations).toContain('ebay-note-band')
  })
})

describe('内联编辑器 · 中国态三段样式守卫（L1 量测值）', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'ebay-local-listing-editor.css'), 'utf8') as string
  const block = (selector: string) => {
    const start = css.indexOf(selector)
    expect(start, `${selector} 必须存在`).toBeGreaterThan(-1)
    return css.slice(start, css.indexOf('}', start))
  }

  it('三段去卡片化：透明底、无边框圆角、padding 32px 24px 0', () => {
    const b = block('.ebay-revise-native-cn #ebay-revise-title,.ebay-revise-native-cn #ebay-revise-category,.ebay-revise-native-cn #ebay-revise-variations')
    expect(b).toContain('background:transparent')
    expect(b).toContain('border:0')
    expect(b).toContain('border-radius:0')
    expect(b).toContain('padding:32px 24px 0')
  })

  it('款式信息带照现网：bg #f7f7f7、pad 16、radius 8、图标 #0968f6', () => {
    const notice = block('.ebay-variations-notice')
    expect(notice).toContain('background:#f7f7f7')
    expect(notice).toContain('padding:16px')
    expect(notice).toContain('border-radius:8px')
    expect(block('.ebay-variations-notice-icon')).toContain('color:#0968f6')
  })

  it('店铺类别值照现网 fake-link：下划线 14px，不另造裸文本样式', () => {
    const link = block('.ebay-value-link')
    expect(link).toContain('font-size:14px')
    expect(link).toContain('text-decoration:underline')
    expect(css).not.toContain('.ebay-value-plain')
  })
})
