import type { LinduoModelPricing, LinduoVendor } from './types.js'

/**
 * 零度API 37 个模型的已知价目（兜底常量）。
 *
 * 数据来源：api000.com/pricing 页面（用户提供初始基线，价格变动时由抓取脚本覆盖）。
 * 所有价格统一以 **美元 / 1M tokens** 为单位；图片/视频模型标注为按张/按秒。
 *
 * 用途：
 * 1. 抓取脚本首次启动 / cookie 失效时，把兜底常量写回 DB，让卡片不空白。
 * 2. 渲染端在 DB 还没数据时也能直接显示价格（fallback → DB 异步覆盖）。
 */

interface FallbackEntry {
  modelId: string
  vendor: LinduoVendor
  inputPrice: number | null
  outputPrice: number | null
  cachePrice?: number | null
  billingType?: 'TOKEN' | 'IMAGE' | 'VIDEO' | 'REQUEST'
  pricePerUnit?: number | null
  unitLabel?: string | null
}

const FALLBACK: FallbackEntry[] = [
  // ── OpenAI 14 ──────────────────────────────────────────
  { modelId: 'gpt-4o',                  vendor: 'openai', inputPrice: 2.5,    outputPrice: 10,    cachePrice: 1.25 },
  { modelId: 'gpt-4o-mini',             vendor: 'openai', inputPrice: 0.15,   outputPrice: 0.6,   cachePrice: 0.075 },
  { modelId: 'gpt-4-turbo',             vendor: 'openai', inputPrice: 10,     outputPrice: 30 },
  { modelId: 'gpt-3.5-turbo',           vendor: 'openai', inputPrice: 0.5,    outputPrice: 1.5 },
  { modelId: 'o1',                      vendor: 'openai', inputPrice: 15,     outputPrice: 60,    cachePrice: 7.5 },
  { modelId: 'o1-mini',                 vendor: 'openai', inputPrice: 3,      outputPrice: 12,    cachePrice: 1.5 },
  { modelId: 'o3-mini',                 vendor: 'openai', inputPrice: 1.1,    outputPrice: 4.4,   cachePrice: 0.55 },
  { modelId: 'gpt-4.1',                 vendor: 'openai', inputPrice: 2,      outputPrice: 8,     cachePrice: 0.5 },
  { modelId: 'gpt-4.1-mini',            vendor: 'openai', inputPrice: 0.4,    outputPrice: 1.6,   cachePrice: 0.1 },
  // 生图模型按张计费
  { modelId: 'gpt-image-1',             vendor: 'openai', inputPrice: null, outputPrice: null, billingType: 'IMAGE', pricePerUnit: 0.04,  unitLabel: '1K' },
  { modelId: 'gpt-image-2',             vendor: 'openai', inputPrice: null, outputPrice: null, billingType: 'IMAGE', pricePerUnit: 0.015, unitLabel: '1K 张' },
  { modelId: 'gpt-image-2-all',         vendor: 'openai', inputPrice: 3,      outputPrice: 18 },
  { modelId: 'dall-e-3',                vendor: 'openai', inputPrice: null, outputPrice: null, billingType: 'IMAGE', pricePerUnit: 0.04,  unitLabel: '1024x1024' },
  { modelId: 'whisper-1',               vendor: 'openai', inputPrice: null, outputPrice: null, billingType: 'REQUEST', pricePerUnit: 0.006, unitLabel: '分钟' },
  { modelId: 'tts-1',                   vendor: 'openai', inputPrice: null, outputPrice: null, billingType: 'REQUEST', pricePerUnit: 0.015, unitLabel: '千字符' },
  { modelId: 'text-embedding-3-large',  vendor: 'openai', inputPrice: 0.13,  outputPrice: null },
  // 5.4–5.6 系列（2026 新品）
  { modelId: 'gpt-5.4',              vendor: 'openai', inputPrice: 0.3125,  outputPrice: 1.875,  cachePrice: 0.03125 },
  { modelId: 'gpt-5.4-mini',         vendor: 'openai', inputPrice: 0.09375, outputPrice: 0.5625, cachePrice: 0.009375 },
  { modelId: 'gpt-5.5',              vendor: 'openai', inputPrice: 0.625,   outputPrice: 4.1667, cachePrice: 0.0625 },
  { modelId: 'gpt-5.6-luna',         vendor: 'openai', inputPrice: 0.05,    outputPrice: 0.3,    cachePrice: 0.005 },
  { modelId: 'gpt-5.6-sol',          vendor: 'openai', inputPrice: 0.625,   outputPrice: 3.75,   cachePrice: 0.05 },
  { modelId: 'gpt-5.6-terra',        vendor: 'openai', inputPrice: 0.3,     outputPrice: 1.8,    cachePrice: 0.03 },
  // ── Google 10 ──────────────────────────────────────────
  { modelId: 'gemini-2.5-pro',                 vendor: 'google', inputPrice: 1.25,   outputPrice: 10 },
  { modelId: 'gemini-2.5-flash',               vendor: 'google', inputPrice: 0.075,  outputPrice: 0.3 },
  { modelId: 'gemini-2.5-flash-image-preview', vendor: 'google', inputPrice: null,  outputPrice: null, billingType: 'IMAGE', pricePerUnit: 0.03, unitLabel: '张' },
  { modelId: 'imagen-4.0',                     vendor: 'google', inputPrice: null,  outputPrice: null, billingType: 'IMAGE', pricePerUnit: 0.04, unitLabel: '张' },
  { modelId: 'gemini-2.0-pro',                 vendor: 'google', inputPrice: 1.25,   outputPrice: 10 },
  { modelId: 'gemini-2.0-flash',               vendor: 'google', inputPrice: 0.1,    outputPrice: 0.4 },
  { modelId: 'gemini-1.5-pro',                 vendor: 'google', inputPrice: 1.25,   outputPrice: 5 },
  { modelId: 'gemini-1.5-flash',               vendor: 'google', inputPrice: 0.075,  outputPrice: 0.3 },
  { modelId: 'text-embedding-004',             vendor: 'google', inputPrice: 0.025,  outputPrice: null },
  { modelId: 'gemini-embedding-exp',           vendor: 'google', inputPrice: 0.025,  outputPrice: null },
  // ── Anthropic 10 ───────────────────────────────────────
  { modelId: 'claude-opus-4-5-20251101',  vendor: 'anthropic', inputPrice: 15,   outputPrice: 75,  cachePrice: 1.5 },
  { modelId: 'claude-sonnet-4-5-20251101',vendor: 'anthropic', inputPrice: 3,    outputPrice: 15,  cachePrice: 0.3 },
  { modelId: 'claude-haiku-4-5-20251101', vendor: 'anthropic', inputPrice: 0.8,  outputPrice: 4,   cachePrice: 0.08 },
  { modelId: 'claude-opus-4-1-20250805',  vendor: 'anthropic', inputPrice: 15,   outputPrice: 75,  cachePrice: 1.5 },
  { modelId: 'claude-sonnet-4-20250514',  vendor: 'anthropic', inputPrice: 3,    outputPrice: 15,  cachePrice: 0.3 },
  { modelId: 'claude-3-7-sonnet',         vendor: 'anthropic', inputPrice: 3,    outputPrice: 15,  cachePrice: 0.3 },
  { modelId: 'claude-3-5-sonnet',         vendor: 'anthropic', inputPrice: 3,    outputPrice: 15,  cachePrice: 0.3 },
  { modelId: 'claude-3-5-haiku',          vendor: 'anthropic', inputPrice: 0.8,  outputPrice: 4,   cachePrice: 0.08 },
  { modelId: 'claude-3-opus',             vendor: 'anthropic', inputPrice: 15,   outputPrice: 75 },
  { modelId: 'claude-3-haiku',            vendor: 'anthropic', inputPrice: 0.25, outputPrice: 1.25 },
  // ── Vidu 3（视频按秒计费） ──────────────────────────────
  { modelId: 'vidu-q1',          vendor: 'vidu', inputPrice: null, outputPrice: null, billingType: 'VIDEO', pricePerUnit: 0.4,  unitLabel: '秒' },
  { modelId: 'vidu-2.0',         vendor: 'vidu', inputPrice: null, outputPrice: null, billingType: 'VIDEO', pricePerUnit: 0.2,  unitLabel: '秒' },
  { modelId: 'vidu-1.5',         vendor: 'vidu', inputPrice: null, outputPrice: null, billingType: 'VIDEO', pricePerUnit: 0.1,  unitLabel: '秒' }
]

/** 把兜底常量格式化为完整的 LinduoModelPricing（用统一 fetchedAt） */
export function fallbackPricingList(fetchedAt: Date = new Date()): LinduoModelPricing[] {
  return FALLBACK.map(entry => ({
    modelId: entry.modelId,
    vendor: entry.vendor,
    inputPrice: entry.inputPrice,
    outputPrice: entry.outputPrice,
    cachePrice: entry.cachePrice ?? null,
    currency: 'USD' as const,
    billingType: entry.billingType ?? 'TOKEN',
    pricePerUnit: entry.pricePerUnit ?? null,
    unitLabel: entry.unitLabel ?? '1M tokens',
    fetchedAt: fetchedAt.toISOString(),
    stale: true
  }))
}

export const FALLBACK_MODEL_IDS = FALLBACK.map(entry => entry.modelId)
