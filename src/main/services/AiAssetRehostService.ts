/**
 * AI 资产转存：把 AI 生成图 / 生成视频的字节上传到自有服务器 /api/ai-assets，
 * 换回 /ai-assets/{id}/{name} 永久 URL。仅用于最终保存时刻（存入优品仓库、视频生成成功），
 * 中间环节的临时 URL / 本地路径不受影响。
 *
 * 失败语义：任何一步失败都不抛出（不阻断保存），改为在 warnings 里返回中文原因，
 * 对应 URL 保留原值。已指向服务器 /ai-assets/ 的 URL 幂等跳过。
 *
 * 安全边界：本地路径只接受本应用自己写出的资源——cross-media 协议的 local 主机
 * 限 userData/ebay-local-products 之内、project 主机限其自身工作区之内（与
 * protocol.handle('cross-media') 同一套越权口径）；data: 与 http(s): 直读字节。
 */
import fsp from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

export interface AiAssetRehostResult {
  /** 原始 URL → 服务器永久 URL（仅成功转存的条目） */
  map: Record<string, string>
  /** 中文警告；部分失败时逐条，整体失败时一条 */
  warnings: string[]
}

/** 上传被服务器判为未认证（401）：调用方应转成 SERVER_SESSION_EXPIRED 让渲染端刷新令牌重试 */
export class AiAssetAuthError extends Error {}

export interface AiAssetRehostOptions {
  serverUrl: string
  accessToken: string
  urls: string[]
}

const MAX_ASSETS = 40
const DOWNLOAD_TIMEOUT_MS = 120_000
const UPLOAD_TIMEOUT_MS = 240_000

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'video/mp4': 'mp4'
}

const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif',
  '.mp4': 'video/mp4'
}

interface LoadedAsset {
  contentType: string
  buffer: Buffer
}

function extensionContentType(value: string): string {
  return CONTENT_TYPE_BY_EXT[path.extname(value).toLowerCase()] ?? ''
}

function normalizeContentType(candidate: string, url: string): string {
  const clean = candidate.trim().toLowerCase()
  if (Object.hasOwn(EXTENSION_BY_CONTENT_TYPE, clean)) return clean
  try {
    return extensionContentType(new URL(url).pathname)
  } catch {
    return ''
  }
}

/**
 * cross-media://local/<encoded abs>（限 ebay-local-products 内）、
 * cross-media://project/<encoded workspace>/<encoded rel>（限工作区内）→ 绝对路径；其余返回 null
 */
function resolveLocalAssetPath(value: string): string | null {
  if (!value.startsWith('cross-media://')) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.hostname === 'local') {
    const root = path.join(app.getPath('userData'), 'ebay-local-products')
    const decoded = decodeURIComponent(url.pathname.slice(1))
    const filePath = path.resolve(root, path.isAbsolute(decoded) ? path.relative(root, decoded) : decoded)
    return filePath.startsWith(`${root}${path.sep}`) ? filePath : null
  }
  if (url.hostname === 'project') {
    const segments = decodeURIComponent(url.pathname).replace(/^\/+/, '').split('/')
    if (segments.length < 2) return null
    const workspacePath = path.resolve(segments[0])
    const filePath = path.resolve(workspacePath, segments.slice(1).join('/'))
    return filePath.startsWith(`${workspacePath}${path.sep}`) ? filePath : null
  }
  return null
}

async function loadAsset(url: string): Promise<LoadedAsset> {
  if (url.startsWith('data:')) {
    const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(url)
    if (!match) throw new Error('data URL 格式不合法')
    const buffer = match[2]
      ? Buffer.from(match[3], 'base64')
      : Buffer.from(decodeURIComponent(match[3]), 'utf8')
    if (!buffer.length) throw new Error('data URL 内容为空')
    const contentType = normalizeContentType(match[1], '')
    if (!contentType) throw new Error(`不支持的资源类型：${match[1] || '未知'}`)
    return { contentType, buffer }
  }
  const localPath = resolveLocalAssetPath(url)
  if (localPath) {
    const buffer = await fsp.readFile(localPath)
    if (!buffer.length) throw new Error('本地文件内容为空')
    const contentType = normalizeContentType(extensionContentType(localPath), url)
    if (!contentType) throw new Error(`不支持的资源类型：${path.extname(localPath) || '未知'}`)
    return { contentType, buffer }
  }
  if (!/^https?:\/\//i.test(url)) throw new Error('无法识别的地址协议')
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), headers: { 'User-Agent': 'Mozilla/5.0' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length) throw new Error('下载内容为空')
  const header = (response.headers.get('content-type') || '').split(';')[0].toLowerCase()
  const contentType = normalizeContentType(header || extensionContentType(url), url)
  if (!contentType) throw new Error(`不支持的资源类型：${header || path.extname(url) || '未知'}`)
  return { contentType, buffer }
}

async function uploadAssets(serverUrl: string, accessToken: string, assets: LoadedAsset[]): Promise<string[]> {
  const response = await fetch(`${serverUrl}/api/ai-assets`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ assets: assets.map(asset => ({ contentType: asset.contentType, dataBase64: asset.buffer.toString('base64') })) }),
    signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS)
  })
  if (response.status === 401) throw new AiAssetAuthError('登录会话已过期')
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const payload = await response.json() as { items?: Array<{ url?: string }> }
  const urls = (payload.items ?? []).map(item => item.url ?? '')
  if (urls.length !== assets.length || urls.some(url => !url)) throw new Error('转存响应缺少资产地址')
  return urls.map(url => new URL(url, `${serverUrl}/`).toString())
}

export async function rehostAiAssetUrls(options: AiAssetRehostOptions): Promise<AiAssetRehostResult> {
  const serverUrl = options.serverUrl.replace(/\/+$/, '')
  const permanentPrefix = `${serverUrl}/ai-assets/`
  const map: Record<string, string> = {}
  const warnings: string[] = []
  const targets = [...new Set(options.urls.filter(Boolean))].filter(url => !url.startsWith(permanentPrefix))
  if (!targets.length || !options.accessToken) return { map, warnings }

  const loaded: Array<{ url: string; asset: LoadedAsset }> = []
  for (const url of targets) {
    try {
      loaded.push({ url, asset: await loadAsset(url) })
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误'
      warnings.push(`1 张资产转存失败（${message}），已保留原地址`)
    }
  }
  if (!loaded.length) return { map, warnings }

  try {
    const serverUrls = await uploadAssets(serverUrl, options.accessToken, loaded.map(entry => entry.asset))
    loaded.forEach((entry, index) => { map[entry.url] = serverUrls[index] })
  } catch (error) {
    if (error instanceof AiAssetAuthError) throw error
    const message = error instanceof Error ? error.message : '未知错误'
    warnings.push(`AI 资产转存到自有服务器失败（${message}），本次保存仍使用原地址`)
  }
  return { map, warnings }
}

/** 15 秒视频生成成功后的单文件转存：filePath 限 userData/ebay-videos 之内（与视频服务写出目录一致） */
export async function rehostVideoFileToServer(options: {
  serverUrl: string
  accessToken: string
  filePath: string
}): Promise<{ serverUrl?: string; warning?: string }> {
  const root = path.join(app.getPath('userData'), 'ebay-videos')
  const resolved = path.resolve(options.filePath)
  if (!resolved.startsWith(`${root}${path.sep}`)) return { warning: '视频文件不在系统视频目录内，跳过转存' }
  try {
    const buffer = await fsp.readFile(resolved)
    if (!buffer.length) throw new Error('视频文件内容为空')
    const contentType = normalizeContentType(extensionContentType(resolved), '')
    if (!contentType) throw new Error(`不支持的资源类型：${path.extname(resolved) || '未知'}`)
    const serverUrls = await uploadAssets(options.serverUrl.replace(/\/+$/, ''), options.accessToken, [{ contentType, buffer }])
    return { serverUrl: serverUrls[0] }
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误'
    return { warning: `视频转存自有服务器失败（${message}），本机文件仍可用` }
  }
}
