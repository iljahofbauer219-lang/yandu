/**
 * verify-* 脚本共用：直接建一个**独立组织** + OWNER 并签发 access token。
 *
 * 为什么不能再用 POST /api/auth/register：
 * 该端点只在「库中没有任何组织」时才 bootstrap 新组织；一旦已有组织，它会把新用户挂到
 * **首个组织**并置 PENDING，返回 `{ pending: true }` 而不是 tokens（auth/routes.ts:88-107）。
 * 于是所有"组织B"的跨组织隔离用例都拿不到 token —— 断言要么假通过（空 token 得到 401 而
 * 被误认为 403 隔离生效），要么整段崩掉。这里绕过 HTTP 直接建库，语义才是真正的第二个组织。
 *
 * 用法（必须与 app.js 一样用动态 import，确保在 process.env.DATABASE_URL 设好之后才加载 prisma）：
 *   const { createSecondOrg } = await import('./lib/verify-org.js')
 *   const orgB = await createSecondOrg(app, { orgName: '竞争对手', phone: '13900000009' })
 */
import type { FastifyInstance } from 'fastify'
import { prisma } from '../../src/lib/prisma.js'
import { hashPassword } from '../../src/lib/password.js'
import { seedOrgReferenceData } from '../../src/lib/seed.js'
import { PRESET_ROLES } from '../../src/modules/rbac/permissions.js'
import { ensureOrgDefaultTiers } from '../../src/modules/linduo/tier-seed.js'

export interface SecondOrg {
  orgId: string
  userId: string
  token: string
}

export async function createSecondOrg(
  app: FastifyInstance,
  input: { orgName: string; phone: string; name?: string; password?: string }
): Promise<SecondOrg> {
  const password = input.password ?? 'pass1234'
  const org = await prisma.organization.create({ data: { name: input.orgName } })
  for (const preset of PRESET_ROLES) {
    await prisma.role.create({
      data: {
        orgId: org.id,
        key: preset.key,
        name: preset.name,
        isSystem: true,
        permissions: { create: preset.permissions.map(code => ({ code })) }
      }
    })
  }
  const ownerRole = await prisma.role.findFirstOrThrow({ where: { orgId: org.id, key: 'OWNER' } })
  const user = await prisma.user.create({
    data: {
      orgId: org.id,
      email: input.phone,
      name: input.name ?? '老板B',
      passwordHash: await hashPassword(password),
      isOwner: true,
      roles: { create: [{ roleId: ownerRole.id }] }
    }
  })
  // 与 bootstrap 注册路径保持一致：组织级参考数据 + Linduo 档位种子。幂等，失败不阻断。
  try { await seedOrgReferenceData(org.id) } catch { /* 隔离用例不依赖参考数据 */ }
  try { await ensureOrgDefaultTiers(org.id) } catch { /* 同上 */ }
  return {
    orgId: org.id,
    userId: user.id,
    token: app.jwt.sign({ sub: user.id, org: org.id }, { expiresIn: '1h' })
  }
}
