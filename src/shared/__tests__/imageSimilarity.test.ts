import { describe, expect, it } from 'vitest'
import {
  EBAY_IMAGE_DUPLICATE_THRESHOLD,
  HASH_HEIGHT,
  HASH_WIDTH,
  findDuplicateGroups,
  grayFromBgra,
  hammingDistance,
  isDuplicateDistance,
  perceptualHashFromGray
} from '../imageSimilarity'

/** 9×8 无并列值的伪随机灰度：相邻像素一定不等，dHash 每一位都有确定含义 */
function pattern(swapX = false, bumps: Record<number, number> = {}): Uint8Array {
  const gray = new Uint8Array(HASH_WIDTH * HASH_HEIGHT)
  for (let y = 0; y < HASH_HEIGHT; y += 1) {
    for (let rawX = 0; rawX < HASH_WIDTH; rawX += 1) {
      const x = swapX ? HASH_WIDTH - 1 - rawX : rawX
      gray[y * HASH_WIDTH + rawX] = 20 + ((x * 37 + y * 53) % 8) * 30
    }
  }
  for (const [index, value] of Object.entries(bumps)) gray[Number(index)] = value
  return gray
}

function bgra(pixels: Array<[number, number, number, number]>): Uint8Array {
  const out = new Uint8Array(pixels.length * 4)
  pixels.forEach(([blue, green, red, alpha], index) => {
    out[index * 4] = blue
    out[index * 4 + 1] = green
    out[index * 4 + 2] = red
    out[index * 4 + 3] = alpha
  })
  return out
}

describe('BGRA → 灰度', () => {
  it('按 Rec. 601 权重取值，BGRA 顺序不串道', () => {
    const gray = grayFromBgra(bgra([[0, 0, 255, 255], [0, 255, 0, 255], [255, 0, 0, 255], [255, 255, 255, 0]]), 4, 1)
    expect(Array.from(gray)).toEqual([76, 150, 29, 255])
  })

  it('像素数不足时缺道按 0 处理，不抛异常', () => {
    expect(Array.from(grayFromBgra(new Uint8Array([0, 200, 255]), 2, 1))).toEqual([194, 0])
  })
})

describe('dHash 指纹', () => {
  it('9×8 灰度出 16 位十六进制指纹，尺寸不符或宽度不足返回空串', () => {
    const hash = perceptualHashFromGray(pattern())
    expect(hash).toHaveLength(16)
    expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true)
    expect(perceptualHashFromGray(new Uint8Array(63))).toBe('')
    expect(perceptualHashFromGray(new Uint8Array(9), 1, 8)).toBe('')
  })

  it('每行从左到右递增时全 0，递减时全 f', () => {
    const ascending = new Uint8Array(HASH_WIDTH * HASH_HEIGHT)
    const descending = new Uint8Array(HASH_WIDTH * HASH_HEIGHT)
    for (let y = 0; y < HASH_HEIGHT; y += 1) {
      for (let x = 0; x < HASH_WIDTH; x += 1) {
        ascending[y * HASH_WIDTH + x] = 10 + x * 20
        descending[y * HASH_WIDTH + x] = 190 - x * 20
      }
    }
    expect(perceptualHashFromGray(ascending)).toBe('0'.repeat(16))
    expect(perceptualHashFromGray(descending)).toBe('f'.repeat(16))
  })

  it('整体加一档亮度（同图不同曝光）指纹不变', () => {
    const base = perceptualHashFromGray(pattern())
    const brighter = Uint8Array.from(pattern(), value => Math.min(255, value + 5))
    expect(perceptualHashFromGray(brighter)).toBe(base)
  })

  it('同一构图仅有零星像素抖动（同机位重复出图）判为雷同', () => {
    const distance = hammingDistance(perceptualHashFromGray(pattern()), perceptualHashFromGray(pattern(false, { 4: 250, 40: 5 })))
    expect(distance).toBeGreaterThan(0)
    expect(isDuplicateDistance(distance)).toBe(true)
  })

  it('构图横向翻转（换机位）距离远超阈值', () => {
    expect(hammingDistance(perceptualHashFromGray(pattern()), perceptualHashFromGray(pattern(true)))).toBeGreaterThan(EBAY_IMAGE_DUPLICATE_THRESHOLD)
  })
})

describe('距离与雷同判定', () => {
  it('自身距离为 0；空串、长度不等或非十六进制不可比较', () => {
    const hash = perceptualHashFromGray(pattern())
    expect(hammingDistance(hash, hash)).toBe(0)
    expect(hammingDistance('', hash)).toBe(Number.NaN)
    expect(hammingDistance('ff', hash)).toBe(Number.NaN)
    expect(hammingDistance('zzzzzzzzzzzzzzzz', hash)).toBe(Number.NaN)
    expect(isDuplicateDistance(Number.NaN)).toBe(false)
  })

  it('阈值边界：等于阈值判雷同，多 1 判不同，且可放宽', () => {
    expect(isDuplicateDistance(EBAY_IMAGE_DUPLICATE_THRESHOLD)).toBe(true)
    expect(isDuplicateDistance(EBAY_IMAGE_DUPLICATE_THRESHOLD + 1)).toBe(false)
    expect(isDuplicateDistance(EBAY_IMAGE_DUPLICATE_THRESHOLD + 1, EBAY_IMAGE_DUPLICATE_THRESHOLD + 5)).toBe(true)
  })
})

describe('雷同分组', () => {
  const base = perceptualHashFromGray(pattern())
  const jitter = perceptualHashFromGray(pattern(false, { 4: 250, 40: 5 }))
  const mirrored = perceptualHashFromGray(pattern(true))

  it('把雷同的并成一组，每组保留输入顺序里的第一张', () => {
    expect(findDuplicateGroups([{ id: 'HERO-1', hash: base }, { id: 'HERO-2', hash: jitter }, { id: 'HERO-3', hash: mirrored }])).toEqual([['HERO-1', 'HERO-2']])
  })

  it('构图确实不同的两张不成组（换机位距离远超阈值）', () => {
    expect(hammingDistance(base, mirrored)).toBeGreaterThan(EBAY_IMAGE_DUPLICATE_THRESHOLD * 2)
    expect(findDuplicateGroups([{ id: 'A', hash: base }, { id: 'B', hash: mirrored }])).toEqual([])
  })

  it('指纹缺失的条目不参与比较（解码失败不能被判雷同）', () => {
    expect(findDuplicateGroups([{ id: 'A', hash: base }, { id: 'B', hash: '' }, { id: 'C', hash: base }])).toEqual([['A', 'C']])
  })

  it('阈值收到 0 时仅有完全相同的指纹才成组', () => {
    expect(findDuplicateGroups([{ id: 'A', hash: base }, { id: 'B', hash: jitter }], 0)).toEqual([])
    expect(findDuplicateGroups([{ id: 'A', hash: base }, { id: 'B', hash: base }], 0)).toEqual([['A', 'B']])
  })
})
