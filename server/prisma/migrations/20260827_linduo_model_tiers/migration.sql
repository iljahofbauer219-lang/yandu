-- Linduo 模型选用 R-2 改造:
-- 1. user_linduo_grants → user_linduo_exceptions(改表名 + 加 kind 字段)
-- 2. 新增 linduo_model_tiers 表(LinduoModelTier)
-- 3. 新增 linduo_tier_grants 表(LinduoTierGrant)
-- 4. users 表加 linduo_tier_id 外键

-- 1. 旧表改名为新表 + 加 kind 字段(老数据默认 GRANT)
ALTER TABLE "user_linduo_grants" RENAME TO "user_linduo_exceptions";
ALTER TABLE "user_linduo_exceptions" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'GRANT';

-- 2. 新增 linduo_model_tiers 表
CREATE TABLE "linduo_model_tiers" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "is_system" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "linduo_model_tiers_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "linduo_model_tiers_org_id_key_key" ON "linduo_model_tiers"("org_id", "key");
CREATE INDEX "linduo_model_tiers_org_id_idx" ON "linduo_model_tiers"("org_id");

-- 3. 新增 linduo_tier_grants 表
CREATE TABLE "linduo_tier_grants" (
  "tier_id" TEXT NOT NULL,
  "model_id" TEXT NOT NULL,
  "granted_by" TEXT,
  "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tier_id", "model_id"),
  CONSTRAINT "linduo_tier_grants_tier_id_fkey" FOREIGN KEY ("tier_id") REFERENCES "linduo_model_tiers"("id") ON DELETE CASCADE,
  CONSTRAINT "linduo_tier_grants_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "linduo_chat_models"("id") ON DELETE CASCADE
);
CREATE INDEX "linduo_tier_grants_model_id_idx" ON "linduo_tier_grants"("model_id");

-- 4. users 表加 linduo_tier_id 字段
ALTER TABLE "users" ADD COLUMN "linduo_tier_id" TEXT;
ALTER TABLE "users" ADD CONSTRAINT "users_linduo_tier_id_fkey" FOREIGN KEY ("linduo_tier_id") REFERENCES "linduo_model_tiers"("id") ON DELETE SET NULL;
