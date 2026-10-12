import { describe, expect, it } from 'vitest'
import { matchPalletCategory, parseCategoryClassifyReply } from '../palletCategoryMatch'
import type { EbayStoreCategory } from '../contracts'

const node = (categoryId: string, name: string, level: number, parentCategoryId = '', sortOrder = 0): EbayStoreCategory => ({
  storeId: 'store-1', categoryId, name, parentCategoryId, level, childCount: 0, listingCount: 0, sortOrder, status: 'ACTIVE', syncedAt: ''
})

const tree: EbayStoreCategory[] = [
  node('c-furniture', '家具', 1, '', 0),
  node('c-bedroom', 'Bedroom Furniture', 2, 'c-furniture', 0),
  node('c-beds', 'Bed Frames & Bases', 3, 'c-bedroom', 0),
  node('c-sets', 'Bedroom Sets', 3, 'c-bedroom', 1),
  node('c-living', 'Living Room', 2, 'c-furniture', 1),
  node('c-sofas', 'Sofas & Loveseats', 3, 'c-living', 0)
]

describe('matchPalletCategory', () => {
  it('源三级类目与树节点相等直接命中', () => {
    const hit = matchPalletCategory({ title: 'Whatever', category: '家具', subcategory: 'Bedroom Furniture', tertiaryCategory: '高架床' }, tree)
    expect(hit?.categoryId).toBe('c-bedroom')
    expect(hit?.score).toBe(100)
  })

  it('包含匹配取最深节点', () => {
    const hit = matchPalletCategory({ title: 'Whatever', category: '', subcategory: '', tertiaryCategory: 'Bed Frames' }, tree)
    expect(hit?.categoryId).toBe('c-beds')
  })

  it('标题 token 与节点路径交集 ≥2 命中（含单复数归一）', () => {
    const hit = matchPalletCategory({ title: 'Loft Beds Frame with Storage', category: '', subcategory: '', tertiaryCategory: '' }, tree)
    expect(hit?.categoryId).toBe('c-beds')
    const sofa = matchPalletCategory({ title: 'Universal Sofa Loveseat Couch', category: '', subcategory: '', tertiaryCategory: '' }, tree)
    expect(sofa?.categoryId).toBe('c-sofas')
  })

  it('无匹配返回 null（落未分类手工选）', () => {
    const hit = matchPalletCategory({ title: '2PC Universal Bucket Racing Seats Stitch Red PVC Leather', category: '汽车用品', subcategory: '座椅', tertiaryCategory: '赛车座椅' }, tree)
    expect(hit).toBeNull()
  })

  it('空树返回 null', () => {
    expect(matchPalletCategory({ title: 'Bed Frame', category: '家具', subcategory: '', tertiaryCategory: '' }, [])).toBeNull()
  })
})

describe('parseCategoryClassifyReply', () => {
  const valid = new Set(['c-beds', 'c-sofas'])
  it('命中树内节点', () => {
    expect(parseCategoryClassifyReply('```json\n{"categoryId":"c-beds","reason":"座椅类"}\n```', valid).categoryId).toBe('c-beds')
  })
  it('NONE 与空 id 返回 null', () => {
    expect(parseCategoryClassifyReply('{"categoryId":"NONE"}', valid).categoryId).toBeNull()
    expect(parseCategoryClassifyReply('{"categoryId":""}', valid).categoryId).toBeNull()
  })
  it('树外 id 与坏 JSON 返回 null 且带中文原因', () => {
    const outside = parseCategoryClassifyReply('{"categoryId":"c-xxx"}', valid)
    expect(outside.categoryId).toBeNull()
    expect(outside.reason).includes('不在店铺类目树内')
    const broken = parseCategoryClassifyReply('not json at all', valid)
    expect(broken.categoryId).toBeNull()
    expect(broken.reason).includes('JSON')
  })
})
