import { describe, expect, it } from 'vitest'
import { EBAY_IMAGE_LIMIT, planEbayUploadMedia, type EbayUploadMediaPlanRow } from '../ebayUploadMediaPlan'

/**
 * 2026-11-10 E 批：准备发布要把本地媒体写进 eBay AddItem 页的 PHOTOS & VIDEO 上传控件。
 * 编排判据集中在这里：主图（sortOrder 最小）第一、其余按 sortOrder、图片上限 25（现网计数器 0/25）、
 * 视频随附至多 1 条；没下载成功或没本地路径的行绝不进清单（写一个破文件进上传控件比不写更糟），
 * 被丢的行逐条给原因，供横幅与 warnings 点名。
 */
const row = (patch: Partial<EbayUploadMediaPlanRow>): EbayUploadMediaPlanRow => ({
  mediaType: 'IMAGE', sortOrder: 0, localPath: '/tmp/a.jpg', downloadStatus: 'DOWNLOADED', ...patch
})

describe('planEbayUploadMedia · 上传清单编排', () => {
  it('主图第一、其余按 sortOrder 排，视频单独随附', () => {
    const plan = planEbayUploadMedia([
      row({ localPath: '/tmp/p2.jpg', sortOrder: 2 }),
      row({ localPath: '/tmp/main.jpg', sortOrder: 0 }),
      row({ localPath: '/tmp/p1.jpg', sortOrder: 1 }),
      row({ mediaType: 'VIDEO', localPath: '/tmp/v.mp4', sortOrder: 3 })
    ])
    expect(plan.images.map(item => item.localPath)).toEqual(['/tmp/main.jpg', '/tmp/p1.jpg', '/tmp/p2.jpg'])
    expect(plan.videos.map(item => item.localPath)).toEqual(['/tmp/v.mp4'])
    expect(plan.dropped).toEqual([])
  })

  it('图片超过现网 25 上限截断，被丢的逐条点名原因', () => {
    const rows = Array.from({ length: EBAY_IMAGE_LIMIT + 2 }, (_, index) => row({ localPath: `/tmp/p${index}.jpg`, sortOrder: index }))
    const plan = planEbayUploadMedia(rows)
    expect(plan.images).toHaveLength(EBAY_IMAGE_LIMIT)
    expect(plan.dropped).toHaveLength(2)
    expect(plan.dropped[0].reason).toContain('25')
  })

  it('视频至多随附 1 条，多余的视频丢并点名', () => {
    const plan = planEbayUploadMedia([
      row({ mediaType: 'VIDEO', localPath: '/tmp/v1.mp4', sortOrder: 1 }),
      row({ mediaType: 'VIDEO', localPath: '/tmp/v2.mp4', sortOrder: 2 })
    ])
    expect(plan.videos.map(item => item.localPath)).toEqual(['/tmp/v1.mp4'])
    expect(plan.dropped.map(item => item.localPath)).toEqual(['/tmp/v2.mp4'])
  })

  it('没下载成功或没本地路径的行不进清单：写破文件进上传控件比不写更糟', () => {
    const plan = planEbayUploadMedia([
      row({ localPath: '/tmp/ok.jpg', sortOrder: 0 }),
      row({ localPath: '/tmp/bad.jpg', sortOrder: 1, downloadStatus: 'FAILED' }),
      row({ localPath: '', sortOrder: 2 })
    ])
    expect(plan.images.map(item => item.localPath)).toEqual(['/tmp/ok.jpg'])
    expect(plan.dropped).toHaveLength(2)
    expect(plan.dropped.every(item => item.reason.length > 0)).toBe(true)
  })
})
