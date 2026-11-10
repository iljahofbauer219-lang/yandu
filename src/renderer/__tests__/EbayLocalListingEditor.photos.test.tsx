import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import EbayLocalListingEditor from '../EbayLocalListingEditor'
import type { EbayLocalProduct, EbayLocalProductMedia, EbayLocalProductUpdateInput } from '../../shared/contracts'
import { EBAY_IMAGE_LIMIT } from '../../shared/ebayUploadMediaPlan'
import { formValuesFromInput, requiredFormGaps } from '../../shared/ebayListingForm'

/**
 * 图片与视频段 = eBay 现网 AddItem 页 PHOTOS & VIDEO 段的复刻，逐字取自 2026-11-10 的 DOM 导出
 * （~/.yandu-acceptance/2026-11-10-F1/F1-photos-section.json，draftId=5310629665620&mode=AddItem）。
 * 现网硬事实（未加工）：
 *   · 页面级 H1「Complete your listing」24px/600，就在 PHOTOS & VIDEO 段正上方；
 *   · 段头 = H2「Photos & Video」16px/700 + text-transform:uppercase（所以肉眼是 PHOTOS & VIDEO）
 *     左，按钮「See photo options」12px/700、bg rgb(247,247,247)、padding 8px 16px、radius 50px、h32 右；
 *   · 说明行「You can add up to 40 photos and a 1-minute video. Buyers want to see all details and angles.」
 *     14px/400 深色，紧随其后是下划线按钮「Tips for taking pro photos」，展开为「Photo tips」+
 *     「Learn how to take photos that attract buyers and help avoid returns.」；
 *   · 计数行 h48：左「17/25」14px/400 rgb(112,112,112)（另有 clipped 读屏文「17 out of 25 photos or
 *     videos uploaded」），右下划线按钮「Select」；
 *   · 瓦片墙：主图 360×360 radius16，小瓦片 115×115 radius16、间距 8；主图底部居中胶囊「Main」
 *     12px/700 白字 rgb(112,112,112) 底、padding 8px 12px、radius 30；视频瓦片左上时长「00:41」12px/700 白字、
 *     底部居中胶囊「Under review」同形；空位瓦片是 bg rgb(247,247,247) radius16 的按钮，图标 + 「Add」。
 * 用户口径：这一段的内容要与现网一致，且「上面是英文，下面是标中文对照」。
 * 现网状态类文案不伪造：本地视频没有进 eBay 审核，所以不画「Under review」；时长只画真实读到的值。
 */

const product = { id: 'lp1', storeId: 's1', listingId: 'T1', title: 'Bucket Racing Seats', imageUrl: '', imageUrls: [], price: '9.9', currency: 'USD', quantity: 12, status: 'ACTIVE', versionCount: 1, updatedAt: '', categoryId: '', categoryName: '', snapshot: { details: { url: '', itemSpecifics: [], condition: 'New', imageUrls: [], quantity: '12', paymentPolicy: '', shippingPolicy: '', returnPolicy: '', itemLocation: '', postalCode: '', listingFormat: 'FIXED_PRICE', descriptionText: 'x' }, media: [], sourceListing: {} as never, completeness: 100, missingFields: [], contentHash: '', capturedAt: '', id: 'snap1', localProductId: 'lp1', version: 1 } } as unknown as EbayLocalProduct

const media = (patch: Partial<EbayLocalProductMedia>): EbayLocalProductMedia => ({
  id: '', mediaType: 'IMAGE', sortOrder: 0, remoteUrl: '', localPath: '/tmp/photo.jpg', mimeType: 'image/jpeg',
  width: 1200, height: 1200, fileSize: 1024, sha256: '', downloadStatus: 'DOWNLOADED', ...patch
})

/** 现网这一页是 17 项媒体（17/25）；本地按同形取三项（图 + 视频 + 图）才钉得住主图胶囊、时长徽章与设为主图三处形状。 */
const MEDIA: EbayLocalProductMedia[] = [
  media({ id: 'm1', sortOrder: 0 }),
  media({ id: 'm2', sortOrder: 1, mediaType: 'VIDEO', localPath: '/tmp/clip.mp4', mimeType: 'video/mp4' }),
  media({ id: 'm3', sortOrder: 2, localPath: '/tmp/photo2.jpg' })
]

const draftOf = (over: Partial<EbayLocalProductUpdateInput> = {}): EbayLocalProductUpdateInput => ({
  title: 'Bucket Racing Seats', descriptionText: 'desc', descriptionHtml: '', price: '9.9', currency: 'USD', media: MEDIA,
  quantity: '12', condition: 'New', listingFormat: 'FIXED_PRICE', sku: '', itemLocation: 'Guangdong, CN', postalCode: '528000',
  itemSpecifics: [], ...over
})

const noop = vi.fn()
const props = (draft: EbayLocalProductUpdateInput, over: Partial<ComponentProps<typeof EbayLocalListingEditor>> = {}): ComponentProps<typeof EbayLocalListingEditor> => ({
  inline: true, product, draft, saving: false, uploading: false, preparing: false, readingPolicies: false, businessPolicies: [], categories: [],
  onChange: noop, onSave: noop, onClose: noop, onUpload: noop, onPrepare: noop, onSetCategory: noop, onAutoClassify: noop, onReadPolicies: noop,
  policyCarrierItemId: '189035181453', onPolicyCarrierItemIdChange: noop,
  gaps: requiredFormGaps([], formValuesFromInput(draft)), ...over
})

const html = renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf())} />)

/** 只截图片段的标记，别的段的文案不混进断言。 */
const band = (() => {
  const start = html.indexOf('id="ebay-revise-media"')
  expect(start, '图片段锚点必须存在').toBeGreaterThan(-1)
  return html.slice(start, html.indexOf('</section>', start))
})()

const decode = (value: string) => value.replace(/&amp;/g, '&').replace(/&#x27;/g, "'")
const enLines = (scope: string) => [...scope.matchAll(/class="ebay-en"[^>]*>([^<]*)</g)].map(match => decode(match[1]))
const zhLines = (scope: string) => [...scope.matchAll(/class="ebay-zh"[^>]*>([^<]*)</g)].map(match => decode(match[1]))

const css = readFileSync(path.join(__dirname, '..', 'ebay-local-listing-editor.css'), 'utf8')
const source = readFileSync(path.join(__dirname, '..', 'EbayLocalListingEditor.tsx'), 'utf8')
const sourceBand = source.slice(source.indexOf('id="ebay-revise-media"'), source.indexOf('id="ebay-revise-title"'))

describe('EbayLocalListingEditor · 图片与视频段照现网 PHOTOS & VIDEO 复刻（英上中下）', () => {
  it('现网原文逐字出现在段内，且按现网顺序（段头 → 说明 → 照片选项 → 拍照技巧 → 计数 → Select → Main → Add）', () => {
    expect(enLines(band)).toEqual([
      'Photos & Video',
      'You can add up to 40 photos and a 1-minute video. Buyers want to see all details and angles.',
      'See photo options',
      'Tips for taking pro photos',
      'Photo tips',
      'Learn how to take photos that attract buyers and help avoid returns.',
      `3/${EBAY_IMAGE_LIMIT}`,
      'Select',
      'Main',
      'Add'
    ])
  })

  it('每处英文原文下面紧跟中文对照，条数与英文一一对应', () => {
    expect(zhLines(band)).toEqual([
      '图片与视频',
      '最多可上传 40 张照片和 1 段 1 分钟视频；买家想看到全部细节与角度。',
      '查看照片选项',
      '专业拍照技巧',
      '拍照技巧',
      '了解如何拍出能吸引买家、并有助于减少退货的照片。',
      `已上传 ${EBAY_IMAGE_LIMIT} 张照片或视频中的 3 张`,
      '选择文件',
      '主图',
      '添加'
    ])
    expect((band.match(/class="ebay-bilingual"/g) || []).length).toBe(enLines(band).length)
    // 结构上英文必须在前：把每处双语块单独切出来看内部顺序
    for (const block of band.match(/<span class="ebay-bilingual">[\s\S]*?<\/span><\/span>/g) || []) {
      expect(block.indexOf('ebay-en')).toBeLessThan(block.indexOf('ebay-zh'))
    }
  })

  it('页面级标题 Complete your listing 照现网画在图片段正上方（同样英上中下）', () => {
    const above = html.slice(0, html.indexOf('id="ebay-revise-media"'))
    expect(enLines(above)).toContain('Complete your listing')
    expect(zhLines(above)).toContain('完成您的刊登')
    expect(above.indexOf('Complete your listing')).toBeGreaterThan(above.lastIndexOf('ebay-revise-validation'))
  })

  it('计数上限取现网的 25（shared 常量），三处旧口径 24 一并换成同一个常量', () => {
    expect(EBAY_IMAGE_LIMIT).toBe(25)
    expect(band).toContain(`3/${EBAY_IMAGE_LIMIT}`)
    expect(band).toContain('data-ebay-counter="photos"')
    expect(sourceBand).not.toContain('/24')
    expect(sourceBand).not.toContain('<24')
    expect(source).toContain("import { EBAY_IMAGE_LIMIT } from '../shared/ebayUploadMediaPlan'")
    expect(source).toContain('draft.media.length>EBAY_IMAGE_LIMIT')
    expect(source).toContain('draft.media.length<EBAY_IMAGE_LIMIT')
    // 保存路径与合规检查若还留在 24，界面上 25/25 就保存不了，等于自己给自己设了个拦路障
    const mainSource = readFileSync(path.join(__dirname, '..', '..', 'main', 'main.ts'), 'utf8')
    expect(mainSource).toContain('changes.media.length>EBAY_IMAGE_LIMIT')
    const compliance = readFileSync(path.join(__dirname, '..', '..', 'shared', 'ebayComplianceKnowledge.ts'), 'utf8')
    expect(compliance).toContain('downloadedMedia.length>EBAY_IMAGE_LIMIT')
    expect(compliance).not.toContain('24 张')
  })

  it('不伪造现网状态：本地视频没有「Under review」，时长只画真实读到的值', () => {
    expect(band).not.toContain('Under review')
    expect(band).not.toContain('审核中')
    expect(sourceBand).toContain('onLoadedMetadata')
    expect(sourceBand).toContain('ebay-photo-duration')
  })

  it('本地语义照旧保留：可拖动排序、设为主图、删除、以及如实说明的本地备注', () => {
    expect(band).toContain('draggable')
    expect(band).toContain('设为主图')
    expect(band).toContain('aria-label="删除媒体"')
    expect(band).toContain('本地保存商品媒体；拖动可排序，第一张图片为主图。')
    // Select 与 Add 都真的开本地文件选择器，不是画个样子
    expect(sourceBand).toContain('fileInput.current?.click()')
    // See photo options 在现网是菜单（从手机/网页上传），APP 没有这两条通道，只能画成文字并说明
    expect(sourceBand).toContain('ebay-band-action-pill')
    expect(sourceBand).not.toContain('<button type="button" className="ebay-band-action-pill"')
  })

  it('CSS 按现网量测值落地：瓦片 115/间距 8/圆角 16、Main 胶囊居中靠底、Add 瓦片灰底、段头胶囊与 uppercase', () => {
    expect(css).toContain('.ebay-photo-strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(115px,1fr));gap:8px')
    expect(css).toContain('.ebay-photo-tile{position:relative;aspect-ratio:1;margin:0;overflow:hidden;background:#fff;border:1.2px solid #fff;border-radius:16px}')
    expect(css).toContain('#ebay-revise-media .ebay-revise-band-head h2{text-transform:uppercase}')
    expect(css).toContain('.ebay-band-action-pill{')
    expect(css).toMatch(/\.ebay-band-action-pill\{[^}]*font-size:12px[^}]*font-weight:700[^}]*background:#f7f7f7[^}]*border-radius:50px/)
    expect(css).toMatch(/\.ebay-photo-pill\{[^}]*bottom:10px[^}]*background:#707070[^}]*color:#fff[^}]*border-radius:30px/)
    expect(css).toMatch(/\.ebay-photo-add\{[^}]*background:#f7f7f7[^}]*border-radius:16px/)
    expect(css).toMatch(/\.ebay-media-count\{[^}]*color:#707070/)
    expect(css).toMatch(/\.ebay-media-select\{[^}]*text-decoration:underline/)
    expect(css).toMatch(/\.ebay-bilingual\{[^}]*grid/)
    expect(css).toMatch(/\.ebay-zh\{[^}]*color:#707070/)
  })
})
