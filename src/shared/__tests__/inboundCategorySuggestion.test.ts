import { describe, expect, it } from 'vitest'
import { buildCategoryPromptTree, parseInboundCategorySuggestionReply, type CatalogBranch } from '../inboundCategorySuggestion'

const branches: CatalogBranch[] = [
  {
    category: '汽车用品',
    subcategories: [
      { name: '汽车内饰用品', tertiaries: ['方向盘套', '迎宾踏板、脚踏板', '头枕'] },
      { name: '外饰/改装/配件', tertiaries: ['汽车车衣', '车身贴'] },
    ],
  },
  { category: '家具', subcategories: [{ name: '卧室家具', tertiaries: ['双层床', '床头柜'] }] },
]

describe('buildCategoryPromptTree', () => {
  it('压平一/二/三级并剔除无二级分支', () => {
    const tertiary: Record<string, { name: string; icon: string }[]> = { 汽车内饰用品: [{ name: '方向盘套', icon: '🧭' }, { name: '头枕', icon: '🛋' }] }
    const tree = buildCategoryPromptTree({
      categories: [
        { name: '汽车用品', children: ['汽车内饰用品', '汽车内饰用品', '  '] },
        { name: '花园与户外', children: [] },
      ],
      tertiary,
    })
    expect(tree).toHaveLength(1)
    expect(tree[0].category).toBe('汽车用品')
    expect(tree[0].subcategories).toEqual([{ name: '汽车内饰用品', tertiaries: ['方向盘套', '头枕'] }])
  })
})

describe('parseInboundCategorySuggestionReply', () => {
  it('标准 JSON 三级路径', () => {
    expect(parseInboundCategorySuggestionReply('{"category":"汽车用品","subcategory":"汽车内饰用品","tertiaryCategory":"方向盘套"}', branches))
      .toEqual({ category: '汽车用品', subcategory: '汽车内饰用品', tertiaryCategory: '方向盘套' })
  })

  it('代码围栏包裹的 JSON', () => {
    expect(parseInboundCategorySuggestionReply('```json\n{"category":"家具","subcategory":"卧室家具","tertiaryCategory":"双层床"}\n```', branches))
      .toEqual({ category: '家具', subcategory: '卧室家具', tertiaryCategory: '双层床' })
  })

  it('path 数组格式', () => {
    expect(parseInboundCategorySuggestionReply('{"path":["汽车用品","外饰/改装/配件","车身贴"]}', branches))
      .toEqual({ category: '汽车用品', subcategory: '外饰/改装/配件', tertiaryCategory: '车身贴' })
  })

  it('三级匹配不到时只给到二级', () => {
    expect(parseInboundCategorySuggestionReply('{"category":"汽车用品","subcategory":"汽车内饰用品","tertiaryCategory":"赛车桶椅"}', branches))
      .toEqual({ category: '汽车用品', subcategory: '汽车内饰用品', tertiaryCategory: '' })
  })

  it('节点名带空格与标点差异仍可归一命中', () => {
    expect(parseInboundCategorySuggestionReply('{"category":" 汽车用品 ","subcategory":"汽车内饰用品","tertiaryCategory":" 方向盘 套 "}', branches))
      .toEqual({ category: '汽车用品', subcategory: '汽车内饰用品', tertiaryCategory: '方向盘套' })
    expect(parseInboundCategorySuggestionReply('{"category":"汽车用品","subcategory":"外饰、改装、配件","tertiaryCategory":"汽车车衣"}', branches))
      .toEqual({ category: '汽车用品', subcategory: '外饰/改装/配件', tertiaryCategory: '汽车车衣' })
  })

  it('目录库外的假一级类目返回 null', () => {
    expect(parseInboundCategorySuggestionReply('{"category":"数码","subcategory":"手机配件","tertiaryCategory":"手机壳"}', branches)).toBeNull()
  })

  it('二级不属于该一级返回 null', () => {
    expect(parseInboundCategorySuggestionReply('{"category":"汽车用品","subcategory":"卧室家具","tertiaryCategory":"双层床"}', branches)).toBeNull()
  })

  it('「一级：」标记行逐行解析', () => {
    expect(parseInboundCategorySuggestionReply('一级：家具\n二级：卧室家具\n三级：床头柜', branches))
      .toEqual({ category: '家具', subcategory: '卧室家具', tertiaryCategory: '床头柜' })
  })

  it('单行斜杠路径解析', () => {
    expect(parseInboundCategorySuggestionReply('最合适的类目：汽车用品/汽车内饰用品/头枕', branches))
      .toEqual({ category: '汽车用品', subcategory: '汽车内饰用品', tertiaryCategory: '头枕' })
  })

  it('坏 JSON 回落文本行', () => {
    expect(parseInboundCategorySuggestionReply('{"category":"家具","subcategory":"卧室家具",', branches)).toBeNull()
    expect(parseInboundCategorySuggestionReply('{"category":"家具","subcategory":"卧室家具",\n家具：卧室家具：双层床', branches))
      .toEqual({ category: '家具', subcategory: '卧室家具', tertiaryCategory: '双层床' })
  })

  it('空回复与空目录树返回 null', () => {
    expect(parseInboundCategorySuggestionReply('', branches)).toBeNull()
    expect(parseInboundCategorySuggestionReply('无法判断', branches)).toBeNull()
    expect(parseInboundCategorySuggestionReply('{"category":"家具","subcategory":"卧室家具","tertiaryCategory":"双层床"}', [])).toBeNull()
  })
})
