// 零度API 28 个模型目录（按 OpenAI 5 / Google 10 / Anthropic 10 / Vidu 3 编排；api000.com/pricing 37 个的精选子集）。
// 主进程 + 渲染层共用，作为 LinduoChatModel 白名单的「真值源」。
// 启动时 src/main/services/linduoChatModelSync.ts 会把 capabilities 包含 CHAT 的同步到 DB。
// 数据依据：api000.com/pricing 页面（2026-08-26 截图；恢复自 stash@{0} 的 M1 选品成果）。
//
// ⚠️ 双源对账约束（scripts/check-linduo-catalog-consistency.mjs，pnpm lint:catalog）：
// 1. 本文件与 server/src/modules/linduo/linduoCatalog.ts 的 id 集合必须完全一致；
// 2. server/.../pricing-fallback.ts 的每个 modelId 必须在本目录中存在；
// 3. src/main/advisor/MultimodalVision.ts 引用的 gpt-* id 必须在本目录中存在；
// 4. 头注「N 个模型目录 / OpenAI M」必须等于实际长度，否则守卫报错。

export type LinduoCapability = 'IMAGE' | 'VIDEO' | 'CHAT' | 'VISION' | 'EMBEDDING' | 'AUDIO'

export type LinduoVendor = 'openai' | 'google' | 'anthropic' | 'vidu'

export interface LinduoModelEntry {
  id: string
  name: string
  vendor: LinduoVendor
  capabilities: LinduoCapability[]
  description: string
  /** 选型口诀：1 句话告诉用户"这个模型在哪个场景下用 / 不要用"（紫色 chip 渲染） */
  briefRating: string
  contextLabel?: string
  wiredToImageStudio?: boolean
}

export const LINDUO_MODELS: LinduoModelEntry[] = [
  // OpenAI 5（2026-08-28 用户策展：退役 gpt-4o/4o-快照/4o-mini/gpt-5/5-mini/5.3-codex/5.4/5.4-mini/5.5）
  { id: 'gpt-5.6-luna',       name: 'GPT-5.6 Luna',       vendor: 'openai', capabilities: ['CHAT'],           description: 'GPT-5.6 入门款，价格最便宜',                 briefRating: '新版极轻量，最便宜',           contextLabel: '1M' },
  { id: 'gpt-5.6-sol',        name: 'GPT-5.6 Sol',        vendor: 'openai', capabilities: ['CHAT', 'VISION'], description: 'GPT-5.6 旗舰款，复杂任务首选',               briefRating: '新版旗舰，复杂任务',           contextLabel: '1M' },
  { id: 'gpt-5.6-terra',      name: 'GPT-5.6 Terra',      vendor: 'openai', capabilities: ['CHAT', 'VISION'], description: 'GPT-5.6 均衡款，性能与价格平衡',             briefRating: '新版均衡款',                   contextLabel: '1M' },
  { id: 'gpt-image-2',        name: 'GPT-Image-2',        vendor: 'openai', capabilities: ['IMAGE'],          description: 'OpenAI 图像生成 v2，文字渲染与细节更稳',    briefRating: '商品主图生图，标准款',         wiredToImageStudio: true },
  { id: 'gpt-image-2-all',    name: 'GPT-Image-2 All',    vendor: 'openai', capabilities: ['CHAT', 'VISION', 'IMAGE'], description: 'GPT-Image-2 全模态版，多模态对话 + 图像生成', briefRating: '改图与多模态对话',         wiredToImageStudio: true },
  // Google 10
  { id: 'gemini-2.5-flash',        name: 'Gemini 2.5 Flash',     vendor: 'google', capabilities: ['CHAT', 'VISION'], description: 'Google 轻量多模态，速度与成本平衡',         briefRating: '多模态轻量，性价比高',         contextLabel: '1M' },
  { id: 'gemini-2.5-flash-lite',   name: 'Gemini 2.5 Flash-Lite',vendor: 'google', capabilities: ['CHAT', 'VISION'], description: '低价体验 Lite 版，超低成本',                briefRating: '极轻量，海量分类',             contextLabel: '1M' },
  { id: 'gemini-2.5-pro',          name: 'Gemini 2.5 Pro',       vendor: 'google', capabilities: ['CHAT', 'VISION'], description: 'Google 旗舰多模态，推理与代码表现强',       briefRating: '旧版主力，稳定可用',           contextLabel: '1M' },
  { id: 'gemini-3-flash-preview',  name: 'Gemini 3 Flash',       vendor: 'google', capabilities: ['CHAT', 'VISION'], description: 'Gemini 3 Flash 预览版',                     briefRating: '新版轻量（preview 慎用）',     contextLabel: '1M' },
  { id: 'gemini-3-pro-preview',    name: 'Gemini 3 Pro',         vendor: 'google', capabilities: ['CHAT', 'VISION'], description: 'Gemini 3 Pro 预览版',                       briefRating: '新版主力（preview 慎用）',     contextLabel: '1M' },
  { id: 'gemini-3.1-flash',        name: 'Gemini 3.1 Flash',     vendor: 'google', capabilities: ['CHAT', 'VISION'], description: 'Gemini 3.1 Flash 正式版',                   briefRating: '新版轻量正式',                 contextLabel: '1M' },
  { id: 'gemini-3.1-flash-lite',   name: 'Gemini 3.1 Flash-Lite',vendor: 'google', capabilities: ['CHAT', 'VISION'], description: 'Gemini 3.1 轻量 Lite 版',                   briefRating: '极轻量新版',                   contextLabel: '1M' },
  { id: 'gemini-3.1-pro-preview',  name: 'Gemini 3.1 Pro',       vendor: 'google', capabilities: ['CHAT', 'VISION'], description: 'Gemini 3.1 Pro 预览版',                     briefRating: '新主力预览（慎用）',           contextLabel: '1M' },
  { id: 'nano-banana-2',           name: 'Nano Banana 2',        vendor: 'google', capabilities: ['IMAGE'],          description: 'Google Nano Banana 2 图像生成',            briefRating: 'Google 生图标准款',             wiredToImageStudio: true },
  { id: 'nano-banana-pro',         name: 'Nano Banana Pro',      vendor: 'google', capabilities: ['IMAGE'],          description: 'Google Nano Banana Pro 旗舰生图',          briefRating: 'Google 生图高质量',             wiredToImageStudio: true },
  // Anthropic 10
  { id: 'claude-fable-5',    name: 'Claude Fable 5',     vendor: 'anthropic', capabilities: ['CHAT', 'VISION'], description: 'Anthropic 实验系列 Fable，顶级价格',         briefRating: '✗ 溢价，不推荐业务用',         contextLabel: '1M' },
  { id: 'claude-haiku-4-5',  name: 'Claude Haiku 4.5',   vendor: 'anthropic', capabilities: ['CHAT'],           description: '轻量 Claude，速度与成本最优',               briefRating: '大量分类/打标/关键词首选',     contextLabel: '1M' },
  { id: 'claude-opus-4-5',   name: 'Claude Opus 4.5',    vendor: 'anthropic', capabilities: ['CHAT', 'VISION'], description: 'Opus 4.5，复杂任务首选',                     briefRating: '高质量（已被 4-8 超越）',       contextLabel: '1M' },
  { id: 'claude-opus-4-6',   name: 'Claude Opus 4.6',    vendor: 'anthropic', capabilities: ['CHAT', 'VISION'], description: 'Opus 4.6，能力微调版',                       briefRating: '微调版（已被 4-8 超越）',       contextLabel: '1M' },
  { id: 'claude-opus-4-7',   name: 'Claude Opus 4.7',    vendor: 'anthropic', capabilities: ['CHAT', 'VISION'], description: 'Opus 4.7，能力微调版',                       briefRating: '微调版（已被 4-8 超越）',       contextLabel: '1M' },
  { id: 'claude-opus-4-8',   name: 'Claude Opus 4.8',    vendor: 'anthropic', capabilities: ['CHAT', 'VISION'], description: 'Opus 4.8 最新微调版，实测状态绿',           briefRating: '选品论证/复杂推理首选',         contextLabel: '1M' },
  { id: 'claude-opus-5',     name: 'Claude Opus 5',      vendor: 'anthropic', capabilities: ['CHAT', 'VISION'], description: 'Opus 5 最新旗舰，比 4 系列贵 20%',          briefRating: '尝鲜旗舰，慎用生产',           contextLabel: '1M' },
  { id: 'claude-sonnet-4',   name: 'Claude Sonnet 4',    vendor: 'anthropic', capabilities: ['CHAT', 'VISION'], description: 'Sonnet 4 主力对话，性价比首选',             briefRating: 'Listing 写作/翻译/改写首选',   contextLabel: '1M' },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5',  vendor: 'anthropic', capabilities: ['CHAT', 'VISION'], description: 'Sonnet 4.5，平衡性能与成本',                 briefRating: '高质量主力，优于 sonnet-4',     contextLabel: '1M' },
  { id: 'claude-sonnet-5',   name: 'Claude Sonnet 5',    vendor: 'anthropic', capabilities: ['CHAT', 'VISION'], description: 'Sonnet 5 最新版',                           briefRating: '最新主力，谨慎尝试',           contextLabel: '1M' },
  // Vidu 3
  { id: 'viduq3',            name: 'Vidu Q3',            vendor: 'vidu', capabilities: ['VIDEO'], description: 'Vidu Q3 主力视频生成',                    briefRating: '标准视频生成',         contextLabel: '1080P/秒' },
  { id: 'viduq3-pro',        name: 'Vidu Q3 Pro',        vendor: 'vidu', capabilities: ['VIDEO'], description: 'Vidu Q3 Pro 高端视频生成',                briefRating: '高质量视频',           contextLabel: '1080P/秒' },
  { id: 'viduq3-turbo',      name: 'Vidu Q3 Turbo',      vendor: 'vidu', capabilities: ['VIDEO'], description: 'Vidu Q3 Turbo 快速视频生成',              briefRating: '快速视频生成',         contextLabel: '1080P/秒' }
]

export const VENDORS: LinduoVendor[] = ['openai', 'google', 'anthropic', 'vidu']
export const CAPABILITIES: LinduoCapability[] = ['IMAGE', 'VIDEO', 'CHAT', 'VISION', 'EMBEDDING', 'AUDIO']

export const VENDOR_META: Record<LinduoVendor, { label: string; color: string; icon: string }> = {
  openai:    { label: 'OpenAI',    color: '#10a37f', icon: '◐' },
  google:    { label: 'Google',    color: '#4285f4', icon: '✦' },
  anthropic: { label: 'Anthropic', color: '#d97706', icon: '✜' },
  vidu:      { label: 'Vidu',      color: '#e11d48', icon: '▶' }
}

export const CAPABILITY_META: Record<LinduoCapability, { label: string; color: string }> = {
  IMAGE:     { label: '生图',     color: '#9333ea' },
  VIDEO:     { label: '视频',     color: '#e11d48' },
  CHAT:      { label: '对话',     color: '#2563eb' },
  VISION:    { label: '视觉',     color: '#0891b2' },
  EMBEDDING: { label: '嵌入',     color: '#475569' },
  AUDIO:     { label: '语音',     color: '#0d9488' }
}

/** 过滤出可用于聊天的模型。M1 启动同步时调用。*/
export function getLinduoChatModels(): LinduoModelEntry[] {
  return LINDUO_MODELS.filter(m => m.capabilities.includes('CHAT'))
}
