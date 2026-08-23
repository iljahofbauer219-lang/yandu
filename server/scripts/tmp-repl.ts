import { prisma } from '../src/lib/prisma.js'
async function main() {
  const owner = await prisma.user.findUnique({ where: { email: '13426964913' } })
  const r = await prisma.user.updateMany({ where: { email: { in: ['13800009901', '13800009902', '13800009903'] } }, data: { orgId: owner!.orgId } })
  console.log('探针迁移到 owner 组织：', r.count)
}
main().then(() => prisma.$disconnect()).catch(e => { console.error(e.message); process.exit(1) })
