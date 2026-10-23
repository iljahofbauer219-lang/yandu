import { describe, expect, it } from 'vitest'
import { reorderDescriptionSections, reorderDescriptionText, type EbayDescriptionSectionLike } from '../ebayDescriptionSections'

const section = (id: string, title: string, content: string): EbayDescriptionSectionLike => ({ id, title, content })

describe('reorderDescriptionSections 固定区块顺序', () => {
  it('旧顺序重排为：概览→详细规格→经验证功能→包装内容→痛点→场景', () => {
    const input = [
      section('SUMMARY', 'Product Overview', 'Overview text.'),
      section('PROBLEMS', 'Customer Problems & Solutions', '1. Pain'),
      section('FEATURES', 'Verified Features', '- High Quality'),
      section('SPECIFICATIONS', 'Detailed Specifications', '- Color: Orange'),
      section('PACKAGE', 'Package Contents', '- 1 x Scooter'),
      section('SCENARIOS', 'Recommended Use Scenarios', '- Indoor: smooth floors'),
    ]
    expect(reorderDescriptionSections(input).map(item => item.id)).toEqual([
      'SUMMARY', 'SPECIFICATIONS', 'FEATURES', 'PACKAGE', 'PROBLEMS', 'SCENARIOS',
    ])
  })

  it('INSTALLATION/CARE 紧随包装内容之后、痛点之前；顺序已正确时保持稳定', () => {
    const input = [
      section('SUMMARY', 'Product Overview', 'Overview.'),
      section('SPECIFICATIONS', 'Detailed Specifications', '- Color: Orange'),
      section('FEATURES', 'Verified Features', '- Foldable'),
      section('PACKAGE', 'Package Contents', '- 1 x Manual'),
      section('INSTALLATION', 'Installation & Setup', '- Assembly required'),
      section('CARE', 'Care & Important Notes', '- Remove film'),
      section('PROBLEMS', 'Customer Problems & Solutions', '1. Pain'),
      section('SCENARIOS', 'Recommended Use Scenarios', '- Travel'),
    ]
    expect(reorderDescriptionSections(input).map(item => item.id)).toEqual([
      'SUMMARY', 'SPECIFICATIONS', 'FEATURES', 'PACKAGE', 'INSTALLATION', 'CARE', 'PROBLEMS', 'SCENARIOS',
    ])
    expect(reorderDescriptionSections(reorderDescriptionSections(input))).toEqual(reorderDescriptionSections(input))
  })
})

describe('reorderDescriptionSections 详细规格与包装内容分区去重', () => {
  it('详细规格里的包装行移入包装内容，不再留在详细规格', () => {
    const input = [
      section('SUMMARY', 'Product Overview', 'Overview.'),
      section('SPECIFICATIONS', 'Detailed Specifications', '- Color: Orange\n- Package Weight (lb): 68.02'),
      section('FEATURES', 'Verified Features', '- Foldable'),
    ]
    const output = reorderDescriptionSections(input)
    const specs = output.find(item => item.id === 'SPECIFICATIONS')
    const pack = output.find(item => item.id === 'PACKAGE')
    expect(specs?.content).toBe('- Color: Orange')
    expect(pack?.content).toContain('- Package Weight (lb): 68.02')
    expect(pack?.title).toBe('Package Contents')
  })

  it('组装尺寸与包装尺寸同数值时只在包装内容保留一份；不同数值的规格行保留', () => {
    const input = [
      section('SUMMARY', 'Product Overview', 'Overview.'),
      section('PACKAGE', 'Package Contents', '- Package Length (in): 42.13\n- Package Width (in): 24.80\n- Package Height (in): 17.91\n- Package Weight (lb): 68.02'),
      section('SPECIFICATIONS', 'Detailed Specifications', '- Assembled Length (in): 42.13\n- Assembled Width (in): 24.80\n- Assembled Height (in): 17.91\n- Product Weight (lb): 61.00\n- Wheel Size: 12 in\n- Color: Orange'),
      section('FEATURES', 'Verified Features', '- Foldable'),
    ]
    const output = reorderDescriptionSections(input)
    const specs = output.find(item => item.id === 'SPECIFICATIONS')
    const pack = output.find(item => item.id === 'PACKAGE')
    expect(specs?.content).toBe('- Product Weight (lb): 61.00\n- Wheel Size: 12 in\n- Color: Orange')
    expect(pack?.content).toContain('- Package Length (in): 42.13')
    expect(output.map(item => item.id)).toEqual(['SUMMARY', 'SPECIFICATIONS', 'FEATURES', 'PACKAGE'])
  })

  it('包装行与详细规格行完全重复时包装内容不出现两份', () => {
    const input = [
      section('SUMMARY', 'Product Overview', 'Overview.'),
      section('PACKAGE', 'Package Contents', '- Package Weight (lb): 68.02'),
      section('SPECIFICATIONS', 'Detailed Specifications', '- Package Weight (lb): 68.02\n- Material: Iron'),
    ]
    const pack = reorderDescriptionSections(input).find(item => item.id === 'PACKAGE')
    expect(pack?.content).toBe('- Package Weight (lb): 68.02')
  })

  it('无包装内容区块但详细规格含包装行时自动创建包装内容', () => {
    const input = [
      section('SUMMARY', 'Product Overview', 'Overview.'),
      section('SPECIFICATIONS', 'Detailed Specifications', '- Material: Iron\n- Package Includes: 1 x Scooter'),
    ]
    const output = reorderDescriptionSections(input)
    const pack = output.find(item => item.id === 'PACKAGE')
    expect(pack?.content).toBe('- Package Includes: 1 x Scooter')
    expect(output.find(item => item.id === 'SPECIFICATIONS')?.content).toBe('- Material: Iron')
  })

  it('详细规格无包装行且包装内容不存在时不新建空包装区块', () => {
    const input = [
      section('SUMMARY', 'Product Overview', 'Overview.'),
      section('SPECIFICATIONS', 'Detailed Specifications', '- Color: Orange'),
    ]
    const output = reorderDescriptionSections(input)
    expect(output.find(item => item.id === 'PACKAGE')).toBeUndefined()
    expect(output.map(item => item.id)).toEqual(['SUMMARY', 'SPECIFICATIONS'])
  })
})

describe('reorderDescriptionText 整段文本重排', () => {
  it('按生成格式（大写标题行+空行分块）重排并保持内容不变', () => {
    const input = [
      'PRODUCT OVERVIEW\nVEVOR 3 Wheel Mobility Scooter.',
      'CUSTOMER PROBLEMS & SOLUTIONS\n1. Heavy to lift.',
      'VERIFIED FEATURES\n- Foldable frame',
      'DETAILED SPECIFICATIONS\n- Color: Orange\n- Assembled Length (in): 42.13',
      'PACKAGE CONTENTS\n- Package Length (in): 42.13',
      'RECOMMENDED USE SCENARIOS\n- Indoor use',
    ].join('\n\n')
    const output = reorderDescriptionText(input)
    expect(output).toBe([
      'PRODUCT OVERVIEW\nVEVOR 3 Wheel Mobility Scooter.',
      'DETAILED SPECIFICATIONS\n- Color: Orange',
      'VERIFIED FEATURES\n- Foldable frame',
      'PACKAGE CONTENTS\n- Package Length (in): 42.13',
      'CUSTOMER PROBLEMS & SOLUTIONS\n1. Heavy to lift.',
      'RECOMMENDED USE SCENARIOS\n- Indoor use',
    ].join('\n\n'))
  })

  it('组装尺寸数值与包装重复时从详细规格块中丢弃', () => {
    const input = [
      'DETAILED SPECIFICATIONS\n- Assembled Length (in): 42.13\n- Assembled Width (in): 24.80\n- Color: Orange',
      'PACKAGE CONTENTS\n- Package Length (in): 42.13\n- Package Width (in): 24.80',
    ].join('\n\n')
    expect(reorderDescriptionText(input)).toContain('- Color: Orange')
    expect(reorderDescriptionText(input)).not.toContain('- Assembled Length (in)')
    expect(reorderDescriptionText(input)).not.toContain('- Assembled Width (in)')
  })

  it('区块内容内部的空行（痛点多条收益）原样保留并整体重排', () => {
    const input = [
      'PACKAGE CONTENTS\n- 1 x Manual',
      'CUSTOMER PROBLEMS & SOLUTIONS\n1. Heavy to lift.\nHow it helps: foldable frame.\n\n2. Hard to store.\nHow it helps: compact size.',
      'PRODUCT OVERVIEW\nOverview text.',
    ].join('\n\n')
    const output = reorderDescriptionText(input)
    expect(output).toBe([
      'PRODUCT OVERVIEW\nOverview text.',
      'PACKAGE CONTENTS\n- 1 x Manual',
      'CUSTOMER PROBLEMS & SOLUTIONS\n1. Heavy to lift.\nHow it helps: foldable frame.\n\n2. Hard to store.\nHow it helps: compact size.',
    ].join('\n\n'))
  })

  it('含无法识别区块头的自由文本原样返回', () => {
    const input = 'MY OWN NOTES\nCustom notes kept as-is.\n\nANOTHER BLOCK\nMore text.'
    expect(reorderDescriptionText(input)).toBe(input)
  })

  it('非区块格式的纯文本原样返回', () => {
    const input = 'Just a plain paragraph without section headers.'
    expect(reorderDescriptionText(input)).toBe(input)
  })

  it('空文本原样返回且函数幂等', () => {
    expect(reorderDescriptionText('')).toBe('')
    const once = reorderDescriptionText('PACKAGE CONTENTS\n- 1 x Manual\n\nPRODUCT OVERVIEW\nOverview text.')
    expect(once).toBe('PRODUCT OVERVIEW\nOverview text.\n\nPACKAGE CONTENTS\n- 1 x Manual')
    expect(reorderDescriptionText(once)).toBe(once)
  })
})
