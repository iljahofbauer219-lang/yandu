import fs from 'node:fs'
import path from 'node:path'
import {describe, expect, it} from 'vitest'

const source = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8')
const previewLine = source.split('\n').find(line => line.includes('const selectedLocalPreview=')) || ''
const mediaLine = source.split('\n').find(line => line.includes('const selectedLocalMedia=')) || ''
const previewBlock = `${mediaLine}\n${previewLine}`

describe('AI优化标题卡主图回落链', () => {
  it('DOWNLOADED 媒体 localPath 优先', () => {
    expect(previewBlock).toContain("downloadStatus==='DOWNLOADED'")
    expect(previewLine).toContain('?.localPath||')
  })
  it('回落链与本地产品卡同口径：remoteUrl→sourceListing.imageUrl→curated 源图', () => {
    const remote = previewLine.indexOf('?.remoteUrl||')
    const sourceImage = previewLine.indexOf('sourceListing.imageUrl')
    const curated = previewLine.indexOf('selectedSourceImages[0]')
    expect(remote).toBeGreaterThan(-1)
    expect(sourceImage).toBeGreaterThan(remote)
    expect(curated).toBeGreaterThan(sourceImage)
  })
  it('标题卡 img 带与本地卡同款 onError 自愈（文件缺时回落 remoteUrl，不循环）', () => {
    const imgTag = source.slice(source.indexOf('ebay-selected-product">'), source.indexOf('ebay-selected-title-pair'))
    expect(imgTag).toContain('onError=')
    expect(imgTag).toContain('dataset.fallback')
    expect(imgTag).toContain('?.remoteUrl||')
  })
  it('全缺时仍渲染无本地主图占位', () => {
    expect(source).toContain('<span>无本地主图</span>')
  })
  it('本地产品卡回落链保持不变', () => {
    expect(source).toContain("ebayLocalMediaUrl(localMedia?.localPath||'',localMedia?.remoteUrl||item.imageUrl)")
  })
})