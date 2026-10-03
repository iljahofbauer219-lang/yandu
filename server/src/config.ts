import 'dotenv/config'
import path from 'node:path'

function read(name: string, fallback: string): string {
  const value = process.env[name]
  return value && value.length > 0 ? value : fallback
}

/** 开发兜底密钥（仅限非 production；生产环境启动时校验，见文件末尾） */
const DEV_ONLY_SECRET = 'dev-only-secret-change-me'

export const config = {
  port: Number(read('PORT', '8787')),
  databaseUrl: read('DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:5433/postgres'),
  jwtSecret: read('JWT_SECRET', DEV_ONLY_SECRET),
  accessTokenTtl: read('ACCESS_TOKEN_TTL', '2h'),
  refreshTokenTtlDays: Number(read('REFRESH_TOKEN_TTL_DAYS', '30')),
  corsOrigin: read('CORS_ORIGIN', '*'),
  // 媒体存储：local=本地磁盘（开发/单机），oss=阿里云 OSS（生产，签名 URL 直读）
  mediaDriver: read('MEDIA_DRIVER', 'local'),
  mediaLocalDir: read('MEDIA_LOCAL_DIR', path.resolve(process.cwd(), 'data', 'media')),
  // 产品详情页（正式入库「下载产品」服务器端建页）：公开只读静态目录
  productPagesDir: read('PRODUCT_PAGES_DIR', path.resolve(process.cwd(), 'data', 'product-pages')),
  mediaPublicBaseUrl: read('MEDIA_PUBLIC_BASE_URL', ''),
  mediaSigningSecret: read('MEDIA_SIGNING_SECRET', read('JWT_SECRET', DEV_ONLY_SECRET)),
  ossBucket: read('OSS_BUCKET', ''),
  ossEndpoint: read('OSS_ENDPOINT', ''),
  ossAccessKeyId: read('OSS_ACCESS_KEY_ID', ''),
  ossAccessKeySecret: read('OSS_ACCESS_KEY_SECRET', ''),
  // ERP 图片下载队列（M2）：并发上限 + 退避重试 + 超时（规格 §5 下载封禁/裂图对策）
  erpDownloadConcurrency: Number(read('ERP_DOWNLOAD_CONCURRENCY', '4')),
  erpDownloadRetries: Number(read('ERP_DOWNLOAD_RETRIES', '3')),
  erpDownloadBackoffMs: read('ERP_DOWNLOAD_BACKOFF_MS', '500,1500,4000')
    .split(',').map(value => Number(value.trim())).filter(value => Number.isFinite(value) && value >= 0),
  erpDownloadTimeoutMs: Number(read('ERP_DOWNLOAD_TIMEOUT_MS', '20000')),
  // ERP 定价汇率表（M4）："FROM->TO:rate" 逗号分隔；参考价计算器把源币种成本换算为目标币种
  erpFxRates: Object.fromEntries(
    read('ERP_FX_RATES', 'CNY->USD:0.14,CNY->RUB:12.5,CNY->CNY:1,USD->USD:1,USD->CNY:7.14,RUB->CNY:0.08')
      .split(',').map(pair => pair.trim()).filter(Boolean).map(pair => {
        const [key, rate] = pair.split(':')
        return [(key ?? '').trim().toUpperCase(), Number(rate)] as const
      }).filter(([, rate]) => Number.isFinite(rate) && rate > 0)
  ) as Record<string, number>,
  // ERP 巡盘调度（M6）：分批 + 并发上限 + 请求间隔（防风控）+ 早 8 点汇总
  erpPatrolEnabled: read('ERP_PATROL_ENABLED', 'true') === 'true',
  erpPatrolIntervalMs: Number(read('ERP_PATROL_INTERVAL_MS', String(6 * 60 * 60 * 1000))),
  erpPatrolBatchSize: Number(read('ERP_PATROL_BATCH_SIZE', '200')),
  erpPatrolConcurrency: Number(read('ERP_PATROL_CONCURRENCY', '3')),
  erpPatrolDelayMs: Number(read('ERP_PATROL_DELAY_MS', '300')),
  erpPatrolSummaryHour: Number(read('ERP_PATROL_SUMMARY_HOUR', '8')),
  // AI 网关：密钥仅驻留服务端，客户端零持有
  bailianApiKey: read('BAILIAN_API_KEY', ''),
  bailianBaseUrl: read('BAILIAN_BASE_URL', 'https://dashscope.aliyuncs.com/compatible-mode/v1'),
  bailianVisionModel: read('BAILIAN_VISION_MODEL', 'qwen3.6-flash'),
  arkApiKey: read('ARK_API_KEY', ''),
  arkBaseUrl: read('ARK_BASE_URL', 'https://ark.cn-beijing.volces.com/api/v3'),
  arkVideoModel: read('ARK_VIDEO_MODEL', ''),
  openaiImageApiKey: read('OPENAI_IMAGE_API_KEY', ''),
  openaiImageBaseUrl: read('OPENAI_IMAGE_BASE_URL', 'https://api.openai.com/v1'),
  deepseekApiKey: read('DEEPSEEK_API_KEY', ''),
  deepseekBaseUrl: read('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'),
  deepseekModel: read('DEEPSEEK_MODEL', 'deepseek-v4-flash'),
  // 零度API（api000.com）：一把 Key 聚合 37 个大模型（OpenAI/Anthropic/Google/Vidu）。
  // 兼容 OpenAI 协议；密钥仅驻留服务端，零下发客户端。
  linduoApiKey: read('LINDUO_API_KEY', ''),
  linduoBaseUrl: read('LINDUO_BASE_URL', 'https://api000.com/v1'),
  // 零度API 价格抓取（playwright-core 驱动）
  linduoPricingUsername: read('LINDUO_PRICING_USERNAME', ''),
  linduoPricingPassword: read('LINDUO_PRICING_PASSWORD', ''),
  linduoPricingAesKey: read('LINDUO_PRICING_AES_KEY', ''),
  linduoPricingChromePath: read('LINDUO_PRICING_CHROME_PATH', ''),
  linduoPricingBaseUrl: read('LINDUO_PRICING_BASE_URL', 'https://api000.com'),
  linduoPricingRefreshHour: Number(read('LINDUO_PRICING_REFRESH_HOUR', '6'))
}

// 生产环境密钥防护（plan frosty-wood-gudgeon #3）：
// NODE_ENV=production 时仍在使用弱默认密钥 → 启动即抛错，指明需要设置的环境变量名。
// 非 production 保留 dev 兜底，不影响本机开发与 verify 脚本。
if (process.env.NODE_ENV === 'production') {
  const offenders: string[] = []
  if (config.jwtSecret === DEV_ONLY_SECRET) offenders.push('JWT_SECRET')
  if (config.mediaSigningSecret === DEV_ONLY_SECRET) offenders.push('MEDIA_SIGNING_SECRET（或设置非默认的 JWT_SECRET 作为兜底）')
  if (offenders.length > 0) {
    throw new Error(`[config] 生产环境禁止使用默认弱密钥，请设置环境变量：${offenders.join('、')}`)
  }
}
