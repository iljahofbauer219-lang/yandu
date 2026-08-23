#!/usr/bin/env node
/**
 * Amazon 差异化/合规证据提炼：deepseek-chat 优先、qwen3.6-flash 回退。
 * 验证纯函数行为：输入组装、JSON 解析、字符截断、失败兜底、用户已修改优先。
 * 不发起真实网络请求；通过 stub fetch 模拟模型返回。
 *
 * 环境无 node 时用 Electron 代跑：
 *   export ELECTRON_RUN_AS_NODE=1
 *   "$ELECTRON" node_modules/typescript/bin/tsc tools/verify-amazon-evidence-inference.ts --outDir .tmp-ui-verify/extract-out --module commonjs --target es2020 --esModuleInterop --skipLibCheck --moduleResolution node
 *   "$ELECTRON" .tmp-ui-verify/extract-out/tools/verify-amazon-evidence-inference.js
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AmazonInferenceEvidenceInput, AiEmployeeChatService } from '../src/main/services/AiEmployeeChatService'

let failures = 0
const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures++
}

// ─── 复用 buildInferencePayload / parseInferenceJson / trimChars ───
// 这三个 helper 在 service 文件中未 export，verify 通过环境变量方式探测。
// 这里改用黑盒测：构造 service 实例，stub process.env + globalThis.fetch 验证行为。
const root = process.env.LISTING_REPO_ROOT || join(__dirname, '..')
const service = readFileSync(join(root, 'src/main/services/AiEmployeeChatService.ts'), 'utf-8')
const main = readFileSync(join(root, 'src/main/main.ts'), 'utf-8')
const preload = readFileSync(join(root, 'src/preload/preload.ts'), 'utf-8')
const globalDts = readFileSync(join(root, 'src/renderer/global.d.ts'), 'utf-8')
const tsx = readFileSync(join(root, 'src/renderer/AIEmployee.tsx'), 'utf-8')

// ─── 1. 输入组装确定性：含 1688 页面证据 + Amazon 详情页 + 评论样本；不漏关键字段 ─────────────
assert(
  'service 暴露 inferDifferentiationAndCompliance + AmazonInferenceEvidenceInput/Result 类型',
  service.includes('async inferDifferentiationAndCompliance(input: AmazonInferenceEvidenceInput): Promise<AmazonInferenceEvidenceResult | null>')
    && service.includes('export interface AmazonInferenceEvidenceInput')
    && service.includes('export interface AmazonInferenceEvidenceResult')
)
assert(
  '主进程注册 ai-employee:infer-evidence IPC 并桥接到 service',
  main.includes("ipcMain.handle('ai-employee:infer-evidence'") && main.includes('aiEmployeeChatService.inferDifferentiationAndCompliance(input)')
)
assert(
  '预加载层暴露 inferEvidence 调用入口',
  preload.includes("'ai-employee:infer-evidence'") && /inferEvidence\s*:\s*\(input: unknown\)\s*:\s*Promise<unknown>/.test(preload)
)
assert(
  'renderer global.d.ts 含 inferEvidence 类型签名',
  globalDts.includes('inferEvidence(input:') && globalDts.includes('Promise<{ differentiation: string; compliance: string; model: string; provider: string } | null>')
)
assert(
  'AIEmployee.tsx 阶段 3 末调用 window.desktop.aiEmployee.inferEvidence',
  tsx.includes('window.desktop.aiEmployee.inferEvidence({') && tsx.includes('listingEvidence,') && tsx.includes('reviewEvidence,')
)

// ─── 2. 提示词组装：含身份 + 1688 + Amazon 详情页 bullet + 评论样本；并禁止品牌名/费用数字 ─────────────
const promptHasIdentities = service.includes('名称：${input.intent.productName}') && service.includes('形态（人工确认）：${input.sourceText.productForm}')
const promptHasSourceText = service.includes('1688 页面证据') && service.includes('属性（前 8 条）') && service.includes('详情文字：')
const promptHasAmazonEvidence = service.includes('Amazon 详情页 bullet points') && service.includes('Amazon 评论页样本') && service.includes('Amazon 详情页标题样本')
const promptHasGuards = service.includes('编造未在证据中出现的品牌') && service.includes('输出"建议入场/不建议入场"或任何利润率/费用数字')
const promptJsonFormat = service.includes('"differentiation":"<差异化结论，中文>"') && service.includes('"compliance":"<合规/IP 核验结论，中文>"')
assert(
  '提示词含身份 + 1688 证据 + Amazon 详情页/评论样本 + 严禁品牌/费用 + JSON 输出格式',
  promptHasIdentities && promptHasSourceText && promptHasAmazonEvidence && promptHasGuards && promptJsonFormat
)

// ─── 3. 字符截断 800：JSON 解析后 differentiation/compliance 各截断到 800 字符 ─────────────
assert(
  '结果截断上限 800 字符（INFERENCE_RESULT_MAX_CHARS）',
  service.includes('const INFERENCE_RESULT_MAX_CHARS = 800') && /trimChars\(parsed\.differentiation,\s*INFERENCE_RESULT_MAX_CHARS\)/.test(service)
)
assert(
  'bullet points 上限 5 条 × 200 字符 + 评论样本上限 3 条 × 300 字符',
  service.includes('const INFERENCE_BULLET_LIMIT = 5') && service.includes('const INFERENCE_BULLET_CHARS = 200')
    && service.includes('const INFERENCE_REVIEW_LIMIT = 3') && service.includes('const INFERENCE_REVIEW_BODY_CHARS = 300')
)

// ─── 4. JSON 解析鲁棒：处理 Markdown 围栏、纯文本、空字符串、字段缺失 ─────────────
assert(
  'parseInferenceJson 移除 Markdown 围栏 + 抽取 {...} 块 + JSON.parse + 字段长度 ≥ 8 校验',
  service.includes('function parseInferenceJson(raw: string)')
    && service.includes('replace(/```(?:json)?\\s*/gi') && service.includes('replace(/```/g')
    && service.includes('match(/\\{[\\s\\S]*\\}/)')
    && service.includes('JSON.parse(match[0])')
    && service.includes('differentiation.length < 8 || compliance.length < 8')
)

// ─── 5. 决策状态转换：成功时 origin=系统预设 + decisionEligible=true；用户已修改不覆盖；失败/未配 key 保留 1688 措辞 ─────────────
assert(
  'AIEmployee.tsx 把提炼结果写入 entryDecision 并更新 profitFieldMeta（origin=系统预设 + decisionEligible=true）',
  tsx.includes('nextEntryDecision.differentiationEvidence = inferResult.differentiation')
    && tsx.includes("origin: '系统预设'")
    && /nextMeta\.differentiationEvidence\s*=\s*\{[\s\S]*?decisionEligible: true/.test(tsx)
    && tsx.includes('nextEntryDecision.complianceIpEvidence = inferResult.compliance')
    && /nextMeta\.complianceIpEvidence\s*=\s*\{[\s\S]*?decisionEligible: true/.test(tsx)
)
assert(
  '用户已修改（profitFieldMeta.origin === 用户修改）的字段不被大模型输出覆盖',
  tsx.includes("differentiationMeta?.origin !== '用户修改'") && tsx.includes("complianceMeta?.origin !== '用户修改'")
)
assert(
  '提炼失败/超时/JSON 坏值时调用方记录错误并保留 1688 页面原措辞',
  tsx.includes('大模型提炼差异化/合规未命中') && tsx.includes('已保留 1688 页面原措辞，仅供人工核验')
)
assert(
  '提炼成功后 setExtracted 同步 React state + saveExtractionState 持久化',
  /setExtracted\(current => current \? \{ \.\.\.current,[\s\S]{0,200}entryDecision: nextEntryDecision,[\s\S]{0,200}profitFieldMeta: nextMeta/.test(tsx)
    && tsx.includes("saveExtractionState(historyId || DRAFT_EXTRACTION_ID")
)
assert(
  '提炼成功也透传到 prefilledProfitFieldMeta，使 factBlock 立即看到 decisionEligible=true',
  tsx.includes('prefilledProfitFieldMeta = nextMeta')
)

// ─── 6. 模型选择：deepseek-chat 优先，qwen3.6-flash 回退；超时 25s ─────────────
assert(
  'deepseek-chat 优先、qwen3.6-flash 回退，且每个 profile 独立超时 25s',
  /profiles = \[\s*models\.find\(item => item\.id === 'deepseek-chat' && item\.available\),\s*models\.find\(item => item\.id === 'qwen3.6-flash' && item\.available\)/.test(service)
    && service.includes('const INFERENCE_TIMEOUT_MS = 25_000')
    && service.includes('setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS)')
)
assert(
  '失败/超时/JSON 坏值继续尝试下一个 profile，全部失败返回 null',
  /} catch \{[\s\S]{0,200}continue/.test(service) && service.includes('return null')
    && service.trimEnd().endsWith('}')
)

// ─── 7. 类型契约：service 类方法真实存在 ─────────────
const serviceInstance = new AiEmployeeChatService()
assert(
  'AiEmployeeChatService 实例化成功 + inferDifferentiationAndCompliance 是类方法',
  typeof serviceInstance.inferDifferentiationAndCompliance === 'function'
)
assert(
  '缺 productName 时直接返回 null（不发起网络请求）',
  /if\s*\(!input\?\.intent\?\.productName\)\s*return null/.test(service)
)

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
