import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 图片环节闸口放宽（2026-11-18 用户拍板）：无论是否生成/采纳四类图片，都可进入下一步视频生成；
 * 提示文案如实反映采纳/检查状态但不阻断；存入优品的 imageAdoptionComplete 门禁保持不变。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('图片环节 · 下一步视频生成不强制四类', () => {
  it('nextOptimizeReady 图片环节恒可进入', () => {
    expect(app).toContain("const nextOptimizeReady=optimizeMode==='title'?titleDecisionCurrent:optimizeMode==='content'?Boolean(contentResult&&!staleContentTranslationCount):true")
    expect(app).not.toContain("optimizeMode==='image'?finalImageInspectionPassed:true")
  })
  it('文案不再强制四类且标明可进入视频生成', () => {
    expect(app).not.toContain('请一键生成四类图片并采纳')
    expect(app).not.toContain('请采纳四类图片（已采纳')
    expect(app).toContain('可进入视频生成')
  })
  it('存入优品门禁与最终图集检查语义保留', () => {
    expect(app).toContain("if(!imageAdoptionComplete){setEbayError('请先完成图片自然化处理并确认所有最终图片。')")
    expect(app).toContain('const imageAdoptionComplete=Boolean(allImagePurposesAccepted&&confirmedGeneratedImageUrls.length)')
    expect(app).toContain('imagesReady={finalImageInspectionPassed}')
  })
})