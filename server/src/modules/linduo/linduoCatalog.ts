// 零度API 37 个模型目录（OpenAI 14 / Google 10 / Anthropic 10 / Vidu 3）。
//
// 这是 src/shared/linduoCatalog.ts 的服务端镜像：
// - 服务端 tsconfig 的 rootDir=.  + include=[src, scripts] 不允许跨目录 import ../shared
// - 现有模块（types.ts、pricing-fallback.ts）都采用「模块本地化数据」模式
// - 启动时 chat-models-sync.ts 会跟 DB LinduoChatModel 表对账；
//   若本文件与 src/shared/linduoCatalog.ts 出现 drift，sync 会按 INSERT/UPDATE/enabled=false 自动修正
//
// 修改时务必同步两边。

export type LinduoCapability = 'IMAGE' | 'VIDEO' | 'CHAT' | 'VISION' | 'EMBEDDING' | 'AUDIO'

export type LinduoVendor = 'openai' | 'google' | 'anthropic' | 'vidu'

export interface LinduoModelEntry {
  id: string
  name: string
  vendor: LinduoVendor
  capabilities: LinduoCapability[]
  description: string
  contextLabel?: string
  wiredToImageStudio?: boolean
}

export const LINDUO_MODELS: LinduoModelEntry[] = [
  // OpenAI 14
  { id: 'gpt-4o',                  name: 'GPT-4o',                  vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: 'OpenAI 多模态旗舰，对话与视觉理解均突出',         contextLabel: '128K' },
  { id: 'gpt-4o-mini',             name: 'GPT-4o mini',             vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: '轻量多模态，成本低、速度快',                       contextLabel: '128K' },
  { id: 'gpt-4-turbo',             name: 'GPT-4 Turbo',             vendor: 'openai',    capabilities: ['CHAT'],                  description: '高上下文对话模型，复杂指令表现稳定',               contextLabel: '128K' },
  { id: 'gpt-3.5-turbo',           name: 'GPT-3.5 Turbo',           vendor: 'openai',    capabilities: ['CHAT'],                  description: '经典对话模型，性价比首选',                         contextLabel: '16K' },
  { id: 'o1',                      name: 'o1',                       vendor: 'openai',    capabilities: ['CHAT'],                  description: 'OpenAI 推理模型，链式思考能力强',                   contextLabel: '200K' },
  { id: 'o1-mini',                 name: 'o1 mini',                  vendor: 'openai',    capabilities: ['CHAT'],                  description: '轻量推理模型，速度更快',                           contextLabel: '128K' },
  { id: 'o3-mini',                 name: 'o3 mini',                  vendor: 'openai',    capabilities: ['CHAT'],                  description: '高性价比推理模型，复杂任务表现优',                 contextLabel: '200K' },
  { id: 'gpt-4.1',                 name: 'GPT-4.1',                  vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: 'GPT-4 系列升级，编码与指令遵循更强',               contextLabel: '1M' },
  { id: 'gpt-4.1-mini',            name: 'GPT-4.1 mini',             vendor: 'openai',    capabilities: ['CHAT', 'VISION'],        description: '轻量 GPT-4.1，速度与成本平衡',                     contextLabel: '1M' },
  { id: 'gpt-image-1',             name: 'GPT-Image-1',              vendor: 'openai',    capabilities: ['IMAGE'],                 description: 'OpenAI 图像生成模型，文字渲染与细节突出',          wiredToImageStudio: true },
  { id: 'dall-e-3',                name: 'DALL·E 3',                 vendor: 'openai',    capabilities: ['IMAGE'],                 description: 'OpenAI 文生图模型，创意构图表现强',                 wiredToImageStudio: true },
  { id: 'whisper-1',               name: 'Whisper',                  vendor: 'openai',    capabilities: ['AUDIO'],                 description: '语音转文字模型，多语种支持',                       contextLabel: '25MB' },
  { id: 'tts-1',                   name: 'TTS-1',                    vendor: 'openai',    capabilities: ['AUDIO'],                 description: 'OpenAI 文字转语音模型，6 种音色',                   contextLabel: '4096' },
  { id: 'text-embedding-3-large',  name: 'Embedding 3 Large',        vendor: 'openai',    capabilities: ['EMBEDDING'],             description: 'OpenAI 向量嵌入大模型，3072 维',                    contextLabel: '8K' },
  // Google 10
  { id: 'gemini-2.5-pro',                 name: 'Gemini 2.5 Pro',                 vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: 'Google 旗舰多模态模型，推理与代码表现强',         contextLabel: '1M' },
  { id: 'gemini-2.5-flash',               name: 'Gemini 2.5 Flash',               vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '轻量多模态，速度与成本平衡',                       contextLabel: '1M' },
  { id: 'gemini-2.5-flash-image-preview', name: 'Gemini 2.5 Flash Image',         vendor: 'google',    capabilities: ['IMAGE'],                 description: 'Google 多模态生图，支持参照图',                     wiredToImageStudio: true },
  { id: 'imagen-4.0',                     name: 'Imagen 4.0',                     vendor: 'google',    capabilities: ['IMAGE'],                 description: 'Google 旗舰生图模型，品牌色与主图表现优',         wiredToImageStudio: true },
  { id: 'gemini-2.0-pro',                 name: 'Gemini 2.0 Pro',                 vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '上一代 Pro 多模态模型',                            contextLabel: '2M' },
  { id: 'gemini-2.0-flash',               name: 'Gemini 2.0 Flash',               vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '上一代 Flash 模型，结构化输出稳定',                 contextLabel: '1M' },
  { id: 'gemini-1.5-pro',                 name: 'Gemini 1.5 Pro',                 vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '经典 Gemini Pro 长上下文模型',                      contextLabel: '2M' },
  { id: 'gemini-1.5-flash',               name: 'Gemini 1.5 Flash',               vendor: 'google',    capabilities: ['CHAT', 'VISION'],        description: '轻量 Gemini，延迟更低',                             contextLabel: '1M' },
  { id: 'text-embedding-004',             name: 'Embedding 004',                  vendor: 'google',    capabilities: ['EMBEDDING'],             description: 'Google 文本嵌入模型，768 维',                       contextLabel: '2K' },
  { id: 'gemini-embedding-exp',           name: 'Gemini Embedding (实验)',        vendor: 'google',    capabilities: ['EMBEDDING'],             description: 'Gemini 系列嵌入实验版',                             contextLabel: '8K' },
  // Anthropic 10
  { id: 'claude-opus-4-5-20251101',  name: 'Claude Opus 4.5',          vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: 'Anthropic 顶级模型，复杂任务首选',                   contextLabel: '200K' },
  { id: 'claude-sonnet-4-5-20251101',name: 'Claude Sonnet 4.5',        vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '平衡性能与成本的 Anthropic 主力模型',               contextLabel: '200K' },
  { id: 'claude-haiku-4-5-20251101', name: 'Claude Haiku 4.5',         vendor: 'anthropic', capabilities: ['CHAT'],                  description: '轻量 Claude，速度与成本最优',                       contextLabel: '200K' },
  { id: 'claude-opus-4-1-20250805',  name: 'Claude Opus 4.1',          vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '前代 Opus，适合高精度长文档分析',                   contextLabel: '200K' },
  { id: 'claude-sonnet-4-20250514',  name: 'Claude Sonnet 4',          vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '前代 Sonnet，工具调用稳定',                         contextLabel: '200K' },
  { id: 'claude-3-7-sonnet',         name: 'Claude 3.7 Sonnet',        vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '混合推理模式，可控思考深度',                       contextLabel: '200K' },
  { id: 'claude-3-5-sonnet',         name: 'Claude 3.5 Sonnet',        vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '前代主力 Sonnet，编程与写作表现优',                 contextLabel: '200K' },
  { id: 'claude-3-5-haiku',          name: 'Claude 3.5 Haiku',         vendor: 'anthropic', capabilities: ['CHAT'],                  description: '轻量 Claude，适合日常对话',                         contextLabel: '200K' },
  { id: 'claude-3-opus',             name: 'Claude 3 Opus',            vendor: 'anthropic', capabilities: ['CHAT', 'VISION'],        description: '经典 Opus，长文档与复杂推理',                       contextLabel: '200K' },
  { id: 'claude-3-haiku',            name: 'Claude 3 Haiku',           vendor: 'anthropic', capabilities: ['CHAT'],                  description: '前代轻量模型，低延迟低成本',                       contextLabel: '200K' },
  // Vidu 3
  { id: 'vidu-q1',          name: 'Vidu Q1',           vendor: 'vidu',      capabilities: ['VIDEO'],  description: 'Vidu 旗舰视频生成模型，1080P 5 秒',          contextLabel: '5s/1080P' },
  { id: 'vidu-2.0',         name: 'Vidu 2.0',          vendor: 'vidu',      capabilities: ['VIDEO'],  description: 'Vidu 主力视频生成模型，主体一致性突出',       contextLabel: '4s/720P' },
  { id: 'vidu-1.5',         name: 'Vidu 1.5',          vendor: 'vidu',      capabilities: ['VIDEO'],  description: 'Vidu 入门视频生成模型，性价比首选',           contextLabel: '4s/540P' }
] as LinduoModelEntry[]

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
