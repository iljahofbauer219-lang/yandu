import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MOCK_CATEGORIES, MOCK_TERTIARY_CATALOG, buildCatalogTree } from '../warehouseCatalogData'

describe('目录树名称单源：静态登记 ∪ 总货盘数据类目', () => {
  it('空数据源与静态登记逐字一致', () => {
    const tree = buildCatalogTree([])
    expect(tree.categories).toEqual(MOCK_CATEGORIES)
    expect(tree.tertiary).toEqual(MOCK_TERTIARY_CATALOG)
  })

  it('数据新增一/二/三级类目按首现序追加', () => {
    const tree = buildCatalogTree([
      { category: '砚都定制类目', subcategory: '定制二级', tertiaryCategory: '定制三级' },
      { category: '砚都定制类目', subcategory: '定制二级乙' }
    ])
    const appended = tree.categories[tree.categories.length - 1]
    expect(appended.name).toBe('砚都定制类目')
    expect(appended.children).toEqual(['定制二级', '定制二级乙'])
    const tertiary = tree.tertiary['定制二级'] || []
    expect(tertiary.map(option => option.name)).toContain('定制三级')
    expect((tertiary.find(option => option.name === '定制三级') || { icon: '' }).icon.endsWith('.png')).toBe(true)
  })

  it('与静态表同名不重复登记', () => {
    const tree = buildCatalogTree([{ category: '家具', subcategory: '卧室家具', tertiaryCategory: '高架床' }])
    expect(tree.categories).toHaveLength(MOCK_CATEGORIES.length)
    const furniture = tree.categories.find(group => group.name === '家具')
    expect((furniture?.children || []).filter(child => child === '卧室家具')).toHaveLength(1)
    const options = tree.tertiary['卧室家具'] || []
    expect(options.filter(option => option.name === '高架床')).toHaveLength(1)
  })

  it('静态二级下数据新增三级追加在登记序之后', () => {
    const staticCount = (MOCK_TERTIARY_CATALOG['卧室家具'] || []).length
    const tree = buildCatalogTree([{ category: '家具', subcategory: '卧室家具', tertiaryCategory: '定制床' }])
    const options = tree.tertiary['卧室家具'] || []
    expect(options).toHaveLength(staticCount + 1)
    expect(options[options.length - 1].name).toBe('定制床')
  })

  it('空白类目名被忽略', () => {
    const tree = buildCatalogTree([{ category: '  ', subcategory: '', tertiaryCategory: '' }, {}])
    expect(tree.categories).toEqual(MOCK_CATEGORIES)
  })

  it('两页目录面板同读单源：页面渲染树只准走 catalogTree（源码守卫）', () => {
    const page = readFileSync(path.resolve(process.cwd(), 'src/renderer/erp/PalletWarehousePage.tsx'), 'utf8')
    expect(page).toContain('buildCatalogTree(masterItems)')
    expect(page).toContain('catalogTree.categories.map')
    expect(page).not.toContain('MOCK_CATEGORIES.map')
  })
})
