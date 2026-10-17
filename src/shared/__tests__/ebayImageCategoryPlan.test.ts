import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS,
  buildCategoryGenerationPrompt,
  buildCategoryShotCards,
  buildSetStatement,
  describeEbayImageCategoryCounts,
  ebayImageCountsFromLegacyPerCount,
  extractSetCount,
  fullSizeReferenceUrl,
  normalizeEbayImageCategoryCounts,
  parseMarketingFactsReply,
  selectCategoryReferences,
  withEbayImageCategoryCount
} from '../ebayImageCategoryPlan'

describe('营销事实卡解析', () => {
  it('合法 JSON 收敛为 1 理由 + 至多 3 痛点/场景', () => {
    const facts = parseMarketingFactsReply(JSON.stringify({
      purchaseReason: '一套两件的桶形赛车座椅，含滑轨与调节器',
      painPoints: ['原车座椅久坐腰酸', '座椅滑动不稳', '过短易塌', '重复占位'],
      scenarios: ['改装车日常通勤', '赛道日包裹支撑']
    }))
    expect(facts).toEqual({
      purchaseReason: '一套两件的桶形赛车座椅，含滑轨与调节器',
      painPoints: ['原车座椅久坐腰酸', '座椅滑动不稳', '过短易塌'],
      scenarios: ['改装车日常通勤', '赛道日包裹支撑']
    })
  })

  it('围栏/缺字段/过短一律 null', () => {
    expect(parseMarketingFactsReply('```json\n{"purchaseReason":"ok reason here","painPoints":["a long enough pain"],"scenarios":["a long enough scene"]}\n```')).toBeTruthy()
    expect(parseMarketingFactsReply('{"purchaseReason":"ok","painPoints":[],"scenarios":["x"]}')).toBeNull()
    expect(parseMarketingFactsReply('not json')).toBeNull()
    expect(parseMarketingFactsReply('')).toBeNull()
  })
})

describe('四类图分镜计划（每类独立数量）', () => {
  const facts = { purchaseReason: 'reason text', painPoints: ['p1 pain', 'p2 pain', 'p3 pain'], scenarios: ['s1 scene', 's2 scene'] }

  it('四类各自数量生效，痛点/场景仍受事实条数封顶', () => {
    const cards = buildCategoryShotCards(facts, { HERO: 4, PRODUCT: 2, PAIN_POINT: 3, SCENE: 4 })
    expect(cards.filter(card => card.category === 'HERO')).toHaveLength(4)
    expect(cards.filter(card => card.category === 'PRODUCT')).toHaveLength(2)
    expect(cards.filter(card => card.category === 'PAIN_POINT')).toHaveLength(3)
    expect(cards.filter(card => card.category === 'SCENE')).toHaveLength(2)
  })

  it('缺省取默认数量（主图3/细节3/痛点2/场景2），越界钳到 1..4，非法回落默认', () => {
    const cards = buildCategoryShotCards(facts, { HERO: 1 })
    expect(cards.filter(card => card.category === 'HERO')).toHaveLength(1)
    expect(cards.filter(card => card.category === 'PRODUCT')).toHaveLength(3)
    expect(cards.filter(card => card.category === 'PAIN_POINT')).toHaveLength(2)
    expect(cards.filter(card => card.category === 'SCENE')).toHaveLength(2)
    expect(normalizeEbayImageCategoryCounts({ HERO: 9, PRODUCT: 0, PAIN_POINT: -3, SCENE: Number.NaN })).toEqual({ HERO: 4, PRODUCT: 3, PAIN_POINT: 2, SCENE: 2 })
  })

  it('单类数量调整：其余三类不受影响，清空取最小值 1', () => {
    const base = { HERO: 3, PRODUCT: 3, PAIN_POINT: 2, SCENE: 2 }
    expect(withEbayImageCategoryCount(base, 'HERO', 4)).toEqual({ HERO: 4, PRODUCT: 3, PAIN_POINT: 2, SCENE: 2 })
    expect(withEbayImageCategoryCount(base, 'SCENE', '')).toEqual({ ...base, SCENE: 1 })
    expect(withEbayImageCategoryCount(base, 'PAIN_POINT', 9)).toEqual({ ...base, PAIN_POINT: 4 })
  })

  it('旧单一「每类图片数」持久值迁移为四类同值', () => {
    expect(ebayImageCountsFromLegacyPerCount(1)).toEqual({ HERO: 1, PRODUCT: 1, PAIN_POINT: 1, SCENE: 1 })
    expect(ebayImageCountsFromLegacyPerCount('2')).toEqual({ HERO: 2, PRODUCT: 2, PAIN_POINT: 2, SCENE: 2 })
    expect(ebayImageCountsFromLegacyPerCount(undefined)).toEqual(DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS)
  })

  it('按钮文案显示四类各自张数', () => {
    expect(describeEbayImageCategoryCounts({ HERO: 3, PRODUCT: 2, PAIN_POINT: 2, SCENE: 1 })).toBe('主图 3 · 细节 2 · 痛点 2 · 场景 1')
  })

  it('eBay 纯图模式严禁文字，亚马逊模式允许文字图层', () => {
    const [card] = buildCategoryShotCards(facts, { HERO: 1 })
    expect(buildCategoryGenerationPrompt(card, facts, 'PURE')).toContain('NO added text')
    expect(buildCategoryGenerationPrompt(card, facts, 'TEXT_COMBO')).toContain('benefit text overlay')
  })
})

describe('参照图按角色选择与提示词强化', () => {
  const urls = ['u-hero', 'u-scene1', 'u-scene2', 'u-front', 'u-detail', 'u-size', 'u-pain']
  const labels = ['主图', '应用场景', '应用场景', '正面', '细节', '尺寸参照', '痛点依据']
  const thumb = 'https://cdn.example/a.jpg?x-cc=1&x-oss-process=image%2Fresize%2Cw_368%2Ch_368%2Cm_pad&x-cu=2'

  it('细节卡优先取细节/尺寸参照原图，主图卡优先主图/正面', () => {
    expect(selectCategoryReferences(urls, labels, 'PRODUCT', 3)).toEqual(['u-detail', 'u-size', 'u-front'])
    expect(selectCategoryReferences(urls, labels, 'HERO', 2)).toEqual(['u-hero', 'u-front'])
    expect(selectCategoryReferences(urls, labels, 'PAIN_POINT', 2)).toEqual(['u-pain', 'u-front'])
    expect(selectCategoryReferences(urls, labels, 'SCENE', 3)).toEqual(['u-scene1', 'u-scene2', 'u-hero'])
  })

  it('无角色标签回落前 N 张、上限裁剪、纯文生图模型不传参照', () => {
    expect(selectCategoryReferences(urls, [], 'PRODUCT', 2)).toEqual(['u-hero', 'u-scene1'])
    expect(selectCategoryReferences(urls, labels, 'PRODUCT', 8)).toHaveLength(7)
    expect(selectCategoryReferences(urls, labels, 'PRODUCT', 0)).toEqual([])
  })

  it('参照图去掉 CDN 缩略图参数取原图分辨率', () => {
    expect(selectCategoryReferences([thumb], ['细节'], 'PRODUCT', 1)).toEqual(['https://cdn.example/a.jpg?x-cc=1&x-cu=2'])
    expect(fullSizeReferenceUrl('https://cdn.example/b.jpg')).toBe('https://cdn.example/b.jpg')
  })

  it('套装件数识别与同框声明', () => {
    expect(extractSetCount('2PC Universal Bucket Racing Seats')).toBe(2)
    expect(extractSetCount('座椅 3 件套 含滑轨')).toBe(3)
    expect(extractSetCount('Single seat')).toBeNull()
    expect(buildSetStatement({ title: '2PC Racing Seats' })).toContain('2-piece set')
    expect(buildSetStatement({ title: 'Racing Seat' })).toBe('')
  })

  it('属性事实行进入细节/痛点/场景提示词且同类多张指令互不相同', () => {
    const context = { title: '2PC Racing Seats', itemSpecifics: [{ name: 'Material', value: 'PVC Leather' }, { name: 'Color', value: 'Black' }] }
    const cards = buildCategoryShotCards({ purchaseReason: 'reason text', painPoints: ['p1 pain', 'p2 pain'], scenarios: ['s1 scene', 's2 scene'] }, { PRODUCT: 3, PAIN_POINT: 2, SCENE: 2 }, context)
    const product = cards.filter(card => card.category === 'PRODUCT')
    const prompts = product.map(card => buildCategoryGenerationPrompt(card, { purchaseReason: 'reason text', painPoints: [], scenarios: [] }, 'PURE'))
    expect(new Set(prompts).size).toBe(prompts.length)
    prompts.forEach(prompt => {
      expect(prompt).toContain('Product facts: Material: PVC Leather; Color: Black')
      expect(prompt).toContain('2-piece set')
    })
    const pain = cards.filter(card => card.category === 'PAIN_POINT')
    expect(buildCategoryGenerationPrompt(pain[0], { purchaseReason: 'r', painPoints: [], scenarios: [] }, 'PURE')).toContain('p1 pain')
    expect(pain[0].framing).not.toBe(pain[1].framing)
  })

  it('白底子句只约束主图，痛点/场景背景跟随镜头要求', () => {
    const factsRow = { purchaseReason: 'reason text', painPoints: ['p1 pain'], scenarios: ['s1 scene'] }
    const cards = buildCategoryShotCards(factsRow, { HERO: 1, PAIN_POINT: 1, SCENE: 1 })
    const hero = cards.find(card => card.category === 'HERO')!
    const pain = cards.find(card => card.category === 'PAIN_POINT')!
    const scene = cards.find(card => card.category === 'SCENE')!
    expect(buildCategoryGenerationPrompt(hero, factsRow, 'PURE')).toContain('plain clean white background')
    expect(buildCategoryGenerationPrompt(pain, factsRow, 'PURE')).not.toContain('plain clean white background')
    expect(buildCategoryGenerationPrompt(scene, factsRow, 'PURE')).toContain('background must follow the shot requirement')
  })
})
