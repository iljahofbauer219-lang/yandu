import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SEMANTIC_FALLBACK_LABEL,
  buildSemanticDigest,
  buildSemanticExtractionMessages,
  mergeSemanticFallback,
  parseSemanticExtractionReply,
  pruneSemanticFallbackMark,
  semanticFallbackNote,
  shouldAttemptSemanticFallback,
} from '../semanticFallback'
import type { SemanticExtractionResult, SemanticFallbackMark } from '../semanticFallback'

/**
 * C 批 #6「通用语义兜底抽取」的纯函数层。
 * 硬口径：兜底值必须逐字能在页面原文摘要里找到，找不到就拒收 —— 兜底值一旦像真值就违反「不伪造成功」。
 * 兜底结果永远带「来源=语义兜底」标记，不与结构化实测字段混标。
 */
const PAGE = {
  url: 'https://www.ebay.com/itm/123456789012',
  documentTitle: 'Pallet of 6 Assumed Home Goods for Sale, new | eBay',
  headings: ['Pallet of 6 Assumed Home Goods', 'Delivery processing', 'Returns'],
  bodyText: `  Pallet of 6 Assumed Home Goods
    Condition:    New (other)
    US $129.99\n    Free  returns\n\n  Description  Close description  ` + 'Solid pine shelving unit, ships from a US warehouse in 2 business days. ' .repeat(9),
}

describe('buildSemanticDigest 语义摘要', () => {
  it('按 URL / 页面标题 / 小标题 / 正文排布，空白折叠成单空格', () => {
    const digest = buildSemanticDigest(PAGE).markdown
    expect(digest).toContain('URL: https://www.ebay.com/itm/123456789012')
    expect(digest).toContain('页面标题: Pallet of 6 Assumed Home Goods for Sale, new | eBay')
    expect(digest).toContain('- Delivery processing')
    expect(digest).toMatch(/Condition: New \(other\) US \$129\.99/)
    expect(digest).not.toMatch(/\n\s*\n/)
    expect(digest).not.toMatch(/ {2,}/)
  })

  it('超出预算时截断并如实标记，不留半个词', () => {
    const { markdown, truncated } = buildSemanticDigest(PAGE, 200)
    expect(markdown.length).toBeLessThanOrEqual(200)
    expect(truncated).toBe(true)
    expect(markdown.endsWith(' ')).toBe(false)
  })
})

describe('shouldAttemptSemanticFallback 触发条件', () => {
  it('字段读全时不兜底（结构化实测优先）', () => {
    expect(shouldAttemptSemanticFallback({ page: PAGE, missingFields: [] })).toBe(false)
  })

  it('页面基本空白时不兜底：没有原文可依据，兜底只会造出真值样子的东西', () => {
    expect(shouldAttemptSemanticFallback({
      page: { ...PAGE, headings: [], bodyText: 'Loading…' },
      missingFields: ['title', 'descriptionText'],
    })).toBe(false)
  })

  it('有正文且确有字段缺失才兜底', () => {
    expect(shouldAttemptSemanticFallback({ page: PAGE, missingFields: ['title'] })).toBe(true)
  })
})

describe('buildSemanticExtractionMessages 只索取缺失字段', () => {
  it('system 要求逐字摘录、找不到返回 null、只出 JSON', () => {
    const { messages } = buildSemanticExtractionMessages(buildSemanticDigest(PAGE).markdown, ['title', 'price'])
    const system = messages[0].content
    expect(system).toContain('逐字')
    expect(system).toContain('null')
    expect(system).toContain('JSON')
    expect(messages[1].content).toContain('["title","price"]')
    expect(messages[1].content).not.toContain('condition')
  })
})

describe('parseSemanticExtractionReply 可追溯性闸门', () => {
  const digest = buildSemanticDigest(PAGE).markdown

  it('逐字来自摘要的标题被收下并标为兜底', () => {
    const result = parseSemanticExtractionReply(JSON.stringify({ title: 'Pallet of 6 Assumed Home Goods' }), digest, ['title'])
    expect(result.fields.title).toBe('Pallet of 6 Assumed Home Goods')
    expect(result.applied).toBe(true)
    expect(result.rejected).toEqual([])
  })

  it('模型改写过一个字就拒收（防伪造），并说明理由', () => {
    const result = parseSemanticExtractionReply(JSON.stringify({ title: 'Pallet of 6 Assumed Homegood Items' }), digest, ['title'])
    expect(result.fields.title).toBeUndefined()
    expect(result.applied).toBe(false)
    expect(result.rejected[0]?.field).toBe('title')
    expect(result.rejected[0]?.reason).toContain('逐字')
  })

  it('价格必须既在摘要里、又成货币样子；纯数字或凭空币种一律拒收', () => {
    const good = parseSemanticExtractionReply(JSON.stringify({ price: 'US $129.99' }), digest, ['price'])
    expect(good.fields.price).toBe('US $129.99')
    for (const price of ['129.99', 'US $999.00', '129.99 USD']) {
      const bad = parseSemanticExtractionReply(JSON.stringify({ price }), digest, ['price'])
      expect(bad.fields.price, price).toBeUndefined()
    }
  })

  it('没被索取的字段即使返回也丢弃；非 JSON 回复整批拒收', () => {
    expect(parseSemanticExtractionReply(JSON.stringify({ condition: 'New (other)' }), digest, ['title']).fields.condition).toBeUndefined()
    const noisy = parseSemanticExtractionReply('抱歉，我无法判断。', digest, ['title'])
    expect(noisy.applied).toBe(false)
    expect(noisy.rejected[0]?.reason).toContain('JSON')
  })

  it('空回复与全 null 都不算兜底成功', () => {
    for (const raw of ['', '{"title":null}', '{}']) {
      expect(parseSemanticExtractionReply(raw, digest, ['title']).applied, raw).toBe(false)
    }
  })
})

describe('兜底标记文案', () => {
  it('标签恒为「语义兜底」，文案点名字段、说明非实测并要求人工核对', () => {
    expect(SEMANTIC_FALLBACK_LABEL).toBe('语义兜底')
    const note = semanticFallbackNote(['title', 'price'])
    expect(note).toContain('语义兜底')
    expect(note).toContain('标题')
    expect(note).toContain('价格')
    expect(note).toMatch(/请人工核对|需人工核对/)
    expect(note).not.toMatch(/net::|ERR_/)
  })

  it('兜底字段清单为空时不给文案（不得凭空宣布兜底过）', () => {
    expect(semanticFallbackNote([])).toBe('')
  })
})

describe('mergeSemanticFallback 只补空缺，绝不覆盖实测', () => {
  const digest = buildSemanticDigest(PAGE).markdown
  const ok: SemanticExtractionResult = {
    applied: true,
    fields: { title: 'Pallet of 6 Assumed Home Goods', price: 'US $129.99', descriptionText: 'Solid pine shelving unit' },
    rejected: [{ field: 'condition', reason: '模型未给出该字段' }],
  }

  it('实测已读到的字段一字不改，只有空字段接受兜底值', () => {
    const merged = mergeSemanticFallback({ title: 'MEASURED TITLE', price: '', descriptionText: '   ', condition: '' }, ok, '2026-11-09T04:00:00.000Z')
    expect(merged.target.title).toBe('MEASURED TITLE')
    expect(merged.target.price).toBe('US $129.99')
    expect(merged.target.descriptionText).toBe('Solid pine shelving unit')
    expect(merged.mark?.fields).toEqual(['price', 'descriptionText'])
  })

  it('标记带来源标签、时间与拒收原因，供界面与快照逐字段区分兜底/实测', () => {
    const merged = mergeSemanticFallback({ title: '', price: '', descriptionText: '', condition: '' }, ok, '2026-11-09T04:00:00.000Z')
    expect(merged.mark?.label).toBe(SEMANTIC_FALLBACK_LABEL)
    expect(merged.mark?.at).toBe('2026-11-09T04:00:00.000Z')
    expect(merged.mark?.note).toContain(SEMANTIC_FALLBACK_LABEL)
    expect(merged.mark?.rejected).toEqual([{ field: 'condition', reason: '模型未给出该字段' }])
  })

  it('兜底一条都没收下时不写字段、也不挂标记（不得留下空壳标记冒充兜底）', () => {
    const failed: SemanticExtractionResult = { applied: false, fields: {}, rejected: [{ field: 'title', reason: '逐字找不到' }] }
    const merged = mergeSemanticFallback({ title: '', price: '' }, failed, '2026-11-09T04:00:00.000Z')
    expect(merged.target).toEqual({ title: '', price: '' })
    expect(merged.mark).toBeUndefined()
  })

  it('逐字闸门在真摘要上跑通：改写值既进不了 target，也不出现在标记字段清单里', () => {
    const rewritten = parseSemanticExtractionReply(JSON.stringify({ title: 'Pallet of 6 Assumed Homegood Items' }), digest, ['title'])
    const merged = mergeSemanticFallback({ title: '' }, rewritten, '2026-11-09T04:00:00.000Z')
    expect(merged.target.title).toBe('')
    expect(merged.mark).toBeUndefined()
  })
})

describe('pruneSemanticFallbackMark 标记必须与落库值同源', () => {
  const GIVEN = { title: 'Pallet of 6 Assumed Home Goods', price: 'US $129.99', descriptionText: 'Solid pine shelving unit' }
  const MARK: SemanticFallbackMark = {
    label: SEMANTIC_FALLBACK_LABEL,
    fields: ['title', 'price', 'descriptionText'],
    at: '2026-11-09T04:00:00.000Z',
    note: semanticFallbackNote(['title', 'price', 'descriptionText']),
    rejected: [{ field: 'condition', reason: '模型未给出该字段' }],
  }

  it('某个值被换成别的来源后只摘掉那个字段，其余保留且时间不变', () => {
    const pruned = pruneSemanticFallbackMark(MARK, { ...GIVEN, title: 'MEASURED TITLE' }, GIVEN)
    expect(pruned?.fields).toEqual(['price', 'descriptionText'])
    expect(pruned?.at).toBe(MARK.at)
    expect(pruned?.note).toBe(semanticFallbackNote(['price', 'descriptionText']))
  })

  it('全部值都不再出自兜底时不返回空壳标记冒充兜底过', () => {
    expect(pruneSemanticFallbackMark(MARK, { title: 'A', price: 'B', descriptionText: 'C' }, GIVEN)).toBeUndefined()
  })

  it('没有标记时恒为 undefined，实测齐全不得凭空挂兜底标签', () => {
    expect(pruneSemanticFallbackMark(undefined, GIVEN, GIVEN)).toBeUndefined()
  })

  it('字段被清空不算同源，不能继续宣称由兜底填入', () => {
    expect(pruneSemanticFallbackMark(MARK, { ...GIVEN, price: '' }, GIVEN)?.fields).toEqual(['title', 'descriptionText'])
  })
})

describe('BrowserWorkspace / main / 界面接线', () => {
  const workspace = readFileSync(new URL('../../main/browser/BrowserWorkspace.ts', import.meta.url), 'utf8')
  const main = readFileSync(new URL('../../main/main.ts', import.meta.url), 'utf8')
  const app = readFileSync(new URL('../../renderer/App.tsx', import.meta.url), 'utf8')
  const contracts = readFileSync(new URL('../contracts.ts', import.meta.url), 'utf8')

  it('站点1 注入脚本回传摘要原料（页面正文与各级小标题）', () => {
    expect(workspace).toContain('pageHeadings')
    expect(workspace).toContain('pageText')
  })

  it('读取链路用 shared 闸门与合并器，提示词与拼装不在主进程里重写', () => {
    expect(workspace).toContain('shouldAttemptSemanticFallback(')
    expect(workspace).toContain('mergeSemanticFallback(')
    expect(workspace).toContain('buildSemanticDigest(')
    expect(workspace).not.toContain('你是跨境电商商品页字段摘录助手')
  })

  it('大模型调用挂在既有 DeepSeek 服务上，主进程只注入 runner 不自己发请求', () => {
    expect(workspace).toContain('setSemanticFallbackRunner(')
    expect(workspace).not.toContain('chat/completions')
    expect(main).toContain('setSemanticFallbackRunner((digest, fields) => ebayOptimizationService.extractSemanticFallback(digest, fields))')
    const service = readFileSync(new URL('../../main/services/EbayOptimizationService.ts', import.meta.url), 'utf8')
    expect(service).toContain('async extractSemanticFallback(')
    expect(service).toContain('未配置 DeepSeek API Key，语义兜底不可用')
  })

  it('兜底来源在编辑器上方常驻标出并带读取时间（一次性提示条不足以与实测值区分）', () => {
    const anchor = 'localEditorProduct.snapshot.details.semanticFallback'
    expect(app).toContain(anchor)
    const band = app.slice(app.indexOf(anchor), app.indexOf('<EbayLocalListingEditor', app.indexOf(anchor)))
    expect(band).toContain('ebay-config-notice')
    expect(band).toContain('note')
    expect(band).toMatch(/new Date\([^\n]+\.at\)/)
  })

  it('标记进契约，标题来源与下载提示都区分兜底', () => {
    expect(contracts).toMatch(/semanticFallback\?:/)
    expect(contracts).toMatch(/'SEMANTIC_FALLBACK'/)
    expect(main).toContain("titleSource:titleFallback?'SEMANTIC_FALLBACK':'EBAY_STRUCTURED_DATA'")
    expect(main).toContain('originalTitleVerified:!titleFallback')
    expect(app).toContain('details.semanticFallback?.note')
    // 文案只在 shared 生成一份，界面不另写一套「兜底」措辞
    expect(app).not.toContain('语义兜底')
  })

  it('重新同步落库时标记取自本次读取并按落库值裁剪，不沿用基线的旧标记', () => {
    expect(main).toMatch(/pruneSemanticFallbackMark\(\s*liveDetails\.semanticFallback\s*,\s*mergedDetails\s*,\s*liveDetails\s*\)/)
  })

  it('编辑器保存与货盘详情刷新同样按落库值裁剪标记', () => {
    expect(main).toMatch(/pruneSemanticFallbackMark\(\s*product\.snapshot\.details\.semanticFallback\s*,\s*details\s*,\s*product\.snapshot\.details\s*\)/)
    expect(main).toMatch(/pruneSemanticFallbackMark\(\s*local\.snapshot\.details\.semanticFallback\s*,\s*mergedDetails\s*,\s*local\.snapshot\.details\s*\)/)
  })
})
