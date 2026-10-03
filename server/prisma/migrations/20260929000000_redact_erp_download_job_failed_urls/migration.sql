-- 历史毒数据清理：erp_download_jobs.failed_urls 曾以**原值**存货盘图片外链
-- （download-worker 旧实现 failedUrls.push(image.sourceUrl)）。该列是裸 Json 且对任何持
-- erp.warehouse.view 的角色可读，构成对规格 §2.2「SQL 层剥离敏感列」的旁路泄漏。
-- 写入方已改存图片行主键；此处把存量数组中含 scheme:// 的字符串元素替换为 '[REDACTED]'。
-- 原值不可逆恢复是有意为之：采集角色（erp.source.view）可经产品详情 images[].sourceUrl 查回。
UPDATE "erp_download_jobs"
SET "failed_urls" = (
  SELECT COALESCE(jsonb_agg(
    CASE
      WHEN jsonb_typeof(elem) = 'string' AND (elem #>> '{}') ~ '^[a-zA-Z][a-zA-Z0-9+.-]*://'
        THEN '"[REDACTED]"'::jsonb
      ELSE elem
    END
  ), '[]'::jsonb)
  FROM jsonb_array_elements("erp_download_jobs"."failed_urls") AS elem
)
WHERE jsonb_typeof("failed_urls") = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements("failed_urls") AS e
    WHERE jsonb_typeof(e) = 'string' AND (e #>> '{}') ~ '^[a-zA-Z][a-zA-Z0-9+.-]*://'
  );

-- error 列同样可能被入队兜底路径写入含 URL 片段的异常 message（fetch/undici），一并消毒
UPDATE "erp_download_jobs"
SET "error" = regexp_replace("error", '[a-zA-Z][a-zA-Z0-9+.-]*://\S+', '[REDACTED]', 'g')
WHERE "error" ~ '://';
