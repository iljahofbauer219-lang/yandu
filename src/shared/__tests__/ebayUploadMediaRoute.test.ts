import { describe, expect, it } from 'vitest'
import { classifyMediaInputAccept, planEbayMediaSync } from '../ebayUploadMediaPlan'

/**
 * 媒体上传失败根因（2026-11-16 现网取证）：prepare 每次把本地全量媒体重复写进复用草稿，
 * 累积超 25 上限后 eBay 撤掉图片 file input，只剩 video-only 的 #fehelix-uploader；
 * 旧选择器 '#fehelix-uploader,input[accept*=image]' 命中视频输入框，把图片灌进视频口 →
 * 「格式必须为 jpeg、png 或 heic」破图＋视频上传失败＋瓷砖超量（实测 42/25）。
 * 修复口径：先清空草稿现有媒体再按 accept 分流写入（图片→image 口、视频→video 口），幂等不累积。
 */
describe('eBay 媒体上传口按 accept 分流', () => {
  it('video-only 输入框不得接收图片', () => {
    expect(classifyMediaInputAccept('video/mp4,video/quicktime')).toBe('video')
  })
  it('image 输入框归图片', () => {
    expect(classifyMediaInputAccept('image/*')).toBe('image')
    expect(classifyMediaInputAccept('image/jpeg,image/png,image/heic')).toBe('image')
  })
  it('混合 accept 归 both；空/未知归 none', () => {
    expect(classifyMediaInputAccept('image/*,video/mp4')).toBe('both')
    expect(classifyMediaInputAccept('')).toBe('none')
    expect(classifyMediaInputAccept('application/pdf')).toBe('none')
  })
})

describe('eBay 媒体幂等同步决策', () => {
  it('草稿已有媒体时必须先清空再写，避免重复累积超上限', () => {
    expect(planEbayMediaSync(25, 16).clearExisting).toBe(true)
    expect(planEbayMediaSync(1, 16).clearExisting).toBe(true)
  })
  it('草稿为空时不清空，直接写', () => {
    expect(planEbayMediaSync(0, 16).clearExisting).toBe(false)
  })
  it('写入量以本地清单为准且图片不超 25', () => {
    const sync = planEbayMediaSync(42, 30)
    expect(sync.clearExisting).toBe(true)
    expect(sync.imageLimit).toBe(25)
  })
})