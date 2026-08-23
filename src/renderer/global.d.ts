import type { BrowserBounds, BrowserState, BrowserTab, BrowserTranslationMode, BrowserTranslationStatus, BuiltInCollectorState, CandidateUpdateRequest, CandidateWorkspace, CollectedOzonProduct, CollectedSupplyProduct, CollectionPreviewConfirmRequest, CollectionPreviewResult, CollectorPluginImportResult, ComparisonImportRequest, ComparisonPromotionRequest, ComparisonPromotionResult, ComparisonRecordView, ComparisonUpdateRequest, ComplianceAlert, ComplianceAlertStatus, ComplianceCategoryTemplate, ComplianceCategoryTemplateDraft, ComplianceCheckRequest, ComplianceCheckResult, ComplianceDocumentDraft, ComplianceDocumentRecord, ComplianceEnforcementCase, ComplianceEnforcementStatus, ComplianceKnowledgeWorkspace, ComplianceProductProfile, ComplianceProductProfileDraft, ComplianceReviewStatus, ComplianceRule, ComplianceRuleDraft, ComplianceSourceChangeDecision, ComplianceSourceChangeReviewResult, ComplianceTaskRecord, ComplianceTaskStatus, EbayAcceptanceBatch, EbayAcceptanceRunRequest, EbayBrowserPluginState, EbayCategoryWorkspace, EbayCollectionImportResult, EbayConfigurationStatus, EbayContentOptimizationRecord, EbayContentOptimizationRecordInput, EbayContentOptimizationRequest, EbayContentOptimizationResult, EbayContentTranslationRequest, EbayContentTranslationResult, EbayDeliveryLocationResult, EbayDirectoryProductSyncCheckpoint, EbayDirectoryProductSyncProgress, EbayDirectoryProductSyncRequest, EbayDirectoryProductSyncResult, EbayImageCandidateReview, EbayImageCandidateReviewRequest, EbayImageGroundingPlan, EbayImageGroundingRequest, EbayImageRoleSuggestionRequest, EbayImageRoleSuggestionResult, EbayListing, EbayLocalProduct, EbayLocalProductSnapshot, EbayLocalProductUpdateInput, EbayLoginResult, EbayMarketResearchDecisionRequest, EbayMarketResearchRequest, EbayMarketResearchSnapshot, EbayOptimizationDraft, EbayOptimizationDraftInput, EbayOptimizationExportInput, EbayOptimizationExportResult, EbayProductSyncRun, EbayPublishComplianceValidation, EbayPublishTask, EbayReportImportResult, EbayStore, EbaySyncResult, EbayTitleOptimizationRequest, EbayTitleOptimizationResult, EbayVideoStudioConfiguration, EbayVideoStudioProgress, EbayVideoStudioProject, EbayVideoStudioRequest, ImageGenerationRequest, ImageGenerationResult, ImageMarketingTranslationRequest, ImageMarketingTranslationResult, ImageModelConnection, ImportedProductSource, MarketplaceAccountProfile, MarketplaceCredentialInput, MarketplaceCredentialStatus, MarketplaceMediaAsset, MarketplaceMediaAssetType, MarketplacePlatformCode, MarketplacePlatformProfile, MarketplacePublishAudit, MarketplacePublishDraft, MarketplacePublishDraftUpdate, MarketplaceSelectionProduct, NetworkStrategy, Platform, RealShiftRequest, RealShiftResult, SelectionCatalogItem, SelectionDecision, SelectionImportRequest, SelectionTask, SelectionTaskDraft, SupplyActivationResult, SupplyWarehouseProduct, TaskProgress, WorkflowCounts } from '../shared/contracts'
import type { ComplianceBatchRecheckResult } from '../shared/contracts'
import type { EbayImageInspectionReport, EbayImageVisualInspectionReport, EbayImageVisualReviewInput, EbayLocalProductMedia, EbayLocalProductMediaUploadInput } from '../shared/contracts'
import type { EbayVideoCapabilityVerificationRequest } from '../shared/contracts'
import type { EbayLocalListingRequirements, EbayLocalRevisionPreparationResult } from '../shared/contracts'
import type { EbayTitleDecision, EbayTitleDecisionInput, EbayImageStage, EbayStageFactCard, EbayStageGroundingRequest, EbayStageModelRecommendation, EbayStageStoryboardCard, EbayStageStoryboardRequest } from '../shared/contracts'
import type { AdvisorDesktopApi } from '../shared/advisor'
import type { AiEmployeeAskRequest, AiEmployeeChatModelProfile, AiEmployeePickResult } from '../shared/aiEmployee'
import type { KbAgentKey, KbDocsView, KbListView, KbView } from '../shared/knowledge'
import type { GuardianRunEvent, GuardianRunLog, GuardianSkill, GuardianSkillInput, GuardianState } from '../shared/kbGuardian'
import type { ImagePackageTextExtractionRequest, ImagePackageTextExtractionResult } from '../shared/contracts'
import type { AmazonDataSourceSearchResult, AmazonListingEvidence, AmazonMarketSample, AmazonReviewEvidence, AmazonSearchIntent } from '../shared/amazonScraper'

declare module '*.css'

export interface LlmKeyStatus { id: string; configured: boolean; maskedKey: string }

declare global {
  interface Window {
    desktop: {
      platform: string
      windowControls: {
        minimize(): Promise<void>
        toggleMaximize(): Promise<boolean>
        close(): Promise<void>
        isMaximized(): Promise<boolean>
        onMaximized(callback: (maximized: boolean) => void): () => void
      }
      system: {
        openVpnPanel(): Promise<void>
        openExternal(url: string): Promise<void>
        watchSkillStatus(): Promise<{ checks: Record<string, boolean>; root: string; version: string }>
        watchSkillPickVideo(): Promise<string | null>
        watchSkillAnalyze(videoPath: string): Promise<{ id:string; videoPath:string; createdAt:string; status:'COMPLETED'|'FAILED'; report:string; framePaths:string[]; error?:string }>
        watchSkillTasks(): Promise<Array<{ id:string; videoPath:string; createdAt:string; status:'COMPLETED'|'FAILED'; report:string; framePaths:string[]; error?:string }>>
        watchSkillDownloadYoutube(url:string): Promise<string>
        resource2SkillStatus(): Promise<{sourceReady:boolean;officialRuntimeReady:boolean;python311Ready:boolean;adapterReady:boolean;domains:string[];note:string}>
        resource2SkillDrafts(): Promise<Array<{id:string;sourceTaskId:string;name:string;content:string;createdAt:string;updatedAt:string}>>
        resource2SkillGenerate(taskId:string,domain:string): Promise<{id:string;sourceTaskId:string;name:string;content:string;createdAt:string;updatedAt:string}>
        resource2SkillModelSettings(): Promise<{configured:boolean;baseUrl:string}>
        resource2SkillModelSettingsSave(input:{apiKey:string;baseUrl:string}): Promise<{configured:boolean;baseUrl:string}>
        resource2SkillModelSettingsClear(): Promise<{configured:boolean}>
        resource2SkillOfficialAnalyze(input:{url:string;domain:string}): Promise<{id:string;sourceTaskId:string;name:string;content:string;createdAt:string;updatedAt:string}>
        resource2SkillTextDistill(input:{reportPath:string;domain:string;sourceUrl?:string}): Promise<{analysis:string;domain:string;sourceUrl:string;reportPath:string}>
        resource2SkillDistillWatch(input:{taskId:string;domain:string}): Promise<{id:string;sourceTaskId:string;name:string;content:string;createdAt:string;updatedAt:string}>
        resource2SkillSave(input:{id:string;name:string;content:string}): Promise<{id:string;sourceTaskId:string;name:string;content:string;createdAt:string;updatedAt:string;filePath:string}>
      }
      serverConfig: {
        get(): Promise<string>
        set(url: string): Promise<string>
      }
      appInfo: {
        checkUpdate(): Promise<{ current: string; latest: string; isLatest: boolean; error: string }>
        openDownload(): Promise<boolean>
        installUpdate(): Promise<boolean>
        onUpdateStatus(callback: (status: { phase: 'downloading' | 'downloaded' | 'error'; version: string; percent?: number; message?: string }) => void): () => void
      }
      ragflow: {
        presetLanguage(): Promise<boolean>
      }
      llmKeys: {
        list(): Promise<LlmKeyStatus[]>
        save(id: string, value: string): Promise<{ ok: boolean; error?: string }>
        test(id: string): Promise<{ ok: boolean; latencyMs?: number; error?: string }>
        restart(): Promise<void>
      }
      kb: {
        list(): Promise<KbListView>
        createCustom(request: { name: string; description: string }): Promise<KbView>
        ensureAgent(agentKey: KbAgentKey): Promise<KbView>
        remove(kbId: string): Promise<void>
        docs(kbId: string): Promise<KbDocsView>
        upload(request: { kbId: string; filePaths: string[]; category?: string }): Promise<string[]>
        createCategory(request: { kbId: string; name: string; parent?: string }): Promise<void>
        renameCategory(request: { kbId: string; oldName: string; newName: string }): Promise<void>
        deleteCategory(request: { kbId: string; name: string }): Promise<void>
        assignDocs(request: { kbId: string; docIds: string[]; category: string | null }): Promise<void>
        parse(request: { kbId: string; docIds: string[] }): Promise<void>
        stopParse(request: { kbId: string; docIds: string[] }): Promise<void>
        deleteDocs(request: { kbId: string; docIds: string[] }): Promise<void>
      }
      kbGuardian: {
        state(): Promise<GuardianState>
        create(input: GuardianSkillInput): Promise<GuardianSkill>
        update(id: string, input: GuardianSkillInput): Promise<GuardianSkill>
        remove(id: string): Promise<void>
        runNow(id: string): Promise<{ queued: boolean; reason?: string }>
        logs(skillId?: string): Promise<GuardianRunLog[]>
        pickDir(): Promise<string | null>
        retryFailed(request: { skillId: string; logId: string }): Promise<{ retried: number; succeeded: number; skipped: number; failed: number; failures: Array<{ name: string; reason: string }> }>
        getLogDetail(logId: string): Promise<GuardianRunLog | null>
        onRunEvent(callback: (event: GuardianRunEvent) => void): () => void
      }
      aiEmployee: {
        ask(request: AiEmployeeAskRequest): Promise<{ ok: boolean; content: string }>
        models(): Promise<AiEmployeeChatModelProfile[]>
        pickAttachments(): Promise<AiEmployeePickResult>
        materializeMarkdownReport(content: string): Promise<{ content: string; materialized: boolean }>
        browserShow(bounds: BrowserBounds): Promise<void>
        browserHide(): Promise<void>
        browserNavigate(url: string): Promise<void>
        browserBack(): Promise<void>
        browserForward(): Promise<void>
        browserReload(): Promise<void>
        browserUrl(): Promise<string>
        extractCurrent(): Promise<{ ok: boolean; info?: Record<string, unknown>; prompt?: string; message?: string }>
        cnyUsdRate(): Promise<{ usdPerCny: number; fetchedAt: string; source: string } | null>
        amazonResolve(keyword: string): Promise<{ asin: string; title: string } | null>
                amazonMarketStats(keyword: string): Promise<AmazonMarketSample[] | null>
        amazonListingEvidence(asins: string[]): Promise<AmazonListingEvidence[]>
        amazonReviewEvidence(asins: string[]): Promise<AmazonReviewEvidence[]>
        deriveAmazonKeywords(intent: AmazonSearchIntent): Promise<string[]>
        inferEvidence(input: { intent: AmazonSearchIntent; listingEvidence: AmazonListingEvidence[]; reviewEvidence: AmazonReviewEvidence[]; sourceText: { title: string; productForm: string; useMethod: string; targetObject: string; attributes: string[]; detailText: string } }): Promise<{ differentiation: string; compliance: string; model: string; provider: string } | null>
        amazonDataSource: {
          get(): Promise<{ configured: boolean; site: string; pages: number; maxSamples: number; cacheHours: number }>
          save(input: { apiKey?: string; site: string; pages: number; maxSamples: number; cacheHours: number }): Promise<{ configured: boolean; site: string; pages: number; maxSamples: number; cacheHours: number }>
          clear(): Promise<void>
          test(): Promise<{ ok: boolean; message: string; samples?: number }>
          search(keyword: string): Promise<AmazonDataSourceSearchResult>
        }
        exportDocument(request: { title: string; roleName: string; createdAt: number; messages: Array<{ role: 'user' | 'assistant'; content: string }>; format: 'word' | 'pdf' | 'markdown' }): Promise<{ canceled: boolean; filePath?: string }>
        exportWordReport(request: { title: string; markdown: string; roleName?: string }): Promise<{ canceled: boolean; filePath?: string; byteSize?: number; error?: string }>
        sampleLibrary: {
          list(): Promise<{ ok: boolean; samples?: Array<{
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
          }>; error?: string }>
          openDocx(request: { filePath: string }): Promise<{ ok: boolean; filePath?: string; error?: string }>
        }
        sampleLibraryKb: {
          describe(): Promise<{ agentName: string; agentRole: string; kbName: string; description: string; categoryRoot: string }>
          preview(): Promise<{
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
          }>
          ingest(options?: { parse?: boolean }): Promise<{
            kbId: string
            plan: Array<{ name: string; filePath: string; category: string; meta: { kind: 'sample' | 'gates' | 'traceability'; letter?: 'A' | 'B' | 'C' | 'D'; size: number } }>
            uploaded: Array<{ name: string; filePath: string; category: string; meta: { kind: 'sample' | 'gates' | 'traceability'; letter?: 'A' | 'B' | 'C' | 'D'; size: number } }>
            skipped: Array<{ name: string; filePath: string; category: string; meta: { kind: 'sample' | 'gates' | 'traceability'; letter?: 'A' | 'B' | 'C' | 'D'; size: number } }>
            parsed: string[]
            errors: Array<{ file: string; error: string }>
            durationMs: number
          }>
          // I.2 阶段新增：守卫自动同步预置技能 IPC
          launch(): Promise<{ present: boolean; skill: GuardianSkill | null; ranNow: boolean; runNowReason?: string }>
          guardianStatus(): Promise<{ present: boolean; skill: GuardianSkill | null; state: GuardianState }>
        }
        exportListing(request: { title: string; format: 'word' | 'markdown' | 'csv'; material: string; packages: Array<{ siteLabel: string; languageCode: string; conclusion: string; content: string }> }): Promise<{ canceled: boolean; filePath?: string }>
        onBrowserUrl(callback: (url: string) => void): () => void
        onBrowserLoading(callback: (loading: boolean) => void): () => void
      }
      browser: {
        show(platform: Platform): Promise<void>
        hide(): Promise<void>
        setBounds(bounds: BrowserBounds): Promise<void>
        navigate(platform: Platform, url: string): Promise<void>
        back(platform: Platform): Promise<void>
        forward(platform: Platform): Promise<void>
        reload(platform: Platform): Promise<void>
        getState(platform: Platform): Promise<BrowserState>
        activateSupply(platformCode: '1688' | 'GIGACLOUD'): Promise<SupplyActivationResult>
        openTab(platform: Platform, url: string, title?: string): Promise<string>
        newTab(): Promise<string>
        switchTab(tabId: string): Promise<void>
        closeTab(tabId: string): Promise<void>
        create1688SearchUrl(keyword: string): Promise<string>
        translate(mode: BrowserTranslationMode): Promise<BrowserTranslationStatus>
        restoreTranslation(): Promise<void>
        startCollector(): Promise<BuiltInCollectorState>
        collectorState(): Promise<BuiltInCollectorState>
        removeCollectorProduct(url: string): Promise<BuiltInCollectorState>
        cancelCollector(): Promise<void>
        confirmCollector(): Promise<CollectorPluginImportResult>
        startEbayPlugin(): Promise<EbayBrowserPluginState>
        ebayPluginState(): Promise<EbayBrowserPluginState>
        removeEbayPluginProduct(url:string): Promise<EbayBrowserPluginState>
        clearEbayPluginProducts(): Promise<EbayBrowserPluginState>
        stopEbayPlugin(): Promise<void>
        openEbayDeliveryLocation(): Promise<EbayDeliveryLocationResult>
        onTabs(callback: (tabs: BrowserTab[]) => void): () => void
        onState(callback: (state: BrowserState) => void): () => void
      }
      tasks: {
        latest(): Promise<{ task: SelectionTask; products: CollectedOzonProduct[]; supplyProducts?: CollectedSupplyProduct[] } | null>
        create(task: SelectionTaskDraft): Promise<SelectionTask>
        start(taskId: string): Promise<{ task: SelectionTask; products: CollectedOzonProduct[]; supplyProducts?: CollectedSupplyProduct[] }>
        preview(taskId: string): Promise<CollectionPreviewResult>
        confirmPreview(request: CollectionPreviewConfirmRequest): Promise<{ task: SelectionTask; collected: number; selected: number }>
        onProgress(callback: (progress: TaskProgress) => void): () => void
      }
      candidates: {
        list(): Promise<CandidateWorkspace>
        delete(request: CandidateUpdateRequest): Promise<CandidateWorkspace>
        restore(request: CandidateUpdateRequest): Promise<CandidateWorkspace>
        purge(request: CandidateUpdateRequest): Promise<CandidateWorkspace>
      }
      selections: {
        list(): Promise<SelectionCatalogItem[]>
        import(request: SelectionImportRequest): Promise<SelectionCatalogItem>
        decide(id: string, decision: SelectionDecision): Promise<SelectionCatalogItem>
        categorize(id: string, category: string, subcategory: string, tertiaryCategory: string): Promise<SelectionCatalogItem>
        returnToCandidates(id: string): Promise<void>
      }
      comparisons: {
        list(): Promise<ComparisonRecordView[]>
        import(request: ComparisonImportRequest): Promise<ComparisonRecordView>
        update(request: ComparisonUpdateRequest): Promise<ComparisonRecordView>
        promote(request: ComparisonPromotionRequest): Promise<ComparisonPromotionResult>
      }
      workflow: { counts(): Promise<WorkflowCounts> }
      compliance: {
        workspace():Promise<ComplianceKnowledgeWorkspace>
        saveRule(draft:ComplianceRuleDraft):Promise<ComplianceRule>
        setRuleStatus(ruleId:string,status:ComplianceReviewStatus):Promise<ComplianceRule>
        syncRecalls(sourceId:string):Promise<{imported:number;workspace:ComplianceKnowledgeWorkspace}>
        syncSource(sourceId:string):Promise<{workspace:ComplianceKnowledgeWorkspace;imported?:number;changed?:boolean;versionsCreated?:number}>
        check(request:ComplianceCheckRequest):Promise<ComplianceCheckResult>
        latestCheck(productId:string):Promise<ComplianceCheckResult|undefined>
        reviewCheck(checkId:string,reviewedBy:string,note:string):Promise<ComplianceCheckResult>
        saveProfile(draft:ComplianceProductProfileDraft):Promise<ComplianceProductProfile>
        chooseDocument():Promise<{fileName:string;filePath:string}|undefined>
        saveDocument(draft:ComplianceDocumentDraft):Promise<ComplianceDocumentRecord>
        saveTemplate(draft:ComplianceCategoryTemplateDraft):Promise<ComplianceCategoryTemplate>
        updateTask(taskId:string,status:ComplianceTaskStatus,assignee:string,resolution:string):Promise<ComplianceTaskRecord>
        updateAlert(alertId:string,status:ComplianceAlertStatus,note:string):Promise<ComplianceAlert>
        updateEnforcementCase(caseId:string,status:ComplianceEnforcementStatus,assignee:string,resolution:string):Promise<ComplianceEnforcementCase>
        reviewSourceChange(changeId:string,decision:ComplianceSourceChangeDecision,reviewedBy:string,note:string):Promise<ComplianceSourceChangeReviewResult>
        exportPermit(permitId:string):Promise<{canceled:boolean;filePath?:string}>
        exportEvidence():Promise<{canceled:boolean;filePath?:string}>
        recheckProfiles(platform?:string,country?:string):Promise<ComplianceBatchRecheckResult>
      }
      warehouses: { list(): Promise<SupplyWarehouseProduct[]> }
      marketplaceSelections: {
        list(marketplaceCode: MarketplacePlatformCode): Promise<MarketplaceSelectionProduct[]>
        import(marketplaceCode: MarketplacePlatformCode, supplyProductId: string): Promise<MarketplaceSelectionProduct>
      }
      marketplaceMedia: {
        list(marketplaceSelectionId: string): Promise<MarketplaceMediaAsset[]>
        save(marketplaceSelectionId: string, assetType: MarketplaceMediaAssetType, imageUrl: string, localPath?: string, selected?: boolean): Promise<MarketplaceMediaAsset>
        select(id: string): Promise<MarketplaceMediaAsset>
      }
      marketplacePublish: {
        list(marketplaceCode: MarketplacePlatformCode): Promise<MarketplacePublishDraft[]>
        create(marketplaceSelectionId: string, storeId?: string): Promise<MarketplacePublishDraft>
        update(request: MarketplacePublishDraftUpdate, action: string): Promise<MarketplacePublishDraft>
        audits(marketplaceCode: MarketplacePlatformCode): Promise<MarketplacePublishAudit[]>
      }
      ebay: {
        status():Promise<EbayConfigurationStatus>
        stores():Promise<EbayStore[]>
        createStore(name:string,username:string,password:string,marketplaceId?:string):Promise<EbayStore>
        authorize(storeId:string):Promise<EbayStore>
        openSellerHub(storeId:string):Promise<string>
        newBrowserTab(storeId:string):Promise<string>
        openProduct(storeId:string,url:string,title:string):Promise<string>
        ensureLogin(storeId:string):Promise<EbayLoginResult>
        importReport(storeId:string):Promise<EbayReportImportResult|null>
        listings(storeId?:string):Promise<EbayListing[]>
        localProducts(storeId?:string):Promise<EbayLocalProduct[]>
        localProductSnapshots(localProductId:string):Promise<EbayLocalProductSnapshot[]>
        downloadLocalProduct(storeId:string,listingId:string):Promise<EbayLocalProduct>
        readProductByUrl(storeId:string,url:string):Promise<EbayLocalProduct>
        updateLocalProduct(localProductId:string,changes:EbayLocalProductUpdateInput):Promise<EbayLocalProduct>
        localProductMediaData(localProductId:string,mediaId:string):Promise<string>
        addLocalProductMedia(localProductId:string,input:EbayLocalProductMediaUploadInput):Promise<EbayLocalProductMedia>
        inspectLocalProductImages(localProductId:string):Promise<EbayImageVisualInspectionReport>
        inspectFinalImages(imageUrls:string[]):Promise<EbayImageInspectionReport>
        localProductImageVisualReport(localProductId:string):Promise<EbayImageVisualInspectionReport|null>
        reviewLocalProductImageRule(input:EbayImageVisualReviewInput):Promise<EbayImageVisualInspectionReport>
        localProductRequirements(storeId:string,listingId:string,title:string):Promise<EbayLocalListingRequirements>
        prepareLocalProductRevision(localProductId:string):Promise<EbayLocalRevisionPreparationResult>
        removeLocalProduct(localProductId:string):Promise<boolean>
        removeLocalListing(storeId:string,listingId:string):Promise<boolean>
        updateListingCategory(storeId:string,listingId:string,categoryId:string):Promise<EbayListing>
        syncListingDetails(storeId:string,listingId:string):Promise<EbayListing>
        marketResearch(storeId:string,listingId:string):Promise<EbayMarketResearchSnapshot|undefined>
        marketResearchHistory(storeId:string,listingId:string):Promise<EbayMarketResearchSnapshot[]>
        openMarketResearch(request:EbayMarketResearchRequest):Promise<string>
        runMarketResearch(request:EbayMarketResearchRequest):Promise<EbayMarketResearchSnapshot>
        decideMarketResearch(request:EbayMarketResearchDecisionRequest):Promise<EbayMarketResearchSnapshot>
        titleDecision(storeId:string,listingId:string):Promise<EbayTitleDecision|undefined>
        confirmTitleDecision(input:EbayTitleDecisionInput):Promise<EbayTitleDecision>
        sync(storeId:string):Promise<EbaySyncResult>
        categoryWorkspace(storeId:string):Promise<EbayCategoryWorkspace>
        syncCategories(storeId:string):Promise<EbayCategoryWorkspace>
        productSyncRuns(storeId:string):Promise<EbayProductSyncRun[]>
        pendingDirectorySync(storeId:string):Promise<EbayDirectoryProductSyncCheckpoint|undefined>
        controlDirectorySync(storeId:string,action:'PAUSE'|'RESUME'|'CANCEL'):Promise<{taskId:string;status:string}>
        onDirectorySyncProgress(callback:(progress:EbayDirectoryProductSyncProgress)=>void):()=>void
        syncDirectoryProducts(request:EbayDirectoryProductSyncRequest):Promise<EbayDirectoryProductSyncResult>
        confirmCollection(storeId:string):Promise<EbayCollectionImportResult>
        optimizeTitle(request:EbayTitleOptimizationRequest):Promise<EbayTitleOptimizationResult>
        optimizeContent(request:EbayContentOptimizationRequest):Promise<EbayContentOptimizationResult>
        contentOptimization(storeId:string,listingId:string):Promise<EbayContentOptimizationRecord|undefined>
        saveContentOptimization(input:EbayContentOptimizationRecordInput):Promise<EbayContentOptimizationRecord>
        translateContent(request:EbayContentTranslationRequest):Promise<EbayContentTranslationResult>
        exportOptimization(input:EbayOptimizationExportInput):Promise<EbayOptimizationExportResult|null>
        optimizationDrafts(storeId?:string):Promise<EbayOptimizationDraft[]>
        saveOptimizationDraft(input:EbayOptimizationDraftInput):Promise<EbayOptimizationDraft>
        validateOptimizationDraft(draftId:string):Promise<EbayPublishComplianceValidation>
        publishTasks(storeId?:string):Promise<EbayPublishTask[]>
        preparePublishTask(draftId:string):Promise<EbayPublishTask>
        generatePublishVideo(draftId:string):Promise<EbayPublishTask>
        preparePublishVideoUpload(draftId:string):Promise<EbayPublishTask>
        videoStudioConfiguration():Promise<EbayVideoStudioConfiguration>
        checkVideoStudioCapabilities():Promise<EbayVideoStudioConfiguration>
        verifyVideoStudioCapability(request:EbayVideoCapabilityVerificationRequest):Promise<EbayVideoStudioConfiguration>
        videoStudioProjects(listingId:string):Promise<EbayVideoStudioProject[]>
        confirmVideoStudioProject(listingId:string,projectId:string):Promise<EbayVideoStudioProject[]>
        pickVideoStudioImages():Promise<Array<{name:string;dataUrl:string}>>
        generateVideoStudio(request:EbayVideoStudioRequest):Promise<EbayVideoStudioProject>
        onVideoStudioProgress(callback:(progress:EbayVideoStudioProgress)=>void):()=>void
        acceptanceBatches(storeId:string):Promise<EbayAcceptanceBatch[]>
        runAcceptance(request:EbayAcceptanceRunRequest):Promise<EbayAcceptanceBatch>
      }
      image: {
        models(): Promise<ImageModelConnection>
        generate(request: ImageGenerationRequest): Promise<ImageGenerationResult>
        ground(request:EbayImageGroundingRequest):Promise<EbayImageGroundingPlan>
        extractPackageText(request:ImagePackageTextExtractionRequest):Promise<ImagePackageTextExtractionResult>
        reviewCandidate(request:EbayImageCandidateReviewRequest):Promise<EbayImageCandidateReview>
        suggestRoles(request:EbayImageRoleSuggestionRequest):Promise<EbayImageRoleSuggestionResult>
        stageGrounding(request:EbayStageGroundingRequest):Promise<EbayStageFactCard>
        stageStoryboard(request:EbayStageStoryboardRequest):Promise<EbayStageStoryboardCard[]>
        stageModelRecommend(stage:EbayImageStage):Promise<EbayStageModelRecommendation>
        realshift(request: RealShiftRequest): Promise<RealShiftResult>
                realshiftPreflight(): Promise<{ ok: boolean; message: string }>
        selectRealshift(reportPath: string, choice: 'original' | 'processed'): Promise<{ selectionPath: string }>
        pickRealshiftImage(): Promise<string | null>
        pickProductImages():Promise<ImportedProductSource|null>
        readProductUrl(url:string):Promise<ImportedProductSource>
        translateMarketing(request:ImageMarketingTranslationRequest):Promise<ImageMarketingTranslationResult>
      }
      advisor: AdvisorDesktopApi
      marketplace: {
        profiles(): Promise<{ platforms: MarketplacePlatformProfile[]; accounts: MarketplaceAccountProfile[] }>
        addAccount(platformCode: MarketplacePlatformCode, name: string): Promise<MarketplaceAccountProfile>
        activate(platformCode: MarketplacePlatformCode, accountId: string, strategy: NetworkStrategy): Promise<void>
        credentialStatus(accountId: string): Promise<MarketplaceCredentialStatus>
        saveCredential(input: MarketplaceCredentialInput): Promise<MarketplaceCredentialStatus>
        deleteCredential(accountId: string): Promise<MarketplaceCredentialStatus>
        openCredentialLogin(accountId: string, platformCode: string): Promise<string>
        fillCredential(accountId: string, submit?: boolean): Promise<{ usernameFilled:boolean; passwordFilled:boolean; submitted:boolean; verificationRequired:boolean; url:string }>
      }
    }
  }
}

export {}
