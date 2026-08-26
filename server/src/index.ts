import { buildApp } from './app.js'
import { config } from './config.js'
import { prisma } from './lib/prisma.js'
import { startLinduoPricingScheduler, stopLinduoPricingScheduler } from './modules/linduo/pricing-scheduler.js'

const app = await buildApp()

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

// 零度API 价格抓取调度器（每日 06:00 + 启动 30s 后首次）
startLinduoPricingScheduler()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`收到 ${signal}，正在关闭…`)
    stopLinduoPricingScheduler()
    await app.close()
    await prisma.$disconnect()
    process.exit(0)
  })
}
