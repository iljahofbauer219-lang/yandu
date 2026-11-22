/**
 * CDN URL 声明尺寸识别（阿里云 OSS x-oss-process=image/resize,w_368,h_368,m_pad）。
 * 尺寸表（本地下载媒体）缺失时，URL 自身声明的缩放尺寸即「已知尺寸」，
 * 供源集合小图过滤使用——368px 缩略图不得因尺寸表缺口溜进最终图集被检查误拦。
 */
import { describe, expect, it } from 'vitest'

async function getFn() {
  const mod = await import('../ebayImageSourceSize').catch(() => null)
  return mod?.declaredRemoteImageSize
}

describe('declaredRemoteImageSize', () => {
  it('识别 URL 编码的 OSS resize 声明（真实 gigab2b 缩略图形态）', async () => {
    const fn = await getFn()
    expect(typeof fn).toBe('function')
    expect(fn!('https://b2bfiles1.gigab2b.cn/image/a.png?x-cc=10&x-oss-process=image%2Fresize%2Cw_368%2Ch_368%2Cm_pad')).toEqual({ width: 368, height: 368 })
  })

  it('识别未编码的 OSS resize 声明', async () => {
    const fn = await getFn()
    expect(typeof fn).toBe('function')
    expect(fn!('https://cdn.test/a.png?x-oss-process=image/resize,w_800,h_600,m_lfit')).toEqual({ width: 800, height: 600 })
  })

  it('无 resize 声明返回 null（不臆造尺寸）', async () => {
    const fn = await getFn()
    expect(typeof fn).toBe('function')
    expect(fn!('https://cdn.test/a.png')).toBeNull()
    expect(fn!('https://cdn.test/a.png?x-oss-process=image%2Fquality%2Cq_90')).toBeNull()
  })

  it('非正数声明返回 null', async () => {
    const fn = await getFn()
    expect(typeof fn).toBe('function')
    expect(fn!('https://cdn.test/a.png?x-oss-process=image%2Fresize%2Cw_0%2Ch_0')).toBeNull()
  })
})