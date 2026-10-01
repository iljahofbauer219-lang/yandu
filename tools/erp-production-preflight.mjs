// 部署前只读检查：只输出配置是否存在、依赖状态，不输出凭据。
import { PrismaClient } from '@prisma/client'
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'

const prisma = new PrismaClient()
const result = { checkedAt: new Date().toISOString(), runtime: process.version }
const envKeys = ['DATABASE_URL', 'JWT_SECRET', 'MEDIA_DRIVER', 'MEDIA_LOCAL_DIR', 'MEDIA_PUBLIC_BASE_URL', 'MEDIA_SIGNING_SECRET', 'BAILIAN_API_KEY', 'BAILIAN_BASE_URL', 'BAILIAN_VISION_MODEL', 'ERP_PATROL_ENABLED', 'TZ']
result.environment = Object.fromEntries(envKeys.map(key => [key, Boolean(process.env[key])]))
result.patrol = { enabled: process.env.ERP_PATROL_ENABLED !== 'false', configuredValue: process.env.ERP_PATROL_ENABLED || null }
result.publicEndpoints = []
for (const url of ['http://114.55.149.192/health', 'http://114.55.149.192/api/erp/products', 'https://114.55.149.192/health']) {
  try {
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) })
    result.publicEndpoints.push({ url, status: response.status })
    await response.body?.cancel()
  } catch (error) { result.publicEndpoints.push({ url, error: error.cause?.code || error.name }) }
}
result.media = { driver: process.env.MEDIA_DRIVER || 'local' }
try {
  await access(process.env.MEDIA_LOCAL_DIR || '/app/data/media', constants.R_OK | constants.W_OK)
  result.media.readableWritable = true
} catch { result.media.readableWritable = false }
try {
  result.database = await prisma.$queryRaw`SELECT current_database() AS database, version() AS version`
  result.migrations = await prisma.$queryRaw`SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`
  result.erpTables = await prisma.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'erp_%' ORDER BY tablename`
} catch (error) { result.databaseError = error.code || error.name }
await prisma.$disconnect()
const key = process.env.BAILIAN_API_KEY
if (key) {
  try {
    const base = (process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/$/, '')
    const response = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000)
    })
    const body = await response.json()
    const wanted = ['qwen3.6-flash', 'qwen-plus', 'qwen-image-edit-plus']
    result.aiCatalog = { status: response.status, code: body.error?.code || body.code || null,
      models: (body.data || []).map(model => model.id).filter(id => wanted.includes(id)),
      note: '模型目录可访问不等于实际生成或额度验收' }
  } catch (error) { result.aiCatalog = { error: error.cause?.code || error.name } }
} else { result.aiCatalog = { configured: false } }
console.log(JSON.stringify(result, null, 2))
