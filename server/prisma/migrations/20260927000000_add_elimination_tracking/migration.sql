-- 淘汰产品收录追踪域：eliminated_products（淘汰审计表）+ elimination_settings（预检查过滤等开关）
-- 与 schema.prisma 的 EliminatedProduct / EliminationSetting 模型一一对应（org 隔离、级联删除）

CREATE TABLE "eliminated_products" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "identity_key" TEXT NOT NULL,
    "platform_code" TEXT NOT NULL,
    "product_id" TEXT,
    "source_url" TEXT NOT NULL,
    "title" TEXT,
    "image_url" TEXT,
    "price_text" TEXT,
    "origin" TEXT NOT NULL,
    "origin_record_id" TEXT,
    "reason" TEXT,
    "operator" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "eliminated_at" TEXT NOT NULL,
    "reenabled_at" TEXT,

    CONSTRAINT "eliminated_products_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "elimination_settings" (
    "org_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "elimination_settings_pkey" PRIMARY KEY ("org_id","key")
);

CREATE INDEX "eliminated_products_org_id_identity_key_status_idx" ON "eliminated_products"("org_id", "identity_key", "status");
CREATE INDEX "eliminated_products_org_id_eliminated_at_idx" ON "eliminated_products"("org_id", "eliminated_at");

ALTER TABLE "eliminated_products" ADD CONSTRAINT "eliminated_products_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "elimination_settings" ADD CONSTRAINT "elimination_settings_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
