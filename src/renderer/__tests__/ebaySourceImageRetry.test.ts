import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 根因（2026-11-20 11:43 现网 5 张破图）：画廊 <article key={url}><img src={url}/> 无 onError、无重试、
// key 不随重试变化 → 瞬时加载失败后破图被永久锁死；「重新读取产品原图」同步成功但 URL 集合不变，
// React 复用 img 节点永不重新请求。守卫钉五条恢复判据：自动重试计数、key 重挂载、缓存穿透、
// 二次失败中文原因＋重试按钮、同步成功重置计数（重读真正重试）。
const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8')
const css = readFileSync(resolve(__dirname, '../image-studio.css'), 'utf8')

const galleryStart = app.indexOf('<div className="ebay-original-gallery-extra">')
const gallery = app.slice(galleryStart, app.indexOf("{optimizeMode==='title'", galleryStart))
const syncStart = app.indexOf('const syncListingDetails')
const syncRegion = app.slice(syncStart, syncStart + 9000)

describe('02 选择原图：破图恢复链路接线', () => {
  it('画廊区域存在且含 13 张原图渲染入口', () => {
    expect(galleryStart).toBeGreaterThan(-1)
    expect(gallery).toContain('curatedImageSourceEntries.map')
  })

  it('声明 per-url 重试计数状态 sourceImageRetry', () => {
    expect(app).toContain('const [sourceImageRetry,setSourceImageRetry]=useState<Record<string,number>>({})')
  })

  it('img onError 递增该 url 的重试计数（自动重试触发器）', () => {
    expect(gallery).toContain('onError={()=>setSourceImageRetry(')
    expect(gallery).toMatch(/onError=\{\(\)=>setSourceImageRetry\(current=>\(\{\.\.\.current,\[url\]:\(current\[url\]\|\|0\)\+1\}\)\)\}/)
  })

  it('img key 含重试计数 → 计数变化即重挂载重新请求', () => {
    expect(gallery).toContain('key={`${url}#${sourceImageRetry[url]||0}`}')
  })

  it('重试 src 带 ydretry 缓存穿透参数（仅 http(s)）', () => {
    expect(gallery).toContain('ydretry=')
    expect(gallery).toContain('/^https?:/')
  })

  it('二次失败改渲染中文原因＋「重试加载」动作按钮而非破 img', () => {
    expect(gallery).toContain('(sourceImageRetry[url]||0)>=2?')
    expect(gallery).toContain('图片加载失败')
    expect(gallery).toContain('重试加载')
    expect(gallery).toContain('ebay-source-img-failed')
  })

  it('syncListingDetails 成功路径重置重试计数 → 重新读取真正重挂载全部 img', () => {
    expect(syncStart).toBeGreaterThan(-1)
    const resetAt = syncRegion.indexOf('setSourceImageRetry({})')
    expect(resetAt).toBeGreaterThan(-1)
    expect(resetAt).toBeLessThan(syncRegion.indexOf('return updated'))
  })

  it('失败占位有专属样式且挂在画廊作用域下', () => {
    expect(css).toContain('.ebay-original-gallery-extra .ebay-source-img-failed')
  })
})

describe('02 选择原图：重试表达式行为', () => {
  const srcMatch = gallery.match(/const retrySrc=([^;]+);/)
  const retrySrc = srcMatch
    ? (new Function('url', 'retry', `return ${srcMatch[1]}`) as (url: string, retry: number) => string)
    : null

  it('retrySrc 表达式可抽取', () => {
    expect(srcMatch).not.toBeNull()
  })

  it('首次加载（retry=0）src 保持原 URL 不变', () => {
    expect(retrySrc).not.toBeNull()
    expect(retrySrc!('http://114.55.149.192/a/07.png', 0)).toBe('http://114.55.149.192/a/07.png')
  })

  it('自动重试（retry=1）追加 ?ydretry=1 穿透缓存', () => {
    expect(retrySrc).not.toBeNull()
    expect(retrySrc!('http://114.55.149.192/a/07.png', 1)).toBe('http://114.55.149.192/a/07.png?ydretry=1')
  })

  it('已有 query 的 URL 用 & 追加 ydretry', () => {
    expect(retrySrc).not.toBeNull()
    expect(retrySrc!('https://x.test/a.png?v=2', 2)).toBe('https://x.test/a.png?v=2&ydretry=2')
  })

  it('非 http(s) 协议（cross-media 本地图）不追加参数', () => {
    expect(retrySrc).not.toBeNull()
    expect(retrySrc!('cross-media://local/a.png', 1)).toBe('cross-media://local/a.png')
  })

  const errMatch = gallery.match(/onError=\{\(\)=>setSourceImageRetry\((current=>\(\{[^]*?\}\))\)\}/)
  const bump = errMatch
    ? (new Function('url', `return ${errMatch[1]}`) as (url: string) => (current: Record<string, number>) => Record<string, number>)
    : null

  it('onError reducer 可抽取', () => {
    expect(errMatch).not.toBeNull()
  })

  it('onError 首次失败计 1、再次失败计 2，且不影响其它 url', () => {
    expect(bump).not.toBeNull()
    expect(bump!('u')({})).toEqual({ u: 1 })
    expect(bump!('u')({ u: 1, other: 3 })).toEqual({ u: 2, other: 3 })
  })

  const resetMatch = gallery.match(/onClick=\{\(\)=>setSourceImageRetry\((current=>\(\{[^]*?\}\))\)\}/)
  const reset = resetMatch
    ? (new Function('url', `return ${resetMatch[1]}`) as (url: string) => (current: Record<string, number>) => Record<string, number>)
    : null

  it('「重试加载」reducer 可抽取', () => {
    expect(resetMatch).not.toBeNull()
  })

  it('「重试加载」把该 url 计数归 0（重挂载原 URL）且保留其它 url 计数', () => {
    expect(reset).not.toBeNull()
    expect(reset!('u')({ u: 2, other: 1 })).toEqual({ u: 0, other: 1 })
  })
})