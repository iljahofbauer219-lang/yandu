import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import type { CandidateCollectionRecord, CandidateCollectionRun, CandidateUpdateRequest, CandidateWorkspace, CollectedOzonProduct, CollectedSupplyProduct, CollectorDuplicateProduct, CollectorDuplicateStage, CollectorPluginImportResult, ComparisonCostSettings, ComparisonImportRequest, ComparisonPromotionRequest, ComparisonPromotionResult, ComparisonRecordView, ComparisonSupplierMatch, ComparisonUpdateRequest, ComplianceAlert, ComplianceAlertStatus, ComplianceAuditEvent, ComplianceBatchRecheckResult, ComplianceCategoryTemplate, ComplianceCategoryTemplateDraft, ComplianceCheckRequest, ComplianceCheckResult, ComplianceDocumentDraft, ComplianceDocumentRecord, ComplianceEnforcementAction, ComplianceEnforcementCase, ComplianceEnforcementStatus, ComplianceFinding, ComplianceKnowledgeWorkspace, ComplianceProductProfile, ComplianceProductProfileDraft, ComplianceRecall, ComplianceReleasePermit, ComplianceReviewStatus, ComplianceRule, ComplianceRuleDraft, ComplianceRuleVersion, ComplianceSource, ComplianceSourceChange, ComplianceSourceChangeDecision, ComplianceSourceChangeReviewResult, ComplianceTaskRecord, ComplianceTaskStatus, EbayAcceptanceBatch, EbayCategoryChange, EbayCategorySyncSummary, EbayCategoryWorkspace, EbayCollectedProduct, EbayContentOptimizationRecord, EbayContentOptimizationRecordInput, EbayDirectoryProductScanCategory, EbayDirectoryProductSyncCheckpoint, EbayImageVisualInspectionReport, EbayImageVisualReviewInput, EbayListing, EbayLocalProduct, EbayLocalProductSnapshot, EbayLocalProductSnapshotInput, EbayMarketResearchDecisionRequest, EbayMarketResearchSnapshot, EbayOptimizationDraft, EbayOptimizationDraftInput, EbayProductDetails, EbayProductSyncChange, EbayProductSyncRun, EbayPublishComplianceValidation, EbayPublishTask, EbayStore, EbayStoreCategory, EbayTitleDecision, EbayTitleDecisionInput, EbayTitleHandoff, MarketplaceAccountProfile, MarketplaceMediaAsset, MarketplaceMediaAssetType, MarketplacePlatformCode, MarketplacePlatformProfile, MarketplacePublishAudit, MarketplacePublishDraft, MarketplacePublishDraftUpdate, MarketplaceSelectionProduct, NetworkStrategy, SelectionCatalogItem, SelectionDecision, SelectionImportRequest, SelectionTask, SupplyWarehouseProduct } from '../../shared/contracts'
import { complianceCheckFingerprint } from '../../shared/complianceFingerprint'

function isUsableCandidateImage(value: string) {
  return /^https?:\/\//i.test(value) && !/(?:product_base|placeholder|default[-_]?image|loading|lazyload|blank|transparent|no[-_]?image)/i.test(value)
}

function normalizeEbayImage(value:string) {
  return value.replace(/\/s-l\d+(?=\.[a-z0-9]+(?:\?|$))/i,'/s-l1600')
}

function uniqueEbayImages(values:string[]) {
  const seen=new Set<string>()
  return values.map(normalizeEbayImage).filter(value=>{
    if(!value)return false
    const key=value.match(/\/images\/g\/([^/]+)/i)?.[1]||value
    if(seen.has(key))return false
    seen.add(key)
    return true
  })
}

function ebayCountryForMarketplace(marketplaceId:string) {
  const suffix=marketplaceId.replace(/^EBAY_/,'').toUpperCase()
  const countries:Record<string,string>={US:'US',GB:'GB',DE:'DE',FR:'FR',IT:'IT',ES:'ES',AU:'AU',CA:'CA',AT:'AT',BE:'BE',CH:'CH',IE:'IE',NL:'NL',PL:'PL'}
  return countries[suffix]||'US'
}

const complianceRecallStopWords=new Set(['about','after','against','because','child','children','consumer','death','from','hazard','injury','mandatory','product','products','recall','recalled','risk','safety','sold','standard','this','that','their','these','those','with'])
function complianceRecallMatches(productText:string,recallText:string) {
  const tokens=[...new Set(recallText.toLowerCase().split(/[^a-z0-9\u4e00-\u9fff]+/).filter(token=>token.length>=4&&!complianceRecallStopWords.has(token)))]
  const normalized=productText.toLowerCase();const matched=tokens.filter(token=>normalized.includes(token))
  return matched.length>=2&&matched.some(token=>token.length>=6)
}

function rebuildEbayImageVisualReport(report:EbayImageVisualInspectionReport):EbayImageVisualInspectionReport {
  const images=report.images.map(image=>{
    const status:EbayImageVisualInspectionReport['images'][number]['status']=image.rules.some(rule=>rule.status==='FAILED')?'FAILED':image.rules.some(rule=>rule.status==='REVIEW')?'REVIEW':'PASSED'
    return {...image,status,summary:status==='PASSED'?'四项视觉规则均已通过。':status==='FAILED'?'存在不符合 eBay 图片要求的内容。':'存在需要人工确认的低置信度结论。'}
  })
  const passed=images.filter(image=>image.status==='PASSED').length
  const failed=images.filter(image=>image.status==='FAILED').length
  const review=images.filter(image=>image.status==='REVIEW').length
  const status=failed?'FAILED':review?'REVIEW':'PASSED'
  const message=status==='PASSED'?'图片内容符合当前四项 eBay 视觉规则。':status==='FAILED'?`${failed} 张图片存在必须修改项。`:`${review} 张图片需要人工复核。`
  return {...report,images,status,passed,failed,review,message}
}

export interface PersistedWorkspace {
  task: SelectionTask
  products: CollectedOzonProduct[]
  supplyProducts: CollectedSupplyProduct[]
}

export class AppDatabase {
  private readonly database: DatabaseSync

  constructor() {
    const databasePath = path.join(app.getPath('userData'), 'sourcing-data.sqlite')
    this.database = new DatabaseSync(databasePath)
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS selection_tasks (
        id TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        stage TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS supply_platforms (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        connector_status TEXT NOT NULL DEFAULT 'PLANNED',
        sort_order INTEGER NOT NULL DEFAULT 0
      );
      INSERT OR IGNORE INTO supply_platforms (code, name, connector_status, sort_order) VALUES
        ('1688', '1688', 'BROWSER_READY', 1),
        ('TAOBAO', '淘宝', 'PLANNED', 2),
        ('TMALL', '天猫', 'PLANNED', 3),
        ('JD', '京东', 'PLANNED', 4),
        ('PINDUODUO', '拼多多', 'PLANNED', 5),
        ('DOUYIN', '抖音商城', 'PLANNED', 6),
        ('XIAOHONGSHU', '小红书', 'PLANNED', 7),
        ('KUAISHOU', '快手电商', 'PLANNED', 8),
        ('GIGACLOUD', '大健云仓', 'PLANNED', 9),
        ('YIWUGO', '义乌购', 'PLANNED', 10),
        ('CUSTOM', '自定义平台', 'PLANNED', 11);
      CREATE TABLE IF NOT EXISTS collection_task_platforms (
        task_id TEXT NOT NULL,
        platform_code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL,
        PRIMARY KEY (task_id, platform_code),
        FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (platform_code) REFERENCES supply_platforms(code)
      );
      CREATE TABLE IF NOT EXISTS platform_collection_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        platform_code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        collected_count INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        started_at TEXT,
        completed_at TEXT,
        FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS marketplace_platforms (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        home_url TEXT NOT NULL,
        default_network_strategy TEXT NOT NULL DEFAULT 'LOCAL_DIRECT',
        collector_ready INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1
      );
      INSERT INTO marketplace_platforms (code, name, home_url, default_network_strategy, collector_ready) VALUES
        ('OZON', 'Ozon / 欧众', 'https://www.ozon.ru/', 'LOCAL_DIRECT', 1),
        ('AMAZON', 'Amazon', 'https://www.amazon.com/', 'LOCAL_DIRECT', 0),
        ('EBAY', 'eBay', 'https://www.ebay.com/', 'LOCAL_DIRECT', 0),
        ('ALIEXPRESS', 'AliExpress', 'https://www.aliexpress.com/', 'LOCAL_DIRECT', 0),
        ('TEMU', 'Temu', 'https://www.temu.com/', 'LOCAL_DIRECT', 0)
      ON CONFLICT(code) DO NOTHING;
      CREATE TABLE IF NOT EXISTS product_warehouses (
        code TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        warehouse_kind TEXT NOT NULL,
        rule_profile TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      );
      INSERT INTO product_warehouses (code, name, warehouse_kind, rule_profile, enabled, updated_at) VALUES
        ('GIGACLOUD', '大健云仓', 'SUPPLY', '["海外仓可售库存","仓库位置与配送区域","尾程费用与履约时效","重量体积与破损风险"]', 1, datetime('now')),
        ('ALIEXPRESS', 'AliExpress', 'MARKET', '["订单量与评价质量","售价及折扣稳定性","配送时效与店铺表现","竞争强度与货源利润"]', 1, datetime('now')),
        ('1688', '1688', 'SUPPLY', '["超级工厂与源头旗舰","阶梯价格与MOQ","回头率及全网销量","综合服务与发货时效"]', 1, datetime('now')),
        ('OZON', 'Ozon', 'MARKET', '["卢布售价与销量表现","评分评论与品牌风险","平台佣金与物流成本","1688同款及预计利润"]', 1, datetime('now'))
      ON CONFLICT(code) DO UPDATE SET name=excluded.name, warehouse_kind=excluded.warehouse_kind, rule_profile=excluded.rule_profile, enabled=excluded.enabled;
      CREATE TABLE IF NOT EXISTS marketplace_accounts (
        id TEXT PRIMARY KEY,
        platform_code TEXT NOT NULL,
        name TEXT NOT NULL,
        network_strategy TEXT NOT NULL DEFAULT 'LOCAL_DIRECT',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (platform_code) REFERENCES marketplace_platforms(code)
      );
      CREATE TABLE IF NOT EXISTS marketplace_account_credentials (
        account_id TEXT PRIMARY KEY,
        platform_code TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        encrypted_password TEXT NOT NULL DEFAULT '',
        automation_mode TEXT NOT NULL DEFAULT 'SESSION_ONLY',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ebay_stores (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        seller_id TEXT NOT NULL DEFAULT '',
        marketplace_id TEXT NOT NULL DEFAULT 'EBAY_US',
        status TEXT NOT NULL DEFAULT 'PENDING',
        encrypted_access_token TEXT NOT NULL DEFAULT '',
        encrypted_refresh_token TEXT NOT NULL DEFAULT '',
        access_token_expires_at TEXT,
        refresh_token_expires_at TEXT,
        last_sync_at TEXT,
        sync_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ebay_listings (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        marketplace_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        sku TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        price TEXT NOT NULL DEFAULT '',
        currency TEXT NOT NULL DEFAULT '',
        quantity INTEGER NOT NULL DEFAULT 0,
        image_url TEXT NOT NULL DEFAULT '',
        category_id TEXT NOT NULL DEFAULT '',
        category_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        view_url TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        UNIQUE(store_id, marketplace_id, listing_id),
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_listings_store ON ebay_listings(store_id, status);
      CREATE TABLE IF NOT EXISTS ebay_local_products (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        marketplace_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        category_id TEXT NOT NULL DEFAULT '',
        category_name TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'INCOMPLETE',
        version_count INTEGER NOT NULL DEFAULT 0,
        latest_snapshot_id TEXT NOT NULL DEFAULT '',
        downloaded_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(store_id, marketplace_id, listing_id),
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_local_products_store ON ebay_local_products(store_id, category_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_local_product_snapshots (
        id TEXT PRIMARY KEY,
        local_product_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        captured_at TEXT NOT NULL,
        UNIQUE(local_product_id, version),
        FOREIGN KEY (local_product_id) REFERENCES ebay_local_products(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_local_product_snapshots_product ON ebay_local_product_snapshots(local_product_id, version DESC);
      CREATE TABLE IF NOT EXISTS ebay_local_product_media (
        id TEXT PRIMARY KEY,
        snapshot_id TEXT NOT NULL,
        media_type TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        remote_url TEXT NOT NULL,
        local_path TEXT NOT NULL,
        mime_type TEXT NOT NULL DEFAULT '',
        width INTEGER NOT NULL DEFAULT 0,
        height INTEGER NOT NULL DEFAULT 0,
        file_size INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT NOT NULL DEFAULT '',
        download_status TEXT NOT NULL,
        FOREIGN KEY (snapshot_id) REFERENCES ebay_local_product_snapshots(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_local_product_media_snapshot ON ebay_local_product_media(snapshot_id, sort_order);
      CREATE TABLE IF NOT EXISTS ebay_image_visual_inspections (
        id TEXT PRIMARY KEY,
        local_product_id TEXT NOT NULL,
        snapshot_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        report_json TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (local_product_id) REFERENCES ebay_local_products(id) ON DELETE CASCADE,
        FOREIGN KEY (snapshot_id) REFERENCES ebay_local_product_snapshots(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_image_visual_inspections_product ON ebay_image_visual_inspections(local_product_id, snapshot_id, checked_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_image_visual_review_events (
        id TEXT PRIMARY KEY,
        inspection_id TEXT NOT NULL,
        media_id TEXT NOT NULL,
        rule_code TEXT NOT NULL,
        decision TEXT NOT NULL,
        reviewed_by TEXT NOT NULL,
        review_note TEXT NOT NULL,
        reviewed_at TEXT NOT NULL,
        FOREIGN KEY (inspection_id) REFERENCES ebay_image_visual_inspections(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_image_visual_review_events_inspection ON ebay_image_visual_review_events(inspection_id, reviewed_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_optimization_drafts (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PREMIUM',
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(store_id, listing_id),
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_optimization_drafts_store ON ebay_optimization_drafts(store_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_content_optimization_records (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        selected_title TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(store_id, listing_id),
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_content_optimization_store ON ebay_content_optimization_records(store_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_title_decisions (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        research_snapshot_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        confirmed_at TEXT NOT NULL,
        UNIQUE(store_id, listing_id),
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_title_decisions_store ON ebay_title_decisions(store_id, confirmed_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_title_handoffs (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        title_decision_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(store_id, listing_id),
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_title_handoffs_store ON ebay_title_handoffs(store_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_publish_tasks (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        draft_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(store_id, draft_id),
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE,
        FOREIGN KEY (draft_id) REFERENCES ebay_optimization_drafts(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_publish_tasks_store ON ebay_publish_tasks(store_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_acceptance_batches (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_acceptance_batches_store ON ebay_acceptance_batches(store_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_market_research (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        UNIQUE(store_id, listing_id),
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_market_research_store ON ebay_market_research(store_id, fetched_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_market_research_history (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        fetched_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_market_research_history_listing ON ebay_market_research_history(store_id, listing_id, fetched_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_store_categories (
        store_id TEXT NOT NULL,
        category_id TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_category_id TEXT NOT NULL DEFAULT '',
        level INTEGER NOT NULL DEFAULT 1,
        child_count INTEGER NOT NULL DEFAULT 0,
        listing_count INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        synced_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (store_id, category_id),
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_store_categories_tree ON ebay_store_categories(store_id, status, parent_category_id, sort_order);
      CREATE TABLE IF NOT EXISTS ebay_category_sync_runs (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        total_count INTEGER NOT NULL DEFAULT 0,
        added_count INTEGER NOT NULL DEFAULT 0,
        renamed_count INTEGER NOT NULL DEFAULT 0,
        moved_count INTEGER NOT NULL DEFAULT 0,
        removed_count INTEGER NOT NULL DEFAULT 0,
        reordered_count INTEGER NOT NULL DEFAULT 0,
        changes TEXT NOT NULL DEFAULT '[]',
        synced_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_category_sync_runs_store ON ebay_category_sync_runs(store_id, synced_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_product_sync_runs (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'INCREMENTAL',
        category_count INTEGER NOT NULL DEFAULT 0,
        scanned_category_count INTEGER NOT NULL DEFAULT 0,
        imported_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        unchanged_count INTEGER NOT NULL DEFAULT 0,
        ended_count INTEGER NOT NULL DEFAULT 0,
        reactivated_count INTEGER NOT NULL DEFAULT 0,
        protected_count INTEGER NOT NULL DEFAULT 0,
        failed_count INTEGER NOT NULL DEFAULT 0,
        total_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'SUCCESS',
        errors TEXT NOT NULL DEFAULT '[]',
        synced_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_product_sync_runs_store ON ebay_product_sync_runs(store_id, synced_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_product_sync_checkpoints (
        task_id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'RUNNING',
        category_ids TEXT NOT NULL DEFAULT '[]',
        completed_category_ids TEXT NOT NULL DEFAULT '[]',
        failed_category_ids TEXT NOT NULL DEFAULT '[]',
        products TEXT NOT NULL DEFAULT '[]',
        scans TEXT NOT NULL DEFAULT '[]',
        public_store_url TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_product_sync_checkpoints_store ON ebay_product_sync_checkpoints(store_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS ebay_listing_absence_evidence (
        store_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        consecutive_count INTEGER NOT NULL DEFAULT 0,
        last_missing_at TEXT NOT NULL,
        PRIMARY KEY (store_id, listing_id),
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ebay_store_url_history (
        id TEXT PRIMARY KEY,
        store_id TEXT NOT NULL,
        public_store_url TEXT NOT NULL,
        change_type TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES ebay_stores(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_ebay_store_url_history_store ON ebay_store_url_history(store_id, verified_at DESC);
      INSERT OR IGNORE INTO marketplace_accounts (id, platform_code, name, network_strategy, status, created_at, updated_at)
        VALUES ('ozon-default', 'OZON', 'Ozon 采集账号1', 'LOCAL_DIRECT', 'ACTIVE', datetime('now'), datetime('now'));
      CREATE TABLE IF NOT EXISTS network_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        strategy TEXT NOT NULL,
        proxy_rules TEXT,
        region TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_route_bindings (
        account_id TEXT PRIMARY KEY,
        network_strategy TEXT NOT NULL,
        network_profile_id TEXT,
        last_exit_ip TEXT,
        last_checked_at TEXT,
        FOREIGN KEY (account_id) REFERENCES marketplace_accounts(id) ON DELETE CASCADE,
        FOREIGN KEY (network_profile_id) REFERENCES network_profiles(id)
      );
      CREATE TABLE IF NOT EXISTS network_diagnostic_runs (
        id TEXT PRIMARY KEY,
        platform_code TEXT NOT NULL,
        account_id TEXT NOT NULL,
        network_strategy TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES marketplace_accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS selection_rule_profiles (
        id TEXT PRIMARY KEY,
        platform_code TEXT NOT NULL,
        preset_code TEXT NOT NULL,
        name TEXT NOT NULL,
        weights TEXT NOT NULL,
        criteria TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        UNIQUE(platform_code, preset_code)
      );
      CREATE TABLE IF NOT EXISTS task_selection_rules (
        task_id TEXT PRIMARY KEY,
        platform_code TEXT NOT NULL,
        preset_code TEXT NOT NULL,
        minimum_score REAL NOT NULL DEFAULT 65,
        dimensions TEXT NOT NULL DEFAULT '[]',
        weights TEXT NOT NULL DEFAULT '{}',
        criteria TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS product_evaluations (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        product_url TEXT NOT NULL,
        total_score REAL,
        grade TEXT,
        data_completeness REAL,
        dimension_scores TEXT NOT NULL DEFAULT '{}',
        recommendation TEXT,
        evaluated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_product_evaluations_task ON product_evaluations(task_id, total_score);
      CREATE TABLE IF NOT EXISTS evaluation_evidence (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL,
        dimension_code TEXT NOT NULL,
        evidence_type TEXT NOT NULL,
        source_url TEXT,
        content TEXT NOT NULL,
        score_effect REAL,
        FOREIGN KEY (evaluation_id) REFERENCES product_evaluations(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS product_risk_flags (
        id TEXT PRIMARY KEY,
        evaluation_id TEXT NOT NULL,
        risk_code TEXT NOT NULL,
        severity TEXT NOT NULL,
        detail TEXT NOT NULL,
        FOREIGN KEY (evaluation_id) REFERENCES product_evaluations(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS product_rejection_records (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        product_url TEXT NOT NULL,
        reason_code TEXT NOT NULL,
        reason TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS platform_metric_mappings (
        platform_code TEXT NOT NULL,
        metric_code TEXT NOT NULL,
        source_field TEXT NOT NULL,
        normalization_rule TEXT NOT NULL DEFAULT '{}',
        PRIMARY KEY (platform_code, metric_code)
      );
      CREATE TABLE IF NOT EXISTS ozon_products (
        task_id TEXT NOT NULL,
        url TEXT NOT NULL,
        payload TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        PRIMARY KEY (task_id, url),
        FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS market_candidates (
        platform_code TEXT NOT NULL,
        product_id TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL,
        first_task_id TEXT NOT NULL,
        latest_task_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        collected_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (platform_code, url)
      );
      CREATE INDEX IF NOT EXISTS idx_market_candidates_platform ON market_candidates(platform_code, updated_at DESC);
      INSERT INTO market_candidates (platform_code, product_id, url, first_task_id, latest_task_id, payload, collected_at, updated_at)
      SELECT 'OZON', COALESCE(json_extract(p.payload, '$.productId'), ''), p.url, p.task_id, p.task_id, p.payload, t.created_at, t.created_at
      FROM ozon_products p
      JOIN selection_tasks t ON t.id = p.task_id
      ORDER BY t.created_at
      ON CONFLICT(platform_code, url) DO UPDATE SET
        product_id = excluded.product_id,
        latest_task_id = excluded.latest_task_id,
        payload = excluded.payload,
        updated_at = excluded.updated_at
      WHERE excluded.updated_at >= market_candidates.updated_at;
      CREATE TABLE IF NOT EXISTS supply_candidates (
        task_id TEXT NOT NULL,
        url TEXT NOT NULL,
        payload TEXT NOT NULL,
        score REAL NOT NULL DEFAULT 0,
        selected INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL,
        deleted_at TEXT,
        PRIMARY KEY (task_id, url),
        FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_supply_candidates_task ON supply_candidates(task_id, selected, score);
      CREATE TABLE IF NOT EXISTS candidate_collection_runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        candidate_area TEXT NOT NULL,
        platform_code TEXT NOT NULL,
        collection_method TEXT NOT NULL,
        source_entry TEXT NOT NULL DEFAULT '',
        requested_count INTEGER NOT NULL DEFAULT 0,
        collected_count INTEGER NOT NULL DEFAULT 0,
        new_count INTEGER NOT NULL DEFAULT 0,
        updated_count INTEGER NOT NULL DEFAULT 0,
        selected_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'COMPLETED',
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_candidate_runs_area ON candidate_collection_runs(candidate_area, completed_at DESC);
      CREATE TABLE IF NOT EXISTS candidate_collection_records (
        candidate_area TEXT NOT NULL,
        candidate_key TEXT NOT NULL,
        collection_run_id TEXT NOT NULL,
        platform_code TEXT NOT NULL,
        collection_method TEXT NOT NULL,
        source_entry TEXT NOT NULL DEFAULT '',
        source_rank INTEGER NOT NULL DEFAULT 0,
        collected_at TEXT NOT NULL,
        PRIMARY KEY (collection_run_id, candidate_area, candidate_key),
        FOREIGN KEY (collection_run_id) REFERENCES candidate_collection_runs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_candidate_records_candidate ON candidate_collection_records(candidate_area, candidate_key, collected_at DESC);
      CREATE TABLE IF NOT EXISTS product_intake_registry (
        identity_key TEXT PRIMARY KEY,
        platform_code TEXT NOT NULL,
        product_id TEXT NOT NULL DEFAULT '',
        canonical_url TEXT NOT NULL DEFAULT '',
        title_snapshot TEXT NOT NULL DEFAULT '',
        first_collected_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        last_stage TEXT NOT NULL DEFAULT 'HISTORY',
        candidate_deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_product_intake_lookup ON product_intake_registry(platform_code, product_id);
      INSERT OR IGNORE INTO candidate_collection_runs (id, task_id, candidate_area, platform_code, collection_method, source_entry, requested_count, collected_count, new_count, updated_count, selected_count, status, started_at, completed_at)
      SELECT s.task_id, s.task_id, 'SUPPLY', COALESCE(json_extract(t.payload, '$.supplyPlatforms[0]'), '1688'),
        COALESCE(json_extract(t.payload, '$.collectionMethod'), 'KEYWORD'),
        CASE WHEN COALESCE(json_extract(t.payload, '$.collectionMethod'), 'KEYWORD') = 'KEYWORD' THEN COALESCE(json_extract(t.payload, '$.keyword'), '') ELSE COALESCE(json_extract(t.payload, '$.sourceUrl'), '') END,
        COALESCE(json_extract(t.payload, '$.maxProducts'), COUNT(*)), COUNT(*), COUNT(*), 0, SUM(s.selected), 'COMPLETED', t.created_at, t.created_at
      FROM supply_candidates s JOIN selection_tasks t ON t.id = s.task_id
      GROUP BY s.task_id;
      INSERT OR IGNORE INTO candidate_collection_records (candidate_area, candidate_key, collection_run_id, platform_code, collection_method, source_entry, source_rank, collected_at)
      SELECT 'SUPPLY', COALESCE(json_extract(s.payload, '$.platformCode'), '1688') || ':' || s.url, s.task_id,
        COALESCE(json_extract(s.payload, '$.platformCode'), '1688'), COALESCE(json_extract(t.payload, '$.collectionMethod'), 'KEYWORD'),
        CASE WHEN COALESCE(json_extract(t.payload, '$.collectionMethod'), 'KEYWORD') = 'KEYWORD' THEN COALESCE(json_extract(t.payload, '$.keyword'), '') ELSE COALESCE(json_extract(t.payload, '$.sourceUrl'), '') END,
        s.sort_order, t.created_at
      FROM supply_candidates s JOIN selection_tasks t ON t.id = s.task_id;
      INSERT OR IGNORE INTO candidate_collection_runs (id, task_id, candidate_area, platform_code, collection_method, source_entry, requested_count, collected_count, new_count, updated_count, selected_count, status, started_at, completed_at)
      SELECT m.latest_task_id, m.latest_task_id, 'MARKET', m.platform_code, COALESCE(json_extract(t.payload, '$.collectionMethod'), 'KEYWORD'),
        CASE WHEN COALESCE(json_extract(t.payload, '$.collectionMethod'), 'KEYWORD') = 'KEYWORD' THEN COALESCE(json_extract(t.payload, '$.keyword'), '') ELSE COALESCE(json_extract(t.payload, '$.sourceUrl'), '') END,
        COALESCE(json_extract(t.payload, '$.maxProducts'), COUNT(*)), COUNT(*), COUNT(*), 0, 0, 'COMPLETED', t.created_at, MAX(m.updated_at)
      FROM market_candidates m JOIN selection_tasks t ON t.id = m.latest_task_id
      GROUP BY m.latest_task_id;
      INSERT OR IGNORE INTO candidate_collection_records (candidate_area, candidate_key, collection_run_id, platform_code, collection_method, source_entry, source_rank, collected_at)
      SELECT 'MARKET', m.platform_code || ':' || m.url, m.latest_task_id, m.platform_code, COALESCE(json_extract(t.payload, '$.collectionMethod'), 'KEYWORD'),
        CASE WHEN COALESCE(json_extract(t.payload, '$.collectionMethod'), 'KEYWORD') = 'KEYWORD' THEN COALESCE(json_extract(t.payload, '$.keyword'), '') ELSE COALESCE(json_extract(t.payload, '$.sourceUrl'), '') END,
        0, m.updated_at
      FROM market_candidates m JOIN selection_tasks t ON t.id = m.latest_task_id;
      CREATE TABLE IF NOT EXISTS comparison_records (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        ozon_url TEXT NOT NULL,
        supplier_url TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        match_score REAL,
        ozon_price_rub REAL,
        purchase_price_cny REAL,
        landed_cost_cny REAL,
        estimated_profit_cny REAL,
        estimated_margin REAL,
        payload TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_comparison_task ON comparison_records(task_id, status);
      CREATE TABLE IF NOT EXISTS selection_records (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        ozon_url TEXT NOT NULL,
        comparison_id TEXT,
        decision TEXT NOT NULL DEFAULT 'PENDING',
        reason TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (comparison_id) REFERENCES comparison_records(id)
      );
      CREATE INDEX IF NOT EXISTS idx_selection_task ON selection_records(task_id, decision);
      CREATE TABLE IF NOT EXISTS inventory_records (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        ozon_url TEXT NOT NULL,
        selection_id TEXT,
        sku TEXT,
        quantity INTEGER NOT NULL DEFAULT 0,
        unit_cost_cny REAL,
        warehouse TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING_INBOUND',
        payload TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (selection_id) REFERENCES selection_records(id)
      );
      CREATE INDEX IF NOT EXISTS idx_inventory_task ON inventory_records(task_id, status);
      CREATE TABLE IF NOT EXISTS listing_records (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        ozon_url TEXT NOT NULL,
        inventory_id TEXT,
        platform TEXT NOT NULL DEFAULT 'OZON',
        title TEXT,
        sale_price REAL,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        platform_product_id TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES selection_tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (inventory_id) REFERENCES inventory_records(id)
      );
      CREATE INDEX IF NOT EXISTS idx_listing_task ON listing_records(task_id, status);
      CREATE TABLE IF NOT EXISTS workflow_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        ozon_url TEXT,
        stage TEXT NOT NULL,
        action TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS suppliers (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        external_id TEXT,
        name TEXT NOT NULL,
        url TEXT,
        rating REAL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        payload TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS supplier_products (
        id TEXT PRIMARY KEY,
        supplier_id TEXT,
        platform TEXT NOT NULL,
        external_id TEXT,
        url TEXT NOT NULL,
        title TEXT NOT NULL,
        image_url TEXT,
        currency TEXT NOT NULL DEFAULT 'CNY',
        min_order_quantity INTEGER,
        payload TEXT NOT NULL DEFAULT '{}',
        collected_at TEXT NOT NULL,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
      );
      CREATE TABLE IF NOT EXISTS supplier_skus (
        id TEXT PRIMARY KEY,
        supplier_product_id TEXT NOT NULL,
        sku_name TEXT,
        attributes TEXT NOT NULL DEFAULT '{}',
        stock INTEGER,
        payload TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (supplier_product_id) REFERENCES supplier_products(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS supplier_price_tiers (
        id TEXT PRIMARY KEY,
        supplier_sku_id TEXT NOT NULL,
        min_quantity INTEGER NOT NULL,
        max_quantity INTEGER,
        unit_price_cny REAL NOT NULL,
        FOREIGN KEY (supplier_sku_id) REFERENCES supplier_skus(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS product_master (
        id TEXT PRIMARY KEY,
        source_task_id TEXT,
        source_url TEXT,
        selection_mode TEXT NOT NULL,
        product_name TEXT NOT NULL,
        category TEXT,
        brand TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS supply_warehouse_products (
        id TEXT PRIMARY KEY,
        warehouse_code TEXT NOT NULL,
        selection_id TEXT NOT NULL,
        source_url TEXT NOT NULL,
        product_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        image_url TEXT NOT NULL DEFAULT '',
        price_text TEXT NOT NULL DEFAULT '',
        supplier_name TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '未分类',
        subcategory TEXT NOT NULL DEFAULT '待人工分类',
        tertiary_category TEXT NOT NULL DEFAULT '待细分',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(warehouse_code, source_url),
        FOREIGN KEY (selection_id) REFERENCES selection_records(id)
      );
      CREATE INDEX IF NOT EXISTS idx_supply_warehouse_code ON supply_warehouse_products(warehouse_code, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS marketplace_selection_products (
        id TEXT PRIMARY KEY,
        marketplace_code TEXT NOT NULL,
        supply_product_id TEXT NOT NULL,
        warehouse_code TEXT NOT NULL,
        source_url TEXT NOT NULL,
        product_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL,
        image_url TEXT NOT NULL DEFAULT '',
        price_text TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '未分类',
        status TEXT NOT NULL DEFAULT 'SELECTED',
        media_status TEXT NOT NULL DEFAULT 'PENDING',
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(marketplace_code, supply_product_id),
        FOREIGN KEY (supply_product_id) REFERENCES supply_warehouse_products(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_marketplace_selection_code ON marketplace_selection_products(marketplace_code, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS marketplace_media_assets (
        id TEXT PRIMARY KEY,
        marketplace_selection_id TEXT NOT NULL,
        marketplace_code TEXT NOT NULL,
        asset_type TEXT NOT NULL,
        image_url TEXT NOT NULL DEFAULT '',
        local_path TEXT NOT NULL DEFAULT '',
        selected INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        FOREIGN KEY (marketplace_selection_id) REFERENCES marketplace_selection_products(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_marketplace_media_selection ON marketplace_media_assets(marketplace_selection_id, selected DESC, created_at DESC);
      CREATE TABLE IF NOT EXISTS marketplace_publish_drafts (
        id TEXT PRIMARY KEY,
        marketplace_code TEXT NOT NULL,
        marketplace_selection_id TEXT NOT NULL,
        platform_sku TEXT NOT NULL,
        title TEXT NOT NULL,
        image_url TEXT NOT NULL DEFAULT '',
        price_text TEXT NOT NULL DEFAULT '',
        store_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'DRAFT',
        checks TEXT NOT NULL DEFAULT '[]',
        error TEXT,
        platform_product_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(marketplace_code, marketplace_selection_id),
        UNIQUE(marketplace_code, platform_sku),
        FOREIGN KEY (marketplace_selection_id) REFERENCES marketplace_selection_products(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_marketplace_publish_status ON marketplace_publish_drafts(marketplace_code, status, updated_at DESC);
      CREATE TABLE IF NOT EXISTS marketplace_publish_audits (
        id TEXT PRIMARY KEY,
        marketplace_code TEXT NOT NULL,
        draft_id TEXT,
        action TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (draft_id) REFERENCES marketplace_publish_drafts(id) ON DELETE SET NULL
      );
      CREATE INDEX IF NOT EXISTS idx_marketplace_publish_audit ON marketplace_publish_audits(marketplace_code, created_at DESC);
      CREATE TABLE IF NOT EXISTS compliance_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        authority TEXT NOT NULL,
        source_type TEXT NOT NULL,
        url TEXT NOT NULL,
        sync_mode TEXT NOT NULL,
        sync_status TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
        last_synced_at TEXT,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS compliance_source_changes (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        old_hash TEXT NOT NULL DEFAULT '',
        new_hash TEXT NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        affected_rule_ids_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
        detected_at TEXT NOT NULL,
        reviewed_at TEXT,
        FOREIGN KEY (source_id) REFERENCES compliance_sources(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_compliance_source_changes ON compliance_source_changes(source_id, detected_at DESC);
      CREATE TABLE IF NOT EXISTS compliance_alerts (
        id TEXT PRIMARY KEY,
        alert_type TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'OPEN',
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_compliance_alerts_status ON compliance_alerts(status, risk_level, updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_alerts_open_dedupe ON compliance_alerts(alert_type, entity_id) WHERE status IN ('OPEN','ACKNOWLEDGED');
      CREATE TABLE IF NOT EXISTS compliance_audit_events (
        id TEXT PRIMARY KEY,
        action TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_compliance_audit_events ON compliance_audit_events(created_at DESC);
      CREATE TABLE IF NOT EXISTS compliance_release_permits (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        marketplace_site TEXT NOT NULL,
        check_id TEXT NOT NULL,
        rule_set_version TEXT NOT NULL,
        input_fingerprint TEXT NOT NULL,
        gate_status TEXT NOT NULL,
        issued_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'VALID',
        revoked_at TEXT,
        revoke_reason TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (check_id) REFERENCES compliance_check_runs(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_compliance_release_permits ON compliance_release_permits(product_id,status,expires_at DESC);
      CREATE TABLE IF NOT EXISTS compliance_enforcement_cases (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        marketplace_site TEXT NOT NULL,
        listing_id TEXT NOT NULL DEFAULT '',
        store_id TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        view_url TEXT NOT NULL DEFAULT '',
        risk_level TEXT NOT NULL,
        reason TEXT NOT NULL,
        recommended_action TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        assignee TEXT NOT NULL DEFAULT '',
        resolution TEXT NOT NULL DEFAULT '',
        resolved_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_compliance_enforcement_cases ON compliance_enforcement_cases(status,risk_level,updated_at DESC);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_enforcement_cases_open_product ON compliance_enforcement_cases(product_id) WHERE status IN ('OPEN','IN_PROGRESS');
      CREATE TABLE IF NOT EXISTS compliance_rules (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL,
        marketplace_site TEXT NOT NULL DEFAULT 'ALL',
        country TEXT NOT NULL DEFAULT 'ALL',
        category TEXT NOT NULL DEFAULT 'ALL',
        rule_type TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        review_status TEXT NOT NULL DEFAULT 'DRAFT',
        current_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_compliance_rules_scope ON compliance_rules(platform, marketplace_site, country, review_status);
      CREATE TABLE IF NOT EXISTS compliance_rule_versions (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        condition_json TEXT NOT NULL DEFAULT '{}',
        remediation TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL,
        effective_from TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(rule_id, version),
        FOREIGN KEY (rule_id) REFERENCES compliance_rules(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS compliance_recalls (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        external_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        products TEXT NOT NULL DEFAULT '',
        hazards TEXT NOT NULL DEFAULT '',
        countries TEXT NOT NULL DEFAULT '',
        recall_date TEXT NOT NULL DEFAULT '',
        source_url TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_id, external_id),
        FOREIGN KEY (source_id) REFERENCES compliance_sources(id)
      );
      CREATE TABLE IF NOT EXISTS compliance_check_runs (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        marketplace_site TEXT NOT NULL,
        country TEXT NOT NULL,
        gate_status TEXT NOT NULL,
        rule_set_version TEXT NOT NULL,
        input_fingerprint TEXT NOT NULL DEFAULT '',
        request_json TEXT NOT NULL DEFAULT '{}',
        findings_json TEXT NOT NULL DEFAULT '[]',
        checked_at TEXT NOT NULL,
        reviewed_at TEXT,
        reviewed_by TEXT,
        review_note TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_compliance_checks_product ON compliance_check_runs(product_id, checked_at DESC);
      CREATE TABLE IF NOT EXISTS compliance_product_profiles (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL UNIQUE,
        platform TEXT NOT NULL,
        marketplace_site TEXT NOT NULL,
        country TEXT NOT NULL,
        category_id TEXT NOT NULL DEFAULT '',
        category_name TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        brand TEXT NOT NULL DEFAULT '',
        manufacturer TEXT NOT NULL DEFAULT '',
        importer TEXT NOT NULL DEFAULT '',
        eu_responsible_person TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        batch_number TEXT NOT NULL DEFAULT '',
        barcode TEXT NOT NULL DEFAULT '',
        origin_country TEXT NOT NULL DEFAULT '',
        materials TEXT NOT NULL DEFAULT '',
        age_grade TEXT NOT NULL DEFAULT '',
        battery_type TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS compliance_documents (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        document_type TEXT NOT NULL,
        name TEXT NOT NULL,
        document_number TEXT NOT NULL DEFAULT '',
        issuer TEXT NOT NULL DEFAULT '',
        model_numbers TEXT NOT NULL DEFAULT '',
        countries TEXT NOT NULL DEFAULT '',
        issued_at TEXT NOT NULL DEFAULT '',
        expires_at TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
        file_name TEXT NOT NULL DEFAULT '',
        file_path TEXT NOT NULL DEFAULT '',
        review_note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (product_id) REFERENCES compliance_product_profiles(product_id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_compliance_documents_product ON compliance_documents(product_id, status, expires_at);
      CREATE TABLE IF NOT EXISTS compliance_category_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        marketplace_site TEXT NOT NULL DEFAULT 'ALL',
        country TEXT NOT NULL DEFAULT 'ALL',
        category TEXT NOT NULL DEFAULT 'ALL',
        required_fields_json TEXT NOT NULL DEFAULT '[]',
        required_documents_json TEXT NOT NULL DEFAULT '[]',
        required_warnings_json TEXT NOT NULL DEFAULT '[]',
        logistics_requirements_json TEXT NOT NULL DEFAULT '[]',
        requires_manual_review INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_compliance_templates_scope ON compliance_category_templates(platform, marketplace_site, country, category, active);
      CREATE TABLE IF NOT EXISTS compliance_tasks (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        check_id TEXT,
        task_type TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        title TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'OPEN',
        assignee TEXT NOT NULL DEFAULT '',
        due_at TEXT NOT NULL DEFAULT '',
        resolution TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_compliance_tasks_status ON compliance_tasks(status, risk_level, updated_at DESC);
      CREATE TABLE IF NOT EXISTS product_skus (
        id TEXT PRIMARY KEY,
        product_id TEXT NOT NULL,
        sku_code TEXT UNIQUE,
        barcode TEXT,
        attributes TEXT NOT NULL DEFAULT '{}',
        weight_kg REAL,
        length_cm REAL,
        width_cm REAL,
        height_cm REAL,
        purchase_cost_cny REAL,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        FOREIGN KEY (product_id) REFERENCES product_master(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS warehouses (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        country TEXT,
        address TEXT,
        status TEXT NOT NULL DEFAULT 'ACTIVE'
      );
      CREATE TABLE IF NOT EXISTS inventory_balances (
        warehouse_id TEXT NOT NULL,
        sku_id TEXT NOT NULL,
        available_quantity INTEGER NOT NULL DEFAULT 0,
        reserved_quantity INTEGER NOT NULL DEFAULT 0,
        in_transit_quantity INTEGER NOT NULL DEFAULT 0,
        average_cost_cny REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (warehouse_id, sku_id),
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (sku_id) REFERENCES product_skus(id)
      );
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id TEXT PRIMARY KEY,
        warehouse_id TEXT NOT NULL,
        sku_id TEXT NOT NULL,
        movement_type TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_cost_cny REAL,
        reference_type TEXT,
        reference_id TEXT,
        occurred_at TEXT NOT NULL,
        FOREIGN KEY (warehouse_id) REFERENCES warehouses(id),
        FOREIGN KEY (sku_id) REFERENCES product_skus(id)
      );
      CREATE TABLE IF NOT EXISTS sales_orders (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        external_order_id TEXT,
        order_status TEXT NOT NULL,
        currency TEXT NOT NULL,
        gross_amount REAL NOT NULL DEFAULT 0,
        customer_country TEXT,
        ordered_at TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS sales_order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        sku_id TEXT,
        quantity INTEGER NOT NULL,
        unit_sale_price REAL NOT NULL,
        currency TEXT NOT NULL,
        FOREIGN KEY (order_id) REFERENCES sales_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (sku_id) REFERENCES product_skus(id)
      );
      CREATE TABLE IF NOT EXISTS purchase_orders (
        id TEXT PRIMARY KEY,
        supplier_id TEXT,
        sales_order_id TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        total_amount_cny REAL NOT NULL DEFAULT 0,
        ordered_at TEXT,
        expected_at TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
        FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id)
      );
      CREATE TABLE IF NOT EXISTS purchase_order_items (
        id TEXT PRIMARY KEY,
        purchase_order_id TEXT NOT NULL,
        sku_id TEXT,
        supplier_sku_id TEXT,
        quantity INTEGER NOT NULL,
        unit_cost_cny REAL NOT NULL,
        FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id) ON DELETE CASCADE,
        FOREIGN KEY (sku_id) REFERENCES product_skus(id),
        FOREIGN KEY (supplier_sku_id) REFERENCES supplier_skus(id)
      );
      CREATE TABLE IF NOT EXISTS shipments (
        id TEXT PRIMARY KEY,
        sales_order_id TEXT,
        purchase_order_id TEXT,
        carrier TEXT,
        tracking_number TEXT,
        shipping_channel TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        freight_cost_cny REAL NOT NULL DEFAULT 0,
        shipped_at TEXT,
        delivered_at TEXT,
        payload TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (sales_order_id) REFERENCES sales_orders(id),
        FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(id)
      );
      CREATE TABLE IF NOT EXISTS finance_ledger (
        id TEXT PRIMARY KEY,
        business_type TEXT NOT NULL,
        reference_type TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        account_code TEXT NOT NULL,
        direction TEXT NOT NULL,
        amount REAL NOT NULL,
        currency TEXT NOT NULL,
        exchange_rate REAL NOT NULL DEFAULT 1,
        amount_cny REAL NOT NULL,
        occurred_at TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}'
      );
      CREATE TABLE IF NOT EXISTS reconciliation_records (
        id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'PENDING',
        sales_cny REAL NOT NULL DEFAULT 0,
        purchase_cost_cny REAL NOT NULL DEFAULT 0,
        freight_cny REAL NOT NULL DEFAULT 0,
        platform_fee_cny REAL NOT NULL DEFAULT 0,
        refund_cny REAL NOT NULL DEFAULT 0,
        profit_cny REAL NOT NULL DEFAULT 0,
        payload TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS support_channels (
        id TEXT PRIMARY KEY,
        channel_type TEXT NOT NULL,
        account_name TEXT NOT NULL,
        default_language TEXT,
        status TEXT NOT NULL DEFAULT 'DISCONNECTED',
        config TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS support_customers (
        id TEXT PRIMARY KEY,
        display_name TEXT,
        country_code TEXT,
        preferred_language TEXT,
        email_masked TEXT,
        phone_masked TEXT,
        risk_level TEXT NOT NULL DEFAULT 'NORMAL',
        payload TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS support_customer_identities (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        external_customer_id TEXT NOT NULL,
        UNIQUE(channel_id, external_customer_id),
        FOREIGN KEY (customer_id) REFERENCES support_customers(id) ON DELETE CASCADE,
        FOREIGN KEY (channel_id) REFERENCES support_channels(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS support_conversations (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        customer_id TEXT,
        external_conversation_id TEXT,
        order_id TEXT,
        status TEXT NOT NULL DEFAULT 'OPEN',
        handling_mode TEXT NOT NULL DEFAULT 'AI_SUGGEST',
        detected_language TEXT,
        intent TEXT,
        sentiment TEXT,
        priority TEXT NOT NULL DEFAULT 'NORMAL',
        assigned_to TEXT,
        last_message_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (channel_id) REFERENCES support_channels(id),
        FOREIGN KEY (customer_id) REFERENCES support_customers(id),
        FOREIGN KEY (order_id) REFERENCES sales_orders(id)
      );
      CREATE INDEX IF NOT EXISTS idx_support_conversation_queue ON support_conversations(status, priority, last_message_at);
      CREATE TABLE IF NOT EXISTS support_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        external_message_id TEXT,
        sender_type TEXT NOT NULL,
        message_type TEXT NOT NULL DEFAULT 'TEXT',
        original_language TEXT,
        original_content TEXT NOT NULL,
        working_language TEXT NOT NULL DEFAULT 'zh-CN',
        working_translation TEXT,
        reply_language TEXT,
        reply_content TEXT,
        translation_confidence REAL,
        translation_provider TEXT,
        translation_model TEXT,
        ai_generated INTEGER NOT NULL DEFAULT 0,
        human_edited INTEGER NOT NULL DEFAULT 0,
        sent_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES support_conversations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_support_message_conversation ON support_messages(conversation_id, sent_at);
      CREATE TABLE IF NOT EXISTS support_attachments (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        file_name TEXT,
        mime_type TEXT,
        local_path TEXT,
        remote_url TEXT,
        ocr_text TEXT,
        FOREIGN KEY (message_id) REFERENCES support_messages(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS support_tickets (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        order_id TEXT,
        ticket_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'OPEN',
        priority TEXT NOT NULL DEFAULT 'NORMAL',
        summary TEXT,
        assigned_to TEXT,
        due_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES support_conversations(id),
        FOREIGN KEY (order_id) REFERENCES sales_orders(id)
      );
      CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        source_type TEXT NOT NULL,
        visibility TEXT NOT NULL DEFAULT 'INTERNAL',
        title TEXT NOT NULL,
        language TEXT NOT NULL,
        brand TEXT,
        country_code TEXT,
        status TEXT NOT NULL DEFAULT 'DRAFT',
        current_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS knowledge_document_versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        effective_at TEXT,
        expires_at TEXT,
        approved_by TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(document_id, version),
        FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        version_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        embedding_provider TEXT,
        embedding_model TEXT,
        embedding BLOB,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (version_id) REFERENCES knowledge_document_versions(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS translation_glossary (
        id TEXT PRIMARY KEY,
        source_language TEXT NOT NULL,
        target_language TEXT NOT NULL,
        source_term TEXT NOT NULL,
        target_term TEXT NOT NULL,
        brand TEXT,
        category TEXT,
        case_sensitive INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        UNIQUE(source_language, target_language, source_term, brand)
      );
      CREATE TABLE IF NOT EXISTS ai_support_runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        agent_version TEXT,
        model_provider TEXT,
        model_name TEXT,
        prompt_version TEXT,
        detected_language TEXT,
        intent TEXT,
        confidence REAL,
        risk_level TEXT,
        outcome TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER,
        latency_ms INTEGER,
        error TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES support_conversations(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ai_support_replies (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        working_reply TEXT,
        customer_language TEXT,
        customer_reply TEXT,
        citation_data TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'SUGGESTED',
        human_edited_content TEXT,
        sent_message_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES ai_support_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (sent_message_id) REFERENCES support_messages(id)
      );
      CREATE TABLE IF NOT EXISTS ai_support_tool_calls (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        risk_level TEXT NOT NULL,
        arguments_masked TEXT NOT NULL DEFAULT '{}',
        result_masked TEXT,
        status TEXT NOT NULL,
        approval_status TEXT,
        approved_by TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        FOREIGN KEY (run_id) REFERENCES ai_support_runs(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS ai_support_escalations (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        run_id TEXT,
        reason TEXT NOT NULL,
        handoff_summary TEXT,
        target_team TEXT,
        status TEXT NOT NULL DEFAULT 'PENDING',
        created_at TEXT NOT NULL,
        accepted_at TEXT,
        FOREIGN KEY (conversation_id) REFERENCES support_conversations(id) ON DELETE CASCADE,
        FOREIGN KEY (run_id) REFERENCES ai_support_runs(id)
      );
    `)
    const ensureColumn = (table: string, column: string, definition: string) => {
      const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      if (!columns.some(item => item.name === column)) this.database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
    }
    ensureColumn('market_candidates', 'deleted_at', 'TEXT')
    ensureColumn('supply_candidates', 'deleted_at', 'TEXT')
    ensureColumn('compliance_check_runs', 'reviewed_at', 'TEXT')
    ensureColumn('compliance_check_runs', 'reviewed_by', 'TEXT')
    ensureColumn('compliance_check_runs', 'review_note', 'TEXT')
    ensureColumn('compliance_check_runs', 'input_fingerprint', "TEXT NOT NULL DEFAULT ''")
    ensureColumn('compliance_check_runs', 'request_json', "TEXT NOT NULL DEFAULT '{}'")
    ensureColumn('compliance_sources', 'content_hash', "TEXT NOT NULL DEFAULT ''")
    ensureColumn('compliance_sources', 'last_checked_at', 'TEXT')
    ensureColumn('compliance_sources', 'last_changed_at', 'TEXT')
    ensureColumn('compliance_sources', 'change_count', 'INTEGER NOT NULL DEFAULT 0')
    ensureColumn('compliance_source_changes', 'reviewed_by', "TEXT NOT NULL DEFAULT ''")
    ensureColumn('compliance_source_changes', 'review_note', "TEXT NOT NULL DEFAULT ''")
    ensureColumn('ebay_stores', 'public_store_url', "TEXT NOT NULL DEFAULT ''")
    ensureColumn('ebay_stores', 'public_store_verified_at', 'TEXT')
    ensureColumn('ebay_product_sync_runs', 'moved_count', 'INTEGER NOT NULL DEFAULT 0')
    ensureColumn('ebay_product_sync_runs', 'suspected_ended_count', 'INTEGER NOT NULL DEFAULT 0')
    ensureColumn('ebay_product_sync_runs', 'changes', "TEXT NOT NULL DEFAULT '[]'")
    ensureColumn('ebay_local_product_media', 'file_size', 'INTEGER NOT NULL DEFAULT 0')
    this.seedComplianceKnowledge()
    this.database.prepare(`DELETE FROM ebay_listings WHERE status='REMOVED'`).run()
    this.repairPlaceholderCandidateImages()
    this.getSelectionCatalog().filter(item => item.decision === 'APPROVED' && (item.sourceArea === 'SUPPLY' || Boolean(item.supplierUrl))).forEach(item => this.upsertSupplyWarehouseProduct(item))
    this.migrateProductIntakeRegistry()
    const ebayStores=this.database.prepare(`SELECT id FROM ebay_stores`).all() as Array<{id:string}>
    ebayStores.forEach(store=>this.reconcileEbayListingCategories(store.id))
  }

  private intakeIdentity(platformCode: string, productId: string, url: string) {
    const normalizedId = productId.trim()
    return normalizedId ? `${platformCode}:${normalizedId}` : `${platformCode}:URL:${url}`
  }

  private registerProductIntake(platformCode: string, productId: string, url: string, title: string, stage: CollectorDuplicateStage, seenAt: string, deletedAt: string | null = null) {
    const identityKey = this.intakeIdentity(platformCode, productId, url)
    const existing = this.database.prepare(`SELECT first_collected_at, last_stage FROM product_intake_registry WHERE identity_key = ?`).get(identityKey) as { first_collected_at:string; last_stage:CollectorDuplicateStage } | undefined
    const rank:Record<CollectorDuplicateStage,number> = { HISTORY:0, CANDIDATE:1, SELECTION:2, WAREHOUSE:3 }
    const resolvedStage = existing && rank[existing.last_stage] > rank[stage] ? existing.last_stage : stage
    const candidateDeletedAt = resolvedStage === 'CANDIDATE' ? null : deletedAt
    this.database.prepare(`INSERT INTO product_intake_registry (identity_key, platform_code, product_id, canonical_url, title_snapshot, first_collected_at, last_seen_at, last_stage, candidate_deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(identity_key) DO UPDATE SET canonical_url=excluded.canonical_url, title_snapshot=excluded.title_snapshot,
        last_seen_at=excluded.last_seen_at, last_stage=excluded.last_stage, candidate_deleted_at=excluded.candidate_deleted_at`)
      .run(identityKey,platformCode,productId,url,title,existing?.first_collected_at || seenAt,seenAt,resolvedStage,candidateDeletedAt)
  }

  private duplicateForProduct(product: CollectedSupplyProduct): CollectorDuplicateProduct | null {
    const identityKey = this.intakeIdentity(product.platformCode, product.productId, product.url)
    const warehouse = this.database.prepare(`SELECT 1 FROM supply_warehouse_products WHERE warehouse_code = ? AND product_id = ? AND status = 'ACTIVE' LIMIT 1`).get(product.platformCode,product.productId)
    if (warehouse) return { platformCode:product.platformCode, productId:product.productId, title:product.title, stage:'WAREHOUSE', message:'该商品已正式入库' }
    const selection = this.database.prepare(`SELECT 1 FROM selection_records WHERE json_extract(payload, '$.platformCode') = ? AND json_extract(payload, '$.productId') = ? LIMIT 1`).get(product.platformCode,product.productId)
    if (selection) return { platformCode:product.platformCode, productId:product.productId, title:product.title, stage:'SELECTION', message:'该商品已进入优选产品' }
    const candidate = this.database.prepare(`SELECT 1 FROM supply_candidates WHERE deleted_at IS NULL AND COALESCE(json_extract(payload, '$.platformCode'), '1688') = ? AND (json_extract(payload, '$.productId') = ? OR url = ?) LIMIT 1`).get(product.platformCode,product.productId,product.url)
    if (candidate) return { platformCode:product.platformCode, productId:product.productId, title:product.title, stage:'CANDIDATE', message:'该商品已在采集候选' }
    const history = this.database.prepare(`SELECT 1 FROM product_intake_registry WHERE identity_key = ? LIMIT 1`).get(identityKey)
    return history ? { platformCode:product.platformCode, productId:product.productId, title:product.title, stage:'HISTORY', message:'该商品曾收录，已从候选删除' } : null
  }

  private markCandidatePhysicallyDeleted(product: {platformCode:string;productId:string;url:string;title:string}, deletedAt: string) {
    this.registerProductIntake(product.platformCode,product.productId,product.url,product.title,'HISTORY',deletedAt,deletedAt)
    const warehouse=this.database.prepare(`SELECT 1 FROM supply_warehouse_products WHERE warehouse_code=? AND product_id=? AND status='ACTIVE' LIMIT 1`).get(product.platformCode,product.productId)
    const selection=this.database.prepare(`SELECT 1 FROM selection_records WHERE json_extract(payload, '$.platformCode')=? AND json_extract(payload, '$.productId')=? LIMIT 1`).get(product.platformCode,product.productId)
    const stage:CollectorDuplicateStage=warehouse?'WAREHOUSE':selection?'SELECTION':'HISTORY'
    this.database.prepare(`UPDATE product_intake_registry SET last_stage=?, last_seen_at=?, candidate_deleted_at=? WHERE identity_key=?`)
      .run(stage,deletedAt,deletedAt,this.intakeIdentity(product.platformCode,product.productId,product.url))
  }

  private migrateProductIntakeRegistry() {
    const candidates = this.database.prepare(`SELECT p.url, p.payload, p.deleted_at, t.created_at FROM supply_candidates p JOIN selection_tasks t ON t.id=p.task_id`).all() as Array<{url:string;payload:string;deleted_at:string|null;created_at:string}>
    candidates.forEach(row=>{const product=JSON.parse(row.payload) as CollectedSupplyProduct;this.registerProductIntake(product.platformCode,product.productId,row.url,product.title,row.deleted_at?'HISTORY':'CANDIDATE',row.created_at,row.deleted_at)})
    const deletedProducts=candidates.filter(row=>Boolean(row.deleted_at)).map(row=>({product:JSON.parse(row.payload) as CollectedSupplyProduct,deletedAt:row.deleted_at!}))
    const selections = this.database.prepare(`SELECT payload, updated_at FROM selection_records`).all() as Array<{payload:string;updated_at:string}>
    selections.forEach(row=>{const product=JSON.parse(row.payload) as SelectionCatalogItem;if(product.platformCode==='1688'||product.platformCode==='GIGACLOUD')this.registerProductIntake(product.platformCode,product.productId,product.sourceUrl,product.title,'SELECTION',row.updated_at)})
    const warehouses = this.database.prepare(`SELECT warehouse_code, product_id, source_url, title, updated_at FROM supply_warehouse_products`).all() as Array<{warehouse_code:string;product_id:string;source_url:string;title:string;updated_at:string}>
    warehouses.forEach(row=>this.registerProductIntake(row.warehouse_code,row.product_id,row.source_url,row.title,'WAREHOUSE',row.updated_at))
    this.database.exec(`DELETE FROM supply_candidates WHERE deleted_at IS NOT NULL`)
    const activeCandidate=this.database.prepare(`SELECT 1 FROM supply_candidates WHERE deleted_at IS NULL AND COALESCE(json_extract(payload, '$.platformCode'), '1688')=? AND (json_extract(payload, '$.productId')=? OR url=?) LIMIT 1`)
    deletedProducts.forEach(item=>{if(!activeCandidate.get(item.product.platformCode,item.product.productId,item.product.url))this.markCandidatePhysicallyDeleted(item.product,item.deletedAt)})
    const records = this.database.prepare(`SELECT DISTINCT candidate_key, platform_code FROM candidate_collection_records WHERE candidate_area='SUPPLY'`).all() as Array<{candidate_key:string;platform_code:string}>
    const exists = this.database.prepare(`SELECT 1 FROM supply_candidates WHERE deleted_at IS NULL AND COALESCE(json_extract(payload, '$.platformCode'), '1688') = ? AND url = ? LIMIT 1`)
    const remove = this.database.prepare(`DELETE FROM candidate_collection_records WHERE candidate_area='SUPPLY' AND candidate_key=?`)
    records.forEach(record=>{const prefix=`${record.platform_code}:`;const url=record.candidate_key.startsWith(prefix)?record.candidate_key.slice(prefix.length):'';if(url&&!exists.get(record.platform_code,url))remove.run(record.candidate_key)})
  }

  private repairPlaceholderCandidateImages() {
    const rows = this.database.prepare(`SELECT rowid, url, payload FROM supply_candidates ORDER BY rowid DESC`).all() as Array<{ rowid: number; url: string; payload: string }>
    const bestImages = new Map<string, string>()
    const parsedRows = rows.map(row => ({ ...row, product: JSON.parse(row.payload) as CollectedSupplyProduct }))
    parsedRows.forEach(row => {
      const key = `${row.product.platformCode}:${row.url}`
      if (!bestImages.has(key) && isUsableCandidateImage(row.product.imageUrl)) bestImages.set(key, row.product.imageUrl)
    })
    const update = this.database.prepare(`UPDATE supply_candidates SET payload = ? WHERE rowid = ?`)
    parsedRows.forEach(row => {
      if (isUsableCandidateImage(row.product.imageUrl)) return
      const replacement = bestImages.get(`${row.product.platformCode}:${row.url}`)
      if (replacement) update.run(JSON.stringify({ ...row.product, imageUrl: replacement }), row.rowid)
    })
  }

  saveTask(task: SelectionTask) {
    this.database.prepare(`
      INSERT INTO selection_tasks (id, payload, stage, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, stage = excluded.stage
    `).run(task.id, JSON.stringify(task), task.stage, task.createdAt)
    const platforms = task.selectionMode === 'FORWARD_SUPPLY' ? task.supplyPlatforms : []
    const removePlatforms = this.database.prepare('DELETE FROM collection_task_platforms WHERE task_id = ?')
    const insertPlatform = this.database.prepare(`
      INSERT INTO collection_task_platforms (task_id, platform_code, status, created_at)
      VALUES (?, ?, 'PENDING', ?)
    `)
    removePlatforms.run(task.id)
    platforms.forEach(platform => insertPlatform.run(task.id, platform, task.createdAt))
    if (task.selectionMode === 'FORWARD_SUPPLY') {
      this.database.prepare(`
        INSERT INTO task_selection_rules (task_id, platform_code, preset_code, minimum_score, dimensions, criteria, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(task_id) DO UPDATE SET platform_code = excluded.platform_code, preset_code = excluded.preset_code,
          minimum_score = excluded.minimum_score, dimensions = excluded.dimensions, criteria = excluded.criteria
      `).run(task.id, task.supplyPlatforms[0] || '1688', task.selectionRulePreset, task.minimumSelectionScore, JSON.stringify(task.selectionDimensions), JSON.stringify({ requiredSupplierBadges: task.requiredSupplierBadges, maxCategoryTopRank: task.maxCategoryTopRank, minimumReturnRate: task.minimumReturnRate, minimumNetworkSales: task.minimumNetworkSales, minimumServiceRating: task.minimumServiceRating, gigaSellerIndexFilter:task.gigaSellerIndexFilter, gigaReturnRateFilter:task.gigaReturnRateFilter }), task.createdAt)
    }
  }

  getMarketplaceProfiles(): { platforms: MarketplacePlatformProfile[]; accounts: MarketplaceAccountProfile[] } {
    const platforms = this.database.prepare(`SELECT code, name, home_url, default_network_strategy, collector_ready FROM marketplace_platforms WHERE enabled = 1 ORDER BY rowid`).all() as unknown as Array<Record<string, unknown>>
    const accounts = this.database.prepare(`SELECT id, platform_code, name, network_strategy, status FROM marketplace_accounts WHERE status = 'ACTIVE' ORDER BY created_at`).all() as unknown as Array<Record<string, unknown>>
    return {
      platforms: platforms.map(row => ({ code: row.code as MarketplacePlatformCode, name: String(row.name), homeUrl: String(row.home_url), defaultNetworkStrategy: row.default_network_strategy as NetworkStrategy, collectorReady: Boolean(row.collector_ready) })),
      accounts: accounts.map(row => ({ id: String(row.id), platformCode: row.platform_code as MarketplacePlatformCode, name: String(row.name), networkStrategy: row.network_strategy as NetworkStrategy, status: String(row.status) }))
    }
  }

  addMarketplaceAccount(platformCode: MarketplacePlatformCode, name: string): MarketplaceAccountProfile {
    const account: MarketplaceAccountProfile = { id: crypto.randomUUID(), platformCode, name, networkStrategy: 'LOCAL_DIRECT', status: 'ACTIVE' }
    const now = new Date().toISOString()
    this.database.prepare(`INSERT INTO marketplace_accounts (id, platform_code, name, network_strategy, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(account.id, account.platformCode, account.name, account.networkStrategy, account.status, now, now)
    return account
  }

  getMarketplaceCredential(accountId: string) {
    return this.database.prepare(`SELECT account_id, platform_code, username, encrypted_password, automation_mode, updated_at FROM marketplace_account_credentials WHERE account_id = ?`).get(accountId) as { account_id:string; platform_code:string; username:string; encrypted_password:string; automation_mode:string; updated_at:string } | undefined
  }

  saveMarketplaceCredential(input: { accountId:string; platformCode:string; username:string; encryptedPassword:string; mode:string }) {
    const now = new Date().toISOString()
    this.database.prepare(`INSERT INTO marketplace_account_credentials (account_id, platform_code, username, encrypted_password, automation_mode, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET platform_code=excluded.platform_code, username=excluded.username, encrypted_password=CASE WHEN excluded.encrypted_password='' THEN marketplace_account_credentials.encrypted_password ELSE excluded.encrypted_password END, automation_mode=excluded.automation_mode, updated_at=excluded.updated_at`)
      .run(input.accountId,input.platformCode,input.username,input.encryptedPassword,input.mode,now)
    return this.getMarketplaceCredential(input.accountId)
  }

  deleteMarketplaceCredential(accountId: string) { this.database.prepare(`DELETE FROM marketplace_account_credentials WHERE account_id = ?`).run(accountId) }

  getEbayStores():EbayStore[] {
    const rows=this.database.prepare(`SELECT s.id,s.name,s.seller_id,s.public_store_url,s.public_store_verified_at,s.marketplace_id,s.status,s.last_sync_at,s.sync_error,c.username login_username,CASE WHEN c.encrypted_password IS NOT NULL AND c.encrypted_password != '' THEN 1 ELSE 0 END password_saved,COUNT(l.id) listing_count FROM ebay_stores s LEFT JOIN ebay_listings l ON l.store_id=s.id AND l.status='ACTIVE' LEFT JOIN marketplace_account_credentials c ON c.account_id=('ebay:' || s.id) GROUP BY s.id ORDER BY s.created_at`).all() as unknown as Array<Record<string,unknown>>
    return rows.map(row=>({id:String(row.id),name:String(row.name),sellerId:String(row.seller_id),publicStoreUrl:String(row.public_store_url||''),publicStoreVerifiedAt:row.public_store_verified_at?String(row.public_store_verified_at):undefined,loginUsername:row.login_username?String(row.login_username):'',passwordSaved:Boolean(row.password_saved),marketplaceId:String(row.marketplace_id),status:row.status as EbayStore['status'],lastSyncAt:row.last_sync_at?String(row.last_sync_at):undefined,syncError:row.sync_error?String(row.sync_error):undefined,listingCount:Number(row.listing_count)}))
  }

  saveEbayPublicStore(storeId:string,publicStoreUrl:string,sellerId='') {
    const now=new Date().toISOString()
    const previous=this.database.prepare(`SELECT public_store_url FROM ebay_stores WHERE id=?`).get(storeId) as {public_store_url:string}|undefined
    this.database.prepare(`UPDATE ebay_stores SET public_store_url=?,public_store_verified_at=?,seller_id=CASE WHEN ?!='' THEN ? ELSE seller_id END,updated_at=? WHERE id=?`).run(publicStoreUrl,now,sellerId,sellerId,now,storeId)
    if(publicStoreUrl&&previous?.public_store_url!==publicStoreUrl)this.database.prepare(`INSERT INTO ebay_store_url_history (id,store_id,public_store_url,change_type,verified_at) VALUES (?,?,?,?,?)`).run(crypto.randomUUID(),storeId,publicStoreUrl,previous?.public_store_url?'CHANGED':'DISCOVERED',now)
  }

  getEbayOptimizationDrafts(storeId?:string):EbayOptimizationDraft[] {
    const rows=(storeId?this.database.prepare(`SELECT payload FROM ebay_optimization_drafts WHERE store_id=? ORDER BY updated_at DESC`).all(storeId):this.database.prepare(`SELECT payload FROM ebay_optimization_drafts ORDER BY updated_at DESC`).all()) as unknown as Array<{payload:string}>
    return rows.map(row=>JSON.parse(row.payload) as EbayOptimizationDraft)
  }

  getEbayContentOptimizationRecord(storeId:string,listingId:string):EbayContentOptimizationRecord|undefined {
    const row=this.database.prepare(`SELECT payload FROM ebay_content_optimization_records WHERE store_id=? AND listing_id=?`).get(storeId,listingId) as {payload:string}|undefined
    return row?JSON.parse(row.payload) as EbayContentOptimizationRecord:undefined
  }

  saveEbayContentOptimizationRecord(input:EbayContentOptimizationRecordInput):EbayContentOptimizationRecord {
    const existing=this.database.prepare(`SELECT id,created_at FROM ebay_content_optimization_records WHERE store_id=? AND listing_id=?`).get(input.storeId,input.listingId) as {id:string;created_at:string}|undefined
    const now=new Date().toISOString()
    const record:EbayContentOptimizationRecord={...input,id:existing?.id||crypto.randomUUID(),createdAt:existing?.created_at||now,updatedAt:now}
    this.database.prepare(`INSERT INTO ebay_content_optimization_records (id,store_id,listing_id,selected_title,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(store_id,listing_id) DO UPDATE SET selected_title=excluded.selected_title,payload=excluded.payload,updated_at=excluded.updated_at`).run(record.id,record.storeId,record.listingId,record.selectedTitle,JSON.stringify(record),record.createdAt,record.updatedAt)
    return record
  }

  getEbayTitleDecision(storeId:string,listingId:string):EbayTitleDecision|undefined {
    const row=this.database.prepare(`SELECT payload FROM ebay_title_decisions WHERE store_id=? AND listing_id=?`).get(storeId,listingId) as {payload:string}|undefined
    return row?JSON.parse(row.payload) as EbayTitleDecision:undefined
  }

  saveEbayTitleDecision(input:EbayTitleDecisionInput,audit:EbayTitleDecision['audit']):EbayTitleDecision {
    const decision:EbayTitleDecision={...input,audit,id:crypto.randomUUID(),status:'CONFIRMED',confirmedAt:new Date().toISOString()}
    this.database.prepare(`INSERT INTO ebay_title_decisions (id,store_id,listing_id,research_snapshot_id,payload,confirmed_at) VALUES (?,?,?,?,?,?) ON CONFLICT(store_id,listing_id) DO UPDATE SET id=excluded.id,research_snapshot_id=excluded.research_snapshot_id,payload=excluded.payload,confirmed_at=excluded.confirmed_at`).run(decision.id,decision.storeId,decision.listingId,decision.researchSnapshotId,JSON.stringify(decision),decision.confirmedAt)
    return decision
  }

  getEbayTitleHandoff(storeId:string,listingId:string):EbayTitleHandoff|undefined {
    const row=this.database.prepare(`SELECT payload FROM ebay_title_handoffs WHERE store_id=? AND listing_id=?`).get(storeId,listingId) as {payload:string}|undefined
    return row?JSON.parse(row.payload) as EbayTitleHandoff:undefined
  }

  saveEbayTitleHandoff(handoff:EbayTitleHandoff):EbayTitleHandoff {
    this.database.prepare(`INSERT INTO ebay_title_handoffs (id,store_id,listing_id,title_decision_id,status,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(store_id,listing_id) DO UPDATE SET id=excluded.id,title_decision_id=excluded.title_decision_id,status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at`).run(handoff.id,handoff.storeId,handoff.listingId,handoff.titleDecisionId,handoff.status,JSON.stringify(handoff),handoff.createdAt,handoff.updatedAt)
    return handoff
  }

  getEbayOptimizationDraft(draftId:string):EbayOptimizationDraft|undefined {
    const row=this.database.prepare(`SELECT payload FROM ebay_optimization_drafts WHERE id=?`).get(draftId) as {payload:string}|undefined
    return row?JSON.parse(row.payload) as EbayOptimizationDraft:undefined
  }

  getEbayPublishTasks(storeId?:string):EbayPublishTask[] {
    const rows=(storeId?this.database.prepare(`SELECT payload FROM ebay_publish_tasks WHERE store_id=? ORDER BY updated_at DESC`).all(storeId):this.database.prepare(`SELECT payload FROM ebay_publish_tasks ORDER BY updated_at DESC`).all()) as unknown as Array<{payload:string}>
    return rows.map(row=>{
      const task=JSON.parse(row.payload) as EbayPublishTask
      if(task.videoUpload?.status==='FILE_SELECTED'&&/尚未上传或提交/.test(task.videoUpload.message)){
        const message='已选择本地视频文件，eBay 可能正在上传或处理；尚未提交，请人工确认处理结果'
        return {...task,message,videoUpload:{...task.videoUpload,message}}
      }
      return task
    })
  }

  saveEbayPublishTask(task:EbayPublishTask):EbayPublishTask {
    this.database.prepare(`INSERT INTO ebay_publish_tasks (id,store_id,draft_id,listing_id,status,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(store_id,draft_id) DO UPDATE SET id=excluded.id,status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at`).run(task.id,task.storeId,task.draftId,task.listingId,task.status,JSON.stringify(task),task.createdAt,task.updatedAt)
    return task
  }

  getEbayAcceptanceBatches(storeId:string):EbayAcceptanceBatch[] {
    const rows=this.database.prepare(`SELECT payload FROM ebay_acceptance_batches WHERE store_id=? ORDER BY created_at DESC LIMIT 30`).all(storeId) as unknown as Array<{payload:string}>
    return rows.map(row=>JSON.parse(row.payload) as EbayAcceptanceBatch)
  }

  saveEbayAcceptanceBatch(batch:EbayAcceptanceBatch):EbayAcceptanceBatch {
    this.database.prepare(`INSERT INTO ebay_acceptance_batches (id,store_id,mode,status,payload,created_at) VALUES (?,?,?,?,?,?)`).run(batch.id,batch.storeId,batch.mode,batch.status,JSON.stringify(batch),batch.createdAt)
    return batch
  }

  saveEbayOptimizationDraft(input:EbayOptimizationDraftInput):EbayOptimizationDraft {
    const existing=this.database.prepare(`SELECT id,created_at FROM ebay_optimization_drafts WHERE store_id=? AND listing_id=?`).get(input.storeId,input.listingId) as {id:string;created_at:string}|undefined
    const now=new Date().toISOString()
    const draft:EbayOptimizationDraft={...input,id:existing?.id||crypto.randomUUID(),status:'PREMIUM',createdAt:existing?.created_at||now,updatedAt:now}
    this.database.prepare(`INSERT INTO ebay_optimization_drafts (id,store_id,listing_id,status,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(store_id,listing_id) DO UPDATE SET status=excluded.status,payload=excluded.payload,updated_at=excluded.updated_at`).run(draft.id,draft.storeId,draft.listingId,draft.status,JSON.stringify(draft),draft.createdAt,draft.updatedAt)
    return draft
  }

  validateEbayOptimizationDraft(draftId:string):EbayPublishComplianceValidation {
    const row=this.database.prepare(`SELECT payload FROM ebay_optimization_drafts WHERE id=?`).get(draftId) as {payload:string}|undefined
    if(!row)throw new Error('优品草稿不存在，请刷新后重试')
    const draft=JSON.parse(row.payload) as EbayOptimizationDraft
    const request:ComplianceCheckRequest={
      productId:draft.listing.id,
      platform:'EBAY',
      marketplaceSite:draft.listing.marketplaceId||'EBAY_US',
      country:ebayCountryForMarketplace(draft.listing.marketplaceId||'EBAY_US'),
      categoryId:draft.listing.categoryId,
      categoryName:draft.listing.categoryName,
      title:draft.selectedTitle,
      description:draft.description,
      imageUrl:draft.imageUrl,
      itemSpecifics:draft.itemSpecifics.map(item=>({name:item.name,value:item.value}))
    }
    const fingerprint=complianceCheckFingerprint(request)
    const latest=this.getLatestComplianceCheck(request.productId)
    const check=latest&&latest.inputFingerprint===fingerprint&&latest.gateStatus!=='RECHECK_REQUIRED'?latest:this.runComplianceCheck(request)
    const publishAllowed=check.gateStatus==='PASSED'||check.gateStatus==='REVIEW_REQUIRED'&&Boolean(check.reviewedAt)
    const permit=publishAllowed?this.issueComplianceReleasePermit(check.id):undefined
    if(permit)this.resolveComplianceEnforcementCases(request.productId,'最新合规结论有效并已续签发布许可')
    const updated:EbayOptimizationDraft={
      ...draft,
      complianceCheckId:check.id,
      complianceGateStatus:check.gateStatus,
      complianceRuleSetVersion:check.ruleSetVersion,
      complianceCheckedAt:check.checkedAt,
      complianceReviewedAt:check.reviewedAt,
      complianceInputFingerprint:check.inputFingerprint,
      updatedAt:new Date().toISOString()
    }
    this.database.prepare(`UPDATE ebay_optimization_drafts SET payload=?,updated_at=? WHERE id=?`).run(JSON.stringify(updated),updated.updatedAt,draftId)
    const reason=publishAllowed
      ?check.gateStatus==='PASSED'?'已通过最新规则与内容一致性检查，可进入发布确认。':'已完成最新规则检查和人工复核，可进入发布确认。'
      :check.gateStatus==='BLOCKED'?'存在禁止发布风险，必须整改或停止发布。':check.gateStatus==='REVIEW_REQUIRED'?'当前结论需要人工复核并留痕。':'规则或商品内容已变化，必须整改后重新检查。'
    return {draft:updated,check,permit,publishAllowed,reason}
  }

  getEbayMarketResearch(storeId:string,listingId:string):EbayMarketResearchSnapshot|undefined {
    const row=this.database.prepare(`SELECT payload FROM ebay_market_research WHERE store_id=? AND listing_id=?`).get(storeId,listingId) as {payload:string}|undefined
    return row?this.normalizeEbayMarketResearchSnapshot(JSON.parse(row.payload) as EbayMarketResearchSnapshot):undefined
  }

  getEbayMarketResearchHistory(storeId:string,listingId:string):EbayMarketResearchSnapshot[] {
    const rows=this.database.prepare(`SELECT payload FROM ebay_market_research_history WHERE store_id=? AND listing_id=? ORDER BY fetched_at DESC LIMIT 30`).all(storeId,listingId) as Array<{payload:string}>
    return rows.map(row=>this.normalizeEbayMarketResearchSnapshot(JSON.parse(row.payload) as EbayMarketResearchSnapshot)).filter((snapshot):snapshot is EbayMarketResearchSnapshot=>Boolean(snapshot))
  }

  private normalizeEbayMarketResearchSnapshot(snapshot:EbayMarketResearchSnapshot):EbayMarketResearchSnapshot|undefined {
    if(!['EBAY_PRODUCT_RESEARCH','EBAY_SOLD_SEARCH','OMKAR_EBAY_SCRAPER'].includes(snapshot.source))return undefined
    if(snapshot.captureMode&&!['MANUAL_RESEARCH_PAGE','AUTOMATIC'].includes(snapshot.captureMode))return undefined
    const valid=snapshot.samples.filter(item=>!/^(shop on ebay|sign in|register|see all|view item|research)$/i.test(item.title.trim()))
    const unique=new Map<string,EbayMarketResearchSnapshot['samples'][number]>()
    valid.forEach(item=>{const key=item.title.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();if(key&&!unique.has(key))unique.set(key,item)})
    const samples=[...unique.values()]
    const soldQuantityEvidenceCount=snapshot.soldQuantityEvidenceCount??samples.filter(item=>Number((item.soldQuantity||'').replace(/,/g,''))>0).length
    const rankingBasis=snapshot.rankingBasis||(soldQuantityEvidenceCount>=Math.min(5,Math.max(1,Math.ceil(samples.length*.1)))?'SOLD_QUANTITY':'EBAY_RESULT_ORDER')
    return {...snapshot,rawSampleCount:snapshot.rawSampleCount??snapshot.samples.length,samples,sampleCount:samples.length,analysisSampleCount:Math.min(snapshot.analysisSampleCount??30,samples.length),rankingBasis,soldQuantityEvidenceCount}
  }

  saveEbayMarketResearch(snapshot:EbayMarketResearchSnapshot):EbayMarketResearchSnapshot {
    this.database.prepare(`INSERT INTO ebay_market_research (id,store_id,listing_id,payload,fetched_at) VALUES (?,?,?,?,?) ON CONFLICT(store_id,listing_id) DO UPDATE SET id=excluded.id,payload=excluded.payload,fetched_at=excluded.fetched_at`).run(snapshot.id,snapshot.storeId,snapshot.listingId,JSON.stringify(snapshot),snapshot.fetchedAt)
    return snapshot
  }

  recordEbayMarketResearch(snapshot:EbayMarketResearchSnapshot):EbayMarketResearchSnapshot {
    const payload=JSON.stringify(snapshot)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`INSERT INTO ebay_market_research_history (id,store_id,listing_id,payload,fetched_at) VALUES (?,?,?,?,?)`).run(snapshot.id,snapshot.storeId,snapshot.listingId,payload,snapshot.fetchedAt)
      this.database.prepare(`INSERT INTO ebay_market_research (id,store_id,listing_id,payload,fetched_at) VALUES (?,?,?,?,?) ON CONFLICT(store_id,listing_id) DO UPDATE SET id=excluded.id,payload=excluded.payload,fetched_at=excluded.fetched_at`).run(snapshot.id,snapshot.storeId,snapshot.listingId,payload,snapshot.fetchedAt)
      this.database.exec('COMMIT')
      return snapshot
    } catch(error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  decideEbayMarketResearchTerm(request:EbayMarketResearchDecisionRequest):EbayMarketResearchSnapshot {
    const snapshot=this.getEbayMarketResearch(request.storeId,request.listingId)
    if(!snapshot)throw new Error('尚未获取当前商品的 eBay 市场数据')
    const key=request.kind==='KEYWORD'?'keywords':'combinations'
    const index=snapshot[key].findIndex(item=>item.term===request.term)
    if(index<0)throw new Error('当前市场词不存在，请重新获取市场数据')
    snapshot[key][index]={...snapshot[key][index],factStatus:request.status,factSource:request.status==='CONFIRMED'?'人工确认：与当前商品事实一致':request.status==='EXCLUDED'?'人工排除：不得用于当前商品标题':'市场成交词，需结合商品事实人工确认'}
    return this.saveEbayMarketResearch({...snapshot,id:crypto.randomUUID()})
  }

  createEbayStore(name:string,username:string,encryptedPassword:string,marketplaceId='EBAY_US'):EbayStore {
    const id=crypto.randomUUID(),now=new Date().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`INSERT INTO ebay_stores (id,name,seller_id,marketplace_id,status,created_at,updated_at) VALUES (?,?,?,?, 'PENDING',?,?)`).run(id,name,'待同步',marketplaceId,now,now)
      this.database.prepare(`INSERT INTO marketplace_account_credentials (account_id,platform_code,username,encrypted_password,automation_mode,updated_at) VALUES (?,?,?,?,?,?)`).run(`ebay:${id}`,'EBAY',username,encryptedPassword,'AUTO_FILL',now)
      this.database.exec('COMMIT')
    } catch(error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getEbayStores().find(store=>store.id===id)!
  }

  getEbayTokenRecord(storeId:string) {
    return this.database.prepare(`SELECT id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at FROM ebay_stores WHERE id=?`).get(storeId) as {id:string;encrypted_access_token:string;encrypted_refresh_token:string;access_token_expires_at:string;refresh_token_expires_at:string}|undefined
  }

  saveEbayAuthorization(storeId:string,input:{encryptedAccessToken:string;encryptedRefreshToken:string;accessTokenExpiresAt:string;refreshTokenExpiresAt:string}) {
    const now=new Date().toISOString()
    this.database.prepare(`UPDATE ebay_stores SET status='CONNECTED',encrypted_access_token=?,encrypted_refresh_token=?,access_token_expires_at=?,refresh_token_expires_at=?,sync_error=NULL,updated_at=? WHERE id=?`).run(input.encryptedAccessToken,input.encryptedRefreshToken,input.accessTokenExpiresAt,input.refreshTokenExpiresAt,now,storeId)
  }

  updateEbayAccessToken(storeId:string,encryptedAccessToken:string,expiresAt:string) {
    this.database.prepare(`UPDATE ebay_stores SET encrypted_access_token=?,access_token_expires_at=?,updated_at=? WHERE id=?`).run(encryptedAccessToken,expiresAt,new Date().toISOString(),storeId)
  }

  saveEbayListings(storeId:string,listings:EbayListing[]) {
    const save=this.database.prepare(`INSERT INTO ebay_listings (id,store_id,marketplace_id,listing_id,sku,title,price,currency,quantity,image_url,category_id,category_name,status,view_url,payload,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,title=excluded.title,price=excluded.price,currency=excluded.currency,quantity=excluded.quantity,image_url=excluded.image_url,category_id=excluded.category_id,category_name=excluded.category_name,status=excluded.status,view_url=excluded.view_url,payload=excluded.payload,updated_at=excluded.updated_at`)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`UPDATE ebay_listings SET status='ENDED',updated_at=? WHERE store_id=?`).run(new Date().toISOString(),storeId)
      listings.forEach(item=>{const canonical:EbayListing={...item,imageUrls:item.imageUrls?.length?item.imageUrls:(item.imageUrl?[item.imageUrl]:[]),originalTitle:item.originalTitle||item.title,originalTitleVerified:true,titleSource:'EBAY_API'};save.run(canonical.id,canonical.storeId,canonical.marketplaceId,canonical.listingId,canonical.sku,canonical.title,canonical.price,canonical.currency,canonical.quantity,canonical.imageUrl,canonical.categoryId,canonical.categoryName,canonical.status,canonical.viewUrl,JSON.stringify(canonical),canonical.updatedAt)})
      const now=new Date().toISOString();this.database.prepare(`UPDATE ebay_stores SET last_sync_at=?,sync_error=NULL,status='CONNECTED',updated_at=? WHERE id=?`).run(now,now,storeId)
      this.database.exec('COMMIT')
    } catch(error){this.database.exec('ROLLBACK');throw error}
  }

  upsertEbayListing(storeId:string,listing:EbayListing) {
    this.database.prepare(`INSERT INTO ebay_listings (id,store_id,marketplace_id,listing_id,sku,title,price,currency,quantity,image_url,category_id,category_name,status,view_url,payload,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,title=excluded.title,price=excluded.price,currency=excluded.currency,quantity=excluded.quantity,image_url=excluded.image_url,category_id=excluded.category_id,category_name=excluded.category_name,status='ACTIVE',view_url=excluded.view_url,payload=excluded.payload,updated_at=excluded.updated_at`)
      .run(listing.id,listing.storeId,listing.marketplaceId,listing.listingId,listing.sku,listing.title,listing.price,listing.currency,listing.quantity,listing.imageUrl,listing.categoryId,listing.categoryName,listing.status,listing.viewUrl,JSON.stringify(listing),listing.updatedAt)
  }

  importEbayListingsReport(storeId:string,listings:EbayListing[]) {
    const existing=new Set((this.database.prepare(`SELECT id FROM ebay_listings WHERE store_id=?`).all(storeId) as Array<{id:string}>).map(row=>row.id))
    const save=this.database.prepare(`INSERT INTO ebay_listings (id,store_id,marketplace_id,listing_id,sku,title,price,currency,quantity,image_url,category_id,category_name,status,view_url,payload,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,title=excluded.title,price=excluded.price,currency=excluded.currency,quantity=excluded.quantity,image_url=excluded.image_url,category_id=excluded.category_id,category_name=excluded.category_name,status='ACTIVE',view_url=excluded.view_url,payload=excluded.payload,updated_at=excluded.updated_at`)
    let imported=0,updated=0
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for(const item of listings){
        if(existing.has(item.id))updated+=1
        else {imported+=1;existing.add(item.id)}
        const canonical:EbayListing={...item,imageUrls:item.imageUrls?.length?item.imageUrls:(item.imageUrl?[item.imageUrl]:[]),originalTitle:item.originalTitle||item.title,originalTitleVerified:true,titleSource:'EBAY_REPORT'}
        save.run(canonical.id,canonical.storeId,canonical.marketplaceId,canonical.listingId,canonical.sku,canonical.title,canonical.price,canonical.currency,canonical.quantity,canonical.imageUrl,canonical.categoryId,canonical.categoryName,canonical.status,canonical.viewUrl,JSON.stringify(canonical),canonical.updatedAt)
      }
      const now=new Date().toISOString()
      this.database.prepare(`UPDATE ebay_stores SET last_sync_at=?,sync_error=NULL,updated_at=? WHERE id=?`).run(now,now,storeId)
      this.database.exec('COMMIT')
      return {imported,updated,total:Number((this.database.prepare(`SELECT COUNT(*) total FROM ebay_listings WHERE store_id=? AND status='ACTIVE'`).get(storeId) as {total:number}).total),importedAt:now}
    } catch(error){this.database.exec('ROLLBACK');throw error}
  }

  importEbayCollectedProducts(storeId:string,marketplaceId:string,products:EbayCollectedProduct[]) {
    const now=new Date().toISOString()
    const existing=new Map((this.database.prepare(`SELECT id,listing_id,payload FROM ebay_listings WHERE store_id=? AND status='ACTIVE'`).all(storeId) as Array<{id:string;listing_id:string;payload:string}>).map(row=>[row.listing_id,row]))
    const save=this.database.prepare(`INSERT INTO ebay_listings (id,store_id,marketplace_id,listing_id,sku,title,price,currency,quantity,image_url,category_id,category_name,status,view_url,payload,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET sku=excluded.sku,title=excluded.title,price=excluded.price,currency=excluded.currency,quantity=excluded.quantity,image_url=excluded.image_url,category_id=excluded.category_id,category_name=excluded.category_name,status='ACTIVE',view_url=excluded.view_url,payload=excluded.payload,updated_at=excluded.updated_at`)
    const refreshExisting=this.database.prepare(`UPDATE ebay_listings SET title=?,payload=?,updated_at=? WHERE id=?`)
    const categories=this.activeEbayCategories(storeId)
    let imported=0,duplicates=0
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for(const product of products){
        const sourceTitle=(product.originalTitle||product.title).trim()
        const existingRow=existing.get(product.listingId)
        if(existingRow){
          if(product.originalTitle&&product.originalTitleVerified){
            const payload=JSON.parse(existingRow.payload) as EbayListing
            const refreshed:EbayListing={...payload,title:sourceTitle,originalTitle:sourceTitle,translatedTitle:product.translatedTitle||payload.translatedTitle,originalTitleVerified:true,titleSource:product.titleSource,updatedAt:now}
            refreshExisting.run(refreshed.title,JSON.stringify(refreshed),now,existingRow.id)
          }
          duplicates+=1;continue
        }
        const matched=this.matchEbayCategory(categories,product.categoryId,product.categoryName,product.title)
        const categoryId=matched?.category_id||''
        const categoryName=matched?.name||''
        const item:EbayListing={id:`${storeId}:${marketplaceId}:${product.listingId}`,storeId,marketplaceId,listingId:product.listingId,sku:'',title:sourceTitle,originalTitle:product.originalTitleVerified?sourceTitle:undefined,translatedTitle:product.translatedTitle||'',originalTitleVerified:Boolean(product.originalTitleVerified),titleSource:product.titleSource||'UNVERIFIED_PAGE_TEXT',price:product.price,currency:product.currency,quantity:0,imageUrl:product.imageUrl,imageUrls:product.imageUrl?[product.imageUrl]:[],categoryId,categoryName,status:'ACTIVE',viewUrl:product.url,updatedAt:now}
        save.run(item.id,item.storeId,item.marketplaceId,item.listingId,item.sku,item.title,item.price,item.currency,item.quantity,item.imageUrl,item.categoryId,item.categoryName,item.status,item.viewUrl,JSON.stringify(item),item.updatedAt)
        existing.set(product.listingId,{id:item.id,listing_id:item.listingId,payload:JSON.stringify(item)});imported+=1
      }
      this.reconcileEbayListingCategories(storeId)
      this.database.prepare(`UPDATE ebay_stores SET updated_at=? WHERE id=?`).run(now,storeId)
      this.database.exec('COMMIT')
      const total=Number((this.database.prepare(`SELECT COUNT(*) total FROM ebay_listings WHERE store_id=? AND status='ACTIVE'`).get(storeId) as {total:number}).total)
      return {imported,duplicates,total}
    } catch(error){this.database.exec('ROLLBACK');throw error}
  }

  createEbayProductSyncCheckpoint(storeId:string,categoryIds:string[],publicStoreUrl:string) {
    const taskId=crypto.randomUUID(),now=new Date().toISOString()
    this.database.prepare(`INSERT INTO ebay_product_sync_checkpoints (task_id,store_id,status,category_ids,completed_category_ids,failed_category_ids,products,scans,public_store_url,started_at,updated_at) VALUES (?,?, 'RUNNING',?, '[]','[]','[]','[]',?,?,?)`).run(taskId,storeId,JSON.stringify(categoryIds),publicStoreUrl,now,now)
    return this.getEbayProductSyncCheckpointData(taskId)!
  }

  getEbayProductSyncCheckpointData(taskId:string) {
    const row=this.database.prepare(`SELECT * FROM ebay_product_sync_checkpoints WHERE task_id=?`).get(taskId) as Record<string,unknown>|undefined
    if(!row)return undefined
    return {
      taskId:String(row.task_id),storeId:String(row.store_id),status:String(row.status) as EbayDirectoryProductSyncCheckpoint['status'],
      categoryIds:JSON.parse(String(row.category_ids||'[]')) as string[],
      completedCategoryIds:JSON.parse(String(row.completed_category_ids||'[]')) as string[],
      failedCategoryIds:JSON.parse(String(row.failed_category_ids||'[]')) as string[],
      products:JSON.parse(String(row.products||'[]')) as EbayCollectedProduct[],
      scans:JSON.parse(String(row.scans||'[]')) as EbayDirectoryProductScanCategory[],
      publicStoreUrl:String(row.public_store_url||''),startedAt:String(row.started_at),updatedAt:String(row.updated_at)
    }
  }

  getPendingEbayProductSyncCheckpoint(storeId:string):EbayDirectoryProductSyncCheckpoint|undefined {
    const row=this.database.prepare(`SELECT task_id FROM ebay_product_sync_checkpoints WHERE store_id=? AND status IN ('RUNNING','PAUSED','INTERRUPTED','NEEDS_ATTENTION') ORDER BY updated_at DESC LIMIT 1`).get(storeId) as {task_id:string}|undefined
    const checkpoint=row?this.getEbayProductSyncCheckpointData(row.task_id):undefined
    if(!checkpoint)return undefined
    return {taskId:checkpoint.taskId,storeId:checkpoint.storeId,status:checkpoint.status,categoryIds:checkpoint.categoryIds,completedCategoryIds:checkpoint.completedCategoryIds,failedCategoryIds:checkpoint.failedCategoryIds,publicStoreUrl:checkpoint.publicStoreUrl,startedAt:checkpoint.startedAt,updatedAt:checkpoint.updatedAt}
  }

  saveEbayProductSyncCheckpointCategory(taskId:string,scan:EbayDirectoryProductScanCategory,products:EbayCollectedProduct[],publicStoreUrl:string) {
    const checkpoint=this.getEbayProductSyncCheckpointData(taskId)
    if(!checkpoint)return
    const productMap=new Map(checkpoint.products.map(item=>[item.listingId,item]))
    products.forEach(item=>productMap.set(item.listingId,item))
    const scans=[...checkpoint.scans.filter(item=>item.categoryId!==scan.categoryId),scan]
    const completed=scan.complete?[...new Set([...checkpoint.completedCategoryIds,scan.categoryId])]:checkpoint.completedCategoryIds.filter(id=>id!==scan.categoryId)
    const failed=scans.filter(item=>!item.complete).map(item=>item.categoryId)
    this.database.prepare(`UPDATE ebay_product_sync_checkpoints SET completed_category_ids=?,failed_category_ids=?,products=?,scans=?,public_store_url=?,updated_at=? WHERE task_id=?`).run(JSON.stringify(completed),JSON.stringify(failed),JSON.stringify([...productMap.values()]),JSON.stringify(scans),publicStoreUrl,new Date().toISOString(),taskId)
  }

  setEbayProductSyncCheckpointStatus(taskId:string,status:EbayDirectoryProductSyncCheckpoint['status']) {
    this.database.prepare(`UPDATE ebay_product_sync_checkpoints SET status=?,updated_at=? WHERE task_id=?`).run(status,new Date().toISOString(),taskId)
  }

  deleteEbayProductSyncCheckpoint(taskId:string) {
    this.database.prepare(`DELETE FROM ebay_product_sync_checkpoints WHERE task_id=?`).run(taskId)
  }

  syncEbayDirectoryProducts(storeId:string,marketplaceId:string,products:EbayCollectedProduct[],scans:EbayDirectoryProductScanCategory[],errors:string[]) {
    const now=new Date().toISOString()
    const runId=crypto.randomUUID()
    const rows=this.database.prepare(`SELECT id,listing_id,payload,status FROM ebay_listings WHERE store_id=?`).all(storeId) as Array<{id:string;listing_id:string;payload:string;status:string}>
    const existing=new Map(rows.map(row=>[row.listing_id,row]))
    const protectedListingIds=new Set((this.database.prepare(`SELECT listing_id FROM ebay_optimization_drafts WHERE store_id=?`).all(storeId) as Array<{listing_id:string}>).map(row=>row.listing_id))
    const protectedOptimizations=new Set<string>()
    const categories=this.activeEbayCategories(storeId)
    const save=this.database.prepare(`INSERT INTO ebay_listings (id,store_id,marketplace_id,listing_id,sku,title,price,currency,quantity,image_url,category_id,category_name,status,view_url,payload,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,price=excluded.price,currency=excluded.currency,image_url=excluded.image_url,category_id=excluded.category_id,category_name=excluded.category_name,status='ACTIVE',view_url=excluded.view_url,payload=excluded.payload,updated_at=excluded.updated_at`)
    const markEnded=this.database.prepare(`UPDATE ebay_listings SET status='ENDED',payload=?,updated_at=? WHERE id=?`)
    let imported=0,updated=0,unchanged=0,ended=0,reactivated=0,moved=0,suspectedEnded=0
    const changes:EbayProductSyncChange[]=[]
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for(const product of products) {
        const sourceTitle=(product.originalTitle||product.title).trim()
        const matched=this.matchEbayCategory(categories,product.categoryId,product.categoryName,sourceTitle)
        const categoryId=matched?.category_id||product.categoryId||''
        const categoryName=matched?.name||product.categoryName||''
        const previous=existing.get(product.listingId)
        let previousPayload:EbayListing|undefined
        if(previous) {
          try { previousPayload=JSON.parse(previous.payload) as EbayListing } catch { previousPayload=undefined }
        }
        const item:EbayListing={
          ...(previousPayload||{} as EbayListing),
          id:previous?.id||`${storeId}:${marketplaceId}:${product.listingId}`,
          storeId,marketplaceId,listingId:product.listingId,
          sku:previousPayload?.sku||'',
          title:sourceTitle,
          originalTitle:sourceTitle,
          translatedTitle:product.translatedTitle||previousPayload?.translatedTitle||'',
          originalTitleVerified:true,
          titleSource:'EBAY_STORE_LINK',
          price:product.price||previousPayload?.price||'',
          currency:product.currency||previousPayload?.currency||'USD',
          quantity:previousPayload?.quantity||0,
          imageUrl:product.imageUrl||previousPayload?.imageUrl||'',
          imageUrls:product.imageUrl?[product.imageUrl,...(previousPayload?.imageUrls||[]).filter(value=>value!==product.imageUrl)]:(previousPayload?.imageUrls||[]),
          categoryId,categoryName,status:'ACTIVE',
          viewUrl:product.url,
          updatedAt:now
        }
        const changed=!previousPayload
          || previous?.status!=='ACTIVE'
          || previousPayload.title!==item.title
          || previousPayload.price!==item.price
          || previousPayload.currency!==item.currency
          || previousPayload.imageUrl!==item.imageUrl
          || previousPayload.categoryId!==item.categoryId
          || previousPayload.viewUrl!==item.viewUrl
        const categoryMoved=Boolean(previousPayload?.categoryId&&item.categoryId&&previousPayload.categoryId!==item.categoryId)
        if(categoryMoved)moved+=1
        this.database.prepare(`DELETE FROM ebay_listing_absence_evidence WHERE store_id=? AND listing_id=?`).run(storeId,product.listingId)
        if(protectedListingIds.has(product.listingId))protectedOptimizations.add(product.listingId)
        if(!previous){imported+=1;changes.push({listingId:item.listingId,title:item.title,type:'IMPORTED',beforeCategory:'',afterCategory:item.categoryName})}
        else if(previous.status!=='ACTIVE'){reactivated+=1;changes.push({listingId:item.listingId,title:item.title,type:'REACTIVATED',beforeCategory:previousPayload?.categoryName||'',afterCategory:item.categoryName})}
        else if(changed){updated+=1;changes.push({listingId:item.listingId,title:item.title,type:categoryMoved?'MOVED':'UPDATED',beforeCategory:previousPayload?.categoryName||'',afterCategory:item.categoryName})}
        else unchanged+=1
        if(!previous||changed)save.run(item.id,item.storeId,item.marketplaceId,item.listingId,item.sku,item.title,item.price,item.currency,item.quantity,item.imageUrl,item.categoryId,item.categoryName,item.status,item.viewUrl,JSON.stringify(item),item.updatedAt)
        existing.set(product.listingId,{id:item.id,listing_id:item.listingId,payload:JSON.stringify(item),status:'ACTIVE'})
      }
      const endedListingIds=new Set<string>()
      for(const scan of scans.filter(item=>item.complete)) {
        const visibleListingIds=new Set(scan.listingIds)
        for(const row of existing.values()) {
          if(row.status!=='ACTIVE'||endedListingIds.has(row.listing_id)||visibleListingIds.has(row.listing_id))continue
          let payload:EbayListing|undefined
          try { payload=JSON.parse(row.payload) as EbayListing } catch { payload=undefined }
          if(payload?.categoryId!==scan.categoryId)continue
          const evidence=this.database.prepare(`SELECT consecutive_count FROM ebay_listing_absence_evidence WHERE store_id=? AND listing_id=?`).get(storeId,row.listing_id) as {consecutive_count:number}|undefined
          if((evidence?.consecutive_count||0)>=1) {
            const endedPayload:EbayListing={...payload,status:'ENDED',updatedAt:now}
            markEnded.run(JSON.stringify(endedPayload),now,row.id)
            this.database.prepare(`DELETE FROM ebay_listing_absence_evidence WHERE store_id=? AND listing_id=?`).run(storeId,row.listing_id)
            endedListingIds.add(row.listing_id)
            if(protectedListingIds.has(row.listing_id))protectedOptimizations.add(row.listing_id)
            ended+=1
            changes.push({listingId:row.listing_id,title:payload.title,type:'ENDED',beforeCategory:payload.categoryName,afterCategory:''})
          } else {
            this.database.prepare(`INSERT INTO ebay_listing_absence_evidence (store_id,listing_id,consecutive_count,last_missing_at) VALUES (?,?,1,?) ON CONFLICT(store_id,listing_id) DO UPDATE SET consecutive_count=ebay_listing_absence_evidence.consecutive_count+1,last_missing_at=excluded.last_missing_at`).run(storeId,row.listing_id,now)
            suspectedEnded+=1
            changes.push({listingId:row.listing_id,title:payload.title,type:'SUSPECTED_ENDED',beforeCategory:payload.categoryName,afterCategory:''})
          }
        }
      }
      this.reconcileEbayListingCategories(storeId)
      const total=Number((this.database.prepare(`SELECT COUNT(*) total FROM ebay_listings WHERE store_id=? AND status='ACTIVE'`).get(storeId) as {total:number}).total)
      const status:EbayProductSyncRun['status']=errors.length?'PARTIAL':'SUCCESS'
      this.database.prepare(`INSERT INTO ebay_product_sync_runs (id,store_id,mode,category_count,scanned_category_count,imported_count,updated_count,unchanged_count,ended_count,suspected_ended_count,moved_count,reactivated_count,protected_count,failed_count,total_count,status,errors,changes,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(runId,storeId,'INCREMENTAL',scans.length,scans.filter(item=>item.complete).length,imported,updated,unchanged,ended,suspectedEnded,moved,reactivated,protectedOptimizations.size,errors.length,total,status,JSON.stringify(errors),JSON.stringify(changes),now)
      this.database.prepare(`UPDATE ebay_stores SET last_sync_at=?,sync_error=?,updated_at=? WHERE id=?`).run(now,errors.length?errors.join('；'):null,now,storeId)
      this.database.exec('COMMIT')
      return {runId,storeId,mode:'INCREMENTAL' as const,categoryCount:scans.length,scannedCategoryCount:scans.filter(item=>item.complete).length,imported,updated,unchanged,ended,suspectedEnded,moved,reactivated,protectedOptimizations:protectedOptimizations.size,failed:errors.length,total,syncedAt:now,errors,changes}
    } catch(error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  recordEbayProductSyncFailure(storeId:string,categoryCount:number,errors:string[]) {
    const run:EbayProductSyncRun={id:crypto.randomUUID(),storeId,mode:'INCREMENTAL',categoryCount,scannedCategoryCount:0,imported:0,updated:0,unchanged:0,ended:0,suspectedEnded:0,moved:0,reactivated:0,protectedOptimizations:0,failed:Math.max(1,errors.length),total:Number((this.database.prepare(`SELECT COUNT(*) total FROM ebay_listings WHERE store_id=? AND status='ACTIVE'`).get(storeId) as {total:number}).total),status:'FAILED',errors,changes:[],syncedAt:new Date().toISOString()}
    this.database.prepare(`INSERT INTO ebay_product_sync_runs (id,store_id,mode,category_count,scanned_category_count,imported_count,updated_count,unchanged_count,ended_count,suspected_ended_count,moved_count,reactivated_count,protected_count,failed_count,total_count,status,errors,changes,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(run.id,run.storeId,run.mode,run.categoryCount,run.scannedCategoryCount,run.imported,run.updated,run.unchanged,run.ended,run.suspectedEnded,run.moved,run.reactivated,run.protectedOptimizations,run.failed,run.total,run.status,JSON.stringify(run.errors),JSON.stringify(run.changes),run.syncedAt)
    return run
  }

  getEbayProductSyncRuns(storeId:string):EbayProductSyncRun[] {
    const rows=this.database.prepare(`SELECT * FROM ebay_product_sync_runs WHERE store_id=? ORDER BY synced_at DESC LIMIT 20`).all(storeId) as Array<Record<string,unknown>>
    return rows.map(row=>({id:String(row.id),storeId:String(row.store_id),mode:'INCREMENTAL',categoryCount:Number(row.category_count),scannedCategoryCount:Number(row.scanned_category_count),imported:Number(row.imported_count),updated:Number(row.updated_count),unchanged:Number(row.unchanged_count),ended:Number(row.ended_count),suspectedEnded:Number(row.suspected_ended_count||0),moved:Number(row.moved_count||0),reactivated:Number(row.reactivated_count),protectedOptimizations:Number(row.protected_count),failed:Number(row.failed_count),total:Number(row.total_count),status:String(row.status) as EbayProductSyncRun['status'],errors:JSON.parse(String(row.errors||'[]')) as string[],changes:JSON.parse(String(row.changes||'[]')) as EbayProductSyncChange[],syncedAt:String(row.synced_at)}))
  }

  setEbaySyncError(storeId:string,message:string) { this.database.prepare(`UPDATE ebay_stores SET status='ERROR',sync_error=?,updated_at=? WHERE id=?`).run(message,new Date().toISOString(),storeId) }

  getEbayListings(storeId?:string):EbayListing[] {
    if(storeId&&storeId!=='all')this.reconcileEbayListingCategories(storeId)
    else {
      const stores=this.database.prepare(`SELECT id FROM ebay_stores`).all() as Array<{id:string}>
      stores.forEach(store=>this.reconcileEbayListingCategories(store.id))
    }
    const rows=(storeId&&storeId!=='all'?this.database.prepare(`SELECT payload FROM ebay_listings WHERE store_id=? AND status='ACTIVE' ORDER BY updated_at DESC`).all(storeId):this.database.prepare(`SELECT payload FROM ebay_listings WHERE status='ACTIVE' ORDER BY updated_at DESC`).all()) as unknown as Array<{payload:string}>
    return rows.map(row=>JSON.parse(row.payload) as EbayListing)
  }

  removeEbayListingLocal(storeId:string,listingId:string) {
    const row=this.database.prepare(`SELECT id FROM ebay_listings WHERE store_id=? AND listing_id=? AND status='ACTIVE'`).get(storeId,listingId) as {id:string}|undefined
    if(!row)throw new Error('线上产品不存在，或已从本地产品库移除')
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`DELETE FROM ebay_title_decisions WHERE store_id=? AND listing_id=?`).run(storeId,listingId)
      this.database.prepare(`DELETE FROM ebay_title_handoffs WHERE store_id=? AND listing_id=?`).run(storeId,listingId)
      this.database.prepare(`DELETE FROM ebay_listings WHERE id=?`).run(row.id)
      this.database.exec('COMMIT')
    } catch(error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return true
  }

  private activeEbayCategories(storeId:string) {
    return this.database.prepare(`SELECT category_id,name,listing_count FROM ebay_store_categories WHERE store_id=? AND status='ACTIVE' AND category_id NOT LIKE 'collected:%' ORDER BY level,sort_order`).all(storeId) as Array<{category_id:string;name:string;listing_count:number}>
  }

  private normalizeEbayCategoryName(value:string) {
    return value.toLocaleLowerCase().replace(/[\s·•_\-/\\]+/g,'').replace(/[()（）]/g,'').trim()
  }

  private matchEbayCategory(categories:Array<{category_id:string;name:string;listing_count:number}>,categoryId:string,categoryName:string,title:string) {
    const direct=categories.find(item=>item.category_id===categoryId)
    if(direct)return direct
    const normalizedName=this.normalizeEbayCategoryName(categoryName)
    if(normalizedName&&!/^\d+$/.test(normalizedName)&&!/^allitems$|^全部物品$/.test(normalizedName)) {
      const byName=categories.find(item=>this.normalizeEbayCategoryName(item.name)===normalizedName)
      if(byName)return byName
    }
    const normalizedTitle=this.normalizeEbayCategoryName(title)
    const byTitle=categories.filter(item=>{const name=this.normalizeEbayCategoryName(item.name);return name.length>=3&&normalizedTitle.includes(name)})
    if(byTitle.length===1)return byTitle[0]
    const populated=categories.filter(item=>Number(item.listing_count)>0)
    if(populated.length===1)return populated[0]
    if(categories.length===1)return categories[0]
    return undefined
  }

  private reconcileEbayListingCategories(storeId:string) {
    const categories=this.activeEbayCategories(storeId)
    if(!categories.length)return 0
    const rows=this.database.prepare(`SELECT id,category_id,category_name,title,payload FROM ebay_listings WHERE store_id=? AND status='ACTIVE'`).all(storeId) as Array<{id:string;category_id:string;category_name:string;title:string;payload:string}>
    const update=this.database.prepare(`UPDATE ebay_listings SET category_id=?,category_name=?,payload=?,updated_at=? WHERE id=?`)
    let changed=0
    for(const row of rows) {
      const matched=this.matchEbayCategory(categories,row.category_id,row.category_name,row.title)
      if(!matched||row.category_id===matched.category_id&&row.category_name===matched.name)continue
      let payload:Record<string,unknown>
      try { payload=JSON.parse(row.payload) as Record<string,unknown> } catch { payload={} }
      payload.categoryId=matched.category_id
      payload.categoryName=matched.name
      const updatedAt=new Date().toISOString()
      payload.updatedAt=updatedAt
      update.run(matched.category_id,matched.name,JSON.stringify(payload),updatedAt,row.id)
      changed+=1
    }
    if(changed)this.database.prepare(`DELETE FROM ebay_store_categories WHERE store_id=? AND category_id LIKE 'collected:%'`).run(storeId)
    return changed
  }

  updateEbayListingCategory(storeId:string,listingId:string,categoryId:string):EbayListing {
    const category=this.database.prepare(`SELECT category_id,name FROM ebay_store_categories WHERE store_id=? AND category_id=? AND status='ACTIVE' AND category_id NOT LIKE 'collected:%'`).get(storeId,categoryId) as {category_id:string;name:string}|undefined
    if(!category)throw new Error('所选eBay店铺目录不存在，请先重新同步目录')
    const row=this.database.prepare(`SELECT id,payload FROM ebay_listings WHERE store_id=? AND listing_id=? AND status='ACTIVE'`).get(storeId,listingId) as {id:string;payload:string}|undefined
    if(!row)throw new Error('线上产品不存在或已经下架')
    const now=new Date().toISOString()
    let payload:Record<string,unknown>
    try { payload=JSON.parse(row.payload) as Record<string,unknown> } catch { payload={} }
    payload.categoryId=category.category_id;payload.categoryName=category.name;payload.updatedAt=now
    this.database.prepare(`UPDATE ebay_listings SET category_id=?,category_name=?,payload=?,updated_at=? WHERE id=?`).run(category.category_id,category.name,JSON.stringify(payload),now,row.id)
    return payload as unknown as EbayListing
  }

  updateEbayListingDetails(storeId:string,listingId:string,details:EbayProductDetails):EbayListing {
    const row=this.database.prepare(`SELECT id,payload FROM ebay_listings WHERE store_id=? AND listing_id=? AND status='ACTIVE'`).get(storeId,listingId) as {id:string;payload:string}|undefined
    if(!row)throw new Error('线上产品不存在或已经下架')
    const now=new Date().toISOString()
    let payload:Record<string,unknown>
    try { payload=JSON.parse(row.payload) as Record<string,unknown> } catch { payload={} }
    payload.itemSpecifics=details.itemSpecifics
    payload.condition=details.condition
    const previousImages=Array.isArray(payload.imageUrls)?payload.imageUrls.filter(value=>typeof value==='string'&&value):[]
    const currentImage=typeof payload.imageUrl==='string'&&payload.imageUrl?payload.imageUrl:''
    const imageUrls=uniqueEbayImages([...details.imageUrls,...previousImages,currentImage])
    payload.imageUrls=imageUrls
    if(imageUrls[0])payload.imageUrl=imageUrls[0]
    const livePrice=String(details.price||'').replace(/[^0-9.,-]/g,'').replace(/,/g,'')
    if(Number.isFinite(Number(livePrice))&&Number(livePrice)>0)payload.price=livePrice
    if(details.currency?.trim())payload.currency=details.currency.trim().toUpperCase()
    payload.updatedAt=now
    this.database.prepare(`UPDATE ebay_listings SET price=?,currency=?,image_url=?,payload=?,updated_at=? WHERE id=?`).run(String(payload.price||''),String(payload.currency||'USD'),String(payload.imageUrl||''),JSON.stringify(payload),now,row.id)
    return payload as unknown as EbayListing
  }

  getEbayLocalProducts(storeId?:string):EbayLocalProduct[] {
    const rows=(storeId&&storeId!=='all'
      ?this.database.prepare(`SELECT p.*,s.payload snapshot_payload FROM ebay_local_products p JOIN ebay_local_product_snapshots s ON s.id=p.latest_snapshot_id WHERE p.store_id=? ORDER BY p.updated_at DESC`).all(storeId)
      :this.database.prepare(`SELECT p.*,s.payload snapshot_payload FROM ebay_local_products p JOIN ebay_local_product_snapshots s ON s.id=p.latest_snapshot_id ORDER BY p.updated_at DESC`).all()) as unknown as Array<Record<string,unknown>>
    return rows.map(row=>({
      id:String(row.id),
      storeId:String(row.store_id),
      marketplaceId:String(row.marketplace_id),
      listingId:String(row.listing_id),
      categoryId:String(row.category_id),
      categoryName:String(row.category_name),
      title:String(row.title),
      status:String(row.status) as EbayLocalProduct['status'],
      versionCount:Number(row.version_count),
      latestSnapshotId:String(row.latest_snapshot_id),
      downloadedAt:String(row.downloaded_at),
      updatedAt:String(row.updated_at),
      snapshot:JSON.parse(String(row.snapshot_payload)) as EbayLocalProductSnapshot
    }))
  }

  getEbayLocalProductSnapshots(localProductId:string):EbayLocalProductSnapshot[] {
    const rows=this.database.prepare(`SELECT payload FROM ebay_local_product_snapshots WHERE local_product_id=? ORDER BY version DESC`).all(localProductId) as Array<{payload:string}>
    return rows.map(row=>JSON.parse(row.payload) as EbayLocalProductSnapshot)
  }

  getEbayImageVisualInspection(localProductId:string):EbayImageVisualInspectionReport|null {
    const product=this.database.prepare(`SELECT latest_snapshot_id FROM ebay_local_products WHERE id=?`).get(localProductId) as {latest_snapshot_id:string}|undefined
    if(!product)return null
    const snapshot=this.database.prepare(`SELECT content_hash FROM ebay_local_product_snapshots WHERE id=? AND local_product_id=?`).get(product.latest_snapshot_id,localProductId) as {content_hash:string}|undefined
    if(!snapshot)return null
    const row=this.database.prepare(`SELECT report_json FROM ebay_image_visual_inspections WHERE local_product_id=? AND snapshot_id=? AND content_hash=? ORDER BY checked_at DESC LIMIT 1`).get(localProductId,product.latest_snapshot_id,snapshot.content_hash) as {report_json:string}|undefined
    return row?JSON.parse(row.report_json) as EbayImageVisualInspectionReport:null
  }

  saveEbayImageVisualInspection(localProductId:string,snapshot:EbayLocalProductSnapshot,report:EbayImageVisualInspectionReport):EbayImageVisualInspectionReport {
    const current=this.database.prepare(`SELECT latest_snapshot_id FROM ebay_local_products WHERE id=?`).get(localProductId) as {latest_snapshot_id:string}|undefined
    if(!current||current.latest_snapshot_id!==snapshot.id)throw new Error('本地产品内容已变化，请按最新版本重新检查')
    const id=crypto.randomUUID()
    this.database.prepare(`INSERT INTO ebay_image_visual_inspections (id,local_product_id,snapshot_id,content_hash,status,report_json,checked_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(id,localProductId,snapshot.id,snapshot.contentHash,report.status,JSON.stringify(report),report.checkedAt,report.checkedAt)
    return report
  }

  reviewEbayImageVisualRule(input:EbayImageVisualReviewInput):EbayImageVisualInspectionReport {
    const product=this.database.prepare(`SELECT latest_snapshot_id FROM ebay_local_products WHERE id=?`).get(input.localProductId) as {latest_snapshot_id:string}|undefined
    if(!product)throw new Error('本地产品不存在或已删除')
    const snapshot=this.database.prepare(`SELECT content_hash FROM ebay_local_product_snapshots WHERE id=? AND local_product_id=?`).get(product.latest_snapshot_id,input.localProductId) as {content_hash:string}|undefined
    if(!snapshot)throw new Error('本地产品快照不存在')
    const row=this.database.prepare(`SELECT id,report_json FROM ebay_image_visual_inspections WHERE local_product_id=? AND snapshot_id=? AND content_hash=? ORDER BY checked_at DESC LIMIT 1`).get(input.localProductId,product.latest_snapshot_id,snapshot.content_hash) as {id:string;report_json:string}|undefined
    if(!row)throw new Error('当前本地产品版本尚未执行图片内容检查')
    const report=JSON.parse(row.report_json) as EbayImageVisualInspectionReport
    const image=report.images.find(item=>item.mediaId===input.mediaId)
    const rule=image?.rules.find(item=>item.rule===input.rule)
    if(!image||!rule)throw new Error('待复核图片规则不存在')
    if(rule.status!=='REVIEW'&&!rule.manualReview)throw new Error('只有人工复核项可以手动确认')
    const reviewedAt=new Date().toISOString()
    rule.modelStatus=rule.modelStatus||rule.status
    rule.status=input.decision
    rule.manualReview={decision:input.decision,reviewedAt,reviewedBy:input.reviewedBy.trim()||'本机用户',note:input.note.trim()||'人工查看原图后确认'}
    const updated=rebuildEbayImageVisualReport(report)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`UPDATE ebay_image_visual_inspections SET status=?,report_json=?,updated_at=? WHERE id=?`).run(updated.status,JSON.stringify(updated),reviewedAt,row.id)
      this.database.prepare(`INSERT INTO ebay_image_visual_review_events (id,inspection_id,media_id,rule_code,decision,reviewed_by,review_note,reviewed_at) VALUES (?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(),row.id,input.mediaId,input.rule,input.decision,rule.manualReview.reviewedBy,rule.manualReview.note,reviewedAt)
      this.database.exec('COMMIT')
    } catch(error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return updated
  }

  saveEbayLocalProductSnapshot(input:EbayLocalProductSnapshotInput):EbayLocalProduct {
    const listing=input.listing
    const existing=this.database.prepare(`SELECT id,version_count FROM ebay_local_products WHERE store_id=? AND marketplace_id=? AND listing_id=?`).get(listing.storeId,listing.marketplaceId,listing.listingId) as {id:string;version_count:number}|undefined
    const localProductId=existing?.id||crypto.randomUUID()
    const snapshotId=crypto.randomUUID()
    const version=(existing?.version_count||0)+1
    const status:EbayLocalProduct['status']=input.completeness>=80?'READY':'INCOMPLETE'
    const snapshot:EbayLocalProductSnapshot={
      id:snapshotId,
      localProductId,
      version,
      sourceListing:listing,
      details:input.details,
      media:input.media,
      completeness:input.completeness,
      missingFields:input.missingFields,
      contentHash:input.contentHash,
      capturedAt:input.capturedAt
    }
    this.database.exec('BEGIN IMMEDIATE')
    try {
      this.database.prepare(`INSERT INTO ebay_local_products (id,store_id,marketplace_id,listing_id,category_id,category_name,title,status,version_count,latest_snapshot_id,downloaded_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(store_id,marketplace_id,listing_id) DO UPDATE SET category_id=excluded.category_id,category_name=excluded.category_name,title=excluded.title,status=excluded.status,version_count=excluded.version_count,latest_snapshot_id=excluded.latest_snapshot_id,downloaded_at=excluded.downloaded_at,updated_at=excluded.updated_at`).run(localProductId,listing.storeId,listing.marketplaceId,listing.listingId,listing.categoryId,listing.categoryName,listing.title,status,version,snapshotId,input.capturedAt,input.capturedAt)
      this.database.prepare(`INSERT INTO ebay_local_product_snapshots (id,local_product_id,version,payload,content_hash,captured_at) VALUES (?,?,?,?,?,?)`).run(snapshotId,localProductId,version,JSON.stringify(snapshot),input.contentHash,input.capturedAt)
      const insertMedia=this.database.prepare(`INSERT INTO ebay_local_product_media (id,snapshot_id,media_type,sort_order,remote_url,local_path,mime_type,width,height,file_size,sha256,download_status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      for(const media of input.media)insertMedia.run(media.id,snapshotId,media.mediaType,media.sortOrder,media.remoteUrl,media.localPath,media.mimeType,media.width,media.height,media.fileSize||0,media.sha256,media.downloadStatus)
      this.database.exec('COMMIT')
    } catch(error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getEbayLocalProducts(listing.storeId).find(item=>item.id===localProductId)!
  }

  removeEbayLocalProduct(localProductId:string) {
    const result=this.database.prepare(`DELETE FROM ebay_local_products WHERE id=?`).run(localProductId)
    if(!result.changes)throw new Error('本地产品不存在或已删除')
    return true
  }

  getEbayCategoryWorkspace(storeId:string):EbayCategoryWorkspace {
    const rows=this.database.prepare(`SELECT store_id,category_id,name,parent_category_id,level,child_count,listing_count,sort_order,status,synced_at FROM ebay_store_categories WHERE store_id=? AND status='ACTIVE' ORDER BY level,sort_order`).all(storeId) as unknown as Array<Record<string,unknown>>
    const categories:EbayStoreCategory[]=rows.map(row=>({storeId:String(row.store_id),categoryId:String(row.category_id),name:String(row.name),parentCategoryId:String(row.parent_category_id),level:Number(row.level),childCount:Number(row.child_count),listingCount:Number(row.listing_count),sortOrder:Number(row.sort_order),status:'ACTIVE',syncedAt:String(row.synced_at)}))
    const run=this.database.prepare(`SELECT total_count,added_count,renamed_count,moved_count,removed_count,reordered_count,changes,synced_at FROM ebay_category_sync_runs WHERE store_id=? ORDER BY synced_at DESC LIMIT 1`).get(storeId) as Record<string,unknown>|undefined
    const lastSync:EbayCategorySyncSummary|undefined=run?{storeId,total:Number(run.total_count),added:Number(run.added_count),renamed:Number(run.renamed_count),moved:Number(run.moved_count),removed:Number(run.removed_count),reordered:Number(run.reordered_count),changes:JSON.parse(String(run.changes||'[]')) as EbayCategoryChange[],syncedAt:String(run.synced_at)}:undefined
    return {categories,lastSync}
  }

  saveEbayStoreCategories(storeId:string,categories:EbayStoreCategory[]):EbayCategoryWorkspace {
    if(!categories.length)throw new Error('eBay店铺目录为空，已取消写入')
    const existingRows=this.database.prepare(`SELECT category_id,name,parent_category_id,sort_order,status FROM ebay_store_categories WHERE store_id=?`).all(storeId) as unknown as Array<Record<string,unknown>>
    const existing=new Map(existingRows.map(row=>[String(row.category_id),row]))
    const remoteIds=new Set(categories.map(item=>item.categoryId))
    const changes:EbayCategoryChange[]=[]
    let added=0,renamed=0,moved=0,removed=0,reordered=0
    for(const item of categories) {
      const previous=existing.get(item.categoryId)
      if(!previous||String(previous.status)==='REMOVED') { added+=1;changes.push({type:'ADDED',categoryId:item.categoryId,beforeName:'',afterName:item.name});continue }
      if(String(previous.name)!==item.name) { renamed+=1;changes.push({type:'RENAMED',categoryId:item.categoryId,beforeName:String(previous.name),afterName:item.name}) }
      if(String(previous.parent_category_id)!==item.parentCategoryId) { moved+=1;changes.push({type:'MOVED',categoryId:item.categoryId,beforeName:String(previous.name),afterName:item.name}) }
      if(Number(previous.sort_order)!==item.sortOrder) { reordered+=1;changes.push({type:'REORDERED',categoryId:item.categoryId,beforeName:item.name,afterName:item.name}) }
    }
    for(const previous of existingRows) if(String(previous.status)==='ACTIVE'&&!String(previous.category_id).startsWith('collected:')&&!remoteIds.has(String(previous.category_id))) { removed+=1;changes.push({type:'REMOVED',categoryId:String(previous.category_id),beforeName:String(previous.name),afterName:''}) }
    const now=new Date().toISOString()
    const save=this.database.prepare(`INSERT INTO ebay_store_categories (store_id,category_id,name,parent_category_id,level,child_count,listing_count,sort_order,status,synced_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'ACTIVE',?,?) ON CONFLICT(store_id,category_id) DO UPDATE SET name=excluded.name,parent_category_id=excluded.parent_category_id,level=excluded.level,child_count=excluded.child_count,listing_count=excluded.listing_count,sort_order=excluded.sort_order,status='ACTIVE',synced_at=excluded.synced_at,updated_at=excluded.updated_at`)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      for(const item of categories)save.run(storeId,item.categoryId,item.name,item.parentCategoryId,item.level,item.childCount,item.listingCount,item.sortOrder,now,now)
      this.database.prepare(`UPDATE ebay_store_categories SET status='REMOVED',synced_at=?,updated_at=? WHERE store_id=? AND status='ACTIVE' AND category_id NOT LIKE 'collected:%' AND category_id NOT IN (${categories.map(()=>'?').join(',')})`).run(now,now,storeId,...categories.map(item=>item.categoryId))
      this.database.prepare(`INSERT INTO ebay_category_sync_runs (id,store_id,total_count,added_count,renamed_count,moved_count,removed_count,reordered_count,changes,synced_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(),storeId,categories.length,added,renamed,moved,removed,reordered,JSON.stringify(changes),now)
      this.reconcileEbayListingCategories(storeId)
      this.database.exec('COMMIT')
    } catch(error) { this.database.exec('ROLLBACK');throw error }
    return this.getEbayCategoryWorkspace(storeId)
  }


  saveProducts(taskId: string, products: CollectedOzonProduct[]) {
    const task = this.getTask(taskId)
    if (!task) throw new Error('保存跨境候选失败：任务不存在')
    const insert = this.database.prepare(`
      INSERT INTO market_candidates (platform_code, product_id, url, first_task_id, latest_task_id, payload, collected_at, updated_at)
      VALUES ('OZON', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(platform_code, url) DO UPDATE SET
        product_id = excluded.product_id,
        latest_task_id = excluded.latest_task_id,
        payload = excluded.payload,
        updated_at = excluded.updated_at,
        deleted_at = NULL
    `)
    const exists = this.database.prepare(`SELECT 1 FROM market_candidates WHERE platform_code = 'OZON' AND url = ?`)
    const saveRun = this.database.prepare(`INSERT INTO candidate_collection_runs (id, task_id, candidate_area, platform_code, collection_method, source_entry, requested_count, collected_count, new_count, updated_count, selected_count, status, started_at, completed_at) VALUES (?, ?, 'MARKET', 'OZON', ?, ?, ?, ?, ?, ?, 0, 'COMPLETED', ?, ?) ON CONFLICT(id) DO UPDATE SET collected_count=excluded.collected_count, new_count=excluded.new_count, updated_count=excluded.updated_count, status='COMPLETED', completed_at=excluded.completed_at`)
    const removeRecords = this.database.prepare(`DELETE FROM candidate_collection_records WHERE collection_run_id = ?`)
    const saveRecord = this.database.prepare(`INSERT INTO candidate_collection_records (candidate_area, candidate_key, collection_run_id, platform_code, collection_method, source_entry, source_rank, collected_at) VALUES ('MARKET', ?, ?, 'OZON', ?, ?, ?, ?)`)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const now = new Date().toISOString()
      const updatedCount = products.filter(product => Boolean(exists.get(product.url))).length
      products.forEach(product => insert.run(product.productId || '', product.url, taskId, taskId, JSON.stringify(product), now, now))
      const sourceEntry = task.collectionMethod === 'KEYWORD' ? task.keyword : task.sourceUrl
      saveRun.run(taskId, taskId, task.collectionMethod, sourceEntry, task.maxProducts, products.length, products.length - updatedCount, updatedCount, task.createdAt, now)
      removeRecords.run(taskId)
      products.forEach((product, index) => saveRecord.run(`OZON:${product.url}`, taskId, task.collectionMethod, sourceEntry, index, now))
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  saveSupplyProducts(taskId: string, products: CollectedSupplyProduct[]) {
    const task = this.getTask(taskId)
    if (!task) throw new Error('保存供应链候选失败：任务不存在')
    const remove = this.database.prepare('DELETE FROM supply_candidates WHERE task_id = ?')
    const insert = this.database.prepare(`INSERT INTO supply_candidates (task_id, url, payload, score, selected, sort_order) VALUES (?, ?, ?, ?, ?, ?)`)
    const removeEvaluations = this.database.prepare('DELETE FROM product_evaluations WHERE task_id = ?')
    const insertEvaluation = this.database.prepare(`INSERT INTO product_evaluations (id, task_id, product_url, total_score, grade, data_completeness, dimension_scores, recommendation, evaluated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const removeRejections = this.database.prepare('DELETE FROM product_rejection_records WHERE task_id = ?')
    const insertEvidence = this.database.prepare(`INSERT INTO evaluation_evidence (id, evaluation_id, dimension_code, evidence_type, source_url, content, score_effect) VALUES (?, ?, ?, 'DOM_TEXT', ?, ?, ?)`)
    const insertRisk = this.database.prepare(`INSERT INTO product_risk_flags (id, evaluation_id, risk_code, severity, detail) VALUES (?, ?, ?, 'MEDIUM', ?)`)
    const insertRejection = this.database.prepare(`INSERT INTO product_rejection_records (id, task_id, product_url, reason_code, reason, created_at) VALUES (?, ?, ?, 'RULE_NOT_MET', ?, ?)`)
    const exists = this.database.prepare(`SELECT 1 FROM supply_candidates WHERE url = ? AND task_id <> ? LIMIT 1`)
    const saveRun = this.database.prepare(`INSERT INTO candidate_collection_runs (id, task_id, candidate_area, platform_code, collection_method, source_entry, requested_count, collected_count, new_count, updated_count, selected_count, status, started_at, completed_at) VALUES (?, ?, 'SUPPLY', ?, ?, ?, ?, ?, ?, ?, ?, 'COMPLETED', ?, ?) ON CONFLICT(id) DO UPDATE SET collected_count=excluded.collected_count, new_count=excluded.new_count, updated_count=excluded.updated_count, selected_count=excluded.selected_count, status='COMPLETED', completed_at=excluded.completed_at`)
    const removeRecords = this.database.prepare(`DELETE FROM candidate_collection_records WHERE collection_run_id = ?`)
    const saveRecord = this.database.prepare(`INSERT INTO candidate_collection_records (candidate_area, candidate_key, collection_run_id, platform_code, collection_method, source_entry, source_rank, collected_at) VALUES ('SUPPLY', ?, ?, ?, ?, ?, ?, ?)`)
    this.database.exec('BEGIN IMMEDIATE')
    try {
      const now = new Date().toISOString()
      const updatedCount = products.filter(product => Boolean(exists.get(product.url, taskId))).length
      remove.run(taskId)
      removeEvaluations.run(taskId)
      removeRejections.run(taskId)
      products.forEach((product, index) => {
        insert.run(taskId, product.url, JSON.stringify(product), product.score, product.selected ? 1 : 0, index)
        const evaluationId = crypto.randomUUID()
        insertEvaluation.run(evaluationId, taskId, product.url, product.score, product.grade, product.dataCompleteness / 100, JSON.stringify(product.dimensionScores), product.recommendation, now)
        Object.entries(product.dimensionScores).forEach(([code, score]) => insertEvidence.run(crypto.randomUUID(), evaluationId, code, product.url, JSON.stringify({ supplierBadges: product.supplierBadges, categoryTopRank: product.categoryTopRank, returnRate: product.returnRate, networkSalesCount: product.networkSalesCount, serviceRating: product.serviceRating }), score))
        product.riskFlags.forEach((risk, riskIndex) => insertRisk.run(crypto.randomUUID(), evaluationId, `RISK_${riskIndex + 1}`, risk))
        if (!product.selected) insertRejection.run(crypto.randomUUID(), taskId, product.url, product.recommendation, now)
      })
      const platformCode = task.supplyPlatforms[0] || '1688'
      const sourceEntry = task.collectionMethod === 'KEYWORD' ? task.keyword : task.sourceUrl
      saveRun.run(taskId, taskId, platformCode, task.collectionMethod, sourceEntry, task.maxProducts, products.length, products.length - updatedCount, updatedCount, products.filter(product => product.selected).length, task.createdAt, now)
      removeRecords.run(taskId)
      products.forEach((product, index) => saveRecord.run(`${product.platformCode}:${product.url}`, taskId, product.platformCode, task.collectionMethod, sourceEntry, index, now))
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
  }

  importPluginSupplyCandidates(task: SelectionTask, products: CollectedSupplyProduct[]): CollectorPluginImportResult {
    if (!products.length) return { imported:0, updated:0, total:0, blocked:0, duplicates:[] }
    const duplicates:CollectorDuplicateProduct[] = []
    const accepted:CollectedSupplyProduct[] = []
    const incoming = new Set<string>()
    products.forEach(product=>{
      const identity=this.intakeIdentity(product.platformCode,product.productId,product.url)
      const duplicate=this.duplicateForProduct(product)
      if(duplicate)duplicates.push(duplicate)
      else if(incoming.has(identity))duplicates.push({platformCode:product.platformCode,productId:product.productId,title:product.title,stage:'CANDIDATE',message:'本次选择中存在重复商品'})
      else{incoming.add(identity);accepted.push(product)}
    })
    if(!accepted.length){
      const row=this.database.prepare(`SELECT COUNT(DISTINCT url) AS total FROM supply_candidates WHERE deleted_at IS NULL AND COALESCE(json_extract(payload, '$.platformCode'), '1688') = ?`).get(task.supplyPlatforms[0]) as {total:number}
      return {imported:0,updated:0,total:Number(row.total),blocked:duplicates.length,duplicates}
    }
    this.saveTask(task)
    const existingPayloads = this.database.prepare(`SELECT payload FROM supply_candidates WHERE url = ? AND COALESCE(json_extract(payload, '$.platformCode'), '1688') = ? ORDER BY rowid DESC`)
    const upsert = this.database.prepare(`
      INSERT INTO supply_candidates (task_id, url, payload, score, selected, sort_order, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(task_id, url) DO UPDATE SET
        payload = excluded.payload, score = excluded.score, selected = excluded.selected,
        sort_order = excluded.sort_order, deleted_at = NULL
    `)
    const saveRun = this.database.prepare(`INSERT INTO candidate_collection_runs (id, task_id, candidate_area, platform_code, collection_method, source_entry, requested_count, collected_count, new_count, updated_count, selected_count, status, started_at, completed_at) VALUES (?, ?, 'SUPPLY', ?, 'PRODUCT_URL', '内置选择采集', ?, ?, ?, ?, 0, 'COMPLETED', ?, ?)`)
    const saveRecord = this.database.prepare(`INSERT INTO candidate_collection_records (candidate_area, candidate_key, collection_run_id, platform_code, collection_method, source_entry, source_rank, collected_at) VALUES ('SUPPLY', ?, ?, ?, 'PRODUCT_URL', '内置选择采集', ?, ?)`)
    const totalForPlatform = this.database.prepare(`SELECT COUNT(DISTINCT url) AS total FROM supply_candidates WHERE deleted_at IS NULL AND COALESCE(json_extract(payload, '$.platformCode'), '1688') = ?`)
    const updated = 0
    const now = new Date().toISOString()
    const runId = crypto.randomUUID()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      accepted.forEach((product, index) => {
        let imageUrl = product.imageUrl
        const previousProducts = (existingPayloads.all(product.url, product.platformCode) as Array<{ payload: string }>)
          .map(row => JSON.parse(row.payload) as CollectedSupplyProduct)
        if (!isUsableCandidateImage(imageUrl)) {
          const existing = previousProducts
            .map(item => item.imageUrl)
            .find(isUsableCandidateImage)
          if (existing) imageUrl = existing
        }
        const previousCategory = previousProducts.map(item => item.sourceCategory).find(Boolean)
        const categoryRank = (status?: string) => status === 'EXACT' ? 3 : status === 'PARTIAL' ? 2 : status === 'NEEDS_REVIEW' ? 1 : 0
        const sourceCategory = categoryRank(previousCategory?.status) > categoryRank(product.sourceCategory?.status) ? previousCategory : product.sourceCategory
        const savedProduct = { ...product, imageUrl, sourceCategory }
        upsert.run(task.id, product.url, JSON.stringify(savedProduct), product.score, 0, index)
        this.registerProductIntake(product.platformCode,product.productId,product.url,product.title,'CANDIDATE',now)
      })
      saveRun.run(runId, task.id, task.supplyPlatforms[0], products.length, accepted.length, accepted.length, 0, now, now)
      accepted.forEach((product, index) => saveRecord.run(`${product.platformCode}:${product.url}`, runId, product.platformCode, index, now))
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    const row = totalForPlatform.get(task.supplyPlatforms[0]) as { total: number }
    return { imported:accepted.length, updated:0, total:Number(row.total), blocked:duplicates.length, duplicates }
  }

  getLatestWorkspace(): PersistedWorkspace | null {
    const row = this.database.prepare(`
      SELECT payload, stage FROM selection_tasks ORDER BY created_at DESC LIMIT 1
    `).get() as { payload: string; stage: SelectionTask['stage'] } | undefined
    if (!row) return null
    const task = JSON.parse(row.payload) as SelectionTask
    task.stage = row.stage
    const productRows = this.database.prepare(`SELECT payload FROM market_candidates WHERE latest_task_id = ? ORDER BY updated_at DESC`).all(task.id) as Array<{ payload: string }>
    const supplyRows = this.database.prepare(`SELECT payload FROM supply_candidates WHERE task_id = ? ORDER BY selected DESC, score DESC, sort_order`).all(task.id) as Array<{ payload: string }>
    return { task, products: productRows.map(item => JSON.parse(item.payload) as CollectedOzonProduct), supplyProducts: supplyRows.map(item => JSON.parse(item.payload) as CollectedSupplyProduct) }
  }

  getCandidateWorkspace(): CandidateWorkspace {
    const productRows = this.database.prepare(`
      SELECT payload, deleted_at
      FROM market_candidates
      ORDER BY deleted_at IS NOT NULL, updated_at DESC
    `).all() as Array<{ payload: string; deleted_at: string | null }>
    const supplyRows = this.database.prepare(`
      SELECT p.payload, p.deleted_at
      FROM supply_candidates p
      JOIN selection_tasks t ON t.id = p.task_id
      ORDER BY p.deleted_at IS NOT NULL, t.created_at DESC, p.selected DESC, p.score DESC, p.sort_order
    `).all() as Array<{ payload: string; deleted_at: string | null }>
    const runRows = this.database.prepare(`SELECT id, task_id, candidate_area, platform_code, collection_method, source_entry, requested_count, collected_count, new_count, updated_count, selected_count, status, started_at, completed_at FROM candidate_collection_runs ORDER BY completed_at DESC`).all() as unknown as Array<Record<string, unknown>>
    const recordRows = this.database.prepare(`SELECT candidate_area, candidate_key, collection_run_id, platform_code, collection_method, source_entry, source_rank, collected_at FROM candidate_collection_records ORDER BY collected_at DESC, source_rank`).all() as unknown as Array<Record<string, unknown>>
    const unique = <T extends { url: string; candidateDeletedAt?: string }>(rows: Array<{ payload: string; deleted_at: string | null }>) => {
      const products = new Map<string, T>()
      rows.forEach(row => {
        const product = JSON.parse(row.payload) as T
        if (row.deleted_at) product.candidateDeletedAt = row.deleted_at
        else delete product.candidateDeletedAt
        if (!products.has(product.url)) products.set(product.url, product)
      })
      return [...products.values()]
    }
    return {
      products: unique<CollectedOzonProduct>(productRows),
      supplyProducts: unique<CollectedSupplyProduct>(supplyRows),
      runs: runRows.map(row => ({ id: String(row.id), taskId: String(row.task_id), candidateArea: row.candidate_area as CandidateCollectionRun['candidateArea'], platformCode: String(row.platform_code), collectionMethod: row.collection_method as CandidateCollectionRun['collectionMethod'], sourceEntry: String(row.source_entry), requestedCount: Number(row.requested_count), collectedCount: Number(row.collected_count), newCount: Number(row.new_count), updatedCount: Number(row.updated_count), selectedCount: Number(row.selected_count), status: String(row.status), startedAt: String(row.started_at), completedAt: String(row.completed_at) })),
      records: recordRows.map(row => ({ candidateArea: row.candidate_area as CandidateCollectionRecord['candidateArea'], candidateKey: String(row.candidate_key), collectionRunId: String(row.collection_run_id), platformCode: String(row.platform_code), collectionMethod: row.collection_method as CandidateCollectionRecord['collectionMethod'], sourceEntry: String(row.source_entry), sourceRank: Number(row.source_rank), collectedAt: String(row.collected_at) }))
    }
  }

  setCandidatesDeleted(request: CandidateUpdateRequest, deleted: boolean): CandidateWorkspace {
    if (!request.candidateKeys.length) return this.getCandidateWorkspace()
    const timestamp = deleted ? new Date().toISOString() : null
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (request.candidateArea === 'MARKET') {
        const update = this.database.prepare('UPDATE market_candidates SET deleted_at = ? WHERE platform_code = ? AND url = ?')
        request.candidateKeys.forEach(key => {
          const separator = key.indexOf(':')
          update.run(timestamp, key.slice(0, separator), key.slice(separator + 1))
        })
      } else {
        const update = this.database.prepare(`UPDATE supply_candidates SET deleted_at = ? WHERE url = ? AND COALESCE(json_extract(payload, '$.platformCode'), '1688') = ?`)
        request.candidateKeys.forEach(key => {
          const separator = key.indexOf(':')
          update.run(timestamp, key.slice(separator + 1), key.slice(0, separator))
        })
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getCandidateWorkspace()
  }

  purgeCandidates(request: CandidateUpdateRequest): CandidateWorkspace {
    if (!request.candidateKeys.length) return this.getCandidateWorkspace()
    this.database.exec('BEGIN IMMEDIATE')
    try {
      if (request.candidateArea === 'MARKET') {
        const select=this.database.prepare(`SELECT product_id, url, payload FROM market_candidates WHERE platform_code=? AND url=?`)
        const remove = this.database.prepare('DELETE FROM market_candidates WHERE platform_code = ? AND url = ?')
        const removeRecord=this.database.prepare(`DELETE FROM candidate_collection_records WHERE candidate_area='MARKET' AND candidate_key=?`)
        request.candidateKeys.forEach(key => {
          const separator = key.indexOf(':')
          const platformCode=key.slice(0,separator),url=key.slice(separator+1)
          const row=select.get(platformCode,url) as {product_id:string;url:string;payload:string}|undefined
          if(row){const payload=JSON.parse(row.payload) as CollectedOzonProduct;this.registerProductIntake(platformCode,row.product_id,url,payload.title,'HISTORY',new Date().toISOString(),new Date().toISOString())}
          remove.run(platformCode,url);removeRecord.run(key)
        })
      } else {
        const select=this.database.prepare(`SELECT payload FROM supply_candidates WHERE url=? AND COALESCE(json_extract(payload, '$.platformCode'), '1688')=?`)
        const remove = this.database.prepare(`DELETE FROM supply_candidates WHERE url = ? AND COALESCE(json_extract(payload, '$.platformCode'), '1688') = ?`)
        const removeRecord=this.database.prepare(`DELETE FROM candidate_collection_records WHERE candidate_area='SUPPLY' AND candidate_key=?`)
        const deletedAt=new Date().toISOString()
        request.candidateKeys.forEach(key => {
          const separator = key.indexOf(':')
          const platformCode=key.slice(0,separator),url=key.slice(separator+1)
          const rows=select.all(url,platformCode) as Array<{payload:string}>
          rows.forEach(row=>this.markCandidatePhysicallyDeleted(JSON.parse(row.payload) as CollectedSupplyProduct,deletedAt))
          remove.run(url,platformCode);removeRecord.run(key)
        })
      }
      this.database.exec('COMMIT')
    } catch (error) {
      this.database.exec('ROLLBACK')
      throw error
    }
    return this.getCandidateWorkspace()
  }

  getTask(taskId: string): SelectionTask | null {
    const row = this.database.prepare('SELECT payload, stage FROM selection_tasks WHERE id = ?').get(taskId) as
      | { payload: string; stage: SelectionTask['stage'] }
      | undefined
    if (!row) return null
    const task = JSON.parse(row.payload) as SelectionTask
    task.stage = row.stage
    return task
  }

  private comparisonNumber(value: string) {
    const match = value.replace(/\s/g, '').replace(',', '.').match(/\d+(?:\.\d+)?/)
    return match ? Number(match[0]) : 0
  }

  private comparisonSimilarity(left: string, right: string) {
    const pairs = (value: string) => { const normalized = value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ''); const result = new Set<string>(); for (let index=0; index<normalized.length-1; index+=1) result.add(normalized.slice(index,index+2)); return result }
    const a = pairs(left); const b = pairs(right)
    if (!a.size || !b.size) return 0
    const common = [...a].filter(pair => b.has(pair)).length
    return common / new Set([...a,...b]).size
  }

  private calculateComparison(record: ComparisonRecordView): ComparisonRecordView {
    const primary = record.suppliers.find(item => item.binding === 'PRIMARY')
    const purchase = record.purchasePriceCny || primary?.price || 0
    const revenue = record.sellingPriceRub * record.settings.exchangeRate
    const rateCosts = revenue * (record.settings.commissionRate + record.settings.advertisingRate + record.settings.returnLossRate + record.settings.taxRate) / 100
    const landed = purchase + record.settings.domesticShipping + record.settings.packagingCost + record.settings.internationalLogistics + record.settings.fulfillmentCost + record.settings.otherCost + rateCosts
    const profit = revenue - landed
    return { ...record, sellingPriceCny:Number(revenue.toFixed(2)), purchasePriceCny:Number(purchase.toFixed(2)), landedCostCny:Number(landed.toFixed(2)), estimatedProfitCny:Number(profit.toFixed(2)), estimatedMargin:revenue ? Number((profit/revenue*100).toFixed(1)) : 0 }
  }

  getComparisons(): ComparisonRecordView[] {
    const rows = this.database.prepare(`SELECT c.id, c.task_id, c.ozon_url, c.status, c.match_score, c.ozon_price_rub, c.purchase_price_cny, c.landed_cost_cny, c.estimated_profit_cny, c.estimated_margin, c.payload, c.updated_at,
      (SELECT s.decision FROM selection_records s WHERE s.comparison_id = c.id ORDER BY s.updated_at DESC LIMIT 1) AS selection_decision,
      (SELECT w.id FROM supply_warehouse_products w WHERE w.selection_id = (SELECT s.id FROM selection_records s WHERE s.comparison_id = c.id ORDER BY s.updated_at DESC LIMIT 1) AND w.status = 'ACTIVE' LIMIT 1) AS warehouse_product_id
      FROM comparison_records c ORDER BY c.updated_at DESC`).all() as unknown as Array<Record<string, unknown>>
    return rows.map(row => {
      const payload = JSON.parse(String(row.payload || '{}')) as Partial<ComparisonRecordView>
      return { id:String(row.id), taskId:String(row.task_id), marketProduct:payload.marketProduct!, suppliers:payload.suppliers || [], decision:payload.decision || 'PENDING', sellingPriceRub:Number(row.ozon_price_rub || payload.sellingPriceRub || 0), sellingPriceCny:Number(payload.sellingPriceCny || 0), purchasePriceCny:Number(row.purchase_price_cny || 0), landedCostCny:Number(row.landed_cost_cny || 0), estimatedProfitCny:Number(row.estimated_profit_cny || 0), estimatedMargin:Number(row.estimated_margin || 0), settings:payload.settings!, selectionDecision:row.selection_decision as SelectionDecision|undefined, warehouseProductId:row.warehouse_product_id?String(row.warehouse_product_id):undefined, updatedAt:String(row.updated_at) }
    }).filter(item => Boolean(item.marketProduct && item.settings))
  }

  importComparison(request: ComparisonImportRequest): ComparisonRecordView {
    const taskRow = this.database.prepare(`SELECT latest_task_id AS task_id FROM market_candidates WHERE url = ? ORDER BY updated_at DESC LIMIT 1`).get(request.product.url) as { task_id: string } | undefined
    if (!taskRow) throw new Error('无法找到该商品的采集任务')
    const existing = this.database.prepare(`SELECT id FROM comparison_records WHERE ozon_url = ? LIMIT 1`).get(request.product.url) as { id: string } | undefined
    if (existing) {
      const saved = this.getComparisons().find(item => item.id === existing.id)
      if (saved) return saved
      this.database.prepare(`DELETE FROM comparison_records WHERE id = ?`).run(existing.id)
    }
    const task = this.getTask(taskRow.task_id)
    const supply = this.getCandidateWorkspace().supplyProducts.filter(item => !item.candidateDeletedAt)
    const suppliers: ComparisonSupplierMatch[] = supply.map(item => {
      const similarity = this.comparisonSimilarity(request.product.title,item.title)
      return { url:item.url, productId:item.productId, title:item.title, imageUrl:item.imageUrl, supplierName:item.supplierName, price:this.comparisonNumber(item.priceText), priceText:item.priceText, moq:1, matchScore:Math.min(99,Math.round(45 + similarity*40 + item.score*.14)), supplyScore:item.score, recommendation:item.recommendation, riskFlags:item.riskFlags, binding:'NONE' as const }
    }).sort((a,b)=>b.matchScore-a.matchScore).slice(0,6)
    if (suppliers[0]) suppliers[0].binding = 'PRIMARY'
    const settings: ComparisonCostSettings = { exchangeRate:task?.exchangeRate || .09, commissionRate:12, domesticShipping:2, packagingCost:1.5, internationalLogistics:18, fulfillmentCost:8, advertisingRate:5, returnLossRate:3, taxRate:0, otherCost:1 }
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    let record: ComparisonRecordView = { id, taskId:taskRow.task_id, marketProduct:request.product, suppliers, decision:suppliers.length?'PENDING':'FAILED', sellingPriceRub:this.comparisonNumber(request.product.priceText), sellingPriceCny:0, purchasePriceCny:suppliers[0]?.price || 0, landedCostCny:0, estimatedProfitCny:0, estimatedMargin:0, settings, updatedAt:now }
    record = this.calculateComparison(record)
    this.database.prepare(`INSERT INTO comparison_records (id, task_id, ozon_url, supplier_url, status, match_score, ozon_price_rub, purchase_price_cny, landed_cost_cny, estimated_profit_cny, estimated_margin, payload, updated_at) VALUES (?, ?, ?, ?, 'COMPLETED', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id,record.taskId,record.marketProduct.url,suppliers[0]?.url || null,suppliers[0]?.matchScore || 0,record.sellingPriceRub,record.purchasePriceCny,record.landedCostCny,record.estimatedProfitCny,record.estimatedMargin,JSON.stringify(record),now)
    return record
  }

  updateComparison(request: ComparisonUpdateRequest): ComparisonRecordView {
    const record = this.getComparisons().find(item => item.id === request.id)
    if (!record) throw new Error('比价记录不存在')
    if (request.decision) record.decision = request.decision
    if (request.settings) record.settings = request.settings
    if (request.purchasePriceCny !== undefined) record.purchasePriceCny = Math.max(0,request.purchasePriceCny)
    if (request.supplierUrl && request.binding) {
      record.suppliers = record.suppliers.map(item => ({ ...item, binding:item.url===request.supplierUrl ? request.binding! : request.binding==='PRIMARY'&&item.binding==='PRIMARY' ? 'NONE' : item.binding }))
      const primary = record.suppliers.find(item => item.binding === 'PRIMARY')
      if (request.binding === 'PRIMARY' && primary) record.purchasePriceCny = primary.price
    }
    record.updatedAt = new Date().toISOString()
    const calculated = this.calculateComparison(record)
    const primary = calculated.suppliers.find(item => item.binding === 'PRIMARY')
    this.database.prepare(`UPDATE comparison_records SET supplier_url=?, status='COMPLETED', match_score=?, purchase_price_cny=?, landed_cost_cny=?, estimated_profit_cny=?, estimated_margin=?, payload=?, updated_at=? WHERE id=?`)
      .run(primary?.url || null,primary?.matchScore || 0,calculated.purchasePriceCny,calculated.landedCostCny,calculated.estimatedProfitCny,calculated.estimatedMargin,JSON.stringify(calculated),calculated.updatedAt,calculated.id)
    return calculated
  }

  promoteComparisonToWarehouse(request: ComparisonPromotionRequest): ComparisonPromotionResult {
    let comparison = this.getComparisons().find(item=>item.id===request.id)
    if (!comparison) throw new Error('比价记录不存在')
    const primary = comparison.suppliers.find(item=>item.binding==='PRIMARY')
    if (!primary) throw new Error('请先绑定1688主货源')
    comparison = this.updateComparison({id:comparison.id,decision:'RECOMMENDED'})
    const imported = this.importSelection({sourceArea:'MARKET',product:comparison.marketProduct,category:request.category,subcategory:request.subcategory,tertiaryCategory:request.tertiaryCategory,comparison})
    const selection = this.updateSelectionDecision(imported.id,'APPROVED')
    const warehouseProduct = this.getSupplyWarehouseProducts().find(item=>item.selectionId===selection.id)
    if (!warehouseProduct) throw new Error('供应仓商品生成失败')
    this.database.prepare(`INSERT INTO workflow_events (task_id, ozon_url, stage, action, detail, created_at) VALUES (?, ?, 'REVERSE_COMPARE', 'PROMOTE_TO_SUPPLY_WAREHOUSE', ?, ?)`).run(comparison.taskId,comparison.marketProduct.url,JSON.stringify({comparisonId:comparison.id,selectionId:selection.id,warehouseProductId:warehouseProduct.id,supplierUrl:primary.url,estimatedMargin:comparison.estimatedMargin}),new Date().toISOString())
    return {comparison:this.getComparisons().find(item=>item.id===comparison.id)!,selection,warehouseProduct}
  }

  getSelectionCatalog(): SelectionCatalogItem[] {
    const rows = this.database.prepare(`SELECT id, task_id, ozon_url, decision, reason, payload, updated_at FROM selection_records ORDER BY updated_at DESC`).all() as unknown as Array<Record<string, unknown>>
    return rows.map(row => {
      const payload = JSON.parse(String(row.payload || '{}')) as Partial<SelectionCatalogItem>
      return {
        id: String(row.id), taskId: String(row.task_id), sourceArea: payload.sourceArea || 'MARKET', sourceUrl: String(row.ozon_url),
        productId: payload.productId || '', platformCode: payload.platformCode || 'OZON', title: payload.title || '未命名商品', imageUrl: payload.imageUrl || '',
        priceText: payload.priceText || '', score: Number(payload.score || 0), category: payload.category || '未分类', subcategory: payload.subcategory || '未分类', tertiaryCategory:payload.tertiaryCategory || '待细分',
        decision: row.decision as SelectionDecision, reason: String(row.reason || payload.reason || ''), recommendation: payload.recommendation || '',
        riskFlags: Array.isArray(payload.riskFlags) ? payload.riskFlags : [], updatedAt: String(row.updated_at)
      }
    })
  }

  importSelection(request: SelectionImportRequest): SelectionCatalogItem {
    const product = request.product
    const sourceUrl = product.url
    const taskRow = request.sourceArea === 'MARKET'
      ? this.database.prepare(`SELECT latest_task_id AS task_id FROM market_candidates WHERE url = ? ORDER BY updated_at DESC LIMIT 1`).get(sourceUrl)
      : this.database.prepare(`SELECT task_id FROM supply_candidates WHERE url = ? ORDER BY rowid DESC LIMIT 1`).get(sourceUrl)
    if (!taskRow) throw new Error('无法找到该候选商品的采集任务')
    const taskId = String((taskRow as { task_id: string }).task_id)
    const supply = request.sourceArea === 'SUPPLY' ? product as CollectedSupplyProduct : null
    const market = request.sourceArea === 'MARKET' ? product as CollectedOzonProduct : null
    const existing = this.database.prepare(`SELECT id, decision FROM selection_records WHERE ozon_url = ? LIMIT 1`).get(sourceUrl) as { id: string; decision: SelectionDecision } | undefined
    const now = new Date().toISOString()
    const id = existing?.id || crypto.randomUUID()
    const item: SelectionCatalogItem = {
      id, taskId, sourceArea: request.sourceArea, sourceUrl, productId: product.productId || '', platformCode: supply?.platformCode || 'OZON',
      title: product.title, imageUrl: product.imageUrl, priceText: product.priceText, score: supply?.score || 70,
      category: request.category, subcategory: request.subcategory, tertiaryCategory:request.tertiaryCategory || '待细分', decision: existing?.decision || 'PENDING',
      reason: supply?.recommendation || '已进入选品库，待结合利润和风险完成决策。', recommendation: supply?.recommendation || '待完成供应链比价',
      riskFlags: supply?.riskFlags || [], comparisonId:request.comparison?.id, supplierUrl:request.comparison?.suppliers.find(item=>item.binding==='PRIMARY')?.url,
      landedCostCny:request.comparison?.landedCostCny, estimatedProfitCny:request.comparison?.estimatedProfitCny, estimatedMargin:request.comparison?.estimatedMargin, updatedAt: now
    }
    this.database.prepare(`INSERT INTO selection_records (id, task_id, ozon_url, comparison_id, decision, reason, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET task_id=excluded.task_id, comparison_id=excluded.comparison_id, decision=selection_records.decision, reason=excluded.reason, payload=excluded.payload, updated_at=excluded.updated_at`)
      .run(id, taskId, sourceUrl, request.comparison?.id || null, item.decision, item.reason, JSON.stringify(item), now)
    if(supply)this.registerProductIntake(supply.platformCode,supply.productId,supply.url,supply.title,'SELECTION',now)
    return item
  }

  updateSelectionDecision(id: string, decision: SelectionDecision): SelectionCatalogItem {
    const row = this.database.prepare(`SELECT payload FROM selection_records WHERE id = ?`).get(id) as { payload: string } | undefined
    if (!row) throw new Error('选品记录不存在')
    const payload = JSON.parse(row.payload) as SelectionCatalogItem
    payload.decision = decision
    payload.updatedAt = new Date().toISOString()
    this.database.prepare(`UPDATE selection_records SET decision = ?, payload = ?, updated_at = ? WHERE id = ?`).run(decision, JSON.stringify(payload), payload.updatedAt, id)
    if (payload.sourceArea === 'SUPPLY' || payload.supplierUrl) {
      if (decision === 'APPROVED') this.upsertSupplyWarehouseProduct(payload)
      else this.database.prepare(`UPDATE supply_warehouse_products SET status = 'ARCHIVED', updated_at = ? WHERE selection_id = ?`).run(payload.updatedAt, payload.id)
    }
    return this.getSelectionCatalog().find(item => item.id === id)!
  }

  private upsertSupplyWarehouseProduct(item: SelectionCatalogItem) {
    const now = new Date().toISOString()
    const sourceUrl = item.sourceArea === 'MARKET' && item.supplierUrl ? item.supplierUrl : item.sourceUrl
    const source = this.database.prepare(`SELECT payload FROM supply_candidates WHERE url = ? ORDER BY rowid DESC LIMIT 1`).get(sourceUrl) as { payload: string } | undefined
    const sourceProduct = source ? JSON.parse(source.payload) as Partial<CollectedSupplyProduct> : {}
    const warehouseCode = sourceProduct.platformCode === 'GIGACLOUD' || item.platformCode === 'GIGACLOUD' ? 'GIGACLOUD' : '1688'
    const existing = this.database.prepare(`SELECT id FROM supply_warehouse_products WHERE warehouse_code = ? AND source_url = ?`).get(warehouseCode,sourceUrl) as { id:string } | undefined
    const product: SupplyWarehouseProduct = {
      id: existing?.id || crypto.randomUUID(), warehouseCode, selectionId:item.id, sourceUrl,
      productId:sourceProduct.productId || item.productId, title:sourceProduct.title || item.title, imageUrl:sourceProduct.imageUrl || item.imageUrl, priceText:sourceProduct.priceText || item.priceText,
      supplierName:sourceProduct.supplierName || '', category:item.category, subcategory:item.subcategory,
      tertiaryCategory:item.tertiaryCategory || '待细分', status:'ACTIVE', updatedAt:now
    }
    this.database.prepare(`INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)
      ON CONFLICT(warehouse_code, source_url) DO UPDATE SET selection_id=excluded.selection_id, product_id=excluded.product_id, title=excluded.title, image_url=excluded.image_url, price_text=excluded.price_text, supplier_name=excluded.supplier_name, category=excluded.category, subcategory=excluded.subcategory, tertiary_category=excluded.tertiary_category, status='ACTIVE', payload=excluded.payload, updated_at=excluded.updated_at`)
      .run(product.id,warehouseCode,item.id,sourceUrl,product.productId,product.title,product.imageUrl,product.priceText,product.supplierName,item.category,item.subcategory,product.tertiaryCategory,JSON.stringify(product),now,now)
    this.registerProductIntake(warehouseCode,product.productId,sourceUrl,product.title,'WAREHOUSE',now)
    return product
  }

  getSupplyWarehouseProducts(): SupplyWarehouseProduct[] {
    const rows = this.database.prepare(`SELECT id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, updated_at FROM supply_warehouse_products WHERE status = 'ACTIVE' ORDER BY updated_at DESC`).all() as unknown as Array<Record<string,unknown>>
    return rows.map(row => ({ id:String(row.id), warehouseCode:row.warehouse_code as SupplyWarehouseProduct['warehouseCode'], selectionId:String(row.selection_id), sourceUrl:String(row.source_url), productId:String(row.product_id), title:String(row.title), imageUrl:String(row.image_url), priceText:String(row.price_text), supplierName:String(row.supplier_name), category:String(row.category), subcategory:String(row.subcategory), tertiaryCategory:String(row.tertiary_category), status:row.status as SupplyWarehouseProduct['status'], updatedAt:String(row.updated_at) }))
  }

  getMarketplaceSelections(marketplaceCode: MarketplacePlatformCode): MarketplaceSelectionProduct[] {
    const rows = this.database.prepare(`SELECT id, marketplace_code, supply_product_id, warehouse_code, source_url, product_id, title, image_url, price_text, category, status, media_status, updated_at FROM marketplace_selection_products WHERE marketplace_code = ? ORDER BY updated_at DESC`).all(marketplaceCode) as unknown as Array<Record<string,unknown>>
    return rows.map(row => ({ id:String(row.id), marketplaceCode:row.marketplace_code as MarketplacePlatformCode, supplyProductId:String(row.supply_product_id), warehouseCode:row.warehouse_code as MarketplaceSelectionProduct['warehouseCode'], sourceUrl:String(row.source_url), productId:String(row.product_id), title:String(row.title), imageUrl:String(row.image_url), priceText:String(row.price_text), category:String(row.category), status:row.status as MarketplaceSelectionProduct['status'], mediaStatus:row.media_status as MarketplaceSelectionProduct['mediaStatus'], updatedAt:String(row.updated_at) }))
  }

  importMarketplaceSelection(marketplaceCode: MarketplacePlatformCode, supplyProductId: string): MarketplaceSelectionProduct {
    const supply = this.getSupplyWarehouseProducts().find(item => item.id === supplyProductId)
    if (!supply) throw new Error('供应仓商品不存在或已归档')
    const now = new Date().toISOString()
    const existing = this.database.prepare(`SELECT id FROM marketplace_selection_products WHERE marketplace_code = ? AND supply_product_id = ?`).get(marketplaceCode,supplyProductId) as { id:string } | undefined
    const item: MarketplaceSelectionProduct = { id:existing?.id || crypto.randomUUID(), marketplaceCode, supplyProductId, warehouseCode:supply.warehouseCode, sourceUrl:supply.sourceUrl, productId:supply.productId, title:supply.title, imageUrl:supply.imageUrl, priceText:supply.priceText, category:supply.category, status:'SELECTED', mediaStatus:'PENDING', updatedAt:now }
    this.database.prepare(`INSERT INTO marketplace_selection_products (id, marketplace_code, supply_product_id, warehouse_code, source_url, product_id, title, image_url, price_text, category, status, media_status, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SELECTED', 'PENDING', ?, ?, ?)
      ON CONFLICT(marketplace_code, supply_product_id) DO UPDATE SET title=excluded.title, image_url=excluded.image_url, price_text=excluded.price_text, category=excluded.category, status='SELECTED', payload=excluded.payload, updated_at=excluded.updated_at`)
      .run(item.id,marketplaceCode,supplyProductId,supply.warehouseCode,supply.sourceUrl,supply.productId,supply.title,supply.imageUrl,supply.priceText,supply.category,JSON.stringify(item),now,now)
    return item
  }

  getMarketplaceMediaAssets(marketplaceSelectionId: string): MarketplaceMediaAsset[] {
    const rows = this.database.prepare(`SELECT id, marketplace_selection_id, marketplace_code, asset_type, image_url, local_path, selected, created_at FROM marketplace_media_assets WHERE marketplace_selection_id = ? ORDER BY selected DESC, created_at DESC`).all(marketplaceSelectionId) as unknown as Array<Record<string,unknown>>
    return rows.map(row=>({ id:String(row.id), marketplaceSelectionId:String(row.marketplace_selection_id), marketplaceCode:row.marketplace_code as MarketplacePlatformCode, assetType:row.asset_type as MarketplaceMediaAssetType, imageUrl:String(row.image_url), localPath:String(row.local_path), selected:Boolean(row.selected), createdAt:String(row.created_at) }))
  }

  saveMarketplaceMediaAsset(marketplaceSelectionId: string, assetType: MarketplaceMediaAssetType, imageUrl: string, localPath = '', selected = false): MarketplaceMediaAsset {
    const selection = this.database.prepare(`SELECT marketplace_code FROM marketplace_selection_products WHERE id = ?`).get(marketplaceSelectionId) as { marketplace_code:string } | undefined
    if (!selection) throw new Error('平台选品记录不存在')
    const now = new Date().toISOString()
    const existing = this.database.prepare(`SELECT id FROM marketplace_media_assets WHERE marketplace_selection_id = ? AND asset_type = ? AND image_url = ? AND local_path = ? LIMIT 1`).get(marketplaceSelectionId,assetType,imageUrl,localPath) as { id:string } | undefined
    const id = existing?.id || crypto.randomUUID()
    if (selected) this.database.prepare(`UPDATE marketplace_media_assets SET selected = 0 WHERE marketplace_selection_id = ?`).run(marketplaceSelectionId)
    this.database.prepare(`INSERT INTO marketplace_media_assets (id, marketplace_selection_id, marketplace_code, asset_type, image_url, local_path, selected, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET selected=excluded.selected`).run(id,marketplaceSelectionId,selection.marketplace_code,assetType,imageUrl,localPath,selected?1:0,now)
    const mediaStatus = selected ? 'READY' : 'PROCESSING'
    this.database.prepare(`UPDATE marketplace_selection_products SET media_status = ?, updated_at = ? WHERE id = ?`).run(mediaStatus,now,marketplaceSelectionId)
    return this.getMarketplaceMediaAssets(marketplaceSelectionId).find(item=>item.id===id)!
  }

  selectMarketplaceMediaAsset(id: string): MarketplaceMediaAsset {
    const row = this.database.prepare(`SELECT marketplace_selection_id FROM marketplace_media_assets WHERE id = ?`).get(id) as { marketplace_selection_id:string } | undefined
    if (!row) throw new Error('平台素材不存在')
    const now = new Date().toISOString()
    this.database.prepare(`UPDATE marketplace_media_assets SET selected = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE marketplace_selection_id = ?`).run(id,row.marketplace_selection_id)
    this.database.prepare(`UPDATE marketplace_selection_products SET media_status = 'READY', updated_at = ? WHERE id = ?`).run(now,row.marketplace_selection_id)
    return this.getMarketplaceMediaAssets(row.marketplace_selection_id).find(item=>item.id===id)!
  }

  getMarketplacePublishDrafts(marketplaceCode: MarketplacePlatformCode): MarketplacePublishDraft[] {
    const rows = this.database.prepare(`SELECT id, marketplace_code, marketplace_selection_id, platform_sku, title, image_url, price_text, store_id, status, checks, error, platform_product_id, updated_at FROM marketplace_publish_drafts WHERE marketplace_code = ? ORDER BY updated_at DESC`).all(marketplaceCode) as unknown as Array<Record<string,unknown>>
    return rows.map(row=>({ id:String(row.id), marketplaceCode:row.marketplace_code as MarketplacePlatformCode, marketplaceSelectionId:String(row.marketplace_selection_id), platformSku:String(row.platform_sku), title:String(row.title), imageUrl:String(row.image_url), priceText:String(row.price_text), storeId:String(row.store_id), status:row.status as MarketplacePublishDraft['status'], checks:JSON.parse(String(row.checks||'[]')) as string[], error:row.error?String(row.error):undefined, platformProductId:row.platform_product_id?String(row.platform_product_id):undefined, updatedAt:String(row.updated_at) }))
  }

  createMarketplacePublishDraft(marketplaceSelectionId: string, storeId = ''): MarketplacePublishDraft {
    const selection = this.database.prepare(`SELECT marketplace_code, warehouse_code, product_id, title, image_url, price_text FROM marketplace_selection_products WHERE id = ?`).get(marketplaceSelectionId) as Record<string,unknown> | undefined
    if (!selection) throw new Error('平台选品记录不存在')
    const selectedMedia = this.database.prepare(`SELECT image_url, local_path FROM marketplace_media_assets WHERE marketplace_selection_id = ? AND selected = 1 LIMIT 1`).get(marketplaceSelectionId) as { image_url:string; local_path:string } | undefined
    const marketplaceCode = String(selection.marketplace_code) as MarketplacePlatformCode
    const skuPart = String(selection.product_id||marketplaceSelectionId.slice(0,8)).replace(/[^A-Za-z0-9_-]/g,'').slice(0,40) || marketplaceSelectionId.slice(0,8)
    const platformSku = `${marketplaceCode}-${String(selection.warehouse_code)}-${skuPart}`.toUpperCase()
    const existing = this.database.prepare(`SELECT id FROM marketplace_publish_drafts WHERE marketplace_code = ? AND marketplace_selection_id = ?`).get(marketplaceCode,marketplaceSelectionId) as { id:string } | undefined
    const id = existing?.id || crypto.randomUUID()
    const now = new Date().toISOString()
    const imageUrl = selectedMedia?.image_url || selectedMedia?.local_path || String(selection.image_url||'')
    this.database.prepare(`INSERT INTO marketplace_publish_drafts (id, marketplace_code, marketplace_selection_id, platform_sku, title, image_url, price_text, store_id, status, checks, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', '[]', ?, ?) ON CONFLICT(marketplace_code, marketplace_selection_id) DO UPDATE SET title=excluded.title, image_url=excluded.image_url, price_text=excluded.price_text, store_id=CASE WHEN excluded.store_id='' THEN marketplace_publish_drafts.store_id ELSE excluded.store_id END, updated_at=excluded.updated_at`).run(id,marketplaceCode,marketplaceSelectionId,platformSku,String(selection.title),imageUrl,String(selection.price_text||''),storeId,now,now)
    this.addMarketplacePublishAudit(marketplaceCode,id,'生成发布草稿',`${platformSku} · 本地安全模式`)
    return this.getMarketplacePublishDrafts(marketplaceCode).find(item=>item.id===id)!
  }

  updateMarketplacePublishDraft(request: MarketplacePublishDraftUpdate, action: string): MarketplacePublishDraft {
    const current = this.database.prepare(`SELECT marketplace_code, store_id, status, checks, error FROM marketplace_publish_drafts WHERE id = ?`).get(request.id) as Record<string,unknown> | undefined
    if (!current) throw new Error('发布草稿不存在')
    const now = new Date().toISOString()
    const storeId = request.storeId ?? String(current.store_id||'')
    const status = request.status ?? String(current.status)
    const checks = request.checks ?? JSON.parse(String(current.checks||'[]'))
    const error = request.error === undefined ? (current.error ? String(current.error) : null) : request.error || null
    this.database.prepare(`UPDATE marketplace_publish_drafts SET store_id = ?, status = ?, checks = ?, error = ?, updated_at = ? WHERE id = ?`).run(storeId,status,JSON.stringify(checks),error,now,request.id)
    this.addMarketplacePublishAudit(current.marketplace_code as MarketplacePlatformCode,request.id,action,String(status))
    return this.getMarketplacePublishDrafts(current.marketplace_code as MarketplacePlatformCode).find(item=>item.id===request.id)!
  }

  private addMarketplacePublishAudit(marketplaceCode: MarketplacePlatformCode, draftId: string | undefined, action: string, detail: string) {
    this.database.prepare(`INSERT INTO marketplace_publish_audits (id, marketplace_code, draft_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(crypto.randomUUID(),marketplaceCode,draftId||null,action,detail,new Date().toISOString())
  }

  getMarketplacePublishAudits(marketplaceCode: MarketplacePlatformCode): MarketplacePublishAudit[] {
    const rows = this.database.prepare(`SELECT id, marketplace_code, draft_id, action, detail, created_at FROM marketplace_publish_audits WHERE marketplace_code = ? ORDER BY created_at DESC`).all(marketplaceCode) as unknown as Array<Record<string,unknown>>
    return rows.map(row=>({id:String(row.id),marketplaceCode:row.marketplace_code as MarketplacePlatformCode,draftId:row.draft_id?String(row.draft_id):undefined,action:String(row.action),detail:String(row.detail),createdAt:String(row.created_at)}))
  }

  private seedComplianceKnowledge() {
    const sources = [
      ['source-ebay','eBay 平台政策','eBay','PLATFORM','https://www.ebay.com/help/policies/default/ebays-rules-policies?id=4205','WEB_MONITOR','NOT_CONFIGURED'],
      ['source-ozon','Ozon 平台政策','Ozon','PLATFORM','https://docs.ozon.ru/global/','WEB_MONITOR','NOT_CONFIGURED'],
      ['source-aliexpress','AliExpress 平台政策','AliExpress','PLATFORM','https://service.aliexpress.com/page/home','WEB_MONITOR','NOT_CONFIGURED'],
      ['source-cpsc','CPSC 召回数据','U.S. Consumer Product Safety Commission','RECALL','https://www.cpsc.gov/Recalls','API','NOT_CONFIGURED'],
      ['source-eu-safety-gate','EU Safety Gate','European Commission','RECALL','https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en','API','NOT_CONFIGURED'],
      ['source-uk-opss','UK OPSS 产品安全','Office for Product Safety and Standards','RECALL','https://www.gov.uk/product-safety-alerts-reports-recalls.atom','API','NOT_CONFIGURED']
    ]
    const insertSource=this.database.prepare(`INSERT OR IGNORE INTO compliance_sources (id,name,authority,source_type,url,sync_mode,sync_status) VALUES (?,?,?,?,?,?,?)`)
    sources.forEach(row=>insertSource.run(...row))
    this.database.prepare(`UPDATE compliance_sources SET sync_mode='WEB_MONITOR' WHERE id IN ('source-ebay','source-ozon','source-aliexpress')`).run()
    this.database.prepare(`UPDATE compliance_sources SET url='https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en',sync_mode='API' WHERE id='source-eu-safety-gate'`).run()
    this.database.prepare(`UPDATE compliance_sources SET source_type='RECALL',url='https://www.gov.uk/product-safety-alerts-reports-recalls.atom',sync_mode='API' WHERE id='source-uk-opss'`).run()
    const now=new Date().toISOString()
    const rules:ComplianceRuleDraft[]=[
      {code:'EBAY-IP-COUNTERFEIT',platform:'EBAY',marketplaceSite:'ALL',country:'ALL',category:'ALL',ruleType:'INTELLECTUAL_PROPERTY',riskLevel:'P0',reviewStatus:'ACTIVE',title:'禁止仿品、伪造品及未授权品牌刊登',summary:'标题或描述明确宣称商品为仿品、高仿或伪造品时阻止发布。',keywords:['counterfeit','replica','fake brand','高仿','仿品','伪造'],requiredFields:[],remediation:'下架该商品或补充可验证的授权与进货证明后提交人工复核。',sourceUrl:'https://www.ebay.com/help/policies/listing-policies/intellectual-property-vero-program?id=4349',effectiveFrom:'2025-01-01'},
      {code:'EBAY-TITLE-PROMISES',platform:'EBAY',marketplaceSite:'ALL',country:'ALL',category:'ALL',ruleType:'LISTING_CONTENT',riskLevel:'P2',reviewStatus:'ACTIVE',title:'刊登文案不应包含无法证实的绝对承诺',summary:'识别标题和描述中的绝对化功效或虚假宣传用语。',keywords:['100% guaranteed','best in the world','miracle cure','绝对有效','百分百治愈'],requiredFields:[],remediation:'删除无法提供证据的绝对化承诺，改为可验证的产品事实。',sourceUrl:'https://www.ebay.com/help/policies/listing-policies/item-description-policy?id=4372',effectiveFrom:'2025-01-01'},
      {code:'EBAY-LISTING-REQUIRED',platform:'EBAY',marketplaceSite:'ALL',country:'ALL',category:'ALL',ruleType:'LISTING_REQUIREMENTS',riskLevel:'P0',reviewStatus:'ACTIVE',title:'eBay 刊登基础资料必须完整',summary:'发布前必须包含有效类目、标题和主图。',keywords:[],requiredFields:['categoryName','title','imageUrl'],remediation:'补充缺失的类目、标题或主图后重新执行合规检查。',sourceUrl:'https://www.ebay.com/help/selling/listings/creating-managing-listings?id=4073',effectiveFrom:'2025-01-01'},
      {code:'EBAY-RESTRICTED-SENSITIVE',platform:'EBAY',marketplaceSite:'ALL',country:'ALL',category:'ALL',ruleType:'PROHIBITED_RESTRICTED',riskLevel:'P1',reviewStatus:'ACTIVE',title:'疑似禁售或受限制商品需人工核验',summary:'检测到药品、武器、烟草、象牙或其他受限制商品线索。',keywords:['prescription drug','firearm','ammunition','tobacco','vape','ivory','处方药','枪支','弹药','烟草','电子烟','象牙'],requiredFields:[],remediation:'核对 eBay 禁售/限售政策、类目许可与目标国家法律，确认可售后留存证据。',sourceUrl:'https://www.ebay.com/help/policies/prohibited-restricted-items/prohibited-restricted-items?id=4207',effectiveFrom:'2025-01-01'},
      {code:'EBAY-EU-PRODUCT-SAFETY',platform:'EBAY',marketplaceSite:'ALL',country:'EU',category:'ALL',ruleType:'PRODUCT_SAFETY',riskLevel:'P1',reviewStatus:'ACTIVE',title:'欧盟站点需核对产品安全与追溯信息',summary:'面向欧盟销售的商品需根据类目核对制造商、欧盟负责人、警告和合规文件。',keywords:[],requiredFields:['manufacturer','euResponsiblePerson'],remediation:'在发布前补充适用的产品安全、追溯和欧盟负责人信息，并由人工确认。',sourceUrl:'https://www.ebay.com/help/selling/selling/product-safety-disclosures?id=5407',effectiveFrom:'2024-12-13'}
      ,{code:'US-CPSC-RECALL-GATE',platform:'EBAY',marketplaceSite:'EBAY_US',country:'US',category:'ALL',ruleType:'OFFICIAL_RECALL',riskLevel:'P0',reviewStatus:'ACTIVE',title:'美国站发布前必须排除 CPSC 召回商品',summary:'检查引擎将商品标题、型号和描述与 CPSC 官方召回数据匹配；疑似命中时阻止发布。',keywords:[],requiredFields:[],remediation:'核对召回页中的品牌、型号、批次和图片；命中范围的商品不得发布。',sourceUrl:'https://www.cpsc.gov/Recalls',effectiveFrom:'2025-01-01'},
      {code:'EBAY-UK-PRODUCT-SAFETY',platform:'EBAY',marketplaceSite:'EBAY_GB',country:'GB',category:'ALL',ruleType:'PRODUCT_SAFETY',riskLevel:'P1',reviewStatus:'ACTIVE',title:'英国站需核对产品安全、标签与追溯资料',summary:'面向英国销售的商品需根据类目核对制造商、进口商、型号、警告与适用合规资料。',keywords:[],requiredFields:['itemSpecifics'],remediation:'补充英国市场适用的标识、追溯与安全资料，并由人工核验后重新检查。',sourceUrl:'https://www.gov.uk/guidance/product-safety-advice-for-businesses',effectiveFrom:'2025-01-01'}
      ,{code:'OZON-LISTING-REQUIRED',platform:'OZON',marketplaceSite:'ALL',country:'ALL',category:'ALL',ruleType:'LISTING_REQUIREMENTS',riskLevel:'P0',reviewStatus:'ACTIVE',title:'Ozon 刊登基础资料必须完整',summary:'发布前必须包含有效类目、标题和主图。',keywords:[],requiredFields:['categoryName','title','imageUrl'],remediation:'补充缺失的类目、标题或主图后重新检查。',sourceUrl:'https://docs.ozon.ru/global/',effectiveFrom:'2025-01-01'}
      ,{code:'OZON-RESTRICTED-SENSITIVE',platform:'OZON',marketplaceSite:'ALL',country:'ALL',category:'ALL',ruleType:'PROHIBITED_RESTRICTED',riskLevel:'P1',reviewStatus:'ACTIVE',title:'Ozon 疑似禁限售商品需人工核验',summary:'检测到药品、武器、烟草或其他敏感商品线索，必须核对平台与目的国要求。',keywords:['prescription drug','firearm','ammunition','tobacco','vape','处方药','枪支','弹药','烟草','电子烟'],requiredFields:[],remediation:'核对 Ozon 最新禁限售政策、类目准入和目的国法规并留存证据。',sourceUrl:'https://docs.ozon.ru/global/',effectiveFrom:'2025-01-01'}
      ,{code:'ALIEXPRESS-LISTING-REQUIRED',platform:'ALIEXPRESS',marketplaceSite:'ALL',country:'ALL',category:'ALL',ruleType:'LISTING_REQUIREMENTS',riskLevel:'P0',reviewStatus:'ACTIVE',title:'AliExpress 刊登基础资料必须完整',summary:'发布前必须包含有效类目、标题和主图。',keywords:[],requiredFields:['categoryName','title','imageUrl'],remediation:'补充缺失的类目、标题或主图后重新检查。',sourceUrl:'https://service.aliexpress.com/page/home',effectiveFrom:'2025-01-01'}
      ,{code:'ALIEXPRESS-RESTRICTED-SENSITIVE',platform:'ALIEXPRESS',marketplaceSite:'ALL',country:'ALL',category:'ALL',ruleType:'PROHIBITED_RESTRICTED',riskLevel:'P1',reviewStatus:'ACTIVE',title:'AliExpress 疑似禁限售商品需人工核验',summary:'检测到药品、武器、烟草或其他敏感商品线索，必须核对平台与目的国要求。',keywords:['prescription drug','firearm','ammunition','tobacco','vape','处方药','枪支','弹药','烟草','电子烟'],requiredFields:[],remediation:'核对 AliExpress 最新禁限售政策、类目准入和目的国法规并留存证据。',sourceUrl:'https://service.aliexpress.com/page/home',effectiveFrom:'2025-01-01'}
    ]
    for(const draft of rules){
      const existing=this.database.prepare(`SELECT id FROM compliance_rules WHERE code=?`).get(draft.code) as {id:string}|undefined
      if(existing)continue
      const id=`rule-${draft.code.toLowerCase()}`
      this.database.prepare(`INSERT INTO compliance_rules (id,code,platform,marketplace_site,country,category,rule_type,risk_level,review_status,current_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,1,?,?)`).run(id,draft.code,draft.platform,draft.marketplaceSite,draft.country,draft.category,draft.ruleType,draft.riskLevel,draft.reviewStatus,now,now)
      this.database.prepare(`INSERT INTO compliance_rule_versions (id,rule_id,version,title,summary,condition_json,remediation,source_url,effective_from,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(`${id}-v1`,id,1,draft.title,draft.summary,JSON.stringify({keywords:draft.keywords,requiredFields:draft.requiredFields}),draft.remediation,draft.sourceUrl,draft.effectiveFrom,now)
    }
    this.database.prepare(`UPDATE compliance_rules SET risk_level='P0',updated_at=? WHERE code='EBAY-LISTING-REQUIRED' AND risk_level!='P0'`).run(now)
    this.database.prepare(`UPDATE compliance_rules SET marketplace_site='ALL',updated_at=? WHERE code='EBAY-EU-PRODUCT-SAFETY' AND marketplace_site!='ALL'`).run(now)
    this.database.prepare(`UPDATE compliance_rule_versions SET summary='面向欧盟销售的商品需根据类目核对制造商、欧盟负责人、警告和合规文件。',condition_json=?,remediation='在发布前补充适用的产品安全、追溯和欧盟负责人信息，并由人工确认。' WHERE rule_id IN (SELECT id FROM compliance_rules WHERE code='EBAY-EU-PRODUCT-SAFETY') AND version=(SELECT current_version FROM compliance_rules WHERE code='EBAY-EU-PRODUCT-SAFETY' LIMIT 1)`).run(JSON.stringify({keywords:[],requiredFields:['manufacturer','euResponsiblePerson']}))
    const templates:Array<[string,string,string,string,string,string,string[],string[],string[],string[],number]>=[
      ['template-ebay-us-general','eBay 美国站通用发布要求','EBAY','EBAY_US','US','ALL',['categoryName','title','imageUrl'],[],[],['核对电池、液体、粉末及危险品运输限制'],0],
      ['template-ebay-eu-general','eBay 欧盟站产品安全要求','EBAY','ALL','EU','ALL',['categoryName','title','imageUrl','itemSpecifics'],['EU_RESPONSIBLE_PERSON','SAFETY_DOCUMENT'],['按产品类型提供当地语言安全警告'],[],1],
      ['template-ebay-uk-general','eBay 英国站产品安全要求','EBAY','EBAY_GB','GB','ALL',['categoryName','title','imageUrl','itemSpecifics'],['UK_IMPORTER_OR_RESPONSIBLE_PERSON','SAFETY_DOCUMENT'],['核对英国市场适用的安全警告'],[],1]
      ,['template-ozon-general','Ozon 通用发布要求','OZON','ALL','ALL','ALL',['categoryName','title','imageUrl'],[],['按商品类目和销售国家核对俄文安全警告'],['核对电池、液体、粉末及危险品运输限制'],1]
      ,['template-aliexpress-general','AliExpress 通用发布要求','ALIEXPRESS','ALL','ALL','ALL',['categoryName','title','imageUrl'],[],['按目标国家和商品类目核对安全警告'],['核对电池、液体、粉末及危险品运输限制'],1]
    ]
    const insertTemplate=this.database.prepare(`INSERT OR IGNORE INTO compliance_category_templates (id,name,platform,marketplace_site,country,category,required_fields_json,required_documents_json,required_warnings_json,logistics_requirements_json,requires_manual_review,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?)`)
    templates.forEach(item=>insertTemplate.run(item[0],item[1],item[2],item[3],item[4],item[5],JSON.stringify(item[6]),JSON.stringify(item[7]),JSON.stringify(item[8]),JSON.stringify(item[9]),item[10],now,now))
    this.database.prepare(`UPDATE compliance_category_templates SET marketplace_site='ALL',updated_at=? WHERE id='template-ebay-eu-general' AND marketplace_site!='ALL'`).run(now)
  }

  private mapComplianceRule(row:Record<string,unknown>,versions:ComplianceRuleVersion[]):ComplianceRule {
    const current=versions.find(item=>item.version===Number(row.current_version))||versions[0]
    return {id:String(row.id),code:String(row.code),platform:String(row.platform),marketplaceSite:String(row.marketplace_site),country:String(row.country),category:String(row.category),ruleType:String(row.rule_type),riskLevel:row.risk_level as ComplianceRule['riskLevel'],reviewStatus:row.review_status as ComplianceReviewStatus,currentVersion:Number(row.current_version),updatedAt:String(row.updated_at),version:current,versions}
  }

  private mapComplianceDocument(row:Record<string,unknown>):ComplianceDocumentRecord {
    let status=row.status as ComplianceDocumentRecord['status']
    if(row.expires_at&&status==='APPROVED'){
      const days=(Date.parse(String(row.expires_at))-Date.now())/86_400_000
      if(days<0)status='EXPIRED';else if(days<=30)status='EXPIRING'
    }
    return {id:String(row.id),productId:String(row.product_id),documentType:String(row.document_type),name:String(row.name),documentNumber:String(row.document_number),issuer:String(row.issuer),modelNumbers:String(row.model_numbers),countries:String(row.countries),issuedAt:String(row.issued_at),expiresAt:String(row.expires_at),status,fileName:String(row.file_name),filePath:String(row.file_path),reviewNote:String(row.review_note),updatedAt:String(row.updated_at)}
  }

  saveComplianceProfile(draft:ComplianceProductProfileDraft):ComplianceProductProfile {
    const current=this.database.prepare(`SELECT platform,marketplace_site AS marketplaceSite,country,category_id AS categoryId,category_name AS categoryName,title,brand,manufacturer,importer,eu_responsible_person AS euResponsiblePerson,model,batch_number AS batchNumber,barcode,origin_country AS originCountry,materials,age_grade AS ageGrade,battery_type AS batteryType FROM compliance_product_profiles WHERE product_id=?`).get(draft.productId) as Partial<ComplianceProductProfileDraft>|undefined
    if(current)(['brand','manufacturer','importer','euResponsiblePerson','model','batchNumber','barcode','originCountry','materials','ageGrade','batteryType'] as const).forEach(key=>{if(!draft[key]&&current[key])draft[key]=String(current[key])})
    const profileKeys=(['platform','marketplaceSite','country','categoryId','categoryName','title','brand','manufacturer','importer','euResponsiblePerson','model','batchNumber','barcode','originCountry','materials','ageGrade','batteryType'] as const)
    const changed=Boolean(current&&profileKeys.some(key=>String(current[key]||'')!==String(draft[key]||'')))
    const now=new Date().toISOString();const id=draft.id||crypto.randomUUID()
    this.database.prepare(`INSERT INTO compliance_product_profiles (id,product_id,platform,marketplace_site,country,category_id,category_name,title,brand,manufacturer,importer,eu_responsible_person,model,batch_number,barcode,origin_country,materials,age_grade,battery_type,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(product_id) DO UPDATE SET platform=excluded.platform,marketplace_site=excluded.marketplace_site,country=excluded.country,category_id=excluded.category_id,category_name=excluded.category_name,title=excluded.title,brand=excluded.brand,manufacturer=excluded.manufacturer,importer=excluded.importer,eu_responsible_person=excluded.eu_responsible_person,model=excluded.model,batch_number=excluded.batch_number,barcode=excluded.barcode,origin_country=excluded.origin_country,materials=excluded.materials,age_grade=excluded.age_grade,battery_type=excluded.battery_type,updated_at=excluded.updated_at`).run(id,draft.productId,draft.platform,draft.marketplaceSite,draft.country,draft.categoryId,draft.categoryName,draft.title,draft.brand,draft.manufacturer,draft.importer,draft.euResponsiblePerson,draft.model,draft.batchNumber,draft.barcode,draft.originCountry,draft.materials,draft.ageGrade,draft.batteryType,now,now)
    if(changed)this.revokeComplianceReleasePermits(draft.productId,'商品合规档案发生变化')
    return this.getComplianceKnowledgeWorkspace().profiles.find(item=>item.productId===draft.productId)!
  }

  saveComplianceDocument(draft:ComplianceDocumentDraft):ComplianceDocumentRecord {
    if(!draft.name.trim()||!draft.documentType.trim()||!draft.filePath.trim())throw new Error('文件类型、名称和上传文件不能为空')
    if(draft.status==='APPROVED'&&!draft.reviewNote.trim())throw new Error('核验通过时必须填写审核依据')
    const now=new Date().toISOString();const id=draft.id||crypto.randomUUID()
    this.database.prepare(`INSERT INTO compliance_documents (id,product_id,document_type,name,document_number,issuer,model_numbers,countries,issued_at,expires_at,status,file_name,file_path,review_note,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET product_id=excluded.product_id,document_type=excluded.document_type,name=excluded.name,document_number=excluded.document_number,issuer=excluded.issuer,model_numbers=excluded.model_numbers,countries=excluded.countries,issued_at=excluded.issued_at,expires_at=excluded.expires_at,status=excluded.status,file_name=excluded.file_name,file_path=excluded.file_path,review_note=excluded.review_note,updated_at=excluded.updated_at`).run(id,draft.productId,draft.documentType,draft.name,draft.documentNumber,draft.issuer,draft.modelNumbers,draft.countries,draft.issuedAt,draft.expiresAt,draft.status,draft.fileName,draft.filePath,draft.reviewNote,now,now)
    const saved=this.getComplianceKnowledgeWorkspace().documents.find(item=>item.id===id)!
    if(saved.status==='EXPIRING'||saved.status==='EXPIRED')this.createComplianceTask(saved.productId,undefined,'DOCUMENT_EXPIRING',saved.status==='EXPIRED'?'P1':'P2',saved.status==='EXPIRED'?'合规文件已过期':'合规文件即将过期',`${saved.name} · ${saved.expiresAt}`)
    this.createComplianceTask(saved.productId,undefined,'RULE_UPDATE','P2',`合规资料变更后需重新检查`,`${saved.name} · ${saved.status}`)
    this.revokeComplianceReleasePermits(saved.productId,'商品合规文件发生变化')
    return saved
  }

  saveComplianceTemplate(draft:ComplianceCategoryTemplateDraft):ComplianceCategoryTemplate {
    const now=new Date().toISOString();const id=draft.id||crypto.randomUUID()
    this.database.prepare(`INSERT INTO compliance_category_templates (id,name,platform,marketplace_site,country,category,required_fields_json,required_documents_json,required_warnings_json,logistics_requirements_json,requires_manual_review,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,platform=excluded.platform,marketplace_site=excluded.marketplace_site,country=excluded.country,category=excluded.category,required_fields_json=excluded.required_fields_json,required_documents_json=excluded.required_documents_json,required_warnings_json=excluded.required_warnings_json,logistics_requirements_json=excluded.logistics_requirements_json,requires_manual_review=excluded.requires_manual_review,active=excluded.active,updated_at=excluded.updated_at`).run(id,draft.name,draft.platform,draft.marketplaceSite,draft.country,draft.category,JSON.stringify(draft.requiredFields),JSON.stringify(draft.requiredDocuments),JSON.stringify(draft.requiredWarnings),JSON.stringify(draft.logisticsRequirements),draft.requiresManualReview?1:0,draft.active?1:0,now,now)
    const workspace=this.getComplianceKnowledgeWorkspace();const saved=workspace.templates.find(item=>item.id===id)!
    workspace.profiles.filter(profile=>this.complianceScopeMatches(saved,profile)).forEach(profile=>{this.createComplianceTask(profile.productId,undefined,'RULE_UPDATE',saved.requiresManualReview||saved.requiredDocuments.length?'P1':'P2',`类目合规模板更新后需重新检查：${saved.name}`,`${saved.marketplaceSite} · ${saved.country} · ${saved.category}`);this.revokeComplianceReleasePermits(profile.productId,'适用类目合规模板发生变化')})
    return saved
  }

  updateComplianceTask(taskId:string,status:ComplianceTaskStatus,assignee:string,resolution:string):ComplianceTaskRecord {
    const current=this.database.prepare(`SELECT assignee,resolution FROM compliance_tasks WHERE id=?`).get(taskId) as {assignee:string;resolution:string}|undefined
    const now=new Date().toISOString();const result=this.database.prepare(`UPDATE compliance_tasks SET status=?,assignee=?,resolution=?,updated_at=? WHERE id=?`).run(status,assignee||current?.assignee||'',resolution||current?.resolution||'',now,taskId)
    if(!result.changes)throw new Error('合规任务不存在')
    this.recordComplianceAudit('TASK_STATUS_UPDATED','TASK',taskId,`${status}${assignee?` · ${assignee}`:''}${resolution?` · ${resolution}`:''}`)
    return this.getComplianceKnowledgeWorkspace().tasks.find(item=>item.id===taskId)!
  }

  private createComplianceTask(productId:string,checkId:string|undefined,taskType:ComplianceTaskRecord['taskType'],riskLevel:ComplianceTaskRecord['riskLevel'],title:string,detail:string) {
    const existing=this.database.prepare(`SELECT id FROM compliance_tasks WHERE product_id=? AND task_type=? AND title=? AND status IN ('OPEN','IN_REVIEW') LIMIT 1`).get(productId,taskType,title) as {id:string}|undefined
    if(existing)return
    const now=new Date().toISOString();const dueDays=riskLevel==='P0'?1:riskLevel==='P1'?3:7;const dueAt=new Date(Date.now()+dueDays*86_400_000).toISOString()
    this.database.prepare(`INSERT INTO compliance_tasks (id,product_id,check_id,task_type,risk_level,title,detail,status,assignee,due_at,resolution,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'OPEN','',?,'',?,?)`).run(crypto.randomUUID(),productId,checkId||null,taskType,riskLevel,title,detail,dueAt,now,now)
  }

  private recordComplianceAudit(action:string,entityType:string,entityId:string,detail:string) {
    this.database.prepare(`INSERT INTO compliance_audit_events (id,action,entity_type,entity_id,detail,created_at) VALUES (?,?,?,?,?,?)`).run(crypto.randomUUID(),action,entityType,entityId,detail,new Date().toISOString())
  }

  private createComplianceAlert(alertType:ComplianceAlert['alertType'],riskLevel:ComplianceAlert['riskLevel'],entityId:string,title:string,detail:string) {
    const now=new Date().toISOString()
    const existing=this.database.prepare(`SELECT id FROM compliance_alerts WHERE alert_type=? AND entity_id=? AND status IN ('OPEN','ACKNOWLEDGED') LIMIT 1`).get(alertType,entityId) as {id:string}|undefined
    if(existing)this.database.prepare(`UPDATE compliance_alerts SET risk_level=?,title=?,detail=?,updated_at=? WHERE id=?`).run(riskLevel,title,detail,now,existing.id)
    else this.database.prepare(`INSERT INTO compliance_alerts (id,alert_type,risk_level,entity_id,title,detail,status,note,created_at,updated_at) VALUES (?,?,?,?,?,?,'OPEN','',?,?)`).run(crypto.randomUUID(),alertType,riskLevel,entityId,title,detail,now,now)
  }

  updateComplianceAlert(alertId:string,status:ComplianceAlertStatus,note:string):ComplianceAlert {
    const now=new Date().toISOString()
    const result=this.database.prepare(`UPDATE compliance_alerts SET status=?,note=?,updated_at=? WHERE id=?`).run(status,note.trim(),now,alertId)
    if(!result.changes)throw new Error('合规告警不存在')
    this.recordComplianceAudit('ALERT_STATUS_UPDATED','ALERT',alertId,`${status}${note.trim()?` · ${note.trim()}`:''}`)
    return this.getComplianceKnowledgeWorkspace().alerts.find(item=>item.id===alertId)!
  }

  private mapComplianceReleasePermit(row:Record<string,unknown>):ComplianceReleasePermit {
    return {id:String(row.id),productId:String(row.product_id),platform:String(row.platform),marketplaceSite:String(row.marketplace_site),checkId:String(row.check_id),ruleSetVersion:String(row.rule_set_version),inputFingerprint:String(row.input_fingerprint),gateStatus:row.gate_status as ComplianceReleasePermit['gateStatus'],issuedAt:String(row.issued_at),expiresAt:String(row.expires_at),status:row.status as ComplianceReleasePermit['status'],revokedAt:row.revoked_at?String(row.revoked_at):undefined,revokeReason:row.revoke_reason?String(row.revoke_reason):undefined}
  }

  private mapComplianceEnforcementCase(row:Record<string,unknown>):ComplianceEnforcementCase {
    return {id:String(row.id),productId:String(row.product_id),platform:String(row.platform),marketplaceSite:String(row.marketplace_site),listingId:String(row.listing_id),storeId:String(row.store_id),title:String(row.title),viewUrl:String(row.view_url),riskLevel:row.risk_level as ComplianceEnforcementCase['riskLevel'],reason:String(row.reason),recommendedAction:row.recommended_action as ComplianceEnforcementAction,status:row.status as ComplianceEnforcementStatus,assignee:String(row.assignee),resolution:String(row.resolution),createdAt:String(row.created_at),updatedAt:String(row.updated_at),resolvedAt:row.resolved_at?String(row.resolved_at):undefined}
  }

  private createComplianceEnforcementCase(productId:string,riskLevel:ComplianceEnforcementCase['riskLevel'],reason:string,recommendedAction:ComplianceEnforcementAction) {
    const listing=this.database.prepare(`SELECT id,store_id,marketplace_id,listing_id,title,view_url FROM ebay_listings WHERE id=? AND status='ACTIVE'`).get(productId) as {id:string;store_id:string;marketplace_id:string;listing_id:string;title:string;view_url:string}|undefined
    if(!listing)return
    const profile=this.database.prepare(`SELECT platform,marketplace_site,title FROM compliance_product_profiles WHERE product_id=?`).get(productId) as {platform:string;marketplace_site:string;title:string}|undefined
    const existing=this.database.prepare(`SELECT id,risk_level FROM compliance_enforcement_cases WHERE product_id=? AND status IN ('OPEN','IN_PROGRESS') LIMIT 1`).get(productId) as {id:string;risk_level:string}|undefined
    const now=new Date().toISOString()
    const rank:Record<string,number>={P0:0,P1:1,P2:2,P3:3}
    if(existing){
      const nextRisk=(rank[riskLevel]??3)<(rank[existing.risk_level]??3)?riskLevel:existing.risk_level
      this.database.prepare(`UPDATE compliance_enforcement_cases SET risk_level=?,reason=?,recommended_action=?,updated_at=? WHERE id=?`).run(nextRisk,reason,recommendedAction,now,existing.id)
      this.recordComplianceAudit('ENFORCEMENT_CASE_UPDATED','ENFORCEMENT_CASE',existing.id,`${nextRisk} · ${reason}`)
      return
    }
    const id=crypto.randomUUID()
    this.database.prepare(`INSERT INTO compliance_enforcement_cases (id,product_id,platform,marketplace_site,listing_id,store_id,title,view_url,risk_level,reason,recommended_action,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,'OPEN',?,?)`).run(id,productId,profile?.platform||'EBAY',profile?.marketplace_site||listing.marketplace_id,listing.listing_id,listing.store_id,profile?.title||listing.title,listing.view_url,riskLevel,reason,recommendedAction,now,now)
    this.recordComplianceAudit('ENFORCEMENT_CASE_CREATED','ENFORCEMENT_CASE',id,`${riskLevel} · ${reason}`)
  }

  private resolveComplianceEnforcementCases(productId:string,resolution:string) {
    const now=new Date().toISOString()
    const result=this.database.prepare(`UPDATE compliance_enforcement_cases SET status='RESOLVED',resolution=?,resolved_at=?,updated_at=? WHERE product_id=? AND status IN ('OPEN','IN_PROGRESS')`).run(resolution,now,now,productId)
    if(result.changes)this.recordComplianceAudit('ENFORCEMENT_CASE_AUTO_RESOLVED','PRODUCT',productId,`${resolution} · ${result.changes} 个处置单`)
  }

  updateComplianceEnforcementCase(caseId:string,status:ComplianceEnforcementStatus,assignee:string,resolution:string):ComplianceEnforcementCase {
    const current=this.database.prepare(`SELECT assignee FROM compliance_enforcement_cases WHERE id=?`).get(caseId) as {assignee:string}|undefined
    if(!current)throw new Error('在售处置单不存在')
    if(status==='IN_PROGRESS'&&!assignee.trim())throw new Error('开始处置时必须填写负责人')
    if(status==='RESOLVED'&&!resolution.trim())throw new Error('完成处置时必须填写处理结论')
    const now=new Date().toISOString()
    this.database.prepare(`UPDATE compliance_enforcement_cases SET status=?,assignee=?,resolution=?,resolved_at=?,updated_at=? WHERE id=?`).run(status,assignee.trim()||current.assignee,resolution.trim(),status==='RESOLVED'?now:null,now,caseId)
    this.recordComplianceAudit(status==='RESOLVED'?'ENFORCEMENT_CASE_RESOLVED':'ENFORCEMENT_CASE_ACCEPTED','ENFORCEMENT_CASE',caseId,`${assignee.trim()||current.assignee}${resolution.trim()?` · ${resolution.trim()}`:''}`)
    const row=this.database.prepare(`SELECT * FROM compliance_enforcement_cases WHERE id=?`).get(caseId) as Record<string,unknown>
    return this.mapComplianceEnforcementCase(row)
  }

  private expireComplianceReleasePermits() {
    const now=new Date().toISOString()
    const expired=this.database.prepare(`SELECT id,product_id FROM compliance_release_permits WHERE status='VALID' AND expires_at<=?`).all(now) as unknown as Array<{id:string;product_id:string}>
    for(const permit of expired){
      this.database.prepare(`UPDATE compliance_release_permits SET status='EXPIRED',revoked_at=?,revoke_reason='发布许可已超过有效期' WHERE id=?`).run(now,permit.id)
      this.recordComplianceAudit('RELEASE_PERMIT_EXPIRED','PRODUCT',permit.product_id,'发布许可已超过有效期')
      this.createComplianceEnforcementCase(permit.product_id,'P1','在售商品发布许可已过期，需重新执行合规检查','PAUSE_AND_REVIEW')
    }
  }

  private revokeComplianceReleasePermits(productId:string,reason:string,createEnforcement=true) {
    const now=new Date().toISOString()
    const result=this.database.prepare(`UPDATE compliance_release_permits SET status='REVOKED',revoked_at=?,revoke_reason=? WHERE product_id=? AND status='VALID'`).run(now,reason,productId)
    if(result.changes)this.recordComplianceAudit('RELEASE_PERMIT_REVOKED','PRODUCT',productId,`${reason} · ${result.changes} 张许可`)
    if(result.changes&&createEnforcement)this.createComplianceEnforcementCase(productId,'P1',`在售商品发布许可已吊销：${reason}`,'PAUSE_AND_REVIEW')
  }

  issueComplianceReleasePermit(checkId:string,validDays=7):ComplianceReleasePermit {
    this.expireComplianceReleasePermits()
    const check=this.database.prepare(`SELECT * FROM compliance_check_runs WHERE id=?`).get(checkId) as Record<string,unknown>|undefined
    if(!check)throw new Error('合规检查记录不存在')
    const latest=this.database.prepare(`SELECT id FROM compliance_check_runs WHERE product_id=? ORDER BY checked_at DESC LIMIT 1`).get(String(check.product_id)) as {id:string}|undefined
    if(latest?.id!==checkId)throw new Error('该检查已不是商品最新结论，不能签发发布许可')
    const gateStatus=String(check.gate_status)
    if(gateStatus!=='PASSED'&&!(gateStatus==='REVIEW_REQUIRED'&&check.reviewed_at))throw new Error('当前合规结论不允许签发发布许可')
    const existing=this.database.prepare(`SELECT * FROM compliance_release_permits WHERE check_id=? AND status='VALID' AND expires_at>? ORDER BY issued_at DESC LIMIT 1`).get(checkId,new Date().toISOString()) as Record<string,unknown>|undefined
    if(existing)return this.mapComplianceReleasePermit(existing)
    const productId=String(check.product_id)
    this.revokeComplianceReleasePermits(productId,'新的合规检查已签发替代许可',false)
    const issuedAt=new Date().toISOString()
    const expiresAt=new Date(Date.now()+Math.max(1,validDays)*24*60*60_000).toISOString()
    const id=crypto.randomUUID()
    this.database.prepare(`INSERT INTO compliance_release_permits (id,product_id,platform,marketplace_site,check_id,rule_set_version,input_fingerprint,gate_status,issued_at,expires_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,'VALID')`).run(id,productId,String(check.platform),String(check.marketplace_site),checkId,String(check.rule_set_version),String(check.input_fingerprint),gateStatus,issuedAt,expiresAt)
    this.recordComplianceAudit('RELEASE_PERMIT_ISSUED','PRODUCT',productId,`${String(check.marketplace_site)} · ${String(check.rule_set_version)} · 有效至 ${expiresAt}`)
    return this.mapComplianceReleasePermit(this.database.prepare(`SELECT * FROM compliance_release_permits WHERE id=?`).get(id) as Record<string,unknown>)
  }

  getComplianceReleasePermitReport(permitId:string) {
    this.expireComplianceReleasePermits()
    const row=this.database.prepare(`SELECT * FROM compliance_release_permits WHERE id=?`).get(permitId) as Record<string,unknown>|undefined
    if(!row)throw new Error('发布许可不存在')
    const permit=this.mapComplianceReleasePermit(row)
    const check=this.database.prepare(`SELECT request_json,findings_json,reviewed_at,reviewed_by,review_note,checked_at FROM compliance_check_runs WHERE id=?`).get(permit.checkId) as Record<string,unknown>|undefined
    const profile=this.database.prepare(`SELECT * FROM compliance_product_profiles WHERE product_id=?`).get(permit.productId) as Record<string,unknown>|undefined
    const documents=this.database.prepare(`SELECT id,document_type,name,document_number,issuer,expires_at,status,file_name,review_note,updated_at FROM compliance_documents WHERE product_id=? ORDER BY updated_at DESC`).all(permit.productId)
    return {schemaVersion:'COMPLIANCE-RELEASE-PERMIT-V1',generatedAt:new Date().toISOString(),permit,check:check?{request:JSON.parse(String(check.request_json||'{}')),findings:JSON.parse(String(check.findings_json||'[]')),checkedAt:String(check.checked_at),reviewedAt:check.reviewed_at?String(check.reviewed_at):undefined,reviewedBy:check.reviewed_by?String(check.reviewed_by):undefined,reviewNote:check.review_note?String(check.review_note):undefined}:undefined,profile,documents}
  }

  getComplianceEvidenceReport() {
    const workspace=this.getComplianceKnowledgeWorkspace()
    return {
      generatedAt:new Date().toISOString(),
      summary:{...workspace.metrics,openAlerts:workspace.alerts.filter(item=>item.status!=='RESOLVED').length},
      sources:workspace.sources,
      sourceChanges:workspace.sourceChanges,
      alerts:workspace.alerts,
      tasks:workspace.tasks,
      permits:workspace.permits,
      enforcementCases:workspace.enforcementCases,
      auditEvents:workspace.auditEvents,
      latestChecks:workspace.profiles.map(profile=>({productId:profile.productId,check:this.getLatestComplianceCheck(profile.productId)}))
    }
  }

  getComplianceKnowledgeWorkspace():ComplianceKnowledgeWorkspace {
    this.expireComplianceReleasePermits()
    const sourceRows=this.database.prepare(`SELECT * FROM compliance_sources ORDER BY source_type,name`).all() as unknown as Array<Record<string,unknown>>
    const sourceChangeRows=this.database.prepare(`SELECT * FROM compliance_source_changes ORDER BY detected_at DESC LIMIT 100`).all() as unknown as Array<Record<string,unknown>>
    const ruleRows=this.database.prepare(`SELECT * FROM compliance_rules ORDER BY updated_at DESC`).all() as unknown as Array<Record<string,unknown>>
    const versionRows=this.database.prepare(`SELECT * FROM compliance_rule_versions ORDER BY rule_id,version DESC`).all() as unknown as Array<Record<string,unknown>>
    const versions=versionRows.map(row=>({id:String(row.id),ruleId:String(row.rule_id),version:Number(row.version),title:String(row.title),summary:String(row.summary),condition:JSON.parse(String(row.condition_json||'{}')),remediation:String(row.remediation),sourceUrl:String(row.source_url),effectiveFrom:String(row.effective_from),createdAt:String(row.created_at)} satisfies ComplianceRuleVersion))
    const rules=ruleRows.map(row=>this.mapComplianceRule(row,versions.filter(item=>item.ruleId===String(row.id))))
    const recallRows=this.database.prepare(`SELECT * FROM compliance_recalls ORDER BY recall_date DESC,updated_at DESC LIMIT 500`).all() as unknown as Array<Record<string,unknown>>
    const recalls=recallRows.map(row=>({id:String(row.id),sourceId:String(row.source_id),externalId:String(row.external_id),title:String(row.title),description:String(row.description),products:String(row.products),hazards:String(row.hazards),countries:String(row.countries),recallDate:String(row.recall_date),sourceUrl:String(row.source_url),updatedAt:String(row.updated_at)} satisfies ComplianceRecall))
    const sources=sourceRows.map(row=>({id:String(row.id),name:String(row.name),authority:String(row.authority),sourceType:row.source_type as ComplianceSource['sourceType'],url:String(row.url),syncMode:row.sync_mode as ComplianceSource['syncMode'],syncStatus:row.sync_status as ComplianceSource['syncStatus'],lastSyncedAt:row.last_synced_at?String(row.last_synced_at):undefined,lastCheckedAt:row.last_checked_at?String(row.last_checked_at):undefined,lastChangedAt:row.last_changed_at?String(row.last_changed_at):undefined,contentHash:row.content_hash?String(row.content_hash):undefined,changeCount:Number(row.change_count||0),lastError:row.last_error?String(row.last_error):undefined} satisfies ComplianceSource))
    const sourceChanges=sourceChangeRows.map(row=>({id:String(row.id),sourceId:String(row.source_id),oldHash:String(row.old_hash),newHash:String(row.new_hash),summary:String(row.summary),affectedRuleIds:JSON.parse(String(row.affected_rule_ids_json||'[]')) as string[],status:row.status as ComplianceSourceChange['status'],detectedAt:String(row.detected_at),reviewedAt:row.reviewed_at?String(row.reviewed_at):undefined,reviewedBy:row.reviewed_by?String(row.reviewed_by):undefined,reviewNote:row.review_note?String(row.review_note):undefined} satisfies ComplianceSourceChange))
    const profileRows=this.database.prepare(`SELECT * FROM compliance_product_profiles ORDER BY updated_at DESC`).all() as unknown as Array<Record<string,unknown>>
    const profiles=profileRows.map(row=>({id:String(row.id),productId:String(row.product_id),platform:String(row.platform),marketplaceSite:String(row.marketplace_site),country:String(row.country),categoryId:String(row.category_id),categoryName:String(row.category_name),title:String(row.title),brand:String(row.brand),manufacturer:String(row.manufacturer),importer:String(row.importer),euResponsiblePerson:String(row.eu_responsible_person),model:String(row.model),batchNumber:String(row.batch_number),barcode:String(row.barcode),originCountry:String(row.origin_country),materials:String(row.materials),ageGrade:String(row.age_grade),batteryType:String(row.battery_type),updatedAt:String(row.updated_at)} satisfies ComplianceProductProfile))
    const documentRows=this.database.prepare(`SELECT * FROM compliance_documents ORDER BY updated_at DESC`).all() as unknown as Array<Record<string,unknown>>
    const documents=documentRows.map(row=>this.mapComplianceDocument(row))
    documents.filter(item=>item.status==='EXPIRING'||item.status==='EXPIRED').forEach(item=>this.createComplianceTask(item.productId,undefined,'DOCUMENT_EXPIRING',item.status==='EXPIRED'?'P1':'P2',item.status==='EXPIRED'?'合规文件已过期':'合规文件即将过期',`${item.name} · ${item.expiresAt}`))
    const templateRows=this.database.prepare(`SELECT * FROM compliance_category_templates ORDER BY updated_at DESC`).all() as unknown as Array<Record<string,unknown>>
    const templates=templateRows.map(row=>({id:String(row.id),name:String(row.name),platform:String(row.platform),marketplaceSite:String(row.marketplace_site),country:String(row.country),category:String(row.category),requiredFields:JSON.parse(String(row.required_fields_json||'[]')) as string[],requiredDocuments:JSON.parse(String(row.required_documents_json||'[]')) as string[],requiredWarnings:JSON.parse(String(row.required_warnings_json||'[]')) as string[],logisticsRequirements:JSON.parse(String(row.logistics_requirements_json||'[]')) as string[],requiresManualReview:Boolean(row.requires_manual_review),active:Boolean(row.active),updatedAt:String(row.updated_at)} satisfies ComplianceCategoryTemplate))
    const taskRows=this.database.prepare(`SELECT * FROM compliance_tasks ORDER BY CASE risk_level WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, updated_at DESC`).all() as unknown as Array<Record<string,unknown>>
    const tasks=taskRows.map(row=>({id:String(row.id),productId:String(row.product_id),checkId:row.check_id?String(row.check_id):undefined,taskType:row.task_type as ComplianceTaskRecord['taskType'],riskLevel:row.risk_level as ComplianceTaskRecord['riskLevel'],title:String(row.title),detail:String(row.detail),status:row.status as ComplianceTaskStatus,assignee:String(row.assignee),dueAt:String(row.due_at),resolution:String(row.resolution),createdAt:String(row.created_at),updatedAt:String(row.updated_at)} satisfies ComplianceTaskRecord))
    const alertRows=this.database.prepare(`SELECT * FROM compliance_alerts ORDER BY CASE status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END, CASE risk_level WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END, updated_at DESC LIMIT 300`).all() as unknown as Array<Record<string,unknown>>
    const alerts=alertRows.map(row=>({id:String(row.id),alertType:row.alert_type as ComplianceAlert['alertType'],riskLevel:row.risk_level as ComplianceAlert['riskLevel'],entityId:String(row.entity_id),title:String(row.title),detail:String(row.detail),status:row.status as ComplianceAlertStatus,note:String(row.note),createdAt:String(row.created_at),updatedAt:String(row.updated_at)} satisfies ComplianceAlert))
    const auditRows=this.database.prepare(`SELECT * FROM compliance_audit_events ORDER BY created_at DESC LIMIT 500`).all() as unknown as Array<Record<string,unknown>>
    const auditEvents=auditRows.map(row=>({id:String(row.id),action:String(row.action),entityType:String(row.entity_type),entityId:String(row.entity_id),detail:String(row.detail),createdAt:String(row.created_at)} satisfies ComplianceAuditEvent))
    const permitRows=this.database.prepare(`SELECT * FROM compliance_release_permits ORDER BY CASE status WHEN 'VALID' THEN 0 WHEN 'REVOKED' THEN 1 ELSE 2 END,issued_at DESC LIMIT 500`).all() as unknown as Array<Record<string,unknown>>
    const permits=permitRows.map(row=>this.mapComplianceReleasePermit(row))
    const enforcementRows=this.database.prepare(`SELECT * FROM compliance_enforcement_cases ORDER BY CASE status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 ELSE 2 END,CASE risk_level WHEN 'P0' THEN 0 WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 ELSE 3 END,updated_at DESC LIMIT 500`).all() as unknown as Array<Record<string,unknown>>
    const enforcementCases=enforcementRows.map(row=>this.mapComplianceEnforcementCase(row))
    const staleLimit=Date.now()-7*24*60*60_000
    const blockedProducts=(this.database.prepare(`SELECT COUNT(*) AS count FROM (SELECT gate_status,ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY checked_at DESC) AS row_number FROM compliance_check_runs) WHERE row_number=1 AND gate_status='BLOCKED'`).get() as {count:number}).count
    return {sources,sourceChanges,rules,recalls,profiles,documents,templates,tasks,alerts,auditEvents,permits,enforcementCases,metrics:{activeRules:rules.filter(item=>item.reviewStatus==='ACTIVE').length,pendingReview:rules.filter(item=>item.reviewStatus==='PENDING_REVIEW').length,recalls:recalls.length,staleSources:sources.filter(item=>!item.lastSyncedAt||Date.parse(item.lastSyncedAt)<staleLimit).length,profiles:profiles.length,openTasks:tasks.filter(item=>item.status==='OPEN'||item.status==='IN_REVIEW').length,expiringDocuments:documents.filter(item=>item.status==='EXPIRING'||item.status==='EXPIRED').length,blockedProducts,validPermits:permits.filter(item=>item.status==='VALID').length,openEnforcementCases:enforcementCases.filter(item=>item.status!=='RESOLVED').length}}
  }

  saveComplianceRule(draft:ComplianceRuleDraft):ComplianceRule {
    const now=new Date().toISOString()
    const existing=draft.id?this.database.prepare(`SELECT * FROM compliance_rules WHERE id=?`).get(draft.id) as Record<string,unknown>|undefined:undefined
    const id=existing?String(existing.id):crypto.randomUUID()
    const version=existing?Number(existing.current_version)+1:1
    const reviewStatus:ComplianceReviewStatus=existing?'PENDING_REVIEW':draft.reviewStatus
    if(existing)this.database.prepare(`UPDATE compliance_rules SET code=?,platform=?,marketplace_site=?,country=?,category=?,rule_type=?,risk_level=?,review_status=?,current_version=?,updated_at=? WHERE id=?`).run(draft.code,draft.platform,draft.marketplaceSite,draft.country,draft.category,draft.ruleType,draft.riskLevel,reviewStatus,version,now,id)
    else this.database.prepare(`INSERT INTO compliance_rules (id,code,platform,marketplace_site,country,category,rule_type,risk_level,review_status,current_version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,draft.code,draft.platform,draft.marketplaceSite,draft.country,draft.category,draft.ruleType,draft.riskLevel,draft.reviewStatus,version,now,now)
    this.database.prepare(`INSERT INTO compliance_rule_versions (id,rule_id,version,title,summary,condition_json,remediation,source_url,effective_from,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(crypto.randomUUID(),id,version,draft.title,draft.summary,JSON.stringify({keywords:draft.keywords,requiredFields:draft.requiredFields}),draft.remediation,draft.sourceUrl,draft.effectiveFrom,now)
    this.recordComplianceAudit(existing?'RULE_VERSION_CREATED':'RULE_CREATED','RULE',id,`${draft.code} v${version} · ${reviewStatus}`)
    return this.getComplianceKnowledgeWorkspace().rules.find(item=>item.id===id)!
  }

  setComplianceRuleStatus(ruleId:string,status:ComplianceReviewStatus):ComplianceRule {
    const result=this.database.prepare(`UPDATE compliance_rules SET review_status=?,updated_at=? WHERE id=?`).run(status,new Date().toISOString(),ruleId)
    if(!result.changes)throw new Error('合规规则不存在')
    if(status==='ACTIVE'){
      const changes=this.database.prepare(`SELECT id,affected_rule_ids_json FROM compliance_source_changes WHERE status='PENDING_REVIEW'`).all() as Array<{id:string;affected_rule_ids_json:string}>
      for(const change of changes){
        const ids=JSON.parse(change.affected_rule_ids_json||'[]') as string[]
        if(!ids.includes(ruleId)||!ids.length)continue
        const placeholders=ids.map(()=>'?').join(',')
        const pending=(this.database.prepare(`SELECT COUNT(*) AS count FROM compliance_rules WHERE id IN (${placeholders}) AND review_status!='ACTIVE'`).get(...ids) as {count:number}).count
        if(!pending)this.database.prepare(`UPDATE compliance_source_changes SET status='REVIEWED',reviewed_at=?,reviewed_by='逐条规则审核',review_note='全部受影响规则已逐条启用' WHERE id=?`).run(new Date().toISOString(),change.id)
      }
    }
    const workspace=this.getComplianceKnowledgeWorkspace();const rule=workspace.rules.find(item=>item.id===ruleId)!
    if(status==='ACTIVE')workspace.profiles.filter(profile=>(rule.platform==='ALL'||rule.platform===profile.platform)&&(rule.marketplaceSite==='ALL'||rule.marketplaceSite===profile.marketplaceSite)&&(rule.country==='ALL'||rule.country===profile.country||rule.country==='EU'&&['DE','FR','IT','ES','NL','BE','PL','SE','IE','AT'].includes(profile.country))&&(rule.category==='ALL'||rule.category===profile.categoryId||rule.category===profile.categoryName)).forEach(profile=>this.createComplianceTask(profile.productId,undefined,'RULE_UPDATE',rule.riskLevel,`规则更新后需重新检查：${rule.version.title}`,`${rule.code} v${rule.currentVersion}`))
    this.recordComplianceAudit('RULE_STATUS_UPDATED','RULE',ruleId,`${rule.code} v${rule.currentVersion} · ${status}`)
    return rule
  }

  reviewComplianceSourceChange(changeId:string,decision:ComplianceSourceChangeDecision,reviewedBy:string,note:string):ComplianceSourceChangeReviewResult {
    const change=this.database.prepare(`SELECT * FROM compliance_source_changes WHERE id=?`).get(changeId) as Record<string,unknown>|undefined
    if(!change)throw new Error('政策变化记录不存在')
    if(String(change.status)!=='PENDING_REVIEW')throw new Error('该政策变化已经完成审批')
    if(!reviewedBy.trim())throw new Error('请输入审批人')
    if(!note.trim())throw new Error('请输入审批意见')
    const newer=this.database.prepare(`SELECT COUNT(*) AS count FROM compliance_source_changes WHERE source_id=? AND status='PENDING_REVIEW' AND detected_at>?`).get(String(change.source_id),String(change.detected_at)) as {count:number}
    if(newer.count)throw new Error('该来源存在更新的待审批变化，请先处理最新变化')
    const sourceId=String(change.source_id)
    const affectedRuleIds=JSON.parse(String(change.affected_rule_ids_json||'[]')) as string[]
    const source=this.database.prepare(`SELECT name FROM compliance_sources WHERE id=?`).get(sourceId) as {name:string}|undefined
    const platformBySource:Record<string,string>={'source-ebay':'EBAY','source-ozon':'OZON','source-aliexpress':'ALIEXPRESS'}
    const platform=platformBySource[sourceId]||'ALL'
    const now=new Date().toISOString()
    this.database.exec('BEGIN IMMEDIATE')
    try{
      if(decision==='APPROVED'){
        for(const ruleId of affectedRuleIds)this.database.prepare(`UPDATE compliance_rules SET review_status='ACTIVE',updated_at=? WHERE id=?`).run(now,ruleId)
        this.database.prepare(`UPDATE compliance_source_changes SET status='REVIEWED',reviewed_at=?,reviewed_by=?,review_note=? WHERE source_id=? AND status='PENDING_REVIEW'`).run(now,reviewedBy.trim(),note.trim(),sourceId)
      }else{
        for(const ruleId of affectedRuleIds){
          const rule=this.database.prepare(`SELECT current_version FROM compliance_rules WHERE id=?`).get(ruleId) as {current_version:number}|undefined
          if(!rule)continue
          const previousVersion=Math.max(1,Number(rule.current_version)-1)
          this.database.prepare(`UPDATE compliance_rules SET current_version=?,review_status='ACTIVE',updated_at=? WHERE id=?`).run(previousVersion,now,ruleId)
        }
        this.database.prepare(`UPDATE compliance_source_changes SET status='REJECTED',reviewed_at=?,reviewed_by=?,review_note=? WHERE id=?`).run(now,reviewedBy.trim(),note.trim(),changeId)
        const olderPending=(this.database.prepare(`SELECT COUNT(*) AS count FROM compliance_source_changes WHERE source_id=? AND status='PENDING_REVIEW'`).get(sourceId) as {count:number}).count
        if(olderPending&&affectedRuleIds.length){
          const placeholders=affectedRuleIds.map(()=>'?').join(',')
          this.database.prepare(`UPDATE compliance_rules SET review_status='PENDING_REVIEW',updated_at=? WHERE id IN (${placeholders})`).run(now,...affectedRuleIds)
        }
      }
      const remaining=(this.database.prepare(`SELECT COUNT(*) AS count FROM compliance_source_changes WHERE source_id=? AND status='PENDING_REVIEW'`).get(sourceId) as {count:number}).count
      if(!remaining){
        this.database.prepare(`UPDATE compliance_tasks SET status='RESOLVED',resolution=?,updated_at=? WHERE task_type='RULE_UPDATE' AND status IN ('OPEN','IN_REVIEW') AND title LIKE ?`).run(`政策变化已${decision==='APPROVED'?'批准':'驳回'}：${note.trim()}`,now,`${platform} 官方政策来源发生变化%`)
        this.database.prepare(`UPDATE compliance_alerts SET status='RESOLVED',note=?,updated_at=? WHERE alert_type='SOURCE_CHANGE' AND entity_id=? AND status IN ('OPEN','ACKNOWLEDGED')`).run(`${reviewedBy.trim()}：${note.trim()}`,now,sourceId)
      }
      this.database.exec('COMMIT')
    }catch(error){
      this.database.exec('ROLLBACK')
      throw error
    }
    this.recordComplianceAudit(decision==='APPROVED'?'SOURCE_CHANGE_APPROVED':'SOURCE_CHANGE_REJECTED','SOURCE_CHANGE',changeId,`${source?.name||sourceId} · ${reviewedBy.trim()} · ${note.trim()}`)
    const recheck=this.recheckComplianceProfiles(platform)
    const workspace=this.getComplianceKnowledgeWorkspace()
    return {change:workspace.sourceChanges.find(item=>item.id===changeId)!,recheck,workspace}
  }

  importComplianceRecalls(sourceId:string,items:Array<Omit<ComplianceRecall,'id'|'sourceId'|'updatedAt'>>):number {
    const now=new Date().toISOString()
    const statement=this.database.prepare(`INSERT INTO compliance_recalls (id,source_id,external_id,title,description,products,hazards,countries,recall_date,source_url,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(source_id,external_id) DO UPDATE SET title=excluded.title,description=excluded.description,products=excluded.products,hazards=excluded.hazards,countries=excluded.countries,recall_date=excluded.recall_date,source_url=excluded.source_url,updated_at=excluded.updated_at`)
    items.forEach(item=>statement.run(crypto.randomUUID(),sourceId,item.externalId,item.title,item.description,item.products,item.hazards,item.countries,item.recallDate,item.sourceUrl,now))
    this.database.prepare(`UPDATE compliance_sources SET sync_status='READY',last_synced_at=?,last_checked_at=?,last_error=NULL WHERE id=?`).run(now,now,sourceId)
    const profiles=this.database.prepare(`SELECT product_id,title,model,country FROM compliance_product_profiles`).all() as unknown as Array<{product_id:string;title:string;model:string;country:string}>
    for(const item of items){
      for(const profile of profiles){
        if(this.requiredRecallSourceId(profile.country)!==sourceId)continue
        const text=`${profile.title} ${profile.model}`
        if(complianceRecallMatches(text,`${item.title} ${item.products}`)){
          this.createComplianceTask(profile.product_id,undefined,'RECALL_MATCH','P0',`疑似命中新增官方召回：${item.title}`,`${item.hazards||item.description} · ${item.sourceUrl}`)
          this.createComplianceAlert('RECALL_MATCH','P0',profile.product_id,`商品疑似命中官方召回：${item.title}`,`${item.hazards||item.description} · ${item.sourceUrl}`)
          this.revokeComplianceReleasePermits(profile.product_id,'商品疑似命中新增官方召回')
        }
      }
    }
    this.recordComplianceAudit('RECALL_SOURCE_SYNCED','SOURCE',sourceId,`导入或更新 ${items.length} 条官方召回记录`)
    return items.length
  }

  recordCompliancePolicySnapshot(sourceId:string,contentHash:string,summary:string):{changed:boolean;versionsCreated:number} {
    const source=this.database.prepare(`SELECT content_hash FROM compliance_sources WHERE id=?`).get(sourceId) as {content_hash:string}|undefined
    if(!source)throw new Error('合规来源不存在')
    const now=new Date().toISOString()
    const oldHash=source.content_hash||''
    if(!oldHash){
      this.database.prepare(`UPDATE compliance_sources SET content_hash=?,sync_status='READY',last_synced_at=?,last_checked_at=?,last_error=NULL WHERE id=?`).run(contentHash,now,now,sourceId)
      return {changed:false,versionsCreated:0}
    }
    if(oldHash===contentHash){
      this.database.prepare(`UPDATE compliance_sources SET sync_status='READY',last_synced_at=?,last_checked_at=?,last_error=NULL WHERE id=?`).run(now,now,sourceId)
      return {changed:false,versionsCreated:0}
    }
    const platformBySource:Record<string,string>={'source-ebay':'EBAY','source-ozon':'OZON','source-aliexpress':'ALIEXPRESS'}
    const platform=platformBySource[sourceId]
    if(!platform)throw new Error('当前来源不支持政策变化检测')
    const rules=this.database.prepare(`SELECT * FROM compliance_rules WHERE platform=? AND review_status IN ('ACTIVE','PENDING_REVIEW')`).all(platform) as unknown as Array<Record<string,unknown>>
    const affectedRuleIds:string[]=[]
    this.database.exec('BEGIN IMMEDIATE')
    try{
      for(const rule of rules){
        const id=String(rule.id)
        const currentVersion=Number(rule.current_version)
        const current=this.database.prepare(`SELECT * FROM compliance_rule_versions WHERE rule_id=? AND version=?`).get(id,currentVersion) as Record<string,unknown>|undefined
        if(!current)continue
        const nextVersion=currentVersion+1
        this.database.prepare(`INSERT INTO compliance_rule_versions (id,rule_id,version,title,summary,condition_json,remediation,source_url,effective_from,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
          crypto.randomUUID(),id,nextVersion,String(current.title),`【官方来源发生变化，待人工核对】${String(current.summary)}`,String(current.condition_json),String(current.remediation),String(current.source_url),now.slice(0,10),now
        )
        this.database.prepare(`UPDATE compliance_rules SET current_version=?,review_status='PENDING_REVIEW',updated_at=? WHERE id=?`).run(nextVersion,now,id)
        affectedRuleIds.push(id)
      }
      this.database.prepare(`INSERT INTO compliance_source_changes (id,source_id,old_hash,new_hash,summary,affected_rule_ids_json,status,detected_at) VALUES (?,?,?,?,?,?,'PENDING_REVIEW',?)`).run(crypto.randomUUID(),sourceId,oldHash,contentHash,summary,JSON.stringify(affectedRuleIds),now)
      this.database.prepare(`UPDATE compliance_sources SET content_hash=?,sync_status='READY',last_synced_at=?,last_checked_at=?,last_changed_at=?,change_count=change_count+1,last_error=NULL WHERE id=?`).run(contentHash,now,now,now,sourceId)
      this.database.exec('COMMIT')
    }catch(error){
      this.database.exec('ROLLBACK')
      throw error
    }
    const profiles=this.database.prepare(`SELECT product_id FROM compliance_product_profiles WHERE platform=?`).all(platform) as Array<{product_id:string}>
    for(const profile of profiles){this.createComplianceTask(profile.product_id,undefined,'RULE_UPDATE','P1',`${platform} 官方政策来源发生变化`,`已生成 ${affectedRuleIds.length} 个待审核规则版本；审核生效后重新执行商品门禁。`);this.revokeComplianceReleasePermits(profile.product_id,'官方政策来源发生变化，需重新检查')}
    this.createComplianceAlert('SOURCE_CHANGE','P1',sourceId,`${platform} 官方政策来源发生变化`,`${summary}；已生成 ${affectedRuleIds.length} 个待审核规则版本。`)
    this.recordComplianceAudit('SOURCE_POLICY_CHANGED','SOURCE',sourceId,`${summary} · ${affectedRuleIds.length} 个待审核版本`)
    return {changed:true,versionsCreated:affectedRuleIds.length}
  }

  markComplianceSourceError(sourceId:string,error:string) {
    this.database.prepare(`UPDATE compliance_sources SET sync_status='ERROR',last_checked_at=?,last_error=? WHERE id=?`).run(new Date().toISOString(),error,sourceId)
    this.createComplianceAlert('SOURCE_ERROR','P2',sourceId,'官方合规来源检测异常',error)
    this.recordComplianceAudit('SOURCE_SYNC_FAILED','SOURCE',sourceId,error)
  }

  private complianceScopeMatches(rule:{platform:string;marketplaceSite:string;country:string;category:string},request:Pick<ComplianceCheckRequest,'platform'|'marketplaceSite'|'country'|'categoryId'|'categoryName'>) {
    const euCountries=['DE','FR','IT','ES','NL','BE','PL','SE','IE','AT','DK','FI','PT','CZ','SK','HU','RO','BG','HR','SI','LT','LV','EE','LU','MT','CY','GR']
    return (rule.platform==='ALL'||rule.platform===request.platform)
      &&(rule.marketplaceSite==='ALL'||rule.marketplaceSite===request.marketplaceSite)
      &&(rule.country==='ALL'||rule.country===request.country||rule.country==='EU'&&euCountries.includes(request.country))
      &&(rule.category==='ALL'||rule.category===request.categoryId||rule.category===request.categoryName)
  }

  private requiredRecallSourceId(country:string) {
    const euCountries=['EU','DE','FR','IT','ES','NL','BE','PL','SE','IE','AT','DK','FI','PT','CZ','SK','HU','RO','BG','HR','SI','LT','LV','EE','LU','MT','CY','GR']
    if(country==='US')return 'source-cpsc'
    if(country==='GB'||country==='UK')return 'source-uk-opss'
    if(euCountries.includes(country))return 'source-eu-safety-gate'
    return ''
  }

  private complianceRuleSetVersion(request:Pick<ComplianceCheckRequest,'productId'|'platform'|'marketplaceSite'|'country'|'categoryId'|'categoryName'>,workspace:ComplianceKnowledgeWorkspace) {
    const active=workspace.rules.filter(rule=>rule.reviewStatus==='ACTIVE'&&this.complianceScopeMatches(rule,request))
    const templates=workspace.templates.filter(template=>template.active&&this.complianceScopeMatches(template,request))
    const documents=workspace.documents.filter(document=>document.productId===request.productId)
    const recallSourceId=this.requiredRecallSourceId(request.country)
    const recallSource=workspace.sources.find(source=>source.id===recallSourceId)
    const recallSignature=recallSourceId?`${recallSourceId}@${recallSource?.syncStatus||'NOT_CONFIGURED'}@${recallSource?.lastSyncedAt||'NOT_READY'}`:'NOT_APPLICABLE'
    const signature=[...active.map(rule=>`rule:${rule.code}@${rule.currentVersion}`),...templates.map(template=>`template:${template.id}@${template.updatedAt}`),...documents.map(document=>`document:${document.id}@${document.status}@${document.expiresAt}@${document.updatedAt}`),`recall:${recallSignature}`].sort().join('|')
    let hash=2166136261
    for(let index=0;index<signature.length;index+=1){hash^=signature.charCodeAt(index);hash=Math.imul(hash,16777619)}
    return `${request.platform}:${active.length}:v1-${(hash>>>0).toString(16).padStart(8,'0')}`
  }

  private runEbayDetailPageCheck(request:ComplianceCheckRequest):ComplianceCheckResult {
    const findings:ComplianceFinding[]=[]
    const title=request.title.trim()
    const imageUrl=(request.imageUrl||'').trim()
    if(!title)findings.push({id:crypto.randomUUID(),ruleId:'EBAY-DESCRIPTION-REQUIRED',ruleCode:'EBAY-DESCRIPTION-REQUIRED',riskLevel:'P0',title:'缺少商品标题',matchedContent:'标题为空',reason:'eBay 商品详情需要准确、清晰的商品标题。',remediation:'补充准确描述当前商品的标题后重新检查。',sourceUrl:'https://www.ebay.com/help/policies/listing-policies/item-description-policy?id=4372',ruleVersion:1,effectiveFrom:'2026-07-21',requiresReview:false})
    else if(title.length>80)findings.push({id:crypto.randomUUID(),ruleId:'EBAY-TITLE-LENGTH',ruleCode:'EBAY-TITLE-LENGTH',riskLevel:'P0',title:'eBay 标题超过 80 字符',matchedContent:`当前 ${title.length} 字符`,reason:'eBay 刊登标题最多使用 80 个字符。',remediation:'删除重复词和无关词，将标题控制在 80 字符以内。',sourceUrl:'https://www.ebay.com/sellercenter/listings/create-listings',ruleVersion:1,effectiveFrom:'2026-07-21',requiresReview:false})
    if(!imageUrl)findings.push({id:crypto.randomUUID(),ruleId:'EBAY-PICTURE-REQUIRED',ruleCode:'EBAY-PICTURE-REQUIRED',riskLevel:'P0',title:'缺少商品主图',matchedContent:'图片为空',reason:'eBay 要求每个刊登至少包含一张真实反映商品的图片。',remediation:'补充一张真实、清晰且与商品一致的主图后重新检查。',sourceUrl:'https://www.ebay.com/help/listing-policies/policies/picture-policy?id=4370',ruleVersion:1,effectiveFrom:'2026-07-21',requiresReview:false})
    const gateStatus:ComplianceCheckResult['gateStatus']=findings.length?'BLOCKED':'PASSED'
    const checkedAt=new Date().toISOString()
    const id=crypto.randomUUID()
    const ruleSetVersion='EBAY-DETAIL-PAGE-2026.07.21'
    const inputFingerprint=complianceCheckFingerprint(request)
    const result:ComplianceCheckResult={id,productId:request.productId,gateStatus,checkedAt,ruleSetVersion,inputFingerprint,findings}
    this.database.prepare(`INSERT INTO compliance_check_runs (id,product_id,platform,marketplace_site,country,gate_status,rule_set_version,input_fingerprint,request_json,findings_json,checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id,request.productId,request.platform,request.marketplaceSite,request.country,gateStatus,ruleSetVersion,inputFingerprint,JSON.stringify(request),JSON.stringify(findings),checkedAt)
    this.revokeComplianceReleasePermits(request.productId,'商品产生了新的 eBay 详情页检查结论',false)
    if(gateStatus==='PASSED'){
      this.database.prepare(`UPDATE compliance_tasks SET status='RESOLVED',resolution='最新 eBay 详情页检查已通过',updated_at=? WHERE product_id=? AND status IN ('OPEN','IN_REVIEW') AND task_type!='RECALL_MATCH'`).run(checkedAt,request.productId)
      this.database.prepare(`UPDATE compliance_alerts SET status='RESOLVED',note='最新 eBay 详情页检查已通过',updated_at=? WHERE entity_id=? AND alert_type='PUBLISH_BLOCK' AND status IN ('OPEN','ACKNOWLEDGED')`).run(checkedAt,request.productId)
      this.issueComplianceReleasePermit(id)
      this.resolveComplianceEnforcementCases(request.productId,'最新 eBay 详情页检查已通过')
    }else{
      this.createComplianceTask(request.productId,id,'MANUAL_REVIEW','P0','eBay 详情页资料需要修改',findings.map(item=>item.title).join('；'))
      this.createComplianceAlert('PUBLISH_BLOCK','P0',request.productId,'eBay 详情页资料需要修改',findings.map(item=>item.title).join('；'))
    }
    this.recordComplianceAudit('PRODUCT_COMPLIANCE_CHECKED','PRODUCT',request.productId,`${gateStatus} · eBay 详情页检查 · ${findings.length} 个问题`)
    return result
  }

  runComplianceCheck(request:ComplianceCheckRequest):ComplianceCheckResult {
    if(request.platform==='EBAY')return this.runEbayDetailPageCheck(request)
    const specific=(...names:string[])=>request.itemSpecifics?.find(item=>names.some(name=>item.name.toLowerCase().includes(name)))?.value||''
    this.saveComplianceProfile({productId:request.productId,platform:request.platform,marketplaceSite:request.marketplaceSite,country:request.country,categoryId:request.categoryId||'',categoryName:request.categoryName||'',title:request.title,brand:specific('brand','品牌'),manufacturer:specific('manufacturer','制造商'),importer:specific('importer','进口商'),euResponsiblePerson:specific('responsible','负责人'),model:specific('model','型号'),batchNumber:specific('batch','批次'),barcode:specific('barcode','upc','ean','条码'),originCountry:specific('country of origin','原产地'),materials:specific('material','材质'),ageGrade:specific('age','年龄'),batteryType:specific('battery','电池')})
    const workspace=this.getComplianceKnowledgeWorkspace()
    const scoped=workspace.rules.filter(rule=>rule.reviewStatus==='ACTIVE'&&this.complianceScopeMatches(rule,request))
    const pending=workspace.rules.filter(rule=>rule.reviewStatus==='PENDING_REVIEW'&&this.complianceScopeMatches(rule,request))
    const text=`${request.title}\n${request.description||''}`.toLowerCase()
    const fields:Record<string,unknown>={...request,itemSpecifics:request.itemSpecifics?.length?request.itemSpecifics:undefined,brand:specific('brand','品牌'),manufacturer:specific('manufacturer','制造商'),importer:specific('importer','进口商'),euResponsiblePerson:specific('responsible','负责人'),model:specific('model','型号'),batchNumber:specific('batch','批次'),barcode:specific('barcode','upc','ean','条码'),originCountry:specific('country of origin','原产地')}
    const findings:ComplianceFinding[]=[]
    if(request.platform==='EBAY'&&request.title.trim().length>80)findings.push({id:crypto.randomUUID(),ruleId:'EBAY-TITLE-LENGTH',ruleCode:'EBAY-TITLE-LENGTH',riskLevel:'P0',title:'eBay 标题超过 80 字符',matchedContent:`当前 ${request.title.trim().length} 字符`,reason:'eBay 刊登标题有硬性长度限制，超长内容无法正常发布。',remediation:'缩短标题至 80 字符以内后重新检查。',sourceUrl:'https://www.ebay.com/help/selling/listings/creating-managing-listings/listing-policies?id=4213',ruleVersion:1,effectiveFrom:'2025-01-01',requiresReview:false})
    if(pending.length)findings.push({id:crypto.randomUUID(),ruleId:'KNOWLEDGE-REVIEW-PENDING',ruleCode:'KNOWLEDGE-REVIEW-PENDING',riskLevel:'P1',title:'适用规则存在待审核版本',matchedContent:pending.map(item=>`${item.code} v${item.currentVersion}`).join('、'),reason:'规则变更尚未完成人工审核，检查引擎不会将未审核规则当作已生效依据。',remediation:'请在合规知识库完成规则审核并启用，然后重新执行商品合规检查。',sourceUrl:'',ruleVersion:Math.max(...pending.map(item=>item.currentVersion)),effectiveFrom:new Date().toISOString().slice(0,10),requiresReview:true})
    const templates=workspace.templates.filter(template=>template.active&&this.complianceScopeMatches(template,request))
    const approvedDocumentTypes=new Set(workspace.documents.filter(item=>item.productId===request.productId&&(item.status==='APPROVED'||item.status==='EXPIRING')).map(item=>item.documentType))
    for(const template of templates){
      const missingDocuments=template.requiredDocuments.filter(type=>!approvedDocumentTypes.has(type))
      if(missingDocuments.length)findings.push({id:crypto.randomUUID(),ruleId:`template:${template.id}`,ruleCode:'CATEGORY-DOCUMENTS-REQUIRED',riskLevel:'P1',title:`${template.name}：合规资料不完整`,matchedContent:`缺少：${missingDocuments.join('、')}`,reason:'当前平台、站点、国家和类目模板要求提供对应合规资料。',remediation:'在商品合规档案中补充文件，完成人工审核后重新检查。',sourceUrl:'',ruleVersion:1,effectiveFrom:template.updatedAt.slice(0,10),requiresReview:true})
      if(template.requiresManualReview&&!missingDocuments.length)findings.push({id:crypto.randomUUID(),ruleId:`template:${template.id}`,ruleCode:'CATEGORY-MANUAL-REVIEW',riskLevel:'P1',title:`${template.name}：需人工复核`,matchedContent:'资料已齐全，等待适用性核验',reason:'该类目模板设置了发布前人工复核。',remediation:'由合规负责人核对文件、型号、标签与销售市场的一致性。',sourceUrl:'',ruleVersion:1,effectiveFrom:template.updatedAt.slice(0,10),requiresReview:true})
    }
    for(const rule of scoped){
      const keywords=rule.version.condition.keywords||[]
      const matchedKeywords=keywords.filter(keyword=>text.includes(keyword.toLowerCase()))
      const missing=(rule.version.condition.requiredFields||[]).filter(field=>!fields[field]||(Array.isArray(fields[field])&&!fields[field]?.length))
      if(!matchedKeywords.length&&!missing.length)continue
      findings.push({id:crypto.randomUUID(),ruleId:rule.id,ruleCode:rule.code,riskLevel:rule.riskLevel,title:rule.version.title,matchedContent:matchedKeywords.length?matchedKeywords.join('、'):`缺少字段：${missing.join('、')}`,reason:rule.version.summary,remediation:rule.version.remediation,sourceUrl:rule.version.sourceUrl,ruleVersion:rule.currentVersion,effectiveFrom:rule.version.effectiveFrom,requiresReview:rule.riskLevel==='P1'})
    }
    const recallText=`${request.title} ${request.description||''}`.toLowerCase()
    const requiredRecallSourceId=this.requiredRecallSourceId(request.country)
    for(const recall of workspace.recalls.filter(item=>requiredRecallSourceId&&item.sourceId===requiredRecallSourceId)){
      if(complianceRecallMatches(recallText,`${recall.title} ${recall.products}`))findings.push({id:crypto.randomUUID(),ruleId:`recall:${recall.id}`,ruleCode:'OFFICIAL-RECALL-MATCH',riskLevel:'P0',title:'疑似命中官方召回商品',matchedContent:recall.title,reason:recall.hazards||recall.description,remediation:'立即停止发布，核对型号、批次和召回范围，并提交人工复核。',sourceUrl:recall.sourceUrl,ruleVersion:1,effectiveFrom:recall.recallDate,requiresReview:true})
    }
    if(request.platform==='EBAY'&&requiredRecallSourceId){
      const source=workspace.sources.find(item=>item.id===requiredRecallSourceId)
      if(source?.syncStatus!=='READY'||!workspace.recalls.some(item=>item.sourceId===requiredRecallSourceId)){
        const sourceName=requiredRecallSourceId==='source-cpsc'?'CPSC':requiredRecallSourceId==='source-uk-opss'?'UK OPSS':'EU Safety Gate'
        findings.push({id:crypto.randomUUID(),ruleId:`${requiredRecallSourceId}-STALE`,ruleCode:'OFFICIAL-RECALL-SOURCE-STALE',riskLevel:'P1',title:`${sourceName} 官方召回库未就绪`,matchedContent:source?.syncStatus||'NOT_CONFIGURED',reason:`缺少可用的 ${sourceName} 官方召回数据时，系统不能将该市场商品误判为已排除召回风险。`,remediation:requiredRecallSourceId==='source-eu-safety-gate'?'打开 EU Safety Gate 官方页面人工核验并留存复核结论；在验证稳定官方接口前不会伪装自动同步。':`在合规知识库同步 ${sourceName} 数据，或人工查证官方召回页并留存复核结论。`,sourceUrl:source?.url||'',ruleVersion:1,effectiveFrom:new Date().toISOString().slice(0,10),requiresReview:true})
      }
    }
    const gateStatus=findings.some(item=>item.riskLevel==='P0')?'BLOCKED':findings.some(item=>item.riskLevel==='P1')?'REVIEW_REQUIRED':findings.some(item=>item.riskLevel==='P2')?'RECHECK_REQUIRED':'PASSED'
    const checkedAt=new Date().toISOString();const id=crypto.randomUUID();const ruleSetVersion=this.complianceRuleSetVersion(request,workspace);const inputFingerprint=complianceCheckFingerprint(request)
    const result:ComplianceCheckResult={id,productId:request.productId,gateStatus,checkedAt,ruleSetVersion,inputFingerprint,findings}
    this.database.prepare(`INSERT INTO compliance_check_runs (id,product_id,platform,marketplace_site,country,gate_status,rule_set_version,input_fingerprint,request_json,findings_json,checked_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id,request.productId,request.platform,request.marketplaceSite,request.country,gateStatus,ruleSetVersion,inputFingerprint,JSON.stringify(request),JSON.stringify(findings),checkedAt)
    this.revokeComplianceReleasePermits(request.productId,'商品产生了新的合规检查结论',false)
    if(!findings.some(item=>item.ruleCode==='OFFICIAL-RECALL-MATCH'))this.database.prepare(`UPDATE compliance_tasks SET status='RESOLVED',resolution='最新检查未再命中官方召回',updated_at=? WHERE product_id=? AND task_type='RECALL_MATCH' AND status IN ('OPEN','IN_REVIEW')`).run(checkedAt,request.productId)
    if(gateStatus!=='PASSED'){
      const risk=findings.some(item=>item.riskLevel==='P0')?'P0':findings.some(item=>item.riskLevel==='P1')?'P1':'P2'
      const type=findings.some(item=>item.ruleCode==='OFFICIAL-RECALL-MATCH')?'RECALL_MATCH':findings.some(item=>item.ruleCode==='CATEGORY-DOCUMENTS-REQUIRED')?'DOCUMENT_MISSING':'MANUAL_REVIEW'
      this.createComplianceTask(request.productId,id,type,risk,gateStatus==='BLOCKED'?'商品已被合规门禁阻断':'商品需要合规复核',findings.map(item=>item.title).join('；'))
      this.createComplianceAlert(findings.some(item=>item.ruleCode==='OFFICIAL-RECALL-MATCH')?'RECALL_MATCH':'PUBLISH_BLOCK',risk,request.productId,gateStatus==='BLOCKED'?'商品已被合规门禁阻断':'商品需要合规复核',findings.map(item=>item.title).join('；'))
      this.createComplianceEnforcementCase(request.productId,risk,findings.map(item=>item.title).join('；'),risk==='P0'?'REMOVE_LISTING':risk==='P1'?'PAUSE_AND_REVIEW':'CORRECT_AND_RECHECK')
    }else{
      this.database.prepare(`UPDATE compliance_tasks SET status='RESOLVED',resolution='最新合规检查已通过',updated_at=? WHERE product_id=? AND status IN ('OPEN','IN_REVIEW') AND task_type!='RECALL_MATCH'`).run(checkedAt,request.productId)
      this.database.prepare(`UPDATE compliance_alerts SET status='RESOLVED',note='最新合规检查已通过',updated_at=? WHERE entity_id=? AND alert_type='PUBLISH_BLOCK' AND status IN ('OPEN','ACKNOWLEDGED')`).run(checkedAt,request.productId)
    }
    this.recordComplianceAudit('PRODUCT_COMPLIANCE_CHECKED','PRODUCT',request.productId,`${gateStatus} · ${findings.length} 个命中项 · ${ruleSetVersion}`)
    if(gateStatus==='PASSED'){
      this.issueComplianceReleasePermit(id)
      this.resolveComplianceEnforcementCases(request.productId,'最新合规检查已通过并签发新许可')
    }
    return result
  }

  recheckComplianceProfiles(platform='ALL',country='ALL'):ComplianceBatchRecheckResult {
    const profiles=this.database.prepare(`SELECT product_id,platform,country FROM compliance_product_profiles WHERE (?='ALL' OR platform=?) AND (?='ALL' OR country=?) ORDER BY updated_at DESC`).all(platform,platform,country,country) as unknown as Array<{product_id:string;platform:string;country:string}>
    const result:ComplianceBatchRecheckResult={total:profiles.length,checked:0,skipped:0,passed:0,reviewRequired:0,recheckRequired:0,blocked:0,checkedAt:new Date().toISOString()}
    for(const profile of profiles){
      const row=this.database.prepare(`SELECT request_json FROM compliance_check_runs WHERE product_id=? AND request_json!='{}' ORDER BY checked_at DESC LIMIT 1`).get(profile.product_id) as {request_json:string}|undefined
      if(!row){result.skipped+=1;continue}
      try{
        const request=JSON.parse(row.request_json) as ComplianceCheckRequest
        if(!request.productId||!request.platform||!request.title){result.skipped+=1;continue}
        const checked=this.runComplianceCheck(request)
        result.checked+=1
        if(checked.gateStatus==='PASSED')result.passed+=1
        else if(checked.gateStatus==='BLOCKED')result.blocked+=1
        else if(checked.gateStatus==='REVIEW_REQUIRED')result.reviewRequired+=1
        else result.recheckRequired+=1
      }catch{
        result.skipped+=1
      }
    }
    result.checkedAt=new Date().toISOString()
    return result
  }

  getLatestComplianceCheck(productId:string):ComplianceCheckResult|undefined {
    const row=this.database.prepare(`SELECT * FROM compliance_check_runs WHERE product_id=? ORDER BY checked_at DESC LIMIT 1`).get(productId) as Record<string,unknown>|undefined
    if(!row)return undefined
    const workspace=this.getComplianceKnowledgeWorkspace()
    const profile=this.database.prepare(`SELECT category_id,category_name FROM compliance_product_profiles WHERE product_id=?`).get(productId) as {category_id:string;category_name:string}|undefined
    const scope={productId,platform:String(row.platform),marketplaceSite:String(row.marketplace_site),country:String(row.country),categoryId:profile?.category_id||'',categoryName:profile?.category_name||''}
    const currentRuleSetVersion=this.complianceRuleSetVersion(scope,workspace)
    const stale=String(row.rule_set_version)!==currentRuleSetVersion
    const rules=workspace.rules.filter(item=>item.reviewStatus==='ACTIVE'&&this.complianceScopeMatches(item,scope))
    const findings=JSON.parse(String(row.findings_json||'[]')) as ComplianceFinding[]
    if(stale)findings.unshift({id:`ruleset:${row.id}`,ruleId:'RULESET-UPDATED',ruleCode:'RULESET-UPDATED',riskLevel:'P2',title:'合规规则库已更新',matchedContent:`${String(row.rule_set_version)} → ${currentRuleSetVersion}`,reason:'该商品的上次检查使用了旧规则集，原结论不再作为发布依据。',remediation:'使用当前规则库重新执行合规检查。',sourceUrl:'',ruleVersion:Math.max(0,...rules.map(item=>item.currentVersion)),effectiveFrom:new Date().toISOString().slice(0,10),requiresReview:false})
    const gateStatus=row.gate_status==='BLOCKED'?'BLOCKED':stale?'RECHECK_REQUIRED':row.gate_status as ComplianceCheckResult['gateStatus']
    return {id:String(row.id),productId:String(row.product_id),gateStatus,checkedAt:String(row.checked_at),ruleSetVersion:String(row.rule_set_version),inputFingerprint:String(row.input_fingerprint||''),findings,reviewedAt:!stale&&row.reviewed_at?String(row.reviewed_at):undefined,reviewedBy:!stale&&row.reviewed_by?String(row.reviewed_by):undefined,reviewNote:!stale&&row.review_note?String(row.review_note):undefined}
  }

  reviewComplianceCheck(checkId:string,reviewedBy:string,note:string):ComplianceCheckResult {
    const current=this.database.prepare(`SELECT product_id,gate_status,findings_json FROM compliance_check_runs WHERE id=?`).get(checkId) as {product_id:string;gate_status:string;findings_json:string}|undefined
    if(!current)throw new Error('合规检查记录不存在')
    if(current.gate_status!=='REVIEW_REQUIRED')throw new Error('仅“待人工复核”的检查记录可以提交复核留痕')
    const findings=JSON.parse(current.findings_json||'[]') as ComplianceFinding[]
    if(findings.some(item=>item.ruleCode==='CATEGORY-DOCUMENTS-REQUIRED'))throw new Error('强制合规文件尚未齐全，不能通过人工复核绕过；请先补齐并审核文件后重新检查。')
    const reviewedAt=new Date().toISOString()
    this.database.prepare(`UPDATE compliance_check_runs SET reviewed_at=?,reviewed_by=?,review_note=? WHERE id=?`).run(reviewedAt,reviewedBy.trim()||'本机用户',note.trim(),checkId)
    this.database.prepare(`UPDATE compliance_tasks SET status='RESOLVED',assignee=?,resolution=?,updated_at=? WHERE product_id=? AND status IN ('OPEN','IN_REVIEW') AND task_type IN ('MANUAL_REVIEW','DOCUMENT_MISSING','REMEDIATION','RULE_UPDATE')`).run(reviewedBy.trim()||'本机用户',note.trim(),reviewedAt,current.product_id)
    this.recordComplianceAudit('COMPLIANCE_REVIEW_APPROVED','PRODUCT',current.product_id,`${reviewedBy.trim()||'本机用户'} · ${note.trim()}`)
    this.issueComplianceReleasePermit(checkId)
    this.resolveComplianceEnforcementCases(current.product_id,'人工复核已通过并签发新许可')
    return this.getLatestComplianceCheck(current.product_id)!
  }

  updateSelectionCategory(id: string, category: string, subcategory: string, tertiaryCategory: string): SelectionCatalogItem {
    const row = this.database.prepare(`SELECT payload FROM selection_records WHERE id = ?`).get(id) as { payload: string } | undefined
    if (!row) throw new Error('选品记录不存在')
    const payload = JSON.parse(row.payload) as SelectionCatalogItem
    payload.category = category
    payload.subcategory = subcategory
    payload.tertiaryCategory = tertiaryCategory
    payload.updatedAt = new Date().toISOString()
    this.database.prepare(`UPDATE selection_records SET payload = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(payload), payload.updatedAt, id)
    return this.getSelectionCatalog().find(item => item.id === id)!
  }

  returnSelectionToCandidates(id: string): void {
    const result = this.database.prepare(`DELETE FROM selection_records WHERE id = ?`).run(id)
    if (!result.changes) throw new Error('选品记录不存在')
  }

  getWorkflowCounts() {
    const count = (sql: string) => Number((this.database.prepare(sql).get() as { total: number }).total)
    return {
      collected: count('SELECT (SELECT COUNT(*) FROM market_candidates WHERE deleted_at IS NULL) + (SELECT COUNT(DISTINCT url) FROM supply_candidates WHERE deleted_at IS NULL) AS total'),
      compared: count("SELECT COUNT(*) AS total FROM comparison_records WHERE status = 'COMPLETED'"),
      selected: count("SELECT COUNT(*) AS total FROM selection_records WHERE decision = 'APPROVED'"),
      stocked: count("SELECT COUNT(*) AS total FROM inventory_records WHERE status = 'IN_STOCK'"),
      listed: count("SELECT COUNT(*) AS total FROM listing_records WHERE status = 'PUBLISHED'"),
      purchasing: count("SELECT COUNT(*) AS total FROM purchase_orders WHERE status NOT IN ('COMPLETED', 'CANCELLED')"),
      reconciled: count("SELECT COUNT(*) AS total FROM reconciliation_records WHERE status = 'COMPLETED'")
    }
  }
}
