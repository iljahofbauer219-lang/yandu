import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EBAY_IMAGE_MODEL_PRESENCE,
  DEFAULT_EBAY_IMAGE_RULES,
  EBAY_IMAGE_MODEL_PRESENCE_OPTIONS,
  EBAY_IMAGE_RULES,
  buildRulePromptLines,
  describeActiveEbayImageRules,
  modelPresencePrompt,
  normalizeEbayImageModelPresence,
  normalizeEbayImageRules
} from '../ebayImageRules'

describe('生图规则清单', () => {
  it('默认全开，锁定项关不掉', () => {
    expect(normalizeEbayImageRules(null)).toEqual(DEFAULT_EBAY_IMAGE_RULES)
    const locked = EBAY_IMAGE_RULES.filter(rule => rule.locked).map(rule => rule.id)
    expect(locked).toEqual(['FIDELITY', 'DISTINCT', 'PLATFORM'])
    const next = normalizeEbayImageRules({ FIDELITY: false, DISTINCT: false, PLATFORM: false })
    expect(next.FIDELITY).toBe(true)
    expect(next.DISTINCT).toBe(true)
    expect(next.PLATFORM).toBe(true)
  })

  it('非锁定项可关，未知键与缺字段回落默认（旧持久化数据兼容）', () => {
    expect(normalizeEbayImageRules({ COLOR_TRUE: false }).COLOR_TRUE).toBe(false)
    expect(normalizeEbayImageRules({ SCALE_TRUE: 'yes' }).SCALE_TRUE).toBe(true)
    expect(normalizeEbayImageRules({ perCount: 2, unknownRule: false })).toEqual(DEFAULT_EBAY_IMAGE_RULES)
  })

  it('规则清单每条都有中文标签与说明，供生成前展示', () => {
    for (const rule of EBAY_IMAGE_RULES) {
      expect(rule.label.length).toBeGreaterThan(1)
      expect(rule.detail.length).toBeGreaterThan(8)
    }
  })
})

describe('规则 → 提示词行', () => {
  it('同类只有 1 张时不写「必须不同」，多张时写入且数量正确', () => {
    const single = buildRulePromptLines(DEFAULT_EBAY_IMAGE_RULES, 'NONE', 'PURE', 'HERO', 1).join('\n')
    expect(single).not.toContain('must be clearly different')
    const pair = buildRulePromptLines(DEFAULT_EBAY_IMAGE_RULES, 'NONE', 'PURE', 'HERO', 2).join('\n')
    expect(pair).toContain('clearly different from the other 1 image(s) of the same category')
  })

  it('关闭某条规则后对应提示词行消失，商品还原行始终在', () => {
    const off = buildRulePromptLines({ ...DEFAULT_EBAY_IMAGE_RULES, FACTS_ONLY: false, COLOR_TRUE: false, SCALE_TRUE: false }, 'NONE', 'PURE', 'SCENE', 1).join('\n')
    expect(off).not.toContain('Do not invent features')
    expect(off).not.toContain('no colour grading')
    expect(off).not.toContain('real-world scale')
    expect(off).toContain('Product fidelity is absolute')
  })

  it('主图无论模特选项如何都禁止人物与动物', () => {
    for (const presence of EBAY_IMAGE_MODEL_PRESENCE_OPTIONS.map(option => option.id)) {
      expect(modelPresencePrompt(presence, 'HERO')).toContain('No people, body parts or animals')
    }
  })

  it('痛点/场景按模特选项出文案，非法值回落「不出现」', () => {
    expect(normalizeEbayImageModelPresence('HUMAN')).toBe('HUMAN')
    expect(normalizeEbayImageModelPresence('ROBOT')).toBe(DEFAULT_EBAY_IMAGE_MODEL_PRESENCE)
    expect(modelPresencePrompt('HUMAN', 'SCENE')).toContain('Exactly one person')
    expect(modelPresencePrompt('HUMAN_PET', 'PAIN_POINT')).toContain('one pet')
    expect(modelPresencePrompt('HANDS', 'PRODUCT')).toContain('one human hand')
    // 持久化到 localStorage 的旧值可能是任意字符串，运行时必须回落「不出现」
    expect(modelPresencePrompt('ROBOT' as never, 'SCENE')).toContain('No people, body parts or animals')
  })

  it('亚马逊模式才写卖点文字图层约束', () => {
    expect(buildRulePromptLines(DEFAULT_EBAY_IMAGE_RULES, 'NONE', 'PURE', 'HERO', 1).join('\n')).not.toContain('overlay text')
    expect(buildRulePromptLines(DEFAULT_EBAY_IMAGE_RULES, 'NONE', 'TEXT_COMBO', 'SCENE', 1).join('\n')).toContain('overlay text')
  })
})

describe('生成前规则摘要', () => {
  it('列出全部生效规则、模特选择与平台口径', () => {
    const text = describeActiveEbayImageRules(DEFAULT_EBAY_IMAGE_RULES, 'HUMAN', 'PURE')
    expect(text).toContain('商品 100% 还原')
    expect(text).toContain('模特：允许 1 位人物')
    expect(text).toContain('eBay 纯图无文字')
  })

  it('关掉的规则不再出现在摘要里（避免用户误以为仍生效）', () => {
    const text = describeActiveEbayImageRules({ ...DEFAULT_EBAY_IMAGE_RULES, CLEAN_FRAME: false }, 'NONE', 'TEXT_COMBO')
    expect(text).not.toContain('无水印边框角标')
    expect(text).toContain('亚马逊可加卖点文字')
  })
})
