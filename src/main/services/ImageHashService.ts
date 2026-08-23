import { nativeImage } from 'electron'

/**
 * 基于 Electron nativeImage 的 dHash（64 位感知哈希）服务。
 * 在提交视觉模型审核前拦截与已生成草稿像素级雷同的候选图，省去一次模型调用。
 * 任一环节失败（下载失败/解码失败/尺寸异常）返回 null，调用方应降级为跳过哈希检查。
 */
export class ImageHashService {
  private readonly cache = new Map<string, string | null>()

  /** 下载并计算图片的 64 位 dHash（16 位十六进制字符串），失败返回 null。 */
  async computeHash(url: string): Promise<string | null> {
    if (!/^https?:\/\//i.test(url)) return null
    const cached = this.cache.get(url)
    if (cached !== undefined) return cached
    const hash = await this.fetchAndHash(url).catch(() => null)
    this.cache.set(url, hash)
    if (this.cache.size > 200) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return hash
  }

  /** 两个等长十六进制哈希的汉明距离；长度不一致视为完全不同。 */
  hammingDistance(a: string, b: string): number {
    if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER
    let distance = 0
    for (let i = 0; i < a.length; i++) {
      let diff = parseInt(a[i], 16) ^ parseInt(b[i], 16)
      if (Number.isNaN(diff)) return Number.MAX_SAFE_INTEGER
      while (diff) {
        distance += diff & 1
        diff >>= 1
      }
    }
    return distance
  }

  private async fetchAndHash(url: string): Promise<string | null> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20000)
    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) return null
      const buffer = Buffer.from(await response.arrayBuffer())
      if (!buffer.length) return null
      const image = nativeImage.createFromBuffer(buffer)
      if (image.isEmpty()) return null
      // dHash：缩放到 9x8 灰度，比较每行相邻像素亮度得到 64 位指纹
      const resized = image.resize({ width: 9, height: 8, quality: 'good' })
      if (resized.isEmpty()) return null
      const { width, height } = resized.getSize()
      const bitmap = resized.toBitmap()
      if (width !== 9 || height !== 8 || bitmap.length < width * height * 4) return null
      const gray: number[] = []
      for (let i = 0; i < width * height; i++) {
        const offset = i * 4
        // toBitmap 返回 BGRA 顺序
        gray.push(0.114 * bitmap[offset] + 0.587 * bitmap[offset + 1] + 0.299 * bitmap[offset + 2])
      }
      let hash = ''
      let nibble = 0
      let bits = 0
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width - 1; x++) {
          nibble = (nibble << 1) | (gray[y * width + x] > gray[y * width + x + 1] ? 1 : 0)
          bits++
          if (bits === 4) {
            hash += nibble.toString(16)
            nibble = 0
            bits = 0
          }
        }
      }
      return hash.length === 16 ? hash : null
    } finally {
      clearTimeout(timeout)
    }
  }
}
