-- AlterTable
ALTER TABLE "ebay_stores" ADD COLUMN     "access_token_expires_at" TEXT,
ADD COLUMN     "encrypted_access_token" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "encrypted_refresh_token" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "last_sync_at" TEXT,
ADD COLUMN     "public_store_url" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "public_store_verified_at" TEXT,
ADD COLUMN     "refresh_token_expires_at" TEXT,
ADD COLUMN     "seller_id" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sync_error" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "selection_tasks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "stage" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "selection_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_platforms" (
    "org_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connector_status" TEXT NOT NULL DEFAULT 'PLANNED',
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "supply_platforms_pkey" PRIMARY KEY ("org_id","code")
);

-- CreateTable
CREATE TABLE "collection_task_platforms" (
    "task_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TEXT NOT NULL,

    CONSTRAINT "collection_task_platforms_pkey" PRIMARY KEY ("task_id","platform_code")
);

-- CreateTable
CREATE TABLE "marketplace_platforms" (
    "org_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "home_url" TEXT NOT NULL,
    "default_network_strategy" TEXT NOT NULL DEFAULT 'LOCAL_DIRECT',
    "collector_ready" INTEGER NOT NULL DEFAULT 0,
    "enabled" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "marketplace_platforms_pkey" PRIMARY KEY ("org_id","code")
);

-- CreateTable
CREATE TABLE "product_warehouses" (
    "org_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "warehouse_kind" TEXT NOT NULL,
    "rule_profile" JSONB NOT NULL DEFAULT '[]',
    "enabled" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "product_warehouses_pkey" PRIMARY KEY ("org_id","code")
);

-- CreateTable
CREATE TABLE "marketplace_accounts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "network_strategy" TEXT NOT NULL DEFAULT 'LOCAL_DIRECT',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "marketplace_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_account_credentials" (
    "account_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "username" TEXT NOT NULL DEFAULT '',
    "encrypted_password" TEXT NOT NULL DEFAULT '',
    "automation_mode" TEXT NOT NULL DEFAULT 'SESSION_ONLY',
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "marketplace_account_credentials_pkey" PRIMARY KEY ("account_id")
);

-- CreateTable
CREATE TABLE "task_selection_rules" (
    "task_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "preset_code" TEXT NOT NULL,
    "minimum_score" DOUBLE PRECISION NOT NULL DEFAULT 65,
    "dimensions" JSONB NOT NULL DEFAULT '[]',
    "weights" JSONB NOT NULL DEFAULT '{}',
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL,

    CONSTRAINT "task_selection_rules_pkey" PRIMARY KEY ("task_id")
);

-- CreateTable
CREATE TABLE "product_evaluations" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "product_url" TEXT NOT NULL,
    "total_score" DOUBLE PRECISION,
    "grade" TEXT,
    "data_completeness" DOUBLE PRECISION,
    "dimension_scores" JSONB NOT NULL DEFAULT '{}',
    "recommendation" TEXT,
    "evaluated_at" TEXT NOT NULL,

    CONSTRAINT "product_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_evidence" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "evaluation_id" TEXT NOT NULL,
    "dimension_code" TEXT NOT NULL,
    "evidence_type" TEXT NOT NULL,
    "source_url" TEXT,
    "content" TEXT NOT NULL,
    "score_effect" DOUBLE PRECISION,

    CONSTRAINT "evaluation_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_risk_flags" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "evaluation_id" TEXT NOT NULL,
    "risk_code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "detail" TEXT NOT NULL,

    CONSTRAINT "product_risk_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_rejection_records" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "product_url" TEXT NOT NULL,
    "reason_code" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "product_rejection_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_candidates" (
    "org_id" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "product_id" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "first_task_id" TEXT NOT NULL,
    "latest_task_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "collected_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    "deleted_at" TEXT,

    CONSTRAINT "market_candidates_pkey" PRIMARY KEY ("org_id","platform_code","url")
);

-- CreateTable
CREATE TABLE "supply_candidates" (
    "task_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "selected" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL,
    "deleted_at" TEXT,

    CONSTRAINT "supply_candidates_pkey" PRIMARY KEY ("task_id","url")
);

-- CreateTable
CREATE TABLE "candidate_collection_runs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "candidate_area" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "collection_method" TEXT NOT NULL,
    "source_entry" TEXT NOT NULL DEFAULT '',
    "requested_count" INTEGER NOT NULL DEFAULT 0,
    "collected_count" INTEGER NOT NULL DEFAULT 0,
    "new_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "selected_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "started_at" TEXT NOT NULL,
    "completed_at" TEXT NOT NULL,

    CONSTRAINT "candidate_collection_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidate_collection_records" (
    "collection_run_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "candidate_area" TEXT NOT NULL,
    "candidate_key" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "collection_method" TEXT NOT NULL,
    "source_entry" TEXT NOT NULL DEFAULT '',
    "source_rank" INTEGER NOT NULL DEFAULT 0,
    "collected_at" TEXT NOT NULL,

    CONSTRAINT "candidate_collection_records_pkey" PRIMARY KEY ("collection_run_id","candidate_area","candidate_key")
);

-- CreateTable
CREATE TABLE "product_intake_registry" (
    "org_id" TEXT NOT NULL,
    "identity_key" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "product_id" TEXT NOT NULL DEFAULT '',
    "canonical_url" TEXT NOT NULL DEFAULT '',
    "title_snapshot" TEXT NOT NULL DEFAULT '',
    "first_collected_at" TEXT NOT NULL,
    "last_seen_at" TEXT NOT NULL,
    "last_stage" TEXT NOT NULL DEFAULT 'HISTORY',
    "candidate_deleted_at" TEXT,

    CONSTRAINT "product_intake_registry_pkey" PRIMARY KEY ("org_id","identity_key")
);

-- CreateTable
CREATE TABLE "comparison_records" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "ozon_url" TEXT NOT NULL,
    "supplier_url" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "match_score" DOUBLE PRECISION,
    "ozon_price_rub" DOUBLE PRECISION,
    "purchase_price_cny" DOUBLE PRECISION,
    "landed_cost_cny" DOUBLE PRECISION,
    "estimated_profit_cny" DOUBLE PRECISION,
    "estimated_margin" DOUBLE PRECISION,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "comparison_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "selection_records" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "ozon_url" TEXT NOT NULL,
    "comparison_id" TEXT,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "selection_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_records" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "ozon_url" TEXT NOT NULL,
    "selection_id" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "unit_cost_cny" DOUBLE PRECISION,
    "warehouse" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_INBOUND',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "inventory_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_records" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "ozon_url" TEXT NOT NULL,
    "inventory_id" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'OZON',
    "title" TEXT,
    "sale_price" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "platform_product_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "listing_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_events" (
    "id" SERIAL NOT NULL,
    "org_id" TEXT NOT NULL,
    "task_id" TEXT NOT NULL,
    "ozon_url" TEXT,
    "stage" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL,

    CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "supplier_id" TEXT,
    "sales_order_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "total_amount_cny" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ordered_at" TEXT,
    "expected_at" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_records" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "period_start" TEXT NOT NULL,
    "period_end" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sales_cny" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "purchase_cost_cny" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freight_cny" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "platform_fee_cny" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "refund_cny" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "profit_cny" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "reconciliation_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supply_warehouse_products" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "warehouse_code" TEXT NOT NULL,
    "selection_id" TEXT,
    "source_url" TEXT NOT NULL,
    "product_id" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "image_url" TEXT NOT NULL DEFAULT '',
    "price_text" TEXT NOT NULL DEFAULT '',
    "supplier_name" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '未分类',
    "subcategory" TEXT NOT NULL DEFAULT '待人工分类',
    "tertiary_category" TEXT NOT NULL DEFAULT '待细分',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "supply_warehouse_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_selection_products" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "marketplace_code" TEXT NOT NULL,
    "supply_product_id" TEXT NOT NULL,
    "warehouse_code" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "product_id" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL,
    "image_url" TEXT NOT NULL DEFAULT '',
    "price_text" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '未分类',
    "status" TEXT NOT NULL DEFAULT 'SELECTED',
    "media_status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "marketplace_selection_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_media_assets" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "marketplace_selection_id" TEXT NOT NULL,
    "marketplace_code" TEXT NOT NULL,
    "asset_type" TEXT NOT NULL,
    "image_url" TEXT NOT NULL DEFAULT '',
    "local_path" TEXT NOT NULL DEFAULT '',
    "selected" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "marketplace_media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_publish_drafts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "marketplace_code" TEXT NOT NULL,
    "marketplace_selection_id" TEXT NOT NULL,
    "platform_sku" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "image_url" TEXT NOT NULL DEFAULT '',
    "price_text" TEXT NOT NULL DEFAULT '',
    "store_id" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "checks" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "platform_product_id" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "marketplace_publish_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_publish_audits" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "marketplace_code" TEXT NOT NULL,
    "draft_id" TEXT,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "marketplace_publish_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_store_url_history" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "public_store_url" TEXT NOT NULL,
    "change_type" TEXT NOT NULL,
    "verified_at" TEXT NOT NULL,

    CONSTRAINT "ebay_store_url_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_listings" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "marketplace_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "price" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT '',
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "image_url" TEXT NOT NULL DEFAULT '',
    "category_id" TEXT NOT NULL DEFAULT '',
    "category_name" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "view_url" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "ebay_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_store_categories" (
    "store_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent_category_id" TEXT NOT NULL DEFAULT '',
    "level" INTEGER NOT NULL DEFAULT 1,
    "child_count" INTEGER NOT NULL DEFAULT 0,
    "listing_count" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "synced_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "ebay_store_categories_pkey" PRIMARY KEY ("store_id","category_id")
);

-- CreateTable
CREATE TABLE "ebay_category_sync_runs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "added_count" INTEGER NOT NULL DEFAULT 0,
    "renamed_count" INTEGER NOT NULL DEFAULT 0,
    "moved_count" INTEGER NOT NULL DEFAULT 0,
    "removed_count" INTEGER NOT NULL DEFAULT 0,
    "reordered_count" INTEGER NOT NULL DEFAULT 0,
    "changes" JSONB NOT NULL DEFAULT '[]',
    "synced_at" TEXT NOT NULL,

    CONSTRAINT "ebay_category_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_product_sync_runs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'INCREMENTAL',
    "category_count" INTEGER NOT NULL DEFAULT 0,
    "scanned_category_count" INTEGER NOT NULL DEFAULT 0,
    "imported_count" INTEGER NOT NULL DEFAULT 0,
    "updated_count" INTEGER NOT NULL DEFAULT 0,
    "unchanged_count" INTEGER NOT NULL DEFAULT 0,
    "ended_count" INTEGER NOT NULL DEFAULT 0,
    "reactivated_count" INTEGER NOT NULL DEFAULT 0,
    "protected_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "moved_count" INTEGER NOT NULL DEFAULT 0,
    "suspected_ended_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'SUCCESS',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "changes" JSONB NOT NULL DEFAULT '[]',
    "synced_at" TEXT NOT NULL,

    CONSTRAINT "ebay_product_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_product_sync_checkpoints" (
    "task_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "category_ids" JSONB NOT NULL DEFAULT '[]',
    "completed_category_ids" JSONB NOT NULL DEFAULT '[]',
    "failed_category_ids" JSONB NOT NULL DEFAULT '[]',
    "products" JSONB NOT NULL DEFAULT '[]',
    "scans" JSONB NOT NULL DEFAULT '[]',
    "public_store_url" TEXT NOT NULL DEFAULT '',
    "started_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "ebay_product_sync_checkpoints_pkey" PRIMARY KEY ("task_id")
);

-- CreateTable
CREATE TABLE "ebay_listing_absence_evidence" (
    "store_id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "consecutive_count" INTEGER NOT NULL DEFAULT 0,
    "last_missing_at" TEXT NOT NULL,

    CONSTRAINT "ebay_listing_absence_evidence_pkey" PRIMARY KEY ("store_id","listing_id")
);

-- CreateTable
CREATE TABLE "ebay_local_products" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "marketplace_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL DEFAULT '',
    "category_name" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'INCOMPLETE',
    "version_count" INTEGER NOT NULL DEFAULT 0,
    "latest_snapshot_id" TEXT NOT NULL DEFAULT '',
    "downloaded_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "ebay_local_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_local_product_snapshots" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "local_product_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "captured_at" TEXT NOT NULL,

    CONSTRAINT "ebay_local_product_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_local_product_media" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "media_type" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "remote_url" TEXT NOT NULL,
    "local_path" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL DEFAULT '',
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "file_size" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT NOT NULL DEFAULT '',
    "download_status" TEXT NOT NULL,

    CONSTRAINT "ebay_local_product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_image_visual_inspections" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "local_product_id" TEXT NOT NULL,
    "snapshot_id" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "report_json" JSONB NOT NULL,
    "checked_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "ebay_image_visual_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_image_visual_review_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "inspection_id" TEXT NOT NULL,
    "media_id" TEXT NOT NULL,
    "rule_code" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reviewed_by" TEXT NOT NULL,
    "review_note" TEXT NOT NULL,
    "reviewed_at" TEXT NOT NULL,

    CONSTRAINT "ebay_image_visual_review_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_optimization_drafts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREMIUM',
    "payload" JSONB NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "ebay_optimization_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_content_optimization_records" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "selected_title" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "ebay_content_optimization_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_title_decisions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "research_snapshot_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "confirmed_at" TEXT NOT NULL,

    CONSTRAINT "ebay_title_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_title_handoffs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "title_decision_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "ebay_title_handoffs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_publish_tasks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "ebay_publish_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_acceptance_batches" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "ebay_acceptance_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_market_research" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TEXT NOT NULL,

    CONSTRAINT "ebay_market_research_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ebay_market_research_history" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "store_id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "fetched_at" TEXT NOT NULL,

    CONSTRAINT "ebay_market_research_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_sources" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "authority" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "sync_mode" TEXT NOT NULL,
    "sync_status" TEXT NOT NULL DEFAULT 'NOT_CONFIGURED',
    "last_synced_at" TEXT,
    "last_error" TEXT,
    "content_hash" TEXT NOT NULL DEFAULT '',
    "last_checked_at" TEXT,
    "last_changed_at" TEXT,
    "change_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "compliance_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_source_changes" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "old_hash" TEXT NOT NULL DEFAULT '',
    "new_hash" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "affected_rule_ids_json" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "detected_at" TEXT NOT NULL,
    "reviewed_at" TEXT,
    "reviewed_by" TEXT NOT NULL DEFAULT '',
    "review_note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "compliance_source_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_rules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "marketplace_site" TEXT NOT NULL DEFAULT 'ALL',
    "country" TEXT NOT NULL DEFAULT 'ALL',
    "category" TEXT NOT NULL DEFAULT 'ALL',
    "rule_type" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,
    "review_status" TEXT NOT NULL DEFAULT 'DRAFT',
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "compliance_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_rule_versions" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "condition_json" JSONB NOT NULL DEFAULT '{}',
    "remediation" TEXT NOT NULL DEFAULT '',
    "source_url" TEXT NOT NULL,
    "effective_from" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "compliance_rule_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_recalls" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "products" TEXT NOT NULL DEFAULT '',
    "hazards" TEXT NOT NULL DEFAULT '',
    "countries" TEXT NOT NULL DEFAULT '',
    "recall_date" TEXT NOT NULL DEFAULT '',
    "source_url" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "compliance_recalls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_check_runs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "marketplace_site" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "gate_status" TEXT NOT NULL,
    "rule_set_version" TEXT NOT NULL,
    "input_fingerprint" TEXT NOT NULL DEFAULT '',
    "request_json" JSONB NOT NULL DEFAULT '{}',
    "findings_json" JSONB NOT NULL DEFAULT '[]',
    "checked_at" TEXT NOT NULL,
    "reviewed_at" TEXT,
    "reviewed_by" TEXT,
    "review_note" TEXT,

    CONSTRAINT "compliance_check_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_product_profiles" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "marketplace_site" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "category_id" TEXT NOT NULL DEFAULT '',
    "category_name" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "brand" TEXT NOT NULL DEFAULT '',
    "manufacturer" TEXT NOT NULL DEFAULT '',
    "importer" TEXT NOT NULL DEFAULT '',
    "eu_responsible_person" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "batch_number" TEXT NOT NULL DEFAULT '',
    "barcode" TEXT NOT NULL DEFAULT '',
    "origin_country" TEXT NOT NULL DEFAULT '',
    "materials" TEXT NOT NULL DEFAULT '',
    "age_grade" TEXT NOT NULL DEFAULT '',
    "battery_type" TEXT NOT NULL DEFAULT '',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "compliance_product_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_documents" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "document_type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "document_number" TEXT NOT NULL DEFAULT '',
    "issuer" TEXT NOT NULL DEFAULT '',
    "model_numbers" TEXT NOT NULL DEFAULT '',
    "countries" TEXT NOT NULL DEFAULT '',
    "issued_at" TEXT NOT NULL DEFAULT '',
    "expires_at" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
    "file_name" TEXT NOT NULL DEFAULT '',
    "file_path" TEXT NOT NULL DEFAULT '',
    "review_note" TEXT NOT NULL DEFAULT '',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "compliance_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_category_templates" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "marketplace_site" TEXT NOT NULL DEFAULT 'ALL',
    "country" TEXT NOT NULL DEFAULT 'ALL',
    "category" TEXT NOT NULL DEFAULT 'ALL',
    "required_fields_json" JSONB NOT NULL DEFAULT '[]',
    "required_documents_json" JSONB NOT NULL DEFAULT '[]',
    "required_warnings_json" JSONB NOT NULL DEFAULT '[]',
    "logistics_requirements_json" JSONB NOT NULL DEFAULT '[]',
    "requires_manual_review" INTEGER NOT NULL DEFAULT 0,
    "active" INTEGER NOT NULL DEFAULT 1,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "compliance_category_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_tasks" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "check_id" TEXT,
    "task_type" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignee" TEXT NOT NULL DEFAULT '',
    "due_at" TEXT NOT NULL DEFAULT '',
    "resolution" TEXT NOT NULL DEFAULT '',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "compliance_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_alerts" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "alert_type" TEXT NOT NULL,
    "risk_level" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "compliance_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_audit_events" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "created_at" TEXT NOT NULL,

    CONSTRAINT "compliance_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_release_permits" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "marketplace_site" TEXT NOT NULL,
    "check_id" TEXT NOT NULL,
    "rule_set_version" TEXT NOT NULL,
    "input_fingerprint" TEXT NOT NULL,
    "gate_status" TEXT NOT NULL,
    "issued_at" TEXT NOT NULL,
    "expires_at" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'VALID',
    "revoked_at" TEXT,
    "revoke_reason" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "compliance_release_permits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_enforcement_cases" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "marketplace_site" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL DEFAULT '',
    "store_id" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "view_url" TEXT NOT NULL DEFAULT '',
    "risk_level" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "recommended_action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assignee" TEXT NOT NULL DEFAULT '',
    "resolution" TEXT NOT NULL DEFAULT '',
    "resolved_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "compliance_enforcement_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "selection_tasks_org_id_idx" ON "selection_tasks"("org_id");

-- CreateIndex
CREATE INDEX "marketplace_accounts_org_id_idx" ON "marketplace_accounts"("org_id");

-- CreateIndex
CREATE INDEX "product_evaluations_task_id_total_score_idx" ON "product_evaluations"("task_id", "total_score");

-- CreateIndex
CREATE INDEX "market_candidates_org_id_platform_code_updated_at_idx" ON "market_candidates"("org_id", "platform_code", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "supply_candidates_task_id_selected_score_idx" ON "supply_candidates"("task_id", "selected", "score");

-- CreateIndex
CREATE INDEX "supply_candidates_org_id_idx" ON "supply_candidates"("org_id");

-- CreateIndex
CREATE INDEX "candidate_collection_runs_org_id_candidate_area_completed_a_idx" ON "candidate_collection_runs"("org_id", "candidate_area", "completed_at" DESC);

-- CreateIndex
CREATE INDEX "candidate_collection_records_org_id_candidate_area_candidat_idx" ON "candidate_collection_records"("org_id", "candidate_area", "candidate_key", "collected_at" DESC);

-- CreateIndex
CREATE INDEX "product_intake_registry_org_id_platform_code_product_id_idx" ON "product_intake_registry"("org_id", "platform_code", "product_id");

-- CreateIndex
CREATE INDEX "comparison_records_task_id_status_idx" ON "comparison_records"("task_id", "status");

-- CreateIndex
CREATE INDEX "selection_records_task_id_decision_idx" ON "selection_records"("task_id", "decision");

-- CreateIndex
CREATE INDEX "inventory_records_task_id_status_idx" ON "inventory_records"("task_id", "status");

-- CreateIndex
CREATE INDEX "listing_records_task_id_status_idx" ON "listing_records"("task_id", "status");

-- CreateIndex
CREATE INDEX "workflow_events_org_id_task_id_idx" ON "workflow_events"("org_id", "task_id");

-- CreateIndex
CREATE INDEX "purchase_orders_org_id_idx" ON "purchase_orders"("org_id");

-- CreateIndex
CREATE INDEX "reconciliation_records_org_id_idx" ON "reconciliation_records"("org_id");

-- CreateIndex
CREATE INDEX "supply_warehouse_products_org_id_warehouse_code_status_upda_idx" ON "supply_warehouse_products"("org_id", "warehouse_code", "status", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "supply_warehouse_products_org_id_warehouse_code_source_url_key" ON "supply_warehouse_products"("org_id", "warehouse_code", "source_url");

-- CreateIndex
CREATE INDEX "marketplace_selection_products_org_id_marketplace_code_stat_idx" ON "marketplace_selection_products"("org_id", "marketplace_code", "status", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_selection_products_org_id_marketplace_code_supp_key" ON "marketplace_selection_products"("org_id", "marketplace_code", "supply_product_id");

-- CreateIndex
CREATE INDEX "marketplace_media_assets_marketplace_selection_id_selected__idx" ON "marketplace_media_assets"("marketplace_selection_id", "selected" DESC, "created_at" DESC);

-- CreateIndex
CREATE INDEX "marketplace_publish_drafts_org_id_marketplace_code_status_u_idx" ON "marketplace_publish_drafts"("org_id", "marketplace_code", "status", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_publish_drafts_org_id_marketplace_code_marketpl_key" ON "marketplace_publish_drafts"("org_id", "marketplace_code", "marketplace_selection_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_publish_drafts_org_id_marketplace_code_platform_key" ON "marketplace_publish_drafts"("org_id", "marketplace_code", "platform_sku");

-- CreateIndex
CREATE INDEX "marketplace_publish_audits_org_id_marketplace_code_created__idx" ON "marketplace_publish_audits"("org_id", "marketplace_code", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ebay_store_url_history_store_id_verified_at_idx" ON "ebay_store_url_history"("store_id", "verified_at" DESC);

-- CreateIndex
CREATE INDEX "ebay_listings_store_id_status_idx" ON "ebay_listings"("store_id", "status");

-- CreateIndex
CREATE INDEX "ebay_listings_org_id_idx" ON "ebay_listings"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "ebay_listings_store_id_marketplace_id_listing_id_key" ON "ebay_listings"("store_id", "marketplace_id", "listing_id");

-- CreateIndex
CREATE INDEX "ebay_store_categories_store_id_status_parent_category_id_so_idx" ON "ebay_store_categories"("store_id", "status", "parent_category_id", "sort_order");

-- CreateIndex
CREATE INDEX "ebay_category_sync_runs_store_id_synced_at_idx" ON "ebay_category_sync_runs"("store_id", "synced_at" DESC);

-- CreateIndex
CREATE INDEX "ebay_product_sync_runs_store_id_synced_at_idx" ON "ebay_product_sync_runs"("store_id", "synced_at" DESC);

-- CreateIndex
CREATE INDEX "ebay_product_sync_checkpoints_store_id_updated_at_idx" ON "ebay_product_sync_checkpoints"("store_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "ebay_local_products_store_id_category_id_updated_at_idx" ON "ebay_local_products"("store_id", "category_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "ebay_local_products_org_id_idx" ON "ebay_local_products"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "ebay_local_products_store_id_marketplace_id_listing_id_key" ON "ebay_local_products"("store_id", "marketplace_id", "listing_id");

-- CreateIndex
CREATE INDEX "ebay_local_product_snapshots_local_product_id_version_idx" ON "ebay_local_product_snapshots"("local_product_id", "version" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ebay_local_product_snapshots_local_product_id_version_key" ON "ebay_local_product_snapshots"("local_product_id", "version");

-- CreateIndex
CREATE INDEX "ebay_local_product_media_snapshot_id_sort_order_idx" ON "ebay_local_product_media"("snapshot_id", "sort_order");

-- CreateIndex
CREATE INDEX "ebay_image_visual_inspections_local_product_id_snapshot_id__idx" ON "ebay_image_visual_inspections"("local_product_id", "snapshot_id", "checked_at" DESC);

-- CreateIndex
CREATE INDEX "ebay_image_visual_review_events_inspection_id_reviewed_at_idx" ON "ebay_image_visual_review_events"("inspection_id", "reviewed_at" DESC);

-- CreateIndex
CREATE INDEX "ebay_optimization_drafts_store_id_updated_at_idx" ON "ebay_optimization_drafts"("store_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ebay_optimization_drafts_store_id_listing_id_key" ON "ebay_optimization_drafts"("store_id", "listing_id");

-- CreateIndex
CREATE INDEX "ebay_content_optimization_records_store_id_updated_at_idx" ON "ebay_content_optimization_records"("store_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ebay_content_optimization_records_store_id_listing_id_key" ON "ebay_content_optimization_records"("store_id", "listing_id");

-- CreateIndex
CREATE INDEX "ebay_title_decisions_store_id_confirmed_at_idx" ON "ebay_title_decisions"("store_id", "confirmed_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ebay_title_decisions_store_id_listing_id_key" ON "ebay_title_decisions"("store_id", "listing_id");

-- CreateIndex
CREATE INDEX "ebay_title_handoffs_store_id_updated_at_idx" ON "ebay_title_handoffs"("store_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ebay_title_handoffs_store_id_listing_id_key" ON "ebay_title_handoffs"("store_id", "listing_id");

-- CreateIndex
CREATE INDEX "ebay_publish_tasks_store_id_updated_at_idx" ON "ebay_publish_tasks"("store_id", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ebay_publish_tasks_store_id_draft_id_key" ON "ebay_publish_tasks"("store_id", "draft_id");

-- CreateIndex
CREATE INDEX "ebay_acceptance_batches_store_id_created_at_idx" ON "ebay_acceptance_batches"("store_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ebay_market_research_store_id_fetched_at_idx" ON "ebay_market_research"("store_id", "fetched_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ebay_market_research_store_id_listing_id_key" ON "ebay_market_research"("store_id", "listing_id");

-- CreateIndex
CREATE INDEX "ebay_market_research_history_store_id_listing_id_fetched_at_idx" ON "ebay_market_research_history"("store_id", "listing_id", "fetched_at" DESC);

-- CreateIndex
CREATE INDEX "compliance_sources_org_id_idx" ON "compliance_sources"("org_id");

-- CreateIndex
CREATE INDEX "compliance_source_changes_source_id_detected_at_idx" ON "compliance_source_changes"("source_id", "detected_at" DESC);

-- CreateIndex
CREATE INDEX "compliance_rules_org_id_platform_marketplace_site_country_r_idx" ON "compliance_rules"("org_id", "platform", "marketplace_site", "country", "review_status");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_rules_org_id_code_key" ON "compliance_rules"("org_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_rule_versions_rule_id_version_key" ON "compliance_rule_versions"("rule_id", "version");

-- CreateIndex
CREATE INDEX "compliance_recalls_org_id_idx" ON "compliance_recalls"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_recalls_source_id_external_id_key" ON "compliance_recalls"("source_id", "external_id");

-- CreateIndex
CREATE INDEX "compliance_check_runs_org_id_product_id_checked_at_idx" ON "compliance_check_runs"("org_id", "product_id", "checked_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "compliance_product_profiles_org_id_product_id_key" ON "compliance_product_profiles"("org_id", "product_id");

-- CreateIndex
CREATE INDEX "compliance_documents_org_id_product_id_status_expires_at_idx" ON "compliance_documents"("org_id", "product_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "compliance_category_templates_org_id_platform_marketplace_s_idx" ON "compliance_category_templates"("org_id", "platform", "marketplace_site", "country", "category", "active");

-- CreateIndex
CREATE INDEX "compliance_tasks_org_id_status_risk_level_updated_at_idx" ON "compliance_tasks"("org_id", "status", "risk_level", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "compliance_alerts_org_id_status_risk_level_updated_at_idx" ON "compliance_alerts"("org_id", "status", "risk_level", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "compliance_audit_events_org_id_created_at_idx" ON "compliance_audit_events"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "compliance_release_permits_org_id_product_id_status_expires_idx" ON "compliance_release_permits"("org_id", "product_id", "status", "expires_at" DESC);

-- CreateIndex
CREATE INDEX "compliance_enforcement_cases_org_id_status_risk_level_updat_idx" ON "compliance_enforcement_cases"("org_id", "status", "risk_level", "updated_at" DESC);

-- AddForeignKey
ALTER TABLE "selection_tasks" ADD CONSTRAINT "selection_tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_platforms" ADD CONSTRAINT "supply_platforms_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_task_platforms" ADD CONSTRAINT "collection_task_platforms_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "selection_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_task_platforms" ADD CONSTRAINT "collection_task_platforms_org_id_platform_code_fkey" FOREIGN KEY ("org_id", "platform_code") REFERENCES "supply_platforms"("org_id", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_task_platforms" ADD CONSTRAINT "collection_task_platforms_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_platforms" ADD CONSTRAINT "marketplace_platforms_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_warehouses" ADD CONSTRAINT "product_warehouses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_accounts" ADD CONSTRAINT "marketplace_accounts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_accounts" ADD CONSTRAINT "marketplace_accounts_org_id_platform_code_fkey" FOREIGN KEY ("org_id", "platform_code") REFERENCES "marketplace_platforms"("org_id", "code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_account_credentials" ADD CONSTRAINT "marketplace_account_credentials_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_selection_rules" ADD CONSTRAINT "task_selection_rules_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "selection_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_selection_rules" ADD CONSTRAINT "task_selection_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_evaluations" ADD CONSTRAINT "product_evaluations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_evaluations" ADD CONSTRAINT "product_evaluations_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "selection_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_evidence" ADD CONSTRAINT "evaluation_evidence_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_evidence" ADD CONSTRAINT "evaluation_evidence_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "product_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_risk_flags" ADD CONSTRAINT "product_risk_flags_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_risk_flags" ADD CONSTRAINT "product_risk_flags_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "product_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_rejection_records" ADD CONSTRAINT "product_rejection_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_rejection_records" ADD CONSTRAINT "product_rejection_records_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "selection_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "market_candidates" ADD CONSTRAINT "market_candidates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_candidates" ADD CONSTRAINT "supply_candidates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_candidates" ADD CONSTRAINT "supply_candidates_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "selection_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_collection_runs" ADD CONSTRAINT "candidate_collection_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_collection_records" ADD CONSTRAINT "candidate_collection_records_collection_run_id_fkey" FOREIGN KEY ("collection_run_id") REFERENCES "candidate_collection_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "candidate_collection_records" ADD CONSTRAINT "candidate_collection_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_intake_registry" ADD CONSTRAINT "product_intake_registry_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparison_records" ADD CONSTRAINT "comparison_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comparison_records" ADD CONSTRAINT "comparison_records_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "selection_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selection_records" ADD CONSTRAINT "selection_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selection_records" ADD CONSTRAINT "selection_records_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "selection_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "selection_records" ADD CONSTRAINT "selection_records_comparison_id_fkey" FOREIGN KEY ("comparison_id") REFERENCES "comparison_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_records" ADD CONSTRAINT "inventory_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_records" ADD CONSTRAINT "inventory_records_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "selection_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_records" ADD CONSTRAINT "inventory_records_selection_id_fkey" FOREIGN KEY ("selection_id") REFERENCES "selection_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_records" ADD CONSTRAINT "listing_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_records" ADD CONSTRAINT "listing_records_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "selection_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_records" ADD CONSTRAINT "listing_records_inventory_id_fkey" FOREIGN KEY ("inventory_id") REFERENCES "inventory_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_events" ADD CONSTRAINT "workflow_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_records" ADD CONSTRAINT "reconciliation_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_warehouse_products" ADD CONSTRAINT "supply_warehouse_products_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supply_warehouse_products" ADD CONSTRAINT "supply_warehouse_products_selection_id_fkey" FOREIGN KEY ("selection_id") REFERENCES "selection_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_selection_products" ADD CONSTRAINT "marketplace_selection_products_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_selection_products" ADD CONSTRAINT "marketplace_selection_products_supply_product_id_fkey" FOREIGN KEY ("supply_product_id") REFERENCES "supply_warehouse_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_media_assets" ADD CONSTRAINT "marketplace_media_assets_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_media_assets" ADD CONSTRAINT "marketplace_media_assets_marketplace_selection_id_fkey" FOREIGN KEY ("marketplace_selection_id") REFERENCES "marketplace_selection_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_publish_drafts" ADD CONSTRAINT "marketplace_publish_drafts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_publish_drafts" ADD CONSTRAINT "marketplace_publish_drafts_marketplace_selection_id_fkey" FOREIGN KEY ("marketplace_selection_id") REFERENCES "marketplace_selection_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_publish_audits" ADD CONSTRAINT "marketplace_publish_audits_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_publish_audits" ADD CONSTRAINT "marketplace_publish_audits_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "marketplace_publish_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_store_url_history" ADD CONSTRAINT "ebay_store_url_history_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_store_url_history" ADD CONSTRAINT "ebay_store_url_history_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_listings" ADD CONSTRAINT "ebay_listings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_listings" ADD CONSTRAINT "ebay_listings_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_store_categories" ADD CONSTRAINT "ebay_store_categories_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_store_categories" ADD CONSTRAINT "ebay_store_categories_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_category_sync_runs" ADD CONSTRAINT "ebay_category_sync_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_category_sync_runs" ADD CONSTRAINT "ebay_category_sync_runs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_product_sync_runs" ADD CONSTRAINT "ebay_product_sync_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_product_sync_runs" ADD CONSTRAINT "ebay_product_sync_runs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_product_sync_checkpoints" ADD CONSTRAINT "ebay_product_sync_checkpoints_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_product_sync_checkpoints" ADD CONSTRAINT "ebay_product_sync_checkpoints_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_listing_absence_evidence" ADD CONSTRAINT "ebay_listing_absence_evidence_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_listing_absence_evidence" ADD CONSTRAINT "ebay_listing_absence_evidence_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_local_products" ADD CONSTRAINT "ebay_local_products_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_local_products" ADD CONSTRAINT "ebay_local_products_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_local_product_snapshots" ADD CONSTRAINT "ebay_local_product_snapshots_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_local_product_snapshots" ADD CONSTRAINT "ebay_local_product_snapshots_local_product_id_fkey" FOREIGN KEY ("local_product_id") REFERENCES "ebay_local_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_local_product_media" ADD CONSTRAINT "ebay_local_product_media_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_local_product_media" ADD CONSTRAINT "ebay_local_product_media_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "ebay_local_product_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_image_visual_inspections" ADD CONSTRAINT "ebay_image_visual_inspections_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_image_visual_inspections" ADD CONSTRAINT "ebay_image_visual_inspections_local_product_id_fkey" FOREIGN KEY ("local_product_id") REFERENCES "ebay_local_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_image_visual_inspections" ADD CONSTRAINT "ebay_image_visual_inspections_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "ebay_local_product_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_image_visual_review_events" ADD CONSTRAINT "ebay_image_visual_review_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_image_visual_review_events" ADD CONSTRAINT "ebay_image_visual_review_events_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "ebay_image_visual_inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_optimization_drafts" ADD CONSTRAINT "ebay_optimization_drafts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_optimization_drafts" ADD CONSTRAINT "ebay_optimization_drafts_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_content_optimization_records" ADD CONSTRAINT "ebay_content_optimization_records_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_content_optimization_records" ADD CONSTRAINT "ebay_content_optimization_records_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_title_decisions" ADD CONSTRAINT "ebay_title_decisions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_title_decisions" ADD CONSTRAINT "ebay_title_decisions_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_title_handoffs" ADD CONSTRAINT "ebay_title_handoffs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_title_handoffs" ADD CONSTRAINT "ebay_title_handoffs_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_publish_tasks" ADD CONSTRAINT "ebay_publish_tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_publish_tasks" ADD CONSTRAINT "ebay_publish_tasks_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_publish_tasks" ADD CONSTRAINT "ebay_publish_tasks_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "ebay_optimization_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_acceptance_batches" ADD CONSTRAINT "ebay_acceptance_batches_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_acceptance_batches" ADD CONSTRAINT "ebay_acceptance_batches_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_market_research" ADD CONSTRAINT "ebay_market_research_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_market_research" ADD CONSTRAINT "ebay_market_research_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_market_research_history" ADD CONSTRAINT "ebay_market_research_history_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ebay_market_research_history" ADD CONSTRAINT "ebay_market_research_history_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "ebay_stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_sources" ADD CONSTRAINT "compliance_sources_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_source_changes" ADD CONSTRAINT "compliance_source_changes_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_source_changes" ADD CONSTRAINT "compliance_source_changes_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "compliance_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_rule_versions" ADD CONSTRAINT "compliance_rule_versions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_rule_versions" ADD CONSTRAINT "compliance_rule_versions_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "compliance_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_recalls" ADD CONSTRAINT "compliance_recalls_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_recalls" ADD CONSTRAINT "compliance_recalls_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "compliance_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_check_runs" ADD CONSTRAINT "compliance_check_runs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_product_profiles" ADD CONSTRAINT "compliance_product_profiles_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_documents" ADD CONSTRAINT "compliance_documents_org_id_product_id_fkey" FOREIGN KEY ("org_id", "product_id") REFERENCES "compliance_product_profiles"("org_id", "product_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_category_templates" ADD CONSTRAINT "compliance_category_templates_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_tasks" ADD CONSTRAINT "compliance_tasks_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_audit_events" ADD CONSTRAINT "compliance_audit_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_release_permits" ADD CONSTRAINT "compliance_release_permits_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_release_permits" ADD CONSTRAINT "compliance_release_permits_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "compliance_check_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_enforcement_cases" ADD CONSTRAINT "compliance_enforcement_cases_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- 手写补充：未关闭告警/处置单的部分唯一索引（Prisma schema 不支持部分索引，勿删）
CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_alerts_open_dedupe ON compliance_alerts(org_id, alert_type, entity_id) WHERE status IN ('OPEN','ACKNOWLEDGED');
CREATE UNIQUE INDEX IF NOT EXISTS idx_compliance_enforcement_open_product ON compliance_enforcement_cases(org_id, product_id) WHERE status IN ('OPEN','IN_PROGRESS');
