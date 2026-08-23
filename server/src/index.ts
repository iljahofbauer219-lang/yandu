import { buildApp } from './app.js'
import { config } from './config.js'
import { prisma } from './lib/prisma.js'

const app = await buildApp()

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
} catch (error) {
  app.log.error(error)
  process.exit(1)
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    app.log.info(`收到 ${signal}，正在关闭…`)
    await app.close()
    await prisma.$disconnect()
    process.exit(0)
  })
}
