/**
 * 图片雷同判定的纯函数部分：灰度 → dHash（64 位感知哈希）→ 汉明距离 → 重复分组。
 * 像素解码只能发生在主进程（渲染器 drawImage 跨域图会被 canvas 污染），故这里只吃灰度数组；
 * 主进程 ImageHashService 与视觉审核前置拦截共用同一套算法与阈值，避免两条链路各判各的。
 */

/** dHash 缩放尺寸：宽 9 高 8，逐行比较相邻像素得到 8×8=64 位指纹 */
export const HASH_WIDTH = 9
export const HASH_HEIGHT = 8

/**
 * 汉明距离 ≤ 该值判为雷同（64 位）。
 * 与视觉审核前置拦截既有口径一致（距离 ≤10 拦为「像素级雷同」），换机位/换景别的实测距离在 20 以上。
 */
export const EBAY_IMAGE_DUPLICATE_THRESHOLD = 10

/** BGRA 位图 → 灰度（Rec. 601 权重，行优先，四舍五入到 8 位） */
export function grayFromBgra(bitmap: Uint8Array | Buffer, width: number, height: number): Uint8Array {
  const gray = new Uint8Array(Math.max(0, width * height))
  for (let i = 0; i < gray.length; i += 1) {
    const o = i * 4
    gray[i] = Math.round(0.299 * (bitmap[o + 2] ?? 0) + 0.587 * (bitmap[o + 1] ?? 0) + 0.114 * (bitmap[o] ?? 0))
  }
  return gray
}

/** 灰度小图 → dHash（16 位十六进制串）；尺寸不符返回空串 */
export function perceptualHashFromGray(gray: Uint8Array, width = HASH_WIDTH, height = HASH_HEIGHT): string {
  if (width < 2 || gray.length !== width * height) return ''
  let hex = ''
  let nibble = 0
  let bits = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      nibble = (nibble << 1) | (gray[y * width + x] > gray[y * width + x + 1] ? 1 : 0)
      bits += 1
      if (bits === 4) {
        hex += nibble.toString(16)
        nibble = 0
        bits = 0
      }
    }
  }
  return hex
}

/** 两个十六进制哈希的汉明距离；任一为空、长度不等或含非十六进制字符返回 NaN（调用方按不可比较处理，不得当成 0） */
export function hammingDistance(left: string, right: string): number {
  // parseInt('z', 16) 在 JS 里等于 35（字母表被当成 16 进制位），不先校验字符集会静默算出假距离
  if (!/^[0-9a-f]+$/i.test(left) || !/^[0-9a-f]+$/i.test(right)) return Number.NaN
  if (left.length !== right.length) return Number.NaN
  let distance = 0
  for (let i = 0; i < left.length; i += 1) {
    let bits = parseInt(left[i], 16) ^ parseInt(right[i], 16)
    while (bits) {
      distance += bits & 1
      bits >>= 1
    }
  }
  return distance
}

/** 距离是否可用且判为雷同 */
export function isDuplicateDistance(distance: number, threshold: number = EBAY_IMAGE_DUPLICATE_THRESHOLD): boolean {
  return Number.isFinite(distance) && distance <= threshold
}

/** 主图白底探测缩放尺寸：16×16 取外圈 1px 环带足够判定背景色 */
export const BACKGROUND_SIZE = 16
/** 环带近白像素占比 ≥ 该值判为纯白底 */
export const BACKGROUND_WHITE_RATIO = 0.9
/** 近白阈值：三通道均 ≥ 该值记一个近白像素 */
export const BACKGROUND_WHITE_CHANNEL = 240

/**
 * BGRA 小图（BACKGROUND_SIZE×BACKGROUND_SIZE）→ 背景判定：外圈环带近白占比 ≥0.9 记纯白。
 * 尺寸或长度不符返回 UNKNOWN（调用方不得把未知当成违规）。
 */
export function classifyBackgroundFromBgra(bitmap: Uint8Array | Buffer, width: number, height: number): 'WHITE' | 'NON_WHITE' | 'UNKNOWN' {
  if (width !== BACKGROUND_SIZE || height !== BACKGROUND_SIZE || bitmap.length < width * height * 4) return 'UNKNOWN'
  let ring = 0
  let white = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x !== 0 && y !== 0 && x !== width - 1 && y !== height - 1) continue
      const o = (y * width + x) * 4
      ring += 1
      if ((bitmap[o] ?? 0) >= BACKGROUND_WHITE_CHANNEL && (bitmap[o + 1] ?? 0) >= BACKGROUND_WHITE_CHANNEL && (bitmap[o + 2] ?? 0) >= BACKGROUND_WHITE_CHANNEL) white += 1
    }
  }
  if (!ring) return 'UNKNOWN'
  return white / ring >= BACKGROUND_WHITE_RATIO ? 'WHITE' : 'NON_WHITE'
}

/**
 * 按输入顺序把雷同的图并成组（每组第一张视为保留张，其余为待重出张）。
 * 只返回 2 张以上的组；指纹缺失（解码失败）的条目不参与比较，也不能被判成重复。
 */
export function findDuplicateGroups(entries: Array<{ id: string; hash: string }>, threshold: number = EBAY_IMAGE_DUPLICATE_THRESHOLD): string[][] {
  const usable = entries.filter(entry => entry.hash)
  const grouped = new Set<string>()
  const groups: string[][] = []
  for (const seed of usable) {
    if (grouped.has(seed.id)) continue
    const group = [seed.id]
    grouped.add(seed.id)
    for (const other of usable) {
      if (grouped.has(other.id)) continue
      if (isDuplicateDistance(hammingDistance(seed.hash, other.hash), threshold)) {
        group.push(other.id)
        grouped.add(other.id)
      }
    }
    if (group.length > 1) groups.push(group)
  }
  return groups
}
