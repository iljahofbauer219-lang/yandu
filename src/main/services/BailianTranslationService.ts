type TranslationPayload = {
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
  message?: string
}

const BATCH_SIZE = 8
const MIN_REQUEST_INTERVAL_MS = 1_100
const RATE_LIMIT_RETRY_DELAYS_MS = [2_000, 5_000, 10_000]

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

export class BailianTranslationService {
  private readonly cache = new Map<string, string>()
  private requestQueue: Promise<void> = Promise.resolve()
  private lastRequestStartedAt = 0

  constructor(private readonly apiKey: string, private readonly baseUrl: string) {}

  async translateTexts(texts: string[]) {
    if (!this.apiKey) throw new Error('未配置百炼 API Key')
    const unique = [...new Set(texts.map(text => text.trim()).filter(Boolean))]
    const result = new Map<string, string>()
    const pending = unique.filter(text => {
      const cached = this.cache.get(text)
      if (cached) result.set(text, cached)
      return !cached
    })

    for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
      const batch = pending.slice(offset, offset + BATCH_SIZE)
      const translated = await this.translateBatch(batch)
      batch.forEach((source, index) => {
        const target = translated[index] || source
        this.cache.set(source, target)
        result.set(source, target)
      })
    }

    return result
  }

  private async translateBatch(texts: string[]) {
    if (texts.length === 1) return [await this.requestTranslation(texts[0])]

    const source = texts.map((text, index) => `<translate_${index}>${text}</translate_${index}>`).join('\n')
    const combined = await this.requestTranslation(source)
    const translated = new Map<number, string>()
    const pattern = /<translate_(\d+)>\s*([\s\S]*?)\s*<\/translate_\1>/gi
    for (const match of combined.matchAll(pattern)) translated.set(Number(match[1]), match[2].trim())

    if (translated.size === texts.length) return texts.map((text, index) => translated.get(index) || text)

    // 部分模型响应可能没有保留分段标签；此时串行回退，避免错配网页文案。
    const fallback: string[] = []
    for (const text of texts) fallback.push(await this.requestTranslation(text))
    return fallback
  }

  private requestTranslation(text: string) {
    const scheduled = this.requestQueue.then(() => this.requestWithRetry(text))
    this.requestQueue = scheduled.then(() => undefined, () => undefined)
    return scheduled
  }

  private async requestWithRetry(text: string) {
    for (let attempt = 0; ; attempt += 1) {
      const waitForRateSlot = Math.max(0, this.lastRequestStartedAt + MIN_REQUEST_INTERVAL_MS - Date.now())
      if (waitForRateSlot) await delay(waitForRateSlot)
      this.lastRequestStartedAt = Date.now()

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'qwen-mt-flash',
          messages: [{ role: 'user', content: text }],
          translation_options: {
            source_lang: 'auto',
            target_lang: 'Chinese',
            domains: '跨境电商商品页面。保留品牌名、型号、SKU、货币符号、产品编号、平台专有名称以及所有 translate_N XML 标签。'
          }
        })
      })
      const payload = await response.json() as TranslationPayload
      if (response.ok) return payload.choices?.[0]?.message?.content?.trim() || text

      const message = payload.error?.message || payload.message || `HTTP ${response.status}`
      const rateLimited = response.status === 429 || /rate limit|too many requests|request rate/i.test(message)
      if (rateLimited && attempt < RATE_LIMIT_RETRY_DELAYS_MS.length) {
        await delay(RATE_LIMIT_RETRY_DELAYS_MS[attempt])
        continue
      }
      if (rateLimited) throw new Error('翻译服务请求过于频繁，百炼正在限流，请稍后再试')
      if (/quota|billing|balance/i.test(message)) throw new Error('百炼翻译额度不足，请检查模型额度或账户余额')
      throw new Error(`网页翻译失败：${message}`)
    }
  }
}
