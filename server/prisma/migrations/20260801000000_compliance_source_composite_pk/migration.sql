-- compliance_sources 的逻辑 id（source-ebay / source-cpsc 等）在每个组织种子中重复出现，
-- 单行 @id 无法多组织共存，改为 (org_id, id) 复合主键，引用方同步改为复合外键。

ALTER TABLE "compliance_source_changes" DROP CONSTRAINT "compliance_source_changes_source_id_fkey";
ALTER TABLE "compliance_recalls" DROP CONSTRAINT "compliance_recalls_source_id_fkey";
DROP INDEX "compliance_recalls_source_id_external_id_key";

ALTER TABLE "compliance_sources" DROP CONSTRAINT "compliance_sources_pkey";
ALTER TABLE "compliance_sources" ADD CONSTRAINT "compliance_sources_pkey" PRIMARY KEY ("org_id", "id");

ALTER TABLE "compliance_source_changes"
  ADD CONSTRAINT "compliance_source_changes_org_id_source_id_fkey"
  FOREIGN KEY ("org_id", "source_id") REFERENCES "compliance_sources"("org_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "compliance_recalls"
  ADD CONSTRAINT "compliance_recalls_org_id_source_id_fkey"
  FOREIGN KEY ("org_id", "source_id") REFERENCES "compliance_sources"("org_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "compliance_recalls_org_id_source_id_external_id_key" ON "compliance_recalls"("org_id", "source_id", "external_id");
