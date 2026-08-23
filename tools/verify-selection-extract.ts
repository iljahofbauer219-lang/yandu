#!/usr/bin/env node
/**
 * 选品提取卡回归：信息整全展示 + 输入框仅预填分析要求 + 发送组装。
 * 环境无 node 时用 Electron 代跑：
 *   export ELECTRON_RUN_AS_NODE=1
 *   "$ELECTRON" node_modules/typescript/bin/tsc tools/verify-selection-extract.ts --outDir .tmp-ui-verify/extract-out --module commonjs --target es2020 --esModuleInterop --skipLibCheck --moduleResolution node
 *   "$ELECTRON" .tmp-ui-verify/extract-out/tools/verify-selection-extract.js
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SELECTION_ANALYSIS_REQUEST, applyAmazonFinancialPreset, applyCnyPurchasePriceUsd, assessExtractionEvidence, buildAmazonFinancialPreset, buildProductIdentityLock, buildSelectionInfoText, extractSupplyFacts, normalizeSelectionReport, sanitizeSelectionReportEvidence, selectionGenerationGate, userEditedProfitFieldMeta, validateSelectionReportEvidence, validateSelectionReportIdentity, validateSelectionReportPlatform } from '../src/shared/selectionExtract'

let failures = 0
const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures++
}

// ─── 1. 分析要求文案 ─────────────────────────────────────────────
assert('要求含亚马逊美国站', SELECTION_ANALYSIS_REQUEST.includes('亚马逊美国站'))
assert('要求含完整评估报告', SELECTION_ANALYSIS_REQUEST.includes('完整评估报告'))
assert('要求不含商品信息字段', !/URL|标题|价格/.test(SELECTION_ANALYSIS_REQUEST))

// ─── 2. 信息块组装（与红框旧文案字段对齐） ───────────────────────
const info = {
  url: 'https://detail.1688.com/offer/1013322595972.html',
  analysisDate: '2026-08-09',
  title: '狗狗宠物牙齿清洁手指湿巾',
  price: '¥6.50',
  seller: '广州宠本生物科技有限公司',
  moq: '1',
  shipFrom: '广东广州',
  deals: '200',
  attributes: ['品牌：其他', '货号：1', '是否进口：否', '是否专利货源：否', '规格：50片', '是否跨境出口专供货源：是', '材质：无纺布'],
  images: ['https://img.1688.com/a.jpg', 'https://img.1688.com/b.jpg'],
  imageEvidence: [
    { url: 'https://img.1688.com/a.jpg', role: '主图' as const, source: '页面主图Meta' },
    { url: 'https://img.1688.com/b.jpg', role: '详情图' as const, source: '商品详情区域' }
  ],
  detailText: '宠物液体免洗擦浴精华，挤出后擦浴清洁。',
  detailSource: '详情模块DOM',
  imageOcrText: 'PET WASH FREE SCRUB ESSENCE 30ml',
  visualProductForm: '液体精华',
  visualUseMethod: '挤出液体后擦浴',
  visualTargetObject: '猫狗',
  visualConfidence: 95
}
const text = buildSelectionInfoText(info)
assert('信息块含 URL 行', text.includes('- 1688商品URL：' + info.url))
assert('信息块含分析日期行', text.includes('- 分析日期：2026-08-09'))
assert('信息块含标题/价格/供应商行', text.includes('- 标题：' + info.title) && text.includes('- 价格：¥6.50') && text.includes('- 供应商/店铺：' + info.seller))
assert('信息块含起订量/发货地/成交行', text.includes('- 起订量：1') && text.includes('- 发货地：广东广州') && text.includes('- 成交：200 件'))
assert('信息块含全部属性（7 条不截断）', info.attributes.every(attr => text.includes('  * ' + attr)))
assert('信息块含图片数行', text.includes('- 图片：2 张'))
assert('信息块含图片角色和来源', text.includes('图1｜主图｜页面主图Meta｜https://img.1688.com/a.jpg') && text.includes('图2｜详情图｜商品详情区域｜https://img.1688.com/b.jpg'))
assert('信息块含详情/OCR/视觉证据', text.includes('详情页文字（页面DOM）') && text.includes('包装图片OCR文字') && text.includes('形态=液体精华'))
assert('完整证据状态进入信息块', text.includes('- 提取证据状态：证据完整'))
assert('信息块不含分析要求', !text.includes(SELECTION_ANALYSIS_REQUEST))
assert('空信息仅首行', buildSelectionInfoText({}) === '我在1688看到一款商品，商品信息如下：')

// ─── 3. 证据覆盖与身份冲突 ─────────────────────────────────────
const complete = assessExtractionEvidence(info)
assert('标题+详情+图片+OCR+高置信视觉为证据完整', complete.level === 'COMPLETE' && complete.missing.length === 0)
const conflictInfo = { ...info, visualProductForm: '湿巾', visualConfidence: 96 }
const conflict = assessExtractionEvidence(conflictInfo)
assert('视觉与详情/OCR形态冲突须人工核对', conflict.level === 'NEEDS_REVIEW' && conflict.conflicts.length > 0)
assert('冲突随完整信息进入请求', buildSelectionInfoText(conflictInfo).includes('商品身份冲突'))
const lowConfidence = { ...info, visualConfidence: 45, imageOcrText: '' }
const lowEvidence = assessExtractionEvidence(lowConfidence)
assert('低置信视觉不能作为可靠形态', !lowEvidence.hasReliableVisual && lowEvidence.level === 'NEEDS_REVIEW')
assert('低置信视觉身份锁标为待人工确认', buildProductIdentityLock(lowConfidence).includes('产品形态：待人工确认'))
const wipesReport = '# 测试报告\n## 第一部分：本品基础信息解析\n- 产品名称：宠物湿巾\n## 第二部分：市场分析'
assert('低置信视觉不得触发强制形态校验', validateSelectionReportIdentity(wipesReport, lowConfidence).every(issue => !issue.includes('视觉识别为液体精华')))
assert('高置信液体视觉继续阻止湿巾形态', validateSelectionReportIdentity(wipesReport, info).some(issue => issue.includes('视觉识别为液体精华')))
const negatedWipesReport = '# 测试报告\n## 第一部分：本品基础信息解析\n- 产品形态：液体精华，而非预浸湿巾\n## 第二部分：市场分析'
assert('否定语境中的湿巾不触发身份误报', validateSelectionReportIdentity(negatedWipesReport, info).every(issue => !issue.includes('视觉识别为液体精华')))

// ─── 4. 报告生成前身份门禁与人工裁决 ───────────────────────────
assert('未确认商品禁止生成报告', selectionGenerationGate(info, false).includes('确认并锁定'))
assert('证据完整且已确认允许生成报告', selectionGenerationGate(info, true) === '')
assert('冲突商品即使旧状态已确认仍禁止生成', selectionGenerationGate(conflictInfo, true).includes('人工身份裁决'))
const resolvedConflict = {
  ...conflictInfo,
  confirmedProductName: '宠物免洗擦浴精华',
  confirmedProductForm: '液体精华',
  confirmedUseMethod: '挤出液体后擦浴',
  confirmedTargetObject: '猫狗',
  identityResolutionNote: '以包装出液口和详情说明为准'
}
assert('冲突经人工裁决后允许生成报告', selectionGenerationGate(resolvedConflict, true) === '')
assert('人工裁决优先进入身份锁', buildProductIdentityLock(resolvedConflict).includes('产品形态：液体精华（人工裁决已锁定）'))
assert('人工裁决保留在完整请求', buildSelectionInfoText(resolvedConflict).includes('人工身份裁决：产品=宠物免洗擦浴精华'))
assert('人工裁决形态用于报告后置校验', validateSelectionReportIdentity(wipesReport, resolvedConflict).some(issue => issue.includes('人工确认锁定为液体精华')))

// ─── 5. 正式报告证据、关键输入与单位经济门禁 ───────────────────
const reportWithPositiveDecision = [
  '# 长标题 · Amazon美国站选品分析报告',
  '## 第一部分：本品基础信息解析',
  '- 产品名称：长标题',
  '## 第五部分：盈利可行性',
  '| 判定结果 | 是否选中 |',
  '|---|---|',
  '| ⚠️ 有条件谨慎入场 | 是 |'
].join('\n')
assert('缺少包装尺寸和毛重时阻止正向入场结论', validateSelectionReportEvidence(reportWithPositiveDecision, resolvedConflict).some(issue => issue.includes('FBA费用和贡献利润不可复算')))
const unsupportedEvidenceReport = [
  '## 第三部分：竞品',
  '| 高频差评痛点 | 本品 | 竞品 |',
  '|---|---|---|',
  '| 高频差评痛点 | — | “泵头易坏” |',
  '| 合规 | 办理FDA/EPA备案 | $1,000 / 4周 |',
  '| 海关 | HTS 3307.90.00 | 已确认 |'
].join('\n')
const unsupportedEvidenceIssues = validateSelectionReportEvidence(unsupportedEvidenceReport, resolvedConflict)
assert('未抓取评论正文时阻止评论洞察', unsupportedEvidenceIssues.some(issue => issue.includes('评论洞察')))
assert('未核验时阻止具体合规成本与HTS编码', unsupportedEvidenceIssues.some(issue => issue.includes('合规或知识产权')) && unsupportedEvidenceIssues.some(issue => issue.includes('HTS')))
const unsupportedRiskWarning = '| 风险预警 | Vet\'s Best发起专利投诉、FDA新规、液体运输限制 | 监控政策与竞品动态 |'
assert('未核验时阻止具体品牌专利投诉和监管新规', validateSelectionReportEvidence(unsupportedRiskWarning, resolvedConflict).some(issue => issue.includes('合规或知识产权')))
const competitorBrandRow = '| [TropiClean](https://www.amazon.com/s?k=TropiClean) | [B01EUNSD5G](https://www.amazon.com/dp/B01EUNSD5G) | 中高端天然护理 | $13.99 | 品牌认证与内容成熟 | FBA |'
assert('竞店行的已抓取售价与品牌认证描述不串联误判为合规成本', !validateSelectionReportEvidence(competitorBrandRow, resolvedConflict).some(issue => issue.includes('合规或知识产权')))
const openEndedComplianceRow = '| 合规 | 办理FDA/EPA备案 | $1,000 / 4周'
assert('无结尾竖线的合规表格仍可确定性降级', validateSelectionReportEvidence(sanitizeSelectionReportEvidence(openEndedComplianceRow, resolvedConflict), resolvedConflict).length === 0)
const invalidEconomics = [
  '| 测算项目（每件） | 悲观 | 基准 | 乐观 |',
  '|---|---:|---:|---:|',
  '| 实收销售收入 | $8.99 | $9.99 | $10.99 |',
  '| 采购+包装+质检成本 | $0.80 | $0.65 | $0.50 |',
  '| 国内物流+头程+关税清关 | $1.20 | $1.00 | $0.80 |',
  '| FBA入仓+仓储+履约 | $3.80 | $3.60 | $3.40 |',
  '| 平台佣金/交易费 | $1.35 | $1.50 | $1.65 |',
  '| 广告/优惠券 | $2.00 | $1.50 | $1.00 |',
  '| 退货/残损/售后 | $0.30 | $0.20 | $0.10 |',
  '| 单件综合总成本 | $9.45 | $8.45 | $7.45 |',
  '| 毛利润/毛利率 | -$0.46 / -5.1% | $1.54 / 15.4% | $3.54 / 32.2% |',
  '| 贡献利润/贡献毛利率 | -$2.46 / -27.4% | $0.04 / 0.4% | $2.54 / 23.1% |'
].join('\n')
const completeCostInfo = { ...resolvedConflict, attributes: [...resolvedConflict.attributes, '包装尺寸：10×8×2cm', '包装重量：40g'] }
const invalidEconomicsIssues = validateSelectionReportEvidence(invalidEconomics, completeCostInfo)
assert('单位经济复算发现毛利润口径错误', invalidEconomicsIssues.some(issue => issue.includes('毛利润计算错误')))
assert('单位经济复算发现广告费重复扣除', invalidEconomicsIssues.some(issue => issue.includes('广告已含在综合总成本')))
const pendingReport = '## 第五部分：盈利可行性\n- FBA费用、评论正文、合规与HTS编码：待验证\n❓ 数据不足，不能判定'
assert('未知数据明确待验证且结论为数据不足时允许通过', validateSelectionReportEvidence(pendingReport, resolvedConflict).length === 0)
const sanitizedEvidence = sanitizeSelectionReportEvidence(`${unsupportedEvidenceReport}\n${reportWithPositiveDecision}`, resolvedConflict)
assert('确定性降级清除无来源评论合规与HTS事实', validateSelectionReportEvidence(sanitizedEvidence, resolvedConflict).length === 0)
assert('确定性降级透明标记且选择数据不足', sanitizedEvidence.includes('系统质量修正') && sanitizedEvidence.includes('❓ 数据不足，不能判定'))
const sanitizedIdentity = sanitizeSelectionReportEvidence(wipesReport, resolvedConflict)
assert('确定性降级只在第一部分回写人工锁定形态', validateSelectionReportIdentity(sanitizedIdentity, resolvedConflict).length === 0 && sanitizedIdentity.includes('液体精华（人工确认锁定）'))
assert('确定性降级清除无来源专利投诉和监管新规', validateSelectionReportEvidence(sanitizeSelectionReportEvidence(unsupportedRiskWarning, resolvedConflict), resolvedConflict).length === 0)
const normalized = normalizeSelectionReport('# 错误长标题 · eBay美国站选品分析报告\n\n## 第一部分：本品基础信息解析\n- 产品名称：错误长标题', SELECTION_ANALYSIS_REQUEST, '宠物免洗擦浴精华')
assert('报告标题优先使用人工确认产品名和本次Amazon平台', normalized.startsWith('# 宠物免洗擦浴精华 · Amazon美国站选品分析报告'))
const forcedPlatform = normalizeSelectionReport('# 模型自由标题 · eBay美国站市场报告\n\n## 一、概览\n目标平台：eBay美国站', 'Amazon美国站', '宠物苦苹果喷雾', '', true)
assert('正式报告强制覆盖自由标题中的旧平台', forcedPlatform.startsWith('# 宠物苦苹果喷雾 · Amazon美国站选品分析报告') && validateSelectionReportPlatform(forcedPlatform, 'Amazon美国站').length === 0)

// ─── 6. 主进程与渲染层源码契约 ──────────────────────────────────
const root = process.env.LISTING_REPO_ROOT || join(__dirname, '..')
const tsx = readFileSync(join(root, 'src/renderer/AIEmployee.tsx'), 'utf-8')
const css = readFileSync(join(root, 'src/renderer/ai-employee.css'), 'utf-8')
const browserWorkspace = readFileSync(join(root, 'src/main/browser/BrowserWorkspace.ts'), 'utf-8')
const selection = readFileSync(join(root, 'src/shared/selectionExtract.ts'), 'utf-8')
assert('提取后输入框预填要求文案', tsx.includes('setDraft(SELECTION_ANALYSIS_REQUEST)'))
assert('发送时组装 信息+要求', tsx.includes('buildSelectionInfoText(prefilledInfo)'))
assert('发送后仅收起提取卡', tsx.includes('setExtractedCollapsed(true)') && !tsx.includes('setExtracted(null)\n    setPlatform'))
assert('属性不再截断 6 条', !/attributes[^\n]{0,80}slice\(0,\s*6\)/.test(tsx))
assert('卡片含 URL/分析日期/图片 字段', tsx.includes('1688商品URL') && tsx.includes('分析日期') && tsx.includes('图片'))
assert('卡片显示证据覆盖/图片证据/身份冲突', tsx.includes('证据覆盖') && tsx.includes('商品图片证据') && tsx.includes('身份冲突'))
assert('卡片显示OCR警告与视觉待确认', tsx.includes('OCR提示') && tsx.includes('必须人工确认'))
assert('未确认发送由前置门禁拦截', tsx.includes('selectionGenerationGate(extracted, extractedConfirmed)'))
assert('冲突商品提供人工身份裁决表单', tsx.includes('人工确认本品身份') && tsx.includes('保存并锁定身份'))
assert('人工身份裁决表单优先于长详情展示', tsx.indexOf('className="ai-employee-identity-editor"') < tsx.indexOf('{!extractedCollapsed && <dl>'))
assert('人工裁决不覆盖原始视觉证据', tsx.includes('confirmedProductForm: productForm') && !tsx.includes('visualProductForm: productForm'))
assert('主进程提取详情来源', browserWorkspace.includes('detailSource') && browserWorkspace.includes('结构化商品描述'))
assert('主进程按来源筛选商品图', browserWorkspace.includes('imageEvidence') && browserWorkspace.includes('商品主图区域') && browserWorkspace.includes('商品详情区域'))
assert('主进程排除非商品图片', browserWorkspace.includes('logo|avatar|icon|sprite|qrcode'))
assert('CSS 去 160px 高度上限', !css.includes('max-height: 160px'))
assert('CSS 去单行省略号', !/ai-employee-extracted dd \{[^}]*text-overflow: ellipsis/.test(css))
assert('CSS 宽行跨两列', css.includes('.ai-employee-extracted dl div.wide'))
assert('CSS 含证据和图片预览布局', css.includes('.ai-employee-extracted-evidence') && css.includes('.ai-employee-extracted-images'))
assert('CSS 含人工身份裁决布局', css.includes('.ai-employee-identity-editor') && css.includes('.ai-employee-identity-fields'))
assert('提取卡长内容限制高度并独立滚动', /\.ai-employee-extracted\s*\{[^}]*max-height:\s*clamp\([^}]*overflow-y:\s*auto/s.test(css))
assert('提取卡标题在滚动时保持可见', /\.ai-employee-extracted header\s*\{[^}]*position:\s*sticky[^}]*top:\s*0/s.test(css))
assert('人工身份保存操作固定在卡片可视底部', /\.ai-employee-identity-editor-actions\s*\{[^}]*position:\s*sticky[^}]*bottom:\s*-10px/s.test(css))
assert('输入栏超高时保留兜底滚动', /\.ai-employee-floating-composer\s*\{[^}]*max-height:\s*calc\(100% - 28px\)[^}]*box-sizing:\s*border-box[^}]*overflow-y:\s*auto/s.test(css))
assert('报告返回后执行证据和单位经济门禁', tsx.includes('validateSelectionReportEvidence(content, extracted)'))
assert('提取卡提供快速市场利润参数输入', tsx.includes('快速市场利润参数（USD）') && tsx.includes('采购价（USD）') && tsx.includes('FBA履约费（USD）') && tsx.includes('updateQuickProfit'))
assert('报告请求携带快速市场利润事实块与字段可决策状态', tsx.includes('buildAmazonQuickMarketProfitFactBlock(intent, classified.samples, prefilledQuickProfit, prefilledProfitFieldMeta)'))
assert('提取卡提供全成本低基准高区间输入', tsx.includes('全成本区间（每件 USD）') && tsx.includes('国内物流') && tsx.includes('头程') && tsx.includes('关税') && tsx.includes('清关') && tsx.includes('入仓') && tsx.includes('updateFullCost'))
assert('报告请求携带全成本落地利润事实块与字段可决策状态', tsx.includes('buildAmazonFullCostProfitFactBlock(intent, classified.samples, prefilledQuickProfit, extracted.fullCostProfit, prefilledProfitFieldMeta)'))
assert('提取卡提供阶段5入场决策门禁输入', tsx.includes('阶段5：入场决策门禁') && tsx.includes('目标贡献利润率') && tsx.includes('差异化核验依据') && tsx.includes('合规IP核验依据') && tsx.includes('updateEntryDecision'))
assert('报告请求携带阶段5系统入场结论与字段可决策状态', tsx.includes('buildAmazonEntryDecisionFactBlock(intent, classified.samples, classified.audit, prefilledQuickProfit, extracted.fullCostProfit, extracted.entryDecision, prefilledProfitFieldMeta)'))
assert('利润字段保存来源、证据等级和可决策状态', selection.includes("profitFieldMeta?: Partial<Record<ProfitFieldKey, ProfitFieldMeta>>"))
assert('利润字段来源包含自动、预设、用户修改和暂缺填零', selection.includes("'自动提取' | '系统预设' | '用户修改' | '暂缺填零'"))
assert('用户修改会覆盖字段元数据', tsx.includes('[field]: userEditedProfitFieldMeta()') && tsx.includes('[metaKey]: userEditedProfitFieldMeta()'))
const userEditedMeta = userEditedProfitFieldMeta()
assert('用户修改元数据可用于持久化与决策', userEditedMeta.origin === '用户修改' && userEditedMeta.evidenceLevel === '分析假设' && userEditedMeta.decisionEligible && userEditedMeta.source === '用户录入')
const supplyFacts = extractSupplyFacts({ price: '¥2.50 - ¥3.00', attributes: ['包装尺寸：10×8×2cm', '包装重量：40g', '成分：柿子/丁香/香茅提取物'], detailText: '宠物液体精华，免洗擦浴。' })
assert('供货事实提取采购价区间', supplyFacts.purchasePriceCny?.low === 2.5 && supplyFacts.purchasePriceCny?.high === 3)
assert('供货事实提取包装尺寸和毛重', supplyFacts.packagingDimensionsCm?.length === 10 && supplyFacts.packagingDimensionsCm?.width === 8 && supplyFacts.grossWeightGrams?.value === 40)
assert('供货事实提取成分和液体风险', supplyFacts.ingredientText?.includes('柿子') && supplyFacts.liquidRisk)
const conflictedSupplyFacts = extractSupplyFacts({ attributes: ['包装重量：40g', '包装重量：60g', '包装尺寸：10×8×2cm', '包装尺寸：12×8×2cm'] })
assert('供货事实冲突不自动选择尺寸或重量', !conflictedSupplyFacts.grossWeightGrams && !conflictedSupplyFacts.packagingDimensionsCm && conflictedSupplyFacts.conflicts.length === 2)
assert('提取完成后归集供货事实并持久化', tsx.includes('info.supplyFacts = extractSupplyFacts(info)'))
const cnyPurchase = applyCnyPurchasePriceUsd({ price: '¥6.50', supplyFacts: extractSupplyFacts({ price: '¥6.50' }) }, { usdPerCny: 0.14, fetchedAt: '2026-08-17T00:00:00.000Z', source: '测试汇率源' })
assert('1688人民币采购价自动换算为USD', cnyPurchase.quickMarketProfit?.purchaseCostUsd === 0.91 && cnyPurchase.profitFieldMeta?.purchaseCostUsd?.origin === '自动提取' && cnyPurchase.profitFieldMeta?.purchaseCostUsd?.evidenceLevel === '外部估算')
const cnyPurchaseRange = applyCnyPurchasePriceUsd({ price: '¥2.50 - ¥3.00', supplyFacts: extractSupplyFacts({ price: '¥2.50 - ¥3.00' }) }, { usdPerCny: 0.14, fetchedAt: '2026-08-17T00:00:00.000Z', source: '测试汇率源' })
assert('采购价区间按上限换算避免低估成本', cnyPurchaseRange.quickMarketProfit?.purchaseCostUsd === 0.42 && cnyPurchaseRange.profitFieldMeta?.purchaseCostUsd?.source.includes('¥3.00'))
const preservedCnyPurchase = applyCnyPurchasePriceUsd({ price: '¥6.50', quickMarketProfit: { purchaseCostUsd: 1.23 }, supplyFacts: extractSupplyFacts({ price: '¥6.50' }) }, { usdPerCny: 0.14, fetchedAt: '2026-08-17T00:00:00.000Z', source: '测试汇率源' })
assert('人民币换算不覆盖已填采购价', preservedCnyPurchase.quickMarketProfit?.purchaseCostUsd === 1.23)
const petFinancialPreset = buildAmazonFinancialPreset({
  ...info,
  supplyFacts: extractSupplyFacts({ ...info, attributes: [...info.attributes, '包装尺寸：10×8×2cm', '包装重量：40g', '成分：柿子/丁香/香茅提取物'] })
})
assert('宠物用品生成 Pet Supplies 候选类目与 15% 佣金候选', petFinancialPreset.candidateCategory === 'Pet Supplies（候选）' && petFinancialPreset.quickMarketProfit.referralFeeRate === 15)
assert('用户指定广告、优惠券和目标利润率生成预设', petFinancialPreset.quickMarketProfit.advertisingRate === 10 && petFinancialPreset.quickMarketProfit.couponCostUsd === 5 && petFinancialPreset.entryDecision.targetContributionMargin === 20)
const blankSupplyPreset = buildAmazonFinancialPreset({ ...info, supplyFacts: { extractedAt: '2026-08-17', liquidRisk: false, conflicts: [] } })
assert('FBA 缺少计算器结果仅暂缺填零且不可决策', blankSupplyPreset.quickMarketProfit.fbaFulfillmentFeeUsd === 0 && blankSupplyPreset.profitFieldMeta.fbaFulfillmentFeeUsd?.origin === '暂缺填零' && !blankSupplyPreset.profitFieldMeta.fbaFulfillmentFeeUsd?.decisionEligible)
assert('全成本未知项暂缺填零且均不可用于正向结论', petFinancialPreset.fullCostProfit.firstLegFreightUsd?.base === 0 && petFinancialPreset.profitFieldMeta['firstLegFreightUsd.base']?.origin === '暂缺填零' && !petFinancialPreset.profitFieldMeta['firstLegFreightUsd.base']?.decisionEligible)
assert('差异化与合规IP仅自动提取为待人工核验依据', petFinancialPreset.entryDecision.differentiationEvidence?.includes('形态') && petFinancialPreset.entryDecision.complianceIpEvidence?.includes('成分') && !petFinancialPreset.profitFieldMeta.differentiationEvidence?.decisionEligible && !petFinancialPreset.profitFieldMeta.complianceIpEvidence?.decisionEligible)
const dietPreset = buildAmazonFinancialPreset({ title: '宠物兽医处方粮', detailText: 'veterinary diet', supplyFacts: extractSupplyFacts({}) })
assert('兽医处方饮食不误设 15% 宠物佣金', dietPreset.quickMarketProfit.referralFeeRate === undefined && dietPreset.warnings.some(item => item.includes('22%')))
assert('提取完成后生成阶段3 Amazon 费用候选值', tsx.includes('info.amazonFinancialPreset = buildAmazonFinancialPreset(info)'))
const appliedPreset = applyAmazonFinancialPreset({ ...info, amazonFinancialPreset: petFinancialPreset })
assert('阶段4自动预填阶段3候选值', appliedPreset.quickMarketProfit?.referralFeeRate === 15 && appliedPreset.quickMarketProfit?.advertisingRate === 10 && appliedPreset.entryDecision?.targetContributionMargin === 20)
assert('阶段4自动预填保留暂缺填零元数据', appliedPreset.fullCostProfit?.firstLegFreightUsd?.base === 0 && appliedPreset.profitFieldMeta?.['firstLegFreightUsd.base']?.origin === '暂缺填零' && !appliedPreset.profitFieldMeta?.['firstLegFreightUsd.base']?.decisionEligible)
const preservedUserProfit = applyAmazonFinancialPreset({ ...info, amazonFinancialPreset: petFinancialPreset, quickMarketProfit: { referralFeeRate: 12 }, profitFieldMeta: { referralFeeRate: userEditedProfitFieldMeta() } })
assert('阶段4预填不覆盖用户已修改字段和元数据', preservedUserProfit.quickMarketProfit?.referralFeeRate === 12 && preservedUserProfit.profitFieldMeta?.referralFeeRate?.origin === '用户修改')
assert('阶段4在提取与旧会话加载时安全应用预填', tsx.includes('const prefilledInfo = applyAmazonFinancialPreset(info)') && tsx.includes('const info = applyAmazonFinancialPreset(state.info)'))
assert('阶段4界面显示来源等级与不可决策提示', tsx.includes('profitFieldHint') && tsx.includes('不可作为正向入场依据') && tsx.includes('暂缺项预填 0'))
assert('阶段5报告回填校验沿用字段可决策状态', tsx.includes('extracted.entryDecision, extracted.profitFieldMeta).decision'))
assert('提取与旧会话加载均调用实时人民币换算', tsx.includes('window.desktop.aiEmployee.cnyUsdRate()') && tsx.includes('info = applyCnyPurchasePriceUsd(info, exchangeRate)'))
const main = readFileSync(join(root, 'src/main/main.ts'), 'utf-8')
const preload = readFileSync(join(root, 'src/preload/preload.ts'), 'utf-8')
assert('主进程提供带缓存的CNY/USD汇率接口', main.includes("ipcMain.handle('ai-employee:cny-usd-rate'") && main.includes('open.er-api.com/v6/latest/CNY') && main.includes('60 * 60 * 1000'))
assert('预加载层暴露CNY/USD汇率接口', preload.includes("cnyUsdRate: (): Promise"))
assert('最终确定性降级结果始终重新校验并采用', tsx.includes('candidateContent = sanitized') && tsx.includes('qualityIssues = sanitizedIssues'))
assert('正式报告标题优先使用人工确认商品名', tsx.includes('extracted?.confirmedProductName'))
assert('历史报告恢复沿用同会话人工确认商品名', tsx.includes('loadExtractionMap()[id]?.info?.confirmedProductName') && tsx.includes('normalizeSelectionReport(safeMessage.content, targetPlatform, confirmedProductName, lastUserText)'))
assert('正式Amazon报告隔离旧助手历史', tsx.includes('const prevHistory = extracted ? [] : messages.slice(-10)'))
assert('正式报告保存前强制统一平台标题', tsx.includes('normalizeSelectionReport(candidateContent, targetPlatform, extracted?.confirmedProductName, text, true)'))
assert('选品调研员并行调度 DeepSeek 等修正模型', tsx.includes("REPORT_REPAIR_MODEL_IDS = ['deepseek-chat', 'qwen-plus', 'ragflow-agent']") && tsx.includes('Promise.allSettled(repairModelIds.map'))
assert('所有模型失败仍交付系统事实预备报告', tsx.includes('buildGuaranteedPreliminaryReport(extracted, currentMarketAudit, targetPlatform'))

// ─── 7. FBA 履约费推算接通与 4 档目标贡献利润率按钮 ─────────────
const fbaPreset = buildAmazonFinancialPreset({
  ...info,
  supplyFacts: {
    extractedAt: '2026-08-17',
    packagingDimensionsCm: { length: 10, width: 8, height: 2, source: '1688 规格' },
    grossWeightGrams: { value: 40, source: '1688 规格' },
    liquidRisk: false,
    conflicts: []
  }
})
assert('重量+尺寸 存在时 FBA 履约费推算填入 SmallStandard/LargeStandard 0.5 lb 档', fbaPreset.quickMarketProfit.fbaFulfillmentFeeUsd === 3.43)
assert('重量+尺寸 存在时 FBA 履约费 origin=系统预设 + evidenceLevel=外部估算 + decisionEligible=true', fbaPreset.profitFieldMeta.fbaFulfillmentFeeUsd?.origin === '系统预设' && fbaPreset.profitFieldMeta.fbaFulfillmentFeeUsd?.evidenceLevel === '外部估算' && fbaPreset.profitFieldMeta.fbaFulfillmentFeeUsd?.decisionEligible === true)
assert('FBA 履约费 source 含 2024-09 生效费率表版本与 weight tier 描述', (fbaPreset.profitFieldMeta.fbaFulfillmentFeeUsd?.source || '').includes('Amazon US FBA 2024-09 生效费率') && (fbaPreset.profitFieldMeta.fbaFulfillmentFeeUsd?.source || '').includes('LargeStandard'))
const fbaMissingPreset = buildAmazonFinancialPreset({ ...info })
assert('重量或尺寸 缺失时 FBA 履约费仍为 0 + decisionEligible=false', fbaMissingPreset.quickMarketProfit.fbaFulfillmentFeeUsd === 0 && fbaMissingPreset.profitFieldMeta.fbaFulfillmentFeeUsd?.decisionEligible === false && fbaMissingPreset.profitFieldMeta.fbaFulfillmentFeeUsd?.origin === '暂缺填零')
assert('提取卡目标贡献利润率提供 4 档按钮 + 不选', tsx.includes('ai-employee-target-margin') && /\[10, 15, 20, 25\]\.map/.test(tsx) && tsx.includes('不选') && tsx.includes('aria-label="目标贡献利润率"'))
assert('提取卡 4 档按钮默认 20% 由 buildAmazonFinancialPreset 预设', petFinancialPreset.entryDecision.targetContributionMargin === 20 && /\[10, 15, 20, 25\]\.map\(value => \{[\s\S]{0,400}active = entryDecision\.targetContributionMargin === value/.test(tsx))

// ─── 8. 阶段 3+ 大模型提炼差异化/合规核验依据 ──────────────────────
const mainSrc = readFileSync(join(root, 'src/main/main.ts'), 'utf-8')
const preloadSrc = readFileSync(join(root, 'src/preload/preload.ts'), 'utf-8')
const globalDtsSrc = readFileSync(join(root, 'src/renderer/global.d.ts'), 'utf-8')
assert('主进程注册 ai-employee:infer-evidence IPC 并调用 service.inferDifferentiationAndCompliance', mainSrc.includes("ipcMain.handle('ai-employee:infer-evidence'") && mainSrc.includes('aiEmployeeChatService.inferDifferentiationAndCompliance(input)'))
assert('预加载层暴露 inferEvidence 调用入口', preloadSrc.includes("inferEvidence: (input: unknown): Promise<unknown> => ipcRenderer.invoke('ai-employee:infer-evidence'"))
assert('renderer global.d.ts 声明 inferEvidence 返回包含 differentiation/compliance/model/provider', globalDtsSrc.includes('inferEvidence(input:') && globalDtsSrc.includes('Promise<{ differentiation: string; compliance: string; model: string; provider: string } | null>'))
assert('阶段 3 末调用大模型提炼并区分用户修改优先', tsx.includes('window.desktop.aiEmployee.inferEvidence({') && tsx.includes("differentiationMeta?.origin !== '用户修改'") && tsx.includes("complianceMeta?.origin !== '用户修改'"))

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
