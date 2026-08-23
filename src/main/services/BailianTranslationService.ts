import { buildListingGlossaryDirective, findListingLanguage } from '../../shared/listingLocales'

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

  async translateTexts(texts: string[],targetLanguage='Chinese',domain='跨境电商商品页面。保留品牌名、型号、SKU、货币符号、产品编号和平台专有名称。') {
    if (!this.apiKey) throw new Error('未配置百炼 API Key')
    const unique = [...new Set(texts.map(text => text.trim()).filter(Boolean))]
    const result = new Map<string, string>()
    const pending = unique.filter(text => {
      const cached = this.cache.get(`${targetLanguage}:${text}`)
      if (cached) result.set(text, cached)
      return !cached
    })

    for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
      const batch = pending.slice(offset, offset + BATCH_SIZE)
      const translated = await this.translateBatch(batch,targetLanguage,domain)
      batch.forEach((source, index) => {
        const target = translated[index] || source
        this.cache.set(`${targetLanguage}:${source}`, target)
        result.set(source, target)
      })
    }

    return result
  }

  /**
   * Listing 文案本地化（平台×语言矩阵单元）：按目标语言代码走 qwen-mt，
   * domain 注入术语库硬门禁（命中术语强制按映射翻译）与保留词规则。
   */
  async translateListingTexts(texts: string[], languageCode: string) {
    const language = findListingLanguage(languageCode)
    if (!language) throw new Error(`不支持的 Listing 目标语言：${languageCode}`)
    const glossary = buildListingGlossaryDirective(languageCode)
    const domain = `跨境电商 Listing 文案本地化。按目标市场母语习惯表达，避免直译腔。${glossary}保留品牌名、型号、SKU、货币符号、产品编号和平台专有名称。`
    return this.translateTexts(texts, language.mtName, domain)
  }

  private async translateBatch(texts: string[],targetLanguage:string,domain:string) {
    if (texts.length === 1) return [await this.requestTranslation(texts[0],targetLanguage,domain)]

    const source = texts.map((text, index) => `<translate_${index}>${text}</translate_${index}>`).join('\n')
    const combined = await this.requestTranslation(source,targetLanguage,`${domain} 保留所有 translate_N XML 标签。`)
    const translated = new Map<number, string>()
    const pattern = /<translate_(\d+)>\s*([\s\S]*?)\s*<\/translate_\1>/gi
    for (const match of combined.matchAll(pattern)) translated.set(Number(match[1]), match[2].trim())

    if (translated.size === texts.length) return texts.map((text, index) => translated.get(index) || text)

    // 部分模型响应可能没有保留分段标签；此时串行回退，避免错配网页文案。
    const fallback: string[] = []
    for (const text of texts) fallback.push(await this.requestTranslation(text,targetLanguage,domain))
    return fallback
  }

  private requestTranslation(text: string,targetLanguage:string,domain:string) {
    const scheduled = this.requestQueue.then(() => this.requestWithRetry(text,targetLanguage,domain))
    this.requestQueue = scheduled.then(() => undefined, () => undefined)
    return scheduled
  }

  private async requestWithRetry(text: string,targetLanguage:string,domain:string) {
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
            target_lang: targetLanguage,
            domains: domain
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
