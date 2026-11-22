/**
 * 13 生图模型「适用场景」标注守卫（2026-11-20 定稿文案逐字）。
 * - scenario 为独立新字段：13 模型逐字命中定稿，其余模型（千问 Edit Plus/Max）不标注
 * - strengths / maxReferenceImages / costLabel 一律不动（strengths 参与默认推荐匹配）
 * 断言走各厂商 connection() 真实输出，非源码字符串。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BailianImageService } from '../BailianImageService'
import { VolcImageService } from '../VolcImageService'
import { OpenAIImageService } from '../OpenAIImageService'
import { LinduoImageService } from '../LinduoImageService'
import { createLinduoNoChannelCache } from '../../../shared/linduoImageFallback'
import type { ImageModelProfile } from '../../../shared/contracts'

vi.mock('electron', () => ({
  session: { fromPartition: () => ({ setProxy: async () => undefined, fetch: async () => new Response('{}') }) },
  nativeImage: {
    createFromBuffer: () => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }), toBitmap: () => Buffer.alloc(0) }),
    createFromBitmap: () => ({ toJPEG: () => Buffer.alloc(0) })
  }
}))

afterEach(() => vi.unstubAllGlobals())

const BAILIAN_IDS = ['wan2.7-image-pro', 'wan2.7-image', 'qwen-image-2.0-pro', 'qwen-image-2.0', 'qwen-image-edit-plus', 'qwen-image-edit-max', 'z-image-turbo']

function stubModelsFetch(ids: string[]) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: ids.map(id => ({ id })) }), { status: 200 })))
}

async function bailianModels(): Promise<ImageModelProfile[]> {
  stubModelsFetch(BAILIAN_IDS)
  return (await new BailianImageService('test-key', 'https://mock-bailian.test/api/v1').connection()).models
}

async function linduoModels(): Promise<ImageModelProfile[]> {
  stubModelsFetch([])
  return (await new LinduoImageService('test-key', 'https://mock-api000.test/v1', createLinduoNoChannelCache()).connection()).models
}

/** 定稿 13 条（按下拉顺序，逐字含句号）＋不得变动的既有元数据 */
const EXPECTED: Array<{ provider: string; id: string; scenario: string; strengths: string; maxReferenceImages: number; costLabel: string }> = [
  { provider: 'bailian', id: 'wan2.7-image-pro', scenario: '品牌一致性要求高的主图与细节图。', strengths: '商品主图·细节还原·品牌色控制', maxReferenceImages: 8, costLabel: '¥0.16/张' },
  { provider: 'bailian', id: 'wan2.7-image', scenario: '主图与细节图的日常批量出图场景。', strengths: '商品主图·质量速度均衡', maxReferenceImages: 8, costLabel: '¥0.08/张' },
  { provider: 'bailian', id: 'qwen-image-2.0-pro', scenario: '带文字标语的痛点海报与宣传图。', strengths: '文字渲染·复杂指令·纯文生图', maxReferenceImages: 0, costLabel: '¥0.20/张' },
  { provider: 'bailian', id: 'qwen-image-2.0', scenario: '痛点与场景概念图的快速批量出图。', strengths: '快速生成·纯文生图', maxReferenceImages: 0, costLabel: '¥0.10/张' },
  { provider: 'bailian', id: 'z-image-turbo', scenario: '写实风格主图的低成本批量出图场景。', strengths: '极速低成本·写实商品主图', maxReferenceImages: 1, costLabel: '¥0.04/张' },
  { provider: 'volc', id: 'doubao-seedream-5-0-pro-260628', scenario: '主图、细节、痛点、场景全类目出图。', strengths: '商品主图·细节还原·全场景适用', maxReferenceImages: 10, costLabel: '¥0.30/张' },
  { provider: 'volc', id: 'doubao-seedream-5-0-260128', scenario: '全类目高频次、大批量的出图场景。', strengths: '高性价比·质量接近Pro·速度快', maxReferenceImages: 10, costLabel: '¥0.22/张' },
  { provider: 'openai', id: 'gpt-image-2', scenario: '痛点表达图与英文创意场景图。', strengths: '痛点表达·创意构图·英文场景', maxReferenceImages: 0, costLabel: '¥0.04-1.5/张' },
  { provider: 'linduo', id: 'gpt-image-1', scenario: '带文字的创意构图与细节海报。', strengths: '文字渲染·细节·创意构图', maxReferenceImages: 0, costLabel: '按量计费' },
  { provider: 'linduo', id: 'gemini-2.5-flash-image-preview', scenario: '带参照图的场景生成与图像编辑。', strengths: '多模态·速度快·参照图', maxReferenceImages: 4, costLabel: '按量计费' },
  { provider: 'linduo', id: 'imagen-4.0', scenario: '品牌色控制要求高的主图出图。', strengths: '高质量·品牌色·主图', maxReferenceImages: 0, costLabel: '按量计费' },
  { provider: 'linduo', id: 'nano-banana-2', scenario: '带商品参照图的场景生成与图像编辑。', strengths: '商品参照·图像编辑·场景生成', maxReferenceImages: 4, costLabel: '$0.03–0.045/张' },
  { provider: 'linduo', id: 'nano-banana-pro', scenario: '精细构图主图与高要求图像编辑。', strengths: '商品参照·精细构图·图像编辑', maxReferenceImages: 4, costLabel: '$0.04–0.05/张' }
]

async function modelsOf(provider: string): Promise<ImageModelProfile[]> {
  if (provider === 'bailian') return bailianModels()
  if (provider === 'volc') return (await new VolcImageService('test-key', '').connection()).models
  if (provider === 'openai') return (await new OpenAIImageService('test-key', '').connection()).models
  return linduoModels()
}

describe.each(['bailian', 'volc', 'openai', 'linduo'])('%s 服务商场景标注', provider => {
  const rows = EXPECTED.filter(row => row.provider === provider)

  it.each(rows)('$id 适用场景逐字命中定稿', async row => {
    const models = await modelsOf(provider)
    const model = models.find(item => item.id === row.id)
    expect(model).toBeDefined()
    expect(model!.scenario).toBe(row.scenario)
  })

  it.each(rows)('$id strengths 保持原值不被场景文案覆盖', async row => {
    const models = await modelsOf(provider)
    expect(models.find(item => item.id === row.id)!.strengths).toBe(row.strengths)
  })

  it.each(rows)('$id 参照上限与成本标签不动', async row => {
    const models = await modelsOf(provider)
    const model = models.find(item => item.id === row.id)!
    expect(model.maxReferenceImages).toBe(row.maxReferenceImages)
    expect(model.costLabel).toBe(row.costLabel)
  })
})

describe('未列入截图 13 模型的百炼编辑款不标注', () => {
  it.each(['qwen-image-edit-plus', 'qwen-image-edit-max'])('%s 无 scenario 字段值', async id => {
    const models = await bailianModels()
    const model = models.find(item => item.id === id)
    expect(model).toBeDefined()
    expect(model!.scenario).toBeUndefined()
  })
})