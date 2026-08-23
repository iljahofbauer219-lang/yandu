/** 临时验收脚本：重置 owner 密码为 Test1234，验收后由 restore 脚本恢复 */
import { prisma } from '../src/lib/prisma.js'
import { hashPassword } from '../src/lib/password.js'

async function main() {
  const user = await prisma.user.findUnique({ where: { email: '13426964913' } })
  if (!user) { console.log('用户不存在'); return }
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword('Test1234'), mustChangePassword: false }
  })
  console.log(`已重置 ${user.email} 密码为 Test1234`)
}

main().then(() => prisma.$disconnect()).catch(error => { console.error(error); process.exit(1) })
