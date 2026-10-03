-- 补齐三个查询索引（ERP 域）。
-- 不加 IF NOT EXISTS：migrations 是 DDL 唯一来源，IF NOT EXISTS 只会掩盖"有人手建过同名索引"的真实 drift。
-- 不用 CONCURRENTLY：Prisma 在事务块内应用 migration.sql，CONCURRENTLY 会报 25001；
-- 且 verify 脚本跑 PGlite 单后端，不支持 CONCURRENTLY 所需的并发快照推进。
-- erp_crawl_logs 新增而非改旧索引：旧 (org_id, product_id, created_at DESC) 服务 per-product 等值查询
-- （patrol.listChanges 嵌套 crawlLogs、patrol.updateMany notified=0），B-tree 要求等值列在范围列之前；
-- 晨汇总的 {orgId, createdAt gte} 全组织范围查需要 (org_id, created_at) 作前缀，两种形态各配一个。

-- CreateIndex
CREATE INDEX "erp_products_org_id_change_flag_idx" ON "erp_products"("org_id", "change_flag");

-- CreateIndex
CREATE INDEX "erp_crawl_logs_org_id_created_at_idx" ON "erp_crawl_logs"("org_id", "created_at");

-- CreateIndex
CREATE INDEX "erp_download_jobs_org_id_product_id_created_at_idx" ON "erp_download_jobs"("org_id", "product_id", "created_at" DESC);
