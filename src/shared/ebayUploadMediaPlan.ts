/**
 * 准备发布时写进 eBay AddItem/ReviseItem 页 PHOTOS & VIDEO 上传控件的本地媒体清单编排。
 * 判据集中在这里（2026-11-10 现网取证：上传计数器 0/25、accept 含 image/* 与 video/mp4）：
 * 主图（sortOrder 最小）第一、其余按 sortOrder；图片上限 25；视频随附至多 1 条；
 * 没下载成功或没本地路径的行绝不进清单——往上传控件里写一个打不开的文件比不写更糟；
 * 被丢的行逐条带原因回传，供横幅与 warnings 点名，不静默。
 */

export interface EbayUploadMediaPlanRow {
  mediaType: 'IMAGE' | 'VIDEO'
  sortOrder: number
  localPath: string
  downloadStatus: string
}

export interface EbayUploadMediaPlanItem {
  localPath: string
  sortOrder: number
  mediaType: 'IMAGE' | 'VIDEO'
}

export interface EbayUploadMediaPlanDropped {
  localPath: string
  mediaType: 'IMAGE' | 'VIDEO'
  reason: string
}

export interface EbayUploadMediaPlan {
  images: EbayUploadMediaPlanItem[]
  videos: EbayUploadMediaPlanItem[]
  dropped: EbayUploadMediaPlanDropped[]
}

/** 现网 PHOTOS & VIDEO 计数器上限（2026-11-10 AddItem 页实测 0/25）。 */
export const EBAY_IMAGE_LIMIT = 25

const bySortOrder = (left: EbayUploadMediaPlanRow, right: EbayUploadMediaPlanRow): number =>
  (left.sortOrder || 0) - (right.sortOrder || 0) || left.localPath.localeCompare(right.localPath)

export function planEbayUploadMedia(rows: EbayUploadMediaPlanRow[]): EbayUploadMediaPlan {
  const dropped: EbayUploadMediaPlanDropped[] = []
  const usable = (rows || []).filter(row => {
    const path = String(row?.localPath || '').trim()
    if (!path) {
      dropped.push({ localPath: '', mediaType: row?.mediaType || 'IMAGE', reason: '没有本地文件路径，跳过' })
      return false
    }
    if (String(row?.downloadStatus || '') !== 'DOWNLOADED') {
      dropped.push({ localPath: path, mediaType: row?.mediaType || 'IMAGE', reason: '本地文件未下载成功，跳过' })
      return false
    }
    return true
  })
  const images = usable.filter(row => row.mediaType === 'IMAGE').sort(bySortOrder)
  const videos = usable.filter(row => row.mediaType === 'VIDEO').sort(bySortOrder)
  for (const row of images.slice(EBAY_IMAGE_LIMIT)) {
    dropped.push({ localPath: row.localPath, mediaType: 'IMAGE', reason: `超出 eBay 单刊 ${EBAY_IMAGE_LIMIT} 图上限，跳过` })
  }
  for (const row of videos.slice(1)) {
    dropped.push({ localPath: row.localPath, mediaType: 'VIDEO', reason: 'eBay 单刊只随附 1 条视频，跳过' })
  }
  const toItem = (row: EbayUploadMediaPlanRow): EbayUploadMediaPlanItem => ({ localPath: row.localPath, sortOrder: row.sortOrder, mediaType: row.mediaType })
  return { images: images.slice(0, EBAY_IMAGE_LIMIT).map(toItem), videos: videos.slice(0, 1).map(toItem), dropped }
}
