-- ERP 采集加工域（跨境电商采集 ERP 一期 P0 地基）
-- 敏感字段约定见 schema.prisma 注释：supplier_id/source_url/source_product_id/source_sku/collected_by/crawl_config

CREATE TABLE "erp_suppliers" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "login_url" TEXT NOT NULL DEFAULT '',
    "credentials_cipher" TEXT NOT NULL DEFAULT '',
    "crawl_rules" JSONB NOT NULL DEFAULT '{}',
    "patrol_channel" TEXT NOT NULL DEFAULT 'SERVER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "erp_suppliers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "erp_products" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "source_product_id" TEXT NOT NULL,
    "source_url" TEXT NOT NULL DEFAULT '',
    "source_sku" TEXT NOT NULL DEFAULT '',
    "collected_by" TEXT NOT NULL DEFAULT '',
    "crawl_config" JSONB NOT NULL DEFAULT '{}',
    "title_original" TEXT NOT NULL DEFAULT '',
    "description_original" TEXT NOT NULL DEFAULT '',
    "cost_price" DOUBLE PRECISION,
    "shipping_cost" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "stock_quantity" INTEGER,
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "weight" DOUBLE PRECISION,
    "material" TEXT NOT NULL DEFAULT '',
    "color" TEXT NOT NULL DEFAULT '',
    "brand" TEXT NOT NULL DEFAULT '',
    "category" TEXT NOT NULL DEFAULT '',
    "variants" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'COLLECTED',
    "change_flag" INTEGER NOT NULL DEFAULT 0,
    "last_crawled_at" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "erp_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "erp_product_images" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "image_type" TEXT NOT NULL,
    "source_url" TEXT NOT NULL DEFAULT '',
    "local_path" TEXT NOT NULL DEFAULT '',
    "platform" TEXT,
    "is_selected" INTEGER NOT NULL DEFAULT 0,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "erp_product_images_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "erp_platform_rules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "title_char_limit" INTEGER NOT NULL DEFAULT 80,
    "image_rules" JSONB NOT NULL DEFAULT '{}',
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "erp_platform_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "erp_pricing_rules" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "markup_rate" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "commission_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "fixed_fee" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "erp_pricing_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "erp_listings" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "ai_title_options" JSONB NOT NULL DEFAULT '[]',
    "price" DOUBLE PRECISION,
    "price_manual" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "erp_listings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "erp_crawl_logs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "field_changed" TEXT NOT NULL,
    "old_value" TEXT NOT NULL DEFAULT '',
    "new_value" TEXT NOT NULL DEFAULT '',
    "notified" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "erp_crawl_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "erp_notifications" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "user_id" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'PATROL_CHANGE',
    "title" TEXT NOT NULL DEFAULT '',
    "body" JSONB NOT NULL DEFAULT '{}',
    "product_id" TEXT,
    "read_at" TEXT,
    "created_at" TEXT NOT NULL,

    CONSTRAINT "erp_notifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "erp_download_jobs" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "done" INTEGER NOT NULL DEFAULT 0,
    "failed_urls" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT NOT NULL DEFAULT '',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,

    CONSTRAINT "erp_download_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "erp_suppliers_org_id_code_key" ON "erp_suppliers"("org_id", "code");
CREATE UNIQUE INDEX "erp_products_org_id_supplier_id_source_product_id_key" ON "erp_products"("org_id", "supplier_id", "source_product_id");
CREATE INDEX "erp_products_org_id_status_updated_at_idx" ON "erp_products"("org_id", "status", "updated_at" DESC);
CREATE INDEX "erp_product_images_product_id_image_type_sort_order_idx" ON "erp_product_images"("product_id", "image_type", "sort_order");
CREATE UNIQUE INDEX "erp_platform_rules_org_id_platform_code_key" ON "erp_platform_rules"("org_id", "platform_code");
CREATE UNIQUE INDEX "erp_pricing_rules_org_id_platform_code_category_key" ON "erp_pricing_rules"("org_id", "platform_code", "category");
CREATE UNIQUE INDEX "erp_listings_product_id_platform_code_key" ON "erp_listings"("product_id", "platform_code");
CREATE INDEX "erp_listings_org_id_status_idx" ON "erp_listings"("org_id", "status");
CREATE INDEX "erp_crawl_logs_org_id_product_id_created_at_idx" ON "erp_crawl_logs"("org_id", "product_id", "created_at" DESC);
CREATE INDEX "erp_notifications_org_id_read_at_created_at_idx" ON "erp_notifications"("org_id", "read_at", "created_at" DESC);
CREATE INDEX "erp_download_jobs_org_id_status_idx" ON "erp_download_jobs"("org_id", "status");

ALTER TABLE "erp_suppliers" ADD CONSTRAINT "erp_suppliers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_products" ADD CONSTRAINT "erp_products_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_products" ADD CONSTRAINT "erp_products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "erp_suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_product_images" ADD CONSTRAINT "erp_product_images_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_product_images" ADD CONSTRAINT "erp_product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "erp_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_platform_rules" ADD CONSTRAINT "erp_platform_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_pricing_rules" ADD CONSTRAINT "erp_pricing_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_listings" ADD CONSTRAINT "erp_listings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_listings" ADD CONSTRAINT "erp_listings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "erp_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_crawl_logs" ADD CONSTRAINT "erp_crawl_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_crawl_logs" ADD CONSTRAINT "erp_crawl_logs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "erp_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_notifications" ADD CONSTRAINT "erp_notifications_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_download_jobs" ADD CONSTRAINT "erp_download_jobs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "erp_download_jobs" ADD CONSTRAINT "erp_download_jobs_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "erp_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
