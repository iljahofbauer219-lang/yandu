import { buildApp } from './app.js'
import { config } from './config.js'
import { prisma } from './lib/prisma.js'
import { startLinduoPricingScheduler, stopLinduoPricingScheduler } from './modules/linduo/pricing-scheduler.js'
import { syncLinduoChatModels, ensureOwnerLinduoExceptions } from './modules/linduo/chat-models-sync.js'
import { seedDefaultLinduoTiers, assignOwnerLinduoTiers } from './modules/linduo/tier-seed.js'

const app = await buildApp()

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

// 零度API 价格抓取调度器（每日 06:00 + 启动 30s 后首次）
startLinduoPricingScheduler()

// Linduo 聊天模型同步 + Tier seed + OWNER 对齐 (M1/R-2)
// 顺序意义：
//   1) syncLinduoChatModels - 静态目录 -> DB（modelId 入库后才能被 full tier 覆盖）
//   2) seedDefaultLinduoTiers - 每个 org 预置 basic/advanced/full + full 覆盖 enabled
//   3) assignOwnerLinduoTiers - OWNER 绑定 full tier（核心"OWNER 全可见"）
//   4) ensureOwnerLinduoExceptions - 历史 fallback：OWNER 加 kind=GRANT 例外（与 tier 重复但无害）
void (async () => {
  try {
    const syncResult = await syncLinduoChatModels()
    app.log.info({ inserted: syncResult.inserted, updated: syncResult.updated, disabled: syncResult.disabled }, 'Linduo 聊天模型同步完成')

    const seedResult = await seedDefaultLinduoTiers()
    app.log.info({ orgCount: seedResult.orgCount, tierCount: seedResult.tierCount, fullGrants: seedResult.fullGrants }, 'Linduo tier 预置完成')

    const ownerCount = await assignOwnerLinduoTiers()
    app.log.info({ count: ownerCount }, 'OWNER tier 分配完成')

    const ownerGrants = await ensureOwnerLinduoExceptions()
    app.log.info({ count: ownerGrants }, 'OWNER 例外 fallback 完成')
  } catch (err) {
    app.log.error({ err }, 'Linduo 启动初始化失败')
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
