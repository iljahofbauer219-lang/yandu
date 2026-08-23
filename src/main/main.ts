import { app, BaseWindow, BrowserWindow, dialog, ipcMain, net, protocol, safeStorage, session, shell, WebContentsView } from 'electron'
import iconv from 'iconv-lite'
import fs from 'node:fs'
import path from 'node:path'
import nodeNet from 'node:net'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg'
import { BrowserWorkspace } from './browser/BrowserWorkspace'
import { AppDatabase } from './database/AppDatabase'
import { BailianImageService } from './services/BailianImageService'
import { VolcImageService } from './services/VolcImageService'
import { OpenAIImageService } from './services/OpenAIImageService'
import { BailianTranslationService } from './services/BailianTranslationService'
import { FeishuBotService } from './services/FeishuBotService'
import { RealShiftService } from './services/RealShiftService'
import { EbayService } from './services/EbayService'
import { EbayOptimizationService } from './services/EbayOptimizationService'
import { EbayVideoService } from './services/EbayVideoService'
import { ArkVideoService } from './services/ArkVideoService'
import { EbayImageComplianceVisionService } from './services/EbayImageComplianceVisionService'
import { EbayImageGroundingService } from './services/EbayImageGroundingService'
import { importProductUrl } from './services/ImageSourceService'
import { parseEbayListingsReport } from './services/EbayReportService'
import { ServerProcessManager } from './services/ServerProcessManager'
import { DeepSeekHarnessProcessManager } from './services/DeepSeekHarnessProcessManager'
import { RagflowKnowledgeService } from './services/RagflowKnowledgeService'
import type { KbAgentKey } from './services/RagflowKnowledgeService'
import { KbGuardianService } from './services/KbGuardianService'
import { SampleLibraryKbIngestor } from './services/SampleLibraryKbIngestor'
import { SampleLibraryKbGuardianLauncher, buildSampleLibraryCategoryResolver } from './services/SampleLibraryKbGuardianLauncher'
import type { GuardianSkillInput } from '../shared/kbGuardian'
import type { AmazonDataSourceSearchResult } from '../shared/amazonScraper'
import { describeOmkarCloudError } from '../shared/omkarCloud'

const execFileAsync = promisify(execFile)
const bundledToolsRoot = () => app.isPackaged ? path.join(process.resourcesPath,'.tools') : path.join(app.getAppPath(),'.tools')
const watchSkillRoot = () => path.join(bundledToolsRoot(), 'watch-skill')
type WatchSkillTask = { id:string; videoPath:string; createdAt:string; status:'COMPLETED'|'FAILED'; report:string; framePaths:string[]; error?:string }
const watchSkillTasksPath = () => path.join(app.getPath('userData'), 'watch-skill-tasks.json')
const watchSkillVisionOcrPath = () => path.join(app.getPath('userData'), 'watch-skill-runtime', 'vision-ocr')
const ensureWatchSkillVisionOcr = async () => {
  if(process.platform!=='darwin')return ''
  const bundled=path.join(watchSkillRoot(),'vision-ocr')
  if(fs.existsSync(bundled))return bundled
  const binary=watchSkillVisionOcrPath(),source=path.join(app.getAppPath(),'src','main','advisor','vision-ocr.swift')
  if(fs.existsSync(binary))return binary
  fs.mkdirSync(path.dirname(binary),{recursive:true})
  await execFileAsync('xcrun',['swiftc',source,'-o',binary],{timeout:2*60_000,maxBuffer:2*1024*1024})
  return binary
}
const readWatchSkillTasks = (): WatchSkillTask[] => { try { return JSON.parse(fs.readFileSync(watchSkillTasksPath(),'utf8')) } catch { return [] } }
const saveWatchSkillTasks = (tasks: WatchSkillTask[]) => fs.writeFileSync(watchSkillTasksPath(), JSON.stringify(tasks.slice(0,20), null, 2))
type ResourceSkillDraft = { id:string; sourceTaskId:string; name:string; content:string; createdAt:string; updatedAt:string }
const resource2SkillRoot = () => path.join(bundledToolsRoot(), 'Resource2Skill')
const resource2SkillPython311 = () => path.join(bundledToolsRoot(), 'python-official-expanded-3119', 'Python_Framework.pkg', 'Payload', 'Versions', '3.11', 'bin', 'python3.11')
const resourceSkillLibraryPath = () => path.join(app.getPath('userData'), 'resource2skill-library.json')
const resource2SkillSettingsPath = () => path.join(app.getPath('userData'), 'resource2skill-settings.json')
const readResource2SkillSettings = (): { encryptedGeminiKey?: string; baseUrl:string } => { try { const value=JSON.parse(fs.readFileSync(resource2SkillSettingsPath(),'utf8'));return {...value,baseUrl:value.baseUrl||'https://api000.com'} } catch { return {baseUrl:'https://api000.com'} } }
const readResourceSkillLibrary = ():ResourceSkillDraft[] => { try { return JSON.parse(fs.readFileSync(resourceSkillLibraryPath(),'utf8')) } catch { return [] } }
const saveResourceSkillLibrary = (items:ResourceSkillDraft[]) => fs.writeFileSync(resourceSkillLibraryPath(),JSON.stringify(items.slice(0,100),null,2))
const fileStem = (value:string) => path.basename(value,path.extname(value)).replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-|-$/g,'')||'video-skill'
const makeResourceSkillDraft = (task:WatchSkillTask, domain:string, domainPrompt:string):ResourceSkillDraft => {
  const name=`${fileStem(task.videoPath)}-skill`, now=new Date().toISOString()
  const content=`---\nname: ${name}\ndescription: 从视频 ${path.basename(task.videoPath)} 提取的可编辑操作技能草稿\nresource2skill_domain: ${domain}\n---\n\n# ${name}\n\n> 状态：Watch Skill 本地报告适配草稿，未调用官方 Gemini 视频分析。\n> 官方领域：${domain}（配置与蒸馏提示词已校验）\n> 来源任务：${task.id}\n> 来源视频：${task.videoPath}\n> 生成时间：${now}\n\n## 适用场景\n\n根据来源视频复现其中展示的 ${domain} 操作流程。\n\n## 输入要求\n\n- 待处理对象或任务目标\n- 来源视频中要求的账号、素材与权限\n\n## 执行步骤\n\n1. 阅读下方来源证据，识别操作目标和前置条件。\n2. 按时间顺序整理视频中的动作与判断条件。\n3. 按 ${domain} 官方蒸馏提示词的结构补齐工具、参数和验证。\n4. 对高风险提交、发布、删除或付款动作请求人工确认。\n5. 执行后按照验证标准检查结果。\n\n## 来源证据\n\n${task.report||'暂无可用转录；请结合关键帧人工补充步骤。'}\n\n## 官方蒸馏约束\n\n${domainPrompt.slice(0,1800)}\n\n## 验证标准\n\n- 输出结果与来源视频目标一致。\n- 关键步骤可追溯到来源报告或关键帧。\n- 失败时停止后续操作并记录错误。\n\n## 待人工补充\n\n- [ ] 精确操作步骤与时间戳\n- [ ] 条件分支和异常处理\n- [ ] 工具调用参数\n- [ ] 最终结果截图或状态证明\n`
  return {id:`${Date.now()}-${createHash('sha1').update(task.id).digest('hex').slice(0,8)}`,sourceTaskId:task.id,name,content,createdAt:now,updatedAt:now}
}
const assertResourceSkillQuality = (analysis:string,domain:string) => {
  if(analysis.trim().length<800)throw new Error('质量门禁：蒸馏结果过短')
  const timestamps=analysis.match(/\[\d{2}:\d{2}\]/g)||[]
  if(timestamps.length<5)throw new Error(`质量门禁：来源时间戳不足（${timestamps.length}/5）`)
  if(domain==='general'){
    const unsupported=['CSS','HTML','glow border','color palette','layout reproduction','UI component']
    const found=unsupported.filter(term=>analysis.toLowerCase().includes(term.toLowerCase()))
    if(found.length)throw new Error(`质量门禁：疑似虚构未见视觉细节（${found.join('、')}）`)
  }
  return {timestampCount:timestamps.length}
}

type AmazonDataSourceSettings = { encryptedApiKey?: string; site: string; pages: number; maxSamples: number; cacheHours: number }
const amazonDataSourcePath = () => path.join(app.getPath('userData'), 'amazon-data-source.json')
const amazonDataSourceCache = new Map<string, { at: number; result: AmazonDataSourceSearchResult }>()
let cnyUsdExchangeRateCache: { at: number; usdPerCny: number; source: string } | null = null
const amazonScraperSearchEndpoint = () => process.env.AMAZON_SCRAPER_API_URL || 'https://amazon-scraper-api.omkar.cloud/amazon/search'
const ebayScraperSearchEndpoint = () => process.env.EBAY_SCRAPER_API_URL || 'https://ebay-scraper.omkar.cloud/ebay/items/search'
function readAmazonDataSource(): AmazonDataSourceSettings {
  try {
    const value = JSON.parse(fs.readFileSync(amazonDataSourcePath(), 'utf8')) as Partial<AmazonDataSourceSettings>
    return {
      encryptedApiKey: value.encryptedApiKey,
      site: 'US',
      pages: Math.min(2, Math.max(1, Math.floor(Number(value.pages) || 1))),
      maxSamples: Math.min(48, Math.max(1, Math.floor(Number(value.maxSamples) || 24))),
      cacheHours: Math.min(168, Math.max(1, Math.floor(Number(value.cacheHours) || 24)))
    }
  } catch { return { site: 'US', pages: 1, maxSamples: 24, cacheHours: 24 } }
}
function publicAmazonDataSource(value = readAmazonDataSource()) {
  return { configured: Boolean(value.encryptedApiKey), site: value.site, pages: value.pages, maxSamples: value.maxSamples, cacheHours: value.cacheHours }
}
import { AiEmployeeChatService } from './services/AiEmployeeChatService'
import { materializeGeneratedMarkdownReply } from './services/generatedReportArtifact'
import { isLocalServerUrl, readServerUrl, writeServerUrl } from './serverConfig'
import { autoUpdater } from 'electron-updater'
import { shutdownAdvisorRuntime } from './advisor/AdvisorRuntime'
import { auditEbayTitle } from '../shared/ebayTitleAudit'
import type { BrowserBounds, BrowserTranslationMode, CandidateUpdateRequest, CollectedOzonProduct, CollectedSupplyProduct, CollectionPreviewConfirmRequest, CollectionPreviewResult, CollectorPluginImportResult, CollectorPluginProduct, ComparisonImportRequest, ComparisonPromotionRequest, ComparisonUpdateRequest, ComplianceCategoryTemplateDraft, ComplianceCheckRequest, ComplianceDocumentDraft, ComplianceEnforcementStatus, ComplianceProductProfileDraft, ComplianceRecall, ComplianceReviewStatus, ComplianceRuleDraft, ComplianceSourceChangeDecision, ComplianceTaskStatus, EbayAcceptanceBatch, EbayAcceptanceCheck, EbayAcceptanceItemResult, EbayAcceptanceRunRequest, EbayAcceptanceScenarioResult, EbayContentOptimizationRecordInput, EbayContentOptimizationRequest, EbayContentTranslationRequest, EbayContentTranslationResult, EbayDirectoryProductSyncRequest, EbayDirectoryProductSyncResult, EbayImageCandidateReviewRequest, EbayImageGroundingRequest, EbayImageInspection, EbayImageInspectionReport, EbayImageRoleSuggestionRequest, EbayImageStage, EbayImageVisualInspectionReport, EbayImageVisualReviewInput, EbayListing, EbayLocalProduct, EbayLocalProductMedia, EbayLocalProductMediaUploadInput, EbayLocalProductSnapshotInput, EbayLocalProductUpdateInput, EbayMarketKeywordStat, EbayMarketResearchDecisionRequest, EbayMarketResearchFinding, EbayMarketResearchRequest, EbayMarketResearchSnapshot, EbayOptimizationDraft, EbayOptimizationDraftInput, EbayOptimizationExportInput, EbayProductDetails, EbayPublishAuditEvent, EbayPublishComparisonItem, EbayPublishTask, EbaySellerHubAcceptanceSnapshot, EbayStageGroundingRequest, EbayStageStoryboardRequest, EbayTitleDecisionInput, EbayTitleOptimizationRequest, EbayVideoStudioRequest, ImageGenerationRequest, ImageModelProfile, ImportedProductImage, ImportedProductSource, MarketplaceCredentialInput, MarketplaceMediaAssetType, MarketplacePlatformCode, MarketplacePublishDraftUpdate, NetworkStrategy, Platform, RealShiftRequest, SelectionDecision, SelectionImportRequest, SelectionTask, SelectionTaskDraft, SupplyPlatformCode, TaskProgress } from '../shared/contracts'

import type { EbayVideoCapabilityVerificationRequest } from '../shared/contracts'
import type { AiEmployeeAskRequest } from '../shared/aiEmployee'
import { buildListingCsv } from '../shared/listingArchive'
import { escapeHtml, renderMarkdownForWord, wordDocumentCss } from '../shared/wordExport'
import { reportMarkdownToDocxFile, reportMarkdownToDocxBuffer } from '../shared/reportWordExport'
import { loadSampleLibrary } from '../shared/sampleLibrary'
import type { ImageMarketingTranslationRequest, ImageMarketingTranslationResult } from '../shared/contracts'
import { validateMarketingTranslation } from '../shared/imageProduction'

protocol.registerSchemesAsPrivileged([{scheme:'cross-media',privileges:{standard:true,secure:true,stream:true,supportFetchAPI:true}}])

let mainWindow: BaseWindow | null = null
let shellWebContents: Electron.WebContents | null = null
let workspace: BrowserWorkspace | null = null
let database: AppDatabase | null = null
let feishuBot: FeishuBotService | null = null
let runningTaskId: string | null = null
let complianceSyncScheduled = false
let complianceSyncTimer:NodeJS.Timeout|null = null
const tasks = new Map<string, SelectionTask>()
const ebayDirectorySyncControls = new Map<string,{taskId:string;paused:boolean;cancelled:boolean}>()

function createCollectorTask(platformCode: SupplyPlatformCode): SelectionTask {
  return {
    id: `collector-plugin-${platformCode.toLowerCase()}`,
    stage: 'SUPPLY_LIST_COMPLETED',
    createdAt: new Date().toISOString(),
    selectionMode: 'FORWARD_SUPPLY', marketplacePlatform: 'OZON', marketplaceAccountId: 'ozon-default', networkStrategy: 'LOCAL_DIRECT',
    selectionRulePreset: 'BALANCED', minimumSelectionScore: 65, selectionDimensions: ['supplier','quality','risk'], requiredSupplierBadges: [],
    maxCategoryTopRank: 20, minimumReturnRate: 0, minimumNetworkSales: 0, minimumServiceRating: 0,
    collectionMethod: 'PRODUCT_URL', sourceUrl: '', maxPages: 1, supplyPlatforms: [platformCode], maxMoq: 100, minSupplierYears: 0,
    onlyVerifiedSupplier: false, gigaSellerIndexFilter: 'ANY', gigaReturnRateFilter: 'ANY', name: `${platformCode} 内置选择采集`,
    ozonUrl: 'https://www.ozon.ru/', keyword: '', targetQuantity: 100, minPrice: 0, maxPrice: 10000, minRating: 0, minReviews: 0,
    maxProducts: 100, collectionProtectionEnabled: true, collectionProtectionMode: 'STANDARD', collectionBatchSize: 12,
    collectionRestMinSeconds: 20, collectionRestMaxSeconds: 45, collectionMaxRunMinutes: 20, collectionAutoPause: true,
    exchangeRate: 0.09, targetMargin: 25
  }
}

function importCollectorProducts(products: CollectorPluginProduct[]) {
  if (!database) throw new Error('候选商品数据库尚未初始化')
  let imported = 0
  let updated = 0
  let total = 0
  let blocked = 0
  const duplicates:CollectorPluginImportResult['duplicates'] = []
  for (const platformCode of [...new Set(products.map(item => item.platformCode))]) {
    const group = products.filter(item => item.platformCode === platformCode)
    const mapped: CollectedSupplyProduct[] = group.map(item => {
      const hasGigaIndex = item.gigaIndex !== null && item.gigaIndex !== undefined
      const score = hasGigaIndex ? Math.max(0, Math.min(100, Math.round(item.gigaIndex!))) : 0
      return {
        platformCode: item.platformCode, productId: item.productId, url: item.url, title: item.title, imageUrl: item.imageUrl,
        priceText: item.priceText, salesText: item.salesText, shippingFeeText:item.shippingFeeText, sellableInventory:item.sellableInventory, promotionText:item.promotionText, gigaIndex:item.gigaIndex, supplierName: item.supplierName, supplierBadges: hasGigaIndex ? ['GIGA_INDEX'] : [],
        categoryTopRank: null, returnRate: null, networkSalesCount: null, serviceRating: null, serviceDetails: {},
        dataCompleteness: Math.round([item.imageUrl,item.priceText,item.shippingFeeText,item.sellableInventory !== null && item.sellableInventory !== undefined,hasGigaIndex,item.sourceCategory?.pathIds.length].filter(Boolean).length / 6 * 100),
        score, grade: hasGigaIndex ? score >= 80 ? 'A' : score >= 65 ? 'B' : 'C' : 'REJECTED', dimensionScores: { supplier: score, inventory:item.sellableInventory === null || item.sellableInventory === undefined ? 0 : Math.min(100,Math.round(45+Math.log10(Math.max(1,item.sellableInventory))*18)), logistics:item.shippingFeeText?70:0 },
        recommendation: hasGigaIndex ? `GIGA Index ${item.gigaIndex} · 内置选择采集 · ${item.capturedFrom === 'DETAIL' ? '详情页' : '列表页'}${item.storeReturnRate ? ` · 退货率${item.storeReturnRate}` : ''}` : 'GIGA Index待补采，暂不评分',
        riskFlags: [!item.priceText ? '价格待补采' : '', !item.supplierName ? '供应商待补采' : '', item.sourceCategory?.status !== 'EXACT' ? '类目待核实' : ''].filter(Boolean),
        selected: false, sourceCategory: item.sourceCategory
      }
    })
    const result = database.importPluginSupplyCandidates(createCollectorTask(platformCode), mapped)
    imported += result.imported
    updated += result.updated
    blocked += result.blocked
    duplicates.push(...result.duplicates)
    total = Math.max(total, result.total)
  }
  return { imported, updated, total, blocked, duplicates }
}

function validateBuiltInCollectorProducts(products: CollectorPluginProduct[]) {
  if (products.length < 1) throw new Error('请先在右侧页面选择商品')
  if (products.length > 100) throw new Error('每次最多确认采集 100 个商品')
  return products.map(item => {
    const url = new URL(item.url)
    if (url.protocol !== 'https:' || !(url.hostname === 'gigab2b.com' || url.hostname.endsWith('.gigab2b.com'))) throw new Error('发现非大健云仓商品链接，已停止采集')
    const title = String(item.title || '').trim().slice(0, 500)
    if (!title) throw new Error('有商品未识别到标题，请取消后重新选择')
    const source = item.sourceCategory
    const pathIds = source?.pathIds.slice(0, 3).map(value => String(value).trim().slice(0, 80)).filter(Boolean) || []
    const pathNames = source?.pathNames.slice(0, 3).map(value => String(value).trim().slice(0, 120)).filter(Boolean) || []
    const level = (index: number) => pathIds[index] ? { id: pathIds[index], name: String([source?.level1, source?.level2, source?.level3][index]?.name || pathNames[index] || '').trim().slice(0, 120) } : undefined
    const sourceCategory = source ? {
      platformCode: 'GIGACLOUD' as const,
      catalogVersion: String(source.catalogVersion || 'gigab2b-2026-07-13').slice(0, 80),
      level1: level(0), level2: level(1), level3: level(2), pathIds, pathNames,
      capturedFrom: source.capturedFrom === 'PRODUCT_URL' ? 'PRODUCT_URL' as const : source.capturedFrom === 'BREADCRUMB' ? 'BREADCRUMB' as const : 'PAGE_CONTEXT' as const,
      status: pathIds.length >= 3 ? 'EXACT' as const : pathIds.length ? 'PARTIAL' as const : 'NEEDS_REVIEW' as const,
      capturedAt: String(source.capturedAt || new Date().toISOString()).slice(0, 80)
    } : undefined
    return { ...item, platformCode: 'GIGACLOUD' as const, url: url.href, title, sourceCategory }
  })
}

function loadLocalEnvironment() {
  const file = [path.join(app.getAppPath(), '.env.local'), path.join(process.cwd(), '.env.local')].find(candidate => fs.existsSync(candidate))
  if (!file) return
  for (const line of fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^(['"])(.*)\1$/, '$2')
  }
}

loadLocalEnvironment()
const imageService = new BailianImageService(
  process.env.BAILIAN_API_KEY || '',
  process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
)
const volcImageService = new VolcImageService(
  process.env.ARK_API_KEY || '',
  process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3'
)
const openaiImageService = new OpenAIImageService(
  process.env.OPENAI_IMAGE_API_KEY || '',
  process.env.IMAGE_PROXY_URL || ''
)
const ebayImageComplianceVisionService = new EbayImageComplianceVisionService(
  process.env.BAILIAN_API_KEY || '',
  process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  process.env.BAILIAN_VISION_MODEL || 'qwen3.6-flash'
)
const ebayImageGroundingService = new EbayImageGroundingService(
  process.env.BAILIAN_API_KEY || '',
  process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  process.env.BAILIAN_IMAGE_GROUNDING_MODEL || process.env.BAILIAN_VISION_MODEL || 'qwen3.6-flash'
)
const translationService = new BailianTranslationService(
  process.env.BAILIAN_API_KEY || '',
  process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
)
const ebayService = new EbayService(
  process.env.EBAY_CLIENT_ID || '',
  process.env.EBAY_CLIENT_SECRET || '',
  process.env.EBAY_RUNAME || ''
)
const ebayOptimizationService = new EbayOptimizationService(
  process.env.DEEPSEEK_API_KEY || '',
  process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  process.env.DEEPSEEK_MODEL || 'deepseek-v4-flash'
)
const aiEmployeeChatService = new AiEmployeeChatService()
const ragflowKnowledgeService = new RagflowKnowledgeService()
const kbGuardianService = new KbGuardianService(ragflowKnowledgeService, event => shellWebContents?.send('kbGuardian:run-event', event))
// I.2 阶段新增：注入报告样例库的文件名→分类映射器（按文件名走不同分类）
kbGuardianService.setCategoryResolver(buildSampleLibraryCategoryResolver())

const configuredModels=(value:string|undefined) => [...new Set((value||'').split(',').map(item=>item.trim()).filter(Boolean))]
const arkVideoService=()=>new ArkVideoService(
  process.env.ARK_API_KEY||'',
  (process.env.ARK_BASE_URL||'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/,''),
  process.env.ARK_VIDEO_MODEL||'',
  path.join(app.getPath('userData'),'ebay-videos'),
  {
    configuredVideoModels:configuredModels(process.env.ARK_VIDEO_MODELS),
    configuredTextModels:configuredModels(process.env.ARK_TEXT_MODELS),
    ttsAppId:process.env.VOLC_TTS_APP_ID||'',
    ttsAccessToken:process.env.VOLC_TTS_ACCESS_TOKEN||'',
    ttsBaseUrl:process.env.VOLC_TTS_BASE_URL||'',
    ttsResourceId:process.env.VOLC_TTS_RESOURCE_ID||'seed-tts-2.0',
    ttsVoices:{
      NATURAL_FEMALE:process.env.VOLC_TTS_VOICE_NATURAL_FEMALE||'',
      NATURAL_MALE:process.env.VOLC_TTS_VOICE_NATURAL_MALE||'',
      PROFESSIONAL_FEMALE:process.env.VOLC_TTS_VOICE_PROFESSIONAL_FEMALE||'',
      PROFESSIONAL_MALE:process.env.VOLC_TTS_VOICE_PROFESSIONAL_MALE||''
    }
  }
)

const ebayContentTranslationModel='qwen-mt-flash' as const

function ebayContentTranslationSource(englishDescription:string) {
  return englishDescription.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map((english,index)=>({id:`P${String(index+1).padStart(3,'0')}`,english}))
}

async function translateEbayContent(request:EbayContentTranslationRequest):Promise<EbayContentTranslationResult> {
  const translatedAt=new Date().toISOString()
  const source=request.segments.map(item=>({id:item.id,english:item.english.trim()})).filter(item=>item.english)
  try {
    const translated=await translationService.translateTexts(source.map(item=>item.english))
    return {model:ebayContentTranslationModel,translatedAt,segments:source.map(item=>{const chinese=(translated.get(item.english)||'').trim();return {id:item.id,english:item.english,chinese,sourceHash:createHash('sha256').update(item.english).digest('hex'),status:chinese?'SYNCED':'FAILED'}})}
  } catch(error) {
    const message=error instanceof Error?error.message:String(error)
    return {model:ebayContentTranslationModel,translatedAt,error:message,segments:source.map(item=>({id:item.id,english:item.english,chinese:'',sourceHash:createHash('sha256').update(item.english).digest('hex'),status:'FAILED'}))}
  }
}

function openEbaySellerHub(storeId:string) {
  const store=database?.getEbayStores().find(item=>item.id===storeId)
  if(!store)throw new Error('eBay 店铺不存在')
  if(!workspace)throw new Error('应用内浏览器尚未初始化')
  return workspace.openCredentialLogin(`ebay:${store.id}`,`${store.name} · eBay`,'https://www.ebay.com/sh/ovw',['ebay.com'])
}

function newEbayBrowserTab(storeId:string) {
  const store=database?.getEbayStores().find(item=>item.id===storeId)
  if(!store)throw new Error('eBay 店铺不存在')
  if(!workspace)throw new Error('应用内浏览器尚未初始化')
  return workspace.newEbayTab(`ebay:${store.id}`,store.name)
}

async function openEbayProductTab(storeId:string,url:string,title:string) {
  const store=database?.getEbayStores().find(item=>item.id===storeId)
  if(!store)throw new Error('eBay 店铺不存在')
  if(!workspace)throw new Error('应用内浏览器尚未初始化')
  const open=()=>workspace!.newEbayTab(`ebay:${store.id}`,title.trim().slice(0,60)||'eBay 原商品',url)
  try {
    return await open()
  } catch(error) {
    if(!(error instanceof Error)||!error.message.includes('请先打开当前eBay店铺'))throw error
    await openEbaySellerHub(storeId)
    return open()
  }
}

async function openEbayMarketResearch(storeId:string,request:EbayMarketResearchRequest) {
  const store=database?.getEbayStores().find(item=>item.id===storeId)
  const listing=database?.getEbayListings(storeId).find(item=>item.listingId===request.listingId)
  if(!store||!listing)throw new Error('eBay 店铺或线上产品不存在')
  if(!workspace)throw new Error('应用内浏览器尚未初始化')
  const marketplace=listing.marketplaceId==='EBAY_US'?'EBAY-US':listing.marketplaceId.replace('_','-')
  const researchUrl=new URL('https://www.ebay.com/sh/research')
  researchUrl.searchParams.set('marketplace',marketplace)
  researchUrl.searchParams.set('keywords',request.query.replace(/\s+/g,' ').trim())
  researchUrl.searchParams.set('dayRange',String(request.periodDays))
  researchUrl.searchParams.set('categoryId',listing.categoryId||'0')
  researchUrl.searchParams.set('tabName','SOLD')
  const open=()=>workspace!.newEbayTab(`ebay:${store.id}`,'eBay 已成交市场研究',researchUrl.toString())
  try { return await open() }
  catch(error) {
    if(!(error instanceof Error)||!error.message.includes('请先打开当前eBay店铺浏览器'))throw error
    await openEbaySellerHub(storeId)
    return open()
  }
}

function ebayMarketplaceCurrency(marketplaceId:string) {
  const code=marketplaceId.trim().toUpperCase()
  if(code==='EBAY_GB')return 'GBP'
  if(['EBAY_DE','EBAY_FR','EBAY_IT','EBAY_ES','EBAY_AT','EBAY_IE','EBAY_NL','EBAY_BE'].includes(code))return 'EUR'
  if(code==='EBAY_CA')return 'CAD'
  if(code==='EBAY_AU')return 'AUD'
  return 'USD'
}

async function resolveEbayOriginalCore(store:{id:string;marketplaceId:string},listing:EbayListing,details:EbayProductDetails) {
  if(!workspace)throw new Error('应用内浏览器尚未初始化')
  const expectedCurrency=ebayMarketplaceCurrency(store.marketplaceId||listing.marketplaceId)
  try {
    const original=await workspace.readEbayRevisionCore(`ebay:${store.id}`,listing.listingId,expectedCurrency)
    return {...details,price:original.price,currency:original.currency,descriptionText:original.descriptionText,descriptionHtml:original.descriptionHtml}
  } catch(error) {
    const message=error instanceof Error?error.message:'未能读取原刊登核心资料'
    throw new Error(`无法从 Seller Hub 修改页完整读取 ${expectedCurrency} 原价和真实描述：${message}`)
  }
}

async function syncEbayProductDetails(storeId:string,listingId:string) {
  if(!database)throw new Error('数据库尚未初始化')
  if(!workspace)throw new Error('应用内浏览器尚未初始化')
  const store=database.getEbayStores().find(item=>item.id===storeId)
  const listing=database.getEbayListings(storeId).find(item=>item.listingId===listingId)
  if(!store||!listing)throw new Error('eBay 店铺或线上产品不存在')
  const read=()=>workspace!.readEbayProductDetails(`ebay:${store.id}`,`${listing.title} · 原商品`,listing.viewUrl)
  let details
  try { details=await read() }
  catch(error) {
    if(!(error instanceof Error)||!error.message.includes('请先打开当前eBay店铺浏览器'))throw error
    await openEbaySellerHub(storeId)
    details=await read()
  }
  const normalizedDetails=await resolveEbayOriginalCore(store,listing,details)
  return database.updateEbayListingDetails(storeId,listingId,normalizedDetails)
}

function safeLocalSegment(value:string) {
  return value.replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,100)||'unknown'
}

function completeEbayLocalSnapshot(input:Omit<EbayLocalProductSnapshotInput,'completeness'|'missingFields'|'contentHash'>):EbayLocalProductSnapshotInput {
  const {listing,details,media}=input
  const expectedCurrency=ebayMarketplaceCurrency(listing.marketplaceId)
  const trustedPrice=(details.currency||'').trim().toUpperCase()===expectedCurrency
    ?details.price
    :listing.currency.trim().toUpperCase()===expectedCurrency?listing.price:''
  const checks=[
    {label:'图片',ok:media.some(item=>item.downloadStatus==='DOWNLOADED'&&item.localPath),weight:25},
    {label:'标题',ok:Boolean(details.title||listing.title),weight:25},
    {label:'描述',ok:Boolean(details.descriptionText||details.descriptionHtml),weight:30},
    {label:`${expectedCurrency} 原价`,ok:Boolean(trustedPrice),weight:20}
  ]
  const completeness=checks.reduce((total,item)=>total+(item.ok?item.weight:0),0)
  const missingFields=checks.filter(item=>!item.ok).map(item=>item.label)
  const contentHash=createHash('sha256').update(JSON.stringify({
    listing,
    details,
    media:media.map(item=>({remoteUrl:item.remoteUrl,localPath:item.localPath,fileSize:item.fileSize,sha256:item.sha256,downloadStatus:item.downloadStatus}))
  })).digest('hex')
  return {...input,completeness,missingFields,contentHash}
}

async function downloadEbayLocalProduct(storeId:string,listingId:string):Promise<EbayLocalProduct> {
  if(!database)throw new Error('数据库尚未初始化')
  const store=database.getEbayStores().find(item=>item.id===storeId)
  const listing=database.getEbayListings(storeId).find(item=>item.listingId===listingId)
  if(!store||!listing)throw new Error('eBay 店铺或线上产品不存在')
  if(!workspace)throw new Error('应用内浏览器尚未初始化')
  const details:EbayProductDetails={
    url:listing.viewUrl,
    itemSpecifics:listing.itemSpecifics||[],
    condition:listing.condition||'',
    imageUrls:listing.imageUrls||[],
    title:listing.originalTitle||listing.title,
    price:listing.price,
    currency:listing.currency
  }
  const read=()=>workspace!.readEbayProductDetails(`ebay:${store.id}`,`${listing.title} · 本地快照`,listing.viewUrl)
  let liveDetails:EbayProductDetails
  try { liveDetails=await read() }
  catch(error) {
    if(!(error instanceof Error)||!error.message.includes('请先打开当前eBay店铺'))throw error
    await openEbaySellerHub(storeId)
    liveDetails=await read()
  }
  const expectedCurrency=ebayMarketplaceCurrency(store.marketplaceId||listing.marketplaceId)
  let originalCoreReady=true
  try {
    liveDetails=await resolveEbayOriginalCore(store,listing,liveDetails)
  } catch {
    originalCoreReady=false
  }
  const updated=database.updateEbayListingDetails(storeId,listingId,liveDetails)
  const imageUrls=[...new Set([...(liveDetails.imageUrls||[]),...(updated.imageUrls||[]),updated.imageUrl].filter(Boolean))].slice(0,24)
  const mergedDetails:EbayProductDetails={
    url:liveDetails.url||details.url,
    itemSpecifics:[],
    condition:'',
    imageUrls,
    title:liveDetails.title||updated.title,
    descriptionHtml:liveDetails.descriptionHtml||'',
    descriptionText:liveDetails.descriptionText||'',
    price:originalCoreReady?liveDetails.price||updated.price:updated.currency.trim().toUpperCase()===expectedCurrency?updated.price:'',
    currency:expectedCurrency
  }
  if(!mergedDetails.imageUrls.length)throw new Error('原商品页没有识别到可下载图片，请确认商品图片正常显示后重试')
  const capturedAt=new Date().toISOString()
  const directory=path.join(app.getPath('userData'),'ebay-local-products',safeLocalSegment(storeId),safeLocalSegment(listingId),capturedAt.replace(/[:.]/g,'-'))
  fs.mkdirSync(directory,{recursive:true})
  const media:EbayLocalProductMedia[]=new Array(mergedDetails.imageUrls.length)
  const failures:string[]=[]
  let nextImageIndex=0
  const downloadNextImage=async()=>{
    while(nextImageIndex<mergedDetails.imageUrls.length) {
      const index=nextImageIndex++
      const remoteUrl=mergedDetails.imageUrls[index]
      const id=crypto.randomUUID()
      try {
        const response=await fetch(remoteUrl,{signal:AbortSignal.timeout(15_000),headers:{'User-Agent':'Mozilla/5.0'}})
        if(!response.ok)throw new Error(`HTTP ${response.status}`)
        const buffer=Buffer.from(await response.arrayBuffer())
        if(!buffer.length)throw new Error('图片内容为空')
        const mimeType=(response.headers.get('content-type')||'').split(';')[0].toLowerCase()
        const selected=ebayImageFormat(mimeType)
        if(!selected)throw new Error(`不支持的图片类型：${mimeType||'未知'}`)
        const dimensions=imageDimensions(buffer,selected.format)
        if(!dimensions.width||!dimensions.height)throw new Error('无法识别图片尺寸')
        const localPath=path.join(directory,`${String(index+1).padStart(2,'0')}.${selected.extension}`)
        fs.writeFileSync(localPath,buffer)
        media[index]={id,mediaType:'IMAGE',sortOrder:index,remoteUrl,localPath,mimeType,width:dimensions.width,height:dimensions.height,fileSize:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),downloadStatus:'DOWNLOADED'}
      } catch(error) {
        const reason=error instanceof Error?error.message:'未知错误'
        failures.push(`第 ${index+1} 张：${reason}`)
        media[index]={id,mediaType:'IMAGE',sortOrder:index,remoteUrl,localPath:'',mimeType:'',width:0,height:0,fileSize:0,sha256:'',downloadStatus:'FAILED'}
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(6,mergedDetails.imageUrls.length)},()=>downloadNextImage()))
  const downloadedCount=media.filter(item=>item.downloadStatus==='DOWNLOADED').length
  if(!downloadedCount)throw new Error(`商品图片全部下载失败。${failures.slice(0,3).join('；')}`)
  return database.saveEbayLocalProductSnapshot(completeEbayLocalSnapshot({listing:updated,details:mergedDetails,media,capturedAt}))
}

async function readEbayProductByUrl(storeId:string,rawUrl:string):Promise<EbayLocalProduct> {
  if(!database)throw new Error('数据库尚未初始化')
  const store=database.getEbayStores().find(item=>item.id===storeId)
  if(!store)throw new Error('eBay 店铺不存在')
  const input=rawUrl.trim()
  const listingId=input.match(/\/itm\/(?:[^/?#]+\/)?(\d{9,15})/i)?.[1]||input.match(/[?&]item=(\d{9,15})/i)?.[1]||input.match(/^(\d{9,15})$/)?.[1]||''
  if(!listingId)throw new Error('无法识别的 eBay 商品网址，请输入类似 https://www.ebay.com/itm/123456789012 的链接')
  const existing=database.getEbayLocalProducts(storeId).find(item=>item.listingId===listingId)
  if(existing)return existing
  if(!workspace)throw new Error('应用内浏览器尚未初始化')
  const viewUrl=`https://www.ebay.com/itm/${listingId}`
  const read=()=>workspace!.readEbayProductDetails(`ebay:${store.id}`,`${listingId} · 网址读取`,viewUrl)
  let details:EbayProductDetails
  try { details=await read() }
  catch(error) {
    if(!(error instanceof Error)||!error.message.includes('请先打开当前eBay店铺'))throw error
    await openEbaySellerHub(storeId)
    details=await read()
  }
  const title=(details.title||'').trim()
  if(!title)throw new Error('未能从商品页识别到标题，请确认链接是有效的 eBay 商品页')
  const marketplaceId=store.marketplaceId||'EBAY_US'
  const now=new Date().toISOString()
  const listing:EbayListing={
    id:`${store.id}:${marketplaceId}:${listingId}`,storeId:store.id,marketplaceId,listingId,sku:'',
    title,originalTitle:title,translatedTitle:'',originalTitleVerified:true,titleSource:'EBAY_STRUCTURED_DATA',
    price:details.price||'',currency:(details.currency||'').trim().toUpperCase()||ebayMarketplaceCurrency(marketplaceId),
    quantity:0,
    imageUrl:details.imageUrls[0]||'',imageUrls:details.imageUrls||[],
    categoryId:'',categoryName:'',status:'ACTIVE',viewUrl,updatedAt:now,
    itemSpecifics:details.itemSpecifics||[],condition:details.condition||''
  }
  database.upsertEbayListing(storeId,listing)
  return downloadEbayLocalProduct(storeId,listingId)
}

function updateEbayLocalProduct(localProductId:string,changes:EbayLocalProductUpdateInput):EbayLocalProduct {
  if(!database)throw new Error('数据库尚未初始化')
  const product=database.getEbayLocalProducts().find(item=>item.id===localProductId)
  if(!product)throw new Error('本地产品不存在或已删除')
  const title=changes.title.trim()
  const validationErrors:string[]=[]
  if(!title)validationErrors.push('物品标题不能为空')
  if(title.length>80)validationErrors.push('物品标题不能超过 80 个字符')
  if(!changes.descriptionText.trim()&&!changes.descriptionHtml.trim())validationErrors.push('商品描述不能为空')
  if(!Number.isFinite(Number(changes.price))||Number(changes.price)<=0)validationErrors.push('价格必须是大于 0 的数字')
  if(!/^[A-Z]{3}$/.test(changes.currency.trim()))validationErrors.push('币种必须使用 3 位大写代码')
  const downloadedMedia=changes.media.filter(item=>item.downloadStatus==='DOWNLOADED'&&item.localPath)
  if(!downloadedMedia.length)validationErrors.push('至少需要 1 张已保存到本地的商品图片')
  if(changes.media.length>24)validationErrors.push('商品图片不能超过 24 张')
  if(downloadedMedia.some(item=>item.width>0&&item.height>0&&Math.max(item.width,item.height)<500))validationErrors.push('存在最长边不足 500px 的商品图片')
  if(downloadedMedia.some(item=>(item.fileSize||0)>12*1024*1024))validationErrors.push('存在单张超过 12MB 的商品图片')
  if(downloadedMedia.some(item=>!ebayImageFormat(item.mimeType)))validationErrors.push('存在 eBay 不支持的商品图片格式')
  if(validationErrors.length)throw new Error(`本地刊登资料未通过校验：${validationErrors.join('；')}`)
  const capturedAt=new Date().toISOString()
  const listing={
    ...product.snapshot.sourceListing,
    title,
    price:changes.price.trim(),
    currency:changes.currency.trim(),
    updatedAt:capturedAt
  }
  const details:EbayProductDetails={
    url:product.snapshot.details.url,
    itemSpecifics:[],
    condition:'',
    imageUrls:changes.media.map(item=>item.remoteUrl).filter(Boolean),
    title,
    descriptionText:changes.descriptionText.trim(),
    descriptionHtml:changes.descriptionHtml.trim(),
    price:listing.price,
    currency:listing.currency
  }
  const sourceMedia=new Map(product.snapshot.media.map(media=>[media.id,media]))
  const media=changes.media.slice(0,24).map((media,index)=>({...(sourceMedia.get(media.id)||media),sortOrder:index}))
  return database.saveEbayLocalProductSnapshot(completeEbayLocalSnapshot({listing,details,media,capturedAt}))
}

function removeEbayLocalProduct(localProductId:string) {
  if(!database)throw new Error('数据库尚未初始化')
  const product=database.getEbayLocalProducts().find(item=>item.id===localProductId)
  if(!product)throw new Error('本地产品不存在或已删除')
  database.removeEbayLocalProduct(localProductId)
  const directory=path.join(app.getPath('userData'),'ebay-local-products',safeLocalSegment(product.storeId),safeLocalSegment(product.listingId))
  if(fs.existsSync(directory))fs.rmSync(directory,{recursive:true,force:true})
  return true
}

function readEbayLocalProductMedia(localProductId:string,mediaId:string) {
  if(!database)throw new Error('数据库尚未初始化')
  const product=database.getEbayLocalProducts().find(item=>item.id===localProductId)
  const media=product?.snapshot.media.find(item=>item.id===mediaId&&item.downloadStatus==='DOWNLOADED'&&item.localPath)
  if(!product||!media)throw new Error('本地图片不存在或下载未完成')
  const productRoot=path.resolve(app.getPath('userData'),'ebay-local-products',safeLocalSegment(product.storeId),safeLocalSegment(product.listingId))
  const localPath=path.resolve(media.localPath)
  if(localPath!==productRoot&&!localPath.startsWith(`${productRoot}${path.sep}`))throw new Error('本地图片路径无效')
  const buffer=fs.readFileSync(localPath)
  return `data:${media.mimeType||'image/jpeg'};base64,${buffer.toString('base64')}`
}

function addEbayLocalProductMedia(localProductId:string,input:EbayLocalProductMediaUploadInput):EbayLocalProductMedia {
  if(!database)throw new Error('数据库尚未初始化')
  const product=database.getEbayLocalProducts().find(item=>item.id===localProductId)
  if(!product)throw new Error('本地产品不存在或已删除')
  const mimeType=input.mimeType.toLowerCase().split(';')[0]
  const selected=ebayImageFormat(mimeType)
  if(!selected)throw new Error('只支持 JPEG、PNG、GIF、TIFF、BMP、WebP、HEIC 或 AVIF 图片')
  const base64=input.base64.replace(/^data:[^;]+;base64,/, '')
  const buffer=Buffer.from(base64,'base64')
  if(!buffer.length)throw new Error('图片文件为空')
  if(buffer.length>12*1024*1024)throw new Error('单张图片不能超过12MB')
  const id=crypto.randomUUID()
  const directory=path.join(app.getPath('userData'),'ebay-local-products',safeLocalSegment(product.storeId),safeLocalSegment(product.listingId),'manual')
  fs.mkdirSync(directory,{recursive:true})
  const localPath=path.join(directory,`${id}.${selected.extension}`)
  fs.writeFileSync(localPath,buffer)
  const dimensions=imageDimensions(buffer,selected.format)
  return {id,mediaType:'IMAGE',sortOrder:product.snapshot.media.length,remoteUrl:'',localPath,mimeType,width:dimensions.width,height:dimensions.height,fileSize:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),downloadStatus:'DOWNLOADED'}
}

function withEbayLocalMediaFileSizes(products:EbayLocalProduct[]):EbayLocalProduct[] {
  return products.map(product=>({...product,snapshot:{...product.snapshot,media:product.snapshot.media.map(media=>{
    if(media.fileSize>0||media.downloadStatus!=='DOWNLOADED'||!media.localPath)return media
    try { return {...media,fileSize:fs.statSync(media.localPath).size} }
    catch { return {...media,fileSize:0} }
  })}}))
}

type EbayImageFormat='jpeg'|'png'|'gif'|'tiff'|'bmp'|'webp'|'heic'|'avif'

const ebayImageFormats:Record<string,{format:EbayImageFormat;extension:string}>={
  'image/jpeg':{format:'jpeg',extension:'jpg'},
  'image/jpg':{format:'jpeg',extension:'jpg'},
  'image/png':{format:'png',extension:'png'},
  'image/gif':{format:'gif',extension:'gif'},
  'image/tiff':{format:'tiff',extension:'tiff'},
  'image/x-tiff':{format:'tiff',extension:'tiff'},
  'image/bmp':{format:'bmp',extension:'bmp'},
  'image/x-ms-bmp':{format:'bmp',extension:'bmp'},
  'image/webp':{format:'webp',extension:'webp'},
  'image/heic':{format:'heic',extension:'heic'},
  'image/heif':{format:'heic',extension:'heic'},
  'image/avif':{format:'avif',extension:'avif'}
}

function ebayImageFormat(mimeType:string):{format:EbayImageFormat;extension:string}|undefined {
  return ebayImageFormats[mimeType.toLowerCase().split(';')[0]]
}

function tiffDimensions(buffer:Buffer) {
  if(buffer.length<8)return {width:0,height:0}
  const signature=buffer.toString('ascii',0,2)
  const littleEndian=signature==='II'
  if(!littleEndian&&signature!=='MM')return {width:0,height:0}
  const readUInt16=(offset:number)=>littleEndian?buffer.readUInt16LE(offset):buffer.readUInt16BE(offset)
  const readUInt32=(offset:number)=>littleEndian?buffer.readUInt32LE(offset):buffer.readUInt32BE(offset)
  if(readUInt16(2)!==42)return {width:0,height:0}
  const ifdOffset=readUInt32(4)
  if(ifdOffset+2>buffer.length)return {width:0,height:0}
  const entryCount=readUInt16(ifdOffset)
  let width=0
  let height=0
  for(let index=0;index<entryCount;index+=1) {
    const offset=ifdOffset+2+index*12
    if(offset+12>buffer.length)break
    const tag=readUInt16(offset)
    if(tag!==256&&tag!==257)continue
    const type=readUInt16(offset+2)
    const value=type===3?readUInt16(offset+8):type===4?readUInt32(offset+8):0
    if(tag===256)width=value
    if(tag===257)height=value
  }
  return {width,height}
}

function imageDimensions(buffer:Buffer,format:string) {
  if(format==='png'&&buffer.length>=24)return {width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)}
  if(format==='gif'&&buffer.length>=10)return {width:buffer.readUInt16LE(6),height:buffer.readUInt16LE(8)}
  if(format==='bmp'&&buffer.length>=26)return {width:Math.abs(buffer.readInt32LE(18)),height:Math.abs(buffer.readInt32LE(22))}
  if(format==='tiff')return tiffDimensions(buffer)
  if(format==='webp'&&buffer.length>=30) {
    const chunk=buffer.toString('ascii',12,16)
    if(chunk==='VP8X')return {width:1+buffer.readUIntLE(24,3),height:1+buffer.readUIntLE(27,3)}
    if(chunk==='VP8 '&&buffer.toString('hex',23,26)==='9d012a')return {width:buffer.readUInt16LE(26)&0x3fff,height:buffer.readUInt16LE(28)&0x3fff}
    if(chunk==='VP8L'&&buffer[20]===0x2f){const bits=buffer.readUInt32LE(21);return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1}}
  }
  if((format==='heic'||format==='avif')&&buffer.length>=20) {
    const ispe=buffer.indexOf(Buffer.from('ispe'))
    if(ispe>=0&&ispe+16<=buffer.length)return {width:buffer.readUInt32BE(ispe+8),height:buffer.readUInt32BE(ispe+12)}
  }
  if(format==='jpeg')for(let offset=2;offset+9<buffer.length;){if(buffer[offset]!==0xff){offset+=1;continue}const marker=buffer[offset+1];const size=buffer.readUInt16BE(offset+2);if(marker>=0xc0&&marker<=0xc3)return {width:buffer.readUInt16BE(offset+7),height:buffer.readUInt16BE(offset+5)};if(size<2)break;offset+=2+size}
  return {width:0,height:0}
}

async function inspectEbayImages(urls:string[]):Promise<EbayImageInspectionReport> {
  const unique=[...new Set(urls.filter(Boolean).map(url=>url.replace(/\/s-l\d+(?=\.[a-z0-9]+(?:\?|$))/i,'/s-l1600')))]
  const images:EbayImageInspection[]=await Promise.all(unique.map(async url=>{
    const findings:string[]=[]
    try {
      let buffer:Buffer
      let contentType:string
      if(url.startsWith('data:image/')) {
        const match=url.match(/^data:([^;,]+)(;base64)?,(.*)$/s)
        if(!match)throw new Error('图片数据格式无效')
        contentType=match[1].toLowerCase()
        buffer=match[2]?Buffer.from(match[3],'base64'):Buffer.from(decodeURIComponent(match[3]))
      } else {
        const response=await fetch(url,{signal:AbortSignal.timeout(12_000),headers:{'User-Agent':'Mozilla/5.0'}})
        if(!response.ok)throw new Error(`HTTP ${response.status}`)
        buffer=Buffer.from(await response.arrayBuffer())
        contentType=(response.headers.get('content-type')||'').toLowerCase().split(';')[0]
      }
      const format=ebayImageFormat(contentType)?.format||'unknown'
      const {width,height}=imageDimensions(buffer,format)
      const longestEdge=Math.max(width,height)
      if(format==='unknown')findings.push(`图片格式 ${contentType||'未知'} 不在 eBay 支持列表`)
      if(!width||!height)findings.push('未能读取图片尺寸')
      else if(longestEdge<500)findings.push(`最长边仅 ${longestEdge}px，低于500px`)
      if(buffer.length>12*1024*1024)findings.push(`图片文件 ${(buffer.length/1024/1024).toFixed(2)}MB，超过12MB`)
      const blocked=format==='unknown'||!width||!height||longestEdge<500||buffer.length>12*1024*1024
      return {url,reachable:true,format,width,height,longestEdge,status:blocked?'BLOCKED':'PASSED',findings}
    } catch(error) {
      return {url,reachable:false,format:'unknown',width:0,height:0,longestEdge:0,status:'BLOCKED',findings:[`图片无法读取：${error instanceof Error?error.message:'未知错误'}`]}
    }
  }))
  return {checkedAt:new Date().toISOString(),images,passed:images.filter(item=>item.status==='PASSED').length,review:images.filter(item=>item.status==='REVIEW').length,blocked:images.filter(item=>item.status==='BLOCKED').length}
}

function initialEbayPublishTask(draft:EbayOptimizationDraft):EbayPublishTask {
  const now=new Date().toISOString()
  return {id:crypto.randomUUID(),storeId:draft.storeId,draftId:draft.id,listingId:draft.listingId,status:'DRAFT',reviseUrl:'',categorySpecifics:[],imageInspection:{checkedAt:'',images:[],passed:0,review:0,blocked:0},filledFields:[],warnings:[],comparison:buildEbayPublishComparison(draft),auditTrail:[],message:'待执行',createdAt:now,updatedAt:now}
}

function buildEbayPublishComparison(draft:EbayOptimizationDraft):EbayPublishComparisonItem[] {
  const originalTitle=draft.listing.originalTitle||draft.listing.title
  const originalSpecifics=(draft.listing.itemSpecifics||[]).map(item=>`${item.name}: ${item.value}`).join('；')||'线上未同步属性'
  const optimizedSpecifics=draft.itemSpecifics.map(item=>`${item.name}: ${item.value}`).join('；')||'优化草稿未修改，沿用 Seller Hub 线上属性'
  const originalImage=draft.listing.imageUrls?.[0]||draft.listing.imageUrl||''
  const sameImage=Boolean(originalImage&&draft.imageUrl)&&originalImage.replace(/\/s-l\d+/i,'/s-l1600')===draft.imageUrl.replace(/\/s-l\d+/i,'/s-l1600')
  return [
    {field:'标题',before:originalTitle,after:draft.selectedTitle,status:originalTitle===draft.selectedTitle?'UNCHANGED':'CHANGED'},
    {field:'英文详情',before:'线上原描述未缓存，需在 Seller Hub 人工对照',after:`优化描述 ${draft.description.trim().length} 字符`,status:'REVIEW'},
    {field:'商品属性',before:originalSpecifics,after:optimizedSpecifics,status:originalSpecifics===optimizedSpecifics?'UNCHANGED':'CHANGED'},
    {field:'主图',before:originalImage||'线上未同步主图',after:draft.imageUrl||'未设置',status:sameImage?'UNCHANGED':'CHANGED'}
  ]
}

function appendEbayPublishAudit(task:EbayPublishTask,action:EbayPublishAuditEvent['action'],status:EbayPublishAuditEvent['status'],detail:string):EbayPublishTask {
  const summary=detail.replace(/\s+/g,' ').trim().slice(0,320)
  const event:EbayPublishAuditEvent={id:crypto.randomUUID(),action,status,detail:summary,createdAt:new Date().toISOString()}
  return {...task,auditTrail:[event,...(task.auditTrail||[])].slice(0,100),updatedAt:event.createdAt}
}

async function prepareEbayPublishTask(draftId:string):Promise<EbayPublishTask> {
  if(!database||!workspace)throw new Error('发布工作区尚未初始化')
  const draft=database.getEbayOptimizationDraft(draftId)
  if(!draft)throw new Error('优品草稿不存在，请刷新后重试')
  const existing=database.getEbayPublishTasks(draft.storeId).find(item=>item.draftId===draft.id)
  let task:EbayPublishTask=existing||initialEbayPublishTask(draft)
  const save=(status:EbayPublishTask['status'],message:string,patch:Partial<EbayPublishTask>={})=>{task={...task,...patch,status,message,updatedAt:new Date().toISOString()};return database!.saveEbayPublishTask(task)}
  try {
    task=appendEbayPublishAudit(task,'VALIDATION_STARTED','SUCCESS','开始执行合规、内容和图片检查')
    save('VALIDATING','正在执行合规、内容和图片检查',{comparison:buildEbayPublishComparison(draft)})
    const validation=database.validateEbayOptimizationDraft(draft.id)
    if(!validation.publishAllowed){task=appendEbayPublishAudit(task,'VALIDATION_BLOCKED','FAILED',validation.reason);return save('BLOCKED',validation.reason)}
    if(!validation.permit||validation.permit.status!=='VALID'){const reason='未取得有效的发布合规许可，禁止进入 Seller Hub 填写';task=appendEbayPublishAudit(task,'VALIDATION_BLOCKED','FAILED',reason);return save('BLOCKED',reason)}
    const imageInspection=await inspectEbayImages(draft.imageUrls?.length?draft.imageUrls:[draft.imageUrl,...(draft.listing.imageUrls||[]),draft.listing.imageUrl])
    if(imageInspection.blocked){task=appendEbayPublishAudit(task,'VALIDATION_BLOCKED','FAILED',`图片检查发现 ${imageInspection.blocked} 张阻断图片`);return save('BLOCKED',`图片检查发现 ${imageInspection.blocked} 张阻断图片`,{imageInspection})}
    task=appendEbayPublishAudit(task,'VALIDATION_PASSED',imageInspection.review?'WARNING':'SUCCESS',`发布门禁通过；许可 ${validation.permit.id}；检查 ${imageInspection.images.length} 张图片，${imageInspection.review} 张待人工确认`)
    save('READY_TO_FILL','发布资料检查完成，准备打开 Seller Hub',{imageInspection})
    await openEbaySellerHub(draft.storeId)
    save('FILLING','正在读取类目属性并填写 Seller Hub')
    const prepared=await workspace.prepareEbayListingRevision(`ebay:${draft.storeId}`,validation.draft)
    task=appendEbayPublishAudit(task,'SELLER_HUB_FILLED',prepared.warnings.length?'WARNING':'SUCCESS',`第五步已向 Seller Hub 统一预填 ${prepared.filledFields.length} 项确认资料；最终提交按钮未被点击`)
    return save('WAITING_CONFIRMATION',`已统一预填 ${prepared.filledFields.length} 项确认资料，等待人工核对并提交`,{reviseUrl:prepared.reviseUrl,categorySpecifics:prepared.categorySpecifics,filledFields:prepared.filledFields,warnings:[...prepared.warnings,...(prepared.submitButtonDetected?[]:['未检测到最终提交按钮'])]})
  } catch(error) {
    const message=error instanceof Error?error.message:'发布准备失败'
    task=appendEbayPublishAudit(task,'FAILED','FAILED',message)
    return save('FAILED',message)
  }
}

async function generateEbayPublishVideo(draftId:string):Promise<EbayPublishTask> {
  if(!database)throw new Error('数据库尚未初始化')
  const draft=database.getEbayOptimizationDraft(draftId)
  if(!draft)throw new Error('优品草稿不存在，请刷新后重试')
  const validation=database.validateEbayOptimizationDraft(draft.id)
  if(!validation.publishAllowed)throw new Error(validation.reason)
  let task=database.getEbayPublishTasks(draft.storeId).find(item=>item.draftId===draft.id)||initialEbayPublishTask(draft)
  try {
    const service=new EbayVideoService(path.join(app.getPath('userData'),'ebay-videos'))
    const video=await service.generate(validation.draft)
    task={...task,video,comparison:buildEbayPublishComparison(validation.draft),message:'15秒商品视频已生成，可在应用内预览',updatedAt:new Date().toISOString()}
    task=appendEbayPublishAudit(task,'VIDEO_GENERATED','SUCCESS',`${video.fileName}；${video.durationSeconds}秒；${video.width}×${video.height}；${video.imageCount}张原图`)
    return database.saveEbayPublishTask(task)
  } catch(error) {
    const message=error instanceof Error?error.message:'视频生成失败'
    task=appendEbayPublishAudit(task,'FAILED','FAILED',message)
    database.saveEbayPublishTask({...task,message,updatedAt:new Date().toISOString()})
    throw error
  }
}

async function prepareEbayPublishVideoUpload(draftId:string):Promise<EbayPublishTask> {
  if(!database||!workspace)throw new Error('发布工作区尚未初始化')
  const draft=database.getEbayOptimizationDraft(draftId)
  if(!draft)throw new Error('优品草稿不存在，请刷新后重试')
  let task=database.getEbayPublishTasks(draft.storeId).find(item=>item.draftId===draft.id)
  if(!task?.video||task.video.status!=='READY'||!fs.existsSync(task.video.filePath))throw new Error('请先生成并预览15秒商品视频')
  const upload=await workspace.prepareEbayVideoUpload(`ebay:${draft.storeId}`,draft,task.video.filePath)
  task={...task,videoUpload:upload,reviseUrl:upload.reviseUrl,message:upload.message,updatedAt:new Date().toISOString()}
  task=appendEbayPublishAudit(task,'VIDEO_UPLOAD_PREPARED',upload.status==='FILE_SELECTED'?'SUCCESS':'WARNING',upload.message)
  return database.saveEbayPublishTask(task)
}

function ebayAcceptancePageDecision(snapshot:Pick<EbaySellerHubAcceptanceSnapshot,'pageStatus'>) {
  if(snapshot.pageStatus==='LOGIN_EXPIRED')return 'PAUSE_LOGIN'
  if(snapshot.pageStatus==='VERIFICATION_REQUIRED')return 'PAUSE_VERIFICATION'
  if(snapshot.pageStatus==='FIELDS_UNAVAILABLE')return 'PAUSE_FIELD_CHANGE'
  return 'CONTINUE'
}

function ebayAcceptanceScenarios(task?:EbayPublishTask):EbayAcceptanceScenarioResult[] {
  const recoveryPassed=Boolean(task?.video&&task.auditTrail?.some(event=>event.status==='FAILED')&&task.auditTrail?.some(event=>event.action==='VIDEO_GENERATED'&&event.status==='SUCCESS'))
  const cases:Array<{scenario:EbayAcceptanceScenarioResult['scenario'];actual:string;expected:string;detail:string}>=[
    {scenario:'LOGIN_EXPIRED',actual:ebayAcceptancePageDecision({pageStatus:'LOGIN_EXPIRED'}),expected:'PAUSE_LOGIN',detail:'识别登录框后立即暂停，不填写、不提交，并保留草稿。'},
    {scenario:'CAPTCHA',actual:ebayAcceptancePageDecision({pageStatus:'VERIFICATION_REQUIRED'}),expected:'PAUSE_VERIFICATION',detail:'识别验证码或安全验证后立即暂停，等待人工完成。'},
    {scenario:'FIELD_CHANGED',actual:ebayAcceptancePageDecision({pageStatus:'FIELDS_UNAVAILABLE'}),expected:'PAUSE_FIELD_CHANGE',detail:'关键字段或最终按钮不可读取时阻断，禁止继续提交。'},
    {scenario:'FAILURE_RECOVERY',actual:recoveryPassed?'RECOVERED':'NOT_PROVEN',expected:'RECOVERED',detail:recoveryPassed?'真实视频生成曾失败，修复后复用同一草稿成功生成，失败与恢复均已留痕。':'尚无可验证的失败后恢复记录。'}
  ]
  return cases.map(item=>({scenario:item.scenario,status:item.actual===item.expected?'PASSED':'FAILED',detail:item.detail}))
}

function acceptanceCheck(code:EbayAcceptanceCheck['code'],label:string,status:EbayAcceptanceCheck['status'],detail:string):EbayAcceptanceCheck {
  return {code,label,status,detail}
}

async function runEbayAcceptance(request:EbayAcceptanceRunRequest):Promise<EbayAcceptanceBatch> {
  if(!database||!workspace)throw new Error('验收工作区尚未初始化')
  const listings=database.getEbayListings(request.storeId)
  const drafts=database.getEbayOptimizationDrafts(request.storeId)
  const tasks=database.getEbayPublishTasks(request.storeId)
  const selected=request.mode==='SINGLE'
    ?listings.filter(listing=>listing.listingId===(request.draftId?drafts.find(draft=>draft.id===request.draftId)?.listingId:drafts[0]?.listingId)).slice(0,1)
    :listings.slice(0,10)
  if(!selected.length)throw new Error(request.mode==='SINGLE'?'当前没有可验收的优品草稿':'当前线上产品库没有商品')
  const items:EbayAcceptanceItemResult[]=[]
  let liveSnapshot:EbaySellerHubAcceptanceSnapshot|undefined
  for(const listing of selected){
    const draft=drafts.find(item=>item.listingId===listing.listingId)
    const task=draft?tasks.find(item=>item.draftId===draft.id):undefined
    const description=draft?.description.trim()||''
    const englishDescriptionReady=Boolean(description&&/[A-Za-z]{3}/.test(description)&&!/[\u4e00-\u9fff]/.test(description))
    const checks:EbayAcceptanceCheck[]=[
      acceptanceCheck('SOURCE_DATA','线上源数据',listing.title&&listing.categoryName&&listing.imageUrl?'PASSED':'BLOCKED',listing.title&&listing.categoryName&&listing.imageUrl?'标题、类目和主图已同步':'标题、类目或主图不完整'),
      acceptanceCheck('OPTIMIZATION_DRAFT','优品草稿',draft?'PASSED':'BLOCKED',draft?'已保存优化版本':'尚未完成AI优化并存入优品仓库'),
      acceptanceCheck('DESCRIPTION_MATCH','英文详情',englishDescriptionReady?'PASSED':'BLOCKED',!draft?'缺少优品草稿':!description?'英文详情为空':englishDescriptionReady?`已保存 ${description.length} 字符英文详情`:'当前详情不是可发布的纯英文内容，需重新优化并人工复核'),
      acceptanceCheck('COMPLIANCE_GATE','合规门禁',draft?.complianceGateStatus==='PASSED'||draft?.complianceGateStatus==='REVIEW_REQUIRED'&&Boolean(draft.complianceReviewedAt)?'PASSED':'BLOCKED',draft?.complianceGateStatus?`当前门禁 ${draft.complianceGateStatus}`:'缺少合规快照'),
      acceptanceCheck('PUBLISH_PREPARATION','发布准备',task?.status==='WAITING_CONFIRMATION'?'PASSED':'BLOCKED',task?`发布任务 ${task.status}`:'尚未执行 Seller Hub 自动填写'),
      acceptanceCheck('VIDEO_READY','商品视频',task?.video?.status==='READY'&&fs.existsSync(task.video.filePath)?'PASSED':'BLOCKED',task?.video?.status==='READY'?`${task.video.durationSeconds}秒 · ${task.video.width}×${task.video.height}`:'尚未生成可验收视频'),
      acceptanceCheck('FINAL_SUBMIT_GUARD','最终提交保护',task?.status==='WAITING_CONFIRMATION'?'PASSED':'WARNING',task?.status==='WAITING_CONFIRMATION'?'停留在待人工提交状态，系统未执行最终提交':'尚未进入待人工提交状态')
    ]
    if(request.mode==='SINGLE'&&draft){
      liveSnapshot=await workspace.inspectEbayListingAcceptance(`ebay:${request.storeId}`,draft)
      const decision=ebayAcceptancePageDecision(liveSnapshot)
      checks.push(acceptanceCheck('SELLER_HUB_SESSION','Seller Hub真实页面',decision==='CONTINUE'?'PASSED':'BLOCKED',decision==='CONTINUE'?`页面可读：${liveSnapshot.url}`:`页面保护状态：${decision}`))
      checks.push(acceptanceCheck('TITLE_MATCH','标题一致性',liveSnapshot.title===draft.selectedTitle?'PASSED':'BLOCKED',liveSnapshot.title===draft.selectedTitle?`线上表单标题与优品版本一致：${liveSnapshot.title}`:`表单“${liveSnapshot.title||'空'}”与优品“${draft.selectedTitle}”不一致`))
      checks.push(acceptanceCheck('DESCRIPTION_MATCH','Seller Hub描述一致性',englishDescriptionReady&&liveSnapshot.descriptionLength===description.length?'PASSED':'BLOCKED',`Seller Hub ${liveSnapshot.descriptionLength}字符 · 优品 ${description.length}字符${englishDescriptionReady?'':' · 优品详情不是可发布的纯英文内容'}`))
      const missing=liveSnapshot.requiredSpecifics.filter(item=>!item.value).map(item=>item.name)
      checks.push(acceptanceCheck('REQUIRED_SPECIFICS','必填属性',missing.length?'BLOCKED':'PASSED',missing.length?`缺失：${missing.join('、')}`:`页面读取 ${liveSnapshot.requiredSpecifics.length} 项必填属性，均有值`))
      checks.push(acceptanceCheck('VIDEO_READY','Seller Hub视频状态',/00:15/.test(liveSnapshot.videoStatus)?'PASSED':'WARNING',liveSnapshot.videoStatus||'页面未识别到15秒视频状态'))
    }
    const status:EbayAcceptanceItemResult['status']=checks.some(check=>check.status==='BLOCKED')?'BLOCKED':checks.some(check=>check.status==='WARNING')?'ATTENTION':'PASSED'
    items.push({listingId:listing.listingId,title:draft?.selectedTitle||listing.originalTitle||listing.title,draftId:draft?.id,status,checks,inspectedAt:new Date().toISOString()})
  }
  const primaryTask=request.draftId?tasks.find(task=>task.draftId===request.draftId):tasks[0]
  const scenarios=ebayAcceptanceScenarios(primaryTask)
  const passed=items.filter(item=>item.status==='PASSED').length
  const attention=items.filter(item=>item.status==='ATTENTION').length
  const blocked=items.filter(item=>item.status==='BLOCKED').length
  const status:EbayAcceptanceBatch['status']=blocked||scenarios.some(item=>item.status==='FAILED')?'BLOCKED':attention?'ATTENTION':'PASSED'
  const id=crypto.randomUUID(),createdAt=new Date().toISOString()
  const reportDirectory=path.join(app.getPath('userData'),'ebay-acceptance-reports')
  fs.mkdirSync(reportDirectory,{recursive:true})
  const reportPath=path.join(reportDirectory,`ebay-acceptance-${request.mode.toLowerCase()}-${createdAt.replace(/[:.]/g,'-')}.json`)
  const batch:EbayAcceptanceBatch={id,storeId:request.storeId,mode:request.mode,status,requested:request.mode==='SINGLE'?1:10,checked:items.length,passed,attention,blocked,items,scenarios,reportPath,createdAt}
  fs.writeFileSync(reportPath,JSON.stringify({...batch,liveSnapshot},null,2),'utf8')
  return database.saveEbayAcceptanceBatch(batch)
}

const ebayResearchStopWords=new Set(['a','an','and','are','as','at','be','by','for','from','in','into','is','it','new','of','on','or','the','to','with','your','you','this','that','item','product','sale','best','free','shipping'])

// 英文商品词简单词形归一：合并常见复数，避免 clock/clocks、frame/frames 分开计数稀释词频
function normalizeEbayResearchToken(token:string):string {
  if(token.length<=4)return token
  if(/(?:ch|sh|x)es$/.test(token))return token.slice(0,-2)
  if(/ies$/.test(token))return `${token.slice(0,-3)}y`
  if(/[bcdfgklmnprtvz]es$/.test(token))return token.slice(0,-1)
  if(/[bcdfghjklmnpqrtvwxz]s$/.test(token))return token.slice(0,-1)
  return token
}

function buildEbayMarketStats(samples:EbayMarketResearchSnapshot['samples'],factText:string,size:1|2):EbayMarketKeywordStat[] {
  const facts=new Set((factText.toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g)||[]).map(normalizeEbayResearchToken))
  const forbidden=/^(?:free shipping|best price|hot sale|lowest price|clearance)$/i
  const counts=new Map<string,number>()
  const scores=new Map<string,number>()
  for(const sample of samples) {
    const sold=Number((sample.soldQuantity||'').replace(/,/g,'').match(/\d+(?:\.\d+)?/)?.[0]||0)
    const sampleWeight=sold>0?1+Math.log10(sold+1):1
    const entries=(sample.title.toLowerCase().match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g)||[])
      .map((raw,index)=>({token:normalizeEbayResearchToken(raw),early:index<5}))
      .filter(entry=>entry.token.length>1&&!ebayResearchStopWords.has(entry.token)&&!/^[\d.]+$/.test(entry.token))
    const terms=new Map<string,boolean>()
    if(size===1)entries.forEach(entry=>terms.set(entry.token,Boolean(terms.get(entry.token))||entry.early))
    else for(let index=0;index<entries.length-1;index+=1){const term=`${entries[index].token} ${entries[index+1].token}`;terms.set(term,Boolean(terms.get(term))||entries[index].early)}
    terms.forEach((early,term)=>{
      counts.set(term,(counts.get(term)||0)+1)
      scores.set(term,(scores.get(term)||0)+sampleWeight*(early?1.5:1))
    })
  }
  return [...counts.entries()].sort((a,b)=>(scores.get(b[0])||0)-(scores.get(a[0])||0)||b[1]-a[1]||a[0].localeCompare(b[0])).slice(0,size===1?20:12).map(([term,count])=>{
    const factStatus:EbayMarketKeywordStat['factStatus']=forbidden.test(term)?'EXCLUDED':term.split(' ').every(token=>facts.has(token))?'CONFIRMED':'REVIEW'
    return {term,count,coverage:samples.length?Math.round(count/samples.length*100):0,factStatus,factSource:factStatus==='CONFIRMED'?'原商品标题或属性已确认':factStatus==='EXCLUDED'?'平台合规风险词，不用于标题':'市场成交词，需结合商品事实人工确认'}
  })
}

function prepareEbayMarketAnalysis(samples:EbayMarketResearchSnapshot['samples']) {
  const soldNumber=(value='')=>Number(value.replace(/,/g,'').match(/\d+(?:\.\d+)?/)?.[0]||0)
  const withOrder=samples.map((sample,index)=>({sample,index,sold:soldNumber(sample.soldQuantity)}))
  const soldQuantityEvidenceCount=withOrder.filter(item=>item.sold>0).length
  const rankingBasis:EbayMarketResearchSnapshot['rankingBasis']=soldQuantityEvidenceCount>=Math.min(5,Math.max(1,Math.ceil(samples.length*.1)))?'SOLD_QUANTITY':'EBAY_RESULT_ORDER'
  if(rankingBasis==='SOLD_QUANTITY')withOrder.sort((left,right)=>right.sold-left.sold||left.index-right.index)
  const unique=new Map<string,EbayMarketResearchSnapshot['samples'][number]>()
  for(const item of withOrder) {
    const key=item.sample.title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()
    if(key&&!unique.has(key))unique.set(key,item.sample)
  }
  const rankedSamples=[...unique.values()]
  return {rankedSamples,rawSampleCount:samples.length,analysisSampleCount:Math.min(50,rankedSamples.length),rankingBasis,soldQuantityEvidenceCount}
}

async function researchEbayMarket(request:EbayMarketResearchRequest):Promise<EbayMarketResearchSnapshot> {
  if(!database)throw new Error('数据库尚未初始化')
  const store=database.getEbayStores().find(item=>item.id===request.storeId)
  const listing=database.getEbayListings(request.storeId).find(item=>item.listingId===request.listingId)
  if(!store||!listing)throw new Error('eBay 店铺或线上产品不存在')
  const query=request.query.replace(/\s+/g,' ').trim()
  if(!query)throw new Error('请先填写能代表当前商品的核心商品词')
  const omkarSettings=readAmazonDataSource()
  const omkarKey=omkarSettings.encryptedApiKey&&safeStorage.isEncryptionAvailable()?safeStorage.decryptString(Buffer.from(omkarSettings.encryptedApiKey,'base64')):''
  const marketWorkspace=workspace
  const readEvidence=async(searchQuery:string)=>{
    if(omkarKey){
      const url=new URL(ebayScraperSearchEndpoint())
      url.searchParams.set('keyword',searchQuery);url.searchParams.set('marketplace','ebay.com');url.searchParams.set('page','1')
      const response=await fetch(url,{headers:{'API-Key':omkarKey},signal:AbortSignal.timeout(30_000)})
      const body=await response.json().catch(()=>({})) as {listings?:Array<Record<string,unknown>>;detail?:string;message?:string}
      if(!response.ok)throw new Error(`Omkar eBay Scraper 返回错误：${body.detail||body.message||`HTTP ${response.status}`}`)
      if(!Array.isArray(body.listings))throw new Error('Omkar eBay Scraper 返回格式异常')
      const numberValue=(value:unknown)=>{const parsed=Number(String(value??'').replace(/[^0-9.]/g,''));return Number.isFinite(parsed)?parsed:0}
      const samples:EbayMarketResearchSnapshot['samples']=body.listings.map(item=>{const price=item.price&&typeof item.price==='object'?item.price as Record<string,unknown>:{};const delivery=item.delivery_info&&typeof item.delivery_info==='object'?item.delivery_info as Record<string,unknown>:{};return {title:String(item.name||item.title||'').trim(),price:String(price.amount??item.price??''),currency:'USD',soldDate:'',url:String(item.url||''),imageUrl:String(item.image||''),itemId:String(item.listing_id||''),shipping:String(delivery.raw||delivery.extracted||''),condition:String(item.condition||''),soldQuantity:String(item.units_sold||'')}}).filter(item=>item.title&&item.url)
      const prices=samples.map(item=>numberValue(item.price)).filter(value=>value>0),sold=samples.reduce((total,item)=>total+numberValue(item.soldQuantity),0),shipping=samples.map(item=>numberValue(item.shipping)).filter(value=>value>0),freeShipping=samples.filter(item=>/free/i.test(item.shipping||'')).length
      const metric=(key:EbayMarketResearchSnapshot['metrics'][number]['key'],label:string,value:string,available:boolean):EbayMarketResearchSnapshot['metrics'][number]=>({key,label,value,available})
      return {source:'OMKAR_EBAY_SCRAPER' as const,sourceUrl:`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(searchQuery)}`,samples,metrics:[metric('TOTAL_SOLD','样本已售数',sold?String(sold):'',sold>0),metric('AVERAGE_SOLD_PRICE','样本平均价',prices.length?`USD ${(prices.reduce((a,b)=>a+b,0)/prices.length).toFixed(2)}`:'',prices.length>0),metric('SOLD_PRICE_RANGE','样本价格范围',prices.length?`USD ${Math.min(...prices).toFixed(2)} – ${Math.max(...prices).toFixed(2)}`:'',prices.length>0),metric('AVERAGE_SHIPPING','平均运费',shipping.length?`USD ${(shipping.reduce((a,b)=>a+b,0)/shipping.length).toFixed(2)}`:'',shipping.length>0),metric('FREE_SHIPPING_RATE','免运费样本',samples.length?`${Math.round(freeShipping/samples.length*100)}%`:'',samples.length>0),metric('SELL_THROUGH_RATE','售出率','',false),metric('SELLER_COUNT','卖家数','',false)]}
    }
    if(!marketWorkspace)throw new Error('请先在 AI总部配置 Omkar API Key，或打开 eBay 店铺浏览器')
    const read=()=>marketWorkspace.readEbayMarketResearch(`ebay:${store.id}`,{
      query:searchQuery,
      categoryId:listing.categoryId,
      condition:listing.condition||'',
      marketplaceId:listing.marketplaceId,
      periodDays:request.periodDays
    })
    try {
      return await read()
    } catch(error) {
      if(!(error instanceof Error&&/登录会话已失效/.test(error.message)))throw error
      await ensureEbayStoreLogin(request.storeId)
      return read()
    }
  }
  let evidence=await readEvidence(query)
  let analysis=prepareEbayMarketAnalysis(evidence.samples)
  let queryBroadened=''
  const queryWords=query.split(' ')
  if(analysis.rankedSamples.length<20&&queryWords.length>2){
    const broaderQuery=queryWords.slice(1).join(' ')
    try {
      const broaderEvidence=await readEvidence(broaderQuery)
      const broaderAnalysis=prepareEbayMarketAnalysis(broaderEvidence.samples)
      if(broaderAnalysis.rankedSamples.length>analysis.rankedSamples.length){
        evidence=broaderEvidence
        analysis=broaderAnalysis
        queryBroadened=`${query} → ${broaderQuery}`
      }
    } catch { /* 放宽检索失败时保留原查询结果 */ }
  }
  const analysisSamples=analysis.rankedSamples.slice(0,analysis.analysisSampleCount)
  const conditionFact=(listing.condition||'').split(/[:.]/)[0].trim().slice(0,40)
  const factText=[listing.originalTitle,listing.title,listing.categoryName,conditionFact,...(listing.itemSpecifics||[]).flatMap(item=>[item.name,item.value])].filter(Boolean).join(' ')
  const titles=analysisSamples.map(item=>item.title).filter(Boolean)
  const availableMetrics=evidence.metrics.filter(item=>item.available)
  const metric=(key:EbayMarketResearchSnapshot['metrics'][number]['key'])=>evidence.metrics.find(item=>item.key===key)
  const findings:EbayMarketResearchFinding[]=[
    {
      key:'DATA_QUALITY',title:'数据完整度',
      conclusion:availableMetrics.length>=5&&analysis.analysisSampleCount>=20?'本次数据可直接作为标题决策依据':analysis.analysisSampleCount>=20?'标题样本充足，但销量与汇总指标仍需人工核对':'本次数据只能用于初步判断，建议补充更多有效样本',
      evidence:`已取得 ${availableMetrics.length}/7 项市场指标、${analysis.rankedSamples.length} 个去重样本，前 ${analysis.analysisSampleCount} 个进入标题分析`,
      level:availableMetrics.length>=5&&analysis.analysisSampleCount>=20?'POSITIVE':'ATTENTION'
    },
    {
      key:'PRICE',title:'成交价格带',
      conclusion:metric('SOLD_PRICE_RANGE')?.available?'标题应突出能支撑目标价格带的材质、尺寸与差异点':'当前页面未提供完整售价范围',
      evidence:metric('SOLD_PRICE_RANGE')?.available?`真实售价范围：${metric('SOLD_PRICE_RANGE')?.value}`:'缺少售价范围指标',
      level:metric('SOLD_PRICE_RANGE')?.available?'INFO':'ATTENTION'
    },
    {
      key:'DEMAND',title:'市场需求',
      conclusion:metric('SELL_THROUGH_RATE')?.available?'以售出率判断关键词需求强弱，并结合样本量避免误判':'当前页面未提供售出率',
      evidence:metric('SELL_THROUGH_RATE')?.available?`真实售出率：${metric('SELL_THROUGH_RATE')?.value}`:'缺少售出率指标',
      level:metric('SELL_THROUGH_RATE')?.available?'INFO':'ATTENTION'
    },
    {
      key:'COMPETITION',title:'竞争强度',
      conclusion:metric('SELLER_COUNT')?.available?'卖家数量只反映竞争规模，标题仍应优先真实属性与高频成交词交集':'当前页面未提供卖家总数',
      evidence:metric('SELLER_COUNT')?.available?`真实卖家总数：${metric('SELLER_COUNT')?.value}`:'缺少卖家数量指标',
      level:'INFO'
    },
    {
      key:'SHIPPING',title:'配送策略',
      conclusion:metric('FREE_SHIPPING_RATE')?.available?'可将包邮率与平均运费纳入价格及转化判断，不直接写入标题':'配送指标不足，不对标题作配送承诺',
      evidence:[metric('AVERAGE_SHIPPING'),metric('FREE_SHIPPING_RATE')].filter(item=>item?.available).map(item=>`${item?.label} ${item?.value}`).join('；')||'缺少配送指标',
      level:metric('FREE_SHIPPING_RATE')?.available?'INFO':'ATTENTION'
    },
    {
      key:'TITLE',title:'标题词机会',
      conclusion:titles.length?'仅使用前排有效样本高频词与当前商品事实的交集，待核对词需人工确认':'尚未取得可分析的成交标题样本',
      evidence:titles.length?`已分析前 ${titles.length} 个真实成交标题；${analysis.rankingBasis==='SOLD_QUANTITY'?'按页面已售数量排序':'页面未提供足够销量字段，按 eBay 成交结果顺序'}`:'无成交标题样本',
      level:titles.length?'POSITIVE':'ATTENTION'
    }
  ]
  const snapshot:EbayMarketResearchSnapshot={
    id:crypto.randomUUID(),storeId:request.storeId,listingId:request.listingId,marketplaceId:listing.marketplaceId,
    categoryId:listing.categoryId,categoryName:listing.categoryName,condition:listing.condition||'',query,periodDays:request.periodDays,
    source:evidence.source,sourceUrl:evidence.sourceUrl,fetchedAt:new Date().toISOString(),captureMode:'AUTOMATIC',rawSampleCount:analysis.rawSampleCount,sampleCount:analysis.rankedSamples.length,
    analysisSampleCount:analysis.analysisSampleCount,rankingBasis:analysis.rankingBasis,soldQuantityEvidenceCount:analysis.soldQuantityEvidenceCount,
    metrics:evidence.metrics,samples:analysis.rankedSamples,filters:[
      {label:'采集方式',value:evidence.source==='OMKAR_EBAY_SCRAPER'?'Omkar eBay Scraper API':evidence.source==='EBAY_PRODUCT_RESEARCH'?'eBay Product Research':'eBay Sold & Completed'},
      ...(queryBroadened?[{label:'查询词自动放宽',value:queryBroadened}]:[]),
      {label:'原始结果',value:`读取 ${analysis.rawSampleCount} 个，去重后 ${analysis.rankedSamples.length} 个`},
      {label:'标题分析池',value:`前 ${analysis.analysisSampleCount} 个有效样本`},
      {label:'排序依据',value:analysis.rankingBasis==='SOLD_QUANTITY'?'页面已售数量':'eBay 成交结果顺序（无充足销量字段）'}
    ],findings,keywords:buildEbayMarketStats(analysisSamples,factText,1),combinations:buildEbayMarketStats(analysisSamples,factText,2)
  }
  return database.recordEbayMarketResearch(snapshot)
}

async function ensureEbayStoreLogin(storeId:string) {
  if(!database)throw new Error('数据库尚未初始化')
  if(!workspace)throw new Error('应用内浏览器尚未初始化')
  const accountId=`ebay:${storeId}`
  const row=database.getMarketplaceCredential(accountId)
  let password=''
  if(row?.encrypted_password) {
    if(!safeStorage.isEncryptionAvailable())throw new Error('当前系统无法解密eBay登录凭据')
    password=safeStorage.decryptString(Buffer.from(row.encrypted_password,'base64'))
  }
  return workspace.ensureEbayLogin(accountId,row?.username||'',password,row?.automation_mode==='AUTO_FILL')
}

async function syncEbayStoreCategories(storeId:string) {
  if(!database)throw new Error('数据库尚未初始化')
  if(!workspace)throw new Error('应用内浏览器尚未初始化')
  const store=database.getEbayStores().find(item=>item.id===storeId)
  if(!store)throw new Error('eBay 店铺不存在')
  const categories=await workspace.readEbayStoreCategories(`ebay:${storeId}`)
  return database.saveEbayStoreCategories(storeId,categories)
}

async function authorizeEbayStore(storeId:string) {
  if(!database)throw new Error('数据库尚未初始化')
  if(!ebayService.configuration().configured)throw new Error('请先在 .env.local 配置 EBAY_CLIENT_ID、EBAY_CLIENT_SECRET 和 EBAY_RUNAME')
  if(!safeStorage.isEncryptionAvailable())throw new Error('当前系统安全存储不可用，不能保存 eBay 令牌')
  const state=crypto.randomUUID()
  const authWindow=new BrowserWindow({width:920,height:760,title:'连接 eBay 正式店铺',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}})
  const code=await new Promise<string>((resolve,reject)=>{
    let completed=false
    const inspect=(event:Electron.Event,url:string)=>{
      let parsed:URL
      try{parsed=new URL(url)}catch{return}
      const returnedState=parsed.searchParams.get('state')
      const error=parsed.searchParams.get('error_description')||parsed.searchParams.get('error')
      const authorizationCode=parsed.searchParams.get('code')
      if(!error&&!authorizationCode)return
      event.preventDefault();completed=true
      if(returnedState!==state)reject(new Error('eBay授权状态校验失败，请重新连接店铺'))
      else if(error)reject(new Error(`eBay授权未完成：${error}`))
      else resolve(authorizationCode!)
      authWindow.close()
    }
    authWindow.webContents.on('will-redirect',inspect)
    authWindow.webContents.on('will-navigate',inspect)
    authWindow.on('closed',()=>{if(!completed)reject(new Error('已取消 eBay 店铺授权'))})
    void authWindow.loadURL(ebayService.authorizationUrl(state)).catch(reject)
  })
  const tokens=await ebayService.exchangeCode(code)
  database.saveEbayAuthorization(storeId,{encryptedAccessToken:safeStorage.encryptString(tokens.accessToken).toString('base64'),encryptedRefreshToken:safeStorage.encryptString(tokens.refreshToken).toString('base64'),accessTokenExpiresAt:tokens.accessTokenExpiresAt,refreshTokenExpiresAt:tokens.refreshTokenExpiresAt})
  return database.getEbayStores().find(store=>store.id===storeId)
}

async function ebayAccessToken(storeId:string) {
  if(!database)throw new Error('数据库尚未初始化')
  if(!safeStorage.isEncryptionAvailable())throw new Error('当前系统安全存储不可用，不能读取 eBay 令牌')
  const row=database.getEbayTokenRecord(storeId)
  if(!row?.encrypted_refresh_token)throw new Error('当前店铺尚未完成 eBay 正式环境授权')
  if(row.encrypted_access_token&&Date.parse(row.access_token_expires_at)>Date.now()+60_000)return safeStorage.decryptString(Buffer.from(row.encrypted_access_token,'base64'))
  if(Date.parse(row.refresh_token_expires_at)<=Date.now())throw new Error('eBay 店铺授权已过期，请重新授权')
  const refreshToken=safeStorage.decryptString(Buffer.from(row.encrypted_refresh_token,'base64'))
  const refreshed=await ebayService.refreshAccessToken(refreshToken)
  database.updateEbayAccessToken(storeId,safeStorage.encryptString(refreshed.accessToken).toString('base64'),refreshed.accessTokenExpiresAt)
  return refreshed.accessToken
}

function create1688SearchUrl(keyword: string) {
  const normalized = keyword.normalize('NFKC').trim()
  if (!normalized) throw new Error('请输入1688搜索关键词')
  const encoded = [...iconv.encode(normalized, 'gbk')].map(byte => `%${byte.toString(16).padStart(2, '0').toUpperCase()}`).join('')
  return `https://s.1688.com/selloffer/offer_search.htm?keywords=${encoded}&charset=gbk`
}

async function syncCpscRecalls() {
  if(!database)throw new Error('数据库尚未初始化')
  const sourceId='source-cpsc'
  try{
    const response=await fetch('https://www.saferproducts.gov/RestWebServices/Recall?format=json',{headers:{Accept:'application/json'}})
    if(!response.ok)throw new Error(`CPSC 接口返回 ${response.status}`)
    const payload=await response.json() as unknown
    const rows=(Array.isArray(payload)?payload:[]) as Array<Record<string,unknown>>
    const text=(value:unknown)=>Array.isArray(value)?value.map(item=>typeof item==='object'&&item?Object.values(item as Record<string,unknown>).filter(entry=>typeof entry==='string').join(' '):String(item)).join('；'):value?String(value):''
    const items: Array<Omit<ComplianceRecall,'id'|'sourceId'|'updatedAt'>>=rows.slice(0,500).map((row,index)=>{
      const externalId=String(row.RecallID||row.RecallNumber||index)
      return {externalId,title:text(row.Title||row.Description)||`CPSC Recall ${externalId}`,description:text(row.Description),products:text(row.Products),hazards:text(row.Hazards),countries:'US',recallDate:text(row.RecallDate||row.LastPublishDate),sourceUrl:text(row.URL)||'https://www.cpsc.gov/Recalls'}
    })
    const imported=database.importComplianceRecalls(sourceId,items)
    const recheck=database.recheckComplianceProfiles('EBAY','US')
    return {imported,recheck,workspace:database.getComplianceKnowledgeWorkspace()}
  }catch(error){const message=error instanceof Error?error.message:'CPSC 同步失败';database.markComplianceSourceError(sourceId,message);throw error}
}

function decodeXmlText(value:string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/&amp;/g,'&')
    .replace(/&lt;/g,'<')
    .replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"')
    .replace(/&#39;|&apos;/g,"'")
    .replace(/&#(\d+);/g,(_match,code)=>String.fromCodePoint(Number(code)))
}

function stripHtml(value:string) {
  return decodeXmlText(value)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\s+/g,' ')
    .trim()
}

function xmlElement(block:string,name:string) {
  const match=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))
  return match?stripHtml(match[1]):''
}

function xmlLink(block:string) {
  return decodeXmlText(block.match(/<link\b[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i)?.[1]
    ||block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?>/i)?.[1]
    ||'')
}

function extractHtmlSection(body:string,heading:string) {
  const match=body.match(new RegExp(`<h[23][^>]*>\\s*${heading}\\s*<\\/h[23]>([\\s\\S]*?)(?=<h[23][^>]*>|$)`,'i'))
  return match?stripHtml(match[1]):''
}

async function syncUkOpssRecalls() {
  if(!database)throw new Error('数据库尚未初始化')
  const sourceId='source-uk-opss'
  try{
    const feedResponse=await fetch('https://www.gov.uk/product-safety-alerts-reports-recalls.atom',{headers:{Accept:'application/atom+xml'}})
    if(!feedResponse.ok)throw new Error(`UK OPSS Atom 返回 ${feedResponse.status}`)
    const feed=await feedResponse.text()
    const entries=[...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map(match=>match[1]).slice(0,100)
    if(!entries.length)throw new Error('UK OPSS Atom 未返回召回记录')
    const items:Array<Omit<ComplianceRecall,'id'|'sourceId'|'updatedAt'>>=[]
    for(let offset=0;offset<entries.length;offset+=8){
      const batch=entries.slice(offset,offset+8)
      const resolved=await Promise.all(batch.map(async(entry,index)=>{
        const sourceUrl=xmlLink(entry)
        const fallbackId=xmlElement(entry,'id')||`opss-${offset+index}`
        const externalId=(sourceUrl.split('/').filter(Boolean).pop()||fallbackId).replace(/^tag:www\.gov\.uk,2005:/,'')
        const title=xmlElement(entry,'title')||`UK OPSS ${externalId}`
        const updated=xmlElement(entry,'updated')
        let description=''
        let products=title
        let hazards=''
        let recallDate=updated.slice(0,10)
        if(sourceUrl.startsWith('https://www.gov.uk/')){
          const apiUrl=`https://www.gov.uk/api/content${new URL(sourceUrl).pathname}`
          try{
            const detailResponse=await fetch(apiUrl,{headers:{Accept:'application/json'}})
            if(detailResponse.ok){
              const detail=await detailResponse.json() as {description?:string;first_published_at?:string;details?:{body?:string;metadata?:{product_recall_alert_date?:string}}}
              const body=detail.details?.body||''
              description=stripHtml(detail.description||'')
              products=extractHtmlSection(body,'Product information')||extractHtmlSection(body,'Summary')||title
              hazards=extractHtmlSection(body,'Hazard')||description
              recallDate=detail.details?.metadata?.product_recall_alert_date||detail.first_published_at?.slice(0,10)||recallDate
            }
          }catch(error){
            console.warn('[compliance] UK OPSS detail skipped:',error instanceof Error?error.message:error)
          }
        }
        return {externalId,title,description,products,hazards,countries:'GB',recallDate,sourceUrl:sourceUrl||'https://www.gov.uk/product-safety-alerts-reports-recalls'}
      }))
      items.push(...resolved)
    }
    const imported=database.importComplianceRecalls(sourceId,items)
    const recheck=database.recheckComplianceProfiles('EBAY','GB')
    return {imported,recheck,workspace:database.getComplianceKnowledgeWorkspace()}
  }catch(error){const message=error instanceof Error?error.message:'UK OPSS 同步失败';database.markComplianceSourceError(sourceId,message);throw error}
}

function xmlBlocks(body:string,name:string) {
  return [...body.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'gi'))].map(match=>match[1])
}

function europeanDate(value:string) {
  const match=value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  return match?`${match[3]}-${match[2].padStart(2,'0')}-${match[1].padStart(2,'0')}`:value
}

async function syncEuSafetyGateRecalls() {
  if(!database)throw new Error('数据库尚未初始化')
  const sourceId='source-eu-safety-gate'
  try{
    const listUrl='https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en'
    const listResponse=await fetch(listUrl,{headers:{Accept:'application/xml','User-Agent':'Mozilla/5.0'}})
    if(!listResponse.ok)throw new Error(`EU Safety Gate 周报接口返回 ${listResponse.status}`)
    const reports=xmlBlocks(await listResponse.text(),'weeklyReport').slice(0,12)
    if(!reports.length)throw new Error('EU Safety Gate 未返回周报目录')
    const reportUrls=reports.map(report=>xmlElement(report,'URL')).filter(url=>url.startsWith('https://ec.europa.eu/'))
    const items:Array<Omit<ComplianceRecall,'id'|'sourceId'|'updatedAt'>>=[]
    for(let offset=0;offset<reportUrls.length;offset+=4){
      const batch=await Promise.all(reportUrls.slice(offset,offset+4).map(async url=>{
        const response=await fetch(url,{headers:{Accept:'application/xml','User-Agent':'Mozilla/5.0'}})
        if(!response.ok)throw new Error(`EU Safety Gate 周报返回 ${response.status}`)
        const body=await response.text()
        const recallDate=europeanDate(xmlElement(body,'report_date'))
        return xmlBlocks(body,'notifications').map(notification=>{
          const externalId=xmlElement(notification,'caseNumber')
          const reference=xmlElement(notification,'reference')
          const product=xmlElement(notification,'product')
          const brand=xmlElement(notification,'brand')
          const name=xmlElement(notification,'name')
          const category=xmlElement(notification,'category')
          const model=xmlElement(notification,'type_numberOfModel')
          const batchNumber=xmlElement(notification,'batchNumber')
          const barcode=xmlElement(notification,'barcode')
          const description=xmlElement(notification,'description')
          const riskType=xmlElement(notification,'riskType')
          const danger=xmlElement(notification,'danger')
          return {
            externalId,
            title:[product,brand,name].filter(Boolean).join(' · ')||externalId,
            description,
            products:[category,product,brand,name,model,batchNumber,barcode].filter(Boolean).join('；'),
            hazards:[riskType,danger].filter(Boolean).join('：'),
            countries:'EU',
            recallDate,
            sourceUrl:reference||'https://ec.europa.eu/safety-gate-alerts/screen/webReport'
          }
        }).filter(item=>Boolean(item.externalId))
      }))
      batch.forEach(entries=>items.push(...entries))
    }
    const unique=[...new Map(items.map(item=>[item.externalId,item])).values()].slice(0,500)
    if(!unique.length)throw new Error('EU Safety Gate 周报没有可导入的预警记录')
    const imported=database.importComplianceRecalls(sourceId,unique)
    const recheck=database.recheckComplianceProfiles('EBAY','ALL')
    return {imported,recheck,workspace:database.getComplianceKnowledgeWorkspace()}
  }catch(error){const message=error instanceof Error?error.message:'EU Safety Gate 同步失败';database.markComplianceSourceError(sourceId,message);throw error}
}

function normalizedPolicyText(html:string) {
  return decodeXmlText(html)
    .replace(/<script[\s\S]*?<\/script>/gi,' ')
    .replace(/<style[\s\S]*?<\/style>/gi,' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi,' ')
    .replace(/<!--[\s\S]*?-->/g,' ')
    .replace(/<[^>]+>/g,' ')
    .replace(/\b(?:session|request|trace|nonce|timestamp)[-_ ]?id\b[=: ]+[a-z0-9_-]+/gi,' ')
    .replace(/\s+/g,' ')
    .trim()
}

async function syncPlatformPolicySource(sourceId:string) {
  if(!database)throw new Error('数据库尚未初始化')
  const source=database.getComplianceKnowledgeWorkspace().sources.find(item=>item.id===sourceId)
  if(!source||source.sourceType!=='PLATFORM')throw new Error('平台政策来源不存在')
  try{
    const response=await fetch(source.url,{headers:{Accept:'text/html,application/xhtml+xml','Accept-Language':'en-US,en;q=0.8','User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/136 Safari/537.36'}})
    if(!response.ok)throw new Error(`${source.name} 返回 ${response.status}`)
    const text=normalizedPolicyText(await response.text())
    if(text.length<500||/(captcha|access denied|verify you are human|unusual traffic)/i.test(text))throw new Error(`${source.name} 未返回可验证的政策正文`)
    const contentHash=createHash('sha256').update(text).digest('hex')
    const snapshot=database.recordCompliancePolicySnapshot(sourceId,contentHash,`检测到 ${source.name} 官方页面内容指纹变化`)
    const platform=sourceId==='source-ebay'?'EBAY':sourceId==='source-ozon'?'OZON':'ALIEXPRESS'
    const recheck=snapshot.changed?database.recheckComplianceProfiles(platform,'ALL'):undefined
    return {...snapshot,recheck,workspace:database.getComplianceKnowledgeWorkspace()}
  }catch(error){const message=error instanceof Error?error.message:`${source.name} 检测失败`;database.markComplianceSourceError(sourceId,message);throw error}
}

function syncOfficialRecalls(sourceId:string) {
  if(sourceId==='source-cpsc')return syncCpscRecalls()
  if(sourceId==='source-uk-opss')return syncUkOpssRecalls()
  if(sourceId==='source-eu-safety-gate')return syncEuSafetyGateRecalls()
  throw new Error('当前召回来源不支持自动同步')
}

function syncComplianceSource(sourceId:string) {
  if(['source-cpsc','source-uk-opss','source-eu-safety-gate'].includes(sourceId))return syncOfficialRecalls(sourceId)
  if(['source-ebay','source-ozon','source-aliexpress'].includes(sourceId))return syncPlatformPolicySource(sourceId)
  throw new Error('当前合规来源不支持自动检测')
}

function scheduleComplianceSourceSync() {
  if(!database||complianceSyncScheduled)return
  complianceSyncScheduled=true
  const sourceIds=['source-cpsc','source-uk-opss','source-eu-safety-gate','source-ebay','source-ozon','source-aliexpress']
  const sync=()=>{for(const sourceId of sourceIds)void syncComplianceSource(sourceId).catch(error=>console.warn(`[compliance] ${sourceId} background sync failed:`,error instanceof Error?error.message:error))}
  const sources=database.getComplianceKnowledgeWorkspace().sources
  const stale=sourceIds.some(sourceId=>{const source=sources.find(item=>item.id===sourceId);return !source?.lastCheckedAt||Date.now()-Date.parse(source.lastCheckedAt)>24*60*60*1000})
  if(stale)setTimeout(sync,2_000)
  complianceSyncTimer=setInterval(sync,24*60*60*1000)
  complianceSyncTimer.unref()
}

const hasSingleInstanceLock = process.env.CODEX_UI_TEST==='1'||app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

// 原生单实例锁在部分 macOS 环境实测失效（曾出现双窗口并存），加固定端口硬锁兜底：
// 端口被占 → 主实例已存在 → 通知其置前后本实例退出；验证场景（CODEX_UI_TEST / --user-data-dir）豁免
const SINGLE_INSTANCE_PORT = 47823
const skipInstanceGuard = process.env.CODEX_UI_TEST === '1' || process.argv.some(arg => arg.startsWith('--user-data-dir'))
const instanceGuard: Promise<boolean> = skipInstanceGuard ? Promise.resolve(true) : new Promise(resolve => {
  const server = nodeNet.createServer(() => {
    if (mainWindow) { mainWindow.restore(); mainWindow.focus() }
  })
  server.once('error', () => {
    const client = nodeNet.connect(SINGLE_INSTANCE_PORT, '127.0.0.1', () => client.end())
    client.on('error', () => undefined)
    resolve(false)
  })
  server.listen(SINGLE_INSTANCE_PORT, '127.0.0.1', () => resolve(true))
})
void instanceGuard.then(ok => { if (!ok) app.quit() })

let mediaProtocolReady=false
function registerMediaProtocol() {
  if(mediaProtocolReady)return
  mediaProtocolReady=true
  protocol.handle('cross-media',request=>{
    const url=new URL(request.url)
    const root=url.hostname==='ebay'
      ?path.join(app.getPath('userData'),'ebay-videos')
      :url.hostname==='local'
        ?path.join(app.getPath('userData'),'ebay-local-products')
        :url.hostname==='watch'
          ?path.join(app.getPath('userData'),'watch-skill-results')
        :''
    if(!root)return new Response('Not found',{status:404})
    const filePath=url.hostname==='ebay'
      ?path.resolve(root,decodeURIComponent(url.pathname.slice(1)))
      :decodeURIComponent(url.pathname.slice(1))
    if(!filePath.startsWith(`${root}${path.sep}`)||!fs.existsSync(filePath))return new Response('Not found',{status:404})
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function createWindow() {
  registerMediaProtocol()
  database ??= new AppDatabase()
  scheduleComplianceSourceSync()
  mainWindow = new BaseWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    title: '砚都跨境',
    // 隐藏原生标题栏，由渲染层自绘 56px 顶栏（与豆包顶栏同高）；红绿灯垂直居中于顶栏
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 22 }
  })

  const shell = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.contentView.addChildView(shell)

  const resizeShell = () => {
    const [width, height] = mainWindow?.getContentSize() ?? [1440, 900]
    shell.setBounds({ x: 0, y: 0, width, height })
  }
  resizeShell()
  mainWindow.on('resize', resizeShell)

  shellWebContents = shell.webContents
  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) void shell.webContents.loadURL(devUrl)
  else void shell.webContents.loadFile(path.join(__dirname, '../../renderer/index.html'))

  shell.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
    if (/\b(error|exception|failed)\b/i.test(message)) console.error(`[renderer:${line}] ${message} (${sourceId})`)
  })
  shell.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer] process gone: ${details.reason} (exit ${details.exitCode})`)
  })

  // Windows 下无原生窗口控制按钮，向渲染层推送最大化状态以切换图标
  mainWindow.on('maximize', () => shellWebContents?.send('window:maximized', true))
  mainWindow.on('unmaximize', () => shellWebContents?.send('window:maximized', false))

  workspace = new BrowserWorkspace(mainWindow, shell.webContents)
  startFeishuBot()
  mainWindow.on('closed', () => {
    mainWindow = null
    shellWebContents = null
    workspace = null
  })
}

function prepareTask(task: SelectionTask) {
  task.collectionProtectionEnabled ??= true
  task.collectionProtectionMode ??= 'STANDARD'
  task.collectionBatchSize ??= 12
  task.collectionRestMinSeconds ??= 20
  task.collectionRestMaxSeconds ??= 45
  task.collectionMaxRunMinutes ??= 20
  task.collectionAutoPause ??= true
  if (task.marketplacePlatform !== 'OZON') throw new Error('当前平台浏览器和账号隔离已接入，自动采集器正在接入中')
  if (!task.keyword.trim() && task.collectionMethod === 'KEYWORD') throw new Error('请先填写搜索关键词')
  if (!workspace) throw new Error('浏览器尚未初始化')
}

async function collectTaskItems(task: SelectionTask, onProgress: (message: string, count: number) => void): Promise<{ products: CollectedOzonProduct[]; supplyProducts: CollectedSupplyProduct[] }> {
  if (!workspace) throw new Error('浏览器尚未初始化')
  if (task.selectionMode === 'FORWARD_SUPPLY') {
    const supplyPlatform = task.supplyPlatforms[0]
    if (!['1688','GIGACLOUD'].includes(supplyPlatform)) throw new Error('当前供应链平台仅完成浏览器接入，商品采集器尚未接入')
    if (supplyPlatform === '1688' && task.collectionMethod !== 'KEYWORD') throw new Error('1688单链接和类目页采集暂未接入，请先使用关键词采集')
    const supplyProducts = supplyPlatform === 'GIGACLOUD'
      ? await workspace.collectGigaList(task.sourceUrl || 'https://www.gigab2b.com/index.php?route=common/home', task, onProgress)
      : await workspace.collect1688List(create1688SearchUrl(task.keyword), task, onProgress)
    if (!supplyProducts.length) throw new Error(`${supplyPlatform === 'GIGACLOUD' ? '大健云仓' : '1688'}页面已打开，但没有解析到商品卡片。请确认商品列表已加载后重试`)
    return { products: [], supplyProducts }
  }
  return { products: await workspace.collectOzonList(task.keyword, task.maxProducts, task, onProgress), supplyProducts: [] }
}

async function previewTask(task: SelectionTask, onProgress: (progress: TaskProgress) => void): Promise<CollectionPreviewResult> {
  prepareTask(task)
  if (runningTaskId) throw new Error(`已有任务正在执行：${runningTaskId}`)
  runningTaskId = task.id
  const emit = (stage: SelectionTask['stage'], message: string, collected = 0) => {
    task.stage = stage
    database?.saveTask(task)
    onProgress({ taskId: task.id, stage, message, collected })
  }
  try {
    emit('PREVIEW_RUNNING', '正在预采集商品')
    const result = await collectTaskItems(task, (message, count) => emit('PREVIEW_RUNNING', message, count))
    const count = result.products.length + result.supplyProducts.length
    emit('PREVIEW_READY', `预采集完成：${count} 个商品，等待筛选确认`, count)
    return { task, ...result }
  } catch (error) {
    const message=error instanceof Error ? error.message : '采集失败'
    emit(message.startsWith('采集保护已暂停')?'PAUSED':'FAILED', message)
    throw error
  } finally { runningTaskId = null }
}

async function executeTask(task: SelectionTask, onProgress: (progress: TaskProgress) => void, selectedUrls?: string[]) {
  prepareTask(task)
  if (runningTaskId) throw new Error(`已有任务正在执行：${runningTaskId}`)
  if (selectedUrls && !selectedUrls.length) throw new Error('请至少选择一个预采集商品')
  runningTaskId = task.id
  const selectedSet = selectedUrls ? new Set(selectedUrls) : null
  const emit = (stage: SelectionTask['stage'], message: string, collected = 0) => {
    task.stage = stage
    database?.saveTask(task)
    onProgress({ taskId: task.id, stage, message, collected })
  }
  try {
    emit('CONFIRM_RUNNING', '正在执行正式采集')
    const result = await collectTaskItems(task, (message, count) => emit('CONFIRM_RUNNING', message, count))
    if (task.selectionMode === 'FORWARD_SUPPLY') {
      const items = selectedSet ? result.supplyProducts.filter(item => selectedSet.has(item.url)) : result.supplyProducts
      if (!items.length) throw new Error('正式采集未匹配到已选商品，请重新预采集后再试')
      database?.saveSupplyProducts(task.id, items)
      const selected = items.filter(item => item.selected).length
      emit('SUPPLY_LIST_COMPLETED', `正式采集完成：${items.length} 个商品已进入采集侯选`, items.length)
      return { task, collected: items.length, selected }
    }
    const items = selectedSet ? result.products.filter(item => selectedSet.has(item.url)) : result.products
    if (!items.length) throw new Error('正式采集未匹配到已选商品，请重新预采集后再试')
    database?.saveProducts(task.id, items)
    emit('OZON_LIST_COMPLETED', `正式采集完成：${items.length} 个商品已进入采集侯选`, items.length)
    return { task, collected: items.length, selected: 0 }
  } catch (error) {
    const message=error instanceof Error ? error.message : '采集失败'
    emit(message.startsWith('采集保护已暂停')?'PAUSED':'FAILED', message)
    throw error
  } finally { runningTaskId = null }
}

function startFeishuBot() {
  if (feishuBot || !workspace || !database) return
  const appId = process.env.FEISHU_APP_ID || ''
  const appSecret = process.env.FEISHU_APP_SECRET || ''
  if (!appId || !appSecret) return console.info('飞书机器人未启用：未配置 FEISHU_APP_ID / FEISHU_APP_SECRET')
  feishuBot = new FeishuBotService(appId, appSecret, {
    getLatestTask: () => database?.getLatestWorkspace()?.task ?? null,
    createAndRunTask: async draft => {
      const task: SelectionTask = { ...draft, id: crypto.randomUUID(), stage: 'OZON_LIST_PENDING', createdAt: new Date().toISOString() }
      tasks.set(task.id, task)
      database?.saveTask(task)
      return executeTask(task, () => undefined)
    }
  })
  void feishuBot.start().catch(error => { console.error('飞书机器人长连接启动失败', error); feishuBot = null })
}

ipcMain.handle('browser:show', (_event, platform: Platform) => workspace?.show(platform))
ipcMain.handle('browser:hide', () => workspace?.hide())
ipcMain.handle('browser:bounds', (_event, bounds: BrowserBounds) => workspace?.setBounds(bounds))
ipcMain.handle('browser:navigate', (_event, platform: Platform, url: string) => workspace?.navigate(platform, url))
ipcMain.handle('browser:back', (_event, platform: Platform) => workspace?.goBack(platform))
ipcMain.handle('browser:forward', (_event, platform: Platform) => workspace?.goForward(platform))
ipcMain.handle('browser:reload', (_event, platform: Platform) => workspace?.reload(platform))
ipcMain.handle('browser:state:get', (_event, platform: Platform) => workspace?.getState(platform))
ipcMain.handle('browser:supply:activate', async (_event, platformCode: '1688' | 'GIGACLOUD') => {
  if (!workspace) throw new Error('采集浏览器尚未初始化')
  const activationVersion = await workspace.activateSupplyPlatform(platformCode)
  if (activationVersion === null) return { platformCode, loginStatus:platformCode==='1688'?'NOT_APPLICABLE':'UNKNOWN', message:'已取消过期的仓库加载请求', url:'', autoLoginAttempted:false }
  if (platformCode === '1688') return { platformCode, loginStatus:'NOT_APPLICABLE', message:'1688浏览器已打开', url:'https://www.1688.com/', autoLoginAttempted:false }
  const row=database?.getMarketplaceCredential('supply:GIGACLOUD:default')
  const allowAutoLogin=row?.automation_mode==='AUTO_FILL'
  let password=''
  if(row?.encrypted_password&&safeStorage.isEncryptionAvailable())password=safeStorage.decryptString(Buffer.from(row.encrypted_password,'base64'))
  return (await workspace.ensureGigaCloudLogin(row?.username||'',password,allowAutoLogin,activationVersion))
    ?? { platformCode, loginStatus:'UNKNOWN', message:'已取消过期的大健云仓登录检查', url:'', autoLoginAttempted:false }
})
ipcMain.handle('browser:open-tab', (_event, platform: Platform, url: string, title?: string) => workspace?.openTab(platform, url, title))
ipcMain.handle('system:open-vpn-panel', () => shell.openExternal('https://89.208.249.7:54321/5NEmm8ylBTB6cwij1Y/'))
ipcMain.handle('system:open-external', (_event, url: string) => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('仅允许 http/https 链接')
  return shell.openExternal(url)
})
ipcMain.handle('watch-skill:status', async () => {
  const cli = path.join(watchSkillRoot(), '.venv', 'bin', process.platform === 'win32' ? 'watch-skill.exe' : 'watch-skill')
  const python = path.join(watchSkillRoot(), '.venv', 'bin', process.platform === 'win32' ? 'python.exe' : 'python')
  const ffmpegPath = ffmpegInstaller.path.replace('app.asar', 'app.asar.unpacked')
  const checks: Record<string, boolean> = {
    repository: fs.existsSync(path.join(watchSkillRoot(), 'pyproject.toml')),
    engine: fs.existsSync(cli), python: fs.existsSync(python), ffmpeg: fs.existsSync(ffmpegPath),
    whisper: false, ocr: false
  }
  if (checks.python) {
    try { await execFileAsync(python, ['-c', 'import faster_whisper']); checks.whisper = true } catch {}
    try { await execFileAsync(python, ['-c', 'import rapidocr']); checks.ocr = true } catch {}
  }
  if(!checks.ocr&&process.platform==='darwin'){try{checks.ocr=Boolean(await ensureWatchSkillVisionOcr())}catch{}}
  return { checks, root: watchSkillRoot(), version: checks.engine ? '1.2.0' : '' }
})
ipcMain.handle('watch-skill:pick-video', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: '视频', extensions: ['mp4','mov','mkv','webm'] }] })
  return result.canceled ? null : result.filePaths[0] || null
})
ipcMain.handle('watch-skill:download-youtube', async (_event, rawUrl:string) => {
  const url=new URL(String(rawUrl||''))
  if(url.protocol!=='https:'||!['youtube.com','www.youtube.com','youtu.be'].includes(url.hostname))throw new Error('请输入 YouTube HTTPS 链接')
  const ytDlp=path.join(watchSkillRoot(),'.venv','bin','yt-dlp')
  if(!fs.existsSync(ytDlp))throw new Error('yt-dlp 未安装')
  const downloadDir=path.join(app.getPath('userData'),'watch-skill-downloads');fs.mkdirSync(downloadDir,{recursive:true})
  const args=['--cookies-from-browser','chrome','--no-playlist','--remote-components','ejs:github','-f','best[ext=mp4][height<=720]/best[height<=720]','--print','after_move:filepath','-o',path.join(downloadDir,'%(id)s.%(ext)s')]
  if(process.platform==='darwin'){
    const wrapper=path.join(app.getPath('temp'),'watch-skill-node-runtime')
    fs.writeFileSync(wrapper,`#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath.replace(/"/g,'\\"')}" "$@"\n`,{mode:0o700})
    args.push('--js-runtimes',`node:${wrapper}`)
  }
  args.push(url.toString())
  const {stdout}=await execFileAsync(ytDlp,args,{timeout:30*60_000,maxBuffer:5*1024*1024})
  const downloaded=stdout.trim().split('\n').filter(Boolean).at(-1)||''
  if(!downloaded||!fs.existsSync(downloaded))throw new Error('YouTube 下载完成但未找到视频文件')
  return downloaded
})
ipcMain.handle('watch-skill:analyze', async (_event, videoPath: string) => {
  if (!videoPath || !fs.existsSync(videoPath)) throw new Error('请选择有效的视频文件')
  const cli = path.join(watchSkillRoot(), '.venv', 'bin', process.platform === 'win32' ? 'watch-skill.exe' : 'watch-skill')
  const ffmpegPath = ffmpegInstaller.path.replace('app.asar', 'app.asar.unpacked')
  const env = { ...process.env, PATH: `${path.dirname(ffmpegPath)}${path.delimiter}${process.env.PATH || ''}` }
  const id = `${Date.now()}-${createHash('sha1').update(videoPath).digest('hex').slice(0,8)}`
  const outputDir = path.join(app.getPath('userData'), 'watch-skill-results', id)
  fs.mkdirSync(outputDir, { recursive: true })
  try {
    const { stdout, stderr } = await execFileAsync(cli, ['watch', videoPath, '--transcript-only', '--whisper-model', 'small'], { env, timeout: 30 * 60_000, maxBuffer: 10 * 1024 * 1024 })
    const framePattern = path.join(outputDir, 'frame-%03d.jpg')
    await execFileAsync(ffmpegPath, ['-y','-i',videoPath,'-vf','fps=1/10,scale=960:-2','-frames:v','12',framePattern], { timeout: 5 * 60_000, maxBuffer: 5 * 1024 * 1024 })
    let framePaths = fs.readdirSync(outputDir).filter(name=>name.endsWith('.jpg')).sort().map(name=>path.join(outputDir,name))
    if (!framePaths.length) {
      const firstFrame = path.join(outputDir, 'frame-001.jpg')
      await execFileAsync(ffmpegPath, ['-y','-i',videoPath,'-frames:v','1','-vf','scale=960:-2',firstFrame], { timeout: 5 * 60_000, maxBuffer: 5 * 1024 * 1024 })
      framePaths = fs.existsSync(firstFrame) ? [firstFrame] : []
    }
    const ocrLines:string[]=[]
    try{const ocr=await ensureWatchSkillVisionOcr();for(const frame of framePaths){const {stdout:raw}=await execFileAsync(ocr,[frame],{timeout:60_000,maxBuffer:2*1024*1024});const value=JSON.parse(raw),texts=(value.blocks||[]).map((block:{text:string})=>block.text).filter(Boolean);if(texts.length)ocrLines.push(`- ${path.basename(frame)}: ${texts.join(' | ')}`)}}catch{}
    const ocrReport=ocrLines.length?`\n\n## Frame OCR\n\n${ocrLines.join('\n')}`:'\n\n## Frame OCR\n\n_No readable text detected._'
    const task: WatchSkillTask = { id, videoPath, createdAt:new Date().toISOString(), status:'COMPLETED', report:`${stdout}${stderr ? `\n${stderr}` : ''}${ocrReport}`.trim(), framePaths }
    saveWatchSkillTasks([task,...readWatchSkillTasks()])
    return task
  } catch (reason) {
    const task: WatchSkillTask = { id, videoPath, createdAt:new Date().toISOString(), status:'FAILED', report:'', framePaths:[], error:reason instanceof Error?reason.message:String(reason) }
    saveWatchSkillTasks([task,...readWatchSkillTasks()]); throw reason
  }
})
ipcMain.handle('watch-skill:tasks', () => readWatchSkillTasks())
ipcMain.handle('resource2skill:status', async () => {
  const root = resource2SkillRoot()
  const python = path.join(root, '.venv', 'bin', 'python')
  const sourceReady = fs.existsSync(path.join(root, 'README.md')) && fs.existsSync(path.join(root, 'cli.py'))
  const python311Ready = fs.existsSync(resource2SkillPython311())
  let officialRuntimeReady = false
  let note = python311Ready ? 'Python 3.11 已就绪；官方运行时未通过执行验证。' : '未检测到项目内 Python 3.11。'
  if (sourceReady && fs.existsSync(python)) {
    try {
      const { stdout } = await execFileAsync(python, ['cli.py', 'domains'], { cwd: root, timeout: 30_000 })
      const domains = stdout.split('\n').map(line => line.trim().split(/\s+/)[0]).filter(Boolean)
      officialRuntimeReady = domains.length > 0
      note = officialRuntimeReady ? `官方 CLI 已验证；可用域：${domains.join('、')}` : '官方 CLI 未返回可用域。'
    } catch (reason) {
      note = `官方 CLI 验证失败：${reason instanceof Error ? reason.message : String(reason)}`
    }
  }
  return { sourceReady, officialRuntimeReady, python311Ready, adapterReady: true, domains: officialRuntimeReady ? note.split('：')[1]?.split('、') || [] : [], note }
})
ipcMain.handle('resource2skill:drafts', () => readResourceSkillLibrary())
ipcMain.handle('resource2skill:model-settings', () => {const value=readResource2SkillSettings();return { configured:Boolean(value.encryptedGeminiKey),baseUrl:value.baseUrl }})
ipcMain.handle('resource2skill:model-settings-save', (_event, input:{apiKey:string;baseUrl:string}) => {
  const apiKey=String(input?.apiKey||'').trim(),baseUrl=String(input?.baseUrl||'').trim().replace(/\/$/,'')
  const parsed=new URL(baseUrl)
  if(parsed.protocol!=='https:'||parsed.hostname!=='api000.com')throw new Error('当前仅允许 https://api000.com')
  if(!apiKey)throw new Error('请输入 Gemini API Key')
  if(!safeStorage.isEncryptionAvailable())throw new Error('当前系统安全存储不可用')
  fs.writeFileSync(resource2SkillSettingsPath(),JSON.stringify({encryptedGeminiKey:safeStorage.encryptString(apiKey).toString('base64'),baseUrl}),{mode:0o600})
  return {configured:true,baseUrl}
})
ipcMain.handle('resource2skill:model-settings-clear', () => { try{fs.unlinkSync(resource2SkillSettingsPath())}catch{};return {configured:false} })
ipcMain.handle('resource2skill:generate', async (_event, taskId:string, domain:string) => {
  const task=readWatchSkillTasks().find(item=>item.id===taskId)
  if(!task||task.status!=='COMPLETED')throw new Error('请选择已完成的 Watch Skill 解析记录')
  const allowed=['blender','excel','general','ppt','reaper','web']
  if(!allowed.includes(domain))throw new Error('请选择有效的 Resource2Skill 官方领域')
  const python=path.join(resource2SkillRoot(),'.venv','bin','python')
  await execFileAsync(python,['cli.py','validate-domain','--domain',domain],{cwd:resource2SkillRoot(),timeout:30_000})
  const promptPath=path.join(resource2SkillRoot(),'domains',domain,'distiller_prompt.md')
  const draft=makeResourceSkillDraft(task,domain,fs.readFileSync(promptPath,'utf8'))
  saveResourceSkillLibrary([draft,...readResourceSkillLibrary()])
  return draft
})
ipcMain.handle('resource2skill:official-analyze', async (_event, input:{url:string;domain:string}) => {
  const url=new URL(String(input.url||''))
  if(url.protocol!=='https:'||!['youtube.com','www.youtube.com','youtu.be'].includes(url.hostname))throw new Error('请输入公开 YouTube HTTPS 链接')
  const settings=readResource2SkillSettings()
  if(!settings.encryptedGeminiKey)throw new Error('请先保存 Gemini API Key')
  if(!safeStorage.isEncryptionAvailable())throw new Error('当前系统安全存储不可用')
  const allowed=['blender','excel','general','ppt','reaper','web']
  if(!allowed.includes(input.domain))throw new Error('请选择有效的 Resource2Skill 官方领域')
  const python=path.join(resource2SkillRoot(),'.venv','bin','python'),output=path.join(app.getPath('temp'),`resource2skill-${Date.now()}.md`)
  const env={...process.env,GEMINI_API_KEY:safeStorage.decryptString(Buffer.from(settings.encryptedGeminiKey,'base64')),GEMINI_BASE_URL:settings.baseUrl}
  try {
    await execFileAsync(python,['cli.py','analyze','--domain',input.domain,'--video',url.toString(),'--model','gemini-2.5-flash','-o',output],{cwd:resource2SkillRoot(),env,timeout:30*60_000,maxBuffer:10*1024*1024})
    const analysis=fs.readFileSync(output,'utf8'),now=new Date().toISOString(),name=`youtube-${input.domain}-${Date.now()}`
    const draft:ResourceSkillDraft={id:`${Date.now()}-${createHash('sha1').update(url.toString()).digest('hex').slice(0,8)}`,sourceTaskId:`youtube:${url}`,name,content:`---\nname: ${name}\nresource2skill_domain: ${input.domain}\nsource: ${url}\n---\n\n# ${name}\n\n> 状态：Resource2Skill 官方 Gemini + YouTube 视频分析结果。\n\n${analysis}`,createdAt:now,updatedAt:now}
    saveResourceSkillLibrary([draft,...readResourceSkillLibrary()]);return draft
  } finally { try{fs.unlinkSync(output)}catch{} }
})
ipcMain.handle('resource2skill:text-distill', async (_event, input:{reportPath:string;domain:string;sourceUrl?:string}) => {
  const reportPath=path.resolve(String(input.reportPath||'')),settings=readResource2SkillSettings()
  if(!reportPath.startsWith(path.resolve(process.cwd())+path.sep)||!fs.existsSync(reportPath))throw new Error('报告文件不存在或不在项目目录内')
  if(!settings.encryptedGeminiKey)throw new Error('请先保存 Gemini API Key')
  if(!safeStorage.isEncryptionAvailable())throw new Error('当前系统安全存储不可用')
  const allowed=['blender','excel','general','ppt','reaper','web']
  if(!allowed.includes(input.domain))throw new Error('请选择有效的 Resource2Skill 官方领域')
  const root=resource2SkillRoot(),python=path.join(root,'.venv','bin','python'),output=path.join(app.getPath('temp'),`resource2skill-text-${Date.now()}.md`)
  const env={...process.env,GEMINI_API_KEY:safeStorage.decryptString(Buffer.from(settings.encryptedGeminiKey,'base64')),GEMINI_BASE_URL:settings.baseUrl}
  try {
    await execFileAsync(python,['text_distill.py','--domain',input.domain,'--input',reportPath,'--output',output,'--model','gemini-2.5-flash'],{cwd:root,env,timeout:30*60_000,maxBuffer:10*1024*1024})
    return {analysis:fs.readFileSync(output,'utf8'),domain:input.domain,sourceUrl:String(input.sourceUrl||''),reportPath}
  } finally { try{fs.unlinkSync(output)}catch{} }
})
ipcMain.handle('resource2skill:distill-watch', async (_event, input:{taskId:string;domain:string}) => {
  const task=readWatchSkillTasks().find(item=>item.id===String(input.taskId||'')),settings=readResource2SkillSettings()
  if(!task||task.status!=='COMPLETED'||!task.report.trim())throw new Error('请选择包含报告的 Watch Skill 完成记录')
  if(!settings.encryptedGeminiKey)throw new Error('请先保存 Gemini API Key')
  if(!safeStorage.isEncryptionAvailable())throw new Error('当前系统安全存储不可用')
  const allowed=['blender','excel','general','ppt','reaper','web']
  if(!allowed.includes(input.domain))throw new Error('请选择有效的 Resource2Skill 官方领域')
  const root=resource2SkillRoot(),python=path.join(root,'.venv','bin','python')
  const reportPath=path.join(app.getPath('temp'),`watch-report-${Date.now()}.md`),output=path.join(app.getPath('temp'),`resource2skill-text-${Date.now()}.md`)
  const env={...process.env,GEMINI_API_KEY:safeStorage.decryptString(Buffer.from(settings.encryptedGeminiKey,'base64')),GEMINI_BASE_URL:settings.baseUrl}
  try {
    fs.writeFileSync(reportPath,task.report,{mode:0o600})
    await execFileAsync(python,['text_distill.py','--domain',input.domain,'--input',reportPath,'--output',output,'--model','gemini-2.5-flash'],{cwd:root,env,timeout:30*60_000,maxBuffer:10*1024*1024})
    const analysis=fs.readFileSync(output,'utf8'),now=new Date().toISOString(),name=`${fileStem(task.videoPath)}-distilled-skill`
    assertResourceSkillQuality(analysis,input.domain)
    const id=`distilled-${createHash('sha1').update(`${task.id}:${input.domain}`).digest('hex').slice(0,12)}`
    const items=readResourceSkillLibrary(),existing=items.find(item=>item.id===id)
    const content=`---\nname: ${name}\ndescription: 从 Watch Skill 时间轴报告蒸馏的可编辑技能\nresource2skill_domain: ${input.domain}\nsource: ${task.videoPath}\n---\n\n# ${name}\n\n> 状态：Watch Skill 本地解析 + Resource2Skill Gemini 文本蒸馏。\n\n${analysis}\n`
    const draft:ResourceSkillDraft={id,sourceTaskId:task.id,name,content,createdAt:existing?.createdAt||now,updatedAt:now}
    saveResourceSkillLibrary([draft,...items.filter(item=>item.id!==id)])
    return draft
  } finally { try{fs.unlinkSync(reportPath)}catch{};try{fs.unlinkSync(output)}catch{} }
})
ipcMain.handle('resource2skill:save', (_event, input:{id:string;name:string;content:string}) => {
  const items=readResourceSkillLibrary(), existing=items.find(item=>item.id===input.id)
  if(!existing)throw new Error('Skill 草稿不存在')
  const updated={...existing,name:input.name.trim()||existing.name,content:input.content,updatedAt:new Date().toISOString()}
  saveResourceSkillLibrary([updated,...items.filter(item=>item.id!==updated.id)])
  const skillDir=path.join(app.getPath('userData'),'resource2skill-library',updated.name)
  fs.mkdirSync(skillDir,{recursive:true});fs.writeFileSync(path.join(skillDir,'SKILL.md'),updated.content)
  return {...updated,filePath:path.join(skillDir,'SKILL.md')}
})

// Windows/Linux 无边框窗口自绘控制按钮所需 IPC
ipcMain.on('app:platform', event => { event.returnValue = process.platform })
ipcMain.handle('window:minimize', () => { mainWindow?.minimize() })
ipcMain.handle('window:maximize-toggle', () => {
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
  return mainWindow.isMaximized()
})
ipcMain.handle('window:close', () => { mainWindow?.close() })
ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
ipcMain.handle('browser:new-tab', () => workspace?.newTab())
ipcMain.handle('browser:switch-tab', (_event, tabId: string) => workspace?.switchTab(tabId))
ipcMain.handle('browser:close-tab', (_event, tabId: string) => workspace?.closeTab(tabId))
ipcMain.handle('browser:1688-search-url', (_event, keyword: string) => {
  return create1688SearchUrl(keyword)
})
// ---------- AI员工：RAGFlow 智能体调用 + 附件/大模型路由（AiEmployeeChatService）+ 内嵌浏览器（与 Chrome 扩展同链路） ----------
ipcMain.handle('ai-employee:ask', (_event, request: AiEmployeeAskRequest) => aiEmployeeChatService.chat(request))
ipcMain.handle('ai-employee:chat-models', () => aiEmployeeChatService.listModels())
ipcMain.handle('ai-employee:pick-attachments', () => aiEmployeeChatService.pickAttachments())
ipcMain.handle('ai-employee:materialize-markdown-report', (_event, content: string) => materializeGeneratedMarkdownReply(content))
ipcMain.handle('ai-employee:browser:show', (_event, bounds: BrowserBounds) => workspace?.showAiEmployeeBrowser(bounds))
ipcMain.handle('ai-employee:browser:hide', () => workspace?.hideAiEmployeeBrowser())
ipcMain.handle('ai-employee:browser:navigate', (_event, url: string) => workspace?.aiEmployeeNavigate(url))
ipcMain.handle('ai-employee:browser:back', () => workspace?.aiEmployeeBack())
ipcMain.handle('ai-employee:browser:forward', () => workspace?.aiEmployeeForward())
ipcMain.handle('ai-employee:browser:reload', () => workspace?.aiEmployeeReload())
ipcMain.handle('ai-employee:browser:url', () => workspace?.aiEmployeeGetUrl() || '')
ipcMain.handle('ai-employee:extract-current', () => workspace?.aiEmployeeExtractInfo())
ipcMain.handle('ai-employee:cny-usd-rate', async (): Promise<{ usdPerCny: number; fetchedAt: string; source: string } | null> => {
  const now = Date.now()
  if (cnyUsdExchangeRateCache && now - cnyUsdExchangeRateCache.at < 60 * 60 * 1000) {
    return { usdPerCny: cnyUsdExchangeRateCache.usdPerCny, fetchedAt: new Date(cnyUsdExchangeRateCache.at).toISOString(), source: `${cnyUsdExchangeRateCache.source}（1小时缓存）` }
  }
  try {
    const source = 'ExchangeRate-API CNY 基准公开汇率 https://open.er-api.com/v6/latest/CNY'
    const response = await fetch('https://open.er-api.com/v6/latest/CNY', { signal: AbortSignal.timeout(10_000) })
    const body = await response.json().catch(() => null) as { result?: string; rates?: { USD?: unknown } } | null
    const usdPerCny = Number(body?.rates?.USD)
    if (!response.ok || body?.result !== 'success' || !Number.isFinite(usdPerCny) || usdPerCny <= 0 || usdPerCny > 1) return null
    cnyUsdExchangeRateCache = { at: now, usdPerCny, source }
    return { usdPerCny, fetchedAt: new Date(now).toISOString(), source }
  } catch { return null }
})
ipcMain.handle('ai-employee:amazon-resolve', (_event, keyword: string) => workspace?.resolveAmazonTopResult(keyword) ?? Promise.resolve(null))
ipcMain.handle('ai-employee:amazon-market-stats', (_event, keyword: string) => {
  const settings = readAmazonDataSource()
  return workspace?.collectAmazonMarketSamples(keyword, settings) ?? Promise.resolve(null)
})
ipcMain.handle('ai-employee:amazon-listing-evidence', (_event, asins: string[]) => {
  const settings = readAmazonDataSource()
  return workspace?.collectAmazonListingEvidence(Array.isArray(asins) ? asins : [], { maxListings: 8, cacheHours: settings.cacheHours }) ?? Promise.resolve([])
})
ipcMain.handle('ai-employee:amazon-review-evidence', (_event, asins: string[]) => {
  const settings = readAmazonDataSource()
  return workspace?.collectAmazonReviewEvidence(Array.isArray(asins) ? asins : [], { maxListings: 5, cacheHours: settings.cacheHours }) ?? Promise.resolve([])
})
ipcMain.handle('ai-employee:derive-amazon-keywords', (_event, intent) => aiEmployeeChatService.deriveAmazonKeywords(intent))
ipcMain.handle('ai-employee:infer-evidence', (_event, input) => aiEmployeeChatService.inferDifferentiationAndCompliance(input))
ipcMain.handle('amazon-data-source:get', () => publicAmazonDataSource())
ipcMain.handle('amazon-data-source:save', (_event, input: { apiKey?: string; site: string; pages: number; maxSamples: number; cacheHours: number }) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统安全存储不可用，不能保存 Amazon API Key')
  const current = readAmazonDataSource()
  const apiKey = String(input.apiKey || '').trim()
  const next: AmazonDataSourceSettings = {
    encryptedApiKey: apiKey ? safeStorage.encryptString(apiKey).toString('base64') : current.encryptedApiKey,
    site: 'US',
    pages: Math.min(2, Math.max(1, Math.floor(Number(input.pages) || 1))),
    maxSamples: Math.min(48, Math.max(1, Math.floor(Number(input.maxSamples) || 24))),
    cacheHours: Math.min(168, Math.max(1, Math.floor(Number(input.cacheHours) || 24)))
  }
  fs.mkdirSync(path.dirname(amazonDataSourcePath()), { recursive: true })
  fs.writeFileSync(amazonDataSourcePath(), JSON.stringify(next), { mode: 0o600 })
  amazonDataSourceCache.clear()
  return publicAmazonDataSource(next)
})
ipcMain.handle('amazon-data-source:clear', () => {
  try { fs.unlinkSync(amazonDataSourcePath()) } catch { /* already clear */ }
  amazonDataSourceCache.clear()
})
ipcMain.handle('amazon-data-source:test', async () => {
  const settings = readAmazonDataSource()
  if (!settings.encryptedApiKey) return { ok: false, message: '请先保存 API Key' }
  const apiKey = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, 'base64')) : ''
  try {
    const url = new URL(amazonScraperSearchEndpoint())
    url.searchParams.set('query', 'dog grooming brush')
    url.searchParams.set('country_code', 'US')
    const response = await fetch(url, { headers: { 'API-Key': apiKey }, signal: AbortSignal.timeout(20_000) })
    const body = await response.json().catch(() => ({})) as { results?: unknown[]; detail?: string; message?: string }
    if (!response.ok) return { ok: false, message: describeOmkarCloudError(response.status, body) }
    return { ok: true, message: '连接成功', samples: Array.isArray(body.results) ? body.results.length : 0 }
  } catch (error) { return { ok: false, message: error instanceof Error ? error.message : '连接失败' } }
})
// ---------- 大模型API Key 只读状态（仅返回掩码，绝不回传完整 Key） ----------
function maskLlmKey(value: string): string {
  if (!value) return ''
  return value.length > 12 ? `${value.slice(0, 4)}****${value.slice(-4)}` : `${value.slice(0, 2)}****`
}
ipcMain.handle('llm-keys:list', () => {
  const envKeys: Array<{ id: string; key: string }> = [
    { id: 'bailian', key: String(process.env.BAILIAN_API_KEY || '').trim() },
    { id: 'deepseek', key: String(process.env.DEEPSEEK_API_KEY || '').trim() },
    { id: 'ark', key: String(process.env.ARK_API_KEY || '').trim() },
    { id: 'openai', key: String(process.env.OPENAI_IMAGE_API_KEY || '').trim() },
    // handler 在 app ready 后执行，此时 loadLocalEnvironment 已完成，直接读 process.env 时序安全
    { id: 'ragflow', key: String(process.env.RAGFLOW_API_KEY || '').trim() }
  ]
  return envKeys.map(item => ({ id: item.id, configured: Boolean(item.key), maskedKey: maskLlmKey(item.key) }))
})
// ---------- 大模型API Key 管理：保存（按行回写 .env.local）/ 连接测试 / 一键重启 ----------
const LLM_KEY_ENV_NAME: Record<string, string> = {
  bailian: 'BAILIAN_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
  ark: 'ARK_API_KEY',
  openai: 'OPENAI_IMAGE_API_KEY',
  ragflow: 'RAGFLOW_API_KEY'
}
// 与 loadLocalEnvironment 的查找顺序保持一致；两者都不存在时默认落到 app.getAppPath()/.env.local
function envLocalFilePath(): string {
  const candidates = [path.join(app.getAppPath(), '.env.local'), path.join(process.cwd(), '.env.local')]
  return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0]
}
// 按行回写：仅替换 ^KEY= 行的值，保留其余行/注释/顺序与换行风格；缺失则在文件末尾追加；空值写 KEY=（视为清除）
function writeEnvLocalKey(key: string, value: string): void {
  const file = envLocalFilePath()
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  if (!raw.trim()) {
    fs.writeFileSync(file, `${key}=${value}\n`, { mode: 0o600 })
    return
  }
  const bom = raw.startsWith('\uFEFF') ? '\uFEFF' : ''
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const pattern = new RegExp(`^${key}=`)
  const lines = raw.replace(/^\uFEFF/, '').split(/\r?\n/)
  let found = false
  const next = lines.map(line => {
    if (pattern.test(line)) { found = true; return `${key}=${value}` }
    return line
  })
  if (!found) {
    const entry = `${key}=${value}`
    // 文件以换行结尾时最后的空串代表结尾换行，新键插在其前，避免产生多余空行
    if (next[next.length - 1] === '') next.splice(next.length - 1, 0, entry)
    else next.push(entry)
  }
  fs.writeFileSync(file, bom + next.join(eol), { mode: 0o600 })
}
ipcMain.handle('llm-keys:save', (_event, input: { id?: string; value?: string }) => {
  try {
    const envName = LLM_KEY_ENV_NAME[String(input?.id || '')]
    if (!envName) return { ok: false, error: '未知的提供商' }
    const value = String(input?.value ?? '').trim()
    writeEnvLocalKey(envName, value)
    process.env[envName] = value
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '保存失败' }
  }
})
const LLM_KEY_TEST_TIMEOUT_MS = 10_000
// 轻量鉴权探测：仅返回状态码/摘要级错误，绝不回传密钥内容
async function testLlmKey(id: string): Promise<{ ok: boolean; latencyMs?: number; error?: string }> {
  const started = Date.now()
  const latency = (): number => Date.now() - started
  const signal = AbortSignal.timeout(LLM_KEY_TEST_TIMEOUT_MS)
  const key = String(process.env[LLM_KEY_ENV_NAME[id]] || '').trim()
  if (!key) return { ok: false, latencyMs: latency(), error: '未配置 Key' }
  const authHeaders = { Authorization: `Bearer ${key}` }
  try {
    if (id === 'bailian' || id === 'deepseek') {
      const base = (id === 'bailian'
        ? process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        : process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '')
      const response = await fetch(`${base}/models`, { headers: authHeaders, signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return { ok: true, latencyMs: latency() }
    }
    if (id === 'ark') {
      const base = (process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/, '')
      const modelsResponse = await fetch(`${base}/models`, { headers: authHeaders, signal })
      if (modelsResponse.ok) return { ok: true, latencyMs: latency() }
      // /models 不可用时退化为最小 chat 请求（text 模型优先，max_tokens=1）
      const model = configuredModels(process.env.ARK_TEXT_MODELS)[0] || configuredModels(process.env.ARK_VIDEO_MODELS)[0]
      if (!model) return { ok: false, latencyMs: latency(), error: `HTTP ${modelsResponse.status}，且未配置 ARK_TEXT_MODELS/ARK_VIDEO_MODELS 无法二次验证` }
      const chatResponse = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
        signal
      })
      if (!chatResponse.ok) throw new Error(`HTTP ${chatResponse.status}`)
      return { ok: true, latencyMs: latency() }
    }
    if (id === 'openai') {
      const proxy = String(process.env.IMAGE_PROXY_URL || '').trim()
      if (!proxy) return { ok: false, latencyMs: latency(), error: '未配置 IMAGE_PROXY_URL，无法经代理访问 OpenAI' }
      // 与 OpenAIImageService 相同的独立 session 代理方式
      const proxySession = session.fromPartition('llm-key-openai-probe')
      await proxySession.setProxy({ proxyRules: proxy.replace(/^https?:\/\//i, '') })
      const response = await proxySession.fetch('https://api.openai.com/v1/models', { headers: authHeaders, signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return { ok: true, latencyMs: latency() }
    }
    if (id === 'ragflow') {
      // base 与 RagflowKnowledgeService.baseUrl 保持一致：中央服务器地址 + 8090 端口
      let base: string
      try {
        const url = new URL(readServerUrl())
        url.port = '8090'
        url.pathname = '/'
        base = url.toString().replace(/\/+$/, '')
      } catch {
        return { ok: false, latencyMs: latency(), error: '未配置中央服务器地址' }
      }
      const response = await fetch(`${base}/api/v1/datasets?page=1&page_size=1`, { headers: authHeaders, signal })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const payload = await response.json().catch(() => ({})) as { code?: number; message?: string }
      if (payload.code !== 0) throw new Error(payload.message || `RAGFlow 业务错误（code=${payload.code}）`)
      return { ok: true, latencyMs: latency() }
    }
    return { ok: false, latencyMs: latency(), error: '未知的提供商' }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '连接失败'
    const summary = error instanceof Error && error.name === 'TimeoutError' ? '请求超时（10秒）' : detail.split(key).join('****')
    return { ok: false, latencyMs: latency(), error: summary }
  }
}
ipcMain.handle('llm-keys:test', async (_event, input: { id?: string }) => {
  const id = String(input?.id || '')
  if (!LLM_KEY_ENV_NAME[id]) return { ok: false, error: '未知的提供商' }
  try {
    return await testLlmKey(id)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '连接测试失败' }
  }
})
ipcMain.handle('llm-keys:restart', () => {
  app.relaunch()
  app.exit(0)
})
ipcMain.handle('amazon-data-source:search', async (_event, keyword: string): Promise<AmazonDataSourceSearchResult> => {
  const settings = readAmazonDataSource()
  if (!settings.encryptedApiKey) return { samples: null, error: 'Amazon API Key 未配置' }
  if (!safeStorage.isEncryptionAvailable()) return { samples: null, error: '系统安全存储不可用' }
  const apiKey = safeStorage.decryptString(Buffer.from(settings.encryptedApiKey, 'base64'))
  const term = String(keyword || '').trim()
  if (!term) return { samples: null, error: 'Amazon 检索词为空' }
  const cacheKey = `${settings.site}|${settings.pages}|${settings.maxSamples}|${term.toLowerCase()}`
  const cached = amazonDataSourceCache.get(cacheKey)
  if (cached && Date.now() - cached.at < settings.cacheHours * 3600 * 1000) {
    return { ...cached.result, meta: cached.result.meta ? { ...cached.result.meta, cacheHit: true } : undefined }
  }
  try {
    const all: AmazonDataSourceSearchResult['samples'] = []
    let rawCount = 0
    let pagesFetched = 0
    let partialError = ''
    const numberValue = (value: unknown): number | null => {
      if (typeof value === 'number' && Number.isFinite(value)) return value
      const parsed = Number(String(value ?? '').replace(/[^0-9.]/g, ''))
      return Number.isFinite(parsed) && String(value ?? '').trim() ? parsed : null
    }
    const booleanValue = (value: unknown): boolean => value === true || value === 1 || /^(?:true|yes|sponsored|1)$/i.test(String(value ?? '').trim())
    const textValue = (value: unknown): string => String(value ?? '')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/(?:&#39;|&apos;)/gi, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
      .replace(/&#x([\da-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)))
      .replace(/\s+/g, ' ')
      .trim()
    for (let page = 1; page <= settings.pages && all.length < settings.maxSamples; page += 1) {
      const url = new URL(amazonScraperSearchEndpoint())
      url.searchParams.set('query', term)
      url.searchParams.set('country_code', 'US')
      url.searchParams.set('page', String(page))
      const response = await fetch(url, { headers: { 'API-Key': apiKey }, signal: AbortSignal.timeout(30_000) })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        partialError = `第${page}页：${describeOmkarCloudError(response.status, body)}`
        if (!all.length) return { samples: null, error: `Amazon 数据接口${partialError}` }
        break
      }
      const body = await response.json().catch(() => ({})) as { results?: Array<Record<string, unknown>> }
      if (!Array.isArray(body.results)) {
        partialError = `第${page}页返回格式异常`
        if (!all.length) return { samples: null, error: `Amazon 数据接口${partialError}` }
        break
      }
      pagesFetched += 1
      rawCount += body.results.length
      const known = new Set(all.map(item => item.asin))
      for (const item of body.results) {
        const asin = String(item.asin || '').trim().toUpperCase()
        const title = textValue(item.title || item.product_name)
        if (!asin || !title || known.has(asin)) continue
        known.add(asin)
        all.push({
          asin,
          title,
          price: numberValue(item.price ?? item.current_price),
          rating: numberValue(item.rating),
          reviews: numberValue(item.reviews ?? item.ratings_total),
          salesVolume: textValue(item.sales_volume ?? item.salesVolume) || null,
          bsr: numberValue(item.bsr ?? item.best_sellers_rank ?? item.sales_rank),
          page,
          sponsored: booleanValue(item.is_sponsored ?? item.sponsored),
          source: 'api'
        })
        if (all.length >= settings.maxSamples) break
      }
      if (body.results.length < 5) break
    }
    if (!all.length) return { samples: null, error: 'Amazon 搜索未返回有效商品样本' }
    const result: AmazonDataSourceSearchResult = {
      samples: all,
      ...(partialError ? { error: `Amazon 数据接口部分完成：${partialError}` } : {}),
      meta: { source: 'api', pagesRequested: settings.pages, pagesFetched, rawCount, uniqueCount: all.length, truncated: all.length >= settings.maxSamples, cacheHit: false }
    }
    amazonDataSourceCache.set(cacheKey, { at: Date.now(), result })
    return result
  } catch (error) { return { samples: null, error: error instanceof Error ? error.message : 'Amazon 数据接口连接失败' } }
})
// ---------- 知识库两大类：RAGFlow 数据集管理 + 本地分类注册表（RagflowKnowledgeService） ----------
ipcMain.handle('kb:list', () => ragflowKnowledgeService.list())
ipcMain.handle('kb:create-custom', (_event, request: { name: string; description: string }) => ragflowKnowledgeService.createCustom(request.name, request.description))
ipcMain.handle('kb:ensure-agent', (_event, agentKey: KbAgentKey) => ragflowKnowledgeService.ensureAgentKb(agentKey))
ipcMain.handle('kb:delete', (_event, kbId: string) => ragflowKnowledgeService.deleteKb(kbId))
ipcMain.handle('kb:docs', (_event, kbId: string) => ragflowKnowledgeService.listDocs(kbId))
ipcMain.handle('kb:upload', (_event, request: { kbId: string; filePaths: string[]; category?: string }) => ragflowKnowledgeService.uploadDocs(request.kbId, request.filePaths, request.category))
ipcMain.handle('kb:category-create', (_event, request: { kbId: string; name: string; parent?: string }) => ragflowKnowledgeService.createCategory(request.kbId, request.name, request.parent))
ipcMain.handle('kb:category-rename', (_event, request: { kbId: string; oldName: string; newName: string }) => ragflowKnowledgeService.renameCategory(request.kbId, request.oldName, request.newName))
ipcMain.handle('kb:category-delete', (_event, request: { kbId: string; name: string }) => ragflowKnowledgeService.deleteCategory(request.kbId, request.name))
ipcMain.handle('kb:doc-assign', (_event, request: { kbId: string; docIds: string[]; category: string | null }) => ragflowKnowledgeService.assignDocs(request.kbId, request.docIds, request.category))
ipcMain.handle('kb:parse', (_event, request: { kbId: string; docIds: string[] }) => ragflowKnowledgeService.parseDocs(request.kbId, request.docIds))
ipcMain.handle('kb:stop-parse', (_event, request: { kbId: string; docIds: string[] }) => ragflowKnowledgeService.stopParse(request.kbId, request.docIds))
ipcMain.handle('kb:delete-docs', (_event, request: { kbId: string; docIds: string[] }) => ragflowKnowledgeService.deleteDocs(request.kbId, request.docIds))
// ---------- 报告样例库 → 选品分析师知识库（I 阶段新增）：一键入库 4 真实样例 + 决策门禁 + 决策可追溯硬约束 ----------
const sampleLibraryKbIngestor = new SampleLibraryKbIngestor(ragflowKnowledgeService)
ipcMain.handle('sample-library-kb:describe', () => SampleLibraryKbIngestor.describeTarget())
ipcMain.handle('sample-library-kb:preview', () => sampleLibraryKbIngestor.preview())
ipcMain.handle('sample-library-kb:ingest', async (_event, options: { parse?: boolean } = {}) => sampleLibraryKbIngestor.ingest(options))
// I.2 阶段新增：报告样例库 → 守卫自动同步（预置技能）
ipcMain.handle('sample-library-kb:guardian-launch', () => SampleLibraryKbGuardianLauncher.launchNow(ragflowKnowledgeService, kbGuardianService))
ipcMain.handle('sample-library-kb:guardian-status', () => SampleLibraryKbGuardianLauncher.status(kbGuardianService))
// ---------- 知识库守卫：技能注册表 + 定时差异更新（KbGuardianService） ----------
ipcMain.handle('kbGuardian:list-skills', () => kbGuardianService.state())
ipcMain.handle('kbGuardian:create-skill', (_event, input: GuardianSkillInput) => kbGuardianService.createSkill(input))
ipcMain.handle('kbGuardian:update-skill', (_event, id: string, input: GuardianSkillInput) => kbGuardianService.updateSkill(id, input))
ipcMain.handle('kbGuardian:delete-skill', (_event, id: string) => kbGuardianService.deleteSkill(id))
ipcMain.handle('kbGuardian:run-now', (_event, id: string) => kbGuardianService.runNow(id))
ipcMain.handle('kbGuardian:list-logs', (_event, skillId?: string) => kbGuardianService.logs(skillId))
ipcMain.handle('kbGuardian:pick-dir', () => kbGuardianService.pickDir())
// J 阶段新增：按 logId 重试该次运行中所有失败的文件（复用 soft + softFallbackHard 路径）
ipcMain.handle('kbGuardian:retry-failed', (_event, request: { skillId: string; logId: string }) => kbGuardianService.retryFailedFiles(request))
// J 阶段新增：按 logId 拉取单条日志详情（含 failures 完整明细）
ipcMain.handle('kbGuardian:get-log-detail', (_event, request: { logId: string }) => {
  const logId = request?.logId
  if (!logId) return null
  return kbGuardianService.logs().then(list => list.find(item => item.id === logId) ?? null)
})
ipcMain.handle('ai-employee:export-document', async (_event, request: {
  title: string
  roleName: string
  createdAt: number
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  format: 'word' | 'pdf' | 'markdown'
}) => {
  const safeTitle = (request.title || 'AI员工文档').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)
  const formatConfig = {
    word: { extension: 'doc', name: 'Word 文档' },
    pdf: { extension: 'pdf', name: 'PDF 文档' },
    markdown: { extension: 'md', name: 'Markdown 文档' }
  }[request.format]
  const selected = await dialog.showSaveDialog({
    title: `下载${formatConfig.name}`,
    defaultPath: `${safeTitle}.${formatConfig.extension}`,
    filters: [{ name: formatConfig.name, extensions: [formatConfig.extension] }]
  })
  if (selected.canceled || !selected.filePath) return { canceled: true }

  const createdAt = new Date(request.createdAt).toLocaleString('zh-CN')
  const markdown = [
    `# ${request.title}`,
    '',
    `> 所属 AI 员工：${request.roleName}  `,
    `> 创建时间：${createdAt}`,
    '',
    ...request.messages.flatMap(message => [
      `## ${message.role === 'user' ? '提问' : `${request.roleName}回答`}`,
      '',
      message.content,
      ''
    ])
  ].join('\n')

  if (request.format === 'markdown') {
    fs.writeFileSync(selected.filePath, markdown, 'utf8')
    return { canceled: false, filePath: selected.filePath }
  }

  const sections = request.messages.map(message => `<section><h2>${message.role === 'user' ? '提问' : `${escapeHtml(request.roleName)}回答`}</h2>${renderMarkdownForWord(message.content)}</section>`).join('')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${wordDocumentCss}</style></head><body><h1>${escapeHtml(request.title)}</h1><div class="meta">AI员工文档 · ${escapeHtml(request.roleName)} · ${escapeHtml(createdAt)}</div>${sections}</body></html>`

  if (request.format === 'word') {
    fs.writeFileSync(selected.filePath, `\uFEFF${html}`, 'utf8')
    return { canceled: false, filePath: selected.filePath }
  }

  const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await pdfWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const pdf = await pdfWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
    fs.writeFileSync(selected.filePath, pdf)
  } finally {
    pdfWindow.destroy()
  }
  return { canceled: false, filePath: selected.filePath }
})
// ---------- AI 员工：导出 Word 报告（F 阶段新增，走真 docx OOXML） ----------
ipcMain.handle('ai-employee:export-word-report', async (_event, request: {
  title: string
  markdown: string
  roleName?: string
}) => {
  const safeTitle = (request.title || '选品分析报告').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)
  const selected = await dialog.showSaveDialog({
    title: '下载 Word 报告',
    defaultPath: `${safeTitle}.docx`,
    filters: [{ name: 'Word 文档', extensions: ['docx'] }]
  })
  if (selected.canceled || !selected.filePath) return { canceled: true }
  try {
    await reportMarkdownToDocxFile(request.markdown, selected.filePath, {
      title: safeTitle,
      author: request.roleName || '砚都跨境·选品分析师'
    })
    const buf = await reportMarkdownToDocxBuffer(request.markdown, { title: safeTitle })
    return { canceled: false, filePath: selected.filePath, byteSize: buf.length }
  } catch (err) {
    return { canceled: false, filePath: selected.filePath, error: (err as Error).message }
  }
})
// ---------- 报告样例库（G 阶段新增）：打开 .docx ----------
ipcMain.handle('ai-sample-library:open-docx', async (_event, request: { filePath: string }) => {
  try {
    if (!request.filePath) return { ok: false, error: 'filePath 缺失' }
    if (!fs.existsSync(request.filePath)) return { ok: false, error: '文件不存在：' + request.filePath }
    const errMsg = await shell.openPath(request.filePath)
    if (errMsg) return { ok: false, error: errMsg }
    return { ok: true, filePath: request.filePath }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
})
// ---------- 报告样例库（G 阶段新增）：列出全部样例元数据 ----------
ipcMain.handle('ai-sample-library:list', async () => {
  try {
    const lib = loadSampleLibrary()
    return { ok: true, samples: lib.map(s => ({
      letter: s.letter,
      decision: s.decision,
      title: s.title,
      subtitle: s.subtitle,
      reason: s.reason,
      keyMetrics: s.keyMetrics,
      markdownFile: s.markdownFile,
      docxFile: s.docxFile,
      markdownSize: s.markdownSize,
      docxSize: s.docxSize,
      failedGates: s.failedGates,
      markdownPath: s.markdownPath,
      docxPath: s.docxPath
    })) }
  } catch (err) {
    return { ok: false, error: (err as Error).message, samples: [] }
  }
})
// ---------- Listing 工作台：批次导出（合并 Markdown / Word / CSV，CSV 带 UTF-8 BOM 供 Excel 直开） ----------
ipcMain.handle('listing:export', async (_event, request: {
  title: string
  format: 'word' | 'markdown' | 'csv'
  material: string
  packages: Array<{ siteLabel: string; languageCode: string; conclusion: string; content: string }>
}) => {
  const safeTitle = (request.title || 'Listing包').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)
  const formatConfig = {
    word: { extension: 'doc', name: 'Word 文档' },
    markdown: { extension: 'md', name: 'Markdown 文档' },
    csv: { extension: 'csv', name: 'CSV 表格' }
  }[request.format]
  const selected = await dialog.showSaveDialog({
    title: `下载${formatConfig.name}`,
    defaultPath: `${safeTitle}.${formatConfig.extension}`,
    filters: [{ name: formatConfig.name, extensions: [formatConfig.extension] }]
  })
  if (selected.canceled || !selected.filePath) return { canceled: true }

  if (request.format === 'csv') {
    fs.writeFileSync(selected.filePath, `\uFEFF${buildListingCsv(request.packages)}`, 'utf8')
    return { canceled: false, filePath: selected.filePath }
  }

  const exportedAt = new Date().toLocaleString('zh-CN')
  const markdown = [
    `# ${request.title}`,
    '',
    `> 导出时间：${exportedAt} · 共 ${request.packages.length} 个 Listing 包`,
    '',
    '## 中文商品素材',
    '',
    request.material || '（未提供）',
    '',
    ...request.packages.flatMap((item, index) => [
      `## ${index + 1}. ${item.siteLabel} · ${item.languageCode}${item.conclusion ? ` · ${item.conclusion}` : ''}`,
      '',
      item.content,
      ''
    ])
  ].join('\n')

  if (request.format === 'markdown') {
    fs.writeFileSync(selected.filePath, markdown, 'utf8')
    return { canceled: false, filePath: selected.filePath }
  }

  const sections = request.packages.map((item, index) => `<section><h2>${index + 1}. ${escapeHtml(item.siteLabel)} · ${escapeHtml(item.languageCode)}${item.conclusion ? ` · ${escapeHtml(item.conclusion)}` : ''}</h2>${renderMarkdownForWord(item.content)}</section>`).join('')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${wordDocumentCss}</style></head><body><h1>${escapeHtml(request.title)}</h1><div class="meta">Listing 包导出 · ${exportedAt} · 共 ${request.packages.length} 包</div><section><h2>中文商品素材</h2>${renderMarkdownForWord(request.material || '（未提供）')}</section>${sections}</body></html>`
  fs.writeFileSync(selected.filePath, `\uFEFF${html}`, 'utf8')
  return { canceled: false, filePath: selected.filePath }
})
ipcMain.handle('browser:translate', async (_event, mode: BrowserTranslationMode) => {
  if (!workspace) throw new Error('浏览器尚未初始化')
  await workspace.setTranslationMode(mode)
  const entries = await workspace.extractTranslationTexts(80)
  if (!entries.length) return { translated:0, detectedLanguages:[], mode }
  const translated = await translationService.translateTexts(entries.map(item=>item.text))
  await workspace.applyTranslations(entries.map(item=>({id:item.id,translated:translated.get(item.text)||item.text})),mode)
  return { translated:entries.length, detectedLanguages:[], mode }
})
ipcMain.handle('browser:translation:restore', () => workspace?.restoreTranslations())
ipcMain.handle('browser:collector:start', () => workspace?.startBuiltInCollector())
ipcMain.handle('browser:collector:list', () => workspace?.getBuiltInCollectorState())
ipcMain.handle('browser:collector:remove', (_event, url: string) => workspace?.removeBuiltInCollectorProduct(url))
ipcMain.handle('browser:collector:cancel', () => workspace?.stopBuiltInCollector())
ipcMain.handle('browser:collector:confirm', async () => {
  if (!workspace) throw new Error('采集浏览器尚未初始化')
  const state = await workspace.getBuiltInCollectorState()
  const result = importCollectorProducts(validateBuiltInCollectorProducts(state.products))
  await workspace.stopBuiltInCollector()
  return result
})
ipcMain.handle('browser:ebay-plugin:start', () => workspace?.startEbayPlugin())
ipcMain.handle('browser:ebay-plugin:state', () => workspace?.getEbayPluginState())
ipcMain.handle('browser:ebay-plugin:remove', (_event, url:string) => workspace?.removeEbayPluginProduct(url))
ipcMain.handle('browser:ebay-plugin:clear', () => workspace?.clearEbayPluginProducts())
ipcMain.handle('browser:ebay-plugin:stop', () => workspace?.stopEbayPlugin())
ipcMain.handle('browser:ebay-delivery-location:open', () => workspace?.openEbayDeliveryLocation())
ipcMain.handle('task:create', (_event, draft: SelectionTaskDraft) => {
  const task: SelectionTask = {
    ...draft,
    id: crypto.randomUUID(),
    stage: 'OZON_LIST_PENDING',
    createdAt: new Date().toISOString()
  }
  tasks.set(task.id, task)
  database?.saveTask(task)
  return task
})

ipcMain.handle('task:latest', () => database?.getLatestWorkspace() ?? null)
ipcMain.handle('candidate:list', () => database?.getCandidateWorkspace() ?? { products: [], supplyProducts: [], runs: [], records: [] })
ipcMain.handle('candidate:delete', (_event, request: CandidateUpdateRequest) => database?.setCandidatesDeleted(request, true))
ipcMain.handle('candidate:restore', (_event, request: CandidateUpdateRequest) => database?.setCandidatesDeleted(request, false))
ipcMain.handle('candidate:purge', (_event, request: CandidateUpdateRequest) => database?.purgeCandidates(request))
ipcMain.handle('selection:list', () => database?.getSelectionCatalog() ?? [])
ipcMain.handle('selection:import', (_event, request: SelectionImportRequest) => database?.importSelection(request))
ipcMain.handle('selection:decide', (_event, id: string, decision: SelectionDecision) => database?.updateSelectionDecision(id, decision))
ipcMain.handle('selection:categorize', (_event, id: string, category: string, subcategory: string, tertiaryCategory: string) => database?.updateSelectionCategory(id, category, subcategory, tertiaryCategory))
ipcMain.handle('selection:return-to-candidates', (_event, id: string) => database?.returnSelectionToCandidates(id))
ipcMain.handle('comparison:list', () => database?.getComparisons() ?? [])
ipcMain.handle('comparison:import', (_event, request: ComparisonImportRequest) => database?.importComparison(request))
ipcMain.handle('comparison:update', (_event, request: ComparisonUpdateRequest) => database?.updateComparison(request))
ipcMain.handle('comparison:promote', (_event, request: ComparisonPromotionRequest) => database?.promoteComparisonToWarehouse(request))
ipcMain.handle('workflow:counts', () => database?.getWorkflowCounts() ?? { collected: 0, compared: 0, selected: 0, stocked: 0, listed: 0, purchasing: 0, reconciled: 0 })
ipcMain.handle('warehouse:list', () => database?.getSupplyWarehouseProducts() ?? [])
ipcMain.handle('marketplace-selection:list', (_event, marketplaceCode: MarketplacePlatformCode) => database?.getMarketplaceSelections(marketplaceCode) ?? [])
ipcMain.handle('marketplace-selection:import', (_event, marketplaceCode: MarketplacePlatformCode, supplyProductId: string) => database?.importMarketplaceSelection(marketplaceCode, supplyProductId))
ipcMain.handle('marketplace-media:list', (_event, marketplaceSelectionId: string) => database?.getMarketplaceMediaAssets(marketplaceSelectionId) ?? [])
ipcMain.handle('marketplace-media:save', (_event, marketplaceSelectionId: string, assetType: MarketplaceMediaAssetType, imageUrl: string, localPath: string, selected: boolean) => database?.saveMarketplaceMediaAsset(marketplaceSelectionId,assetType,imageUrl,localPath,selected))
ipcMain.handle('marketplace-media:select', (_event, id: string) => database?.selectMarketplaceMediaAsset(id))
ipcMain.handle('marketplace-publish:list', (_event, marketplaceCode: MarketplacePlatformCode) => database?.getMarketplacePublishDrafts(marketplaceCode) ?? [])
ipcMain.handle('marketplace-publish:create', (_event, marketplaceSelectionId: string, storeId: string) => database?.createMarketplacePublishDraft(marketplaceSelectionId,storeId))
ipcMain.handle('marketplace-publish:update', (_event, request: MarketplacePublishDraftUpdate, action: string) => database?.updateMarketplacePublishDraft(request,action))
ipcMain.handle('marketplace-publish:audits', (_event, marketplaceCode: MarketplacePlatformCode) => database?.getMarketplacePublishAudits(marketplaceCode) ?? [])
ipcMain.handle('ebay:status', () => ({...ebayService.configuration(),marketDataConfigured:Boolean(readAmazonDataSource().encryptedApiKey)}))
ipcMain.handle('ebay:stores:list', () => database?.getEbayStores() ?? [])
ipcMain.handle('ebay:stores:create', (_event, name:string, username:string, password:string, marketplaceId:string) => {
  if(!name.trim())throw new Error('请输入 eBay 店铺名称')
  if(!username.trim())throw new Error('请输入 eBay 登录账号')
  if(!password)throw new Error('请输入 eBay 登录密码')
  if(!safeStorage.isEncryptionAvailable())throw new Error('当前系统安全存储不可用，未保存店铺密码')
  const encryptedPassword=safeStorage.encryptString(password).toString('base64')
  return database?.createEbayStore(name.trim(),username.trim(),encryptedPassword,marketplaceId||'EBAY_US')
})
ipcMain.handle('ebay:authorize', (_event, storeId:string) => authorizeEbayStore(storeId))
ipcMain.handle('ebay:seller-hub:open', (_event, storeId:string) => openEbaySellerHub(storeId))
ipcMain.handle('ebay:browser-tab:new', (_event, storeId:string) => newEbayBrowserTab(storeId))
ipcMain.handle('ebay:product:open', (_event, storeId:string, url:string, title:string) => openEbayProductTab(storeId,url,title))
ipcMain.handle('ebay:login:ensure', (_event, storeId:string) => ensureEbayStoreLogin(storeId))
ipcMain.handle('ebay:listings:list', (_event, storeId?:string) => database?.getEbayListings(storeId) ?? [])
ipcMain.handle('ebay:local-products:list', (_event, storeId?:string) => withEbayLocalMediaFileSizes(database?.getEbayLocalProducts(storeId) ?? []))
ipcMain.handle('ebay:local-products:snapshots', (_event, localProductId:string) => database?.getEbayLocalProductSnapshots(localProductId) ?? [])
ipcMain.handle('ebay:local-products:download', (_event, storeId:string, listingId:string) => downloadEbayLocalProduct(storeId,listingId))
ipcMain.handle('ebay:product:read-url', (_event, storeId:string, url:string) => readEbayProductByUrl(storeId,url))
ipcMain.handle('ebay:local-products:update', (_event, localProductId:string, changes:EbayLocalProductUpdateInput) => updateEbayLocalProduct(localProductId,changes))
ipcMain.handle('ebay:local-products:media-data', (_event, localProductId:string, mediaId:string) => readEbayLocalProductMedia(localProductId,mediaId))
ipcMain.handle('ebay:local-products:media-add', (_event, localProductId:string, input:EbayLocalProductMediaUploadInput) => addEbayLocalProductMedia(localProductId,input))
ipcMain.handle('ebay:local-products:inspect-visual', async (_event, localProductId:string):Promise<EbayImageVisualInspectionReport> => {
  if(!database)throw new Error('eBay 本地产品库尚未初始化')
  const product=database.getEbayLocalProducts().find(item=>item.id===localProductId)
  if(!product)throw new Error('本地产品不存在或已删除')
  const hydrated=withEbayLocalMediaFileSizes([product])[0]
  const report=await ebayImageComplianceVisionService.inspect(hydrated.title,hydrated.snapshot.media)
  return database.saveEbayImageVisualInspection(localProductId,hydrated.snapshot,report)
})
ipcMain.handle('ebay:images:inspect-final', (_event, imageUrls:string[]):Promise<EbayImageInspectionReport> => inspectEbayImages(imageUrls))
ipcMain.handle('ebay:local-products:visual-report', (_event, localProductId:string):EbayImageVisualInspectionReport|null => database?.getEbayImageVisualInspection(localProductId) ?? null)
ipcMain.handle('ebay:local-products:visual-review', (_event, input:EbayImageVisualReviewInput):EbayImageVisualInspectionReport => {
  if(!database)throw new Error('eBay 本地产品库尚未初始化')
  return database.reviewEbayImageVisualRule(input)
})
ipcMain.handle('ebay:local-products:requirements', async (_event, storeId:string, listingId:string, title:string) => {
  if(!workspace)throw new Error('应用内浏览器尚未初始化')
  return workspace.inspectEbayListingRequirements(`ebay:${storeId}`,listingId,title)
})
ipcMain.handle('ebay:local-products:prepare-revision', async (_event, localProductId:string) => {
  if(!database)throw new Error('数据库尚未初始化')
  if(!workspace)throw new Error('应用内浏览器尚未初始化')
  const product=database.getEbayLocalProducts().find(item=>item.id===localProductId)
  if(!product)throw new Error('本地产品不存在或已删除')
  return workspace.prepareEbayLocalProductRevision(`ebay:${product.storeId}`,product)
})
ipcMain.handle('ebay:local-products:remove', (_event, localProductId:string) => removeEbayLocalProduct(localProductId))
ipcMain.handle('ebay:listings:remove-local', (_event, storeId:string, listingId:string) => {
  if(!database)throw new Error('eBay 产品库尚未初始化')
  return database.removeEbayListingLocal(storeId,listingId)
})
ipcMain.handle('ebay:listings:category:update', (_event, storeId:string, listingId:string, categoryId:string) => database?.updateEbayListingCategory(storeId,listingId,categoryId))
ipcMain.handle('ebay:listings:details:sync', (_event, storeId:string, listingId:string) => syncEbayProductDetails(storeId,listingId))
ipcMain.handle('ebay:market-research:get', (_event, storeId:string, listingId:string) => database?.getEbayMarketResearch(storeId,listingId))
ipcMain.handle('ebay:market-research:history', (_event, storeId:string, listingId:string) => database?.getEbayMarketResearchHistory(storeId,listingId) ?? [])
ipcMain.handle('ebay:market-research:open', (_event, request:EbayMarketResearchRequest) => openEbayMarketResearch(request.storeId,request))
ipcMain.handle('ebay:market-research:run', (_event, request:EbayMarketResearchRequest) => researchEbayMarket(request))
ipcMain.handle('ebay:market-research:decide', (_event, request:EbayMarketResearchDecisionRequest) => database?.decideEbayMarketResearchTerm(request))
ipcMain.handle('ebay:title-decision:get', (_event, storeId:string, listingId:string) => database?.getEbayTitleDecision(storeId,listingId))
ipcMain.handle('ebay:title-decision:confirm', (_event, input:EbayTitleDecisionInput) => {
  if(!database)throw new Error('数据库尚未初始化')
  const snapshot=database.getEbayMarketResearch(input.storeId,input.listingId)
  if(!snapshot||snapshot.id!==input.researchSnapshotId)throw new Error('市场证据已变化，请重新生成并审核标题')
  const listing=database.getEbayListings(input.storeId).find(item=>item.listingId===input.listingId)
  if(!listing)throw new Error('原商品已不存在，请返回产品库刷新')
  const variant=input.variants.find(item=>item.id===input.selectedVariantId&&item.title===input.selectedTitle)
  if(!variant)throw new Error('所选标题不属于本次生成方案')
  const originalTitle=(listing.originalTitleVerified&&listing.originalTitle?.trim())?listing.originalTitle.trim():listing.title.trim()
  if(originalTitle!==input.originalTitle.trim())throw new Error('eBay 原标题已变化，请重新生成标题方案')
  const confirmedTerms=[...snapshot.keywords,...snapshot.combinations].filter(item=>item.factStatus==='CONFIRMED')
  const audit=auditEbayTitle(input.selectedTitle,originalTitle,confirmedTerms,input.verifiedFacts||[])
  if(!audit.passed)throw new Error('所选标题未通过字符、重复词、商品事实或市场词检查')
  return database.saveEbayTitleDecision({...input,originalTitle},audit)
})
ipcMain.handle('ebay:categories:get', (_event, storeId:string) => database?.getEbayCategoryWorkspace(storeId) ?? {categories:[]})
ipcMain.handle('ebay:categories:sync', (_event, storeId:string) => syncEbayStoreCategories(storeId))
ipcMain.handle('ebay:product-sync-runs:list', (_event, storeId:string) => database?.getEbayProductSyncRuns(storeId) ?? [])
ipcMain.handle('ebay:category-products:pending', (_event, storeId:string) => database?.getPendingEbayProductSyncCheckpoint(storeId))
ipcMain.handle('ebay:category-products:control', (_event, storeId:string, action:'PAUSE'|'RESUME'|'CANCEL') => {
  if(!database)throw new Error('eBay 工作区尚未初始化')
  const control=ebayDirectorySyncControls.get(storeId)
  if(!control)throw new Error('当前没有正在执行的目录同步任务')
  if(action==='PAUSE'){control.paused=true;database.setEbayProductSyncCheckpointStatus(control.taskId,'PAUSED')}
  if(action==='RESUME'){control.paused=false;database.setEbayProductSyncCheckpointStatus(control.taskId,'RUNNING')}
  if(action==='CANCEL'){control.cancelled=true;control.paused=false;database.setEbayProductSyncCheckpointStatus(control.taskId,'CANCELLED')}
  return {taskId:control.taskId,status:action==='PAUSE'?'PAUSED':action==='RESUME'?'RUNNING':'CANCELLED'}
})
ipcMain.handle('ebay:category-products:sync', async (event, request:EbayDirectoryProductSyncRequest):Promise<EbayDirectoryProductSyncResult> => {
  if(!database||!workspace)throw new Error('eBay 工作区尚未初始化')
  const store=database.getEbayStores().find(item=>item.id===request.storeId)
  if(!store)throw new Error('eBay 店铺不存在')
  if(ebayDirectorySyncControls.has(store.id))throw new Error('同步任务：当前店铺已有目录同步正在运行')
  const categoryWorkspace=database.getEbayCategoryWorkspace(store.id)
  const selected=new Set(request.categoryIds)
  const categories=categoryWorkspace.categories.filter(item=>selected.has(item.categoryId)&&item.status==='ACTIVE'&&item.listingCount>0)
  if(!categories.length)throw new Error('所选目录没有在线商品，请重新选择')
  const suppliedStoreUrl=request.publicStoreUrl?.trim()||''
  if(suppliedStoreUrl&&!/^https:\/\/(?:www\.)?ebay\.com\/str\/[^/?#]+(?:[/?#]|$)/i.test(suppliedStoreUrl))throw new Error('店铺定位：公开店铺地址应为 https://www.ebay.com/str/店铺名')
  const previousPending=database.getPendingEbayProductSyncCheckpoint(store.id)
  if(request.restart&&previousPending)database.deleteEbayProductSyncCheckpoint(previousPending.taskId)
  let checkpoint=request.resumeTaskId?database.getEbayProductSyncCheckpointData(request.resumeTaskId):undefined
  if(checkpoint&&checkpoint.storeId!==store.id)throw new Error('断点恢复：同步任务与当前店铺不一致')
  if(!checkpoint)checkpoint=database.createEbayProductSyncCheckpoint(store.id,categories.map(item=>item.categoryId),suppliedStoreUrl||store.publicStoreUrl)
  const control={taskId:checkpoint.taskId,paused:false,cancelled:false}
  ebayDirectorySyncControls.set(store.id,control)
  const sendProgress=(input:{status?:'RUNNING'|'PAUSED'|'NEEDS_ATTENTION'|'COMPLETED'|'CANCELLED'|'INTERRUPTED';stage:'LOGIN'|'STORE'|'CATEGORY'|'PAGE'|'WRITING'|'COMPLETED';message:string;categoryId?:string;categoryName?:string;categoryIndex?:number;categoryCount?:number;expected?:number;found?:number})=>{
    const current=database!.getEbayProductSyncCheckpointData(checkpoint!.taskId)
    const categoryCount=input.categoryCount||checkpoint!.categoryIds.length||categories.length
    const completed=current?.completedCategoryIds.length||0
    const fraction=input.expected?Math.min(1,(input.found||0)/input.expected):0
    event.sender.send('ebay:directory-sync:progress',{taskId:checkpoint!.taskId,storeId:store.id,status:input.status||'RUNNING',stage:input.stage,message:input.message,categoryId:input.categoryId||'',categoryName:input.categoryName||'',categoryIndex:input.categoryIndex||0,categoryCount,expected:input.expected||0,found:input.found||0,completedCategories:completed,failedCategories:current?.failedCategoryIds.length||0,percent:Math.min(100,Math.round(((completed+fraction)/Math.max(1,categoryCount))*100)),startedAt:checkpoint!.startedAt})
  }
  const waitIfPaused=async()=>{
    while(control.paused&&!control.cancelled)await new Promise(resolve=>setTimeout(resolve,250))
    if(control.cancelled)throw new Error('同步任务：用户已取消本次目录同步')
  }
  try {
    sendProgress({stage:'LOGIN',message:'正在检查 eBay 登录会话'})
    const login=await ensureEbayStoreLogin(store.id)
    if(login.status!=='ONLINE')throw new Error(login.message||'登录检查：eBay登录会话无效，请先完成登录')
    const completed=new Set(checkpoint.completedCategoryIds)
    const remaining=categories.filter(item=>!completed.has(item.categoryId))
    const listingUrls=database.getEbayListings(store.id).map(item=>item.viewUrl).filter(Boolean).slice(0,5)
    const snapshot=remaining.length?await workspace.readEbayDirectoryProducts(`ebay:${store.id}`,remaining,{publicStoreUrl:suppliedStoreUrl||checkpoint.publicStoreUrl||store.publicStoreUrl,sellerId:store.sellerId,loginUsername:store.loginUsername,listingUrls,waitIfPaused,onProgress:input=>sendProgress({...input,status:control.paused?'PAUSED':'RUNNING',categoryCount:checkpoint!.categoryIds.length}),onCategoryComplete:(scan,products,storeUrl)=>{
      database!.saveEbayProductSyncCheckpointCategory(checkpoint!.taskId,scan,products,storeUrl)
      const current=database!.getEbayProductSyncCheckpointData(checkpoint!.taskId)
      sendProgress({stage:'CATEGORY',message:scan.complete?`${scan.categoryName} 读取完成`:`${scan.categoryName} 读取不完整，已保留断点`,categoryId:scan.categoryId,categoryName:scan.categoryName,categoryIndex:current?.completedCategoryIds.length||0,categoryCount:checkpoint!.categoryIds.length})
    }}):{products:checkpoint.products,categories:checkpoint.scans,errors:checkpoint.scans.filter(item=>!item.complete&&item.error).map(item=>item.error),storeUrl:checkpoint.publicStoreUrl||store.publicStoreUrl,sellerId:store.sellerId}
    database.saveEbayPublicStore(store.id,snapshot.storeUrl,snapshot.sellerId)
    const saved=database.getEbayProductSyncCheckpointData(checkpoint.taskId)!
    const productMap=new Map([...saved.products,...snapshot.products].map(item=>[item.listingId,item]))
    const scanMap=new Map([...saved.scans,...snapshot.categories].map(item=>[item.categoryId,item]))
    const allScans=[...scanMap.values()]
    const errors=allScans.filter(item=>!item.complete&&item.error).map(item=>`${item.categoryName}：${item.error}`)
    sendProgress({stage:'WRITING',message:'目录读取完成，正在安全写入线上产品库'})
    const result=database.syncEbayDirectoryProducts(store.id,store.marketplaceId,[...productMap.values()],allScans,errors)
    const failedCategoryIds=allScans.filter(item=>!item.complete).map(item=>item.categoryId)
    if(failedCategoryIds.length)database.setEbayProductSyncCheckpointStatus(checkpoint.taskId,'INTERRUPTED')
    else database.deleteEbayProductSyncCheckpoint(checkpoint.taskId)
    sendProgress({status:failedCategoryIds.length?'INTERRUPTED':'COMPLETED',stage:'COMPLETED',message:failedCategoryIds.length?`同步部分完成，${failedCategoryIds.length} 个目录可单独重试`:'全部目录同步完成',categoryCount:checkpoint.categoryIds.length})
    return {...result,publicStoreUrl:snapshot.storeUrl,failedCategoryIds}
  } catch(error) {
    const message=error instanceof Error?error.message:String(error)
    if(control.cancelled)database.deleteEbayProductSyncCheckpoint(checkpoint.taskId)
    else database.setEbayProductSyncCheckpointStatus(checkpoint.taskId,/验证|captcha|访问频繁|安全检查/i.test(message)?'NEEDS_ATTENTION':'INTERRUPTED')
    sendProgress({status:control.cancelled?'CANCELLED':/验证|captcha|访问频繁|安全检查/i.test(message)?'NEEDS_ATTENTION':'INTERRUPTED',stage:'CATEGORY',message})
    database.recordEbayProductSyncFailure(store.id,categories.length,[message])
    throw error
  } finally {
    ebayDirectorySyncControls.delete(store.id)
  }
})
ipcMain.handle('ebay:collection:confirm', async (_event, storeId:string) => {
  if(!database||!workspace)throw new Error('eBay 工作区尚未初始化')
  const store=database.getEbayStores().find(item=>item.id===storeId)
  if(!store)throw new Error('eBay 店铺不存在')
  const state=await workspace.getEbayPluginState()
  const products=state.products.filter(product=>product.listingId&&product.title)
  if(!products.length)throw new Error('请先在右侧 eBay 页面选择商品')
  const unverified=products.filter(product=>!product.originalTitleVerified||!product.originalTitle?.trim())
  if(unverified.length)throw new Error(`有 ${unverified.length} 个商品未取得 eBay 可验证原标题，请在店铺列表页重新选择后再确认。`)
  const result=database.importEbayCollectedProducts(storeId,store.marketplaceId,products)
  await workspace.clearEbayPluginProducts()
  return result
})
ipcMain.handle('ebay:report:import', async (_event, storeId:string) => {
  if(!database)throw new Error('数据库尚未初始化')
  const store=database.getEbayStores().find(item=>item.id===storeId)
  if(!store)throw new Error('eBay 店铺不存在')
  const selected=await dialog.showOpenDialog({title:'选择 eBay Seller Hub Listings 报表',properties:['openFile'],filters:[{name:'eBay Listings 报表',extensions:['csv','txt']}]})
  if(selected.canceled||!selected.filePaths[0])return null
  const filePath=selected.filePaths[0]
  const parsed=parseEbayListingsReport(fs.readFileSync(filePath,'utf8'),storeId,store.marketplaceId)
  const result=database.importEbayListingsReport(storeId,parsed.listings)
  return {storeId,fileName:path.basename(filePath),...result,failed:parsed.failed,errors:parsed.errors}
})
ipcMain.handle('ebay:optimize:title', (_event, request:EbayTitleOptimizationRequest) => ebayOptimizationService.optimizeTitle(request))
ipcMain.handle('ebay:optimize:content', async (_event, request:EbayContentOptimizationRequest) => {
  const result=await ebayOptimizationService.optimizeContent(request)
  const translation=await translateEbayContent({segments:ebayContentTranslationSource(result.englishDescription)})
  return {...result,translation,chineseReference:translation.segments.map(item=>item.chinese).filter(Boolean).join('\n')}
})
ipcMain.handle('ebay:content-optimization:get', (_event, storeId:string,listingId:string) => database?.getEbayContentOptimizationRecord(storeId,listingId))
ipcMain.handle('ebay:content-optimization:save', (_event, input:EbayContentOptimizationRecordInput) => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.saveEbayContentOptimizationRecord(input)
})
ipcMain.handle('ebay:translate:content', (_event, request:EbayContentTranslationRequest) => translateEbayContent(request))
ipcMain.handle('ebay:optimization:export', async (_event, input:EbayOptimizationExportInput) => {
  const selected=await dialog.showSaveDialog({
    title:'导出 eBay AI 优化素材包',
    defaultPath:`ebay-${input.listing.listingId}-optimization.json`,
    filters:[{name:'JSON 素材包',extensions:['json']}]
  })
  if(selected.canceled||!selected.filePath)return null
  fs.writeFileSync(selected.filePath,JSON.stringify({...input,exportedAt:new Date().toISOString(),schemaVersion:'EBAY-AI-CONTENT-V2'},null,2),'utf8')
  return {filePath:selected.filePath}
})
ipcMain.handle('ebay:optimization-drafts:list', (_event, storeId?:string) => database?.getEbayOptimizationDrafts(storeId) ?? [])
ipcMain.handle('ebay:optimization-drafts:save', (_event, input:EbayOptimizationDraftInput) => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.saveEbayOptimizationDraft(input)
})
ipcMain.handle('ebay:optimization-drafts:validate', (_event, draftId:string) => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.validateEbayOptimizationDraft(draftId)
})
ipcMain.handle('ebay:publish-tasks:list', (_event, storeId?:string) => database?.getEbayPublishTasks(storeId) ?? [])
ipcMain.handle('ebay:publish-tasks:prepare', (_event, draftId:string) => prepareEbayPublishTask(draftId))
ipcMain.handle('ebay:publish-video:generate', (_event, draftId:string) => generateEbayPublishVideo(draftId))
ipcMain.handle('ebay:publish-video:prepare-upload', (_event, draftId:string) => prepareEbayPublishVideoUpload(draftId))
ipcMain.handle('ebay:video-studio:configuration', () => arkVideoService().configuration())
ipcMain.handle('ebay:video-studio:check-capabilities', () => arkVideoService().checkCapabilities())
ipcMain.handle('ebay:video-studio:verify-capability', (_event, request:EbayVideoCapabilityVerificationRequest) => arkVideoService().verifyCapability(request))
ipcMain.handle('ebay:video-studio:list', (_event, listingId:string) => arkVideoService().list(listingId))
ipcMain.handle('ebay:video-studio:confirm', (_event, listingId:string, projectId:string) => arkVideoService().confirm(listingId,projectId))
ipcMain.handle('ebay:video-studio:pick-images', async () => {
  const selected=await dialog.showOpenDialog({
    title:'补充视频图片素材',
    properties:['openFile','multiSelections'],
    filters:[{name:'图片',extensions:['png','jpg','jpeg','webp']}]
  })
  if(selected.canceled)return []
  return selected.filePaths.slice(0,6).map(filePath=>{
    const extension=path.extname(filePath).toLowerCase()
    const mime=extension==='.png'?'image/png':extension==='.webp'?'image/webp':'image/jpeg'
    return {name:path.basename(filePath),dataUrl:`data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`}
  })
})
ipcMain.handle('ebay:video-studio:generate', (event, request:EbayVideoStudioRequest) => arkVideoService().generate(request,progress=>event.sender.send('ebay:video-studio:progress',progress)))
ipcMain.handle('ebay:acceptance:list', (_event, storeId:string) => database?.getEbayAcceptanceBatches(storeId) ?? [])
ipcMain.handle('ebay:acceptance:run', (_event, request:EbayAcceptanceRunRequest) => runEbayAcceptance(request))
ipcMain.handle('ebay:sync', async (_event, storeId:string) => {
  if(!database)throw new Error('数据库尚未初始化')
  try {
    const token=await ebayAccessToken(storeId)
    const listings=await ebayService.fetchActiveListings(storeId,token)
    database.saveEbayListings(storeId,listings)
    const store=database.getEbayStores().find(item=>item.id===storeId)
    return {storeId,imported:listings.length,total:store?.listingCount||listings.length,syncedAt:store?.lastSyncAt||new Date().toISOString()}
  } catch(error) {
    const message=error instanceof Error?error.message:'eBay商品同步失败'
    database.setEbaySyncError(storeId,message)
    throw error
  }
})
ipcMain.handle('compliance:workspace', () => database?.getComplianceKnowledgeWorkspace() ?? {sources:[],sourceChanges:[],rules:[],recalls:[],profiles:[],documents:[],templates:[],tasks:[],alerts:[],auditEvents:[],permits:[],enforcementCases:[],metrics:{activeRules:0,pendingReview:0,recalls:0,staleSources:0,profiles:0,openTasks:0,expiringDocuments:0,blockedProducts:0,validPermits:0,openEnforcementCases:0}})
ipcMain.handle('compliance:rule:save', (_event, draft:ComplianceRuleDraft) => {
  if(!database)throw new Error('数据库尚未初始化')
  if(!draft.code.trim()||!draft.title.trim()||!draft.sourceUrl.trim())throw new Error('规则编码、标题和官方来源不能为空')
  return database.saveComplianceRule(draft)
})
ipcMain.handle('compliance:rule:status', (_event, ruleId:string, status:ComplianceReviewStatus) => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.setComplianceRuleStatus(ruleId,status)
})
ipcMain.handle('compliance:check', (_event, request:ComplianceCheckRequest) => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.runComplianceCheck(request)
})
ipcMain.handle('compliance:check:latest', (_event, productId:string) => database?.getLatestComplianceCheck(productId))
ipcMain.handle('compliance:check:review', (_event, checkId:string, reviewedBy:string, note:string) => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.reviewComplianceCheck(checkId,reviewedBy,note)
})
ipcMain.handle('compliance:profile:save', (_event,draft:ComplianceProductProfileDraft) => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.saveComplianceProfile(draft)
})
ipcMain.handle('compliance:document:choose', async () => {
  const result=await dialog.showOpenDialog({title:'选择合规资料',properties:['openFile'],filters:[{name:'合规文件',extensions:['pdf','png','jpg','jpeg','doc','docx','xls','xlsx']}]})
  if(result.canceled||!result.filePaths[0])return undefined
  const source=result.filePaths[0];const directory=path.join(app.getPath('userData'),'compliance-files');fs.mkdirSync(directory,{recursive:true})
  const target=path.join(directory,`${Date.now()}-${path.basename(source).replace(/[^\w.\-\u4e00-\u9fff]/g,'_')}`);fs.copyFileSync(source,target)
  return {fileName:path.basename(source),filePath:target}
})
ipcMain.handle('compliance:document:save', (_event,draft:ComplianceDocumentDraft) => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.saveComplianceDocument(draft)
})
ipcMain.handle('compliance:template:save', (_event,draft:ComplianceCategoryTemplateDraft) => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.saveComplianceTemplate(draft)
})
ipcMain.handle('compliance:task:update', (_event,taskId:string,status:ComplianceTaskStatus,assignee:string,resolution:string) => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.updateComplianceTask(taskId,status,assignee,resolution)
})
ipcMain.handle('compliance:alert:update', (_event,alertId:string,status:'OPEN'|'ACKNOWLEDGED'|'RESOLVED',note:string) => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.updateComplianceAlert(alertId,status,note)
})
ipcMain.handle('compliance:enforcement:update', (_event,caseId:string,status:ComplianceEnforcementStatus,assignee:string,resolution:string) => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.updateComplianceEnforcementCase(caseId,status,assignee,resolution)
})
ipcMain.handle('compliance:source-change:review', (_event,changeId:string,decision:ComplianceSourceChangeDecision,reviewedBy:string,note:string) => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.reviewComplianceSourceChange(changeId,decision,reviewedBy,note)
})
ipcMain.handle('compliance:permit:export', async (_event,permitId:string) => {
  if(!database)throw new Error('数据库尚未初始化')
  const report=database.getComplianceReleasePermitReport(permitId)
  const selected=await dialog.showSaveDialog({title:'导出发布合规许可',defaultPath:`compliance-permit-${report.permit.productId}-${report.permit.id.slice(0,8)}.json`,filters:[{name:'JSON 合规许可',extensions:['json']}]})
  if(selected.canceled||!selected.filePath)return {canceled:true}
  fs.writeFileSync(selected.filePath,JSON.stringify(report,null,2),'utf8')
  return {canceled:false,filePath:selected.filePath}
})
ipcMain.handle('compliance:evidence:export', async () => {
  if(!database)throw new Error('数据库尚未初始化')
  const date=new Date().toISOString().slice(0,10)
  const result=await dialog.showSaveDialog({title:'导出合规证据报告',defaultPath:`合规证据报告-${date}.json`,filters:[{name:'JSON 证据报告',extensions:['json']}]})
  if(result.canceled||!result.filePath)return {canceled:true}
  fs.writeFileSync(result.filePath,JSON.stringify(database.getComplianceEvidenceReport(),null,2),'utf8')
  return {canceled:false,filePath:result.filePath}
})
ipcMain.handle('compliance:profiles:recheck', (_event,platform='ALL',country='ALL') => {
  if(!database)throw new Error('数据库尚未初始化')
  return database.recheckComplianceProfiles(platform,country)
})
ipcMain.handle('compliance:recalls:sync', async (_event, sourceId:string) => {
  if(!database)throw new Error('数据库尚未初始化')
  return syncOfficialRecalls(sourceId)
})
ipcMain.handle('compliance:source:sync', async (_event, sourceId:string) => {
  if(!database)throw new Error('数据库尚未初始化')
  return syncComplianceSource(sourceId)
})
ipcMain.handle('marketplace:profiles', () => database?.getMarketplaceProfiles() ?? { platforms: [], accounts: [] })
ipcMain.handle('marketplace:account:add', (_event, platformCode: MarketplacePlatformCode, name: string) => {
  if (!name.trim()) throw new Error('请输入账号名称')
  return database?.addMarketplaceAccount(platformCode, name.trim())
})
ipcMain.handle('marketplace:activate', (_event, platformCode: MarketplacePlatformCode, accountId: string, strategy: NetworkStrategy) => workspace?.activateMarketplace(platformCode, accountId, strategy))
ipcMain.handle('marketplace:credential:status', (_event, accountId: string) => {
  const row = database?.getMarketplaceCredential(accountId)
  return { accountId, username:row?.username || '', passwordSaved:Boolean(row?.encrypted_password), mode:row?.automation_mode || 'SESSION_ONLY', updatedAt:row?.updated_at }
})
ipcMain.handle('marketplace:credential:save', (_event, input: MarketplaceCredentialInput) => {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统安全存储不可用，未保存密码')
  const encryptedPassword = input.password ? safeStorage.encryptString(input.password).toString('base64') : ''
  const row = database?.saveMarketplaceCredential({ accountId:input.accountId, platformCode:input.platformCode, username:input.username.trim(), encryptedPassword, mode:input.mode })
  return { accountId:input.accountId, username:row?.username || '', passwordSaved:Boolean(row?.encrypted_password), mode:row?.automation_mode || 'SESSION_ONLY', updatedAt:row?.updated_at }
})
ipcMain.handle('marketplace:credential:delete', (_event, accountId: string) => { database?.deleteMarketplaceCredential(accountId); return { accountId, username:'', passwordSaved:false, mode:'SESSION_ONLY' } })
ipcMain.handle('marketplace:credential:open-login', (_event, accountId: string, platformCode: string) => {
  const profiles: Record<string,{title:string;url:string;domains:string[]}> = {
    GIGACLOUD:{title:'大健云仓登录',url:'https://www.gigab2b.com/index.php?route=account/login',domains:['gigab2b.com']},
    '1688':{title:'1688登录',url:'https://login.1688.com/',domains:['1688.com']},
    EBAY:{title:'eBay登录',url:'https://www.ebay.com/signin/',domains:['ebay.com']}
  }
  const profile=profiles[platformCode]
  if(!profile) throw new Error('当前平台尚未配置专用登录地址')
  return workspace?.openCredentialLogin(accountId,profile.title,profile.url,profile.domains)
})
ipcMain.handle('marketplace:credential:fill', async (_event, accountId: string, submit = false) => {
  const row = database?.getMarketplaceCredential(accountId)
  if (!row?.encrypted_password) throw new Error('当前账号未保存密码')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法解密登录凭据')
  const password = safeStorage.decryptString(Buffer.from(row.encrypted_password,'base64'))
  return workspace?.fillActiveLogin(row.username,password,submit)
})
ipcMain.handle('image:models', async () => {
  if(process.env.CODEX_UI_TEST==='1')return{connected:true,models:[{id:'phase7-mock',name:'阶段7验收模型',description:'批量验收专用',maxReferenceImages:4,costLabel:'¥0.20/张'}],message:'阶段7验收模型已连接'}
  // 聚合百炼 / 火山方舟 / OpenAI 三个服务商的可用生图模型；单个服务商失败不影响其他模型列表
  const [bailian, volc, openai] = await Promise.allSettled([
    imageService.connection(),
    volcImageService.connection(),
    openaiImageService.connection()
  ])
  const models: ImageModelProfile[] = []
  if (bailian.status === 'fulfilled') models.push(...bailian.value.models)
  if (volc.status === 'fulfilled') models.push(...volc.value.models)
  if (openai.status === 'fulfilled') models.push(...openai.value.models)
  const connected = models.length > 0
  return { connected, models, message: connected ? `已聚合 ${models.length} 个生图模型` : '暂无可用生图模型' }
})
ipcMain.handle('image:generate', (_event, request: ImageGenerationRequest) => {
  if(process.env.CODEX_UI_TEST==='1'&&request.model==='phase7-mock'){
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="#f3efe7"/><rect x="240" y="160" width="320" height="480" rx="28" fill="#45b9d6"/></svg>'
    return{taskId:`phase7-${Date.now()}`,imageUrls:[`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`]}
  }
  // 按模型 ID 路由到对应服务商；默认仍走百炼，保持已有 7 个百炼模型行为不变
  if (request.model.startsWith('doubao-seedream')) return volcImageService.generate(request)
  if (request.model === 'gpt-image-2') return openaiImageService.generate(request)
  return imageService.generate(request)
})
ipcMain.handle('image:translate-marketing',async(_event,request:ImageMarketingTranslationRequest):Promise<ImageMarketingTranslationResult>=>{
  if(process.env.CODEX_UI_TEST==='1')return{model:'phase7-mock-translation',targetLanguage:request.targetLanguage,translations:request.texts.map((_text,index)=>index?'Описание товара':'Товар для дома'),status:'TRANSLATED',issues:[]}
  const target=request.targetLanguage==='俄语'?'Russian':request.targetLanguage==='英语'?'English':request.targetLanguage==='西班牙语'?'Spanish':request.targetLanguage
  const domain=`跨境电商图片营销文案。翻译为${request.targetLanguage}。必须完整保留所有数字、尺寸、单位、品牌、型号、SKU和以下术语：${(request.protectedTerms||[]).join('、')||'无'}。不要翻译或改写商品包装上的原文。`
  const translated=await translationService.translateTexts(request.texts,target,domain),translations=request.texts.map(text=>translated.get(text)||text)
  const issues=validateMarketingTranslation(request.texts,translations,request.targetLanguage,request.protectedTerms)
  return{model:'qwen-mt-flash',targetLanguage:request.targetLanguage,translations,status:issues.length?'REVIEW':'TRANSLATED',issues}
})
ipcMain.handle('image:ground', (_event, request: EbayImageGroundingRequest) => ebayImageGroundingService.ground(request))
ipcMain.handle('image:extract-package-text',(_event,request)=>process.env.CODEX_UI_TEST==='1'?{model:'phase9-ocr-mock',observations:[{sourceIndex:0,rawText:'宠物训练垫 M码 50片',fields:{productName:'宠物训练垫',specification:'M码',quantity:'50片'},confidence:96},{sourceIndex:1,rawText:'宠物训练垫 L码 40片',fields:{productName:'宠物训练垫',specification:'L码',quantity:'40片'},confidence:94}],conflicts:['specification','quantity'],combinedText:'图1：宠物训练垫 M码 50片\n图2：宠物训练垫 L码 40片',warnings:['不同参考图存在字段冲突：specification、quantity，必须人工选择正确规格'],analyzedAt:new Date().toISOString()}:ebayImageGroundingService.extractPackageText(request))
let phase6QaReviewCount=0
ipcMain.handle('image:review-candidate', (_event, request: EbayImageCandidateReviewRequest) => {
  if(process.env.CODEX_UI_TEST==='1'&&request.title==='阶段6测试商品'){
    phase6QaReviewCount+=1
    const rejected=phase6QaReviewCount>1
    return {candidateUrl:request.candidateUrl,purpose:request.purpose,status:rejected?'REJECTED' as const:'PASSED' as const,identityScore:rejected?45:96,structuralScore:rejected?40:95,factScore:rejected?35:94,purposeScore:93,diversityScore:90,geometryScore:rejected?40:95,styleScore:91,languageScore:92,reason:rejected?'局部修改引入虚构结构':'局部修改后一致',referenceIndices:[0],newStructures:rejected?['虚构配件']:[],missingStructures:[],geometryMismatch:rejected}
  }
  if(process.env.CODEX_UI_TEST==='1'&&request.title==='阶段7批量商品')return {candidateUrl:request.candidateUrl,purpose:request.purpose,status:'PASSED' as const,identityScore:96,structuralScore:95,factScore:94,purposeScore:93,diversityScore:90,geometryScore:95,styleScore:91,languageScore:92,reason:'批量候选符合四层门禁',referenceIndices:request.referenceIndices,newStructures:[],missingStructures:[],geometryMismatch:false}
  return ebayImageGroundingService.reviewCandidate(request)
})
ipcMain.handle('image:suggest-roles', (_event, request: EbayImageRoleSuggestionRequest) => ebayImageGroundingService.suggestRoles(request))

// ─── 阶段式图片优化 IPC ─────────────────────────────────────────────────────
ipcMain.handle('image:stage-grounding', (_event, request: EbayStageGroundingRequest) => ebayImageGroundingService.stageGround(request))
ipcMain.handle('image:stage-storyboard', (_event, request: EbayStageStoryboardRequest) => ebayImageGroundingService.generateStageStoryboard(request))
ipcMain.handle('image:stage-model-recommend', (_event, stage: EbayImageStage) => ebayImageGroundingService.recommendStageModels(stage))

ipcMain.handle('image:realshift', (_event, request: RealShiftRequest) => new RealShiftService().process(request))
ipcMain.handle('image:realshift:preflight', () => new RealShiftService().preflight())
ipcMain.handle('image:realshift:select', (_event, reportPath: string, choice: 'original' | 'processed') => new RealShiftService().saveSelection(reportPath, choice))
ipcMain.handle('image:realshift:pick', async () => {
  const result = await dialog.showOpenDialog({ properties:['openFile'], filters:[{ name:'图片', extensions:['png','jpg','jpeg','webp','bmp','tif','tiff'] }] })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('image:source:pick-local', async ():Promise<ImportedProductSource|null> => {
  const result = await dialog.showOpenDialog({ title:'选择商品图片', properties:['openFile','multiSelections'], filters:[{ name:'商品图片', extensions:['png','jpg','jpeg','webp'] }] })
  if (result.canceled || !result.filePaths.length) return null
  const mimeByExtension:Record<string,ImportedProductImage['mimeType']>={'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}
  let totalBytes=0
  const images:ImportedProductImage[]=[]
  for (const filePath of result.filePaths) {
    const extension=path.extname(filePath).toLocaleLowerCase()
    const mimeType=mimeByExtension[extension]
    if(!mimeType)throw new Error(`不支持的图片格式：${path.basename(filePath)}`)
    const stats=fs.statSync(filePath)
    if(stats.size>15*1024*1024)throw new Error(`图片超过 15MB：${path.basename(filePath)}`)
    totalBytes+=stats.size
    if(totalBytes>48*1024*1024)throw new Error('本次图片总大小不能超过 48MB')
    const bytes=fs.readFileSync(filePath)
    images.push({id:crypto.randomUUID(),name:path.basename(filePath),dataUrl:`data:${mimeType};base64,${bytes.toString('base64')}`,source:filePath,mimeType,role:images.length===0?'PRIMARY':'DETAIL'})
  }
  const first=images[0]
  const title=path.basename(first.name,path.extname(first.name))
  return {sourceKind:'LOCAL',sourceLabel:'本地图片',title,productId:`LOCAL-${Date.now()}`,priceText:'价格待补充',imageUrl:first.dataUrl,images,evidence:[{field:'title',value:title,source:first.source},...images.map(image=>({field:'imageUrl' as const,value:image.source,source:image.source}))]}
})
ipcMain.handle('image:source:read-url', async(_event, value:string):Promise<ImportedProductSource> => {
  const supplySession=session.fromPartition('persist:supply:1688:default')
  const cookies=await supplySession.cookies.get({domain:'.1688.com'})
  const cookieHeader=cookies.map(cookie=>`${cookie.name}=${cookie.value}`).join('; ')
  let prefetchedHtml:string|undefined
  if(/https?:\/\/[^/]*1688\.com\//i.test(value)){
    // 优先复用内置1688浏览器的真实登录态与渲染结果；服务器公网IP会被1688直接风控。
    if(workspace)prefetchedHtml=await workspace.read1688ProductPage(value)
    else try{
      const response=await supplySession.fetch(value,{headers:{'user-agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0 Safari/537.36','accept-language':'zh-CN,zh;q=0.9'}})
      if(response.ok)prefetchedHtml=await response.text()
    }catch{/* 服务层继续使用安全回退 */}
  }
  return importProductUrl(value,cookieHeader,prefetchedHtml)
})

ipcMain.handle('task:start', async (event, taskId: string) => {
  const task = tasks.get(taskId) ?? database?.getTask(taskId)
  if (!task) throw new Error('任务不存在，请重新创建')
  return executeTask(task, progress => event.sender.send('task:progress', progress))
})
ipcMain.handle('task:preview', async (event, taskId: string) => {
  const task = tasks.get(taskId) ?? database?.getTask(taskId)
  if (!task) throw new Error('任务不存在，请重新创建')
  return previewTask(task, progress => event.sender.send('task:progress', progress))
})
ipcMain.handle('task:confirm-preview', async (event, request: CollectionPreviewConfirmRequest) => {
  const task = tasks.get(request.taskId) ?? database?.getTask(request.taskId)
  if (!task) throw new Error('任务不存在，请重新创建')
  return executeTask(task, progress => event.sender.send('task:progress', progress), request.selectedUrls)
})

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.restore()
    mainWindow.focus()
  } else if (app.isReady()) {
    createWindow()
  }
})

const serverProcessManager = new ServerProcessManager(app.getAppPath())
const YANDU_SERVER_HOST = '114.55.149.192'
const YANDU_SERVER_CERT_FINGERPRINTS = new Set([
  '25:71:B5:1C:C2:8F:EA:19:21:58:A2:2D:CC:AA:D0:F6:64:50:02:B2',
  '46:5C:54:0A:F9:ED:69:F5:10:46:21:51:09:D8:8E:A8:AF:FA:91:F1:8D:A6:3E:41:B3:8D:87:C1:6F:C5:04:CA',
  'sha256/RlxUCvntafUQRiFRCdiOqK/6kfGNpj5Bs42HwW/FBMo='
])
const deepSeekHarnessSourceDir = app.isPackaged
  ? path.join(process.resourcesPath, 'deepseek-harness')
  : path.join(app.getAppPath(), 'vendor', 'deepseek-harness')
const deepSeekHarnessProcessManager = new DeepSeekHarnessProcessManager(deepSeekHarnessSourceDir, app.getPath('userData'))
ipcMain.handle('deepseek-harness:status', () => deepSeekHarnessProcessManager.status())
ipcMain.handle('deepseek-harness:start', () => deepSeekHarnessProcessManager.start())
ipcMain.handle('deepseek-harness:connect', async (_event, ticket: unknown) => {
  if (typeof ticket !== 'string' || !ticket) throw new Error('缺少 Harness 访问票据')
  const origin = new URL(readServerUrl())
  if (origin.hostname !== YANDU_SERVER_HOST) throw new Error('Harness 仅支持已配置的中央服务器')
  origin.protocol = 'https:'
  const response = await net.fetch(new URL('/harness/session', origin).toString(), {
    method: 'POST', headers: { authorization: `Bearer ${ticket}` }, signal: AbortSignal.timeout(15_000)
  })
  if (!response.ok) throw new Error(`Harness 网关拒绝访问（HTTP ${response.status}）`)
  const setCookie = response.headers.get('set-cookie')
  const cookie = setCookie?.match(/^([^=]+)=([^;]+)/)
  if (!cookie) throw new Error('Harness 网关未返回会话 Cookie')
  const maxAge = Number(setCookie?.match(/(?:^|;)\s*Max-Age=(\d+)/i)?.[1] ?? 0)
  await session.defaultSession.cookies.set({
    url: origin.toString(), name: cookie[1], value: cookie[2], path: '/', secure: true, httpOnly: true,
    sameSite: 'no_restriction', expirationDate: Math.floor(Date.now() / 1000) + Math.max(1, maxAge)
  })
  const harnessUrl = new URL('/harness/', origin)
  harnessUrl.searchParams.set('session', String(Date.now()))
  return { url: harnessUrl.toString(), message: '已建立受限云端会话' }
})
// 服务器地址配置 IPC（S2 远程模式）：渲染层启动时同步 localStorage 值，登录页保存时写回
ipcMain.handle('server-config:get', () => readServerUrl())
ipcMain.handle('server-config:set', (_event, url: unknown) => {
  if (typeof url !== 'string' || !url.trim()) return readServerUrl()
  writeServerUrl(url)
  // 从本地模式切到远程模式时，停掉已拉起的本地服务栈（stop 幂等，未启动时直接返回）
  if (!isLocalServerUrl(url)) serverProcessManager.stop().catch(() => undefined)
  return readServerUrl()
})
// 登录页版本信息（S4）：当前版本取应用自身，最新版本从 OSS 更新源 latest.yml 读取比对（与 electron-builder.yml publish.url 一致）
const UPDATE_BASE_URL = 'https://yandu-download.oss-cn-hangzhou.aliyuncs.com/'
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}
ipcMain.handle('app:check-update', async () => {
  const current = app.getVersion()
  try {
    const response = await net.fetch(`${UPDATE_BASE_URL}latest.yml`, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const text = await response.text()
    const matched = text.match(/^version:\s*([0-9][^\s]*)/m)
    const latest = matched ? matched[1] : ''
    return { current, latest, isLatest: !latest || compareVersions(current, latest) >= 0, error: '' }
  } catch (error) {
    return { current, latest: '', isLatest: true, error: error instanceof Error ? error.message : String(error) }
  }
})
ipcMain.handle('app:open-download', () => {
  void shell.openExternal(`${readServerUrl().replace(/\/+$/, '')}/download/`).catch(() => undefined)
  return true
})
// 运营知识库语言预置：RAGFlow 前端只认同域 localStorage 的 lng 键（不设则回退英文），
// 且首次加载会自行写入 'en'，因此只要当前值不是中文变体（zh-Hans/zh-Hant 等）就强制写入 zh-Hans，
// 用隐藏窗口访问 8090 一次，使 iframe 内 RAGFlow（含登录页）默认显示中文
function presetRagflowLanguage() {
  const ragflowUrl = (() => {
    try {
      const base = new URL(readServerUrl())
      base.port = '8090'
      base.pathname = '/'
      return base.toString()
    } catch {
      return null
    }
  })()
  if (!ragflowUrl) return
  const win = new BrowserWindow({ show: false, width: 100, height: 100, webPreferences: { offscreen: true } })
  const timer = setTimeout(() => { if (!win.isDestroyed()) win.close() }, 20000)
  win.loadURL(ragflowUrl)
    .then(() => win.webContents.executeJavaScript(
      `(() => { try { const cur = localStorage.getItem('lng'); if (cur && cur.startsWith('zh')) return 'keep:' + cur; localStorage.setItem('lng', 'zh-Hans'); return 'set'; } catch { return 'error'; } })()`
    ))
    .then(result => console.log(`[ragflow] 语言预置结果：${String(result)}`))
    .catch(error => console.warn('[ragflow] 语言预置失败（服务不可达或加载超时）：', error.message))
    .finally(() => {
      clearTimeout(timer)
      if (!win.isDestroyed()) win.close()
    })
}
if (hasSingleInstanceLock) app.whenReady().then(async () => {
  session.defaultSession.setCertificateVerifyProc((request, callback) => {
    const cert = request.certificate as { fingerprint?: string }
    const trusted = request.hostname === YANDU_SERVER_HOST && YANDU_SERVER_CERT_FINGERPRINTS.has(cert.fingerprint ?? '')
    if (request.hostname === YANDU_SERVER_HOST) {
      console.info(`[tls] Harness certificate pin matched=${trusted}; fingerprint-present=${Boolean(cert.fingerprint)}`)
    }
    callback(trusted ? 0 : -3)
  })
  if (!(await instanceGuard)) return
  const serverUrl = readServerUrl()
  if (isLocalServerUrl(serverUrl)) {
    serverProcessManager.start().catch(error => console.error('[server-manager] 本地服务自动拉起失败：', error))
  } else {
    console.log(`[server-manager] 服务器地址为远程（${serverUrl}），跳过本地服务拉起`)
    // RAGFlow 部署在中央服务器上，仅远程模式需要预置；分三次延迟执行（幂等），
    // 覆盖服务瞬时不可达/加载超时的情况；打开运营知识库时渲染层还会再次触发（ragflow:preset-language）
    scheduleRagflowPreset()
  }
  initAutoUpdate()
  // 知识库守卫：分钟级调度 + 启动 60s 后补跑错过周期的技能（不依赖打包态，独立于自动更新）
  kbGuardianService.startScheduler()
  kbGuardianService.scheduleCatchup()
  // I.2 阶段新增：启动时幂等保证「报告样例库自动同步」预置技能存在（仅 ensure，不主动 runNow）
  void SampleLibraryKbGuardianLauncher.ensure(ragflowKnowledgeService, kbGuardianService)
    .catch(error => console.warn('[sample-library-kb-guardian] 预置技能注册失败：', (error as Error).message))
  createWindow()
})

// 启动后分三次预置（幂等）：3s 避开登录初始化高峰，30s/120s 兜底覆盖服务瞬时不可达；
// 另提供 IPC 供渲染层在打开运营知识库时再次触发
function scheduleRagflowPreset() {
  for (const delay of [3000, 30000, 120000]) setTimeout(presetRagflowLanguage, delay)
}
ipcMain.handle('ragflow:preset-language', () => {
  presetRagflowLanguage()
  return true
})

// 自动更新：更新源为阿里云 OSS（electron-builder.yml 的 publish.generic）；
// 下载进度/失败原因通过 app:update-status 推给渲染层（右下角悬浮提示），避免静默失败无感知
type AppUpdateStatus = { phase: 'downloading' | 'downloaded' | 'error'; version: string; percent?: number; message?: string }
function sendUpdateStatus(status: AppUpdateStatus) {
  shellWebContents?.send('app:update-status', status)
}
// 已下载完成待安装的目标版本；退出时若存在则静默安装（Windows NSIS），避免用户反复点「稍后」停留在旧版
let updateDownloadedVersion = ''
let updateInstallStarted = false
function initAutoUpdate() {
  if (!app.isPackaged) return // 开发模式跳过
  autoUpdater.autoDownload = true
  let pendingVersion = ''
  autoUpdater.on('update-available', info => {
    pendingVersion = info.version
    console.log(`[updater] 发现新版本 v${info.version}，开始后台下载`)
    sendUpdateStatus({ phase: 'downloading', version: info.version, percent: 0 })
  })
  // 进度事件触发频繁，仅整数百分比变化时推送
  let lastSentPercent = -1
  autoUpdater.on('download-progress', progress => {
    const percent = Math.floor(progress.percent)
    if (percent === lastSentPercent) return
    lastSentPercent = percent
    sendUpdateStatus({ phase: 'downloading', version: pendingVersion, percent })
  })
  autoUpdater.on('update-downloaded', info => {
    lastSentPercent = -1
    updateDownloadedVersion = info.version
    sendUpdateStatus({ phase: 'downloaded', version: info.version })
    void dialog.showMessageBox({
      type: 'info',
      title: '发现新版本',
      message: `新版本 v${info.version} 已下载完成，重启应用即可安装。`,
      buttons: ['立即重启安装', '稍后'],
      defaultId: 0
    }).then(({ response }) => {
      if (response === 0) {
        updateInstallStarted = true
        autoUpdater.quitAndInstall()
      }
    })
  })
  autoUpdater.on('error', error => {
    console.error('[updater] 自动更新失败：', error.message)
    sendUpdateStatus({ phase: 'error', version: pendingVersion || app.getVersion(), message: error.message })
  })
  void autoUpdater.checkForUpdates().catch(() => undefined)
  setInterval(() => { void autoUpdater.checkForUpdates().catch(() => undefined) }, 4 * 60 * 60 * 1000)
}
// 渲染层悬浮提示/登录门禁点「重启安装」时触发（与弹窗的「立即重启安装」等价）
ipcMain.handle('app:install-update', () => {
  updateInstallStarted = true
  autoUpdater.quitAndInstall()
  return true
})
let serverShutdownDone = false
app.on('will-quit', event => {
  if (serverShutdownDone) return
  event.preventDefault()
  Promise.all([
    serverProcessManager.stop().catch(error => console.error('[server-manager] 关闭本地服务失败：', error)),
    deepSeekHarnessProcessManager.stop().catch(error => console.error('[deepseek-harness] 关闭本地服务失败：', error)),
    shutdownAdvisorRuntime().catch(error => console.error('[advisor] 关闭在线参谋运行时失败：', error))
  ]).finally(() => {
    serverShutdownDone = true
    // Windows 下更新包已下载完成时，退出即静默安装并启动新版（差量下载由 blockmap 自动生效）；
    // macOS 为 dmg 分发无法静默安装，仍走下载完成弹窗流程
    if (process.platform === 'win32' && updateDownloadedVersion && !updateInstallStarted) {
      updateInstallStarted = true
      console.log(`[updater] 退出时静默安装 v${updateDownloadedVersion}`)
      autoUpdater.quitAndInstall(true, true)
    } else {
      app.quit()
    }
  })
})
app.on('window-all-closed', () => {
  feishuBot?.close()
  if(complianceSyncTimer)clearInterval(complianceSyncTimer)
  app.quit()
})
app.on('activate', () => {
  if (!mainWindow) createWindow()
})
