-- 媒体行主键改为代理键。
--
-- 起因：编辑 eBay 本地产品时，客户端为了继承上一版媒体的下载状态/sha256/localPath，
-- 把源媒体记录**连 id 一起**原样展开进新快照（src/main/main.ts 的 updateEbayLocalProduct）。
-- 而本表 id 是单一主键，于是第二次编辑必然撞唯一约束：服务端 createMany 报 P2002 → 500，
-- 客户端裸 INSERT 冲突后整个事务 ROLLBACK，本次编辑全丢。
--
-- 修法：id 退化为写入方生成的代理键，逻辑媒体 id 迁到 media_key。
-- 快照 payload JSON 里的 media[].id 仍是逻辑 id，所有读路径（product.snapshot.media）不受影响；
-- 本表当前是纯写入的冗余索引，两侧均无 SELECT/findMany，故无读取方需要跟着改。

ALTER TABLE "ebay_local_product_media" ADD COLUMN "media_key" TEXT NOT NULL DEFAULT '';

-- 既有行的 id 就是逻辑媒体 id（同 id 的第二行从来插不进来，故一对一、无歧义）
UPDATE "ebay_local_product_media" SET "media_key" = "id" WHERE "media_key" = '';

-- CreateIndex
CREATE INDEX "ebay_local_product_media_snapshot_id_media_key_idx" ON "ebay_local_product_media"("snapshot_id", "media_key");
