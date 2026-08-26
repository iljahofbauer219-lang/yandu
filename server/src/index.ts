import { buildApp } from './app.js'
import { config } from './config.js'
import { prisma } from './lib/prisma.js'
import { startLinduoPricingScheduler, stopLinduoPricingScheduler } from './modules/linduo/pricing-scheduler.js'
import { syncLinduoChatModels, ensureOwnerLinduoGrants } from './modules/linduo/chat-models-sync.js'

const app = await buildApp()

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

// 零度API 价格抓取调度器（每日 06:00 + 启动 30s 后首次）
startLinduoPricingScheduler()

// Linduo 聊天模型白名单启动同步 + OWNER 自动 grant (M1)
void (async () => {
  try {
    const result = await syncLinduoChatModels()
    app.log.info({ inserted: result.inserted, updated: result.updated, disabled: result.disabled }, 'Linduo 聊天模型同步完成')
    const ownerGrants = await ensureOwnerLinduoGrants()
    app.log.info({ count: ownerGrants }, 'OWNER 自动 grant 完成')
  } catch (err) {
    app.log.error({ err }, 'Linduo 聊天模型同步失败')
  }
})()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`收到 ${signal}，正在关闭…`)
    stopLinduoPricingScheduler()
    await app.close()
    await prisma.$disconnect()
    process.exit(0)
  })
}
