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