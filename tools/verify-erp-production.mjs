// ERP部署验收：仅通过已经运行的 API 验证业务，不启动服务、不导入应用、不替换依赖、不签 JWT。
// 依赖：Node.js >= 20、/app 中可导入的 @prisma/client、同库 DATABASE_URL、已部署 ERP migration。
// 服务端还需配置可用的百炼、媒体存储与公网媒体基址；不接受/打印任何固定输入 secret。
// 运行：ssh YOUR_SSH_HOST 'docker exec -i -w /app yandu-app node --input-type=module - mode=verify' < tools/verify-erp-production.mjs
// 清理：同上改为 docker exec -i -e ERP_CLEANUP_ORG_ID=报告中的orgId ... - mode=cleanup。
// cleanup 永不删除账号、组织、认证令牌和审计；删除精确归属的 ERP 数据及媒体后，停用验收账号并撤销其令牌。
// 若写请求结果不明或进程被中断，默认拒绝清理；人工确认服务端无在途任务后才可额外设置 ERP_CLEANUP_CONFIRM_IDLE=1。
// 已有 /tmp/erp-deploy-auth.json 时拒绝再次 verify，避免覆盖浏览器凭据或重复产生 AI 费用。
// 原始 JSON 导出仅在内存核验，不公开媒体签名/外链/账号信息，不额外发布公开缩略图。
// 边界：不验证第三方货盘 DOM/登录/反爬、巡盘 provider/定时调度、平台实际发布、视觉质量或跨币种汇率。
// 注册路由必然暂挂最早组织并写注册审计；仅本次账号随后迁入验收组织，原注册审计保留。

import { randomBytes, randomInt, createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = 'http://127.0.0.1:8787'
const AUTH_FILE = '/tmp/erp-deploy-auth.json'
const MARKER = 'ERP部署验收'
const VERSION = 1
const mode = process.argv.find(arg => arg.startsWith('mode='))?.slice(5) || process.env.mode || 'verify'
const report = {
  name: MARKER, mode: ['verify', 'cleanup'].includes(mode) ? mode : 'invalid',
  startedAt: new Date().toISOString(), checks: [],
  isolation: { orgId: null, fixture: true, retained: true, accountDeleted: false },
  aiOutput: { titles: [], imageCount: 0 },
  aiBudget: { titleRequests: 0, imageRequests: 0, requestedTitles: 3, requestedImages: 1, automaticRetry: false },
  boundaries: [
    '采集输入为明确标注的人工验收 JSON，不是第三方货盘实际 DOM 采集。',
    'PNG 为自行绘制的无品牌蓝色容器验收素材，不是真实商品或供应商照片。',
    '百炼标题仅请求一次三标题；Amazon 复用其中一个标题，不另行调用 AI。',
    '图生图只请求一次一张；API 超时不代表供应商未计费，不自动重试。',
    'P5 仅验通知列表、真实汇总接口及变更列表；无 provider 的自动巡盘不算通过。',
    'eBay/Amazon 仅验证 ERP 内部草稿、USD 同币种定价与 JSON 导出，不进行实际平台发布。',
    '未验证视觉质量、商品一致性人工评审、浏览器界面、跨币种汇率或租户对抗性安全测试。',
    '注册审计保留在注册路由指定的原组织；不读取或更改其他账号与真实业务记录。',
    '既有后台调度可能继续为保留的验收组织写入汇总；本脚本不更改全局调度配置。'
  ],
  dependencies: [
    'Node.js >= 20；@prisma/client 与部署 schema 一致；DATABASE_URL 与正在运行的 API 指向同库。',
    '容器内 API 已在 127.0.0.1:8787 运行；至少已有一个组织，禁止触发首次安装引导。',
    '服务端百炼配置、模型权限/额度、出网及媒体写入正常；参考图签名 URL 必须能被百炼访问。',
    '临时凭据文件仅当前容器用户可读写；浏览器验收应在清理之前进行。'
  ]
}
let prisma, state, authHandle, token = '', authenticated = false, closing = false

class CheckFailure extends Error {
  constructor(code, statusCode = null) { super(code); this.code = code; this.statusCode = statusCode }
}
function must(condition, code = 'RESPONSE_SHAPE_MISMATCH') {
  if (!condition) throw new CheckFailure(code)
}
const publicErrorCodes = new Set([
  'UNAUTHORIZED', 'FORBIDDEN', 'VALIDATION', 'INTERNAL', 'NOT_FOUND', 'REQUEST_ERROR',
  'ACCOUNT_PENDING', 'ACCOUNT_DISABLED', 'ACCOUNT_REJECTED', 'BAD_CREDENTIALS',
  'EMAIL_TAKEN', 'REGISTER_PENDING', 'REGISTER_REJECTED', 'WEAK_PASSWORD',
  'AI_NOT_CONFIGURED', 'AI_PROVIDER_ERROR', 'AI_PROVIDER_TIMEOUT', 'UNKNOWN_MODEL',
  'USE_SIGNED_UPLOAD', 'UNSUPPORTED_CONTENT_TYPE', 'INVALID_SIZE', 'INVALID_SIGNATURE',
  'ERP_PRODUCT_NOT_FOUND', 'ERP_SUPPLIER_NOT_FOUND', 'ERP_DOWNLOAD_JOB_NOT_FOUND',
  'ERP_NO_IMAGES_TO_DOWNLOAD', 'ERP_NOT_DOWNLOADED', 'ERP_NO_REFERENCE_IMAGE',
  'ERP_UNKNOWN_IMAGE_MODEL', 'ERP_AI_NO_IMAGE', 'ERP_AI_NO_TITLE', 'ERP_IMAGE_NOT_FOUND',
  'ERP_PLATFORM_REQUIRED', 'ERP_TITLE_EMPTY', 'ERP_LISTING_NOT_FOUND', 'ERP_FX_MISSING',
  'ERP_BAD_MARKUP', 'ERP_BAD_COMMISSION', 'ERP_BAD_FX', 'ERP_BAD_PRICE', 'ERP_NOTIFICATION_NOT_FOUND',
  'FST_ERR_CTP_BODY_TOO_LARGE', 'FST_ERR_CTP_INVALID_JSON_BODY', 'FST_ERR_CTP_EMPTY_JSON_BODY'
])
function errorCode(error) {
  if (error instanceof CheckFailure) return error.code
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'REQUEST_TIMEOUT'
  if (/^P\d{4}$/.test(error?.code || '')) return `DATABASE_${error.code}`
  if (error?.code === 'EEXIST') return 'AUTH_FILE_EXISTS_NO_RERUN'
  if (error?.code === 'ENOENT') return 'AUTH_FILE_NOT_FOUND'
  if (error?.code === 'EACCES' || error?.code === 'EPERM') return 'LOCAL_PERMISSION_DENIED'
  if (error?.code === 'ERR_MODULE_NOT_FOUND') return 'PRISMA_DEPENDENCY_MISSING'
  if (error?.name === 'TypeError') return 'NETWORK_OR_CONTRACT_ERROR'
  return 'UNEXPECTED_ERROR_REDACTED'
}
function progress(name, status) { process.stderr.write(`[ERP部署验收] ${name}: ${status}\n`) }
async function check(name, action, enabled = true) {
  const entry = { name, status: 'SKIP', statusCode: null }
  report.checks.push(entry)
  if (!enabled) { entry.errorCode = 'DEPENDENCY_FAILED'; progress(name, 'SKIP'); return null }
  progress(name, 'RUNNING')
  const ctx = { statusCode: null, details: {} }
  try {
    const value = await action(ctx)
    entry.status = 'PASS'
    entry.statusCode = ctx.statusCode
    if (Object.keys(ctx.details).length) entry.details = ctx.details
    progress(name, 'PASS')
    return { value, statusCode: ctx.statusCode }
  } catch (error) {
    entry.status = 'FAIL'
    entry.statusCode = error instanceof CheckFailure ? error.statusCode ?? ctx.statusCode : ctx.statusCode
    entry.errorCode = errorCode(error)
    progress(name, 'FAIL')
    return null
  }
}
function excluded(name, code) { report.checks.push({ name, status: 'NOT_VERIFIED', statusCode: null, errorCode: code }) }
async function saveState() {
  must(authHandle && state, 'AUTH_MANIFEST_UNAVAILABLE')
  const bytes = Buffer.from(JSON.stringify(state, null, 2))
  let offset = 0
  while (offset < bytes.length) {
    const { bytesWritten } = await authHandle.write(bytes, offset, bytes.length - offset, offset)
    must(bytesWritten > 0, 'AUTH_MANIFEST_WRITE_FAILED')
    offset += bytesWritten
  }
  await authHandle.truncate(bytes.length)
  await authHandle.sync()
}
async function openPrivateFile(create) {
  authHandle = await open(AUTH_FILE, constants.O_RDWR | constants.O_NOFOLLOW | (create ? constants.O_CREAT | constants.O_EXCL : 0), 0o600)
  const stat = await authHandle.stat()
  must(stat.isFile() && stat.nlink === 1 && (stat.mode & 0o777) === 0o600 && stat.uid === process.getuid(), 'UNSAFE_AUTH_FILE')
}
async function boundedBody(response, limit) {
  const chunks = []; let size = 0
  for await (const chunk of response.body ?? []) {
    size += chunk.length
    must(size <= limit, 'RESPONSE_TOO_LARGE')
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
// 不重试任何写请求；所有错误 message/response body 都禁止流入报告。
async function api(ctx, pathname, { method = 'GET', body, auth = true, timeout = 30000 } = {}) {
  ctx.statusCode = null
  must(pathname.startsWith('/') && !pathname.startsWith('//'), 'UNSAFE_API_PATH')
  must(!auth || (authenticated && token), 'AUTH_REQUIRED')
  const mutating = !['GET', 'HEAD'].includes(method)
  if (mutating && state) {
    state.inFlight = { at: new Date().toISOString(), deadline: Date.now() + timeout + 900000 }
    await saveState()
  }
  try {
    const response = await fetch(`${BASE}${pathname}`, {
      method, headers: { ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(timeout)
    })
    ctx.statusCode = response.status
    const bytes = await boundedBody(response, 8 * 1024 * 1024)
    let data
    try { data = JSON.parse(bytes.toString('utf8')) } catch { throw new CheckFailure('NON_JSON_RESPONSE', response.status) }
    if (mutating && state) { state.inFlight = null; await saveState() }
    if (!response.ok) {
      const code = typeof data?.error === 'string' && publicErrorCodes.has(data.error) ? data.error : 'HTTP_ERROR_REDACTED'
      throw new CheckFailure(code, response.status)
    }
    return data
  } catch (error) {
    if (mutating && state?.inFlight) {
      state.uncertainWrites = true
      state.uncertainUntil = Math.max(state.uncertainUntil || 0, state.inFlight.deadline)
      await saveState()
    }
    throw error
  }
}
function safeKey(key) {
  return typeof key === 'string' && /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,511}$/.test(key) && !key.includes('..') && !key.includes('//') && !key.endsWith('/')
}
function ownUploadKey(key) { return safeKey(key) && key.startsWith(`org-${state.orgId}/${state.mediaPrefix}/`) }
function ownImageKey(key, productId, imageId) {
  return safeKey(key) && ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].some(ext => key === `org-${state.orgId}/erp/${productId}/${imageId}.${ext}`)
}
function mediaUrl(raw) {
  must(typeof raw === 'string' && raw.length > 0, 'MEDIA_URL_MISSING')
  const url = new URL(raw, BASE)
  must(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password, 'UNSAFE_MEDIA_URL')
  // 仅补全 local 驱动的相对路径，不改写已有公网 URL，不绕开真实下载链路。
  if (raw.startsWith('/')) must(raw.startsWith(`/media/org-${state.orgId}/`), 'MEDIA_SCOPE_MISMATCH')
  return url.href
}
async function fetchPicture(ctx, raw) {
  ctx.statusCode = null
  const response = await fetch(mediaUrl(raw), { redirect: 'error', signal: AbortSignal.timeout(60000) })
  ctx.statusCode = response.status
  must(response.ok, 'MEDIA_HTTP_ERROR')
  const buffer = await boundedBody(response, 25 * 1024 * 1024)
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  const png = buffer.length >= 33 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  const jpg = buffer.length >= 4 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
  const webp = buffer.length >= 16 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  must((png && type === 'image/png') || (jpg && ['image/jpeg', 'image/jpg'].includes(type)) || (webp && type === 'image/webp'), 'INVALID_IMAGE_BYTES_OR_TYPE')
  return buffer
}
function digest(buffer) { return createHash('sha256').update(buffer).digest('hex') }
function publicTitle(title) {
  if (typeof title !== 'string' || !title.trim() || title.length > 200) return '[已脱敏]'
  if (!/^[A-Za-z0-9 ,.'()&+\-]+$/.test(title) || /\d{6,}|[A-Za-z0-9]{32,}|token|bearer|password|signature|api.?key|https?|www/i.test(title)) return '[已脱敏]'
  if ([state?.email, state?.password, token].filter(Boolean).some(secret => title.includes(secret))) return '[已脱敏]'
  return title
}
function productScope(product) {
  must(product?.id === state.productId && product.orgId === state.orgId && product.supplierId === state.supplierId && product.sourceProductId === state.sourceProductId, 'PRODUCT_SCOPE_MISMATCH')
}
function validPage(value) { return value && Array.isArray(value.items) && Number.isInteger(value.total) && value.total >= 0 && value.page === 1 }

// 直接编码有效 512×512 RGB PNG：白底蓝色简易容器；仅作验收 fixture，无 SVG、外部素材或额外库。
function fixturePng() {
  const width = 512, height = 512, scan = Buffer.alloc((width * 3 + 1) * height, 255)
  for (let y = 0; y < height; y++) {
    scan[y * (width * 3 + 1)] = 0
    for (let x = 0; x < width; x++) {
      let rgb = [255, 255, 255]
      if (((x - 260) / 150) ** 2 + ((y - 409) / 24) ** 2 < 1) rgb = [230, 233, 236]
      if (y >= 161 && y <= 380 && x >= 148 && x <= 364) rgb = [36, 112 + Math.round((x - 148) / 10), 191]
      if (((x - 256) / 108) ** 2 + ((y - 380) / 30) ** 2 < 1) rgb = [36, 122, 191]
      if (((x - 256) / 108) ** 2 + ((y - 160) / 32) ** 2 < 1) rgb = [72, 159, 219]
      if (((x - 256) / 91) ** 2 + ((y - 160) / 20) ** 2 < 1) rgb = [25, 85, 146]
      if (x >= 169 && x <= 181 && y >= 195 && y <= 347) rgb = [78, 160, 219]
      const offset = y * (width * 3 + 1) + 1 + x * 3
      scan[offset] = rgb[0]; scan[offset + 1] = rgb[1]; scan[offset + 2] = rgb[2]
    }
  }
  const chunk = (type, data) => {
    const content = Buffer.concat([Buffer.from(type, 'ascii'), data])
    let crc = 0xffffffff
    for (const byte of content) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
    }
    const head = Buffer.alloc(4), tail = Buffer.alloc(4)
    head.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
    return Buffer.concat([head, content, tail])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(scan)), chunk('IEND', Buffer.alloc(0))])
}

async function login(ctx) {
  const data = await api(ctx, '/api/auth/login', { method: 'POST', auth: false, body: { email: state.email, password: state.password } })
  must(data?.user?.id === state.userId && data.user.email === state.email && data.user.org?.id === state.orgId && data.user.org.name === state.orgName && data.user.status === 'ACTIVE' && data.user.isOwner === true, 'LOGIN_PROFILE_SCOPE_MISMATCH')
  must(typeof data.tokens?.accessToken === 'string' && data.tokens.accessToken.length > 20, 'LOGIN_TOKEN_MISSING')
  token = data.tokens.accessToken
  authenticated = true
  state.accessToken = token; state.profile = data.user; state.loginAt = new Date().toISOString()
  await saveState()
}
async function verifyIdentity(ctx) {
  const data = await api(ctx, '/api/auth/me')
  must(data?.id === state.userId && data.email === state.email && data.org?.id === state.orgId && data.org.name === state.orgName && data.status === 'ACTIVE' && data.isOwner === true, 'IDENTITY_SCOPE_MISMATCH')
}
async function assertFixtureOwner(db) {
  const org = await db.organization.findFirst({ where: { id: state.orgId, name: state.orgName }, select: { id: true, users: { select: { id: true, email: true, name: true } } } })
  must(org && org.users.length === 1 && org.users[0].id === state.userId && org.users[0].email === state.email && org.users[0].name === state.accountName, 'FIXTURE_OWNER_MISMATCH')
}
async function prepareFixture(ctx) {
  // 禁止首次安装 bootstrap；只读最早组织 ID，不读取其业务或其他账号信息。
  const firstOrg = await prisma.organization.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
  must(firstOrg, 'EXISTING_INSTALLATION_REQUIRED')
  await openPrivateFile(true)
  const runId = randomBytes(16).toString('hex')
  let email
  for (let i = 0; i < 10; i++) {
    email = `1${String(randomInt(0, 10000000000)).padStart(10, '0')}`
    if (!await prisma.user.findUnique({ where: { email }, select: { id: true } })) break
    email = null
  }
  must(email, 'FIXTURE_ACCOUNT_COLLISION')
  state = {
    version: VERSION, marker: MARKER, runId, startedAt: new Date().toISOString(), runnerPid: process.pid,
    orgId: `erp-deploy-${runId}`, orgName: `${MARKER} ${runId}`, originalOrgId: firstOrg.id,
    accountName: `${MARKER}-${runId.slice(0, 8)}`, email, password: `Erp9!${randomBytes(24).toString('base64url')}`,
    userId: null, supplierId: `erp-supplier-${runId}`, supplierCode: `ERP_DEPLOY_${runId}`,
    sourceProductId: `erp-fixture-${runId}`, productId: null, mediaPrefix: `erp-${runId}`,
    mediaKeys: [], aiRequests: { title: 0, image: 0 }, uncertainWrites: false,
    accessToken: null, profile: null, registered: false, approved: false, finishedAt: null
  }
  report.isolation.orgId = state.orgId
  report.isolation.runId = runId
  await saveState()
  ctx.details = { fixture: true, authFileMode: '0600', existingInstallation: true }
}
async function approveNewAccount() {
  const registered = await prisma.user.findUnique({ where: { email: state.email }, select: { id: true, orgId: true, email: true, name: true, status: true, isOwner: true, createdAt: true } })
  must(registered && registered.orgId === state.originalOrgId && registered.name === state.accountName && registered.status === 'PENDING' && !registered.isOwner && registered.createdAt.getTime() >= Date.parse(state.startedAt), 'NEW_PENDING_ACCOUNT_MISMATCH')
  state.userId = registered.id
  await saveState()
  await prisma.$transaction(async tx => {
    await tx.organization.create({ data: { id: state.orgId, name: state.orgName } })
    const updated = await tx.user.updateMany({
      where: { id: state.userId, email: state.email, name: state.accountName, orgId: state.originalOrgId, status: 'PENDING', isOwner: false, createdAt: { gte: new Date(state.startedAt) }, roles: { none: {} }, storeGrants: { none: {} } },
      data: { orgId: state.orgId, status: 'ACTIVE', isOwner: true, mustChangePassword: false }
    })
    must(updated.count === 1, 'EXACT_APPROVAL_SCOPE_FAILED')
  })
  state.approved = true
  await saveState()
}
async function uploadFixture(ctx, png) {
  const result = await api(ctx, '/api/media/sign-upload', { method: 'POST', body: { fileName: 'erp-deploy-fixture.png', prefix: state.mediaPrefix, ttlSeconds: 600 } })
  must(ownUploadKey(result.key), 'UPLOAD_SCOPE_MISMATCH')
  let key = result.key
  if (result.driver === 'local') {
    must(result.uploadUrl === null, 'LOCAL_UPLOAD_CONTRACT_MISMATCH')
    const uploaded = await api(ctx, '/api/media/uploads', { method: 'POST', body: { fileName: 'erp-deploy-fixture.png', contentType: 'image/png', prefix: state.mediaPrefix, dataBase64: png.toString('base64') } })
    must(uploaded.driver === 'local' && ownUploadKey(uploaded.key) && uploaded.size === png.length, 'UPLOAD_RESPONSE_MISMATCH')
    key = uploaded.key
  } else {
    must(result.driver === 'oss' && result.method === 'PUT' && typeof result.uploadUrl === 'string', 'UPLOAD_DRIVER_UNSUPPORTED')
    state.mediaKeys.push(key); await saveState()
    // 当前 OSS V1 签名未包含 Content-Type，真实 PUT 必须同样不发送该头。
    state.inFlight = { at: new Date().toISOString(), deadline: Date.now() + 960000 }; await saveState()
    ctx.statusCode = null
    try {
      const response = await fetch(mediaUrl(result.uploadUrl), { method: 'PUT', body: png, redirect: 'error', signal: AbortSignal.timeout(60000) })
      ctx.statusCode = response.status
      await response.body?.cancel()
      state.inFlight = null; await saveState()
      must(response.ok, 'OSS_FIXTURE_UPLOAD_FAILED')
    } catch (error) {
      if (state.inFlight) {
        state.uncertainWrites = true
        state.uncertainUntil = Math.max(state.uncertainUntil || 0, state.inFlight.deadline)
        await saveState()
      }
      throw error
    }
  }
  if (!state.mediaKeys.includes(key)) state.mediaKeys.push(key)
  state.mediaDriver = result.driver
  await saveState()
  const signed = await api(ctx, '/api/media/sign-download', { method: 'POST', body: { key, ttlSeconds: 86400 } })
  return { key, url: mediaUrl(signed.url) }
}

async function verifyFlow() {
  const healthy = await check('api.health', async ctx => { const data = await api(ctx, '/health', { auth: false }); must(data?.ok === true) })
  const prepared = await check('fixture.prepare', prepareFixture, Boolean(healthy && prisma))
  const registered = await check('auth.register.pending', async ctx => {
    const data = await api(ctx, '/api/auth/register', { method: 'POST', auth: false, body: { name: state.accountName, email: state.email, password: state.password } })
    must(data?.pending === true && !data.tokens, 'REGISTER_NOT_PENDING')
    state.registered = true; await saveState()
  }, Boolean(prepared))
  const approved = await check('auth.approve.exact-new-account', approveNewAccount, Boolean(registered))
  const loggedIn = await check('auth.login.real', login, Boolean(approved))
  const identity = await check('auth.me.isolated-org', verifyIdentity, Boolean(loggedIn))
  const usable = Boolean(identity)
  const supplier = await check('fixture.supplier.config-only', async ctx => {
    await prisma.$transaction(async tx => {
      await assertFixtureOwner(tx)
      await tx.erpSupplier.create({ data: {
        id: state.supplierId, orgId: state.orgId, code: state.supplierCode, name: `${MARKER} fixture（非真实货盘）`,
        loginUrl: '', patrolChannel: 'CLIENT', status: 'DISABLED',
        crawlRules: { fixture: true, runId: state.runId, provider: 'NONE', purpose: MARKER },
        createdAt: state.startedAt, updatedAt: state.startedAt
      } })
    })
    ctx.details = { fixture: true, actualSupplierCollection: false }
  }, usable)
  await check('erp.suppliers.read', async ctx => {
    const data = await api(ctx, '/api/erp/suppliers')
    must(Array.isArray(data) && data.every(row => row.id === state.supplierId), 'SUPPLIER_LIST_SCOPE_MISMATCH')
    if (supplier) must(data.length === 1 && data[0].crawlRules?.runId === state.runId)
    ctx.details = { count: data.length }
  }, usable)
  const png = fixturePng()
  const uploaded = await check('media.upload.fixture-png', ctx => uploadFixture(ctx, png), usable)
  const sourceFetched = await check('media.fixture.real-http-fetch', async ctx => {
    must(digest(await fetchPicture(ctx, uploaded.value.url)) === digest(png), 'FIXTURE_BYTES_MISMATCH')
  }, Boolean(uploaded))
  const collected = await check('erp.collect.valid-json', async ctx => {
    const data = await api(ctx, '/api/erp/collect', { method: 'POST', body: { mode: 'SINGLE', items: [{
      supplierId: state.supplierId, sourceProductId: state.sourceProductId, sourceUrl: '', sourceSku: 'ERP-DEPLOY-FIXTURE',
      titleOriginal: 'Unbranded Blue Storage Cup Deployment Test Fixture',
      descriptionOriginal: 'ERP部署验收专用人工数据与自行绘制 PNG，不是真实货盘商品，不得发布或履约。',
      costPrice: 10, shippingCost: 2, currency: 'USD', stockQuantity: 5,
      dimensions: { length: 10, width: 10, height: 12, unit: 'cm', fixture: true }, weight: 0.2,
      material: 'plastic', color: 'blue', brand: '', category: 'Storage', variants: [],
      crawlConfig: { fixture: true, runId: state.runId, purpose: MARKER },
      images: uploaded ? [{ imageType: 'MAIN', sourceUrl: uploaded.value.url, sortOrder: 0 }] : []
    }] } })
    must(data?.total === 1 && data.created === 1 && Array.isArray(data.items) && data.items.length === 1 && data.items[0].result === 'CREATED' && /^c[a-z0-9]{20,40}$/.test(data.items[0].productId || ''), 'COLLECT_ITEM_FAILED_OR_NOT_CREATED')
    state.productId = data.items[0].productId; await saveState()
    ctx.details = { created: 1, fixture: true, suppliedImages: uploaded ? 1 : 0 }
  }, Boolean(supplier))
  const detail = await check('erp.product.collected.read', async ctx => {
    const data = await api(ctx, `/api/erp/products/${state.productId}`)
    productScope(data); must(data.status === 'COLLECTED' && data.crawlConfig?.runId === state.runId)
    must(Array.isArray(data.images) && data.images.length === (uploaded ? 1 : 0))
    return data
  }, Boolean(collected && usable))
  const queued = await check('erp.images.download.enqueue', ctx => api(ctx, `/api/erp/products/${state.productId}/download-images`, { method: 'POST', body: {} }), Boolean(detail && uploaded))
  const downloaded = await check('erp.images.download.worker', async ctx => {
    const job = queued.value
    must(typeof job?.id === 'string' && job.productId === state.productId && job.total === 1, 'DOWNLOAD_JOB_MISMATCH')
    const deadline = Date.now() + 180000
    while (Date.now() < deadline) {
      const current = await api(ctx, `/api/erp/download-jobs/${encodeURIComponent(job.id)}`)
      must(current.id === job.id && current.productId === state.productId, 'DOWNLOAD_JOB_SCOPE_MISMATCH')
      if (['DONE', 'PARTIAL', 'FAILED'].includes(current.status)) {
        must(current.status === 'DONE' && current.total === 1 && current.done === 1 && Array.isArray(current.failedUrls) && current.failedUrls.length === 0, 'DOWNLOAD_JOB_NOT_FULLY_DONE')
        return current
      }
      must(['PENDING', 'RUNNING'].includes(current.status), 'DOWNLOAD_JOB_UNKNOWN_STATUS')
      await sleep(1000)
    }
    throw new CheckFailure('DOWNLOAD_POLL_TIMEOUT')
  }, Boolean(queued))
  const original = await check('erp.images.download.persisted-http', async ctx => {
    // worker 先写 DONE 再推进产品状态，允许该正常的短暂可见性间隔。
    let data
    for (let i = 0; i < 10; i++) {
      data = await api(ctx, `/api/erp/products/${state.productId}`); productScope(data)
      if (data.status === 'DOWNLOADED') break
      await sleep(300)
    }
    must(data.status === 'DOWNLOADED' && data.images?.length === 1, 'PRODUCT_NOT_DOWNLOADED')
    const image = data.images[0]
    must(image.imageType === 'MAIN' && ownImageKey(image.localPath, state.productId, image.id) && !Object.hasOwn(image, 'sourceUrl'), 'ORIGINAL_NOT_STORED_LOCALLY')
    must(digest(await fetchPicture(ctx, image.url)) === digest(png), 'DOWNLOADED_BYTES_MISMATCH')
    return image
  }, Boolean(downloaded))
  const titles = await check('ai.bailian.three-titles.once', async ctx => {
    must(state.aiRequests.title === 0, 'AI_BUDGET_EXHAUSTED')
    state.aiRequests.title++; report.aiBudget.titleRequests++; await saveState()
    const data = await api(ctx, `/api/erp/products/${state.productId}/ai-titles`, { method: 'POST', timeout: 240000, body: { platform: 'ebay', styles: ['卖点精炼型', '关键词覆盖型', '场景情感型'] } })
    must(data?.productId === state.productId && data.platform === 'ebay' && data.charLimit === 80 && Array.isArray(data.options) && data.options.length === 3, 'AI_THREE_TITLES_REQUIRED')
    must(data.options.every(row => typeof row.title === 'string' && row.title.trim() && row.title.length <= 80 && row.charCount === row.title.length), 'AI_TITLE_INVALID')
    report.aiOutput.titles = data.options.map(row => publicTitle(row.title))
    return data.options
  }, Boolean(collected && usable))
  await check('ai.three-titles.persisted-read', async ctx => {
    const data = await api(ctx, `/api/erp/products/${state.productId}/listings`)
    must(Array.isArray(data), 'TITLE_LISTING_RESPONSE_MISMATCH')
    const row = data.find(item => item.platformCode === 'ebay')
    must(row?.orgId === state.orgId && row.productId === state.productId && Array.isArray(row.aiTitleOptions) && row.aiTitleOptions.length === 3, 'TITLE_OPTIONS_NOT_PERSISTED')
    must(row.aiTitleOptions.every((option, i) => option.title === titles.value[i].title && option.style === titles.value[i].style), 'PERSISTED_TITLE_OPTIONS_MISMATCH')
  }, Boolean(titles && usable))
  const generated = await check('ai.bailian.image-to-image.once', async ctx => {
    must(state.aiRequests.image === 0, 'AI_BUDGET_EXHAUSTED')
    state.aiRequests.image++; report.aiBudget.imageRequests++; await saveState()
    const data = await api(ctx, `/api/erp/products/${state.productId}/ai-images`, { method: 'POST', timeout: 300000, body: {
      platform: 'ebay', model: 'qwen-image-edit-plus', count: 1, size: '1K',
      prompt: 'This is a synthetic deployment test fixture, not a real sale item. Keep the blue storage cup in the reference image. Improve studio lighting on a white background without adding text or a logo.'
    } })
    must(data?.productId === state.productId && data.model === 'qwen-image-edit-plus' && data.platform === 'ebay' && data.generated === 1 && Array.isArray(data.candidates) && data.candidates.length === 1 && data.status === 'PROCESSING', 'AI_ONE_IMAGE_REQUIRED')
    report.aiOutput.imageCount = data.generated
    return data.candidates[0]
  }, Boolean(original && usable))
  const candidate = await check('ai.image.persisted-reference-preserved', async ctx => {
    const data = await api(ctx, `/api/erp/products/${state.productId}`); productScope(data)
    must(data.status === 'PROCESSING' && data.images?.length === 2, 'AI_PRODUCT_STATE_MISMATCH')
    const image = data.images.find(row => row.id === generated.value.id)
    must(image?.imageType === 'AI' && image.isSelected === 0 && ownImageKey(image.localPath, state.productId, image.id), 'AI_IMAGE_NOT_PERSISTED')
    must(data.images.some(row => row.id === original.value.id && row.localPath === original.value.localPath && row.imageType === 'MAIN'), 'ORIGINAL_IMAGE_REPLACED')
    must(!Object.hasOwn(image, 'sourceUrl'), 'AI_EXTERNAL_REFERENCE_LEAK')
    must(digest(await fetchPicture(ctx, image.url)) !== digest(png), 'AI_RETURNED_UNCHANGED_FIXTURE')
    return image
  }, Boolean(generated))
  const chosen = {}
  for (const [index, platform] of ['ebay', 'amazon'].entries()) {
    chosen[platform] = await check(`erp.title.choose.${platform}`, async ctx => {
      const title = titles.value[index].title
      const data = await api(ctx, `/api/erp/products/${state.productId}/choose-title`, { method: 'POST', body: { platform, title } })
      must(data?.platform === platform && data.title === title && typeof data.listingId === 'string', 'CHOSEN_TITLE_MISMATCH')
    }, Boolean(titles && usable))
  }
  const selected = await check('erp.ai-image.select', async ctx => {
    const data = await api(ctx, `/api/erp/products/${state.productId}/images/${candidate.value.id}/select`, { method: 'POST', body: { isSelected: true } })
    must(data?.id === candidate.value.id && data.isSelected === 1, 'IMAGE_SELECTION_MISMATCH')
  }, Boolean(candidate && usable))
  await check('erp.product.READY', async ctx => {
    const data = await api(ctx, `/api/erp/products/${state.productId}`); productScope(data)
    must(data.status === 'READY' && data.images.some(row => row.id === candidate.value.id && row.isSelected === 1), 'PRODUCT_NOT_READY')
  }, Boolean(selected && chosen.ebay))
  await pricingAndExport(usable, Boolean(collected))
  await p5AndReads(usable, Boolean(collected))
  excluded('third-party.actual-dom-collection', 'FIXTURE_JSON_ONLY')
  excluded('p5.automatic-patrol', 'NO_PROVIDER_NOT_TESTED')
  excluded('marketplace.real-publishing', 'DRAFT_EXPORT_ONLY')
  // 即使源 HTTP 独立检查失败，采集/标题/读接口的其他结果仍分别保留，不覆盖原失败项。
  void sourceFetched
}

async function pricingAndExport(usable, hasProduct) {
  const rules = { ebay: { markupRate: 2.2, commissionRate: 0.13, fixedFee: 0.3 }, amazon: { markupRate: 2.5, commissionRate: 0.15, fixedFee: 0 } }
  const edited = {}, listingIds = {}, expected = {}
  for (const [index, platform] of ['ebay', 'amazon'].entries()) {
    const rule = rules[platform]
    expected[platform] = Math.round((12 * rule.markupRate / (1 - rule.commissionRate) + rule.fixedFee + Number.EPSILON) * 100) / 100
    const configured = await check(`erp.pricing.rule.${platform}`, async ctx => {
      const data = await api(ctx, '/api/erp/pricing-rules', { method: 'POST', body: { platformCode: platform, category: '', currency: 'USD', ...rule } })
      must(data?.orgId === state.orgId && data.platformCode === platform && data.currency === 'USD' && data.category === '' && Object.entries(rule).every(([key, value]) => data[key] === value), 'PRICING_RULE_MISMATCH')
    }, usable)
    const listing = await check(`erp.listing.generate.${platform}`, async ctx => {
      const data = await api(ctx, `/api/erp/products/${state.productId}/listings`, { method: 'POST', body: { platforms: [platform] } })
      must(data?.productId === state.productId && Array.isArray(data.listings))
      const row = data.listings.find(item => item.platformCode === platform)
      must(row?.productId === state.productId && row.orgId === state.orgId && row.price === expected[platform] && row.priceManual === 0, 'REFERENCE_PRICE_MISMATCH')
      listingIds[platform] = row.id
      return row
    }, Boolean(hasProduct && configured))
    await check(`erp.pricing.recalculate.${platform}`, async ctx => {
      const data = await api(ctx, `/api/erp/listings/${listingIds[platform]}/price-recalc`, { method: 'POST', body: { force: false } })
      must(data?.listingId === listingIds[platform] && data.platformCode === platform && data.protected === false && data.price === expected[platform] && data.breakdown?.exchangeRate === 1 && data.breakdown.price === expected[platform], 'RECALCULATED_PRICE_MISMATCH')
    }, Boolean(listing))
    const manual = { title: `ERP Deployment Fixture Blue Cup ${platform === 'ebay' ? 'eBay' : 'Amazon'}`, price: index === 0 ? 47.21 : 59.34, category: `ERP Fixture ${platform}`, description: 'ERP部署验收手改保护测试，不得实际发布或履约。' }
    edited[platform] = await check(`erp.listing.manual-edit.${platform}`, async ctx => {
      const data = await api(ctx, `/api/erp/listings/${listingIds[platform]}`, { method: 'PUT', body: manual })
      must(data?.id === listingIds[platform] && data.priceManual === 1 && Object.entries(manual).every(([key, value]) => data[key] === value), 'MANUAL_EDIT_MISMATCH')
      return manual
    }, Boolean(listing))
    await check(`erp.pricing.manual-protection.${platform}`, async ctx => {
      const data = await api(ctx, `/api/erp/listings/${listingIds[platform]}/price-recalc`, { method: 'POST', body: { force: false } })
      must(data?.listingId === listingIds[platform] && data.protected === true && data.price === manual.price && data.breakdown?.price === expected[platform], 'MANUAL_PRICE_OVERWRITTEN')
    }, Boolean(edited[platform]))
    await check(`erp.listing.regenerate-protection.${platform}`, async ctx => {
      const data = await api(ctx, `/api/erp/products/${state.productId}/listings`, { method: 'POST', body: { platforms: [platform] } })
      const row = data?.listings?.find(item => item.id === listingIds[platform])
      must(row?.priceManual === 1 && Object.entries(manual).every(([key, value]) => row[key] === value), 'MANUAL_FIELDS_OVERWRITTEN')
    }, Boolean(edited[platform]))
  }
  await check('erp.listings.independent-persisted-versions', async ctx => {
    const data = await api(ctx, `/api/erp/products/${state.productId}/listings`)
    must(Array.isArray(data) && data.length === 2 && new Set(data.map(row => row.id)).size === 2)
    for (const platform of ['ebay', 'amazon']) {
      const row = data.find(item => item.platformCode === platform)
      must(row?.id === listingIds[platform] && row.orgId === state.orgId && row.productId === state.productId && row.priceManual === 1 && Object.entries(edited[platform].value).every(([key, value]) => row[key] === value), 'PLATFORM_VERSION_NOT_INDEPENDENT')
    }
  }, Boolean(edited.ebay && edited.amazon))
  const exported = await check('erp.export.json.read', async ctx => {
    const data = await api(ctx, `/api/erp/products/${state.productId}/export`)
    must(data?.productId === state.productId && data.product?.currency === 'USD' && Array.isArray(data.images) && Array.isArray(data.listings) && typeof data.completeness?.complete === 'boolean')
    must(JSON.parse(JSON.stringify(data)).productId === state.productId)
    ctx.details = { imageCount: data.images.length, listingCount: data.listings.length }
    return data
  }, usable && hasProduct)
  await check('erp.export.materials-complete', async ctx => {
    ctx.statusCode = exported.statusCode
    const data = exported.value, c = data.completeness
    must(c.complete === true && c.hasSelectedImage === true && c.allHaveTitle === true && c.allHavePrice === true && c.noExternalRefs === true, 'EXPORT_INCOMPLETE')
    must(c.imageCount === 2 && data.images.length === 2 && c.platforms.length === 2 && ['ebay', 'amazon'].every(p => c.platforms.includes(p)), 'EXPORT_COUNTS_MISMATCH')
    must(data.images.every(image => ownImageKey(image.localPath, state.productId, image.id) && !Object.hasOwn(image, 'sourceUrl')), 'EXPORT_EXTERNAL_IMAGE_REFERENCE')
    must(data.images.some(image => image.imageType === 'AI' && image.isSelected === 1), 'EXPORT_AI_SELECTION_MISSING')
    for (const platform of ['ebay', 'amazon']) {
      const row = data.listings.find(item => item.platformCode === platform)
      must(edited[platform] && row?.id === listingIds[platform] && row.breakdown?.price === expected[platform] && Object.entries(edited[platform].value).every(([key, value]) => row[key] === value), 'EXPORT_LISTING_MISMATCH')
    }
  }, Boolean(exported))
}

async function p5AndReads(usable, hasProduct) {
  await check('erp.products.read', async ctx => {
    const data = await api(ctx, '/api/erp/products?page=1&pageSize=100')
    must(validPage(data) && data.items.every(row => row.orgId === state.orgId && row.supplierId === state.supplierId && row.sourceProductId === state.sourceProductId), 'PRODUCT_LIST_SCOPE_MISMATCH')
    if (hasProduct) must(data.total === 1 && data.items[0]?.id === state.productId)
    ctx.details = { count: data.total }
  }, usable)
  await check('erp.download-jobs.read', async ctx => {
    const data = await api(ctx, '/api/erp/download-jobs?pageSize=100')
    must(Array.isArray(data) && data.every(row => row.productId === state.productId), 'DOWNLOAD_LIST_SCOPE_MISMATCH')
    ctx.details = { count: data.length }
  }, usable)
  await check('erp.platform-rules.read', async ctx => {
    const data = await api(ctx, '/api/erp/platform-rules')
    must(Array.isArray(data) && data.every(row => row.orgId === state.orgId && ['ebay', 'amazon'].includes(row.platformCode)))
    ctx.details = { count: data.length }
  }, usable)
  await check('erp.pricing-rules.read', async ctx => {
    const data = await api(ctx, '/api/erp/pricing-rules')
    must(Array.isArray(data) && data.every(row => row.orgId === state.orgId && ['ebay', 'amazon'].includes(row.platformCode) && row.category === ''))
    ctx.details = { count: data.length }
  }, usable)
  await check('p5.changes.real-list', async ctx => {
    const data = await api(ctx, '/api/erp/changes?page=1&pageSize=100')
    must(validPage(data) && data.total === 0 && data.items.length === 0, 'UNEXPECTED_FIXTURE_CHANGES')
    ctx.details = { count: 0, emptyListOnly: true }
  }, usable)
  const notifications = async ctx => {
    const data = await api(ctx, '/api/erp/notifications?page=1&pageSize=100')
    must(validPage(data) && Number.isInteger(data.unread) && data.unread >= 0 && data.unread <= data.total)
    must(data.items.every(row => row.kind === 'MORNING_SUMMARY' && row.productId === null), 'UNEXPECTED_FIXTURE_NOTIFICATION')
    ctx.details = { count: data.total, unread: data.unread }
    return data
  }
  await check('p5.notifications.real-list', notifications, usable)
  const summary = await check('p5.summary.real-api', async ctx => {
    const data = await api(ctx, '/api/erp/notifications/summary', { method: 'POST', body: {} })
    must(data?.orgId === state.orgId && typeof data.notificationId === 'string' && data.totalChanges === 0 && data.urgentChanges === 0 && data.pendingProducts === 0 && Object.keys(data.byField ?? {}).length === 0, 'SUMMARY_COUNTERS_MISMATCH')
    ctx.details = { totalChanges: 0, urgentChanges: 0, pendingProducts: 0, automaticPatrolVerified: false }
    return data
  }, usable)
  await check('p5.summary.persisted-in-notifications', async ctx => {
    const data = await notifications(ctx)
    const row = data.items.find(item => item.id === summary.value.notificationId)
    must(row?.kind === 'MORNING_SUMMARY' && row.body?.totalChanges === 0 && row.body?.pendingProducts === 0, 'SUMMARY_NOTIFICATION_NOT_PERSISTED')
  }, Boolean(summary))
}

async function cleanupInventory(db) {
  await assertFixtureOwner(db)
  const suppliers = await db.erpSupplier.findMany({ where: { orgId: state.orgId }, include: { products: { select: { id: true, orgId: true } } } })
  must(suppliers.every(row => row.id === state.supplierId && row.code === state.supplierCode && row.crawlRules?.fixture === true && row.crawlRules?.runId === state.runId && row.products.every(p => p.orgId === state.orgId)), 'CLEANUP_SUPPLIER_SCOPE_MISMATCH')
  const products = await db.erpProduct.findMany({ where: { orgId: state.orgId }, include: { images: true, listings: true, crawlLogs: true, downloadJobs: true } })
  must(products.length <= 1 && products.every(row => row.supplierId === state.supplierId && row.sourceProductId === state.sourceProductId && row.collectedBy === state.email && row.crawlConfig?.fixture === true && row.crawlConfig?.runId === state.runId), 'CLEANUP_PRODUCT_SCOPE_MISMATCH')
  for (const product of products) {
    must([...(product.images ?? []), ...product.listings, ...product.crawlLogs, ...product.downloadJobs].every(row => row.orgId === state.orgId && row.productId === product.id), 'CLEANUP_CHILD_SCOPE_MISMATCH')
    must(product.downloadJobs.every(job => ['DONE', 'PARTIAL', 'FAILED'].includes(job.status)), 'CLEANUP_DOWNLOAD_STILL_RUNNING')
    must(!state.productId || product.id === state.productId, 'CLEANUP_PRODUCT_ID_MISMATCH')
  }
  const pricing = await db.erpPricingRule.findMany({ where: { orgId: state.orgId } })
  const platform = await db.erpPlatformRule.findMany({ where: { orgId: state.orgId } })
  const notifications = await db.erpNotification.findMany({ where: { orgId: state.orgId } })
  must(pricing.every(row => ['ebay', 'amazon'].includes(row.platformCode) && row.category === '') && platform.every(row => ['ebay', 'amazon'].includes(row.platformCode)), 'CLEANUP_RULE_SCOPE_MISMATCH')
  must(notifications.every(row => row.kind === 'MORNING_SUMMARY' && row.productId === null && (row.userId === null || row.userId === state.userId) && row.createdAt >= state.startedAt), 'CLEANUP_NOTIFICATION_SCOPE_MISMATCH')
  const uploads = await db.auditLog.findMany({ where: { orgId: state.orgId, userId: state.userId, action: { in: ['media.upload', 'media.sign-upload'] }, targetType: 'media', createdAt: { gte: new Date(state.startedAt) } }, select: { targetId: true } })
  const keys = new Set([...state.mediaKeys, ...uploads.map(row => row.targetId)])
  must([...keys].every(ownUploadKey), 'CLEANUP_UPLOAD_KEY_SCOPE_MISMATCH')
  for (const product of products) for (const image of product.images) {
    if (image.localPath) must(ownImageKey(image.localPath, product.id, image.id), 'CLEANUP_IMAGE_KEY_SCOPE_MISMATCH')
    // 同一 fixture 图片 ID 的确定性 key；兼顾对象写成功而 DB 回填失败的孤立文件。
    for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif']) keys.add(`org-${state.orgId}/erp/${product.id}/${image.id}.${ext}`)
  }
  return { suppliers, products, pricing, platform, notifications, keys: [...keys] }
}
async function cleanupFlow() {
  const loaded = await check('cleanup.load-and-confirm-scope', async () => {
    await openPrivateFile(false)
    const raw = JSON.parse(await authHandle.readFile({ encoding: 'utf8' }))
    must(raw?.version === VERSION && raw.marker === MARKER && /^[a-f0-9]{32}$/.test(raw.runId), 'INVALID_FIXTURE_MANIFEST')
    must(raw.orgId === `erp-deploy-${raw.runId}` && raw.orgName === `${MARKER} ${raw.runId}` && raw.supplierId === `erp-supplier-${raw.runId}` && raw.supplierCode === `ERP_DEPLOY_${raw.runId}` && raw.sourceProductId === `erp-fixture-${raw.runId}` && raw.mediaPrefix === `erp-${raw.runId}`, 'INVALID_FIXTURE_MANIFEST_SCOPE')
    must(process.env.ERP_CLEANUP_ORG_ID === raw.orgId, 'CLEANUP_ORG_CONFIRMATION_REQUIRED')
    must(/^1\d{10}$/.test(raw.email) && typeof raw.password === 'string' && raw.accountName === `${MARKER}-${raw.runId.slice(0, 8)}` && Array.isArray(raw.mediaKeys) && Number.isFinite(Date.parse(raw.startedAt)), 'INVALID_FIXTURE_AUTH')
    must(raw.productId === null || /^c[a-z0-9]{20,40}$/.test(raw.productId || ''), 'INVALID_FIXTURE_PRODUCT_ID')
    if (!raw.finishedAt || raw.inFlight || raw.uncertainWrites) {
      must(process.env.ERP_CLEANUP_CONFIRM_IDLE === '1', 'CLEANUP_UNCERTAIN_WRITES_REQUIRE_IDLE_CONFIRMATION')
      must(Date.now() - Date.parse(raw.startedAt) >= 900000 && Date.now() > (raw.uncertainUntil || 0) && (!raw.inFlight || Date.now() > raw.inFlight.deadline), 'CLEANUP_QUIET_WINDOW_REQUIRED')
    }
    if (Number.isInteger(raw.runnerPid) && raw.runnerPid !== process.pid) {
      let running = false
      try { process.kill(raw.runnerPid, 0); running = true } catch (error) { must(error?.code === 'ESRCH', 'CLEANUP_PROCESS_STATUS_UNKNOWN') }
      must(!running, 'CLEANUP_VERIFY_PROCESS_STILL_RUNNING')
    }
    state = raw
    report.isolation.orgId = state.orgId; report.isolation.runId = state.runId
    must(state.userId && state.approved, 'CLEANUP_NO_APPROVED_FIXTURE_KEEP_ACCOUNT')
    await assertFixtureOwner(prisma)
  }, Boolean(prisma))
  const loggedIn = await check('cleanup.auth.real-login', login, Boolean(loaded))
  const identity = await check('cleanup.auth.me', verifyIdentity, Boolean(loggedIn))
  const inventory = await check('cleanup.inventory.strict-scope', () => cleanupInventory(prisma), Boolean(identity))
  let removed = Boolean(inventory)
  if (inventory) for (const [index, key] of inventory.value.keys.entries()) {
    const result = await check(`cleanup.media.object-${index + 1}`, async ctx => {
      const data = await api(ctx, `/api/media/objects?${new URLSearchParams({ key })}`, { method: 'DELETE' })
      must(data?.ok === true && data.key === key, 'MEDIA_DELETE_NOT_CONFIRMED')
    })
    if (!result) removed = false
  }
  const cleaned = await check('cleanup.erp.exact-fixture-records', async ctx => {
    const counts = await prisma.$transaction(async tx => {
      const current = await cleanupInventory(tx)
      must(current.keys.every(key => inventory.value.keys.includes(key)), 'CLEANUP_CONCURRENT_MEDIA_CHANGE')
      const productIds = current.products.map(row => row.id)
      const deletedProducts = await tx.erpProduct.deleteMany({ where: { orgId: state.orgId, id: { in: productIds }, supplierId: state.supplierId, sourceProductId: state.sourceProductId, collectedBy: state.email } })
      // 子表由已逐行核对的产品级外键级联；从不删除 Organization，避免触及其他业务域。
      const deletedSuppliers = await tx.erpSupplier.deleteMany({ where: { orgId: state.orgId, id: state.supplierId, code: state.supplierCode, products: { none: {} } } })
      const deletedPricing = await tx.erpPricingRule.deleteMany({ where: { orgId: state.orgId, id: { in: current.pricing.map(row => row.id) }, platformCode: { in: ['ebay', 'amazon'] }, category: '' } })
      const deletedPlatform = await tx.erpPlatformRule.deleteMany({ where: { orgId: state.orgId, id: { in: current.platform.map(row => row.id) }, platformCode: { in: ['ebay', 'amazon'] } } })
      const deletedNotifications = await tx.erpNotification.deleteMany({ where: { orgId: state.orgId, id: { in: current.notifications.map(row => row.id) }, kind: 'MORNING_SUMMARY', productId: null } })
      return { products: deletedProducts.count, suppliers: deletedSuppliers.count, pricingRules: deletedPricing.count, platformRules: deletedPlatform.count, notifications: deletedNotifications.count }
    }, { isolationLevel: 'Serializable', timeout: 30000 })
    state.cleanedAt = new Date().toISOString(); await saveState()
    ctx.details = { ...counts, mediaDeleteRequests: inventory.value.keys.length, accountRetained: true, organizationRetained: true, auditRetained: true }
  }, removed)
  const readback = await check('cleanup.readback-and-account-retained', async ctx => {
    await assertFixtureOwner(prisma)
    const data = await api(ctx, '/api/erp/products?page=1&pageSize=100')
    must(validPage(data) && data.total === 0, 'CLEANUP_PRODUCTS_REMAIN')
    const remaining = await Promise.all([
      prisma.erpSupplier.count({ where: { orgId: state.orgId } }),
      prisma.erpProductImage.count({ where: { orgId: state.orgId } }),
      prisma.erpListing.count({ where: { orgId: state.orgId } }),
      prisma.erpCrawlLog.count({ where: { orgId: state.orgId } }),
      prisma.erpDownloadJob.count({ where: { orgId: state.orgId } }),
      prisma.erpPricingRule.count({ where: { orgId: state.orgId } }),
      prisma.erpPlatformRule.count({ where: { orgId: state.orgId } }),
      prisma.erpNotification.count({ where: { orgId: state.orgId } })
    ])
    must(remaining.every(count => count === 0), 'CLEANUP_ERP_RECORDS_REMAIN')
  }, Boolean(cleaned))
  const retired = await check('cleanup.retire-exact-fixture-account', async ctx => {
    ctx.details = await prisma.$transaction(async tx => {
      await assertFixtureOwner(tx)
      const changed = await tx.user.updateMany({
        where: { id: state.userId, orgId: state.orgId, email: state.email, name: state.accountName, status: 'ACTIVE', isOwner: true, createdAt: { gte: new Date(state.startedAt) } },
        data: { status: 'DISABLED' }
      })
      must(changed.count === 1, 'RETIRE_EXACT_ACCOUNT_MISMATCH')
      const revoked = await tx.authToken.updateMany({ where: { userId: state.userId, revokedAt: null }, data: { revokedAt: new Date() } })
      await tx.auditLog.create({ data: {
        orgId: state.orgId, userId: null, action: 'erp.deployment.fixture.retired', targetType: 'user', targetId: state.userId,
        detail: { actor: 'SSH部署验收运维脚本', reason: '部署验收完成，停用隔离测试账号', runId: state.runId, revokedRefreshTokens: revoked.count }
      } })
      return { disabled: true, revokedRefreshTokens: revoked.count, accountRetained: true, auditRetained: true }
    }, { isolationLevel: 'Serializable' })
    state.retiredAt = new Date().toISOString()
    await saveState()
  }, Boolean(readback))
  await check('cleanup.disabled-token-rejected-and-secrets-cleared', async ctx => {
    const user = await prisma.user.findUnique({ where: { id: state.userId }, select: { status: true, orgId: true } })
    must(user?.status === 'DISABLED' && user.orgId === state.orgId && await prisma.authToken.count({ where: { userId: state.userId, revokedAt: null } }) === 0, 'RETIRE_READBACK_FAILED')
    const response = await fetch(`${BASE}/api/erp/products`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10000) })
    ctx.statusCode = response.status
    const body = await response.json()
    must(response.status === 401 && body.error === 'ACCOUNT_DISABLED', 'RETIRED_ACCESS_TOKEN_STILL_USABLE')
    state.password = ''; state.accessToken = null; state.profile = null
    await saveState()
    ctx.details = { oldAccessTokenRejected: true, privateCredentialsCleared: true }
  }, Boolean(retired))
}

async function finish() {
  if (closing) return
  closing = true
  if (state && authHandle) await check('fixture.persist-private-auth', async ctx => {
    if (mode === 'verify') state.finishedAt = new Date().toISOString()
    await saveState()
    ctx.details = { mode: '0600', credentialsPrinted: false }
  })
  if (prisma) await check('runtime.database.disconnect', () => prisma.$disconnect())
  if (authHandle) await check('runtime.auth-file.close', () => authHandle.close())
  report.finishedAt = new Date().toISOString()
  report.isolation.scope = state ? {
    fixtureOrgOnly: true, supplierId: state.supplierId, productId: state.productId,
    registrationConfirmed: state.registered, isolatedAccountApproved: state.approved,
    erpDataRetained: !state.cleanedAt, accountRetained: true, organizationRetained: true,
    auditRetained: true, originalRegistrationAuditRetained: true, privateAuthRetained: Boolean(state.password),
    accountDisabled: Boolean(state.retiredAt),
    cleanupRequiresExplicitOrgConfirmation: true, uncertainWrites: Boolean(state.uncertainWrites || state.inFlight)
  } : { fixtureCreatedByThisRun: false }
  const counts = Object.fromEntries(['PASS', 'FAIL', 'SKIP', 'NOT_VERIFIED'].map(status => [status, report.checks.filter(row => row.status === status).length]))
  report.summary = counts
  report.outcome = counts.FAIL || counts.SKIP ? 'INCOMPLETE_OR_FAILED' : mode === 'cleanup' ? 'FIXTURE_CLEANED_ACCOUNT_DISABLED' : 'CHECKS_PASSED_WITH_EXCLUSIONS'
  process.exitCode = counts.FAIL || counts.SKIP ? 1 : 0
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
}

try {
  const runtime = await check('runtime.dependencies', async () => {
    must(['verify', 'cleanup'].includes(mode), 'INVALID_MODE')
    must(Number(process.versions.node.split('.')[0]) >= 20, 'NODE_20_REQUIRED')
    const { PrismaClient } = await import('@prisma/client')
    prisma = new PrismaClient({ log: [] })
    await prisma.$connect()
  })
  if (runtime) {
    if (mode === 'cleanup') await cleanupFlow()
    else await verifyFlow()
  }
} catch (error) {
  report.checks.push({ name: 'runtime.unexpected', status: 'FAIL', statusCode: null, errorCode: errorCode(error) })
  progress('runtime.unexpected', 'FAIL')
} finally {
  await finish()
}

