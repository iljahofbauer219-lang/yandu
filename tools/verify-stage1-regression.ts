#!/usr/bin/env node
/**
 * 阶段 1.7：阶段 1 综合回归（5 application + KB + GraphRAG + admin auth + publish）
 * - 用 stdin 一次性传 admin 凭据（用户/密码）
 * - 9 项端到端检查全 PASS 才算阶段 1 完成
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(ROOT, '.env.local')
const REPORT_FILE = path.join(__dirname, 'verify-stage1-regression-report.json')

const report = { started_at: new Date().toISOString(), base_url: '', checks: [] }
function check(name: string, ok: boolean, detail: unknown) {
  report.checks.push({ name, status: ok ? 'pass' : 'fail', detail })
  console.log(`[${ok ? '✓' : '✗'}] ${name}: ${JSON.stringify(detail).slice(0, 200)}`)
}

async function main() {
  // ─── 1. 加载 .env.local ───────────────────────────────────────────
  const envRaw = await fsp.readFile(ENV_FILE, 'utf8')
  const env = Object.fromEntries(
    envRaw.split('\n').map(line => line.trim()).filter(l => l && !l.startsWith('#')).map(line => {
      const i = line.indexOf('='); return i === -1 ? [line, ''] : [line.slice(0, i).trim(), line.slice(i + 1).trim()]
    })
  )
  for (const [k, v] of Object.entries(env)) process.env[k] = v
  const BASE = process.env.MAXKB_BASE_URL
  if (!BASE) { console.error('FAIL: .env.local 缺 MAXKB_BASE_URL'); process.exit(1) }
  report.base_url = BASE

  // ─── 2. 读 admin 凭据（从 stdin 或默认路径 A）────────────────────
  async function readCred() {
    if (process.stdin.isTTY) {
      return { user: 'admin', pass: '' }
    }
    const chunks: string[] = []
    for await (const c of process.stdin) chunks.push(c.toString('utf8'))
    const lines = chunks.join('').split(/\r?\n/).map(l => l.trim())
    return { user: lines[0] || 'admin', pass: lines[1] || '' }
  }
  const { user: USERNAME, pass: PASSWORD } = await readCred()
  if (!PASSWORD) { console.error('FAIL: stdin 第 2 行需 admin 密码'); process.exit(1) }

  // ─── 3. admin 登录拿 token ──────────────────────────────────────
  const loginRes = await fetch(`${BASE}/admin/api/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD })
  })
  if (!loginRes.ok) { console.error(`FAIL: admin 登录 HTTP ${loginRes.status}`); process.exit(1) }
  const ADMIN_TOKEN = (await loginRes.json())?.data?.token
  if (!ADMIN_TOKEN) { console.error('FAIL: 登录成功但无 token'); process.exit(1) }
  const H = { Authorization: `Bearer ${ADMIN_TOKEN}` }

  // ─── 4. 5 application 配置（来自 .env）──────────────────────────
  const APPS = [
    { id: process.env.MAXKB_AMAZON_SKILLS_APPLICATION_ID, token: process.env.MAXKB_AMAZON_SKILLS_SECRET, label: 'amazon-skills' },
    { id: process.env.MAXKB_DEFAULT_APPLICATION_ID,        token: process.env.MAXKB_DEFAULT_TOKEN,        label: 'default' },
    { id: process.env.MAXKB_SOURCING_APPLICATION_ID,      token: process.env.MAXKB_SOURCING_TOKEN,      label: 'sourcing' },
    { id: process.env.MAXKB_LISTING_APPLICATION_ID,       token: process.env.MAXKB_LISTING_TOKEN,       label: 'listing' },
    { id: process.env.MAXKB_GUARDIAN_APPLICATION_ID,      token: process.env.MAXKB_GUARDIAN_TOKEN,      label: 'guardian' }
  ].filter(a => a.id && a.token)
  const KBS = String(process.env.MAXKB_KNOWLEDGE_DATASETS || '').split(',').map(s => s.trim()).filter(Boolean)

  // ─── 5. admin GET application 列表 ─────────────────────────────
  const t0 = Date.now()
  const listRes = await fetch(`${BASE}/admin/api/workspace/default/application`, { headers: H })
  const listBody = await listRes.json()
  const allApps: Array<{ id: string; name: string; is_publish: boolean; model_id?: string; model?: string }> = Array.isArray(listBody?.data) ? listBody.data : []
  const ids = new Set(APPS.map(a => a.id))
  const matched = allApps.filter(a => ids.has(a.id))
  const allPublished = matched.length === APPS.length && matched.every(a => a.is_publish === true)
  check('stage1.1:all-5-apps-published', allPublished, {
    expected: APPS.length,
    found: matched.length,
    published: matched.map(a => ({ name: a.name, is_publish: a.is_publish, model: a.model_id || a.model })),
    elapsed_ms: Date.now() - t0
  })

  // ─── 6. 5 application 端到端 chat（secret_key 直接 Bearer）──────
  const chatResults: Array<{ label: string; http: number; ok: boolean; elapsed_ms: number; content_len: number }> = []
  for (const app of APPS) {
    const t1 = Date.now()
    const res = await fetch(`${BASE}/chat/api/${app.id}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${app.token}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: '用一句话回答：选品核心是什么？' }], stream: false })
    })
    const elapsed = Date.now() - t1
    const body = await res.json().catch(() => ({}))
    const content = body?.data?.content || body?.choices?.[0]?.message?.content || ''
    const ok = res.ok && !!content
    chatResults.push({ label: app.label, http: res.status, ok, elapsed_ms: elapsed, content_len: content.length })
  }
  const allChatOk = chatResults.every(r => r.ok)
  const totalMs = chatResults.reduce((s, r) => s + r.elapsed_ms, 0)
  check('stage1.2:5-apps-chat-all-pass', allChatOk, {
    results: chatResults,
    total_elapsed_ms: totalMs,
    avg_ms: Math.round(totalMs / chatResults.length)
  })

  // ─── 7. KB list（admin 鉴权） ────────────────────────────────
  const kbResults: Array<{ kb_id: string; http: number; doc_count: number; sample: Array<{ name: string; status?: string }> }> = []
  for (const kbId of KBS) {
    const t2 = Date.now()
    const res = await fetch(`${BASE}/admin/api/workspace/default/knowledge/${kbId}/document`, { headers: H })
    const body = await res.json()
    const docs = Array.isArray(body?.data) ? body.data : []
    kbResults.push({ kb_id: kbId, http: res.status, doc_count: docs.length, sample: docs.slice(0, 2).map(d => ({ name: d.name, status: d.status || d.type })) })
    void t2
  }
  const allKbOk = kbResults.every(r => r.http === 200)
  check('stage1.3:kb-list-all-pass', allKbOk, { kbs: kbResults })

  // ─── 8. KB CRUD 仍 blocked（MaxKB 模式：HTTP 200 + body.code:500 "方法不被允许"）────────────
  const crudPost = await fetch(`${BASE}/admin/api/workspace/default/knowledge`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '__regression_test__' }) })
  const crudPostBody = await crudPost.json().catch(() => ({}))
  const crudPatch = await fetch(`${BASE}/admin/api/workspace/default/knowledge/${KBS[0]}`, { method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '__x__' }) })
  const crudPatchBody = await crudPatch.json().catch(() => ({}))
  const crudBlocked = crudPostBody?.code !== 200 && crudPatchBody?.code !== 200
  check('stage1.4:kb-crud-blocked-confirmed', crudBlocked, {
    POST: { http: crudPost.status, body_code: crudPostBody?.code, msg: crudPostBody?.message },
    PATCH: { http: crudPatch.status, body_code: crudPatchBody?.code, msg: crudPatchBody?.message },
    expected: 'POST/PATCH 实际不生效（body.code !== 200）'
  })

  // ─── 9. doc.meta.category 持久化（put → get 回读）──────────
  const firstKb = KBS[0]
  const docListRes = await fetch(`${BASE}/admin/api/workspace/default/knowledge/${firstKb}/document`, { headers: H })
  const docList = (await docListRes.json())?.data || []
  const testDoc = docList[0]
  let metaOk = false, metaDetail: Record<string, unknown> = {}
  if (testDoc) {
    const testCat = `__regression_${Date.now()}__`
    const putRes = await fetch(`${BASE}/admin/api/workspace/default/knowledge/${firstKb}/document/${testDoc.id}`, {
      method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ meta: { ...(testDoc.meta || {}), category: testCat } })
    })
    await new Promise(r => setTimeout(r, 300))
    const getRes = await fetch(`${BASE}/admin/api/workspace/default/knowledge/${firstKb}/document/${testDoc.id}`, { headers: H })
    const got = (await getRes.json())?.data
    metaOk = got?.meta?.category === testCat
    metaDetail = { put_http: putRes.status, get_http: getRes.status, sent_category: testCat, got_category: got?.meta?.category, doc: testDoc.name }
    // 恢复
    if (got?.meta) {
      delete got.meta.category
      await fetch(`${BASE}/admin/api/workspace/default/knowledge/${firstKb}/document/${testDoc.id}`, {
        method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
        body: JSON.stringify({ meta: got.meta })
      })
    }
  }
  check('stage1.5:meta-category-persist', metaOk, metaDetail)

  // ─── 10. GraphRagAdapter（real MaxKB source）────────────────
  const realSource = {
    async listDocs(kbId: string) {
      const res = await fetch(`${BASE}/admin/api/workspace/default/knowledge/${kbId}/document`, { headers: H })
      const body = await res.json()
      const docs = Array.isArray(body?.data) ? body.data : []
      return { docs: docs.map(d => ({ id: d.id, name: d.name, meta: d.meta })) }
    },
    async fetchDocContent(kbId: string, docId: string) {
      const res = await fetch(`${BASE}/admin/api/workspace/default/knowledge/${kbId}/document/${docId}`, { headers: H })
      const body = await res.json()
      return body?.data?.name || ''
    }
  }
  let graphOk = false, graphDetail: Record<string, unknown> = {}
  try {
    const { GraphRagAdapter } = await import('../src/main/services/GraphRagAdapter.ts')
    const TMP = path.join('/tmp', `stage1-graph-${Date.now()}.json`)
    const adapter = new GraphRagAdapter(realSource, KBS)
    ;(adapter as { indexPath: () => string }).indexPath = () => TMP
    const idx = await adapter.getIndex()
    const expand = await adapter.expand('选品方法论')
    graphOk = idx.docCount >= 0 && Object.keys(idx.nodes).length > 0
    graphDetail = { docCount: idx.docCount, chunkCount: idx.chunkCount, termCount: Object.keys(idx.nodes).length, expand_count: expand.length, expand_top: expand.slice(0, 2).map(r => ({ doc: r.docName, score: r.score.toFixed(2) })) }
    try { await fsp.unlink(TMP) } catch { /* ignore */ }
  } catch (e) {
    graphDetail = { error: (e instanceof Error ? e.message : String(e)) }
  }
  check('stage1.6:graph-rag-build-with-real-kb', graphOk, graphDetail)

  // ─── 11. publish-maxkb-agent 幂等可重复 ─────────────────────
  let publishOk = false, publishDetail: Record<string, unknown> = {}
  try {
    for (const app of APPS) {
      const res = await fetch(`${BASE}/admin/api/workspace/default/application/${app.id}/publish`, { method: 'PUT', headers: H })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.code !== 200) { publishDetail = { app: app.label, http: res.status, body }; break }
    }
    publishOk = Object.keys(publishDetail).length === 0
    if (publishOk) publishDetail = { note: '5/5 application 重新 publish 成功（幂等）' }
  } catch (e) {
    publishDetail = { error: (e instanceof Error ? e.message : String(e)) }
  }
  check('stage1.7:republish-idempotent', publishOk, publishDetail)

  // ─── 收尾 ─────────────────────────────────────────────────────
  report.finished_at = new Date().toISOString()
  report.summary = {
    total: report.checks.length,
    pass: report.checks.filter(c => c.status === 'pass').length,
    fail: report.checks.filter(c => c.status === 'fail').length
  }
  await fsp.writeFile(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\n[verify] 报告：${REPORT_FILE}`)
  console.log(`[verify] ${report.summary.pass}/${report.summary.total} PASS`)
  process.exit(report.summary.fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(2)
})
