import { contextBridge, ipcRenderer } from 'electron'
import type { BrowserBounds, BrowserState, BrowserTab, BrowserTranslationMode, BrowserTranslationStatus, BuiltInCollectorState, CandidateUpdateRequest, CandidateWorkspace, CollectionPreviewConfirmRequest, CollectionPreviewResult, CollectorPluginImportResult, ComparisonImportRequest, ComparisonPromotionRequest, ComparisonPromotionResult, ComparisonUpdateRequest, ComplianceAlert, ComplianceAlertStatus, ComplianceCategoryTemplate, ComplianceCategoryTemplateDraft, ComplianceCheckRequest, ComplianceCheckResult, ComplianceDocumentDraft, ComplianceDocumentRecord, ComplianceEnforcementCase, ComplianceEnforcementStatus, ComplianceKnowledgeWorkspace, ComplianceProductProfile, ComplianceProductProfileDraft, ComplianceReviewStatus, ComplianceRule, ComplianceRuleDraft, ComplianceSourceChangeDecision, ComplianceSourceChangeReviewResult, ComplianceTaskRecord, ComplianceTaskStatus, EbayAcceptanceBatch, EbayAcceptanceRunRequest, EbayBrowserPluginState, EbayCategoryWorkspace, EbayCollectionImportResult, EbayConfigurationStatus, EbayContentOptimizationRecord, EbayContentOptimizationRecordInput, EbayContentOptimizationRequest, EbayContentOptimizationResult, EbayContentTranslationRequest, EbayContentTranslationResult, EbayDeliveryLocationResult, EbayDirectoryProductSyncCheckpoint, EbayDirectoryProductSyncProgress, EbayDirectoryProductSyncRequest, EbayDirectoryProductSyncResult, EbayImageCandidateReview, EbayImageCandidateReviewRequest, EbayImageGroundingPlan, EbayImageGroundingRequest, EbayImageRoleSuggestionRequest, EbayImageRoleSuggestionResult, EbayImageStage, EbayImageVisualInspectionReport, EbayImageVisualReviewInput, EbayListing, EbayLocalProduct, EbayLocalProductMedia, EbayLocalProductMediaUploadInput, EbayLocalProductSnapshot, EbayLocalProductUpdateInput, EbayLoginResult, EbayMarketResearchDecisionRequest, EbayMarketResearchRequest, EbayMarketResearchSnapshot, EbayOptimizationDraft, EbayOptimizationDraftInput, EbayOptimizationExportInput, EbayOptimizationExportResult, EbayProductSyncRun, EbayPublishComplianceValidation, EbayPublishTask, EbayReportImportResult, EbayStageFactCard, EbayStageGroundingRequest, EbayStageModelRecommendation, EbayStageStoryboardCard, EbayStageStoryboardRequest, EbayStore, EbaySyncResult, EbayTitleOptimizationRequest, EbayTitleOptimizationResult, EbayVideoStudioConfiguration, EbayVideoStudioProgress, EbayVideoStudioProject, EbayVideoStudioRequest, ImageGenerationRequest, ImageGenerationResult, ImageMarketingTranslationRequest, ImageMarketingTranslationResult, ImageModelConnection, ImportedProductSource, MarketplaceAccountProfile, MarketplaceCredentialInput, MarketplaceCredentialStatus, MarketplaceMediaAsset, MarketplaceMediaAssetType, MarketplacePlatformCode, MarketplacePlatformProfile, MarketplacePublishAudit, MarketplacePublishDraft, MarketplacePublishDraftUpdate, MarketplaceSelectionProduct, NetworkStrategy, Platform, RealShiftRequest, RealShiftResult, SelectionDecision, SelectionImportRequest, SelectionTaskDraft, SupplyActivationResult, SupplyWarehouseProduct, TaskProgress, WorkflowCounts } from '../shared/contracts'
import type { ComplianceBatchRecheckResult, EbayImageInspectionReport } from '../shared/contracts'
import type { EbayVideoCapabilityVerificationRequest } from '../shared/contracts'
import type { EbayLocalListingRequirements, EbayLocalRevisionPreparationResult } from '../shared/contracts'
import type { EbayTitleDecision, EbayTitleDecisionInput } from '../shared/contracts'
import type { ImagePackageTextExtractionRequest, ImagePackageTextExtractionResult } from '../shared/contracts'
import type { AdvisorApprovalDecision, AdvisorChatEvent, AdvisorChatRequest, AdvisorIncomingImage, AdvisorPersonalizationSettings } from '../shared/advisor'
import type { AiEmployeeAskRequest, AiEmployeeChatModelProfile, AiEmployeePickResult } from '../shared/aiEmployee'
import type { ExtractedProductInfo } from '../shared/selectionExtract'
import type { AmazonDataSourceSearchResult, AmazonListingEvidence, AmazonMarketSample, AmazonReviewEvidence, AmazonSearchIntent } from '../shared/amazonScraper'
import type { KbAgentKey, KbDocsView, KbListView, KbView } from '../shared/knowledge'
import type { GuardianRetryRequest, GuardianRetryResult, GuardianRunEvent, GuardianRunLog, GuardianSkill, GuardianSkillInput, GuardianState } from '../shared/kbGuardian'

contextBridge.exposeInMainWorld('desktop', {
  platform: ipcRenderer.sendSync('app:platform') as string,
  windowControls: {
    minimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:maximize-toggle'),
    close: (): Promise<void> => ipcRenderer.invoke('window:close'),
    isMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
    onMaximized: (callback: (maximized: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean) => callback(maximized)
      ipcRenderer.on('window:maximized', listener)
      return () => ipcRenderer.removeListener('window:maximized', listener)
    }
  },
  system: {
    openVpnPanel: (): Promise<void> => ipcRenderer.invoke('system:open-vpn-panel'),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('system:open-external', url),
    watchSkillStatus: (): Promise<{ checks: Record<string, boolean>; root: string; version: string }> => ipcRenderer.invoke('watch-skill:status'),
    watchSkillPickVideo: (): Promise<string | null> => ipcRenderer.invoke('watch-skill:pick-video'),
    watchSkillDownloadYoutube: (url:string): Promise<string> => ipcRenderer.invoke('watch-skill:download-youtube',url),
    watchSkillAnalyze: (videoPath: string): Promise<{ id:string; videoPath:string; createdAt:string; status:'COMPLETED'|'FAILED'; report:string; framePaths:string[]; error?:string }> => ipcRenderer.invoke('watch-skill:analyze', videoPath),
    watchSkillTasks: (): Promise<Array<{ id:string; videoPath:string; createdAt:string; status:'COMPLETED'|'FAILED'; report:string; framePaths:string[]; error?:string }>> => ipcRenderer.invoke('watch-skill:tasks')
    ,resource2SkillStatus: (): Promise<{sourceReady:boolean;officialRuntimeReady:boolean;python311Ready:boolean;adapterReady:boolean;domains:string[];note:string}> => ipcRenderer.invoke('resource2skill:status')
    ,resource2SkillDrafts: (): Promise<Array<{id:string;sourceTaskId:string;name:string;content:string;createdAt:string;updatedAt:string}>> => ipcRenderer.invoke('resource2skill:drafts')
    ,resource2SkillGenerate: (taskId:string,domain:string): Promise<{id:string;sourceTaskId:string;name:string;content:string;createdAt:string;updatedAt:string}> => ipcRenderer.invoke('resource2skill:generate',taskId,domain)
    ,resource2SkillModelSettings: (): Promise<{configured:boolean;baseUrl:string}> => ipcRenderer.invoke('resource2skill:model-settings')
    ,resource2SkillModelSettingsSave: (input:{apiKey:string;baseUrl:string}): Promise<{configured:boolean;baseUrl:string}> => ipcRenderer.invoke('resource2skill:model-settings-save',input)
    ,resource2SkillModelSettingsClear: (): Promise<{configured:boolean}> => ipcRenderer.invoke('resource2skill:model-settings-clear')
    ,resource2SkillOfficialAnalyze: (input:{url:string;domain:string}): Promise<{id:string;sourceTaskId:string;name:string;content:string;createdAt:string;updatedAt:string}> => ipcRenderer.invoke('resource2skill:official-analyze',input)
    ,resource2SkillTextDistill: (input:{reportPath:string;domain:string;sourceUrl?:string}): Promise<{analysis:string;domain:string;sourceUrl:string;reportPath:string}> => ipcRenderer.invoke('resource2skill:text-distill',input)
    ,resource2SkillDistillWatch: (input:{taskId:string;domain:string}): Promise<{id:string;sourceTaskId:string;name:string;content:string;createdAt:string;updatedAt:string}> => ipcRenderer.invoke('resource2skill:distill-watch',input)
    ,resource2SkillSave: (input:{id:string;name:string;content:string}): Promise<{id:string;sourceTaskId:string;name:string;content:string;createdAt:string;updatedAt:string;filePath:string}> => ipcRenderer.invoke('resource2skill:save',input)
  },
  serverConfig: {
    get: (): Promise<string> => ipcRenderer.invoke('server-config:get'),
    set: (url: string): Promise<string> => ipcRenderer.invoke('server-config:set', url)
  },
  appInfo: {
    checkUpdate: (): Promise<{ current: string; latest: string; isLatest: boolean; error: string }> => ipcRenderer.invoke('app:check-update'),
    openDownload: (): Promise<boolean> => ipcRenderer.invoke('app:open-download'),
    installUpdate: (): Promise<boolean> => ipcRenderer.invoke('app:install-update'),
    onUpdateStatus: (callback: (status: { phase: 'downloading' | 'downloaded' | 'error'; version: string; percent?: number; message?: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: { phase: 'downloading' | 'downloaded' | 'error'; version: string; percent?: number; message?: string }) => callback(status)
      ipcRenderer.on('app:update-status', listener)
      return () => ipcRenderer.removeListener('app:update-status', listener)
    }
  },
  ragflow: {
    presetLanguage: (): Promise<boolean> => ipcRenderer.invoke('ragflow:preset-language')
  },
  llmKeys: {
    list: (): Promise<Array<{ id: string; configured: boolean; maskedKey: string }>> => ipcRenderer.invoke('llm-keys:list'),
    save: (id: string, value: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('llm-keys:save', { id, value }),
    test: (id: string): Promise<{ ok: boolean; latencyMs?: number; error?: string }> => ipcRenderer.invoke('llm-keys:test', { id }),
    restart: (): Promise<void> => ipcRenderer.invoke('llm-keys:restart')
  },
  kb: {
    list: (): Promise<KbListView> => ipcRenderer.invoke('kb:list'),
    createCustom: (request: { name: string; description: string }): Promise<KbView> => ipcRenderer.invoke('kb:create-custom', request),
    ensureAgent: (agentKey: KbAgentKey): Promise<KbView> => ipcRenderer.invoke('kb:ensure-agent', agentKey),
    remove: (kbId: string): Promise<void> => ipcRenderer.invoke('kb:delete', kbId),
    docs: (kbId: string): Promise<KbDocsView> => ipcRenderer.invoke('kb:docs', kbId),
    upload: (request: { kbId: string; filePaths: string[]; category?: string }): Promise<string[]> => ipcRenderer.invoke('kb:upload', request),
    createCategory: (request: { kbId: string; name: string; parent?: string }): Promise<void> => ipcRenderer.invoke('kb:category-create', request),
    renameCategory: (request: { kbId: string; oldName: string; newName: string }): Promise<void> => ipcRenderer.invoke('kb:category-rename', request),
    deleteCategory: (request: { kbId: string; name: string }): Promise<void> => ipcRenderer.invoke('kb:category-delete', request),
    assignDocs: (request: { kbId: string; docIds: string[]; category: string | null }): Promise<void> => ipcRenderer.invoke('kb:doc-assign', request),
    parse: (request: { kbId: string; docIds: string[] }): Promise<void> => ipcRenderer.invoke('kb:parse', request),
    stopParse: (request: { kbId: string; docIds: string[] }): Promise<void> => ipcRenderer.invoke('kb:stop-parse', request),
    deleteDocs: (request: { kbId: string; docIds: string[] }): Promise<void> => ipcRenderer.invoke('kb:delete-docs', request)
  },
  kbGuardian: {
    state: (): Promise<GuardianState> => ipcRenderer.invoke('kbGuardian:list-skills'),
    create: (input: GuardianSkillInput): Promise<GuardianSkill> => ipcRenderer.invoke('kbGuardian:create-skill', input),
    update: (id: string, input: GuardianSkillInput): Promise<GuardianSkill> => ipcRenderer.invoke('kbGuardian:update-skill', id, input),
    remove: (id: string): Promise<void> => ipcRenderer.invoke('kbGuardian:delete-skill', id),
    runNow: (id: string): Promise<{ queued: boolean; reason?: string }> => ipcRenderer.invoke('kbGuardian:run-now', id),
    logs: (skillId?: string): Promise<GuardianRunLog[]> => ipcRenderer.invoke('kbGuardian:list-logs', skillId),
    pickDir: (): Promise<string | null> => ipcRenderer.invoke('kbGuardian:pick-dir'),
    // J 阶段新增：按 logId 重试该次运行中所有失败的文件
    retryFailed: (request: GuardianRetryRequest): Promise<GuardianRetryResult> => ipcRenderer.invoke('kbGuardian:retry-failed', request),
    // J 阶段新增：按 logId 拉取单条日志详情
    getLogDetail: (logId: string): Promise<GuardianRunLog | null> => ipcRenderer.invoke('kbGuardian:get-log-detail', { logId }),
    onRunEvent: (callback: (event: GuardianRunEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, event: GuardianRunEvent) => callback(event)
      ipcRenderer.on('kbGuardian:run-event', listener)
      return () => ipcRenderer.removeListener('kbGuardian:run-event', listener)
    }
  },
  aiEmployee: {
    ask: (request: AiEmployeeAskRequest): Promise<{ ok: boolean; content: string }> => ipcRenderer.invoke('ai-employee:ask', request),
    models: (): Promise<AiEmployeeChatModelProfile[]> => ipcRenderer.invoke('ai-employee:chat-models'),
    pickAttachments: (): Promise<AiEmployeePickResult> => ipcRenderer.invoke('ai-employee:pick-attachments'),
    materializeMarkdownReport: (content: string): Promise<{ content: string; materialized: boolean }> => ipcRenderer.invoke('ai-employee:materialize-markdown-report', content),
    browserShow: (bounds: BrowserBounds): Promise<void> => ipcRenderer.invoke('ai-employee:browser:show', bounds),
    browserHide: (): Promise<void> => ipcRenderer.invoke('ai-employee:browser:hide'),
    browserNavigate: (url: string): Promise<void> => ipcRenderer.invoke('ai-employee:browser:navigate', url),
    browserBack: (): Promise<void> => ipcRenderer.invoke('ai-employee:browser:back'),
    browserForward: (): Promise<void> => ipcRenderer.invoke('ai-employee:browser:forward'),
    browserReload: (): Promise<void> => ipcRenderer.invoke('ai-employee:browser:reload'),
    browserUrl: (): Promise<string> => ipcRenderer.invoke('ai-employee:browser:url'),
    extractCurrent: (): Promise<{ ok: boolean; info?: ExtractedProductInfo; prompt?: string; message?: string }> => ipcRenderer.invoke('ai-employee:extract-current'),
    cnyUsdRate: (): Promise<{ usdPerCny: number; fetchedAt: string; source: string } | null> => ipcRenderer.invoke('ai-employee:cny-usd-rate'),
    amazonResolve: (keyword: string): Promise<{ asin: string; title: string } | null> => ipcRenderer.invoke('ai-employee:amazon-resolve', keyword),
        amazonMarketStats: (keyword: string): Promise<AmazonMarketSample[] | null> => ipcRenderer.invoke('ai-employee:amazon-market-stats', keyword),
    amazonListingEvidence: (asins: string[]): Promise<AmazonListingEvidence[]> => ipcRenderer.invoke('ai-employee:amazon-listing-evidence', asins),
    amazonReviewEvidence: (asins: string[]): Promise<AmazonReviewEvidence[]> => ipcRenderer.invoke('ai-employee:amazon-review-evidence', asins),
    deriveAmazonKeywords: (intent: AmazonSearchIntent): Promise<string[]> => ipcRenderer.invoke('ai-employee:derive-amazon-keywords', intent),
    inferEvidence: (input: unknown): Promise<unknown> => ipcRenderer.invoke('ai-employee:infer-evidence', input),
    amazonDataSource: {
      get: (): Promise<{ configured: boolean; site: string; pages: number; maxSamples: number; cacheHours: number }> => ipcRenderer.invoke('amazon-data-source:get'),
      save: (input: { apiKey?: string; site: string; pages: number; maxSamples: number; cacheHours: number }): Promise<{ configured: boolean; site: string; pages: number; maxSamples: number; cacheHours: number }> => ipcRenderer.invoke('amazon-data-source:save', input),
      clear: (): Promise<void> => ipcRenderer.invoke('amazon-data-source:clear'),
      test: (): Promise<{ ok: boolean; message: string; samples?: number }> => ipcRenderer.invoke('amazon-data-source:test'),
      search: (keyword: string): Promise<AmazonDataSourceSearchResult> => ipcRenderer.invoke('amazon-data-source:search', keyword)
    },
    exportDocument: (request: { title: string; roleName: string; createdAt: number; messages: Array<{ role: 'user' | 'assistant'; content: string }>; format: 'word' | 'pdf' | 'markdown' }): Promise<{ canceled: boolean; filePath?: string }> => ipcRenderer.invoke('ai-employee:export-document', request),
    exportWordReport: (request: { title: string; markdown: string; roleName?: string }): Promise<{ canceled: boolean; filePath?: string; byteSize?: number; error?: string }> => ipcRenderer.invoke('ai-employee:export-word-report', request),
    sampleLibrary: {
      list: (): Promise<{ ok: boolean; samples?: Array<{
        letter: 'A' | 'B' | 'C' | 'D'
        decision: '✅ 建议入场' | '⚠️ 有条件谨慎入场' | '❌ 不建议入场' | '❓ 数据不足，不能判定'
        title: string
        subtitle: string
        reason: string
        keyMetrics: { baseMargin: number | null; downsideProfit: number | null; directCount: number | null; coveragePercent: number | null }
        markdownFile: string
        docxFile: string
        markdownSize: number
        docxSize: number
        failedGates: string[]
        markdownPath: string
        docxPath: string
      }>; error?: string }> => ipcRenderer.invoke('ai-sample-library:list'),
      openDocx: (request: { filePath: string }): Promise<{ ok: boolean; filePath?: string; error?: string }> => ipcRenderer.invoke('ai-sample-library:open-docx', request)
    },
    sampleLibraryKb: {
      describe: (): Promise<{ agentName: string; agentRole: string; kbName: string; description: string; categoryRoot: string }> => ipcRenderer.invoke('sample-library-kb:describe'),
      preview: (): Promise<{
        kb: KbView
        plan: Array<{
          name: string
          filePath: string
          category: string
          meta: { kind: 'sample' | 'gates' | 'traceability'; letter?: 'A' | 'B' | 'C' | 'D'; size: number }
        }>
        summary: {
          agentKey: KbAgentKey
          kbName: string
          description: string
          categoryRoot: string
          totalDocs: number
          totalBytes: number
          byCategory: Record<string, number>
        }
      }> => ipcRenderer.invoke('sample-library-kb:preview'),
      ingest: (options?: { parse?: boolean }): Promise<{
        kbId: string
        plan: Array<{ name: string; filePath: string; category: string; meta: { kind: 'sample' | 'gates' | 'traceability'; letter?: 'A' | 'B' | 'C' | 'D'; size: number } }>
        uploaded: Array<{ name: string; filePath: string; category: string; meta: { kind: 'sample' | 'gates' | 'traceability'; letter?: 'A' | 'B' | 'C' | 'D'; size: number } }>
        skipped: Array<{ name: string; filePath: string; category: string; meta: { kind: 'sample' | 'gates' | 'traceability'; letter?: 'A' | 'B' | 'C' | 'D'; size: number } }>
        parsed: string[]
        errors: Array<{ file: string; error: string }>
        durationMs: number
      }> => ipcRenderer.invoke('sample-library-kb:ingest', options ?? {}),
      // I.2 阶段新增：报告样例库 → 守卫自动同步（预置技能）
      launch: (): Promise<{
        present: boolean
        skill: GuardianSkill | null
        ranNow: boolean
        runNowReason?: string
      }> => ipcRenderer.invoke('sample-library-kb:guardian-launch'),
      guardianStatus: (): Promise<{ present: boolean; skill: GuardianSkill | null; state: GuardianState }> => ipcRenderer.invoke('sample-library-kb:guardian-status')
    },
    exportListing: (request: { title: string; format: 'word' | 'markdown' | 'csv'; material: string; packages: Array<{ siteLabel: string; languageCode: string; conclusion: string; content: string }> }): Promise<{ canceled: boolean; filePath?: string }> => ipcRenderer.invoke('listing:export', request),
    onBrowserUrl: (callback: (url: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, url: string) => callback(url)
      ipcRenderer.on('ai-employee:browser:url', listener)
      return () => ipcRenderer.removeListener('ai-employee:browser:url', listener)
    },
    onBrowserLoading: (callback: (loading: boolean) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, loading: boolean) => callback(loading)
      ipcRenderer.on('ai-employee:browser:loading', listener)
      return () => ipcRenderer.removeListener('ai-employee:browser:loading', listener)
    }
  },
  browser: {
    show: (platform: Platform) => ipcRenderer.invoke('browser:show', platform),
    hide: () => ipcRenderer.invoke('browser:hide'),
    setBounds: (bounds: BrowserBounds) => ipcRenderer.invoke('browser:bounds', bounds),
    navigate: (platform: Platform, url: string) => ipcRenderer.invoke('browser:navigate', platform, url),
    back: (platform: Platform) => ipcRenderer.invoke('browser:back', platform),
    forward: (platform: Platform) => ipcRenderer.invoke('browser:forward', platform),
    reload: (platform: Platform) => ipcRenderer.invoke('browser:reload', platform),
    getState: (platform: Platform) => ipcRenderer.invoke('browser:state:get', platform),
    activateSupply: (platformCode: '1688' | 'GIGACLOUD'): Promise<SupplyActivationResult> => ipcRenderer.invoke('browser:supply:activate', platformCode),
    openTab: (platform: Platform, url: string, title?: string) => ipcRenderer.invoke('browser:open-tab', platform, url, title),
    newTab: () => ipcRenderer.invoke('browser:new-tab'),
    switchTab: (tabId: string) => ipcRenderer.invoke('browser:switch-tab', tabId),
    closeTab: (tabId: string) => ipcRenderer.invoke('browser:close-tab', tabId),
    create1688SearchUrl: (keyword: string): Promise<string> => ipcRenderer.invoke('browser:1688-search-url', keyword),
    translate: (mode: BrowserTranslationMode): Promise<BrowserTranslationStatus> => ipcRenderer.invoke('browser:translate', mode),
    restoreTranslation: (): Promise<void> => ipcRenderer.invoke('browser:translation:restore'),
    startCollector: (): Promise<BuiltInCollectorState> => ipcRenderer.invoke('browser:collector:start'),
    collectorState: (): Promise<BuiltInCollectorState> => ipcRenderer.invoke('browser:collector:list'),
    removeCollectorProduct: (url: string): Promise<BuiltInCollectorState> => ipcRenderer.invoke('browser:collector:remove', url),
    cancelCollector: (): Promise<void> => ipcRenderer.invoke('browser:collector:cancel'),
    confirmCollector: (): Promise<CollectorPluginImportResult> => ipcRenderer.invoke('browser:collector:confirm'),
    startEbayPlugin: (): Promise<EbayBrowserPluginState> => ipcRenderer.invoke('browser:ebay-plugin:start'),
    ebayPluginState: (): Promise<EbayBrowserPluginState> => ipcRenderer.invoke('browser:ebay-plugin:state'),
    removeEbayPluginProduct: (url:string): Promise<EbayBrowserPluginState> => ipcRenderer.invoke('browser:ebay-plugin:remove',url),
    clearEbayPluginProducts: (): Promise<EbayBrowserPluginState> => ipcRenderer.invoke('browser:ebay-plugin:clear'),
    stopEbayPlugin: (): Promise<void> => ipcRenderer.invoke('browser:ebay-plugin:stop'),
    openEbayDeliveryLocation: (): Promise<EbayDeliveryLocationResult> => ipcRenderer.invoke('browser:ebay-delivery-location:open'),
    onTabs: (callback: (tabs: BrowserTab[]) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, tabs: BrowserTab[]) => callback(tabs)
      ipcRenderer.on('browser:tabs', listener)
      return () => ipcRenderer.removeListener('browser:tabs', listener)
    },
    onState: (callback: (state: BrowserState) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: BrowserState) => callback(state)
      ipcRenderer.on('browser:state', listener)
      return () => ipcRenderer.removeListener('browser:state', listener)
    }
  },
  tasks: {
    latest: () => ipcRenderer.invoke('task:latest'),
    create: (task: SelectionTaskDraft) => ipcRenderer.invoke('task:create', task),
    start: (taskId: string) => ipcRenderer.invoke('task:start', taskId),
    preview: (taskId: string): Promise<CollectionPreviewResult> => ipcRenderer.invoke('task:preview', taskId),
    confirmPreview: (request: CollectionPreviewConfirmRequest) => ipcRenderer.invoke('task:confirm-preview', request),
    onProgress: (callback: (progress: TaskProgress) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, progress: TaskProgress) => callback(progress)
      ipcRenderer.on('task:progress', listener)
      return () => ipcRenderer.removeListener('task:progress', listener)
    }
  },
  candidates: {
    list: (): Promise<CandidateWorkspace> => ipcRenderer.invoke('candidate:list'),
    delete: (request: CandidateUpdateRequest): Promise<CandidateWorkspace> => ipcRenderer.invoke('candidate:delete', request),
    restore: (request: CandidateUpdateRequest): Promise<CandidateWorkspace> => ipcRenderer.invoke('candidate:restore', request),
    purge: (request: CandidateUpdateRequest): Promise<CandidateWorkspace> => ipcRenderer.invoke('candidate:purge', request)
  },
  selections: {
    list: () => ipcRenderer.invoke('selection:list'),
    import: (request: SelectionImportRequest) => ipcRenderer.invoke('selection:import', request),
    decide: (id: string, decision: SelectionDecision) => ipcRenderer.invoke('selection:decide', id, decision),
    categorize: (id: string, category: string, subcategory: string, tertiaryCategory: string) => ipcRenderer.invoke('selection:categorize', id, category, subcategory, tertiaryCategory),
    returnToCandidates: (id: string): Promise<void> => ipcRenderer.invoke('selection:return-to-candidates', id)
  },
  comparisons: {
    list: () => ipcRenderer.invoke('comparison:list'),
    import: (request: ComparisonImportRequest) => ipcRenderer.invoke('comparison:import', request),
    update: (request: ComparisonUpdateRequest) => ipcRenderer.invoke('comparison:update', request),
    promote: (request: ComparisonPromotionRequest): Promise<ComparisonPromotionResult> => ipcRenderer.invoke('comparison:promote',request)
  },
  workflow: {
    counts: (): Promise<WorkflowCounts> => ipcRenderer.invoke('workflow:counts')
  },
  compliance: {
    workspace: ():Promise<ComplianceKnowledgeWorkspace> => ipcRenderer.invoke('compliance:workspace'),
    saveRule: (draft:ComplianceRuleDraft):Promise<ComplianceRule> => ipcRenderer.invoke('compliance:rule:save',draft),
    setRuleStatus: (ruleId:string,status:ComplianceReviewStatus):Promise<ComplianceRule> => ipcRenderer.invoke('compliance:rule:status',ruleId,status),
    syncRecalls: (sourceId:string):Promise<{imported:number;workspace:ComplianceKnowledgeWorkspace}> => ipcRenderer.invoke('compliance:recalls:sync',sourceId),
    syncSource: (sourceId:string):Promise<{workspace:ComplianceKnowledgeWorkspace;imported?:number;changed?:boolean;versionsCreated?:number}> => ipcRenderer.invoke('compliance:source:sync',sourceId),
    check: (request:ComplianceCheckRequest):Promise<ComplianceCheckResult> => ipcRenderer.invoke('compliance:check',request),
    latestCheck: (productId:string):Promise<ComplianceCheckResult|undefined> => ipcRenderer.invoke('compliance:check:latest',productId),
    reviewCheck: (checkId:string,reviewedBy:string,note:string):Promise<ComplianceCheckResult> => ipcRenderer.invoke('compliance:check:review',checkId,reviewedBy,note),
    saveProfile: (draft:ComplianceProductProfileDraft):Promise<ComplianceProductProfile> => ipcRenderer.invoke('compliance:profile:save',draft),
    chooseDocument: ():Promise<{fileName:string;filePath:string}|undefined> => ipcRenderer.invoke('compliance:document:choose'),
    saveDocument: (draft:ComplianceDocumentDraft):Promise<ComplianceDocumentRecord> => ipcRenderer.invoke('compliance:document:save',draft),
    saveTemplate: (draft:ComplianceCategoryTemplateDraft):Promise<ComplianceCategoryTemplate> => ipcRenderer.invoke('compliance:template:save',draft),
    updateTask: (taskId:string,status:ComplianceTaskStatus,assignee:string,resolution:string):Promise<ComplianceTaskRecord> => ipcRenderer.invoke('compliance:task:update',taskId,status,assignee,resolution),
    updateAlert: (alertId:string,status:ComplianceAlertStatus,note:string):Promise<ComplianceAlert> => ipcRenderer.invoke('compliance:alert:update',alertId,status,note),
    updateEnforcementCase: (caseId:string,status:ComplianceEnforcementStatus,assignee:string,resolution:string):Promise<ComplianceEnforcementCase> => ipcRenderer.invoke('compliance:enforcement:update',caseId,status,assignee,resolution),
    reviewSourceChange: (changeId:string,decision:ComplianceSourceChangeDecision,reviewedBy:string,note:string):Promise<ComplianceSourceChangeReviewResult> => ipcRenderer.invoke('compliance:source-change:review',changeId,decision,reviewedBy,note),
    exportPermit: (permitId:string):Promise<{canceled:boolean;filePath?:string}> => ipcRenderer.invoke('compliance:permit:export',permitId),
    exportEvidence: ():Promise<{canceled:boolean;filePath?:string}> => ipcRenderer.invoke('compliance:evidence:export'),
    recheckProfiles: (platform='ALL',country='ALL'):Promise<ComplianceBatchRecheckResult> => ipcRenderer.invoke('compliance:profiles:recheck',platform,country)
  },
  warehouses: {
    list: (): Promise<SupplyWarehouseProduct[]> => ipcRenderer.invoke('warehouse:list')
  },
  marketplaceSelections: {
    list: (marketplaceCode: MarketplacePlatformCode): Promise<MarketplaceSelectionProduct[]> => ipcRenderer.invoke('marketplace-selection:list', marketplaceCode),
    import: (marketplaceCode: MarketplacePlatformCode, supplyProductId: string): Promise<MarketplaceSelectionProduct> => ipcRenderer.invoke('marketplace-selection:import', marketplaceCode, supplyProductId)
  },
  marketplaceMedia: {
    list: (marketplaceSelectionId: string): Promise<MarketplaceMediaAsset[]> => ipcRenderer.invoke('marketplace-media:list',marketplaceSelectionId),
    save: (marketplaceSelectionId: string, assetType: MarketplaceMediaAssetType, imageUrl: string, localPath = '', selected = false): Promise<MarketplaceMediaAsset> => ipcRenderer.invoke('marketplace-media:save',marketplaceSelectionId,assetType,imageUrl,localPath,selected),
    select: (id: string): Promise<MarketplaceMediaAsset> => ipcRenderer.invoke('marketplace-media:select',id)
  },
  marketplacePublish: {
    list: (marketplaceCode: MarketplacePlatformCode): Promise<MarketplacePublishDraft[]> => ipcRenderer.invoke('marketplace-publish:list',marketplaceCode),
    create: (marketplaceSelectionId: string, storeId = ''): Promise<MarketplacePublishDraft> => ipcRenderer.invoke('marketplace-publish:create',marketplaceSelectionId,storeId),
    update: (request: MarketplacePublishDraftUpdate, action: string): Promise<MarketplacePublishDraft> => ipcRenderer.invoke('marketplace-publish:update',request,action),
    audits: (marketplaceCode: MarketplacePlatformCode): Promise<MarketplacePublishAudit[]> => ipcRenderer.invoke('marketplace-publish:audits',marketplaceCode)
  },
  ebay: {
    status: ():Promise<EbayConfigurationStatus> => ipcRenderer.invoke('ebay:status'),
    stores: ():Promise<EbayStore[]> => ipcRenderer.invoke('ebay:stores:list'),
    createStore: (name:string,username:string,password:string,marketplaceId='EBAY_US'):Promise<EbayStore> => ipcRenderer.invoke('ebay:stores:create',name,username,password,marketplaceId),
    authorize: (storeId:string):Promise<EbayStore> => ipcRenderer.invoke('ebay:authorize',storeId),
    openSellerHub: (storeId:string):Promise<string> => ipcRenderer.invoke('ebay:seller-hub:open',storeId),
    newBrowserTab: (storeId:string):Promise<string> => ipcRenderer.invoke('ebay:browser-tab:new',storeId),
    openProduct: (storeId:string,url:string,title:string):Promise<string> => ipcRenderer.invoke('ebay:product:open',storeId,url,title),
    ensureLogin: (storeId:string):Promise<EbayLoginResult> => ipcRenderer.invoke('ebay:login:ensure',storeId),
    importReport: (storeId:string):Promise<EbayReportImportResult|null> => ipcRenderer.invoke('ebay:report:import',storeId),
    listings: (storeId?:string):Promise<EbayListing[]> => ipcRenderer.invoke('ebay:listings:list',storeId),
    localProducts: (storeId?:string):Promise<EbayLocalProduct[]> => ipcRenderer.invoke('ebay:local-products:list',storeId),
    localProductSnapshots: (localProductId:string):Promise<EbayLocalProductSnapshot[]> => ipcRenderer.invoke('ebay:local-products:snapshots',localProductId),
    downloadLocalProduct: (storeId:string,listingId:string):Promise<EbayLocalProduct> => ipcRenderer.invoke('ebay:local-products:download',storeId,listingId),
    readProductByUrl: (storeId:string,url:string):Promise<EbayLocalProduct> => ipcRenderer.invoke('ebay:product:read-url',storeId,url),
    updateLocalProduct: (localProductId:string,changes:EbayLocalProductUpdateInput):Promise<EbayLocalProduct> => ipcRenderer.invoke('ebay:local-products:update',localProductId,changes),
    localProductMediaData: (localProductId:string,mediaId:string):Promise<string> => ipcRenderer.invoke('ebay:local-products:media-data',localProductId,mediaId),
    addLocalProductMedia: (localProductId:string,input:EbayLocalProductMediaUploadInput):Promise<EbayLocalProductMedia> => ipcRenderer.invoke('ebay:local-products:media-add',localProductId,input),
    inspectLocalProductImages: (localProductId:string):Promise<EbayImageVisualInspectionReport> => ipcRenderer.invoke('ebay:local-products:inspect-visual',localProductId),
    inspectFinalImages: (imageUrls:string[]):Promise<EbayImageInspectionReport> => ipcRenderer.invoke('ebay:images:inspect-final',imageUrls),
    localProductImageVisualReport: (localProductId:string):Promise<EbayImageVisualInspectionReport|null> => ipcRenderer.invoke('ebay:local-products:visual-report',localProductId),
    reviewLocalProductImageRule: (input:EbayImageVisualReviewInput):Promise<EbayImageVisualInspectionReport> => ipcRenderer.invoke('ebay:local-products:visual-review',input),
    localProductRequirements: (storeId:string,listingId:string,title:string):Promise<EbayLocalListingRequirements> => ipcRenderer.invoke('ebay:local-products:requirements',storeId,listingId,title),
    prepareLocalProductRevision: (localProductId:string):Promise<EbayLocalRevisionPreparationResult> => ipcRenderer.invoke('ebay:local-products:prepare-revision',localProductId),
    removeLocalProduct: (localProductId:string):Promise<boolean> => ipcRenderer.invoke('ebay:local-products:remove',localProductId),
    removeLocalListing: (storeId:string,listingId:string):Promise<boolean> => ipcRenderer.invoke('ebay:listings:remove-local',storeId,listingId),
    updateListingCategory: (storeId:string,listingId:string,categoryId:string):Promise<EbayListing> => ipcRenderer.invoke('ebay:listings:category:update',storeId,listingId,categoryId),
    syncListingDetails: (storeId:string,listingId:string):Promise<EbayListing> => ipcRenderer.invoke('ebay:listings:details:sync',storeId,listingId),
    marketResearch: (storeId:string,listingId:string):Promise<EbayMarketResearchSnapshot|undefined> => ipcRenderer.invoke('ebay:market-research:get',storeId,listingId),
    marketResearchHistory: (storeId:string,listingId:string):Promise<EbayMarketResearchSnapshot[]> => ipcRenderer.invoke('ebay:market-research:history',storeId,listingId),
    openMarketResearch: (request:EbayMarketResearchRequest):Promise<string> => ipcRenderer.invoke('ebay:market-research:open',request),
    runMarketResearch: (request:EbayMarketResearchRequest):Promise<EbayMarketResearchSnapshot> => ipcRenderer.invoke('ebay:market-research:run',request),
    decideMarketResearch: (request:EbayMarketResearchDecisionRequest):Promise<EbayMarketResearchSnapshot> => ipcRenderer.invoke('ebay:market-research:decide',request),
    titleDecision: (storeId:string,listingId:string):Promise<EbayTitleDecision|undefined> => ipcRenderer.invoke('ebay:title-decision:get',storeId,listingId),
    confirmTitleDecision: (input:EbayTitleDecisionInput):Promise<EbayTitleDecision> => ipcRenderer.invoke('ebay:title-decision:confirm',input),
    sync: (storeId:string):Promise<EbaySyncResult> => ipcRenderer.invoke('ebay:sync',storeId),
    categoryWorkspace: (storeId:string):Promise<EbayCategoryWorkspace> => ipcRenderer.invoke('ebay:categories:get',storeId),
    syncCategories: (storeId:string):Promise<EbayCategoryWorkspace> => ipcRenderer.invoke('ebay:categories:sync',storeId),
    productSyncRuns: (storeId:string):Promise<EbayProductSyncRun[]> => ipcRenderer.invoke('ebay:product-sync-runs:list',storeId),
    pendingDirectorySync: (storeId:string):Promise<EbayDirectoryProductSyncCheckpoint|undefined> => ipcRenderer.invoke('ebay:category-products:pending',storeId),
    controlDirectorySync: (storeId:string,action:'PAUSE'|'RESUME'|'CANCEL'):Promise<{taskId:string;status:string}> => ipcRenderer.invoke('ebay:category-products:control',storeId,action),
    onDirectorySyncProgress: (callback:(progress:EbayDirectoryProductSyncProgress)=>void) => { const listener=(_event:Electron.IpcRendererEvent,progress:EbayDirectoryProductSyncProgress)=>callback(progress);ipcRenderer.on('ebay:directory-sync:progress',listener);return()=>ipcRenderer.removeListener('ebay:directory-sync:progress',listener) },
    syncDirectoryProducts: (request:EbayDirectoryProductSyncRequest):Promise<EbayDirectoryProductSyncResult> => ipcRenderer.invoke('ebay:category-products:sync',request),
    confirmCollection: (storeId:string):Promise<EbayCollectionImportResult> => ipcRenderer.invoke('ebay:collection:confirm',storeId),
    optimizeTitle: (request:EbayTitleOptimizationRequest):Promise<EbayTitleOptimizationResult> => ipcRenderer.invoke('ebay:optimize:title',request),
    optimizeContent: (request:EbayContentOptimizationRequest):Promise<EbayContentOptimizationResult> => ipcRenderer.invoke('ebay:optimize:content',request),
    contentOptimization: (storeId:string,listingId:string):Promise<EbayContentOptimizationRecord|undefined> => ipcRenderer.invoke('ebay:content-optimization:get',storeId,listingId),
    saveContentOptimization: (input:EbayContentOptimizationRecordInput):Promise<EbayContentOptimizationRecord> => ipcRenderer.invoke('ebay:content-optimization:save',input),
    translateContent: (request:EbayContentTranslationRequest):Promise<EbayContentTranslationResult> => ipcRenderer.invoke('ebay:translate:content',request),
    exportOptimization: (input:EbayOptimizationExportInput):Promise<EbayOptimizationExportResult|null> => ipcRenderer.invoke('ebay:optimization:export',input),
    optimizationDrafts: (storeId?:string):Promise<EbayOptimizationDraft[]> => ipcRenderer.invoke('ebay:optimization-drafts:list',storeId),
    saveOptimizationDraft: (input:EbayOptimizationDraftInput):Promise<EbayOptimizationDraft> => ipcRenderer.invoke('ebay:optimization-drafts:save',input),
    validateOptimizationDraft: (draftId:string):Promise<EbayPublishComplianceValidation> => ipcRenderer.invoke('ebay:optimization-drafts:validate',draftId),
    publishTasks: (storeId?:string):Promise<EbayPublishTask[]> => ipcRenderer.invoke('ebay:publish-tasks:list',storeId),
    preparePublishTask: (draftId:string):Promise<EbayPublishTask> => ipcRenderer.invoke('ebay:publish-tasks:prepare',draftId),
    generatePublishVideo: (draftId:string):Promise<EbayPublishTask> => ipcRenderer.invoke('ebay:publish-video:generate',draftId),
    preparePublishVideoUpload: (draftId:string):Promise<EbayPublishTask> => ipcRenderer.invoke('ebay:publish-video:prepare-upload',draftId),
    videoStudioConfiguration: ():Promise<EbayVideoStudioConfiguration> => ipcRenderer.invoke('ebay:video-studio:configuration'),
    checkVideoStudioCapabilities: ():Promise<EbayVideoStudioConfiguration> => ipcRenderer.invoke('ebay:video-studio:check-capabilities'),
    verifyVideoStudioCapability: (request:EbayVideoCapabilityVerificationRequest):Promise<EbayVideoStudioConfiguration> => ipcRenderer.invoke('ebay:video-studio:verify-capability',request),
    videoStudioProjects: (listingId:string):Promise<EbayVideoStudioProject[]> => ipcRenderer.invoke('ebay:video-studio:list',listingId),
    confirmVideoStudioProject: (listingId:string,projectId:string):Promise<EbayVideoStudioProject[]> => ipcRenderer.invoke('ebay:video-studio:confirm',listingId,projectId),
    pickVideoStudioImages: ():Promise<Array<{name:string;dataUrl:string}>> => ipcRenderer.invoke('ebay:video-studio:pick-images'),
    generateVideoStudio: (request:EbayVideoStudioRequest):Promise<EbayVideoStudioProject> => ipcRenderer.invoke('ebay:video-studio:generate',request),
    onVideoStudioProgress: (callback:(progress:EbayVideoStudioProgress)=>void) => { const listener=(_event:Electron.IpcRendererEvent,progress:EbayVideoStudioProgress)=>callback(progress);ipcRenderer.on('ebay:video-studio:progress',listener);return()=>ipcRenderer.removeListener('ebay:video-studio:progress',listener) },
    acceptanceBatches: (storeId:string):Promise<EbayAcceptanceBatch[]> => ipcRenderer.invoke('ebay:acceptance:list',storeId),
    runAcceptance: (request:EbayAcceptanceRunRequest):Promise<EbayAcceptanceBatch> => ipcRenderer.invoke('ebay:acceptance:run',request)
  },
  image: {
    models: (): Promise<ImageModelConnection> => ipcRenderer.invoke('image:models'),
    generate: (request: ImageGenerationRequest): Promise<ImageGenerationResult> => ipcRenderer.invoke('image:generate', request),
    ground: (request:EbayImageGroundingRequest):Promise<EbayImageGroundingPlan> => ipcRenderer.invoke('image:ground',request),
    extractPackageText: (request:ImagePackageTextExtractionRequest):Promise<ImagePackageTextExtractionResult> => ipcRenderer.invoke('image:extract-package-text',request),
    reviewCandidate: (request:EbayImageCandidateReviewRequest):Promise<EbayImageCandidateReview> => ipcRenderer.invoke('image:review-candidate',request),
    suggestRoles: (request:EbayImageRoleSuggestionRequest):Promise<EbayImageRoleSuggestionResult> => ipcRenderer.invoke('image:suggest-roles',request),
    stageGrounding: (request:EbayStageGroundingRequest):Promise<EbayStageFactCard> => ipcRenderer.invoke('image:stage-grounding',request),
    stageStoryboard: (request:EbayStageStoryboardRequest):Promise<EbayStageStoryboardCard[]> => ipcRenderer.invoke('image:stage-storyboard',request),
    stageModelRecommend: (stage:EbayImageStage):Promise<EbayStageModelRecommendation> => ipcRenderer.invoke('image:stage-model-recommend',stage),
    realshift: (request: RealShiftRequest): Promise<RealShiftResult> => ipcRenderer.invoke('image:realshift', request),
    realshiftPreflight: (): Promise<{ ok: boolean; message: string }> => ipcRenderer.invoke('image:realshift:preflight'),
    selectRealshift: (reportPath: string, choice: 'original' | 'processed'): Promise<{ selectionPath: string }> => ipcRenderer.invoke('image:realshift:select', reportPath, choice),
    pickRealshiftImage: (): Promise<string | null> => ipcRenderer.invoke('image:realshift:pick')
    ,pickProductImages: ():Promise<ImportedProductSource|null> => ipcRenderer.invoke('image:source:pick-local')
    ,readProductUrl: (url:string):Promise<ImportedProductSource> => ipcRenderer.invoke('image:source:read-url',url)
    ,translateMarketing: (request:ImageMarketingTranslationRequest):Promise<ImageMarketingTranslationResult> => ipcRenderer.invoke('image:translate-marketing',request)
  },
  advisor: {
    models: () => ipcRenderer.invoke('advisor:models'),
    listSessions: () => ipcRenderer.invoke('advisor:sessions:list'),
    getSession: (taskId: string) => ipcRenderer.invoke('advisor:sessions:get', taskId),
    selectBranch: (taskId: string, branchId: string) => ipcRenderer.invoke('advisor:sessions:select-branch', taskId, branchId),
    renameSession: (taskId: string, title: string) => ipcRenderer.invoke('advisor:sessions:rename', taskId, title),
    deleteSession: (taskId: string) => ipcRenderer.invoke('advisor:sessions:delete', taskId),
    exportSession: (taskId: string) => ipcRenderer.invoke('advisor:sessions:export', taskId),
    getDefaultProject: () => ipcRenderer.invoke('advisor:project:default'),
    selectProject: () => ipcRenderer.invoke('advisor:project:select'),
    revealProject: (projectPath: string) => ipcRenderer.invoke('advisor:project:reveal', projectPath),
    getConnectionStatus: () => ipcRenderer.invoke('advisor:connection:status'),
    getPersonalization: () => ipcRenderer.invoke('advisor:personalization:get'),
    savePersonalization: (settings: Partial<AdvisorPersonalizationSettings>) => ipcRenderer.invoke('advisor:personalization:save', settings),
    resetMemory: () => ipcRenderer.invoke('advisor:personalization:reset-memory'),
    sendChat: (request: AdvisorChatRequest) => ipcRenderer.invoke('advisor:chat:send', request),
    steerChat: (requestId: string, message: string) => ipcRenderer.invoke('advisor:chat:steer', { requestId, message }),
    stopChat: (requestId: string) => ipcRenderer.invoke('advisor:chat:stop', requestId),
    selectImages: (sessionId: string) => ipcRenderer.invoke('advisor:images:select', sessionId),
    listImages: (sessionId: string) => ipcRenderer.invoke('advisor:images:list', sessionId),
    cloneImages: (sourceSessionId: string, targetSessionId: string) => ipcRenderer.invoke('advisor:images:clone', { sourceSessionId, targetSessionId }),
    discardImages: (sessionId: string) => ipcRenderer.invoke('advisor:images:discard-session', sessionId),
    previewImage: (sessionId: string, id: string) => ipcRenderer.invoke('advisor:images:preview', { sessionId, id }),
    analyzeImages: (sessionId: string) => ipcRenderer.invoke('advisor:images:analysis', sessionId),
    saveImages: (sessionId: string, images: AdvisorIncomingImage[]) => ipcRenderer.invoke('advisor:images:save', { sessionId, images }),
    removeImage: (sessionId: string, id: string) => ipcRenderer.invoke('advisor:images:remove', { sessionId, id }),
    resolveApproval: (approvalId: string, decision: AdvisorApprovalDecision) => ipcRenderer.invoke('advisor:approval:resolve', { approvalId, decision }),
    onChatEvent: (callback: (event: AdvisorChatEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AdvisorChatEvent) => callback(payload)
      ipcRenderer.on('advisor:chat:event', listener)
      return () => ipcRenderer.removeListener('advisor:chat:event', listener)
    }
  },
  marketplace: {
    profiles: (): Promise<{ platforms: MarketplacePlatformProfile[]; accounts: MarketplaceAccountProfile[] }> => ipcRenderer.invoke('marketplace:profiles'),
    addAccount: (platformCode: MarketplacePlatformCode, name: string): Promise<MarketplaceAccountProfile> => ipcRenderer.invoke('marketplace:account:add', platformCode, name),
    activate: (platformCode: MarketplacePlatformCode, accountId: string, strategy: NetworkStrategy): Promise<void> => ipcRenderer.invoke('marketplace:activate', platformCode, accountId, strategy),
    credentialStatus: (accountId: string): Promise<MarketplaceCredentialStatus> => ipcRenderer.invoke('marketplace:credential:status', accountId),
    saveCredential: (input: MarketplaceCredentialInput): Promise<MarketplaceCredentialStatus> => ipcRenderer.invoke('marketplace:credential:save', input),
    deleteCredential: (accountId: string): Promise<MarketplaceCredentialStatus> => ipcRenderer.invoke('marketplace:credential:delete', accountId),
    openCredentialLogin: (accountId: string, platformCode: string): Promise<string> => ipcRenderer.invoke('marketplace:credential:open-login', accountId, platformCode),
    fillCredential: (accountId: string, submit = false): Promise<{ usernameFilled:boolean; passwordFilled:boolean; submitted:boolean; verificationRequired:boolean; url:string }> => ipcRenderer.invoke('marketplace:credential:fill', accountId, submit)
  }
})
