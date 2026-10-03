/**
 * repository.resolveImageViews 角色门控单测（缺陷 A：货盘外链旁路）。
 * 触库路径（listProducts/getProduct/导出）由 verify-erp-p2.ts e2e 覆盖。
 */
import { describe, expect, it } from 'vitest'
import { countExternalImageRefs, resolveImageViews } from '../repository.js'

/** 与 repository.RawImage 同构（该接口未导出，此处按结构传参） */
interface TestImage {
  id: string
  imageType: string
  sourceUrl?: string
  localPath: string
  platform: string | null
  isSelected: number
  sortOrder: number
}

const SUPPLIER_HOST = 'cdn.gigab2b.com'
const SOURCE_URL = `https://${SUPPLIER_HOST}/product/1/main.jpg`
const LOCAL_PATH = 'erp/org1/p1/main.jpg'

function image(overrides: Partial<TestImage> = {}): TestImage {
  return {
    id: 'img1',
    imageType: 'MAIN',
    sourceUrl: SOURCE_URL,
    localPath: '',
    platform: null,
    isSelected: 0,
    sortOrder: 0,
    ...overrides
  }
}

describe('resolveImageViews 外链门控（规格 §2.2 + §5）', () => {
  it('运营 + 未落盘图：url 为空串且不出现 sourceUrl 键', () => {
    const [view] = resolveImageViews([image()], false)
    expect(view?.url).toBe('')
    expect(view).not.toHaveProperty('sourceUrl')
    expect(JSON.stringify(view)).not.toContain(SUPPLIER_HOST)
  })

  it('采集 + 未落盘图：url 回落外链原值，并显式带 sourceUrl', () => {
    const [view] = resolveImageViews([image()], true)
    expect(view?.url).toBe(SOURCE_URL)
    expect(view?.sourceUrl).toBe(SOURCE_URL)
  })

  it('已落盘图：两角色都只拿到本地签名 URL，不再暴露货盘外链', () => {
    for (const canViewSource of [false, true]) {
      const [view] = resolveImageViews([image({ localPath: LOCAL_PATH })], canViewSource)
      expect(view?.url).toContain(`/media/${LOCAL_PATH}`)
      expect(view?.url).toContain('signature=')
      expect(view?.url).not.toContain(SUPPLIER_HOST)
      expect(view).not.toHaveProperty('sourceUrl')
    }
  })

  it('SQL 层已剥离 sourceUrl 的行（运营）不抛异常', () => {
    const stripped = image({ sourceUrl: undefined })
    expect(() => resolveImageViews([stripped], false)).not.toThrow()
    const [view] = resolveImageViews([stripped], false)
    expect(view?.url).toBe('')
    expect(view).not.toHaveProperty('sourceUrl')
    // 采集角色遇到被剥离的行同样不炸：url 回落空串，sourceUrl 键值为 undefined
    const [collectorView] = resolveImageViews([stripped], true)
    expect(collectorView?.url).toBe('')
  })
})

describe('countExternalImageRefs（§5 红线断言）', () => {
  it('只统计「未落盘且仍有外链」的行', () => {
    expect(countExternalImageRefs([
      { localPath: '', sourceUrl: SOURCE_URL },
      { localPath: LOCAL_PATH, sourceUrl: SOURCE_URL },
      { localPath: '' }
    ])).toBe(1)
  })
})
