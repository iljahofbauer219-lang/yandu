/**
 * 一次性脚本：将现有用户的登录名（email 字段）迁移为手机号。
 * 主帐号更新为 13326964913；子帐号按序生成占位手机号（避免唯一约束冲突）。
 * 用法：先 pnpm db:dev 启动 PGlite，再 pnpm tsx scripts/migrate-email-to-phone.ts
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const OWNER_PHONE = '13426964913'

async function main() {
  // 修正：确保真实主帐号「朱云初」持有 13326964913，测试帐号让出该号
  const owner = await prisma.user.findFirst({ where: { name: '朱云初' } })
  if (owner && owner.email !== OWNER_PHONE) {
    const occupant = await prisma.user.findUnique({ where: { email: OWNER_PHONE } })
    if (occupant && occupant.id !== owner.id) {
      const placeholder = `13300009999`
      await prisma.user.update({ where: { id: occupant.id }, data: { email: placeholder } })
      console.log(`[migrate] ${occupant.name}: ${OWNER_PHONE} → ${placeholder}（让出）`)
    }
    await prisma.user.update({ where: { id: owner.id }, data: { email: OWNER_PHONE } })
    console.log(`[migrate] ${owner.name}: → ${OWNER_PHONE}（主帐号）`)
  } else if (owner) {
    console.log(`[migrate] ${owner.name} 已是 ${OWNER_PHONE}，无需修改`)
  }
  console.log('[migrate] 完成')
}

main()
  .catch(err => { console.error('[migrate] 失败:', err); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
