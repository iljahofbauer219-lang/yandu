import { app, nativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKGROUND_SIZE, HASH_HEIGHT, HASH_WIDTH, classifyBackgroundFromBgra, grayFromBgra, perceptualHashFromGray } from '../../shared/imageSimilarity'

/**
 * 基于 Electron nativeImage 的 dHash（64 位感知哈希）服务。
 * 用途两处：① 提交视觉模型审核前拦截与已生成草稿像素级雷同的候选图（省一次模型调用）；
 * ② 图片优化面板出图后按同类指纹分组，雷同的自动换参照重出。
 * 任一环节失败（下载失败/解码失败/尺寸异常）返回 null，调用方应降级为跳过哈希检查。
 */

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.tif', '.tiff'])
const MAX_BATCH = 40
const MAX_REMOTE_BYTES = 12 * 1024 * 1024

/**
 * 本地图片只能读应用自己写出的目录：渲染器传来的字符串不可信，
 * 不加目录约束的话这条 IPC 就成了读本机任意文件的通道。
 */
function isInsideAppDirectory(filePath: string): boolean {
  const resolved = path.resolve(filePath)
  const roots = [app.getPath('userData'), app.getPath('temp')].map(root => path.resolve(root))
  return roots.some(root => resolved === root || resolved.startsWith(`${root}${path.sep}`))
}

/** cross-media://local/<encodeURIComponent(absPath)>、file://、裸绝对路径 → 绝对路径；网络与 data 地址返回 null */
export function localPathForMediaValue(value: string): string | null {
  // cross-media 的地址把整段绝对路径（含开头的 /）都编码进了 pathname，slice(1) 解出来才带根斜杠
  if (value.startsWith('cross-media://local/')) return decodeURIComponent(new URL(value).pathname.slice(1))
  if (value.startsWith('file://')) return fileURLToPath(value)
  if (value.startsWith('/')) return value
  return null
}

function hashFromBuffer(buffer: Buffer): string | null {
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) return null
  // dHash：缩放到 9x8 灰度，比较每行相邻像素亮度得到 64 位指纹
  const resized = image.resize({ width: HASH_WIDTH, height: HASH_HEIGHT, quality: 'good' })
  if (resized.isEmpty()) return null
  const { width, height } = resized.getSize()
  const bitmap = resized.toBitmap()
  if (width !== HASH_WIDTH || height !== HASH_HEIGHT || bitmap.length < width * height * 4) return null
  const hash = perceptualHashFromGray(grayFromBgra(bitmap, width, height))
  return hash.length === 16 ? hash : null
}

/** 主图白底探测：缩放到 16×16 取外圈环带判背景色；解码失败记 UNKNOWN（未知不等于违规） */
function backgroundFromBuffer(buffer: Buffer): 'WHITE' | 'NON_WHITE' | 'UNKNOWN' {
  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) return 'UNKNOWN'
  const resized = image.resize({ width: BACKGROUND_SIZE, height: BACKGROUND_SIZE, quality: 'good' })
  if (resized.isEmpty()) return 'UNKNOWN'
  const { width, height } = resized.getSize()
  const bitmap = resized.toBitmap()
  return classifyBackgroundFromBgra(bitmap, width, height)
}

async function bufferForValue(value: string): Promise<Buffer | null> {
  const dataMatch = value.match(/^data:image\/(?:png|jpeg|webp|bmp);base64,(.+)$/i)
  if (dataMatch) return Buffer.from(dataMatch[1], 'base64')
  const filePath = localPathForMediaValue(value)
  if (filePath) {
    if (!IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return null
    if (!isInsideAppDirectory(filePath)) return null
    if (!fs.existsSync(filePath)) return null
    return fs.readFileSync(filePath)
  }
  if (/^https?:\/\//i.test(value)) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch(value, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!response.ok) return null
      if (Number(response.headers.get('content-length') || 0) > MAX_REMOTE_BYTES) return null
      const bytes = Buffer.from(await response.arrayBuffer())
      return bytes.byteLength && bytes.byteLength <= MAX_REMOTE_BYTES ? bytes : null
    } finally {
      clearTimeout(timeout)
    }
  }
  return null
}

export class ImageHashService {
  private readonly cache = new Map<string, string | null>()

  /** 取一张图的 64 位 dHash（16 位十六进制串）；支持 http(s)、cross-media 本地文件、file:// 与 data: 地址，失败返回 null。 */
  async computeHash(value: string): Promise<string | null> {
    if (!value) return null
    const cached = this.cache.get(value)
    if (cached !== undefined) return cached
    let hash: string | null = null
    try {
      const buffer = await bufferForValue(value)
      hash = buffer ? hashFromBuffer(buffer) : null
    } catch (reason) {
      console.warn('[image-hash] 指纹计算失败：', value.slice(0, 90), reason instanceof Error ? reason.message : reason)
      hash = null
    }
    this.cache.set(value, hash)
    if (this.cache.size > 200) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return hash
  }

  /** 批量指纹 + 主图白底探测（图片优化面板雷同检测与简版档原图分诊共用）：逐张容错，任一张解码失败只让该张哈希为空串、背景记 UNKNOWN。 */
  async fingerprintImages(values: unknown): Promise<Array<{ url: string; hash: string; background: 'WHITE' | 'NON_WHITE' | 'UNKNOWN' }>> {
    if (!Array.isArray(values)) return []
    const list = values.filter((value): value is string => typeof value === 'string' && value.length > 0).slice(0, MAX_BATCH)
    return Promise.all(list.map(async value => {
      let hash = ''
      let background: 'WHITE' | 'NON_WHITE' | 'UNKNOWN' = 'UNKNOWN'
      try {
        const buffer = await bufferForValue(value)
        if (buffer) {
          hash = hashFromBuffer(buffer) || ''
          background = backgroundFromBuffer(buffer)
        }
      } catch (reason) {
        console.warn('[image-hash] 指纹/背景探测失败：', value.slice(0, 90), reason instanceof Error ? reason.message : reason)
      }
      return { url: value, hash, background }
    }))
  }
}

/** 主进程共享实例：审核前置拦截与面板雷同检测共用同一份缓存与算法 */
export const imageHashService = new ImageHashService()
