import type { BrowserBounds, BrowserState, BrowserTab, BrowserTranslationMode, BrowserTranslationStatus, BuiltInCollectorState, CandidateUpdateRequest, CandidateWorkspace, CollectedOzonProduct, CollectedSupplyProduct, CollectionPreviewConfirmRequest, CollectionPreviewResult, CollectorPluginImportResult, ComparisonImportRequest, ComparisonPromotionRequest, ComparisonPromotionResult, ComparisonRecordView, ComparisonUpdateRequest, ComplianceAlert, ComplianceAlertStatus, ComplianceCategoryTemplate, ComplianceCategoryTemplateDraft, ComplianceCheckRequest, ComplianceCheckResult, ComplianceDocumentDraft, ComplianceDocumentRecord, ComplianceEnforcementCase, ComplianceEnforcementStatus, ComplianceKnowledgeWorkspace, ComplianceProductProfile, ComplianceProductProfileDraft, ComplianceReviewStatus, ComplianceRule, ComplianceRuleDraft, ComplianceSourceChangeDecision, ComplianceSourceChangeReviewResult, ComplianceTaskRecord, ComplianceTaskStatus, EbayAcceptanceBatch, EbayAcceptanceRunRequest, EbayBrowserPluginState, EbayCategoryWorkspace, EbayCollectionImportResult, EbayConfigurationStatus, EbayContentOptimizationRecord, EbayContentOptimizationRecordInput, EbayContentOptimizationRequest, EbayContentOptimizationResult, EbayContentTranslationRequest, EbayContentTranslationResult, EbayDeliveryLocationResult, EbayDirectoryProductSyncCheckpoint, EbayDirectoryProductSyncProgress, EbayDirectoryProductSyncRequest, EbayDirectoryProductSyncResult, EbayImageCandidateReview, EbayImageCandidateReviewRequest, EbayImageGroundingPlan, EbayImageGroundingRequest, EbayListing, EbayLocalProduct, EbayLocalProductSnapshot, EbayLocalProductUpdateInput, EbayLoginResult, EbayMarketResearchDecisionRequest, EbayMarketResearchRequest, EbayMarketResearchSnapshot, EbayOptimizationDraft, EbayOptimizationDraftInput, EbayOptimizationExportInput, EbayOptimizationExportResult, EbayProductSyncRun, EbayPublishComplianceValidation, EbayPublishTask, EbayReportImportResult, EbayStore, EbaySyncResult, EbayTitleOptimizationRequest, EbayTitleOptimizationResult, EbayVideoStudioConfiguration, EbayVideoStudioProgress, EbayVideoStudioProject, EbayVideoStudioRequest, ImageGenerationRequest, ImageGenerationResult, ImageModelConnection, MarketplaceAccountProfile, MarketplaceCredentialInput, MarketplaceCredentialStatus, MarketplaceMediaAsset, MarketplaceMediaAssetType, MarketplacePlatformCode, MarketplacePlatformProfile, MarketplacePublishAudit, MarketplacePublishDraft, MarketplacePublishDraftUpdate, MarketplaceSelectionProduct, NetworkStrategy, Platform, RealShiftRequest, RealShiftResult, SelectionCatalogItem, SelectionDecision, SelectionImportRequest, SelectionTask, SelectionTaskDraft, SupplyActivationResult, SupplyWarehouseProduct, TaskProgress, WorkflowCounts } from '../shared/contracts'
import type { ComplianceBatchRecheckResult } from '../shared/contracts'
import type { EbayImageInspectionReport, EbayImageVisualInspectionReport, EbayImageVisualReviewInput, EbayLocalProductMedia, EbayLocalProductMediaUploadInput } from '../shared/contracts'
import type { EbayVideoCapabilityVerificationRequest } from '../shared/contracts'
import type { EbayLocalListingRequirements, EbayLocalRevisionPreparationResult } from '../shared/contracts'
import type { EbayTitleDecision, EbayTitleDecisionInput } from '../shared/contracts'

declare module '*.css'

declare global {
  interface Window {
    desktop: {
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
        reviewCandidate(request:EbayImageCandidateReviewRequest):Promise<EbayImageCandidateReview>
        realshift(request: RealShiftRequest): Promise<RealShiftResult>
        selectRealshift(reportPath: string, choice: 'original' | 'processed'): Promise<{ selectionPath: string }>
        pickRealshiftImage(): Promise<string | null>
      }
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
