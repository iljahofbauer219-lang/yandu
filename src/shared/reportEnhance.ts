// 选品报告渲染增强共享契约：证据等级 / 术语表 / 链接规则
// 与 docs/选品分析师-报告模板-v1.2.md 附录保持同步（改一处必须同步另一处）

/** 证据等级（选品分析师提示词规则6：F事实 / E外部估算 / A分析假设 / U未知） */
export const EVIDENCE_LEVELS: Record<string, string> = {
  F: 'F = 事实（实测 / 平台抓取 / 用户提供的真实报价）',
  E: 'E = 外部估算（Jungle Scout / Helium 10 等第三方工具、行业均值）',
  A: 'A = 分析假设（已明示口径的假设）',
  U: 'U = 未知（待验证、数据缺失）'
}

export const ASIN_RE = /^B[0-9A-Z]{9}$/
const ASIN_TOKEN_RE = /B[0-9A-Z]{9}/

/** 单元格文本是否允许自动补链（排除占位/未知值，避免假链接） */
const NON_LINKABLE = ['—', '–', '-', '—', '待验证', '未知', '待专业核验', '无']

export function isLinkableText(text: string): boolean {
  const t = text.trim()
  return t.length > 0 && !NON_LINKABLE.includes(t)
}

export function amazonAsinUrl(asin: string): string {
  return `https://www.amazon.com/dp/${asin}`
}

export function amazonBrandUrl(brand: string): string {
  return `https://www.amazon.com/s?k=${encodeURIComponent(brand)}`
}

export function extractAsin(text: string): string | null {
  const m = text.trim().match(ASIN_TOKEN_RE)
  return m && ASIN_RE.test(m[0]) ? m[0] : null
}

/** 表头列角色：决定该列单元格的增强方式 */
export type ReportColumnRole = 'brand' | 'asin' | 'evidence' | null

/** 品牌/竞店列判定：仅限「含链接字样」或「纯品牌/店铺名」表头，避免「店铺定位」「品牌与内容能力」等描述列被误加链 */
export function isBrandColumnHeader(header: string): boolean {
  const h = header.trim()
  if (/链接/.test(h) && /品牌|店铺|竞店/.test(h)) return true
  return /^(品牌|店铺|品牌名|店铺名|竞店|品牌\/店铺)$/.test(h)
}

export function columnRole(header: string): ReportColumnRole {
  const h = header.trim()
  if (/ASIN|Listing/i.test(h)) return 'asin'
  if (isBrandColumnHeader(h)) return 'brand'
  if (/证据/.test(h)) return 'evidence'
  return null
}

/** 术语表（与模板 v1.2 附录一致；长 token 优先匹配避免截断） */
const GLOSSARY_ENTRIES: ReadonlyArray<readonly [string, string]> = [
  ['TOP50', '类目销量前50样本'],
  ['USITC', '美国国际贸易委员会'],
  ['USPTO', '美国专利商标局'],
  ['ACOS', '广告销售成本比（广告花费÷广告销售额）'],
  ['ASIN', '亚马逊标准商品编号'],
  ['BSR', '畅销排名（Best Sellers Rank，类目销量排名）'],
  ['CPC', '单次点击成本（广告平均每次点击花费）'],
  ['CR10', '前十名集中度（头部10款市占合计）'],
  ['EPA', '美国环保署'],
  ['FBA', '亚马逊物流（Fulfillment by Amazon）'],
  ['FDA', '美国食品药品监督管理局'],
  ['HTS', '美国协调关税表编码'],
  ['OEM', '原始设备制造商（代工）'],
  ['SKU', '库存量单位（Stock Keeping Unit）'],
  ['SD', '展示型广告（Sponsored Display）'],
  ['A+', '亚马逊A+品牌增强内容']
]

export const GLOSSARY: ReadonlyArray<readonly [string, string]> = [...GLOSSARY_ENTRIES].sort((a, b) => b[0].length - a[0].length)

function isWordChar(ch: string | undefined): boolean {
  return !!ch && /[A-Za-z0-9]/.test(ch)
}

/** 在纯文本中查找首个可注解术语，返回位置与 token；无则 null */
export function findGlossaryToken(text: string): { index: number; token: string } | null {
  let best: { index: number; token: string } | null = null
  for (const [token] of GLOSSARY) {
    let from = 0
    while (from <= text.length - token.length) {
      const at = text.indexOf(token, from)
      if (at < 0) break
      const prev = text[at - 1]
      const next = text[at + token.length]
      const prevOk = !isWordChar(prev)
      const nextOk = token.endsWith('+') ? next !== '+' && !isWordChar(next) : !isWordChar(next)
      if (prevOk && nextOk) {
        if (!best || at < best.index) best = { index: at, token }
        break
      }
      from = at + 1
    }
  }
  return best
}

/** 提取文本中独立成词的证据等级字母（F/E/A/U，含 A/U 这类斜杠组合） */
export function findEvidenceLetter(text: string): { index: number; letter: string } | null {
  const m = /(?<![A-Za-z])([FEAU])(?![A-Za-z])/.exec(text)
  return m ? { index: m.index, letter: m[1] } : null
}

// ─── v1.4：附录不再展示（省版面）+ 证据等级中文化 ─────────────
export const APPENDIX_HEADING = '附录：术语与证据等级速览'
/** 证据等级字母 → 中文（旧报告回溯转换用） */
export const EVIDENCE_CN: Record<string, string> = { F: '事实', E: '外部估算', A: '分析假设', U: '未知' }

/** 旧报告可能带附录；v1.4 起附录不再展示，渲染时将从附录标题起的内容剩除 */
export function stripAppendix(content: string): string {
  const at = content.indexOf(APPENDIX_HEADING)
  if (at < 0) return content
  return `${content.slice(0, at).trimEnd()}\n`
}

/** 将文本中独立成词的证据等级字母替换为中文（A/U → 分析假设/未知），其余内容原样 */
export function convertEvidenceToChinese(text: string): string {
  return text.replace(/(?<![A-Za-z])([FEAU])(?![A-Za-z])/g, letter => EVIDENCE_CN[letter])
}

// ─── H 阶段：报告样例库对齐兜底（ensureSampleLibraryAlignment）────────────
// 作用：模型偏离 4 决策枚举 / 6 部分 / 决策可追溯硬约束时，由本函数在渲染后补齐
// 原则：能检测到才补，不能检测到的部分（门禁数字）不改；不破坏原报告已有内容
// 与 src/shared/sampleLibraryPrompt.ts 的 PROMPT_RULE_18 强一致

/** 4 决策枚举（与 sampleLibrary.ts 一致） */
export const SAMPLE_LIBRARY_DECISIONS = [
  '✅ 建议入场',
  '⚠️ 有条件谨慎入场',
  '❌ 不建议入场',
  '❓ 数据不足，不能判定'
] as const

export type SampleLibraryDecision = typeof SAMPLE_LIBRARY_DECISIONS[number]

/** 6 部分表头（必须出现） */
export const SAMPLE_LIBRARY_SIX_PARTS = [
  '第一部分',
  '第二部分',
  '第三部分',
  '第四部分',
  '第五部分',
  '第六部分'
] as const

/** 检测报告是否包含 4 决策枚举之一。优先用决策可追溯的「报告最终结论」作为权威，避免 5.3 表中列出 4 种决策时误判。 */
export function detectSampleLibraryDecision(content: string): SampleLibraryDecision | null {
  // 1. 优先用决策可追溯作为权威
  const trace = detectDecisionTraceability(content)
  if (trace.ok && trace.reportDecision && (SAMPLE_LIBRARY_DECISIONS as readonly string[]).includes(trace.reportDecision)) {
    return trace.reportDecision as SampleLibraryDecision
  }
  // 2. 兜底：找第一个匹配的
  for (const decision of SAMPLE_LIBRARY_DECISIONS) {
    if (content.includes(decision)) return decision
  }
  return null
}

/** 检测报告 6 部分齐全（全部 6 个表头都存在） */
export function detectSixParts(content: string): { present: readonly string[]; missing: readonly string[] } {
  const present: string[] = []
  const missing: string[] = []
  for (const part of SAMPLE_LIBRARY_SIX_PARTS) {
    if (content.includes(`## ${part}`) || content.includes(`# ${part}`)) {
      present.push(part)
    } else {
      missing.push(part)
    }
  }
  return { present, missing }
}

/** 检测决策可追溯声明（系统入场结论 = X，报告最终结论 = X）。按 4 决策枚举精确拆分，避免「❓ 数据不足，不能判定」中间的「，」被旧 regex 误截断。 */
export function detectDecisionTraceability(content: string): { ok: boolean; systemDecision: string | null; reportDecision: string | null; line: string | null } {
  // 1. 定位「系统入场结论 = 」起点
  const sysIdx = content.indexOf('系统入场结论')
  if (sysIdx < 0) return { ok: false, systemDecision: null, reportDecision: null, line: null }
  // 跳过「系统入场结论」后续空白 + 等号 + 空白
  const sysTail = content.slice(sysIdx + '系统入场结论'.length)
  const eq = sysTail.match(/^\s*=\s*/)
  if (!eq) return { ok: false, systemDecision: null, reportDecision: null, line: null }
  const afterEq = sysTail.slice(eq[0].length)
  // 2. 在 4 决策枚举中找 systemDecision（从起点起精确匹配）
  let systemDecision: string | null = null
  for (const d of SAMPLE_LIBRARY_DECISIONS) {
    if (afterEq.startsWith(d)) { systemDecision = d; break }
  }
  if (!systemDecision) return { ok: false, systemDecision: null, reportDecision: null, line: null }
  // 3. 在 systemDecision 之后定位「报告最终结论 = 」起点
  const sysEnd = sysIdx + '系统入场结论'.length + eq[0].length + systemDecision.length
  const tail = content.slice(sysEnd)
  const reportEq = tail.match(/^\s*[，,]\s*报告最终结论\s*=\s*/)
  if (!reportEq) return { ok: false, systemDecision, reportDecision: null, line: null }
  const afterReportEq = tail.slice(reportEq[0].length)
  // 4. 在 4 决策枚举中找 reportDecision（从起点起精确匹配）
  let reportDecision: string | null = null
  for (const d of SAMPLE_LIBRARY_DECISIONS) {
    if (afterReportEq.startsWith(d)) { reportDecision = d; break }
  }
  if (!reportDecision) return { ok: false, systemDecision, reportDecision, line: null }
  const ok = systemDecision === reportDecision
  return { ok, systemDecision, reportDecision, line: `系统入场结论 = ${systemDecision}，报告最终结论 = ${reportDecision}` }
}

export interface SampleLibraryAlignmentReport {
  /** 原内容 */
  content: string
  /** 补齐后的内容 */
  aligned: string
  /** 4 决策枚举检测结果 */
  decision: SampleLibraryDecision | null
  /** 6 部分检测结果 */
  sixParts: { present: readonly string[]; missing: readonly string[] }
  /** 决策可追溯检测结果 */
  traceability: { ok: boolean; systemDecision: string | null; reportDecision: string | null; line: string | null }
  /** 补齐动作清单 */
  patched: string[]
}

/**
 * 报告样例库对齐兜底：检测 + 补齐 + 返回诊断报告。
 * 补齐原则：
 *   1. 6 部分表头缺失时不补（会破坏章节顺序，依赖模型遵守）
 *   2. 4 决策枚举缺失时不补（无法判断报告应属于哪种决策）
 *   3. 决策可追溯缺失时，自动在报告末尾追加一条「决策可追溯」声明
 *   4. 决策可追溯存在但「系统 != 报告」时，在末尾追加修正声明
 */
export function ensureSampleLibraryAlignment(content: string): SampleLibraryAlignmentReport {
  const decision = detectSampleLibraryDecision(content)
  const sixParts = detectSixParts(content)
  const traceability = detectDecisionTraceability(content)
  const patched: string[] = []
  let aligned = content

  // 1. 6 部分缺失 → 不补（破坏结构）
  if (sixParts.missing.length > 0) {
    patched.push(`缺失部分：${sixParts.missing.join('、')}（需模型补齐）`)
  }

  // 2. 决策枚举缺失 → 不补（不知道应判为哪种）
  if (!decision) {
    patched.push('决策枚举缺失：未检测到 4 决策枚举之一（需模型补齐）')
  }

  // 区分「修正」和「补齐」：
  // - 修正：traceability.systemDecision 和 reportDecision 都在枚举中但不同
  // - 补齐：traceability 未完全匹配（其中一个为 null）→ 按文中决策补齐
  const sysInEnum = !!traceability.systemDecision && (SAMPLE_LIBRARY_DECISIONS as readonly string[]).includes(traceability.systemDecision)
  const repInEnum = !!traceability.reportDecision && (SAMPLE_LIBRARY_DECISIONS as readonly string[]).includes(traceability.reportDecision)
  const hasMismatch = sysInEnum && repInEnum && traceability.systemDecision !== traceability.reportDecision

  if (hasMismatch && decision) {
    const line = `系统入场结论 = ${decision}，报告最终结论 = ${decision}`
    // 移除原「决策可追溯：」声明行，避免补丁后 detect 仍匹到原声明
    aligned = aligned.replace(/^- 决策可追溯：[\s\S]*?[，,]\s*报告最终结论\s*=\s*[\s\S]+?(?=[，,。.;；\n]|$)[\s\S]*?\n/gm, '').trimEnd()
    aligned = `${aligned}\n\n- 决策可追溯修正：原报告系统=${traceability.systemDecision}、报告=${traceability.reportDecision}，已按 4 决策枚举对齐为 ${line}\n`
    patched.push(`修正决策可追溯：${line}`)
  } else if (!traceability.ok && decision) {
    const line = `系统入场结论 = ${decision}，报告最终结论 = ${decision}`
    aligned = `${aligned.trimEnd()}\n\n- 决策可追溯：${line}\n`
    patched.push(`补齐决策可追溯：${line}`)
  } else if (!traceability.ok && !decision) {
    patched.push('决策可追溯缺失：模型未输出决策枚举与决策可追溯声明（需模型补齐）')
  } else if (traceability.ok && traceability.systemDecision !== traceability.reportDecision) {
    // 兑底：理论上不会到这里（ok 要求 system=report），为了完整性保留
    if (decision) {
      const line = `系统入场结论 = ${decision}，报告最终结论 = ${decision}`
      aligned = aligned.replace(/^- 决策可追溯：[\s\S]*?[，,]\s*报告最终结论\s*=\s*[\s\S]+?(?=[，,。.;；\n]|$)[\s\S]*?\n/gm, '').trimEnd()
      aligned = `${aligned}\n\n- 决策可追溯修正：原报告系统=${traceability.systemDecision}、报告=${traceability.reportDecision}，已按 4 决策枚举对齐为 ${line}\n`
      patched.push(`修正决策可追溯：${line}`)
    } else {
      patched.push(`决策可追溯不一致：系统=${traceability.systemDecision} / 报告=${traceability.reportDecision}，但未检测到 4 决策枚举，无法自动修正`)
    }
  }

  return { content, aligned, decision, sixParts, traceability, patched }
}
