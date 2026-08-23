/**
 * 媒体存储抽象端到端验收脚本：
 * 1. 启动内存版 PGlite → 2. prisma migrate deploy → 3. 启动应用（MEDIA_DRIVER=local）
 * 4. 断言：local 驱动上传落盘与公共签名下载闭环、签名篡改/过期/路径穿越防护、
 *    权限（product.edit）与跨组织 key 隔离、审计留痕、OSS 驱动 V1 预签名格式（无网络）
 * 运行：pnpm verify:media
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// 注意：必须用异步 execFile——同步 exec 会冻结事件循环，导致同进程的 PGlite socket 无法响应
const execFileAsync = promisify(execFile)
import { createHmac } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPort = 5440
const mediaDir = mkdtempSync(path.join(tmpdir(), 'verify-media-'))
const MEDIA_SECRET = 'verify-media-secret'

// connection_limit 封顶 Prisma 连接池，避免 Promise.all 突发查询超出 PGlite socket 上限被销毁（P1001）
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable&connection_limit=20`
process.env.JWT_SECRET = 'verify-secret'
process.env.ACCESS_TOKEN_TTL = '1h'
process.env.LOG_LEVEL = 'warn'
process.env.MEDIA_DRIVER = 'local'
process.env.MEDIA_LOCAL_DIR = mediaDir
process.env.MEDIA_SIGNING_SECRET = MEDIA_SECRET
// 不设置 MEDIA_PUBLIC_BASE_URL：验证相对路径签名 URL（客户端自行拼接 origin）

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
const { OssMediaStorage } = await import('../src/lib/media/storage.js')
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

/** 按 local 驱动签名规则手工签名（与 LocalMediaStorage.sign 同算法） */
function signLocal(key: string, expires: number): string {
  return createHmac('sha256', MEDIA_SECRET).update(`${key}\n${expires}`).digest('base64url')
}

// 伪 PNG 内容（不必是真图片，驱动不校验内容）
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...Buffer.from('verify-media-payload', 'utf8')])

// ---------- 验收场景 ----------
try {
  console.log('\n[1] local 驱动上传与公共签名下载闭环')
  const registerA = await api('POST', '/api/auth/register', { orgName: '媒体组织A', name: '老板A', email: 'owner-media-a@test.com', password: 'pass1234' })
  const tokenA: string = registerA.data?.tokens?.accessToken ?? ''
  const orgAId: string = registerA.data?.user?.org?.id ?? ''
  check('注册组织A → 200', registerA.status === 200 && Boolean(tokenA) && Boolean(orgAId), registerA.data)

  const upload = await api('POST', '/api/media/uploads', {
    fileName: '产品主图.PNG', contentType: 'image/png', dataBase64: PNG_BYTES.toString('base64'), prefix: 'products'
  }, tokenA)
  const key: string = upload.data?.key ?? ''
  check('上传图片 → 200 + key 带组织命名空间',
    upload.status === 200 && key.startsWith(`org-${orgAId}/products/`) && key.endsWith('.png'),
    upload.data)
  check('响应：driver=local + size 一致 + 相对路径签名 URL',
    upload.data?.driver === 'local' && upload.data?.size === PNG_BYTES.length
    && /^\/media\/.+\?expires=\d+&signature=.+$/.test(upload.data?.url ?? ''),
    upload.data)

  const fileOnDisk = path.join(mediaDir, ...key.split('/'))
  check('文件已落盘且字节一致', existsSync(fileOnDisk) && readFileSync(fileOnDisk).equals(PNG_BYTES), fileOnDisk)

  const download = await fetch(base + upload.data.url)
  const downloaded = Buffer.from(await download.arrayBuffer())
  check('公共签名 URL 下载（无登录态）→ 200 字节一致 + content-type',
    download.status === 200 && downloaded.equals(PNG_BYTES) && download.headers.get('content-type') === 'image/png',
    { status: download.status, contentType: download.headers.get('content-type') })

  const signDownload = await api('POST', '/api/media/sign-download', { key, ttlSeconds: 600 }, tokenA)
  const download2 = await fetch(base + (signDownload.data?.url ?? ''))
  check('sign-download 重签 URL → 下载 200 字节一致',
    signDownload.status === 200 && signDownload.data?.expiresIn === 600 && download2.status === 200
    && Buffer.from(await download2.arrayBuffer()).equals(PNG_BYTES),
    signDownload.data)

  console.log('\n[2] 签名与路径安全')
  // 篡改末字符（若原为 A 则改 B，否则改 A），保证 URL 必然变化
  const rawUrl = upload.data.url as string
  const tamperedUrl = rawUrl.slice(0, -1) + (rawUrl.endsWith('A') ? 'B' : 'A')
  const tampered = await fetch(base + tamperedUrl)
  check('篡改签名 → 403', tamperedUrl !== rawUrl && tampered.status === 403, tampered.status)

  const expiredExpires = Math.floor(Date.now() / 1000) - 100
  const expiredUrl = `/media/${key}?expires=${expiredExpires}&signature=${encodeURIComponent(signLocal(key, expiredExpires))}`
  const expiredResp = await fetch(base + expiredUrl)
  check('过期签名 → 403', expiredResp.status === 403, expiredResp.status)

  const noParams = await fetch(`${base}/media/${key}`)
  check('缺少签名参数 → 400', noParams.status === 400, noParams.status)

  // URL 中的 .. 段会被归一化；用 %2F 编码使通配符段 decode 后才呈现 ../..，由验签层拒绝
  const evilKey = '../../etc/passwd'
  const evilExpires = Math.floor(Date.now() / 1000) + 600
  const evilInject = await app.inject({
    method: 'GET',
    url: `/media/..%2F..%2Fetc%2Fpasswd?expires=${evilExpires}&signature=${encodeURIComponent(signLocal(evilKey, evilExpires))}`
  })
  check('路径穿越 key + 有效签名 → 403（assertSafeKey 拒绝）', evilInject.statusCode === 403, evilInject.statusCode)

  // 单元层：即使签名算法正确，含 .. 的 key 也直接被 verifyDownloadSignature 拒绝
  const { LocalMediaStorage } = await import('../src/lib/media/storage.js')
  const unitStorage = new LocalMediaStorage({ rootDir: mediaDir, publicBaseUrl: '', signingSecret: MEDIA_SECRET })
  check('单元层：verifyDownloadSignature 拒绝路径穿越 key',
    unitStorage.verifyDownloadSignature(evilKey, evilExpires, signLocal(evilKey, evilExpires)) === false
    && unitStorage.verifyDownloadSignature('/absolute/path', evilExpires, signLocal('/absolute/path', evilExpires)) === false,
    evilKey)

  const signTraversal = await api('POST', '/api/media/sign-download', { key: '../etc/passwd' }, tokenA)
  check('sign-download 路径穿越 key → 403', signTraversal.status === 403, signTraversal.data)

  const ghostSign = await api('POST', '/api/media/sign-download', { key: `org-${orgAId}/products/not-exist.png` }, tokenA)
  const ghostResp = await fetch(base + (ghostSign.data?.url ?? ''))
  check('有效签名但对象不存在 → 404', ghostSign.status === 200 && ghostResp.status === 404, ghostResp.status)

  console.log('\n[3] 权限与跨组织隔离')
  const noAuth = await api('POST', '/api/media/uploads', { fileName: 'a.png', contentType: 'image/png', dataBase64: PNG_BYTES.toString('base64') })
  check('未登录上传 → 401', noAuth.status === 401, noAuth.status)

  const roles = await api('GET', '/api/roles', undefined, tokenA)
  const publisherRoleId = roles.data?.find((role: any) => role.name === '发布员')?.id
  await api('POST', '/api/members', { email: 'pub-media@test.com', name: '发布小B', password: 'pass1234', roleIds: [publisherRoleId], storeIds: [] }, tokenA)
  const pubToken: string = (await api('POST', '/api/auth/login', { email: 'pub-media@test.com', password: 'pass1234' })).data?.tokens?.accessToken ?? ''

  const pubUpload = await api('POST', '/api/media/uploads', { fileName: 'a.png', contentType: 'image/png', dataBase64: PNG_BYTES.toString('base64') }, pubToken)
  check('发布员（无 product.edit）上传 → 403', pubUpload.status === 403, pubUpload.data)
  const pubSignUpload = await api('POST', '/api/media/sign-upload', { fileName: 'a.png' }, pubToken)
  check('发布员 sign-upload → 403', pubSignUpload.status === 403, pubSignUpload.data)
  const pubDelete = await api('DELETE', `/api/media/objects?key=${encodeURIComponent(key)}`, undefined, pubToken)
  check('发布员删除对象 → 403', pubDelete.status === 403, pubDelete.data)
  const pubSignDownload = await api('POST', '/api/media/sign-download', { key }, pubToken)
  check('发布员 sign-download（登录即可）→ 200', pubSignDownload.status === 200, pubSignDownload.data)

  const registerB = await api('POST', '/api/auth/register', { orgName: '媒体组织B', name: '老板B', email: 'owner-media-b@test.com', password: 'pass1234' })
  const tokenB: string = registerB.data?.tokens?.accessToken ?? ''
  const crossSign = await api('POST', '/api/media/sign-download', { key }, tokenB)
  check('组织B 对组织A 的 key sign-download → 403', crossSign.status === 403, crossSign.data)
  const crossDelete = await api('DELETE', `/api/media/objects?key=${encodeURIComponent(key)}`, undefined, tokenB)
  check('组织B 删除组织A 的对象 → 403', crossDelete.status === 403, crossDelete.data)
  check('组织A 文件未被跨组织操作删除', existsSync(fileOnDisk), fileOnDisk)

  console.log('\n[4] 审计与上传边界')
  const uploadAudits = await prisma.auditLog.findMany({ where: { orgId: orgAId, action: 'media.upload', targetId: key } })
  check('审计：media.upload 留痕（含大小/类型/驱动）',
    uploadAudits.length === 1 && (uploadAudits[0]?.detail as any)?.size === PNG_BYTES.length
    && (uploadAudits[0]?.detail as any)?.driver === 'local',
    uploadAudits)

  const badType = await api('POST', '/api/media/uploads', { fileName: 'a.txt', contentType: 'text/plain', dataBase64: PNG_BYTES.toString('base64') }, tokenA)
  check('不支持的 contentType → 400', badType.status === 400 && badType.data?.error === 'UNSUPPORTED_CONTENT_TYPE', badType.data)

  const oversize = Buffer.alloc(25 * 1024 * 1024 + 1, 0x61)
  const tooBig = await api('POST', '/api/media/uploads', { fileName: 'big.png', contentType: 'image/png', dataBase64: oversize.toString('base64') }, tokenA)
  check('超过 25MB → 400 INVALID_SIZE', tooBig.status === 400 && tooBig.data?.error === 'INVALID_SIZE', tooBig.status)

  console.log('\n[5] OSS 驱动 V1 预签名（无网络，纯格式与可验签断言）')
  const oss = new OssMediaStorage({ bucket: 'my-bucket', endpoint: 'oss-cn-hangzhou.aliyuncs.com', accessKeyId: 'test-ak', accessKeySecret: 'test-sk' })
  const ossKey = 'org-abc/uploads/pic.png'
  const getUrl = oss.getSignedUrl(ossKey, 600)
  const parsedGet = new URL(getUrl)
  const getExpires = parsedGet.searchParams.get('Expires') ?? ''
  const getSignature = parsedGet.searchParams.get('Signature') ?? ''
  const expectGetSign = createHmac('sha1', 'test-sk').update(`GET\n\n\n${getExpires}\n/my-bucket/${ossKey}`).digest('base64')
  check('OSS GET 签名 URL：host/路径/参数形态正确',
    parsedGet.origin === 'https://my-bucket.oss-cn-hangzhou.aliyuncs.com' && parsedGet.pathname === `/${ossKey}`
    && parsedGet.searchParams.get('OSSAccessKeyId') === 'test-ak' && Number(getExpires) > Math.floor(Date.now() / 1000),
    getUrl)
  check('OSS GET 签名可重算验证（HMAC-SHA1 V1）', getSignature === expectGetSign, { getSignature, expectGetSign })

  const putUrl = oss.getUploadUrl(ossKey, 600) ?? ''
  const parsedPut = new URL(putUrl)
  const putSignature = parsedPut.searchParams.get('Signature') ?? ''
  const expectPutSign = createHmac('sha1', 'test-sk').update(`PUT\n\n\n${parsedPut.searchParams.get('Expires')}\n/my-bucket/${ossKey}`).digest('base64')
  check('OSS PUT 预签名上传 URL 可重算验证', Boolean(putUrl) && putSignature === expectPutSign, putUrl)

  let ossPutThrew = false
  try { await oss.put(ossKey, PNG_BYTES, 'image/png') } catch { ossPutThrew = true }
  check('OSS 驱动拒绝服务端直传（提示走预签名）', ossPutThrew, ossPutThrew)

  let ossBadKeyThrew = false
  try { oss.getSignedUrl('../etc/passwd', 60) } catch { ossBadKeyThrew = true }
  check('OSS 驱动拒绝路径穿越 key', ossBadKeyThrew, ossBadKeyThrew)

  console.log('\n[6] 删除闭环')
  const remove = await api('DELETE', `/api/media/objects?key=${encodeURIComponent(key)}`, undefined, tokenA)
  const afterDelete = await fetch(base + upload.data.url)
  check('删除对象 → 200 且文件与下载均失效',
    remove.status === 200 && remove.data?.ok === true && !existsSync(fileOnDisk) && afterDelete.status === 404,
    { remove: remove.status, after: afterDelete.status })
  const removeAudits = await prisma.auditLog.findMany({ where: { orgId: orgAId, action: 'media.remove', targetId: key } })
  check('审计：media.remove 留痕', removeAudits.length === 1, removeAudits.length)
} finally {
  await app.close()
  await socket.stop()
  await db.close()
  rmSync(mediaDir, { recursive: true, force: true })
}

console.log(`\n[verify] 通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) process.exit(1)
