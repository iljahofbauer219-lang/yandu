/**
 * 零度 Nano Banana 参照图预处理。
 *
 * 实测（api000 /v1beta/models/nano-banana-2:generateContent）：
 * - 参照用 PNG（含 alpha）内联：0/4 成功，HTTP 200 但 candidates 只有中文拒绝文案
 *   「通常我可以提供这类帮助，但我似乎无权访问该内容」，即上游把图片丢弃后交给文本模型作答；
 * - 同一张图转成 JPEG 后：8/10 成功（余下两次由重试兜住）。
 * 所以参照统一转 JPEG。转 JPEG 时 alpha 必须自己压到白底：交给编码器合成会得到黑底参照，
 * 而 eBay 主图要求纯白底，黑底参照会把出图带偏。
 */

const BYTES_PER_PIXEL = 4
const ALPHA_OFFSET = 3
const OPAQUE = 255

/**
 * 把透明像素压到白底，原地修改并返回同一数组（无透明像素时原样返回）。
 *
 * 通道顺序无关：BGRA 与 RGBA 的 alpha 都在第 4 字节，其余三字节做同样的混合即可。
 * 预乘判定：预乘数据的通道值恒 ≤ alpha，一旦发现通道值大于 alpha 即为直通（非预乘）。
 */
export function flattenOntoWhite(bitmap: Uint8Array): Uint8Array {
  const hasTransparency = bitmap.some((value, index) => index % BYTES_PER_PIXEL === ALPHA_OFFSET && value < OPAQUE)
  if (!hasTransparency) return bitmap

  let premultiplied = true
  for (let offset = ALPHA_OFFSET; offset < bitmap.length; offset += BYTES_PER_PIXEL) {
    const alpha = bitmap[offset]
    if (alpha >= 250) continue
    for (let channel = offset - 3; channel < offset; channel += 1) {
      if (bitmap[channel] > alpha) {
        premultiplied = false
        break
      }
    }
    if (!premultiplied) break
  }

  for (let offset = ALPHA_OFFSET; offset < bitmap.length; offset += BYTES_PER_PIXEL) {
    const alpha = bitmap[offset]
    if (alpha === OPAQUE) continue
    const transparent = OPAQUE - alpha
    for (let channel = offset - 3; channel < offset; channel += 1) {
      const value = premultiplied ? bitmap[channel] + transparent : Math.round((bitmap[channel] * alpha + OPAQUE * transparent) / OPAQUE)
      bitmap[channel] = Math.min(OPAQUE, value)
    }
    bitmap[offset] = OPAQUE
  }
  return bitmap
}
