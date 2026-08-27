import type { LinduoModelPricing, LinduoVendor } from './types.js'

/**
 * 零度API 37 个模型的已知价目（兜底常量）。
 *
 * 数据来源：api000.com/pricing 页面（用户提供 2026-08-26 截图，价格变动时由抓取脚本覆盖）。
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
  { modelId: 'gpt-4o',             vendor: 'openai', inputPrice: 2.5,     outputPrice: 10,    cachePrice: 1.25 },
  { modelId: 'gpt-4o-2024-05-13',  vendor: 'openai', inputPrice: 2.5,     outputPrice: 7.5,   cachePrice: 0.25 },
  { modelId: 'gpt-4o-mini',        vendor: 'openai', inputPrice: 0.15,    outputPrice: 0.6,   cachePrice: 0.075 },
  { modelId: 'gpt-5',              vendor: 'openai', inputPrice: 0.15625, outputPrice: 1.25,  cachePrice: 0.015625 },
  { modelId: 'gpt-5-mini',         vendor: 'openai', inputPrice: 0.05,    outputPrice: 0.4,   cachePrice: 0.005 },
  { modelId: 'gpt-5.3-codex',      vendor: 'openai', inputPrice: 0.21875, outputPrice: 1.75,  cachePrice: 0.02 },
  { modelId: 'gpt-5.4',            vendor: 'openai', inputPrice: 0.3125,  outputPrice: 1.875, cachePrice: 0.03125 },
  { modelId: 'gpt-5.4-mini',       vendor: 'openai', inputPrice: 0.09375, outputPrice: 0.5625,cachePrice: 0.009375 },
  { modelId: 'gpt-5.5',            vendor: 'openai', inputPrice: 0.625,   outputPrice: 4.1667,cachePrice: 0.0625 },
  { modelId: 'gpt-5.6-luna',       vendor: 'openai', inputPrice: 0.05,    outputPrice: 0.3,   cachePrice: 0.005 },
  { modelId: 'gpt-5.6-sol',        vendor: 'openai', inputPrice: 0.625,   outputPrice: 3.75,  cachePrice: 0.05 },
  { modelId: 'gpt-5.6-terra',      vendor: 'openai', inputPrice: 0.3,     outputPrice: 1.8,   cachePrice: 0.03 },
  // 生图：1K 像素 $0.015/张、2K $0.025、4K $0.03
  { modelId: 'gpt-image-2',        vendor: 'openai', inputPrice: null, outputPrice: null, billingType: 'IMAGE', pricePerUnit: 0.015, unitLabel: '1K 张' },
  { modelId: 'gpt-image-2-all',    vendor: 'openai', inputPrice: 3,      outputPrice: 18 },

  // ── Google 10 ──────────────────────────────────────────
  { modelId: 'gemini-2.5-flash',          vendor: 'google', inputPrice: 0.15,  outputPrice: 1.25 },
  { modelId: 'gemini-2.5-flash-lite',     vendor: 'google', inputPrice: 0.05,  outputPrice: 0.2 },
  { modelId: 'gemini-2.5-pro',            vendor: 'google', inputPrice: 0.625, outputPrice: 5 },
  { modelId: 'gemini-3-flash-preview',    vendor: 'google', inputPrice: 0.25,  outputPrice: 1.5,   cachePrice: 0.025 },
  { modelId: 'gemini-3-pro-preview',      vendor: 'google', inputPrice: 1,     outputPrice: 6,     cachePrice: 0.1 },
  { modelId: 'gemini-3.1-flash',          vendor: 'google', inputPrice: 0.45,  outputPrice: 2.7 },
  { modelId: 'gemini-3.1-flash-lite',     vendor: 'google', inputPrice: 0.45,  outputPrice: 2.7 },
  { modelId: 'gemini-3.1-pro-preview',    vendor: 'google', inputPrice: 1,     outputPrice: 6,     cachePrice: 0.1 },
  // 生图：1K 像素 $0.02/张、2K $0.03、4K $0.04
  { modelId: 'nano-banana-2',             vendor: 'google', inputPrice: null, outputPrice: null, billingType: 'IMAGE', pricePerUnit: 0.02, unitLabel: '1K 张' },
  { modelId: 'nano-banana-pro',           vendor: 'google', inputPrice: null, outputPrice: null, billingType: 'IMAGE', pricePerUnit: 0.03, unitLabel: '1K 张' },

  // ── Anthropic 10 ───────────────────────────────────────
  { modelId: 'claude-fable-5',         vendor: 'anthropic', inputPrice: 1.875, outputPrice: 9.375, cachePrice: 0.1875 },
  { modelId: 'claude-haiku-4-5',       vendor: 'anthropic', inputPrice: 0.125, outputPrice: 0.625, cachePrice: 0.0125 },
  { modelId: 'claude-opus-4-5',        vendor: 'anthropic', inputPrice: 0.625, outputPrice: 3.125, cachePrice: 0.0625 },
  { modelId: 'claude-opus-4-6',        vendor: 'anthropic', inputPrice: 0.625, outputPrice: 3.125, cachePrice: 0.0625 },
  { modelId: 'claude-opus-4-7',        vendor: 'anthropic', inputPrice: 0.625, outputPrice: 3.125, cachePrice: 0.0625 },
  { modelId: 'claude-opus-4-8',        vendor: 'anthropic', inputPrice: 0.625, outputPrice: 3.125, cachePrice: 0.0625 },
  { modelId: 'claude-opus-5',          vendor: 'anthropic', inputPrice: 0.75,  outputPrice: 3.75,  cachePrice: 0.075 },
  { modelId: 'claude-sonnet-4',        vendor: 'anthropic', inputPrice: 0.375, outputPrice: 1.875, cachePrice: 0.0375 },
  { modelId: 'claude-sonnet-4-5',      vendor: 'anthropic', inputPrice: 0.375, outputPrice: 1.875, cachePrice: 0.0375 },
  { modelId: 'claude-sonnet-5',        vendor: 'anthropic', inputPrice: 0.375, outputPrice: 1.875, cachePrice: 0.0375 },

  // ── Vidu 3（视频按秒计费） ──────────────────────────────
  { modelId: 'viduq3',         vendor: 'vidu', inputPrice: null, outputPrice: null, billingType: 'VIDEO', pricePerUnit: 0.05,  unitLabel: '秒' },
  { modelId: 'viduq3-pro',     vendor: 'vidu', inputPrice: null, outputPrice: null, billingType: 'VIDEO', pricePerUnit: 0.08,  unitLabel: '秒' },
  { modelId: 'viduq3-turbo',   vendor: 'vidu', inputPrice: null, outputPrice: null, billingType: 'VIDEO', pricePerUnit: 0.045, unitLabel: '秒' }
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
