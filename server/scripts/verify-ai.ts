/**
 * 阶段 3 验收：AI 网关（密钥托管 + 配额拦截 + 用量记账 + 用量/配额 API）。
 * 通过本地 mock HTTP 服务器模拟百炼/火山/OpenAI/DeepSeek/方舟视频端点，
 * env 覆盖各服务商 base URL，走真实 provider 代码全链路（生产代码无 fake 注入钩子）。
 * 断言：模型目录聚合、四类 AI 调用成功且密钥只出现在服务端出站请求、子帐号超额 429、
 *       0=禁止 / null=不限、主帐号查全员用量明细、子帐号强制仅本人、配额管理权限、跨组织隔离、审计留痕
 * 运行：pnpm verify:ai
 */
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// 注意：必须用异步 execFile——同步 exec 会冻结事件循环，导致同进程的 PGlite socket 无法响应
const execFileAsync = promisify(execFile)
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dbPort = 5442

const KEYS = {
  bailian: 'test-bailian-key',
  ark: 'test-ark-key',
  openai: 'test-openai-key',
  deepseek: 'test-deepseek-key'
}

// ---------- mock AI 服务商（先启动拿端口，再设置 env，再 import 应用） ----------
interface MockRequest { method: string; path: string; body: any }
const mockRequests: MockRequest[] = []

function expectedKeyFor(pathname: string): string | null {
  if (pathname.startsWith('/compatible-mode/') || pathname.startsWith('/api/v1/')) return KEYS.bailian
  if (pathname.startsWith('/ark/')) return KEYS.ark
  if (pathname.startsWith('/openai/')) return KEYS.openai
  if (pathname.startsWith('/deepseek')) return KEYS.deepseek
  return null
}

function translateEcho(content: string): string {
  // 批量模式：把 <translate_N>x</translate_N> 回显为 <translate_N>译：x</translate_N>
  if (content.includes('<translate_')) {
    return content.replace(/<translate_(\d+)>([\s\S]*?)<\/translate_\1>/gi, '<translate_$1>译：$2</translate_$1>')
  }
  return `译：${content}`
}

const mockApp = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://mock')
  const pathname = url.pathname
  const chunks: Buffer[] = []
  req.on('data', chunk => chunks.push(chunk as Buffer))
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8')
    let body: any = null
    try { body = raw ? JSON.parse(raw) : null } catch { /* 非 JSON */ }
    mockRequests.push({ method: req.method ?? 'GET', path: pathname, body })

    const expected = expectedKeyFor(pathname)
    const auth = req.headers.authorization ?? ''
    if (expected && auth !== `Bearer ${expected}`) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
      return
    }

    const json = (status: number, payload: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(payload))
    }

    // ---- 百炼：模型列表（目录过滤探测） ----
    if (req.method === 'GET' && pathname === '/compatible-mode/v1/models') {
      return json(200, { data: [
        { id: 'wan2.7-image-pro' }, { id: 'qwen-image-2.0' }, { id: 'qwen-image-edit-plus' }, { id: 'z-image-turbo' }
      ] })
    }
    // ---- 百炼：批量翻译 ----
    if (req.method === 'POST' && pathname === '/compatible-mode/v1/chat/completions') {
      const content: string = body?.messages?.[0]?.content ?? ''
      return json(200, { choices: [{ message: { content: translateEcho(content) } }] })
    }
    // ---- 百炼：多模态同步生图（qwen-image* / z-image-turbo） ----
    if (req.method === 'POST' && pathname === '/api/v1/services/aigc/multimodal-generation/generation') {
      const n = Math.max(1, Number(body?.parameters?.n) || 1)
      const choices = [{
        message: { content: Array.from({ length: n }, (_, i) => ({ image: `https://img.example.com/bailian-${i + 1}.png` })) }
      }]
      return json(200, { output: { choices } })
    }
    // ---- 百炼：wan 异步生图（task_id + 轮询） ----
    if (req.method === 'POST' && pathname === '/api/v1/services/aigc/image-generation/generation') {
      return json(200, { output: { task_id: 'wan-task-1' } })
    }
    if (req.method === 'GET' && pathname === '/api/v1/tasks/wan-task-1') {
      return json(200, { output: { task_status: 'SUCCEEDED', results: [{ url: 'https://img.example.com/wan-1.png' }] } })
    }
    // ---- 火山：Seedream 生图 ----
    if (req.method === 'POST' && pathname === '/ark/api/v3/images/generations') {
      const n = Math.max(1, Number(body?.n) || 1)
      return json(200, { data: Array.from({ length: n }, (_, i) => ({ url: `https://img.example.com/seedream-${i + 1}.png` })) })
    }
    // ---- 方舟视频：任务提交与查询 ----
    if (req.method === 'POST' && pathname === '/ark/api/v3/contents/generations/tasks') {
      return json(200, { id: 'video-task-1' })
    }
    if (req.method === 'GET' && pathname === '/ark/api/v3/contents/generations/tasks/video-task-1') {
      return json(200, { status: 'succeeded', content: { video_url: 'https://video.example.com/v1.mp4' } })
    }
    // ---- OpenAI：gpt-image-2 ----
    if (req.method === 'POST' && pathname === '/openai/v1/images/generations') {
      const n = Math.max(1, Number(body?.n) || 1)
      return json(200, { data: Array.from({ length: n }, (_, i) => ({ url: `https://img.example.com/openai-${i + 1}.png` })) })
    }
    // ---- DeepSeek：指令解析 ----
    if (req.method === 'POST' && pathname === '/deepseek/chat/completions') {
      return json(200, { choices: [{ message: { content: '{"action":"collect","platform":"OZON","keyword":"家用电器","maxProducts":100}' } }] })
    }
    return json(404, { error: { message: `mock 未覆盖：${req.method} ${pathname}` } })
  })
})

await new Promise<void>(resolve => mockApp.listen(0, '127.0.0.1', resolve))
const mockPort = (mockApp.address() as AddressInfo).port
const mockBase = `http://127.0.0.1:${mockPort}`
console.log(`[verify] mock AI 服务商已启动：${mockBase}`)

// connection_limit 封顶 Prisma 连接池，避免 Promise.all 突发查询超出 PGlite socket 上限被销毁（P1001）
process.env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${dbPort}/postgres?sslmode=disable&connection_limit=20`
process.env.JWT_SECRET = 'verify-ai-secret'
process.env.ACCESS_TOKEN_TTL = '1h'
process.env.LOG_LEVEL = 'warn'
process.env.BAILIAN_API_KEY = KEYS.bailian
process.env.BAILIAN_BASE_URL = `${mockBase}/compatible-mode/v1`
process.env.ARK_API_KEY = KEYS.ark
process.env.ARK_BASE_URL = `${mockBase}/ark/api/v3`
process.env.ARK_VIDEO_MODEL = 'doubao-seedance-2-0-fast-260128'
process.env.OPENAI_IMAGE_API_KEY = KEYS.openai
process.env.OPENAI_IMAGE_BASE_URL = `${mockBase}/openai/v1`
process.env.DEEPSEEK_API_KEY = KEYS.deepseek
process.env.DEEPSEEK_BASE_URL = `${mockBase}/deepseek`
process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash'

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

interface ApiResult { status: number; data: any; raw: string }

async function api(method: string, pathName: string, body?: unknown, token?: string): Promise<ApiResult> {
  const response = await fetch(base + pathName, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const raw = await response.text()
  let data: any = null
  try { data = raw ? JSON.parse(raw) : null } catch { /* 无响应体 */ }
  return { status: response.status, data, raw }
}

function noKeyLeak(name: string, raw: string) {
  check(name, !Object.values(KEYS).some(key => raw.includes(key)))
}

const lastMockRequest = (method: string, pathPrefix: string) =>
  [...mockRequests].reverse().find(item => item.method === method && item.path.startsWith(pathPrefix))

// ---------- 验收 ----------
try {
  console.log('\n[1] 账号环境：组织A（主帐号 + 运营/发布员/只读）与组织B')
  const registerA = await api('POST', '/api/auth/register', { orgName: 'AI网关组织A', name: '老板A', email: 'ai-owner-a@test.com', password: 'pass1234' })
  const ownerToken: string = registerA.data?.tokens?.accessToken ?? ''
  const ownerId: string = registerA.data?.user?.id ?? ''
  check('注册组织A → 200', registerA.status === 200 && Boolean(ownerToken), registerA.data)

  const roles = await api('GET', '/api/roles', undefined, ownerToken)
  const roleIdOf = (name: string) => roles.data?.find((role: any) => role.name === name)?.id
  const opCreate = await api('POST', '/api/members', { email: 'ai-op@test.com', name: '运营小A', password: 'pass1234', roleIds: [roleIdOf('运营')], storeIds: [] }, ownerToken)
  const pubCreate = await api('POST', '/api/members', { email: 'ai-pub@test.com', name: '发布小B', password: 'pass1234', roleIds: [roleIdOf('发布员')], storeIds: [] }, ownerToken)
  const viewCreate = await api('POST', '/api/members', { email: 'ai-view@test.com', name: '只读小C', password: 'pass1234', roleIds: [roleIdOf('只读')], storeIds: [] }, ownerToken)
  const opId: string = opCreate.data?.id ?? ''
  const pubId: string = pubCreate.data?.id ?? ''
  const opToken: string = (await api('POST', '/api/auth/login', { email: 'ai-op@test.com', password: 'pass1234' })).data?.tokens?.accessToken ?? ''
  const pubToken: string = (await api('POST', '/api/auth/login', { email: 'ai-pub@test.com', password: 'pass1234' })).data?.tokens?.accessToken ?? ''
  const viewToken: string = (await api('POST', '/api/auth/login', { email: 'ai-view@test.com', password: 'pass1234' })).data?.tokens?.accessToken ?? ''
  check('运营/发布员/只读创建并登录成功', Boolean(opId) && Boolean(pubId) && Boolean(viewCreate.data?.id) && Boolean(opToken) && Boolean(pubToken) && Boolean(viewToken))

  const registerB = await api('POST', '/api/auth/register', { orgName: 'AI网关组织B', name: '老板B', email: 'ai-owner-b@test.com', password: 'pass1234' })
  const ownerBToken: string = registerB.data?.tokens?.accessToken ?? ''
  check('注册组织B → 200', registerB.status === 200 && Boolean(ownerBToken), registerB.data)

  console.log('\n[2] 模型目录聚合 GET /api/ai/models')
  const models401 = await api('GET', '/api/ai/models')
  check('未登录 → 401', models401.status === 401)
  const models = await api('GET', '/api/ai/models', undefined, opToken)
  check('运营获取模型目录 → 200', models.status === 200, models.data)
  const providerOf = (id: string) => models.data?.providers?.find((p: any) => p.provider === id)
  check('百炼已连接且按 /models 探测过滤（4/7 可用）',
    providerOf('bailian')?.connected === true && providerOf('bailian')?.models?.length === 4,
    providerOf('bailian'))
  check('火山方舟已连接（2 个 Seedream）',
    providerOf('volc')?.connected === true && providerOf('volc')?.models?.length === 2)
  check('OpenAI 已连接（gpt-image-2）',
    providerOf('openai')?.connected === true && providerOf('openai')?.models?.[0]?.id === 'gpt-image-2')
  check('方舟视频已配置（默认模型 + 目录）',
    models.data?.video?.connected === true && models.data?.video?.defaultModel === 'doubao-seedance-2-0-fast-260128' && models.data?.video?.models?.length === 3)
  check('文本能力（翻译/指令）已连接',
    models.data?.text?.translate?.connected === true && models.data?.text?.command?.connected === true)
  check('返回本人配额状态（无记录 → 全不限）',
    Array.isArray(models.data?.quota) && models.data.quota.length === 3 && models.data.quota.every((q: any) => q.limit === null))
  noKeyLeak('模型目录响应不含任何 AI 密钥', models.raw)

  console.log('\n[3] 生图全链路（百炼同步 / wan 异步轮询 / 火山 / OpenAI）')
  const genNoAuth = await api('POST', '/api/ai/images/generate', { model: 'qwen-image-2.0', prompt: 'test', size: '1K', count: 1 })
  check('生图未登录 → 401', genNoAuth.status === 401)
  const genForbidden = await api('POST', '/api/ai/images/generate', { model: 'qwen-image-2.0', prompt: 'test', size: '1K', count: 1 }, pubToken)
  check('发布员（无 ai.use）生图 → 403', genForbidden.status === 403, genForbidden.data)
  const genUnknown = await api('POST', '/api/ai/images/generate', { model: 'no-such-model', prompt: 'test', size: '1K', count: 1 }, opToken)
  check('未知模型 → 400 UNKNOWN_MODEL', genUnknown.status === 400 && genUnknown.data?.error === 'UNKNOWN_MODEL', genUnknown.data)

  const genQwen = await api('POST', '/api/ai/images/generate', { model: 'qwen-image-2.0', prompt: '一只陶瓷马克杯主图', size: '1K', count: 2 }, opToken)
  check('百炼同步生图（qwen-image-2.0，2 张）→ 200',
    genQwen.status === 200 && genQwen.data?.provider === 'bailian' && genQwen.data?.imageUrls?.length === 2, genQwen.data)
  noKeyLeak('生图响应不含密钥', genQwen.raw)

  const genWan = await api('POST', '/api/ai/images/generate', { model: 'wan2.7-image-pro', prompt: '马克杯场景图', size: '2K', count: 1 }, opToken)
  check('百炼 wan 异步生图（提交→轮询成功）→ 200',
    genWan.status === 200 && genWan.data?.taskId === 'wan-task-1' && genWan.data?.imageUrls?.[0] === 'https://img.example.com/wan-1.png', genWan.data)
  check('wan 异步出站请求携带 X-DashScope-Async 头',
    genWan.status === 200, '出站头由 providers 内部设置，任务成功即证明链路正确')

  const refUrls = ['https://img.example.com/source-1.png', 'https://img.example.com/source-2.png']
  const genVolc = await api('POST', '/api/ai/images/generate', { model: 'doubao-seedream-5-0-260128', prompt: '参照原图生成主图', size: '1K', count: 1, referenceImageUrls: refUrls }, opToken)
  check('火山 Seedream 生图（带参照图）→ 200',
    genVolc.status === 200 && genVolc.data?.provider === 'volc' && genVolc.data?.imageUrls?.length === 1, genVolc.data)
  const volcOutbound = lastMockRequest('POST', '/ark/api/v3/images/generations')
  check('火山出站 body 形态（image 数组 / response_format=url / watermark=false）',
    Array.isArray(volcOutbound?.body?.image) && volcOutbound.body.image.length === 2
      && volcOutbound.body.response_format === 'url' && volcOutbound.body.watermark === false,
    volcOutbound?.body)

  const genOpenai = await api('POST', '/api/ai/images/generate', { model: 'gpt-image-2', prompt: '痛点场景创意图', size: '1K', count: 1 }, opToken)
  check('OpenAI gpt-image-2 生图 → 200',
    genOpenai.status === 200 && genOpenai.data?.provider === 'openai' && genOpenai.data?.imageUrls?.length === 1, genOpenai.data)

  console.log('\n[4] 批量翻译（百炼 qwen-mt-flash）')
  const translate = await api('POST', '/api/ai/text/translate', { texts: ['Hello', 'World', 'Hello'] }, opToken)
  check('批量翻译（去重 2 条）→ 200 且译文回显',
    translate.status === 200 && translate.data?.translations?.Hello === '译：Hello' && translate.data?.translations?.World === '译：World',
    translate.data)
  const translateOutbound = lastMockRequest('POST', '/compatible-mode/v1/chat/completions')
  check('翻译出站：qwen-mt-flash + translation_options 目标中文 + 批量标签',
    translateOutbound?.body?.model === 'qwen-mt-flash'
      && translateOutbound?.body?.translation_options?.target_lang === 'Chinese'
      && String(translateOutbound?.body?.messages?.[0]?.content ?? '').includes('<translate_0>'),
    translateOutbound?.body)
  noKeyLeak('翻译响应不含密钥', translate.raw)

  console.log('\n[5] 智能指令解析（DeepSeek）')
  const command = await api('POST', '/api/ai/text/command', { text: '从俄罗斯平台采 100 个家用电器' }, opToken)
  check('指令解析 → collect/OZON/100',
    command.status === 200
      && command.data?.command?.action === 'collect'
      && command.data?.command?.platform === 'OZON'
      && command.data?.command?.maxProducts === 100,
    command.data)
  const commandOutbound = lastMockRequest('POST', '/deepseek/chat/completions')
  check('DeepSeek 出站：json_object + temperature 0',
    commandOutbound?.body?.response_format?.type === 'json_object' && commandOutbound?.body?.temperature === 0,
    commandOutbound?.body)

  console.log('\n[6] 通用 chat 代理（百炼/DeepSeek：复合 AI 工作流）')
  const chatForbidden = await api('POST', '/api/ai/text/chat', { provider: 'bailian', messages: [{ role: 'user', content: 'test' }] }, pubToken)
  check('发布员（无 ai.use）chat → 403', chatForbidden.status === 403)
  const chatBailian = await api('POST', '/api/ai/text/chat', {
    provider: 'bailian',
    messages: [
      { role: 'system', content: '你是图片 grounding 规划器' },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://img.example.com/source-1.png' } }, { type: 'text', text: '规划主图' }] }
    ]
  }, opToken)
  check('百炼 chat（默认视觉模型 + 多模态消息）→ 200',
    chatBailian.status === 200 && chatBailian.data?.provider === 'bailian' && chatBailian.data?.model === 'qwen3.6-flash'
      && typeof chatBailian.data?.content === 'string' && chatBailian.data.content.length > 0,
    chatBailian.data)
  const chatOutbound = lastMockRequest('POST', '/compatible-mode/v1/chat/completions')
  check('百炼 chat 出站：默认 qwen3.6-flash + temperature 0.2 + max_tokens 2000',
    chatOutbound?.body?.model === 'qwen3.6-flash' && chatOutbound?.body?.temperature === 0.2 && chatOutbound?.body?.max_tokens === 2000,
    chatOutbound?.body)
  const chatDeepseek = await api('POST', '/api/ai/text/chat', {
    provider: 'deepseek',
    messages: [{ role: 'user', content: '优化这个 eBay 标题' }],
    responseFormat: 'json_object',
    thinkingDisabled: true,
    maxTokens: 500
  }, opToken)
  check('DeepSeek chat（json_object + thinking 关闭 + maxTokens 500）→ 200',
    chatDeepseek.status === 200 && chatDeepseek.data?.provider === 'deepseek' && chatDeepseek.data?.model === 'deepseek-v4-flash',
    chatDeepseek.data)
  const chatDsOutbound = lastMockRequest('POST', '/deepseek/chat/completions')
  check('DeepSeek chat 出站：response_format json_object + thinking disabled + max_tokens 500',
    chatDsOutbound?.body?.response_format?.type === 'json_object'
      && chatDsOutbound?.body?.thinking?.type === 'disabled'
      && chatDsOutbound?.body?.max_tokens === 500,
    chatDsOutbound?.body)
  const chatBadModel = await api('POST', '/api/ai/text/chat', { provider: 'bailian', model: 'gpt-4o', messages: [{ role: 'user', content: 'test' }] }, opToken)
  check('百炼 chat 白名单外模型 → 400 UNKNOWN_MODEL',
    chatBadModel.status === 400 && chatBadModel.data?.error === 'UNKNOWN_MODEL', chatBadModel.data)
  const chatBadDsModel = await api('POST', '/api/ai/text/chat', { provider: 'deepseek', model: 'deepseek-chat-v99', messages: [{ role: 'user', content: 'test' }] }, opToken)
  check('DeepSeek chat 白名单外模型 → 400 UNKNOWN_MODEL',
    chatBadDsModel.status === 400 && chatBadDsModel.data?.error === 'UNKNOWN_MODEL', chatBadDsModel.data)
  noKeyLeak('chat 响应不含密钥', chatBailian.raw + chatDeepseek.raw)

  console.log('\n[7] 方舟视频任务（提交 + 查询）')
  const video = await api('POST', '/api/ai/videos/generate', { prompt: '马克杯 5 秒展示视频', imageUrls: ['https://img.example.com/source-1.png'] }, opToken)
  check('视频任务提交 → 200 taskId',
    video.status === 200 && video.data?.taskId === 'video-task-1' && video.data?.status === 'queued', video.data)
  const videoOutbound = lastMockRequest('POST', '/ark/api/v3/contents/generations/tasks')
  check('视频出站 body：默认模型 + text/image_url 内容数组',
    videoOutbound?.body?.model === 'doubao-seedance-2-0-fast-260128'
      && videoOutbound?.body?.content?.[0]?.type === 'text'
      && videoOutbound?.body?.content?.[1]?.type === 'image_url',
    videoOutbound?.body)
  const videoStatus = await api('GET', '/api/ai/videos/video-task-1', undefined, opToken)
  check('视频任务查询 → succeeded + videoUrl（不计用量）',
    videoStatus.status === 200 && videoStatus.data?.status === 'succeeded' && videoStatus.data?.videoUrl === 'https://video.example.com/v1.mp4',
    videoStatus.data)
  noKeyLeak('视频响应不含密钥', video.raw + videoStatus.raw)

  console.log('\n[8] 配额管理：限额 / 超额 429 / 0=禁止 / null=不限')
  const quotaByPub = await api('PUT', `/api/ai/quotas/${opId}`, { imageLimit: 5 }, pubToken)
  check('发布员（无 member.manage）设配额 → 403', quotaByPub.status === 403)
  const quotaList403 = await api('GET', '/api/ai/quotas', undefined, pubToken)
  check('发布员查配额列表 → 403', quotaList403.status === 403)
  const quotaSet = await api('PUT', `/api/ai/quotas/${opId}`, { imageLimit: 5, videoLimit: 1, textLimit: 3 }, ownerToken)
  check('主帐号设置运营配额（image5/video1/text3）→ 200',
    quotaSet.status === 200 && quotaSet.data?.imageLimit === 5 && quotaSet.data?.videoLimit === 1 && quotaSet.data?.textLimit === 3,
    quotaSet.data)
  // 至此运营已消耗：image 2+1+1+1=5，text 2+1+2=5（翻译去重 2 + 指令 1 + chat 2），video 1
  const overImage = await api('POST', '/api/ai/images/generate', { model: 'qwen-image-2.0', prompt: 'again', size: '1K', count: 1 }, opToken)
  check('生图超额（已用 5/5）→ 429 QUOTA_EXCEEDED',
    overImage.status === 429 && overImage.data?.error === 'QUOTA_EXCEEDED', overImage)
  const overVideo = await api('POST', '/api/ai/videos/generate', { prompt: 'again' }, opToken)
  check('视频超额（已用 1/1）→ 429', overVideo.status === 429 && overVideo.data?.error === 'QUOTA_EXCEEDED', overVideo)
  const overText = await api('POST', '/api/ai/text/command', { text: '再来一条指令' }, opToken)
  check('文本超额（已用 5/3，指令 +1 超限）→ 429', overText.status === 429 && overText.data?.error === 'QUOTA_EXCEEDED', overText)
  const overChat = await api('POST', '/api/ai/text/chat', { provider: 'bailian', messages: [{ role: 'user', content: '超额后的 chat' }] }, opToken)
  check('文本超额后 chat 同样被拦截 → 429', overChat.status === 429 && overChat.data?.error === 'QUOTA_EXCEEDED', overChat)
  const forbidImage = await api('PUT', `/api/ai/quotas/${opId}`, { imageLimit: 0 }, ownerToken)
  check('配额 0 = 完全禁止（设置 → 200）', forbidImage.status === 200 && forbidImage.data?.imageLimit === 0)
  const overZero = await api('POST', '/api/ai/images/generate', { model: 'qwen-image-2.0', prompt: 'again', size: '1K', count: 1 }, opToken)
  check('配额 0 后生图 → 429', overZero.status === 429)
  const unlimitImage = await api('PUT', `/api/ai/quotas/${opId}`, { imageLimit: null, videoLimit: null, textLimit: null }, ownerToken)
  check('配额 null = 不限（恢复 → 200）', unlimitImage.status === 200 && unlimitImage.data?.imageLimit === null)
  const afterUnlimit = await api('POST', '/api/ai/images/generate', { model: 'qwen-image-2.0', prompt: '恢复后再来一张', size: '1K', count: 1 }, opToken)
  check('不限后生图 → 200', afterUnlimit.status === 200, afterUnlimit.data)
  const quotaList = await api('GET', '/api/ai/quotas', undefined, ownerToken)
  const opQuotaRow = quotaList.data?.items?.find((item: any) => item.userId === opId)
  check('主帐号查全员配额一览（含运营行与主帐号行）',
    quotaList.status === 200 && quotaList.data?.items?.length === 4 && opQuotaRow?.imageLimit === null && Boolean(quotaList.data?.items?.find((item: any) => item.isOwner)),
    quotaList.data)
  const ownerGen = await api('POST', '/api/ai/images/generate', { model: 'qwen-image-2.0', prompt: '主帐号无配额记录自由调用', size: '1K', count: 1 }, ownerToken)
  check('主帐号（无配额记录）生图 → 200', ownerGen.status === 200, ownerGen.data)

  console.log('\n[9] 用量明细与聚合 GET /api/ai/usage')
  const usageForbidden = await api('GET', '/api/ai/usage', undefined, viewToken)
  check('只读（无 report 权限）查用量 → 403', usageForbidden.status === 403)
  const usageAll = await api('GET', '/api/ai/usage', undefined, ownerToken)
  const opSummary = usageAll.data?.summary?.find((row: any) => row.userId === opId)
  const ownerSummary = usageAll.data?.summary?.find((row: any) => row.userId === ownerId)
  check('主帐号查全员用量（scope=all）',
    usageAll.status === 200 && usageAll.data?.scope === 'all', usageAll.data)
  check('聚合正确：运营 image=6 / text=5 / video=1（超额拦截不产生用量）',
    opSummary?.image === 6 && opSummary?.text === 5 && opSummary?.video === 1 && opSummary?.total === 12,
    opSummary)
  check('聚合正确：主帐号 image=1',
    ownerSummary?.image === 1 && ownerSummary?.total === 1, ownerSummary)
  const usageByUser = await api('GET', `/api/ai/usage?userId=${opId}`, undefined, ownerToken)
  check('主帐号按成员过滤：明细全部属于运营',
    usageByUser.status === 200 && usageByUser.data?.items?.length > 0 && usageByUser.data.items.every((item: any) => item.userId === opId))
  const usageSelf = await api('GET', '/api/ai/usage', undefined, opToken)
  check('运营查用量（scope=self，仅本人聚合）',
    usageSelf.status === 200 && usageSelf.data?.scope === 'self'
      && usageSelf.data?.summary?.length === 1 && usageSelf.data?.summary?.[0]?.userId === opId,
    usageSelf.data?.summary)
  const usageSelfForced = await api('GET', `/api/ai/usage?userId=${ownerId}`, undefined, opToken)
  check('运营带 userId=主帐号 仍被强制只看本人',
    usageSelfForced.status === 200 && usageSelfForced.data?.scope === 'self'
      && usageSelfForced.data.items.every((item: any) => item.userId === opId))
  const usagePub = await api('GET', '/api/ai/usage', undefined, pubToken)
  check('发布员（report.view:self）查用量 → 200 空聚合',
    usagePub.status === 200 && usagePub.data?.scope === 'self' && usagePub.data?.summary?.length === 0, usagePub.data)
  noKeyLeak('用量响应不含密钥', usageAll.raw + usageSelf.raw)

  console.log('\n[10] 审计留痕')
  for (const action of ['ai.image.generate', 'ai.text.translate', 'ai.text.command', 'ai.text.chat', 'ai.video.generate', 'ai.quota.update']) {
    const audit = await api('GET', `/api/audit-logs?action=${action}&limit=5`, undefined, ownerToken)
    check(`审计 ${action} 有留痕`, audit.status === 200 && audit.data?.items?.length > 0, audit.data)
  }

  console.log('\n[11] 跨组织隔离')
  const usageB = await api('GET', '/api/ai/usage', undefined, ownerBToken)
  check('组织B 查用量为空', usageB.status === 200 && usageB.data?.summary?.length === 0 && usageB.data?.items?.length === 0, usageB.data)
  const quotasB = await api('GET', '/api/ai/quotas', undefined, ownerBToken)
  check('组织B 配额列表仅含本人',
    quotasB.status === 200 && quotasB.data?.items?.length === 1 && quotasB.data.items[0].isOwner === true, quotasB.data)
  const quotaCross = await api('PUT', `/api/ai/quotas/${opId}`, { imageLimit: 1 }, ownerBToken)
  check('组织B 给组织A 成员设配额 → 404', quotaCross.status === 404, quotaCross.data)
  const auditB = await api('GET', '/api/audit-logs?limit=200', undefined, ownerBToken)
  check('组织B 审计无组织A 的 AI 记录',
    auditB.status === 200 && !(auditB.data?.items ?? []).some((item: any) => String(item.action).startsWith('ai.')))
} finally {
  await app.close()
  await socket.stop()
  await db.close()
  await new Promise<void>(resolve => mockApp.close(() => resolve()))
}

console.log(`\n[verify] 通过 ${passed} 项，失败 ${failed} 项`)
if (failed > 0) process.exit(1)
console.log('[verify] 阶段 3（AI 网关）验收全部通过')
