import { describe, expect, it } from 'vitest'
import { DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS, type EbayImageCategoryCounts } from '../ebayImageCategoryPlan'
import {
  buildSourceComplianceChecks,
  mergeSimpleGalleryOrder,
  normalizeSimpleCategoryCounts,
  normalizeSimpleOrder,
  simpleSourceCategory,
  triageSimpleSources,
  withSimpleCategoryCount,
  type EbaySimpleGalleryMember,
  type EbaySimpleSourceCheck
} from '../ebayImageSimpleLane'
import { classifyBackgroundFromBgra } from '../imageSimilarity'

const check = (url: string, over: Partial<EbaySimpleSourceCheck> = {}): EbaySimpleSourceCheck => ({
  url, role: 'DETAIL', longestEdge: 1200, sizeOk: true, visualOk: true, visualIssues: [], visualReview: [], extraToPage: false, ...over
})

describe('简版档角色映射与张数', () => {
  it('角色映射到四类图', () => {
    expect(simpleSourceCategory('HERO')).toBe('HERO')
    expect(simpleSourceCategory('FRONT')).toBe('PRODUCT')
    expect(simpleSourceCategory('SIZE')).toBe('PRODUCT')
    expect(simpleSourceCategory('PAIN_POINT')).toBe('PAIN_POINT')
    expect(simpleSourceCategory('SCENE')).toBe('SCENE')
  })

  it('简版档张数允许 0，模型档口径不受影响', () => {
    expect(normalizeSimpleCategoryCounts({ HERO: 0, PRODUCT: 9, PAIN_POINT: -2 })).toEqual({ HERO: 0, PRODUCT: 4, PAIN_POINT: 2, SCENE: 2 })
    expect(withSimpleCategoryCount({ ...DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS }, 'SCENE', '')).toEqual({ ...DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS, SCENE: 0 })
    expect(normalizeSimpleCategoryCounts(null)).toEqual(DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS)
  })
})

describe('原图合规事实与分诊', () => {
  it('尺寸取本地快照、视觉规则取逐图报告；缺数据记未知不判违规', () => {
    const checks = buildSourceComplianceChecks(
      [{ url: 'https://cdn/a.jpg', role: 'HERO' }, { url: 'https://cdn/b.jpg', role: 'DETAIL' }],
      [{ id: 'm1', remoteUrl: 'https://cdn/a.jpg', width: 400, height: 300 }, { id: 'm2', remoteUrl: 'https://cdn/b.jpg', width: 1200, height: 1200 }],
      {
        checkedAt: '', model: 'm', ruleSetVersion: 'v1', status: 'FAILED', checkedImageCount: 1, passed: 0, failed: 1, review: 0, message: '',
        images: [{
          mediaId: 'm2', sortOrder: 0, status: 'FAILED', summary: '',
          rules: [{ rule: 'NO_WATERMARK', label: '无水印', status: 'FAILED', confidence: 0.9, evidence: '右下角水印' }]
        }]
      } as never
    )
    expect(checks[0]).toMatchObject({ longestEdge: 400, sizeOk: false, visualOk: true })
    expect(checks[1]).toMatchObject({ longestEdge: 1200, sizeOk: true, visualOk: false, visualIssues: ['无水印'] })
    expect(buildSourceComplianceChecks([{ url: 'x', role: 'HERO' }], [], null)[0]).toMatchObject({ longestEdge: 0, sizeOk: true, visualOk: true })
  })

  it('分诊：尺寸/视觉/主图白底任一不过进重生成单，其余沿用', () => {
    const { keep, regen } = triageSimpleSources([
      check('a'),
      check('b', { sizeOk: false, longestEdge: 368 }),
      check('c', { visualOk: false, visualIssues: ['无水印'] }),
      check('d', { role: 'HERO' }),
      check('e', { role: 'HERO' })
    ], { d: 'NON_WHITE', e: 'UNKNOWN' })
    expect(keep).toEqual(['a', 'e'])
    expect(regen.map(item => item.url)).toEqual(['b', 'c', 'd'])
    expect(regen[0].reasons[0]).toContain('368px')
    expect(regen[2].reasons).toEqual(['主图背景非纯白'])
  })
})

describe('简版档排序与按类回传', () => {
  const members: EbaySimpleGalleryMember[] = [
    { url: 'o1', category: 'HERO', kind: 'ORIGINAL' },
    { url: 'o2', category: 'PRODUCT', kind: 'ORIGINAL' },
    { url: 'g1', category: 'SCENE', kind: 'GENERATED' },
    { url: 'g2', category: 'SCENE', kind: 'GENERATED' }
  ]

  it('排序清单去重、剔除失效地址，新成员追加、已删除不回填', () => {
    expect(normalizeSimpleOrder(['g2', 'o1', 'g2', 'gone'], members)).toEqual(['g2', 'o1', 'o2', 'g1'])
    expect(normalizeSimpleOrder(['o1'], members, ['g1'])).toEqual(['o1', 'o2', 'g2'])
    expect(normalizeSimpleOrder([], members)).toEqual(['o1', 'o2', 'g1', 'g2'])
  })

  it('按类回传保持同类内顺序（即上传顺序）', () => {
    const order = normalizeSimpleOrder(['g2', 'o1', 'g1', 'o2'], members)
    expect(mergeSimpleGalleryOrder(order, members)).toEqual({ HERO: ['o1'], PRODUCT: ['o2'], SCENE: ['g2', 'g1'] })
    expect(mergeSimpleGalleryOrder([], members)).toEqual({})
  })
})

describe('主图白底像素判定', () => {
  const bitmap = (fill: number, corner = fill) => Uint8Array.from(Array.from({ length: 16 * 16 * 4 }, (_unused, offset) => {
    const pixel = Math.floor(offset / 4)
    const x = pixel % 16
    const y = Math.floor(pixel / 16)
    const ring = x === 0 || y === 0 || x === 15 || y === 15
    const value = ring ? corner : fill
    return offset % 4 === 3 ? 255 : value
  }))

  it('外圈近白判纯白，外圈有色判非纯白，尺寸不符记未知', () => {
    expect(classifyBackgroundFromBgra(bitmap(120, 250), 16, 16)).toBe('WHITE')
    expect(classifyBackgroundFromBgra(bitmap(250, 40), 16, 16)).toBe('NON_WHITE')
    expect(classifyBackgroundFromBgra(bitmap(250), 9, 8)).toBe('UNKNOWN')
    expect(classifyBackgroundFromBgra(new Uint8Array(4), 16, 16)).toBe('UNKNOWN')
  })
})

describe('原图相对图文页图集多出来判定', () => {
  const pageAssets = ['shot-01.jpg', 'shot-02.png', 'shot-03.webp']

  it('文件名归一：去查询串、去 eBay /s-lNNN 缩放段、大小写与扩展名差异均匹配', () => {
    const checks = buildSourceComplianceChecks(
      [
        { url: 'https://cdn.example/SHOT-01.JPG?token=abc', role: 'HERO' },
        { url: 'https://cdn.example/shot-02/s-l1600.png', role: 'DETAIL' },
        { url: 'https://cdn.example/extra-photo.jpg', role: 'SCENE' }
      ],
      [],
      null,
      pageAssets
    )
    expect(checks[0].extraToPage).toBe(false)
    expect(checks[1].extraToPage).toBe(false)
    expect(checks[2].extraToPage).toBe(true)
  })

  it('图文页清单为空时一律不判多出来', () => {
    const checks = buildSourceComplianceChecks(
      [{ url: 'https://cdn/anything.jpg', role: 'HERO' }],
      [],
      null,
      []
    )
    expect(checks[0].extraToPage).toBe(false)
  })

  it('本例产品：16 张原图中那张 368px 的主图同时挂「非图文页图集」+ 尺寸不合格', () => {
    const checks = buildSourceComplianceChecks(
      [
        { url: 'https://cdn/normal-1200.jpg', role: 'DETAIL' },
        { url: 'https://cdn/extra-small-368.jpg', role: 'HERO' }
      ],
      [
        { id: 'm1', remoteUrl: 'https://cdn/normal-1200.jpg', width: 1200, height: 1200 },
        { id: 'm2', remoteUrl: 'https://cdn/extra-small-368.jpg', width: 368, height: 368 }
      ],
      null,
      ['normal-1200.jpg'] // 不含 extra-small-368.jpg
    )
    expect(checks[0]).toMatchObject({ extraToPage: false, sizeOk: true })
    expect(checks[1]).toMatchObject({ extraToPage: true, sizeOk: false, longestEdge: 368 })
  })
})
