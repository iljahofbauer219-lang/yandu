/**
 * AI 模型目录：移植自 src/main/services/*ImageService.ts / ArkVideoService.ts 的模型元数据。
 * 服务端唯一权威目录，客户端通过 GET /api/ai/models 获取，不再本地维护。
 */

export type AiProviderId = 'bailian' | 'volc' | 'openai' | 'linduo'

export interface AiImageModelProfile {
  id: string
  name: string
  description: string
  /** 单次生成可携带的参照图上限；0 表示纯文生图 */
  maxReferenceImages: number
  provider: AiProviderId
  strengths?: string
  costLabel?: string
}

type ImageModelMeta = Omit<AiImageModelProfile, 'id' | 'provider'>

/** 百炼生图模型（多模态同步：qwen-image* / z-image-turbo；异步轮询：wan2.7*） */
export const BAILIAN_IMAGE_MODELS: Record<string, ImageModelMeta> = {
  'wan2.7-image-pro': { name: '万相 2.7 Pro', description: '高质量商品图、文字与品牌色控制，参照图上限8张', maxReferenceImages: 8 },
  'wan2.7-image': { name: '万相 2.7', description: '质量与生成速度平衡，参照图上限8张', maxReferenceImages: 8 },
  'qwen-image-2.0-pro': { name: '千问 Image 2.0 Pro', description: '纯文生图，文字渲染与复杂指令表现更强；不支持参照商品原图', maxReferenceImages: 0 },
  'qwen-image-2.0': { name: '千问 Image 2.0', description: '纯文生图，生成速度快；不支持参照商品原图', maxReferenceImages: 0 },
  'qwen-image-edit-plus': { name: '千问 Image Edit Plus', description: '多图参照编辑，适合保持商品结构与材质', maxReferenceImages: 3 },
  'qwen-image-edit-max': { name: '千问 Image Edit Max', description: '高保真多图编辑，适合复杂商品细节', maxReferenceImages: 3 },
  'z-image-turbo': { name: 'Z-Image Turbo', description: '快速低成本，适合写实商品图', maxReferenceImages: 1 }
}

/** 火山方舟 Seedream 生图模型（OpenAI 兼容 images/generations 接口） */
export const VOLC_IMAGE_MODELS: Record<string, ImageModelMeta> = {
  'doubao-seedream-5-0-pro-260628': {
    name: 'Seedream 5.0 Pro',
    description: '火山方舟旗舰生图模型，商品一致性与细节表现俱佳，参照图上限10张',
    maxReferenceImages: 10,
    strengths: '主图9·细节9·痛点9·场景9',
    costLabel: '¥0.30/张'
  },
  'doubao-seedream-5-0-260128': {
    name: 'Seedream 5.0 Lite',
    description: '火山方舟高性价比生图模型，质量接近 Pro 且成本更低，参照图上限10张',
    maxReferenceImages: 10,
    strengths: '主图9·细节9·痛点9·场景9',
    costLabel: '¥0.22/张'
  }
}

/** OpenAI 生图模型：首版仅支持文生图（generations JSON 接口不接受参照图 URL） */
export const OPENAI_IMAGE_MODELS: Record<string, ImageModelMeta> = {
  'gpt-image-2': {
    name: 'GPT-Image-2',
    description: 'OpenAI 生图模型，痛点表达与创意构图突出；当前仅支持文生图，不支持参照商品原图',
    maxReferenceImages: 0,
    strengths: '主图8·细节6·痛点10·场景7',
    costLabel: '¥0.04-1.5/张'
  }
}

/** 零度API（api000.com）生图模型：与主进程 LinduoImageService 保持一致。模型 id 以 api000.com /v1/models 探测返回为准。 */
export const LINDUO_IMAGE_MODELS: Record<string, ImageModelMeta> = {
  'gpt-image-1': {
    name: 'GPT-Image-1',
    description: 'OpenAI gpt-image-1（经零度API 代理），纯文生图，文字渲染与细节表现俱佳',
    maxReferenceImages: 0,
    strengths: '文字渲染·细节·创意构图',
    costLabel: '按量计费'
  },
  'gemini-2.5-flash-image-preview': {
    name: 'Gemini 2.5 Flash Image',
    description: 'Google Gemini 2.5 Flash 多模态生图（经零度API 代理），支持参照图',
    maxReferenceImages: 4,
    strengths: '多模态·速度快·参照图',
    costLabel: '按量计费'
  },
  'imagen-4.0': {
    name: 'Imagen 4.0',
    description: 'Google Imagen 4.0（经零度API 代理），高质量商品图与品牌色控制',
    maxReferenceImages: 0,
    strengths: '高质量·品牌色·主图',
    costLabel: '按量计费'
  }
}

const IMAGE_MODEL_TABLE: Array<{ provider: AiProviderId; models: Record<string, ImageModelMeta> }> = [
  { provider: 'bailian', models: BAILIAN_IMAGE_MODELS },
  { provider: 'volc', models: VOLC_IMAGE_MODELS },
  { provider: 'openai', models: OPENAI_IMAGE_MODELS },
  { provider: 'linduo', models: LINDUO_IMAGE_MODELS }
]

export function findImageModel(modelId: string): AiImageModelProfile | null {
  for (const { provider, models } of IMAGE_MODEL_TABLE) {
    const meta = models[modelId]
    if (meta) return { id: modelId, provider, ...meta }
  }
  return null
}

export function imageModelsOf(provider: AiProviderId): AiImageModelProfile[] {
  const entry = IMAGE_MODEL_TABLE.find(item => item.provider === provider)
  if (!entry) return []
  return Object.entries(entry.models).map(([id, meta]) => ({ id, provider, ...meta }))
}

/** 方舟视频模型目录（生成类任务；默认模型由 ARK_VIDEO_MODEL 指定） */
export const VIDEO_MODEL_CATALOG = [
  { id: 'doubao-seedance-2-0-260128', label: 'Seedance 2.0 · 高质量' },
  { id: 'doubao-seedance-2-0-fast-260128', label: 'Seedance 2.0 Fast · 日常推荐' },
  { id: 'doubao-seedance-2-0-mini-260615', label: 'Seedance 2.0 Mini · 经济预览' }
] as const

/** 百炼机器翻译模型（chat/completions + translation_options） */
export const TRANSLATE_MODEL = 'qwen-mt-flash'
