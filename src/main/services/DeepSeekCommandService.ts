export type IntelligentCommand =
  | { action: 'collect'; platform: 'OZON' | '1688'; keyword: string; maxProducts: number }
  | { action: 'status' }
  | { action: 'help' }
  | { action: 'unknown'; clarification: string }

interface DeepSeekResponse {
  choices?: Array<{ message?: { content?: string | null } }>
  error?: { message?: string }
}

export class DeepSeekCommandService {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.deepseek.com',
    private readonly model = 'deepseek-v4-flash'
  ) {}

  get enabled() { return Boolean(this.apiKey) }

  async understand(text: string): Promise<IntelligentCommand> {
    if (!this.apiKey) return { action: 'unknown', clarification: '智能指令理解未配置。' }
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        max_tokens: 220,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `你是跨境电商任务指令解析器。将用户的中英文自然语言转换为 JSON，不要执行任务。
只允许以下 action：collect、status、help、unknown。
可用采集平台只有 OZON 和 1688。用户说“俄罗斯平台”、“欧众”或“Ozon”都映射为 OZON；阿里巴巴批发、国内货源可在明确语境下映射为 1688。
采集数量未说时默认 50；OZON 限制 1-500，1688 限制 1-300。
不要猜测未说的平台或商品关键词；缺失时返回 unknown 并用 clarification 提一个简短问题。
输出 JSON 格式示例：
{"action":"collect","platform":"OZON","keyword":"家用电器","maxProducts":100}
{"action":"status"}
{"action":"help"}
{"action":"unknown","clarification":"请告诉我要从 Ozon 还是 1688 采集。"}`
          },
          { role: 'user', content: text }
        ]
      })
    })
    const payload = await response.json() as DeepSeekResponse
    if (!response.ok) throw new Error(payload.error?.message || `DeepSeek 请求失败：${response.status}`)
    const content = payload.choices?.[0]?.message?.content
    if (!content) throw new Error('DeepSeek 未返回指令解析结果')
    return this.validate(JSON.parse(content) as Record<string, unknown>)
  }

  private validate(value: Record<string, unknown>): IntelligentCommand {
    if (value.action === 'status' || value.action === 'help') return { action: value.action }
    if (value.action === 'collect') {
      const platform = value.platform === 'OZON' || value.platform === '1688' ? value.platform : null
      const keyword = typeof value.keyword === 'string' ? value.keyword.normalize('NFKC').trim().slice(0, 120) : ''
      if (!platform || !keyword) return { action: 'unknown', clarification: '请告诉我采集平台（Ozon 或 1688）和商品关键词。' }
      const requested = Number(value.maxProducts)
      const maximum = platform === 'OZON' ? 500 : 300
      const maxProducts = Math.max(1, Math.min(Number.isFinite(requested) ? Math.round(requested) : 50, maximum))
      return { action: 'collect', platform, keyword, maxProducts }
    }
    const clarification = typeof value.clarification === 'string' && value.clarification.trim()
      ? value.clarification.trim().slice(0, 200)
      : '请告诉我要从 Ozon 还是 1688 采集、商品关键词和数量。'
    return { action: 'unknown', clarification }
  }
}
