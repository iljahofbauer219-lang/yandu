/** 临时验收脚本：核查用户表并补齐 3 个 PENDING 探针（幂等），执行后由 restore 清理 */
import { prisma } from '../src/lib/prisma.js'
import { hashPassword } from '../src/lib/password.js'

async function main() {
  const org = await prisma.organization.findFirst({ select: { id: true } })
  if (!org) throw new Error('未找到组织，无法创建验收探针')
  const users = await prisma.user.findMany({ select: { name: true, email: true, status: true } })
  console.log('当前用户：', users.map(u => `${u.name}/${u.email}/${u.status}`).join('；'))
  const pwd = await hashPassword('Yd2025xk')
  for (let i = 1; i <= 3; i++) {
    const email = `1380000990${i}`
    const exists = users.find(u => u.email === email)
    if (!exists) {
      await prisma.user.create({ data: { orgId: org.id, name: `滚动验收${i}`, email, passwordHash: pwd, status: 'PENDING' } })
      console.log(`已补探针 滚动验收${i}`)
    } else {
      console.log(`探针 ${email} 已存在：${exists.status}`)
    }
  }
}

main().then(() => prisma.$disconnect()).catch(error => { console.error(error); process.exit(1) })
