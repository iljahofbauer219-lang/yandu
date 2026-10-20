import { describe, expect, it } from 'vitest'
import { DEFAULT_EBAY_IMAGE_RULES } from '../ebayImageRules'
import {
  DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS,
  buildCategoryGenerationPrompt,
  buildCategoryShotCards,
  buildMarketingFactRows,
  buildSetStatement,
  cleanMarketingFeatureLines,
  describeEbayImageCategoryCounts,
  ebayImageCountsFromLegacyPerCount,
  extractSetCount,
  fullSizeReferenceUrl,
  normalizeEbayImageCategoryCounts,
  parseMarketingFactsReply,
  pickMarketingSpecifications,
  selectCategoryReferences,
  topMarketingSearchTerms,
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

describe('营销事实卡七项展示', () => {
  it('按核心商品词→搜索长尾词→产品规格→产品特点→购买理由→痛点→场景定序', () => {
    const rows = buildMarketingFactRows({
      purchaseReason: '钢架配高回弹海绵，久坐不塌',
      painPoints: ['原车座椅缺乏支撑'],
      scenarios: ['日常通勤'],
      specifications: ['材质：PVC 皮革', '可调角度：90-180 度'],
      features: ['红色缝线运动风格']
    }, { coreTerm: 'Racing Seat', searchTerms: ['Bucket Racing Seats', 'Car Seat with Slider'] })
    expect(rows.map(row => row.label)).toEqual(['核心商品词', '搜索长尾词', '产品规格', '产品特点', '购买理由', '痛点解决', '应用场景'])
    expect(rows[0].text).toBe('Racing Seat')
    expect(rows[1].text).toBe('Bucket Racing Seats；Car Seat with Slider')
    expect(rows[2].text).toBe('材质：PVC 皮革；可调角度：90-180 度')
    expect(rows[4].text).toBe('钢架配高回弹海绵，久坐不塌')
  })

  it('缺项一律中文「资料未提及」，旧版事实卡（无规格/特点字段）不报错', () => {
    const rows = buildMarketingFactRows({ purchaseReason: 'r', painPoints: ['p'], scenarios: ['s'] })
    expect(rows.map(row => row.text)).toEqual(['资料未提及', '资料未提及', '资料未提及', '资料未提及', 'r', 'p', 's'])
    expect(buildMarketingFactRows(null).every(row => row.text === '资料未提及')).toBe(true)
  })

  it('四条多条行统一读法：句号收尾保留句号且其后不加「；」，未收尾条目仍用「；」断词', () => {
    const rows = buildMarketingFactRows({
      purchaseReason: '久坐不塌',
      painPoints: ['原厂座椅缺乏支撑，影响驾驶体验。', '长途驾驶易疲劳不适', '普通座椅易磨损变形。'],
      scenarios: ['日常通勤。', '车内改装升级'],
      specifications: ['颜色：Black', '材质：PVC'],
      features: ['钢架结构稳固耐用。', '通用型适配95%车型。']
    }, { coreTerm: 'Racing Seat', searchTerms: ['Bucket Racing Seats', 'racing seat'] })
    expect(rows[3].text).toBe('钢架结构稳固耐用。通用型适配95%车型。')
    expect(rows[5].text).toBe('原厂座椅缺乏支撑，影响驾驶体验。长途驾驶易疲劳不适；普通座椅易磨损变形。')
    expect(rows[6].text).toBe('日常通勤。车内改装升级')
    expect(rows.every(row => !/。；|[！?]；/.test(row.text))).toBe(true)
    /** 不带句号的关键词与规格条目不受本次统一影响 */
    expect(rows[0].text).toBe('Racing Seat')
    expect(rows[1].text).toBe('Bucket Racing Seats；racing seat')
    expect(rows[2].text).toBe('颜色：Black；材质：PVC')
    expect(rows[4].text).toBe('久坐不塌')
    const bare = buildMarketingFactRows({
      purchaseReason: 'r', painPoints: ['p'], scenarios: ['s'], features: ['红色缝线', '可调角度90-180度']
    })
    expect(bare[3].text).toBe('红色缝线；可调角度90-180度')
  })
})

describe('营销事实卡三项口径收紧', () => {
  it('搜索长尾词按成交件数（次按覆盖率）取最主要 5 个', () => {
    expect(topMarketingSearchTerms([
      { term: 'racing seat', count: 30, coverage: 0.3 },
      { term: 'bucket seat', count: 80, coverage: 0.5 },
      { term: 'pvc leather', count: 55, coverage: 0.4 },
      { term: 'reclining bucket', count: 40, coverage: 0.6 },
      { term: 'universal racing', count: 40, coverage: 0.2 },
      { term: 'seat slider', count: 12, coverage: 0.1 },
      { term: '   ', count: 999, coverage: 1 }
    ])).toEqual(['bucket seat', 'pvc leather', 'reclining bucket', 'universal racing', 'racing seat'])
  })

  it('长尾词忽略大小写与多余空白去重（保留首次出现的写法），空清单不报错', () => {
    expect(topMarketingSearchTerms([{ term: 'A  B', count: 5, coverage: 0 }, { term: 'a b', count: 4, coverage: 0 }, { term: 'c d', count: 3, coverage: 0 }])).toEqual(['A B', 'c d'])
    expect(topMarketingSearchTerms([])).toEqual([])
    expect(topMarketingSearchTerms(undefined)).toEqual([])
  })

  it('产品规格只留产品尺寸/颜色/材质，尺寸三键合并为一条', () => {
    expect(pickMarketingSpecifications([
      { key: 'Item Code', value: 'W1739S00002' },
      { key: '产品类型', value: 'Combo Item' },
      { key: '产品名称', value: '2PC Universal Bucket Racing Seats' },
      { key: '产地', value: 'China' },
      { key: '颜色', value: 'Black' },
      { key: '材质', value: 'PVC' },
      { key: '组装长度 (英寸)', value: '18.10' },
      { key: '组装宽度 (英寸)', value: '22.04' },
      { key: '组装高度 (英寸)', value: '33.50' },
      { key: '产品重量 (磅)', value: '61.00' }
    ])).toEqual(['产品尺寸：18.10×22.04×33.50 英寸', '颜色：Black', '材质：PVC'])
  })

  it('页面直接给「产品尺寸」一键时照原样取，缺项不硬凑', () => {
    expect(pickMarketingSpecifications([{ key: '产品尺寸', value: '45×45×90 cm' }, { key: '材质', value: '钢架' }])).toEqual(['产品尺寸：45×45×90 cm', '材质：钢架'])
    expect(pickMarketingSpecifications([{ key: 'Item Code', value: 'ABC123' }])).toEqual([])
    expect(pickMarketingSpecifications(undefined)).toEqual([])
  })

  it('产品特点回落：清洗行首符号与编号，最多 3 条，不误伤「2PC」', () => {
    expect(cleanMarketingFeatureLines([
      '⚠️ATTENTION – Universal for 95% cars',
      '✅High Quality - premium PVC leather',
      '1.【Ergonomic】Designed ergonomically',
      '2PC Universal Bucket Racing Seats',
      '第五条不该出现在事实卡里'
    ])).toEqual(['ATTENTION – Universal for 95% cars', 'High Quality - premium PVC leather', '【Ergonomic】Designed ergonomically'])
    expect(cleanMarketingFeatureLines(null)).toEqual([])
  })

  it('产品特点与痛点/场景同读法：句末句号保留、其后不加「；」，落库原文不变', () => {
    const facts = {
      purchaseReason: '一条足够长的购买理由',
      painPoints: ['原车座椅久坐腰酸'],
      scenarios: ['改装车日常通勤'],
      features: ['钢架结构稳固耐用。', 'PVC皮革配红色缝线。']
    }
    expect(buildMarketingFactRows(facts)[3].text).toBe('钢架结构稳固耐用。PVC皮革配红色缝线。')
    expect(buildMarketingFactRows({ ...facts, features: ['只有一条特点。'] })[3].text).toBe('只有一条特点。')
    expect(facts.features[0]).toBe('钢架结构稳固耐用。')
  })

  it('模型返回的 features 收敛为至多 3 条；未返回时不写该字段', () => {
    const withFeatures = parseMarketingFactsReply(JSON.stringify({
      purchaseReason: '一条足够长的购买理由文本',
      painPoints: ['原车座椅久坐腰酸'],
      scenarios: ['改装车日常通勤'],
      features: ['通用车型安装', 'PVC 皮革耐磨', '钢架高回弹海绵', '多余第四条不要']
    }))
    expect(withFeatures?.features).toEqual(['通用车型安装', 'PVC 皮革耐磨', '钢架高回弹海绵'])
    const without = parseMarketingFactsReply(JSON.stringify({
      purchaseReason: '一条足够长的购买理由文本',
      painPoints: ['原车座椅久坐腰酸'],
      scenarios: ['改装车日常通勤']
    }))
    expect(without).not.toHaveProperty('features')
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

describe('规则化分镜（同类不重复与模特选项）', () => {
  const facts = { purchaseReason: 'reason text', painPoints: ['p1 pain', 'p2 pain', 'p3 pain'], scenarios: ['s1 scene', 's2 scene'] }
  const urls = ['u-hero', 'u-side', 'u-back', 'u-top', 'u-detail', 'u-scene']
  const labels = ['主图', '侧面', '背面', '俯视', '细节', '应用场景']

  it('每张卡记录同类第几张与共几张（痛点受事实条数封顶时总数同步）', () => {
    const cards = buildCategoryShotCards(facts, { HERO: 3, PAIN_POINT: 4, SCENE: 2 })
    expect(cards.filter(card => card.category === 'HERO').map(card => [card.siblingIndex, card.siblingCount])).toEqual([[0, 3], [1, 3], [2, 3]])
    expect(cards.filter(card => card.category === 'PAIN_POINT').map(card => card.siblingCount)).toEqual([3, 3, 3])
    expect(cards.filter(card => card.category === 'SCENE').map(card => card.siblingIndex)).toEqual([0, 1])
  })

  it('主图四张各按自己的机位取锚定原图，同类多张不再共用同一组参照', () => {
    const first = selectCategoryReferences(urls, labels, 'HERO', 2, 0)
    const second = selectCategoryReferences(urls, labels, 'HERO', 2, 1)
    const third = selectCategoryReferences(urls, labels, 'HERO', 2, 2)
    expect(first[0]).toBe('u-hero')
    expect(second[0]).toBe('u-side')
    expect(third[0]).toBe('u-back')
    expect(new Set([first.join(), second.join(), third.join()]).size).toBe(3)
  })

  it('细节卡按材质/五金/尺寸/安装分档锚定，缺角色时整组往后挪位', () => {
    expect(selectCategoryReferences(urls, labels, 'PRODUCT', 2, 0)).toEqual(['u-detail', 'u-hero'])
    expect(selectCategoryReferences(urls, labels, 'PRODUCT', 2, 1)).toEqual(['u-hero', 'u-side'])
    expect(selectCategoryReferences(urls, labels, 'PRODUCT', 2, 3)).toEqual(['u-back', 'u-top'])
  })

  it('痛点/场景卡无视角档，按 siblingIndex 轮转整组参照', () => {
    expect(selectCategoryReferences(urls, labels, 'SCENE', 3, 0)).toEqual(['u-scene', 'u-hero', 'u-side'])
    expect(selectCategoryReferences(urls, labels, 'SCENE', 3, 1)).toEqual(['u-hero', 'u-side', 'u-back'])
  })

  it('不传 rotation 与传 0 完全一致（旧调用口径不变）', () => {
    expect(selectCategoryReferences(urls, labels, 'HERO', 3)).toEqual(selectCategoryReferences(urls, labels, 'HERO', 3, 0))
    expect(selectCategoryReferences(urls, labels, 'PRODUCT', 2)).toEqual(['u-detail', 'u-hero'])
  })

  it('不传规则上下文时提示词与旧文案逐字一致', () => {
    const [hero] = buildCategoryShotCards(facts, { HERO: 1 })
    const legacy = buildCategoryGenerationPrompt(hero, facts, 'PURE')
    expect(legacy).toContain('Keep the sellable product identity, structure, proportions, color, material and packaging exactly as in the reference images.')
    expect(legacy).toContain('No watermark, no border, no promotional badge, no measurement labels.')
    expect(legacy).not.toContain('Product fidelity is absolute')
    expect(legacy).not.toContain('No people, body parts or animals')
  })

  it('传规则上下文后写入还原/雷同/模特行，同类仅 1 张时不写「必须不同」', () => {
    const [single] = buildCategoryShotCards(facts, { HERO: 1 })
    const prompt = buildCategoryGenerationPrompt(single, facts, 'PURE', { rules: DEFAULT_EBAY_IMAGE_RULES, presence: 'NONE' })
    expect(prompt).toContain('Product fidelity is absolute')
    expect(prompt).toContain('No people, body parts or animals')
    expect(prompt).not.toContain('clearly different from the other')
    expect(prompt).not.toContain('Keep the sellable product identity')
    const [heroOfThree] = buildCategoryShotCards(facts, { HERO: 3 })
    expect(buildCategoryGenerationPrompt(heroOfThree, facts, 'PURE', { rules: DEFAULT_EBAY_IMAGE_RULES, presence: 'NONE' })).toContain('clearly different from the other 2 image(s)')
  })

  it('痛点卡人物与否只由模特选项决定，文案不再写死「without people」', () => {
    const painCards = buildCategoryShotCards(facts, { PAIN_POINT: 2 })
      .filter(card => card.category === 'PAIN_POINT')
    expect(painCards[0].instruction).not.toContain('without people')
    const withHuman = buildCategoryGenerationPrompt(painCards[0], facts, 'PURE', { rules: DEFAULT_EBAY_IMAGE_RULES, presence: 'HUMAN' })
    expect(withHuman).toContain('Exactly one person')
    expect(withHuman).not.toContain('No people, body parts or animals')
    const defaultPresence = buildCategoryGenerationPrompt(painCards[0], facts, 'PURE', { rules: DEFAULT_EBAY_IMAGE_RULES })
    expect(defaultPresence).toContain('No people, body parts or animals')
  })
})
