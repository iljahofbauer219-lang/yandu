/**
 * 正式入库「下载产品」服务器端详情页服务：后台静默抓取原网址 → 图片本地化 → 上传中央服务器生成公开详情页。
 * 流程：AppDatabase 取正式入库商品 → BrowserWorkspace.readSupplyProductPage 隐藏窗口抓取
 *      → 图片并发下载至内存（6 路，同 eBay 下载范式）→ html 内 img 重写为 assets/nn.ext
 *      → POST {server}/api/product-pages（accessToken 经 IPC 传入）→ supply_product_downloads 表建档（pageId/pageUrl，重下载覆盖同页）。
 * 页面形态：源页 HTML 原样 + 图片本地化（失败图片保留源站直链），与采集源高度一致。
 */
import type { SupplyProductDownload } from '../../shared/contracts'
import type { AppDatabase } from '../database/AppDatabase'
import type { BrowserWorkspace } from '../browser/BrowserWorkspace'
import { readServerUrl } from '../serverConfig'

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
}

// 源站对 pdf/zip 常回 octet-stream：mime 未命中时按 URL 路径扩展名兜底
const EXTENSION_FROM_URL = /\.(pdf|txt|zip|rar|xlsx|xls|docx|doc)(?:\?|#|$)/i

interface ImageEntry {
  kind: 'img' | 'desc' | 'video' | 'file' | 'pack'
  index: number
  remoteUrl: string
  file: string
  contentType: string
  buffer: Buffer | null
  status: 'DOWNLOADED' | 'FAILED'
  error: string
}

const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_PACK_BYTES = 200 * 1024 * 1024

export class SupplyProductDownloadService {
  constructor(private readonly database: AppDatabase, private readonly workspace: BrowserWorkspace) {}

  async download(warehouseProductId: string, accessToken: string): Promise<SupplyProductDownload> {
    const product = this.database.getDownloadableSupplyWarehouseProductById(warehouseProductId)
    if (!product) throw new Error('商品不存在、已归档或已下架')
    if (!product.sourceUrl) throw new Error('该商品缺少原网址，无法下载')
    if (!accessToken) throw new Error('登录状态缺失，请重新登录后重试')
    const snapshot = await this.workspace.readSupplyProductPage(product.warehouseCode, product.sourceUrl)

    const capturedAt = new Date().toISOString()
    const extracted = snapshot.extracted
    const galleryUrls = extracted.images
    const descUrls = (extracted.descriptionImages ?? []).filter(url => !galleryUrls.includes(url))
    // 视频灯箱无 DOM 标签时从源页 HTML 正则 mp4 兜底（与 DOM 通道并集去重）
    const htmlMp4 = (snapshot.html.match(/https?:\/\/[^"'\s<>\\]+\.mp4/gi) ?? []).filter(url => !url.includes('.mp4.mp4'))
    const videoUrls = [...new Set([...(extracted.videos ?? []), ...htmlMp4])].slice(0, 8)
    // 文件/素材包：采集端已在登录态发现签名链接（仅内存瞬时），此处立即取字节重托管，公开页免登录可下
    const fileSources = (extracted.files ?? []).map((file, index) => ({ index, url: file.url || '' })).filter(item => /^https?:\/\//i.test(item.url))
    const packUrl = /^https?:\/\//i.test(extracted.materialPackUrl || '') ? (extracted.materialPackUrl as string) : ''
    const assets: ImageEntry[] = [
      ...galleryUrls.map((remoteUrl, index) => ({ kind: 'img' as const, index, remoteUrl, file: '', contentType: '', buffer: null, status: 'FAILED' as const, error: '' })),
      ...descUrls.map((remoteUrl, index) => ({ kind: 'desc' as const, index, remoteUrl, file: '', contentType: '', buffer: null, status: 'FAILED' as const, error: '' })),
      ...videoUrls.map((remoteUrl, index) => ({ kind: 'video' as const, index, remoteUrl, file: '', contentType: '', buffer: null, status: 'FAILED' as const, error: '' })),
      ...fileSources.map(source => ({ kind: 'file' as const, index: source.index, remoteUrl: source.url, file: '', contentType: '', buffer: null, status: 'FAILED' as const, error: '' })),
      ...(packUrl ? [{ kind: 'pack' as const, index: 0, remoteUrl: packUrl, file: '', contentType: '', buffer: null, status: 'FAILED' as const, error: '' }] : [])
    ]
    const failures: string[] = []
    let cursor = 0
    const downloadNext = async () => {
      while (cursor < assets.length) {
        const entry = assets[cursor]
        cursor += 1
        try {
          const timeoutMs = entry.kind === 'video' ? 120_000 : entry.kind === 'pack' ? 180_000 : entry.kind === 'file' ? 60_000 : 15_000
          const response = await fetch(entry.remoteUrl, {
            signal: AbortSignal.timeout(timeoutMs),
            headers: { 'User-Agent': 'Mozilla/5.0', Referer: extracted.finalUrl || product.sourceUrl }
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const buffer = Buffer.from(await response.arrayBuffer())
          if (!buffer.length) throw new Error('内容为空')
          const cap = entry.kind === 'pack' ? MAX_PACK_BYTES : entry.kind === 'file' ? MAX_FILE_BYTES : 0
          if (cap && buffer.length > cap) throw new Error(`超过大小上限（${Math.round(cap / 1024 / 1024)}MB）`)
          const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
          const urlExt = (EXTENSION_FROM_URL.exec(entry.remoteUrl) || [])[1]?.toLowerCase() || ''
          const extension = EXTENSION_BY_MIME[mimeType] || urlExt
          if (!extension) throw new Error(`不支持的类型：${mimeType || '未知'}`)
          if (entry.kind === 'video' && extension !== 'mp4') throw new Error(`仅支持 mp4 视频：${mimeType}`)
          if (entry.kind === 'pack' && extension !== 'zip') throw new Error(`素材包仅支持 zip：${extension}`)
          const seq = String(entry.index + 1).padStart(2, '0')
          entry.file = entry.kind === 'img' ? `${seq}.${extension}`
            : entry.kind === 'desc' ? `d-${seq}.${extension}`
            : entry.kind === 'video' ? `v-${seq}.${extension}`
            : entry.kind === 'file' ? `f-${seq}.${extension}`
            : `m-${seq}.${extension}`
          entry.contentType = mimeType && mimeType !== 'application/octet-stream' ? mimeType : (extension === 'pdf' ? 'application/pdf' : extension === 'zip' ? 'application/zip' : extension === 'txt' ? 'text/plain' : mimeType)
          entry.buffer = buffer
          entry.status = 'DOWNLOADED'
        } catch (error) {
          entry.error = error instanceof Error ? error.message : '未知错误'
          const label = entry.kind === 'img' ? `第 ${entry.index + 1} 张` : entry.kind === 'desc' ? `描述图 ${entry.index + 1}` : entry.kind === 'video' ? `视频 ${entry.index + 1}` : entry.kind === 'file' ? `文件 ${entry.index + 1}` : '素材包'
          failures.push(`${label}：${entry.error}`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, assets.length) }, () => downloadNext()))

    const uploaded = assets.filter(item => item.status === 'DOWNLOADED')
    const uploadedGallery = uploaded.filter(item => item.kind === 'img')
    const uploadedFileAssetByIndex = new Map(uploaded.filter(item => item.kind === 'file').map(item => [item.index, item.file]))
    const uploadedPackAsset = uploaded.find(item => item.kind === 'pack')
    const filesPayload = (extracted.files ?? []).map((file, index) => ({
      name: file.name,
      label: file.label || '',
      url: uploadedFileAssetByIndex.get(index) ? `assets/${uploadedFileAssetByIndex.get(index)}` : ''
    }))
    const materialPackAsset = uploadedPackAsset ? `assets/${uploadedPackAsset.file}` : ''
    const toAssetPayload = (entry: ImageEntry) => ({ name: entry.file, contentType: entry.contentType, dataBase64: (entry.buffer ?? Buffer.alloc(0)).toString('base64') })
    const failedCount = assets.length - uploaded.length
    if (!uploadedGallery.length) {
      const record: SupplyProductDownload = {
        warehouseProductId,
        pageId: '',
        pageUrl: '',
        imageCount: 0,
        failedCount,
        status: 'FAILED',
        error: `商品图片全部下载失败。${failures.slice(0, 3).join('；')}`,
        downloadedAt: capturedAt
      }
      this.database.upsertSupplyDownload(record)
      throw new Error(record.error)
    }

    // html 重写：成功图片的 remoteUrl（含 &amp; 转义形式）→ assets/nn.ext；失败图片保留源站直链
    let html = snapshot.html
    for (const entry of uploaded.filter(item => item.kind !== 'video')) {
      const local = `assets/${entry.file}`
      html = html.split(entry.remoteUrl.replaceAll('&', '&amp;')).join(local)
      html = html.split(entry.remoteUrl).join(local)
    }

    const serverUrl = readServerUrl()
    // 回传已存 pageId 以保住「重下载覆盖同页」语义：服务端改为随机 pageId 后，
    // 不带 pageId 会每次生成新页面并留下孤儿目录
    const existingPageId = this.database.getSupplyDownload(warehouseProductId)?.pageId || undefined
    const response = await fetch(`${serverUrl}/api/product-pages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        pageId: existingPageId,
        warehouseProductId: product.id,
        warehouseCode: product.warehouseCode,
        sourceUrl: product.sourceUrl,
        finalUrl: extracted.finalUrl,
        title: extracted.title || product.title,
        price: extracted.price || product.priceText,
        specs: extracted.specs,
        descriptionText: extracted.descriptionText,
        html,
        images: uploadedGallery.map(toAssetPayload),
        descriptionImages: uploaded.filter(item => item.kind === 'desc').map(toAssetPayload),
        videos: uploaded.filter(item => item.kind === 'video').map(toAssetPayload),
        fileAssets: uploaded.filter(item => item.kind === 'file').map(toAssetPayload),
        packAsset: uploadedPackAsset ? toAssetPayload(uploadedPackAsset) : undefined,
        category: extracted.category ?? '',
        itemCode: extracted.itemCode ?? '',
        firstStockAt: extracted.firstStockAt ?? '',
        returnRate: extracted.returnRate ?? '',
        sellableInventory: extracted.sellableInventory ?? '',
        unitPrice: extracted.unitPrice ?? '',
        packingFee: extracted.packingFee ?? '',
        freightFee: extracted.freightFee ?? '',
        shippingFee: extracted.shippingFee ?? '',
        estimatedTotal: extracted.estimatedTotal ?? '',
        dropshipLeadTime: extracted.dropshipLeadTime ?? '',
        gigaIndex: extracted.gigaIndex ?? '',
        materialPackUrl: materialPackAsset,
        materialPackDownloads: extracted.materialPackDownloads ?? '',
        files: filesPayload,
        features: extracted.features ?? [],
        descriptionFlow: extracted.descriptionFlow ?? []
      })
    })
    if (response.status === 401) {
      const error = new Error('登录会话已过期，请重新登录后重试') as Error & { code?: string }
      error.code = 'SERVER_SESSION_EXPIRED'
      throw error
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { message?: string } | null
      throw new Error(data?.message || `服务器建页失败（HTTP ${response.status}）`)
    }
    const result = await response.json() as { pageId: string; url: string }

    const record: SupplyProductDownload = {
      warehouseProductId,
      pageId: result.pageId,
      pageUrl: `${serverUrl}${result.url}`,
      imageCount: uploadedGallery.length,
      failedCount,
      status: 'DOWNLOADED',
      error: failedCount ? `部分图片失败：${failures.slice(0, 3).join('；')}` : '',
      downloadedAt: capturedAt
    }
    this.database.upsertSupplyDownload(record)
    return record
  }
}
