import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// 「02 选择原图」恒 0/0 根因守卫：快照 media 全 FAILED 时 width/height=0，
// 尺寸过滤把 0×0 误判为「已知过小」剔光全部源图。0 值必须视为无尺寸信息保留。
const source = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8')

function extractFilter(): (url: string) => boolean {
  const match = source.match(
    /const selectedSourceImages=selectedSourceImagesRaw\.filter\((url=>\{[\s\S]*?\n {2}\})\)/
  )
  expect(match, '未找到 selectedSourceImages 尺寸过滤块').not.toBeNull()
  const body = match![1]
  const factory = new Function(
    'remoteUrlToSizeMap',
    `return ${body}`
  ) as (map: Map<string, { width: number; height: number }>) => (url: string) => boolean
  return factory(sizeMap)
}

const sizeMap = new Map<string, { width: number; height: number }>()

describe('selectedSourceImages 尺寸过滤：0 值尺寸不得误判小图', () => {
  it('无尺寸信息的 URL 保留（兼容未在本地快照的图片）', () => {
    sizeMap.clear()
    const filter = extractFilter()
    expect(filter('https://example.com/unknown.jpg')).toBe(true)
  })

  it('FAILED 媒体 0×0 尺寸视为未知，URL 保留', () => {
    sizeMap.clear()
    sizeMap.set('https://example.com/failed.jpg', { width: 0, height: 0 })
    const filter = extractFilter()
    expect(filter('https://example.com/failed.jpg')).toBe(true)
  })

  it('负值尺寸同样视为未知，URL 保留', () => {
    sizeMap.clear()
    sizeMap.set('https://example.com/negative.jpg', { width: -1, height: -1 })
    const filter = extractFilter()
    expect(filter('https://example.com/negative.jpg')).toBe(true)
  })

  it('真实小图（最长边 499）仍被剔除', () => {
    sizeMap.clear()
    sizeMap.set('https://example.com/small.jpg', { width: 499, height: 120 })
    const filter = extractFilter()
    expect(filter('https://example.com/small.jpg')).toBe(false)
  })

  it('最长边恰 500 保留', () => {
    sizeMap.clear()
    sizeMap.set('https://example.com/ok.jpg', { width: 500, height: 375 })
    const filter = extractFilter()
    expect(filter('https://example.com/ok.jpg')).toBe(true)
  })

  it('单边为 0 但另一边达标时按已知尺寸保留', () => {
    sizeMap.clear()
    sizeMap.set('https://example.com/half.jpg', { width: 0, height: 800 })
    const filter = extractFilter()
    expect(filter('https://example.com/half.jpg')).toBe(true)
  })
})

describe('尺寸映射与源图去重口径不变', () => {
  it('映射仍取自快照全部 media（含 FAILED 行）的 remoteUrl→width/height', () => {
    expect(source).toContain(
      "(selectedLocalProduct?.snapshot.media||[]).map(media=>[media.remoteUrl,{width:media.width,height:media.height}])"
    )
  })

  it('源图仍为 imageUrls＋imageUrl 去重，不因过滤修复改变去重口径', () => {
    expect(source).toContain(
      "const selectedSourceImagesRaw=selectedListing?[...(selectedListing.imageUrls||[]),selectedListing.imageUrl].filter((value,index,array)=>value&&array.indexOf(value)===index):[]"
    )
  })
})