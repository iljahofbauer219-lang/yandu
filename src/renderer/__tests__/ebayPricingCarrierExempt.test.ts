import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 售价环节恢复载体豁免（2026-11-18）：图片环节已过（含 restore- 载体）时不得再因
 * 「图片自动初步检查未完成」卡死存入优品；真实本地产品门禁不变；豁免须文案注明。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('售价环节 · 恢复载体豁免图片初步检查', () => {
  it('pricingImageBlockers 首项仅对非载体生效', () => {
    expect(app).toContain("!imageVisualReport&&!premiumRestoreCarrier?'图片自动初步检查未完成':''")
  })
  it('saveToPremium 的图片初步检查门禁仅对非载体生效', () => {
    expect(app).toContain("if(!imageVisualReport&&!premiumRestoreCarrier){setEbayError('图片自动初步检查尚未完成。')")
  })
  it('豁免以文案注明（恢复载体沿用草稿已检结果）', () => {
    expect(app).toContain('恢复载体沿用草稿已检结果')
  })
  it('最终图集检查 effect 对载体不早退（按 URL 补检）', () => {
    // 2026-11-21 根因修复后触发条件只看最终图集是否为空：载体与部分/零采纳同样真跑检查，载体豁免意图不变
    expect(app).toContain('if(!finalImageUrls.length)return()=>{cancelled=true}')
  })
  it('真实本地产品门禁字符串保留', () => {
    expect(app).toContain('图片自动初步检查未完成')
    expect(app).toContain('图片自动初步检查尚未完成。')
  })
})