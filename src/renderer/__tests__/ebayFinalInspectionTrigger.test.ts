/**
 * 最终图集检查触发根因守卫：
 * 图片阶段口径允许部分/零采纳沿用原图进入后续环节（四类未齐仅提示），
 * 故检查效应不得再以采纳齐全为触发条件——否则定价步永久停「最终图集检查尚未返回」并禁用保存。
 * 判据：只要有最终图集就必须真跑检查；门禁消息与通过判据口径不动。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const app = readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8')

describe('检查触发不再 gated 于采纳齐全', () => {
  it('early-return 只看最终图集是否为空', () => {
    expect(app).toContain('if(!finalImageUrls.length)return()=>{cancelled=true}')
  })

  it('旧的采纳齐全/恢复载体复合触发条件已移除', () => {
    expect(app).not.toContain('(!imageAdoptionComplete&&!premiumRestoreCarrier)||!finalImageUrls.length')
  })

  it('效应依赖只随最终图集指纹变化', () => {
    expect(app).toContain('},[finalImageFingerprint])')
  })

  it('仍真跑 inspectFinalImages 并回写报告', () => {
    expect(app).toContain('void window.desktop.ebay.inspectFinalImages(finalImageUrls).then(report=>{')
  })
})

describe('小图过滤认 URL 声明尺寸', () => {
  it('尺寸表缺口时回退 URL 声明尺寸（368px 缩略图被既有 <500px 过滤排除）', () => {
    expect(app).toContain('const size=declaredRemoteImageSize(url)||remoteUrlToSizeMap.get(url)')
  })

  it('面板导入声明尺寸纯函数', () => {
    expect(app).toContain("import { declaredRemoteImageSize } from '../shared/ebayImageSourceSize'")
  })
})

describe('门禁与阶段口径不动', () => {
  it('定价步尚未返回消息保留（真未返回窗口仍须提示）', () => {
    expect(app).toContain("!finalImageChecking&&!finalImageInspection?'最终图集检查尚未返回':''")
  })

  it('空最终图集 blocker 保留', () => {
    expect(app).toContain("finalImageUrls.length===0?(acceptedImagePurposes.length?")
  })

  it('视频 imagesReady 通过判据不动', () => {
    expect(app).toContain('const finalImageInspectionPassed=Boolean(imageAdoptionComplete&&finalImageInspection&&!finalImageInspection.blocked&&!finalImageInspection.review)')
  })

  it('图片阶段部分采纳可继续口径不动', () => {
    expect(app).toContain('类，四类未齐仅提示，可进入视频生成')
  })
})