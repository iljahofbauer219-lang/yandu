import { describe, expect, it } from 'vitest'
import { backCoreTermVariants, parseCoreTermVariants } from '../ebayMarketVariants'

describe('parseCoreTermVariants', () => {
  it('JSON 数组直接通过', () => {
    expect(parseCoreTermVariants(JSON.stringify(['Bucket Racing Seats', 'Racing Bucket Seat Pair']))).toEqual(['Bucket Racing Seats', 'Racing Bucket Seat Pair'])
  })
  it('代码围栏包裹的 JSON 也可解析', () => {
    expect(parseCoreTermVariants('```json\n["bucket racing seats"]\n```')).toEqual(['bucket racing seats'])
  })
  it('逐行回复取各行', () => {
    expect(parseCoreTermVariants('1. bucket racing seats\n2. racing bucket seat pair')).toEqual(['bucket racing seats', 'racing bucket seat pair'])
  })
  it('中文与单词条目被剔除', () => {
    expect(parseCoreTermVariants(JSON.stringify(['赛车座椅', 'seats', 'Bucket Racing Seats']))).toEqual(['Bucket Racing Seats'])
  })
  it('重复词元组合去重', () => {
    expect(parseCoreTermVariants(JSON.stringify(['Bucket Racing Seats', 'bucket racing seats']))).toEqual(['Bucket Racing Seats'])
  })
  it('坏回复返回空数组', () => {
    expect(parseCoreTermVariants('')).toEqual([])
  })
})

describe('backCoreTermVariants', () => {
  const titles = [
    'black bucket racing seats pair adjustable',
    'bucket racing seats set recline suede',
    'carbon bucket racing seat pair',
    'universal racing seat bracket',
    'bucket racing seats pvc leather red'
  ]
  it('不含核心词元的变体被剔除', () => {
    const result = backCoreTermVariants(['black pair', 'bucket racing seats'], 'Bucket Racing Seats', titles)
    expect(result.map(item => item.term)).toEqual(['bucket racing seats'])
  })
  it('回数与覆盖率统计正确', () => {
    const result = backCoreTermVariants(['bucket racing seats pair', 'bucket racing seats'], 'Bucket Racing Seats', titles)
    const pair = result.find(item => item.term === 'bucket racing seats pair')
    const core = result.find(item => item.term === 'bucket racing seats')
    expect(pair?.count).toBe(2)
    expect(pair?.coverage).toBe(40)
    expect(core?.count).toBe(4)
    expect(core?.coverage).toBe(80)
  })
  it('佐证门槛过滤低回数低覆盖变体', () => {
    const many = [...Array(30).keys()].map(index => `bucket racing seats lot ${index}`)
    const result = backCoreTermVariants(['bucket racing seats suede'], 'Bucket Racing Seats', [...many, 'bucket racing seats suede recline'])
    expect(result).toEqual([])
  })
  it('覆盖率达门槛时低回数也保留', () => {
    const result = backCoreTermVariants(['bucket racing seats suede'], 'Bucket Racing Seats', titles)
    expect(result[0]?.count).toBe(1)
    expect(result[0]?.coverage).toBe(20)
  })
  it('按回数降序排列', () => {
    const result = backCoreTermVariants(['bucket racing seats pair', 'bucket racing seats'], 'Bucket Racing Seats', titles)
    expect(result[0].term).toBe('bucket racing seats')
  })
  it('单复数归一后仍可佐证', () => {
    const result = backCoreTermVariants(['bucket racing seat pair'], 'Bucket Racing Seats', titles)
    expect(result[0]?.count).toBe(2)
  })
  it('同词元纯词序置换折叠为一条', () => {
    const result = backCoreTermVariants(['bucket racing seats', 'racing bucket seats', 'seats racing bucket'], 'Bucket Racing Seats', titles)
    expect(result).toHaveLength(1)
    expect(result[0].term).toBe('bucket racing seats')
  })
})
