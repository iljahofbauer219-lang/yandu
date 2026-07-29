import { contextBridge, ipcRenderer } from 'electron'
import type { BrowserBounds, BrowserState, BrowserTab, BrowserTranslationMode, BrowserTranslationStatus, BuiltInCollectorState, CandidateUpdateRequest, CandidateWorkspace, CollectionPreviewConfirmRequest, CollectionPreviewResult, CollectorPluginImportResult, ComparisonImportRequest, ComparisonPromotionRequest, ComparisonPromotionResult, ComparisonUpdateRequest, ComplianceAlert, ComplianceAlertStatus, ComplianceCategoryTemplate, ComplianceCategoryTemplateDraft, ComplianceCheckRequest, ComplianceCheckResult, ComplianceDocumentDraft, ComplianceDocumentRecord, ComplianceEnforcementCase, ComplianceEnforcementStatus, ComplianceKnowledgeWorkspace, ComplianceProductProfile, ComplianceProductProfileDraft, ComplianceReviewStatus, ComplianceRule, ComplianceRuleDraft, ComplianceSourceChangeDecision, ComplianceSourceChangeReviewResult, ComplianceTaskRecord, ComplianceTaskStatus, EbayAcceptanceBatch, EbayAcceptanceRunRequest, EbayBrowserPluginState, EbayCategoryWorkspace, EbayCollectionImportResult, EbayConfigurationStatus, EbayContentOptimizationRecord, EbayContentOptimizationRecordInput, EbayContentOptimizationRequest, EbayContentOptimizationResult, EbayContentTranslationRequest, EbayContentTranslationResult, EbayDeliveryLocationResult, EbayDirectoryProductSyncCheckpoint, EbayDirectoryProductSyncProgress, EbayDirectoryProductSyncRequest, EbayDirectoryProductSyncResult, EbayImageCandidateReview, EbayImageCandidateReviewRequest, EbayImageGroundingPlan, EbayImageGroundingRequest, EbayImageVisualInspectionReport, EbayImageVisualReviewInput, EbayListing, EbayLocalProduct, EbayLocalProductMedia, EbayLocalProductMediaUploadInput, EbayLocalProductSnapshot, EbayLocalProductUpdateInput, EbayLoginResult, EbayMarketResearchDecisionRequest, EbayMarketResearchRequest, EbayMarketResearchSnapshot, EbayOptimizationDraft, EbayOptimizationDraftInput, EbayOptimizationExportInput, EbayOptimizationExportResult, EbayProductSyncRun, EbayPublishComplianceValidation, EbayPublishTask, EbayReportImportResult, EbayStore, EbaySyncResult, EbayTitleOptimizationRequest, EbayTitleOptimizationResult, EbayVideoStudioConfiguration, EbayVideoStudioProgress, EbayVideoStudioProject, EbayVideoStudioRequest, ImageGenerationRequest, ImageGenerationResult, ImageModelConnection, MarketplaceAccountProfile, MarketplaceCredentialInput, MarketplaceCredentialStatus, MarketplaceMediaAsset, MarketplaceMediaAssetType, MarketplacePlatformCode, MarketplacePlatformProfile, MarketplacePublishAudit, MarketplacePublishDraft, MarketplacePublishDraftUpdate, MarketplaceSelectionProduct, NetworkStrategy, Platform, RealShiftRequest, RealShiftResult, SelectionDecision, SelectionImportRequest, SelectionTaskDraft, SupplyActivationResult, SupplyWarehouseProduct, TaskProgress, WorkflowCounts } from '../shared/contracts'
import type { ComplianceBatchRecheckResult, EbayImageInspectionReport } from '../shared/contracts'
import type { EbayVideoCapabilityVerificationRequest } from '../shared/contracts'
import type { EbayLocalListingRequirements, EbayLocalRevisionPreparationResult } from '../shared/contracts'
import type { EbayTitleDecision, EbayTitleDecisionInput } from '../shared/contracts'

contextBridge.exposeInMainWorld('desktop', {
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
    reviewCandidate: (request:EbayImageCandidateReviewRequest):Promise<EbayImageCandidateReview> => ipcRenderer.invoke('image:review-candidate',request),
    realshift: (request: RealShiftRequest): Promise<RealShiftResult> => ipcRenderer.invoke('image:realshift', request),
    selectRealshift: (reportPath: string, choice: 'original' | 'processed'): Promise<{ selectionPath: string }> => ipcRenderer.invoke('image:realshift:select', reportPath, choice),
    pickRealshiftImage: (): Promise<string | null> => ipcRenderer.invoke('image:realshift:pick')
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
