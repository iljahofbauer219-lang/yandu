/**
 * 最终图集检查读本机媒体守卫：
 * Node undici 全局 fetch 不认 Electron 自定义协议，cross-media://local 采纳图曾被判「图片无法读取」BLOCKED，
 * 定价步死锁「最终图集有 N 张未通过」。检查链路须按协议 handler 同根约束直接读本地文件。
 */
import { describe, expect, it } from 'vitest'
import path from 'node:path'

const ROOT = path.resolve('/tmp/ka-root/ebay-local-products')

async function getConfined() {
  const mod = await import('../ImageHashService.js').catch(() => null)
  return mod?.confinedLocalMediaPath
}
async function getMime() {
  const mod = await import('../ImageHashService.js').catch(() => null)
  return mod?.imageContentTypeForPath
}

describe('confinedLocalMediaPath', () => {
  it('cross-media://local 绝对路径编码解出并限制在根内', async () => {
    const fn = await getConfined()
    expect(typeof fn).toBe('function')
    const abs = path.join(ROOT, 'generated', 'a.png')
    expect(fn!(`cross-media://local/${encodeURIComponent(abs)}`, ROOT)).toBe(abs)
  })

  it('越权路径（相对化后逃出根）返回 null', async () => {
    const fn = await getConfined()
    expect(typeof fn).toBe('function')
    const outside = path.resolve('/tmp/ka-root/elsewhere/a.png')
    expect(fn!(`cross-media://local/${encodeURIComponent(outside)}`, ROOT)).toBeNull()
  })

  it('网络与 data 地址返回 null（仍走 fetch/data 分支）', async () => {
    const fn = await getConfined()
    expect(typeof fn).toBe('function')
    expect(fn!('https://cdn.test/a.png', ROOT)).toBeNull()
    expect(fn!('data:image/png;base64,AAAA', ROOT)).toBeNull()
  })

  it('file:// 与裸绝对路径同样受根约束', async () => {
    const fn = await getConfined()
    expect(typeof fn).toBe('function')
    const abs = path.join(ROOT, 'generated', 'b.jpg')
    expect(fn!(`file://${abs}`, ROOT)).toBe(abs)
    expect(fn!(abs, ROOT)).toBe(abs)
  })
})

describe('imageContentTypeForPath', () => {
  it('按扩展名给 MIME，未知扩展给空串（交由格式规则判 BLOCKED）', async () => {
    const fn = await getMime()
    expect(typeof fn).toBe('function')
    expect(fn!('/x/a.png')).toBe('image/png')
    expect(fn!('/x/a.JPG')).toBe('image/jpeg')
    expect(fn!('/x/a.jpeg')).toBe('image/jpeg')
    expect(fn!('/x/a.webp')).toBe('image/webp')
    expect(fn!('/x/a.bmp')).toBe('')
  })
})