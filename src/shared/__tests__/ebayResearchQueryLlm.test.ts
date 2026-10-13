import { describe, expect, it } from 'vitest'
import { parseResearchQueryReply } from '../ebayResearchQueryLlm'

describe('parseResearchQueryReply', () => {
  it('纯文本名词短语直接通过', () => {
    expect(parseResearchQueryReply('Bucket Racing Seats')).toBe('Bucket Racing Seats')
  })
  it('JSON 对象取 query 字段', () => {
    expect(parseResearchQueryReply(JSON.stringify({ query: 'Bucket Racing Seats' }))).toBe('Bucket Racing Seats')
  })
  it('代码围栏包裹的 JSON 也可解析', () => {
    expect(parseResearchQueryReply('```json\n{"query":"Racing Seat Pair"}\n```')).toBe('Racing Seat Pair')
  })
  it('多行回复取首个非空行', () => {
    expect(parseResearchQueryReply('Bucket Racing Seats\n说明：已去掉数量词')).toBe('Bucket Racing Seats')
  })
  it('中文回复回落 null', () => {
    expect(parseResearchQueryReply('赛车座椅')).toBeNull()
  })
  it('空回复回落 null', () => {
    expect(parseResearchQueryReply('   ')).toBeNull()
  })
  it('超长回复回落 null', () => {
    expect(parseResearchQueryReply('a '.repeat(40) + 'seat')).toBeNull()
  })
  it('含标点符号的坏回复回落 null', () => {
    expect(parseResearchQueryReply('Bucket Racing Seats!')).toBeNull()
  })
  it('单词数超过 6 回落 null', () => {
    expect(parseResearchQueryReply('one two three four five six seven')).toBeNull()
  })
})
