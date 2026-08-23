/**
 * 本地开发数据库：PGlite（嵌入式 PostgreSQL）+ socket 服务。
 * 用法：pnpm db:dev，然后另开终端执行 pnpm prisma:migrate。
 * 生产环境使用 RDS PostgreSQL，无需此脚本。
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const port = Number(process.env.DEV_DB_PORT ?? 5433)

const db = new PGlite('./.dev-data')
// Prisma 会同时打开多条连接（迁移引擎/内省/ advisory lock / Promise.all 突发查询），超出上限的连接会被直接销毁（P1001），必须调大
const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1', maxConnections: 50, debug: process.env.DEV_DB_DEBUG === '1' })
await server.start()

console.log(`[dev-db] PGlite 已启动，连接串：`)
console.log(`[dev-db] postgresql://postgres:postgres@127.0.0.1:${port}/postgres`)
console.log('[dev-db] 数据目录：server/.dev-data（Ctrl+C 停止）')

process.on('SIGINT', async () => {
  await server.stop()
  await db.close()
  process.exit(0)
})
