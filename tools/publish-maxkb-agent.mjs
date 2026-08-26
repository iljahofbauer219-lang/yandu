#!/usr/bin/env node
/**
 * 阶段 1.5：MaxKB application 一键发布（PUT publish）
 * - 让 application 的 model/knowledge 等字段真正生效（PUT 必走，否则 chat 报"AI 模型未配置"）
 * - 5 个 application 全部走一遍；幂等可重复
 * - admin 密码**仅内存**（stdin 读入，永不落盘 / 写文件 / 写日志）
 *
 * 运行：node tools/publish-maxkb-agent.mjs
 *       node tools/publish-maxkb-agent.mjs --only 01a02f8c-66d2-7803-b02b-e67d1cc6e02b,01a02f8c-917e-7232-b62f-f087f70af6b2
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(ROOT, '.env.local')
const REPORT_FILE = path.join(__dirname, 'publish-maxkb-agent-report.json')

// ─── 1. 加载 .env.local（读 MAXKB_BASE_URL，**不读** RAGFLOW_*）─────────
const envRaw = await fsp.readFile(ENV_FILE, 'utf8')
const env = Object.fromEntries(
  envRaw.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      const i = line.indexOf('=')
      if (i === -1) return [line, '']
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
    })
)
for (const [k, v] of Object.entries(env)) process.env[k] = v
const BASE = process.env.MAXKB_BASE_URL
if (!BASE) { console.error('FAIL: .env.local 缺 MAXKB_BASE_URL'); process.exit(1) }

// ─── 2. 解析 --only 参数 ───────────────────────────────────────────
const args = process.argv.slice(2)
const onlyIdx = args.indexOf('--only')
const onlySet = onlyIdx >= 0 ? new Set(args[onlyIdx + 1].split(',').map(s => s.trim()).filter(Boolean)) : null

// ─── 3. 读 admin 凭据（TTY 隐藏回显，管道 / CI 按行读取，**永不留盘**）────────
let __stdinCache = null
async function readStdinLines() {
  if (__stdinCache) return __stdinCache
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk.toString('utf8'))
  __stdinCache = chunks.join('').split(/\r?\n/).map(l => l.trim())
  return __stdinCache
}
async function readCredential(mode) {
  if (process.stdin.isTTY) {
    return new Promise((resolve) => {
      process.stdout.write(mode === 'username' ? 'MaxKB admin username [admin]: ' : 'MaxKB admin password: ')
      process.stdin.setRawMode(true)
      process.stdin.resume()
      process.stdin.setEncoding('utf8')
      let input = ''
      const onData = (ch) => {
        ch = ch.toString('utf8')
        if (ch === '\n' || ch === '\r' || ch === '\u0004') {
          process.stdin.setRawMode(false)
          process.stdin.removeListener('data', onData)
          process.stdout.write('\n')
          resolve(input)
        } else if (ch === '\u0003') {
          process.exit(1)
        } else if (mode === 'password' && (ch === '\u007f' || ch === '\b')) {
          if (input.length > 0) { input = input.slice(0, -1); process.stdout.write('\b \b') }
        } else {
          input += ch
          if (mode === 'password') process.stdout.write('*')
        }
      }
      process.stdin.on('data', onData)
    })
  } else {
    // 非 TTY：一次性从 stdin 读所有内容后缓存，按行取（供 CI / 管道使用）
    const lines = await readStdinLines()
    if (mode === 'username') return lines[0] || 'admin'
    return lines[1] || ''
  }
}

const USERNAME = (await readCredential('username')).trim() || 'admin'
const PASSWORD = await readCredential('password')
// 立即用完后清零内存引用（best-effort，防 heap dump 泄露）
const pwdBuf = Buffer.from(PASSWORD, 'utf8')

// ─── 4. 拿 admin token ───────────────────────────────────────────
const loginRes = await fetch(`${BASE}/admin/api/user/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: USERNAME, password: pwdBuf.toString('utf8') })
})
if (!loginRes.ok) {
  console.error(`FAIL: admin 登录 HTTP ${loginRes.status}`)
  pwdBuf.fill(0)
  process.exit(1)
}
const loginBody = await loginRes.json()
const ADMIN_TOKEN = loginBody?.data?.token
if (!ADMIN_TOKEN) {
  console.error('FAIL: 登录成功但未返回 token')
  pwdBuf.fill(0)
  process.exit(1)
}
console.log(`[publish] admin 登录成功（token len=${ADMIN_TOKEN.length}）`)
pwdBuf.fill(0)

// ─── 5. 拉 application 列表 ─────────────────────────────────────
const listRes = await fetch(`${BASE}/admin/api/workspace/default/application`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } })
if (!listRes.ok) {
  console.error(`FAIL: 拉 application 列表 HTTP ${listRes.status}`)
  process.exit(1)
}
const listBody = await listRes.json()
const allApps = Array.isArray(listBody?.data) ? listBody.data : []
const targetApps = onlySet ? allApps.filter(a => onlySet.has(a.id)) : allApps
console.log(`[publish] 共 ${allApps.length} 个 application；本次发布 ${targetApps.length} 个`)

// ─── 6. 逐个 PUT publish ─────────────────────────────────────────
const report = { started_at: new Date().toISOString(), base_url: BASE, results: [] }
for (const app of targetApps) {
  const t0 = Date.now()
  const pubRes = await fetch(`${BASE}/admin/api/workspace/default/application/${app.id}/publish`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${ADMIN_TOKEN}` }
  })
  const elapsed = Date.now() - t0
  const body = await pubRes.json().catch(() => ({}))
  const ok = pubRes.ok && body?.code === 200
  report.results.push({
    id: app.id,
    name: app.name,
    model: app.model,
    is_publish_before: app.is_publish,
    put_publish_code: pubRes.status,
    maxkb_response_code: body?.code,
    elapsed_ms: elapsed,
    status: ok ? 'success' : 'failed',
    error: ok ? undefined : (body?.message || `HTTP ${pubRes.status}`)
  })
  console.log(`[${ok ? '✓' : '✗'}] ${app.name} (${app.id}) — ${body?.code ?? pubRes.status} / ${elapsed}ms`)
}

// ─── 7. 验证发布结果（GET application 看 is_publish）────────────────
console.log('\n[publish] 验证：')
for (const app of targetApps) {
  const getRes = await fetch(`${BASE}/admin/api/workspace/default/application/${app.id}`, { headers: { Authorization: `Bearer ${ADMIN_TOKEN}` } })
  const body = await getRes.json().catch(() => ({}))
  const isPublish = body?.data?.is_publish
  const model = body?.data?.model
  const entry = report.results.find(r => r.id === app.id)
  if (entry) entry.is_publish_after = isPublish
  console.log(`  - ${app.name}: is_publish=${isPublish}, model=${model}`)
}

report.finished_at = new Date().toISOString()
report.summary = {
  total: report.results.length,
  success: report.results.filter(r => r.status === 'success').length,
  failed: report.results.filter(r => r.status === 'failed').length
}
await fsp.writeFile(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8')
console.log(`\n[publish] 报告：${REPORT_FILE}`)
console.log(`[publish] ${report.summary.success}/${report.summary.total} success`)
process.exit(report.summary.failed > 0 ? 1 : 0)
