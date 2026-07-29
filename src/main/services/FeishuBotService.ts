import * as Lark from '@larksuiteoapi/node-sdk'
import type { SelectionTask, SelectionTaskDraft } from '../../shared/contracts'
import { DeepSeekCommandService, type IntelligentCommand } from './DeepSeekCommandService'

interface BotTaskResult { task: SelectionTask; collected: number; selected: number }
interface Dependencies {
  createAndRunTask: (draft: SelectionTaskDraft) => Promise<BotTaskResult>
  getLatestTask: () => SelectionTask | null
}
interface MessageEvent {
  sender: { sender_type: string; sender_id?: { open_id?: string } }
  message: {
    message_id: string; message_type: string; content: string
    mentions?: Array<{ key: string }>
  }
}

const HELP = [
  '可用指令：',
  '采集 Ozon <关键词> [数量]  例：采集 Ozon 无线吸尘器 30',
  '采集 1688 <关键词> [数量]  例：采集 1688 无线吸尘器 30',
  '状态', '帮助'
].join('\n')

export function parseNaturalCollectionCommand(text: string): IntelligentCommand | null {
  if (!/(采集|搜索|找|搜|抓取|帮我|去)/i.test(text)) return null
  const platform = /(?:ozon|欧众|俄罗斯平台)/i.test(text) ? 'OZON' : /(?:1688|阿里巴巴批发|国内货源)/i.test(text) ? '1688' : null
  if (!platform) return null
  const quantityMatch = text.match(/(\d{1,3})\s*(?:个|件|条|款|份)?/)
  const maximum = platform === 'OZON' ? 500 : 300
  const maxProducts = Math.max(1, Math.min(Number(quantityMatch?.[1] || 50), maximum))
  const keyword = text
    .replace(/(?:ozon|欧众|俄罗斯平台|1688|阿里巴巴批发|国内货源)/ig, ' ')
    .replace(/(?:帮我|请|麻烦|去|上|里|从|给我|采集|搜索|找一下|找|搜|抓取|产品|商品)/g, ' ')
    .replace(/\d{1,3}\s*(?:个|件|条|款|份)?/g, ' ')
    .replace(/[，,。.!！?？]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return keyword ? { action: 'collect', platform, keyword: keyword.slice(0, 120), maxProducts } : null
}

function createDraft(platform: 'OZON' | '1688', keyword: string, maxProducts: number): SelectionTaskDraft {
  return {
    selectionMode: platform === '1688' ? 'FORWARD_SUPPLY' : 'REVERSE_MARKET',
    marketplacePlatform: 'OZON', marketplaceAccountId: 'ozon-default', networkStrategy: 'LOCAL_DIRECT',
    selectionRulePreset: 'BALANCED', minimumSelectionScore: 65,
    selectionDimensions: ['supplier_badge', 'category_rank', 'return_rate', 'network_sales', 'service_rating'],
    requiredSupplierBadges: ['SUPER_FACTORY', 'SOURCE_FLAGSHIP', 'CATEGORY_TOP'],
    maxCategoryTopRank: 20, minimumReturnRate: 30, minimumNetworkSales: 10000, minimumServiceRating: 4,
    collectionMethod: 'KEYWORD', sourceUrl: '', maxPages: 5, supplyPlatforms: ['1688'],
    maxMoq: 100, minSupplierYears: 2, onlyVerifiedSupplier: false, gigaSellerIndexFilter:'GE80', gigaReturnRateFilter:'LOW',
    name: `${platform} 机器人采集：${keyword}`, ozonUrl: 'https://www.ozon.ru/', keyword,
    targetQuantity: 100, minPrice: 0, maxPrice: 10000, minRating: 4, minReviews: 10,
    maxProducts, collectionProtectionEnabled:true, collectionProtectionMode:'STANDARD', collectionBatchSize:12,
    collectionRestMinSeconds:20, collectionRestMaxSeconds:45, collectionMaxRunMinutes:20, collectionAutoPause:true,
    exchangeRate: 0.09, targetMargin: 25
  }
}

export class FeishuBotService {
  private readonly client: Lark.Client
  private readonly wsClient: Lark.WSClient
  private readonly processedMessages = new Set<string>()
  private readonly allowedOpenIds: Set<string>
  private readonly commandIntelligence: DeepSeekCommandService

  constructor(appId: string, appSecret: string, private readonly dependencies: Dependencies) {
    const config = { appId, appSecret, appType: Lark.AppType.SelfBuild }
    this.client = new Lark.Client(config)
    this.wsClient = new Lark.WSClient({ ...config, loggerLevel: Lark.LoggerLevel.warn })
    this.allowedOpenIds = new Set((process.env.FEISHU_ALLOWED_OPEN_IDS || '').split(',').map(id => id.trim()).filter(Boolean))
    this.commandIntelligence = new DeepSeekCommandService(
      process.env.DEEPSEEK_API_KEY || '',
      process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
    )
  }

  async start() {
    const dispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': (data) => {
        if (data.sender.sender_type !== 'user' || data.message.message_type !== 'text') return
        if (this.processedMessages.has(data.message.message_id)) return
        this.processedMessages.add(data.message.message_id)
        if (this.processedMessages.size > 1000) this.processedMessages.delete(this.processedMessages.values().next().value!)
        void this.handleMessage(data).catch(error => console.error('飞书指令处理失败', error))
      }
    })
    await this.wsClient.start({ eventDispatcher: dispatcher })
  }

  close() { this.wsClient.close() }

  private async handleMessage(data: MessageEvent) {
    const openId = data.sender.sender_id?.open_id || ''
    if (this.allowedOpenIds.size > 0 && !this.allowedOpenIds.has(openId)) {
      await this.reply(data.message.message_id, '你没有这个机器人的任务执行权限。')
      return
    }
    let text = ''
    try { text = String(JSON.parse(data.message.content).text || '') } catch { /* malformed text */ }
    for (const mention of data.message.mentions || []) text = text.replaceAll(mention.key, '')
    text = text.trim().replace(/^\//, '')
    let command: IntelligentCommand
    if (/^(帮助|help|\?)$/i.test(text)) command = { action: 'help' }
    else if (/^状态$/.test(text)) command = { action: 'status' }
    else {
      const match = text.match(/^采集\s+(Ozon|1688)\s+(.+?)(?:\s+(\d+))?$/i)
      if (match) {
        const platform = match[1].toLowerCase() === 'ozon' ? 'OZON' : '1688'
        command = { action: 'collect', platform, keyword: match[2].trim(), maxProducts: Math.max(1, Math.min(Number(match[3] || 50), platform === 'OZON' ? 500 : 300)) }
      } else {
        const localNaturalCommand = parseNaturalCollectionCommand(text)
        if (localNaturalCommand) command = localNaturalCommand
        else {
        try { command = await this.commandIntelligence.understand(text) }
        catch (error) {
          console.error('DeepSeek 指令理解失败', error)
          return void await this.reply(data.message.message_id, `智能指令理解暂时不可用，请稍后重试或使用下面的标准指令。\n\n${HELP}`)
        }
        }
      }
    }
    if (command.action === 'help') return void await this.reply(data.message.message_id, HELP)
    if (command.action === 'status') {
      const task = this.dependencies.getLatestTask()
      return void await this.reply(data.message.message_id, task
        ? `最近任务：${task.name}\n状态：${task.stage}\n关键词：${task.keyword || '-'}\n任务ID：${task.id}`
        : '暂无历史任务。')
    }
    if (command.action === 'unknown') return void await this.reply(data.message.message_id, command.clarification)
    const { platform, keyword, maxProducts } = command
    await this.reply(data.message.message_id, `已接收：${platform} 采集“${keyword}”，目标 ${maxProducts} 个。完成后会在本会话反馈。`)
    try {
      const result = await this.dependencies.createAndRunTask(createDraft(platform, keyword, maxProducts))
      const selected = platform === '1688' ? `\nAI优选：${result.selected} 个` : ''
      await this.reply(data.message.message_id, `✅ 任务完成\n平台：${platform}\n关键词：${keyword}\n采集：${result.collected} 个${selected}\n任务ID：${result.task.id}`)
    } catch (error) {
      await this.reply(data.message.message_id, `❌ 任务失败\n${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  private async reply(messageId: string, text: string) {
    const response = await this.client.im.v1.message.reply({
      path: { message_id: messageId },
      data: { msg_type: 'text', content: JSON.stringify({ text }), uuid: crypto.randomUUID() }
    })
    if (response.code) throw new Error(`飞书回复失败：${response.msg || response.code}`)
  }
}
