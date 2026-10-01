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
  'image/avif': 'avif'
}

interface ImageEntry {
  index: number
  remoteUrl: string
  file: string
  contentType: string
  buffer: Buffer | null
  status: 'DOWNLOADED' | 'FAILED'
  error: string
}

export class SupplyProductDownloadService {
  constructor(private readonly database: AppDatabase, private readonly workspace: BrowserWorkspace) {}

  async download(warehouseProductId: string, accessToken: string): Promise<SupplyProductDownload> {
    const product = this.database.getSupplyWarehouseProductById(warehouseProductId)
    if (!product) throw new Error('正式入库商品不存在或已归档')
    if (!product.sourceUrl) throw new Error('该商品缺少原网址，无法下载')
    if (!accessToken) throw new Error('登录状态缺失，请重新登录后重试')
    const snapshot = await this.workspace.readSupplyProductPage(product.warehouseCode, product.sourceUrl)

    const capturedAt = new Date().toISOString()
    const images: ImageEntry[] = snapshot.extracted.images.map((remoteUrl, index) => ({
      index, remoteUrl, file: '', contentType: '', buffer: null, status: 'FAILED', error: ''
    }))
    const failures: string[] = []
    let cursor = 0
    const downloadNext = async () => {
      while (cursor < images.length) {
        const entry = images[cursor]
        cursor += 1
        try {
          const response = await fetch(entry.remoteUrl, {
            signal: AbortSignal.timeout(15_000),
            headers: { 'User-Agent': 'Mozilla/5.0', Referer: snapshot.extracted.finalUrl || product.sourceUrl }
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const buffer = Buffer.from(await response.arrayBuffer())
          if (!buffer.length) throw new Error('图片内容为空')
          const mimeType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
          const extension = EXTENSION_BY_MIME[mimeType]
          if (!extension) throw new Error(`不支持的图片类型：${mimeType || '未知'}`)
          entry.file = `${String(entry.index + 1).padStart(2, '0')}.${extension}`
          entry.contentType = mimeType
          entry.buffer = buffer
          entry.status = 'DOWNLOADED'
        } catch (error) {
          entry.error = error instanceof Error ? error.message : '未知错误'
          failures.push(`第 ${entry.index + 1} 张：${entry.error}`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(6, images.length) }, () => downloadNext()))

    const uploaded = images.filter(item => item.status === 'DOWNLOADED')
    const failedCount = images.length - uploaded.length
    if (!uploaded.length) {
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
    for (const entry of uploaded) {
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
        finalUrl: snapshot.extracted.finalUrl,
        title: snapshot.extracted.title || product.title,
        price: snapshot.extracted.price || product.priceText,
        specs: snapshot.extracted.specs,
        descriptionText: snapshot.extracted.descriptionText,
        html,
        images: uploaded.map(entry => ({ name: entry.file, contentType: entry.contentType, dataBase64: (entry.buffer ?? Buffer.alloc(0)).toString('base64') }))
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
      imageCount: uploaded.length,
      failedCount,
      status: 'DOWNLOADED',
      error: failedCount ? `部分图片失败：${failures.slice(0, 3).join('；')}` : '',
      downloadedAt: capturedAt
    }
    this.database.upsertSupplyDownload(record)
    return record
  }
}
