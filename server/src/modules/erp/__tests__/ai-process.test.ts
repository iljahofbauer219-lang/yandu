/**
 * ai-process 纯函数单测（P3 / M3）：
 *   - enforceTitleLimit：不超限保留 / 超限截断且 charCount≤limit / 去尾分隔符 / 空白折叠
 *   - buildImagePrompt：eBay 主图无文字规则生效、Amazon 纯白底、始终追加产品本体一致性约束
 *   - resolveReferenceLimit：P1-17 保留 maxReferenceImages=0 哨兵语义（纯文生图直接 400，不再 Math.max(1,…) 抹平）
 *   - resolveStatusAfterAiImages：P1-18 仅 DOWNLOADED→PROCESSING，其余状态原样（不再硬编码 PROCESSING）
 *   - isPersistableGeneratedCandidate：P1-16 仅本地落盘成功的生成图候选可持久化（禁外链红线）
 *   - TITLE_STYLES：三风格齐全
 *   - DEFAULT_PLATFORM_RULES：eBay 80 字符 + mainImageNoText，Amazon 200，Ozon 200
 * 触库/AI 编排路径（generateProductImages/Titles、select、choose、recompute）由 verify-erp-p3.ts e2e 覆盖。
 */
import { describe, expect, it } from 'vitest'
import {
  enforceTitleLimit,
  buildImagePrompt,
  resolveReferenceLimit,
  resolveStatusAfterAiImages,
  isPersistableGeneratedCandidate,
  TITLE_STYLES,
  DEFAULT_PLATFORM_RULES,
  DEFAULT_AI_IMAGE_MODEL
} from '../ai-process.js'
import { findImageModel } from '../../ai/catalog.js'

describe('enforceTitleLimit', () => {
  it('未超限：原样保留，truncated=false', () => {
    const result = enforceTitleLimit('Pet Grooming Brush', 80)
    expect(result.title).toBe('Pet Grooming Brush')
    expect(result.charCount).toBe(18)
    expect(result.truncated).toBe(false)
  })

  it('超限：截断到 limit，charCount ≤ limit，truncated=true', () => {
    const long = 'A'.repeat(120)
    const result = enforceTitleLimit(long, 80)
    expect(result.charCount).toBe(80)
    expect(result.title.length).toBe(80)
    expect(result.truncated).toBe(true)
  })

  it('截断后去除尾部空白与分隔符', () => {
    // 构造第 80 字符落在逗号/空格上的情形
    const title = `${'X'.repeat(78)}, tail words here`
    const result = enforceTitleLimit(title, 80)
    expect(result.charCount).toBeLessThanOrEqual(80)
    expect(/[,\s;|]$/.test(result.title)).toBe(false)
  })

  it('折叠多余空白并 trim', () => {
    const result = enforceTitleLimit('  Pet   Grooming\t Brush  ', 80)
    expect(result.title).toBe('Pet Grooming Brush')
  })

  it('空标题返回空串且不截断', () => {
    const result = enforceTitleLimit('   ', 80)
    expect(result.title).toBe('')
    expect(result.truncated).toBe(false)
  })
})

describe('buildImagePrompt', () => {
  it('eBay 主图无文字规则生效：prompt 含 no text/watermark/logo', () => {
    const prompt = buildImagePrompt('Studio product photo', { mainImageNoText: true })
    expect(prompt).toContain('no text')
    expect(prompt).toContain('no watermark')
    expect(prompt).toContain('no logo')
  })

  it('Amazon 纯白底规则生效', () => {
    const prompt = buildImagePrompt('Studio product photo', { pureWhiteBackground: true })
    expect(prompt).toContain('pure white')
    expect(prompt).toContain('255,255,255')
  })

  it('始终追加产品本体一致性约束（保持参照图商品结构）', () => {
    const prompt = buildImagePrompt('Base', {})
    expect(prompt).toContain('Keep the exact product identity')
  })

  it('无规则时不注入无文字/白底约束', () => {
    const prompt = buildImagePrompt('Base prompt', { mainImageNoText: false })
    expect(prompt).not.toContain('no watermark')
    expect(prompt).not.toContain('pure white')
  })
})

describe('resolveReferenceLimit（P1-17：0=不支持参照原图的哨兵语义）', () => {
  it('支持参考图的模型返回其上限（qwen-image-edit-plus=3）', () => {
    const profile = findImageModel('qwen-image-edit-plus')!
    expect(resolveReferenceLimit(profile)).toBe(3)
  })

  it('maxReferenceImages=0（纯文生图）抛 ERP_MODEL_NO_REFERENCE，不被抹平成 1', () => {
    const profile = findImageModel('qwen-image-2.0')!
    expect(profile.maxReferenceImages).toBe(0)
    expect(() => resolveReferenceLimit(profile)).toThrowError(expect.objectContaining({ code: 'ERP_MODEL_NO_REFERENCE' }))
  })
})

describe('resolveStatusAfterAiImages（P1-18：返回真实状态推进结果）', () => {
  it('DOWNLOADED → PROCESSING（首次 AI 加工）', () => {
    expect(resolveStatusAfterAiImages('DOWNLOADED')).toBe('PROCESSING')
  })

  it('PROCESSING/READY/PUBLISHED 原样保留（绝不硬编码 PROCESSING、绝不回退）', () => {
    expect(resolveStatusAfterAiImages('PROCESSING')).toBe('PROCESSING')
    expect(resolveStatusAfterAiImages('READY')).toBe('READY')
    expect(resolveStatusAfterAiImages('PUBLISHED')).toBe('PUBLISHED')
  })
})

describe('isPersistableGeneratedCandidate（P1-16：禁外链红线）', () => {
  it('本地落盘成功（localPath 非空）才可持久化/进入候选集', () => {
    expect(isPersistableGeneratedCandidate('org-1/erp/p1/img1.jpg')).toBe(true)
  })

  it('下载失败（localPath 空）不落库、不可被 select——不回退远端 generatedUrl', () => {
    expect(isPersistableGeneratedCandidate('')).toBe(false)
    expect(isPersistableGeneratedCandidate('   ')).toBe(false)
  })
})

describe('常量契约', () => {
  it('TITLE_STYLES 为三风格', () => {
    expect(TITLE_STYLES.length).toBe(3)
    expect([...TITLE_STYLES]).toEqual(['卖点精炼型', '关键词覆盖型', '场景情感型'])
  })

  it('eBay 默认 80 字符上限且主图无文字', () => {
    const ebay = DEFAULT_PLATFORM_RULES.ebay!
    expect(ebay.titleCharLimit).toBe(80)
    expect(ebay.imageRules.mainImageNoText).toBe(true)
  })

  it('Amazon 默认 200 字符上限且纯白底', () => {
    const amazon = DEFAULT_PLATFORM_RULES.amazon!
    expect(amazon.titleCharLimit).toBe(200)
    expect(amazon.imageRules.pureWhiteBackground).toBe(true)
  })

  it('默认图生图模型为参照编辑模型（可保持商品结构）', () => {
    expect(DEFAULT_AI_IMAGE_MODEL).toBe('qwen-image-edit-plus')
  })
})
