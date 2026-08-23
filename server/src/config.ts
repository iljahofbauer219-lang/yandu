import 'dotenv/config'
import path from 'node:path'

function read(name: string, fallback: string): string {
  const value = process.env[name]
  return value && value.length > 0 ? value : fallback
}

export const config = {
  port: Number(read('PORT', '8787')),
  databaseUrl: read('DATABASE_URL', 'postgresql://postgres:postgres@127.0.0.1:5433/postgres'),
  jwtSecret: read('JWT_SECRET', 'dev-only-secret-change-me'),
  accessTokenTtl: read('ACCESS_TOKEN_TTL', '2h'),
  refreshTokenTtlDays: Number(read('REFRESH_TOKEN_TTL_DAYS', '30')),
  corsOrigin: read('CORS_ORIGIN', '*'),
  // 媒体存储：local=本地磁盘（开发/单机），oss=阿里云 OSS（生产，签名 URL 直读）
  mediaDriver: read('MEDIA_DRIVER', 'local'),
  mediaLocalDir: read('MEDIA_LOCAL_DIR', path.resolve(process.cwd(), 'data', 'media')),
  mediaPublicBaseUrl: read('MEDIA_PUBLIC_BASE_URL', ''),
  mediaSigningSecret: read('MEDIA_SIGNING_SECRET', read('JWT_SECRET', 'dev-only-secret-change-me')),
  ossBucket: read('OSS_BUCKET', ''),
  ossEndpoint: read('OSS_ENDPOINT', ''),
  ossAccessKeyId: read('OSS_ACCESS_KEY_ID', ''),
  ossAccessKeySecret: read('OSS_ACCESS_KEY_SECRET', ''),
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
  deepseekModel: read('DEEPSEEK_MODEL', 'deepseek-v4-flash')
}
