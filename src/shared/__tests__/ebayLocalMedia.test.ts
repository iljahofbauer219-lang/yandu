import { describe, expect, it } from 'vitest'
import { ebayImageRuleRows, mergeEbayPublishMedia } from '../ebayLocalMedia'
import type { EbayLocalProductMedia } from '../contracts'

const image = (id: string, sortOrder: number, over: Partial<EbayLocalProductMedia> = {}): EbayLocalProductMedia => ({
  id, mediaType: 'IMAGE', sortOrder,
  remoteUrl: `http://114.55.149.192/ai-assets/batch/${id}.jpg`,
  localPath: `/Users/zyc/local/ai-opt/${id}.jpg`,
  mimeType: 'image/jpeg', width: 1200, height: 1200, fileSize: 100, sha256: '', downloadStatus: 'DOWNLOADED', ...over
})

const video = (id: string, over: Partial<EbayLocalProductMedia> = {}): EbayLocalProductMedia => ({
  id, mediaType: 'VIDEO', sortOrder: 1,
  remoteUrl: 'http://114.55.149.192/product-pages/VvvHDTiUXSyXlHDm/assets/v-01.mp4',
  localPath: '/Users/zyc/local/ebay-local-products/02.mp4',
  mimeType: 'video/mp4', width: 0, height: 0, fileSize: 978833, sha256: '', downloadStatus: 'DOWNLOADED', ...over
})

describe('ebayLocalMedia · 发布编辑器媒体合并', () => {
  it('优品种子图落地后仍保留快照里的视频，并排在第 2 位', () => {
    const seed = [image('i1', 0), image('i2', 1), image('i3', 2)]
    const snapshot = [image('old1', 0), video('v1'), image('old2', 2)]
    expect(mergeEbayPublishMedia(seed, snapshot).map(item => item.id)).toEqual(['i1', 'v1', 'i2', 'i3'])
  })

  it('合并结果按最终顺序重排 sortOrder', () => {
    const merged = mergeEbayPublishMedia([image('i1', 0), image('i2', 1)], [video('v1', { sortOrder: 7 })])
    expect(merged.map(item => item.sortOrder)).toEqual([0, 1, 2])
  })

  it('快照没有视频时结果与种子图一致', () => {
    const seed = [image('i1', 0), image('i2', 1)]
    expect(mergeEbayPublishMedia(seed, [image('old1', 0)])).toEqual(seed)
  })

  it('总数上限 24：视频占一格时种子图裁到 23', () => {
    const seed = Array.from({ length: 24 }, (_, index) => image(`i${index + 1}`, index))
    const merged = mergeEbayPublishMedia(seed, [video('v1')])
    expect(merged).toHaveLength(24)
    expect(merged.filter(item => item.mediaType === 'VIDEO')).toHaveLength(1)
    expect(merged[23].id).toBe('i23')
  })
})

describe('ebayLocalMedia · 图片判据只收图片行', () => {
  it('视频行不参与图片格式与体积判据', () => {
    const rows = [image('i1', 0), video('v1', { fileSize: 20 * 1024 * 1024, mimeType: 'video/mp4' })]
    expect(ebayImageRuleRows(rows)).toEqual([rows[0]])
  })

  it('下载失败的视频行也不混进图片判据', () => {
    const rows = [image('i1', 0), video('v1', { localPath: '', mimeType: '', downloadStatus: 'FAILED' })]
    expect(ebayImageRuleRows(rows).map(item => item.id)).toEqual(['i1'])
  })
})
