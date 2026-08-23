import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import http from 'node:http'

const port = Number(process.env.PORT ?? '8788')
const appOrigin = process.env.YANDU_APP_ORIGIN ?? 'http://app:8787'
const harnessOrigin = process.env.HARNESS_ORIGIN ?? 'http://yandu-dsh-smoke:8080'
const workerImage = process.env.HARNESS_WORKER_IMAGE ?? 'yandu/deepseek-harness:0.1.0-rc.7'
const workerApiKey = process.env.DEEPSEEK_API_KEY
const idleWorkerMs = Number(process.env.HARNESS_IDLE_WORKER_MS ?? 3_600_000)
const publicHost = process.env.DSH_PUBLIC_HOST
const secret = process.env.GATEWAY_SESSION_SECRET
if (!publicHost || !secret) throw new Error('DSH_PUBLIC_HOST and GATEWAY_SESSION_SECRET must be set')
if (!workerApiKey) throw new Error('DEEPSEEK_API_KEY is required for isolated workers')

const sessions = new Map()
const workers = new Map()
const cookieName = '__Host-yandu_harness'

function audit(event, worker, details = {}) {
  console.info(JSON.stringify({ component: 'harness-gateway', event, worker, at: new Date().toISOString(), ...details }))
}

function sign(value) {
  return createHmac('sha256', secret).update(value).digest('base64url')
}

function readSession(request) {
  const raw = request.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1)
  if (!raw) return null
  const [id, signature] = raw.split('.')
  if (!id || !signature) return null
  const expected = sign(id)
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null
  const session = sessions.get(id)
  if (!session || session.expiresAt <= Date.now()) return null
  return session
}

function json(reply, status, body) {
  reply.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  reply.end(JSON.stringify(body))
}

function workerId(principal) {
  return createHash('sha256').update(`${principal.orgId}:${principal.userId}`).digest('hex').slice(0, 24)
}

function docker(method, path, body) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      socketPath: '/var/run/docker.sock', path: `/v1.41${path}`, method,
      headers: body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : undefined
    }, response => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { text += chunk })
      response.on('end', () => resolve({ status: response.statusCode ?? 500, body: text }))
    })
    request.on('error', reject)
    if (body) request.end(body); else request.end()
  })
}

async function ensureWorker(principal) {
  const id = workerId(principal)
  const name = `yandu-dsh-${id}`
  let inspect = await docker('GET', `/containers/${name}/json`)
  if (inspect.status === 200) {
    const currentImage = JSON.parse(inspect.body).Config?.Image
    if (currentImage !== workerImage) {
      // 升级仅替换容器；用户工作区与状态使用命名卷，绝不在此流程删除。
      await docker('POST', `/containers/${name}/stop?t=15`)
      const remove = await docker('DELETE', `/containers/${name}?v=false&force=true`)
      if (![204, 404].includes(remove.status)) throw new Error(`worker upgrade remove failed (${remove.status})`)
      audit('worker-upgraded', name, { image: workerImage })
      inspect = { status: 404, body: '' }
    }
  }
  if (inspect.status === 404) {
    const create = await docker('POST', `/containers/create?name=${name}`, JSON.stringify({
      Image: workerImage,
      Hostname: name,
      Env: [
        `DEEPSEEK_API_KEY=${workerApiKey}`,
        `DSH_PUBLIC_HOST=${publicHost}`,
        'DSH_PERMISSION_MODE=workspace-write', 'DSH_HOME=/state', 'HOME=/state'
      ],
      Labels: {
        'yandu.harness.managed': 'true', 'yandu.harness.user': workerId(principal),
        'yandu.harness.org': createHash('sha256').update(principal.orgId).digest('hex').slice(0, 16),
        'yandu.harness.image': workerImage
      },
      HostConfig: {
        NetworkMode: 'app_default', ReadonlyRootfs: true, CapDrop: ['ALL'],
        SecurityOpt: ['no-new-privileges:true'], PidsLimit: 128,
        Memory: 2147483648, MemorySwap: 3221225472, NanoCpus: 1000000000,
        Tmpfs: { '/tmp': 'rw,noexec,nosuid,size=64m' },
        Mounts: [
          { Type: 'volume', Source: `${name}-workspace`, Target: '/workspace' },
          { Type: 'volume', Source: `${name}-state`, Target: '/state' }
        ]
      }
    }))
    if (create.status !== 201 && create.status !== 409) throw new Error(`worker create failed (${create.status})`)
    audit('worker-created', name, { image: workerImage })
  } else if (inspect.status !== 200) {
    throw new Error(`worker inspect failed (${inspect.status})`)
  }
  const start = await docker('POST', `/containers/${name}/start`)
  if (![204, 304].includes(start.status)) throw new Error(`worker start failed (${start.status})`)
  const origin = `http://${name}:8080`
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) {
        workers.set(name, { lastSeenAt: Date.now(), activeSockets: workers.get(name)?.activeSockets ?? 0 })
        audit('worker-ready', name, { image: workerImage })
        return origin
      }
    } catch { /* worker is still booting */ }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('worker did not become ready in time')
}

function touchWorker(session) {
  const name = new URL(session.workerOrigin).hostname
  const worker = workers.get(name) ?? { activeSockets: 0 }
  workers.set(name, { ...worker, lastSeenAt: Date.now() })
  return name
}

async function stopIdleWorkers() {
  const now = Date.now()
  for (const [name, worker] of workers) {
    if (worker.activeSockets || now - worker.lastSeenAt < idleWorkerMs) continue
    const result = await docker('POST', `/containers/${name}/stop?t=15`).catch(() => null)
    if (result && [204, 304].includes(result.status)) {
      workers.delete(name)
      audit('worker-idle-stopped', name)
    }
  }
}

async function createSession(request, reply) {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) return json(reply, 401, { error: 'UNAUTHORIZED' })
  const validation = await fetch(`${appOrigin}/api/codex-harness/gateway/validate`, {
    method: 'POST',
    headers: { authorization }
  })
  if (!validation.ok) return json(reply, validation.status === 403 ? 403 : 401, { error: 'UNAUTHORIZED' })
  const principal = await validation.json()
  const workerOrigin = await ensureWorker(principal)
  const id = randomUUID()
  const expiresAt = Date.parse(principal.expiresAt)
  sessions.set(id, { ...principal, workerOrigin, expiresAt })
  reply.writeHead(204, {
    'set-cookie': `${cookieName}=${id}.${sign(id)}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${Math.max(1, Math.floor((expiresAt - Date.now()) / 1000))}`,
    'cache-control': 'no-store'
  })
  reply.end()
}

function upstreamHeaders(request, session) {
  const headers = { ...request.headers, 'x-yandu-user-id': session?.userId ?? '', 'x-yandu-org-id': session?.orgId ?? '' }
  if (session?.workerOrigin && request.url?.startsWith('/api/')) {
    // The official settings and credentials catalog deliberately accepts only
    // loopback callers. The authenticated gateway is that trusted hop; browser
    // origin markers must not be forwarded as an untrusted remote request.
    headers.host = '127.0.0.1'
    delete headers.origin
    delete headers['sec-fetch-site']
    delete headers['sec-fetch-mode']
  } else {
    headers.host = publicHost
  }
  return headers
}

function proxy(request, reply, session) {
  if (session?.workerOrigin) touchWorker(session)
  const target = new URL(session?.workerOrigin ?? harnessOrigin)
  const upstream = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: request.method,
    path: request.url,
    headers: upstreamHeaders(request, session)
  }, response => {
    // Cancellation is intentionally idempotent. A worker restart can remove
    // an in-flight session before the browser's stop request arrives; that
    // state is already stopped and must not surface as a user-facing error.
    if (request.url === '/api/session.cancel' && response.statusCode === 404) {
      response.resume()
      reply.writeHead(204)
      reply.end()
      return
    }
    reply.writeHead(response.statusCode ?? 502, response.headers)
    response.pipe(reply)
  })
  upstream.on('error', () => json(reply, 502, { error: 'HARNESS_UNAVAILABLE' }))
  request.pipe(upstream)
}

const server = http.createServer((request, reply) => {
  if (request.url === '/health') {
    return json(reply, 200, {
      ok: true,
      workerImage,
      trackedWorkers: workers.size,
      idleWorkerMinutes: Math.floor(idleWorkerMs / 60_000)
    })
  }
  if (request.method === 'POST' && request.url === '/session') {
    createSession(request, reply).catch(() => json(reply, 502, { error: 'AUTH_UPSTREAM_UNAVAILABLE' }))
    return
  }
  // 官方 Web UI 的 JS/CSS 由根路径 /assets/ 引用；这些静态文件不含用户数据，
  // 页面和 API 仍必须经过下方已签名的会话校验。
  if (request.url?.startsWith('/assets/') || request.url?.startsWith('/plugins/')) {
    return proxy(request, reply, { userId: '', orgId: '' })
  }
  const session = readSession(request)
  if (!session) return json(reply, 401, { error: 'UNAUTHORIZED' })
  proxy(request, reply, session)
})

server.on('upgrade', (request, socket, head) => {
  const session = readSession(request)
  if (!session) return socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n')
  const workerName = touchWorker(session)
  const worker = workers.get(workerName)
  workers.set(workerName, { ...worker, activeSockets: (worker?.activeSockets ?? 0) + 1, lastSeenAt: Date.now() })
  const target = new URL(session.workerOrigin)
  const upstream = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: request.method,
    path: request.url,
    headers: upstreamHeaders(request, session)
  })
  upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`).join('\r\n')}\r\n\r\n`)
    if (upstreamHead.length) socket.write(upstreamHead)
    if (head.length) upstreamSocket.write(head)
    const close = () => {
      const current = workers.get(workerName)
      if (current) workers.set(workerName, { ...current, activeSockets: Math.max(0, current.activeSockets - 1), lastSeenAt: Date.now() })
    }
    socket.once('close', close)
    upstreamSocket.once('close', close)
    upstreamSocket.pipe(socket).pipe(upstreamSocket)
  })
  upstream.on('error', () => socket.destroy())
  upstream.end()
})

server.listen(port, '0.0.0.0')
setInterval(() => { void stopIdleWorkers() }, 5 * 60_000).unref()
