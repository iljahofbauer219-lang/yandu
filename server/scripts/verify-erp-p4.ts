/**
 * ERP P4 定价 + listing 端到端验收脚本（对照方案 P4 验收标准）：
 * 验收标准原文：
 *   「pricing_rules CRUD + 计算器 + 多平台 listing + 导出 |
 *     参考价与手算公式一致；手改价不被重算覆盖；eBay/Amazon 双版本 listing 独立；导出包物料齐备」
 *
 * 覆盖断言：
 *   1. pricing_rules CRUD：采集角色禁（403）、运营可读写、upsert 单行、更新生效
 *   2. 参考价与手算公式一致：eBay 10.92 / Amazon 12.35（成本加成 + 佣金反推 + 固定费，CNY→USD 0.14）
 *   3. 手改价不被重算覆盖：手改后 priceManual=1，recalc 跳过（protected），force 才覆盖
 *   4. eBay/Amazon 双版本 listing 独立：两行互不覆盖，标题/价独立
 *   5. 导出包物料齐备：选定图 + 双平台标题/价 → completeness.complete=true，图片走本地签名禁外链
 *   6. 权限：未登录 401；采集角色 recalc 403
 *
 * 运行：npx tsx scripts/verify-erp-p4.ts
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { execFile } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)
const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPort = 5439
const mediaDir = path.join(os.tmpdir(), `erp-p4-media-${Date.now()}`)

process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable`
process.env.JWT_SECRET = 'verify-erp-secret'
process.env.ACCESS_TOKEN_TTL = '1h'
process.env.REFRESH_TOKEN_TTL_DAYS = '7'
process.env.LOG_LEVEL = 'warn'
process.env.MEDIA_DRIVER = 'local'
process.env.MEDIA_LOCAL_DIR = mediaDir
process.env.MEDIA_PUBLIC_BASE_URL = ''
process.env.ERP_DOWNLOAD_RETRIES = '2'
process.env.ERP_DOWNLOAD_BACKOFF_MS = '30,30,30'
// 固定汇率表，令参考价可手算复现
process.env.ERP_FX_RATES = 'CNY->USD:0.14,CNY->RUB:12.5,CNY->CNY:1,USD->USD:1'

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9])
const imageServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': String(JPEG_BYTES.length) })
  res.end(JPEG_BYTES)
})
await new Promise<void>(resolve => imageServer.listen(0, '127.0.0.1', resolve))
const imgAddress = imageServer.address()
const imgPort = typeof imgAddress === 'object' && imgAddress ? imgAddress.port : 0
const imgBase = `http://127.0.0.1:${imgPort}`

console.log('[verify-erp-p4] 启动嵌入式 PostgreSQL…')
const db = new PGlite()
const socket = new PGLiteSocketServer({ db, port: dbPort, host: '127.0.0.1', maxConnections: 10 })
await socket.start()

async function waitForPgReady(port: number, attempts = 30): Promise<void> {
  for (let i = 0; i < attempts; i += 1) {
    const ok = await new Promise<boolean>(resolve => {
      const sock = net.connect(port, '127.0.0.1')
      const done = (result: boolean) => { sock.destroy(); resolve(result) }
      sock.on('connect', () => {
        const params = Buffer.from('user\0postgres\0database\0postgres\0\0')
        const msg = Buffer.alloc(8 + params.length)
        msg.writeInt32BE(8 + params.length, 0)
        msg.writeInt32BE(196608, 4)
        params.copy(msg, 8)
        sock.write(msg)
      })
      sock.on('data', () => done(true))
      sock.on('error', () => done(false))
      setTimeout(() => done(false), 1000)
    })
    if (ok) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('PGlite 就绪等待超时')
}
await waitForPgReady(dbPort)

console.log('[verify-erp-p4] 执行数据库迁移…')
const prismaBin = path.join(serverDir, 'node_modules', '.bin', 'prisma')
await execFileAsync(prismaBin, ['migrate', 'deploy'], { cwd: serverDir, env: { ...process.env } })

console.log('[verify-erp-p4] 启动应用…')
const { buildApp } = await import('../src/app.js')
const { prisma } = await import('../src/lib/prisma.js')
const { computeReferencePrice } = await import('../src/modules/erp/pricing.js')
const app = await buildApp()
await app.listen({ port: 0, host: '127.0.0.1' })
const address = app.server.address()
const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

let passed = 0
let failed = 0
function check(name: string, condition: boolean, extra?: unknown) {
  if (condition) { passed += 1; console.log(`  ✔ ${name}`) } else { failed += 1; console.error(`  ✘ ${name}`, extra === undefined ? '' : JSON.stringify(extra)) }
}

interface ApiResult { status: number; data: any }
async function api(method: string, pathName: string, body?: unknown, token?: string): Promise<ApiResult> {
  const response = await fetch(base + pathName, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  let data: any = null
  try { data = await response.json() } catch { /* 无响应体 */ }
  return { status: response.status, data }
}

async function pollJob(jobId: string, token: string, timeoutMs = 15000): Promise<any> {
  const deadline = Date.now() + timeoutMs
  let last: any = null
  while (Date.now() < deadline) {
    const res = await api('GET', `/api/erp/download-jobs/${jobId}`, undefined, token)
    last = res.data
    if (last && ['DONE', 'PARTIAL', 'FAILED'].includes(last.status)) return last
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return last
}

try {
  console.log('\n[0] 注册 + 采集/运营子帐号')
  const register = await api('POST', '/api/auth/register', { name: '老板', email: '13800000001', password: 'Owner#2026erp' })
  const ownerToken: string = register.data?.accessToken ?? register.data?.tokens?.accessToken
  const ownerRow = await prisma.user.findUnique({ where: { email: '13800000001' } })
  const orgId = ownerRow!.orgId
  const roles = await prisma.role.findMany({ where: { orgId }, select: { id: true, key: true } })
  const roleKeyMap = new Map(roles.map(role => [role.key, role.id]))
  const collectorMember = await api('POST', '/api/members', { email: '13800000002', password: 'Collector#2026', name: '采集小张', roleIds: [roleKeyMap.get('COLLECTOR')!] }, ownerToken)
  const operatorMember = await api('POST', '/api/members', { email: '13800000003', password: 'Operator#2026', name: '运营小李', roleIds: [roleKeyMap.get('OPERATOR')!] }, ownerToken)
  for (const member of [collectorMember, operatorMember]) {
    if (member.data?.id && member.data?.status && member.data.status !== 'ACTIVE') {
      await api('POST', `/api/members/${member.data.id}/approve`, {}, ownerToken)
    }
  }
  const collectorLogin = await api('POST', '/api/auth/login', { email: '13800000002', password: 'Collector#2026' })
  const collectorToken: string = collectorLogin.data?.accessToken ?? collectorLogin.data?.tokens?.accessToken
  const operatorLogin = await api('POST', '/api/auth/login', { email: '13800000003', password: 'Operator#2026' })
  const operatorToken: string = operatorLogin.data?.accessToken ?? operatorLogin.data?.tokens?.accessToken
  check('双角色登录成功', Boolean(collectorToken) && Boolean(operatorToken), { collector: collectorLogin.status, operator: operatorLogin.status })

  console.log('\n[1] 采集含成本/运费的产品 + 下载入库（DOWNLOADED）')
  const supplier = await prisma.erpSupplier.create({
    data: { orgId, code: 'GIGACLOUD', name: '大健云仓', loginUrl: 'https://www.gigab2b.com/', crawlRules: { domains: ['gigab2b.com'] }, patrolChannel: 'CLIENT', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
  })
  const collectRes = await api('POST', '/api/erp/collect', {
    items: [{
      supplierId: supplier.id, sourceProductId: 'GIGA-4001', sourceUrl: 'https://www.gigab2b.com/p/4001',
      titleOriginal: 'Pet Grooming Brush', category: 'Pet Supplies', brand: 'GIGA',
      costPrice: 20, shippingCost: 10, currency: 'CNY', stockQuantity: 5,
      images: [
        { imageType: 'MAIN', sourceUrl: `${imgBase}/a.jpg`, sortOrder: 0 },
        { imageType: 'MAIN', sourceUrl: `${imgBase}/b.jpg`, sortOrder: 1 },
        { imageType: 'DETAIL', sourceUrl: `${imgBase}/c.jpg`, sortOrder: 2 }
      ]
    }], mode: 'SINGLE'
  }, collectorToken)
  const productId: string = collectRes.data?.items?.[0]?.productId
  if (!productId) throw new Error(`采集未返回 productId：${JSON.stringify(collectRes)}`)
  const doneJob = await pollJob((await api('POST', `/api/erp/products/${productId}/download-images`, {}, operatorToken)).data?.id, operatorToken)
  check('前置：下载完成 DONE，状态 DOWNLOADED', doneJob?.status === 'DONE' && (await prisma.erpProduct.findUnique({ where: { id: productId } }))?.status === 'DOWNLOADED', doneJob?.status)

  console.log('\n[2] pricing_rules CRUD（采集角色禁 / 运营可读写 / upsert 单行）')
  const collectorRead = await api('GET', '/api/erp/pricing-rules', undefined, collectorToken)
  check('采集角色读取定价规则 403', collectorRead.status === 403, collectorRead)
  const collectorWrite = await api('POST', '/api/erp/pricing-rules', { platformCode: 'ebay', markupRate: 3 }, collectorToken)
  check('采集角色写定价规则 403', collectorWrite.status === 403, collectorWrite)
  const createRule = await api('POST', '/api/erp/pricing-rules', { platformCode: 'ebay', markupRate: 2.2, commissionRate: 0.13, fixedFee: 0.3, currency: 'USD' }, operatorToken)
  check('运营创建 eBay 定价规则 200', createRule.status === 200, createRule)
  const updateRule = await api('POST', '/api/erp/pricing-rules', { platformCode: 'ebay', fixedFee: 0.3 }, operatorToken)
  check('运营更新（upsert）同平台规则 200', updateRule.status === 200, updateRule)
  const ebayRules = await prisma.erpPricingRule.findMany({ where: { orgId, platformCode: 'ebay' } })
  check('eBay 定价规则 upsert 为单行', ebayRules.length === 1, ebayRules.length)
  const rulesList = await api('GET', '/api/erp/pricing-rules', undefined, operatorToken)
  check('运营读取定价规则列表 200 且含 ebay', rulesList.status === 200 && rulesList.data.some((r: any) => r.platformCode === 'ebay'), rulesList.data)

  console.log('\n[3] 多平台 listing 生成 + 参考价与手算公式一致')
  const genRes = await api('POST', `/api/erp/products/${productId}/listings`, { platforms: ['ebay', 'amazon'] }, operatorToken)
  check('生成 eBay/Amazon listing 200', genRes.status === 200, genRes)
  check('生成 2 条独立 listing', Array.isArray(genRes.data?.listings) && genRes.data.listings.length === 2, genRes.data?.listings?.length)
  const listingsRes = await api('GET', `/api/erp/products/${productId}/listings`, undefined, operatorToken)
  const ebayListing = listingsRes.data.find((l: any) => l.platformCode === 'ebay')
  const amazonListing = listingsRes.data.find((l: any) => l.platformCode === 'amazon')
  // 手算：ebay 规则 markup2.2/commission0.13/fixedFee0.3/USD；fx CNY->USD=0.14
  const expectedEbay = computeReferencePrice({ costPrice: 20, shippingCost: 10, markupRate: 2.2, commissionRate: 0.13, fixedFee: 0.3, exchangeRate: 0.14, currency: 'USD' })
  const expectedAmazon = computeReferencePrice({ costPrice: 20, shippingCost: 10, markupRate: 2.5, commissionRate: 0.15, fixedFee: 0, exchangeRate: 0.14, currency: 'USD' })
  check('eBay 参考价与手算公式一致（10.92）', ebayListing?.price === expectedEbay.price && expectedEbay.price === 10.92, { got: ebayListing?.price, want: expectedEbay.price })
  check('Amazon 参考价与手算公式一致（12.35）', amazonListing?.price === expectedAmazon.price && expectedAmazon.price === 12.35, { got: amazonListing?.price, want: expectedAmazon.price })
  check('eBay 与 Amazon 参考价独立不同', ebayListing?.price !== amazonListing?.price, { ebay: ebayListing?.price, amazon: amazonListing?.price })

  console.log('\n[4] 手改价不被重算覆盖')
  const manualRes = await api('PUT', `/api/erp/listings/${ebayListing.id}`, { price: 19.99 }, operatorToken)
  check('手改 eBay 价 200，priceManual=1', manualRes.status === 200 && manualRes.data?.priceManual === 1 && manualRes.data?.price === 19.99, manualRes.data)
  const recalcProtected = await api('POST', `/api/erp/listings/${ebayListing.id}/price-recalc`, {}, operatorToken)
  check('重算被手改价保护（protected=true）', recalcProtected.status === 200 && recalcProtected.data?.protected === true, recalcProtected.data)
  check('保护后价仍为手改 19.99', recalcProtected.data?.price === 19.99, recalcProtected.data?.price)
  const dbProtected = await prisma.erpListing.findUnique({ where: { id: ebayListing.id } })
  check('DB 中手改价未被覆盖（19.99 / priceManual=1）', dbProtected?.price === 19.99 && dbProtected?.priceManual === 1, { price: dbProtected?.price, pm: dbProtected?.priceManual })
  const recalcForce = await api('POST', `/api/erp/listings/${ebayListing.id}/price-recalc`, { force: true }, operatorToken)
  check('force 重算覆盖手改价（protected=false）', recalcForce.status === 200 && recalcForce.data?.protected === false && recalcForce.data?.price === 10.92, recalcForce.data)
  const recalcAmazon = await api('POST', `/api/erp/listings/${amazonListing.id}/price-recalc`, {}, operatorToken)
  check('非手改 listing 重算正常写入（Amazon 12.35）', recalcAmazon.data?.protected === false && recalcAmazon.data?.price === 12.35, recalcAmazon.data)

  console.log('\n[5] eBay/Amazon 双版本 listing 独立（标题互不覆盖）')
  await api('PUT', `/api/erp/listings/${ebayListing.id}`, { title: 'eBay Pet Brush' }, operatorToken)
  await api('PUT', `/api/erp/listings/${amazonListing.id}`, { title: 'Amazon Pet Brush Pro' }, operatorToken)
  const afterTitles = await api('GET', `/api/erp/products/${productId}/listings`, undefined, operatorToken)
  const ebayAfter = afterTitles.data.find((l: any) => l.platformCode === 'ebay')
  const amazonAfter = afterTitles.data.find((l: any) => l.platformCode === 'amazon')
  check('eBay 标题独立保存', ebayAfter?.title === 'eBay Pet Brush', ebayAfter?.title)
  check('Amazon 标题独立保存', amazonAfter?.title === 'Amazon Pet Brush Pro', amazonAfter?.title)
  check('两版 listing 仍为 2 行且平台不同', afterTitles.data.length === 2 && ebayAfter?.platformCode !== amazonAfter?.platformCode)

  console.log('\n[6] 导出包物料齐备')
  const images = await prisma.erpProductImage.findMany({ where: { productId }, orderBy: { sortOrder: 'asc' } })
  await api('POST', `/api/erp/products/${productId}/images/${images[0]!.id}/select`, { isSelected: true }, operatorToken)
  const exportRes = await api('GET', `/api/erp/products/${productId}/export`, undefined, operatorToken)
  check('导出接口 200', exportRes.status === 200, exportRes)
  const bundle = exportRes.data
  check('导出含产品核心信息', bundle?.product?.titleOriginal === 'Pet Grooming Brush', bundle?.product?.titleOriginal)
  check('导出含 3 张图片', Array.isArray(bundle?.images) && bundle.images.length === 3, bundle?.images?.length)
  check('导出图片走本地签名（禁外链）', (bundle?.images ?? []).every((i: any) => typeof i.url === 'string' && i.url.includes('/media/') && i.localPath !== ''), bundle?.images?.map((i: any) => i.url))
  check('导出含双平台 listing + 定价明细', Array.isArray(bundle?.listings) && bundle.listings.length === 2 && bundle.listings.every((l: any) => l.breakdown != null && l.price != null), bundle?.listings?.map((l: any) => [l.platformCode, l.price]))
  check('完整性核对表 complete=true', bundle?.completeness?.complete === true, bundle?.completeness)
  check('完整性表标记选定图/双平台/有标题/有价/无外链', bundle?.completeness?.hasSelectedImage === true && bundle?.completeness?.allHaveTitle === true && bundle?.completeness?.allHavePrice === true && bundle?.completeness?.noExternalRefs === true && (bundle?.completeness?.platforms ?? []).join(',') === 'amazon,ebay', bundle?.completeness)

  console.log('\n[7] 权限隔离')
  const anonListings = await api('GET', `/api/erp/products/${productId}/listings`)
  check('未登录访问 listing 401', anonListings.status === 401, anonListings)
  const collectorRecalc = await api('POST', `/api/erp/listings/${ebayListing.id}/price-recalc`, {}, collectorToken)
  check('采集角色重算参考价 403（无 erp.pricing.manage）', collectorRecalc.status === 403, collectorRecalc)
} catch (error) {
  failed += 1
  console.error('[verify-erp-p4] 异常：', error)
}

console.log(`\n[verify-erp-p4] 通过 ${passed} 项，失败 ${failed} 项`)
await app.close()
await socket.stop()
imageServer.close()
process.exit(failed === 0 ? 0 : 1)
