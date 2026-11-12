import type { EbayLocalProductMedia } from './contracts'

const MAX_MEDIA_ROWS = 24

// 优品种子图只含 IMAGE 行，整份替换会把「更新快照」拉进来的视频清掉；视频按既有口径排第 2 位，图片顺延
export function mergeEbayPublishMedia(seed: EbayLocalProductMedia[], snapshot: EbayLocalProductMedia[]): EbayLocalProductMedia[] {
  const videos = snapshot.filter(item => item.mediaType === 'VIDEO')
  const images = seed.filter(item => item.mediaType !== 'VIDEO').slice(0, Math.max(0, MAX_MEDIA_ROWS - videos.length))
  const rows = [...images]
  videos.forEach((video, index) => rows.splice(index + 1, 0, video))
  return rows.slice(0, MAX_MEDIA_ROWS).map((item, sortOrder) => ({ ...item, sortOrder }))
}

/** 图片判据（格式、尺寸、单张体积）只适用于图片行：视频没有宽高、mimeType 是 video/*，混进去会把合法视频判成不合规 */
export function ebayImageRuleRows<T extends Pick<EbayLocalProductMedia, 'mediaType'>>(rows: T[]): T[] {
  return rows.filter(row => row.mediaType !== 'VIDEO')
}
