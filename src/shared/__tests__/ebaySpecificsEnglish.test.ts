import { describe, expect, it } from 'vitest'
import { containsCjk, englishSpecificLabel, normalizeEnglishDescription } from '../ebaySpecificsEnglish'

describe('englishSpecificLabel 中文规格键英译', () => {
  it('已知中文键映射为英文标签', () => {
    expect(englishSpecificLabel('产品类型')).toBe('Product Type')
    expect(englishSpecificLabel('组装长度 (英寸)')).toBe('Assembled Length (in)')
    expect(englishSpecificLabel('产品重量 (磅)')).toBe('Product Weight (lb)')
    expect(englishSpecificLabel(' 颜色 ')).toBe('Color')
  })

  it('无中文的键原样返回', () => {
    expect(englishSpecificLabel('Item Code')).toBe('Item Code')
    expect(englishSpecificLabel('GIGA Index')).toBe('GIGA Index')
  })

  it('映射表外的中文键返回空串，供调用方丢弃', () => {
    expect(englishSpecificLabel('产地')).toBe('')
    expect(englishSpecificLabel('物流费')).toBe('')
    expect(englishSpecificLabel('')).toBe('')
  })
})

describe('containsCjk', () => {
  it('识别中英文混排', () => {
    expect(containsCjk('Color: Black')).toBe(false)
    expect(containsCjk('颜色: Black')).toBe(true)
    expect(containsCjk('$43.05 /件')).toBe(true)
  })
})

describe('normalizeEnglishDescription 逐行规范化', () => {
  it('已知中文键英译并保留项目符号与数值', () => {
    const input = 'DETAILED SPECIFICATIONS\n- 产品类型: Combo Item\n- 组装长度 (英寸): 18.10\n- 产品重量 (磅): 61.00'
    expect(normalizeEnglishDescription(input)).toBe('DETAILED SPECIFICATIONS\n- Product Type: Combo Item\n- Assembled Length (in): 18.10\n- Product Weight (lb): 61.00')
  })

  it('映射表外的中文键整行丢弃', () => {
    const input = '- 产地: China\n- Color: Black'
    expect(normalizeEnglishDescription(input)).toBe('- Color: Black')
  })

  it('值含中文的行整行丢弃', () => {
    const input = '- 颜色: 黑色\n- Material: PVC'
    expect(normalizeEnglishDescription(input)).toBe('- Material: PVC')
  })

  it('无冒号的中文行丢弃、英文行原样保留（不清空用户手改）', () => {
    const input = 'Full adjustable backward between 90-180 degrees.\n这是一行中文说明\nHow it helps: dual lock sliders allow easy adjustment.'
    expect(normalizeEnglishDescription(input)).toBe('Full adjustable backward between 90-180 degrees.\nHow it helps: dual lock sliders allow easy adjustment.')
  })

  it('全英文文本原样返回', () => {
    const input = 'PRODUCT OVERVIEW\n2PC Universal Bucket Racing Seats.\n\nVERIFIED FEATURES\n- High Quality'
    expect(normalizeEnglishDescription(input)).toBe(input)
  })
})
