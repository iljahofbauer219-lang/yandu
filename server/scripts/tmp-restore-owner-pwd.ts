/** 临时脚本：恢复 owner 原 passwordHash 并清理滚动验收探针帐号，执行后删除 */
import { prisma } from '../src/lib/prisma.js'

const ORIGINAL_HASH = 'scrypt:9aee4c59b132e4f0124c860fb9a8a9c6:c6dfc86735d6eb0ab339d614e9da94e8161a79e5cd3981bf42ec91552973bd7d3ead568bf2fd73cfc90ad4e338319e482d4ac63821714327acee6b08edae4408'

async function main() {
  const user = await prisma.user.findUnique({ where: { email: '13426964913' } })
  if (!user) { console.log('用户不存在'); return }
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: ORIGINAL_HASH } })
  const del = await prisma.user.deleteMany({ where: { email: { in: ['13800009901', '13800009902', '13800009903'] } } })
  console.log(`已恢复 ${user.email} 原密码；清理探针 ${del.count} 个`)
}

main().then(() => prisma.$disconnect()).catch(error => { console.error(error); process.exit(1) })
