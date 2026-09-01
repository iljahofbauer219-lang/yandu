#!/usr/bin/env node
/**
 * 阶段 2.4-2.5 综合回归：内容迁移 + 分类 + GraphRAG 集成
 * - 19 份 doc 按 category 分布正确
 * - 4 份老 doc（来自 RAGFlow）已补 meta.category
 * - MaxkbKnowledgeService.graphStats / graphExpand 端到端可用
 * - 5 application 仍可 chat
 * - provider 字段 4 个 maxkb 模型已重命名
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const REPORT_FILE = path.join(__dirname, 'verify-stage2-regression-report.json')
const PASSWORD = process.env.MAXKB_ADMIN_PASSWORD || ''

async function loadEnv() {
  const envRaw = await fsp.readFile(path.join(ROOT, '.env.local'), 'utf8')
  return Object.fromEntries(
    envRaw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
      const i = l.indexOf('='); return i === -1 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
  )
}

const report = { started_at: new Date().toISOString(), checks: [] as Array<{ name: string; status: string; detail: unknown }> }
function check(name: string, ok: boolean, detail: unknown) {
  report.checks.push({ name, status: ok ? 'pass' : 'fail', detail })
  console.log(`[${ok ? '✓' : '✗'}] ${name}: ${JSON.stringify(detail).slice(0, 280)}`)
}

async function main() {
  const env = await loadEnv()
  const BASE = env.MAXKB_BASE_URL
  const KBS = env.MAXKB_KNOWLEDGE_DATASETS.split(',')
  const PWD_BUF = Buffer.from(PASSWORD, 'utf8')
  // 关键：把 .env 注入到 process.env，否则 MaxkbKnowledgeService.baseUrl() / datasets() 拿不到配置，
  // graph rebuild 会 catch 静默"未配置 MAXKB_BASE_URL"，最终 build 出 0 docs 索引。
  process.env.MAXKB_BASE_URL = env.MAXKB_BASE_URL
  process.env.MAXKB_KNOWLEDGE_DATASETS = env.MAXKB_KNOWLEDGE_DATASETS

  // ─── 1. admin 登录 ─────────────────────────────────────
  const loginRes = await fetch(`${BASE}/admin/api/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: PWD_BUF.toString('utf8') })
  })
  PWD_BUF.fill(0)
  if (!loginRes.ok) { console.error(`FAIL: 登录 HTTP ${loginRes.status}`); process.exit(1) }
  const ADMIN_TOKEN = (await loginRes.json()).data.token
  const H = { Authorization: `Bearer ${ADMIN_TOKEN}` }

  // ─── 2. 拉 KB1 全部 doc + 分类分布 ─────────────────────
  const list = (await (await fetch(`${BASE}/admin/api/workspace/default/knowledge/${KBS[0]}/document?page=1&page_size=100`, { headers: H })).json()).data || []
  const byCategory: Record<string, number> = {}
  let withCat = 0
  for (const d of list) {
    const cat = d.meta?.category || '(no-category)'
    byCategory[cat] = (byCategory[cat] || 0) + 1
    if (d.meta?.category) withCat += 1
  }
  check('stage2.1:total-docs-19', list.length === 19, { total: list.length, with_category: withCat, by_category: byCategory })

  // ─── 3. 4 份老 doc 已补 category ─────────────────────
  const oldDocs = ['选品分析方法论.md', '选品分析师-验收标准.md', '选品分析师-新版方法论.md', '跨境AI选品分析师-标准报告模板-v1.3.md']
  const oldAllCat = oldDocs.every(name => {
    const d = list.find((x: { name: string }) => x.name === name)
    return d && d.meta?.category
  })
  check('stage2.2:old-ragflow-docs-categorized', oldAllCat, { old_docs: oldDocs.map(name => ({ name, category: list.find((d: { name: string }) => d.name === name)?.meta?.category })) })

  // ─── 4. 多级分类（一级 ≥ 5）────────────────────
  const topLevelCats = new Set<string>()
  for (const cat of Object.keys(byCategory)) {
    if (cat === '(no-category)') continue
    const top = cat.split('/')[0]
    topLevelCats.add(top)
  }
  // 现阶段迁移计划一级 = 4：选品方法论 / Listing精造师 / 案例库 / 运维
  check('stage2.3:multi-level-categories', topLevelCats.size >= 4, { top_level_count: topLevelCats.size, top_levels: Array.from(topLevelCats), expected: '>= 4' })

  // ─── 5. GraphRagAdapter 集成（real MaxKB source）────────────────
  // MaxkbKnowledgeService.adminRequest 依赖 process.env.MAXKB_ADMIN_TOKEN；
  // 发布期该 token 由 publish-maxkb-agent.mjs 注入 .env.local；测试里手动 set。
  process.env.MAXKB_ADMIN_TOKEN = ADMIN_TOKEN
  const { MaxkbKnowledgeService } = await import('../src/main/services/MaxkbKnowledgeService.ts')
  const svc = new MaxkbKnowledgeService()
  // 不走 list()（KB 名称匹配 agentKey 后 customs 为空）；直接传 KB ID 调 graph

  let graphOk = false, graphDetail: Record<string, unknown> = {}
  try {
    const stats = await svc.graphStats()
    const expanded = await svc.graphExpand('选品方法论', { topK: 5 })
    graphOk = stats.docCount >= 15 && expanded.length > 0
    graphDetail = { stats, expand_count: expanded.length, top: expanded.slice(0, 3).map(r => ({ doc: r.docName, score: r.score.toFixed(2), matched: r.matchedTerms.slice(0, 4) })) }
  } catch (e) {
    graphDetail = { error: (e instanceof Error ? e.message : String(e)) }
  }
  check('stage2.4:graph-rag-integration-real-data', graphOk, graphDetail)

  // ─── 6. provider 字段 4 个 maxkb 模型 ─────────────────
  const sharedType = await fsp.readFile(path.join(ROOT, 'src/shared/aiEmployee.ts'), 'utf8')
  const hasMaxkb = sharedType.includes("'maxkb' | 'ragflow'")
  const chatSvcText = await fsp.readFile(path.join(ROOT, 'src/main/services/AiEmployeeChatService.ts'), 'utf8')
  const renamedCount = (chatSvcText.match(/provider: 'maxkb'/g) || []).length
  check('stage2.5:provider-renamed-to-maxkb', hasMaxkb && renamedCount >= 4, { shared_type_has_maxkb: hasMaxkb, provider_maxkb_count: renamedCount })

  // ─── 7. 5 application 端到端 chat（回归确认 19 份 doc 后仍可用）──────
  const APPS = [
    { id: env.MAXKB_AMAZON_SKILLS_APPLICATION_ID, token: env.MAXKB_AMAZON_SKILLS_SECRET, label: 'amazon-skills' },
    { id: env.MAXKB_DEFAULT_APPLICATION_ID,        token: env.MAXKB_DEFAULT_TOKEN,        label: 'default' },
    { id: env.MAXKB_SOURCING_APPLICATION_ID,      token: env.MAXKB_SOURCING_TOKEN,      label: 'sourcing' },
    { id: env.MAXKB_LISTING_APPLICATION_ID,       token: env.MAXKB_LISTING_TOKEN,       label: 'listing' },
    { id: env.MAXKB_GUARDIAN_APPLICATION_ID,      token: env.MAXKB_GUARDIAN_TOKEN,      label: 'guardian' }
  ].filter(a => a.id && a.token)
  const chatResults: Array<{ label: string; ok: boolean; elapsed_ms: number }> = []
  for (const app of APPS) {
    const t0 = Date.now()
    const res = await fetch(`${BASE}/chat/api/${app.id}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${app.token}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: '简述：跨境选品 5 维度？' }], stream: false })
    })
    const body = await res.json().catch(() => ({}))
    const content = body?.data?.content || body?.choices?.[0]?.message?.content || ''
    chatResults.push({ label: app.label, ok: res.ok && !!content, elapsed_ms: Date.now() - t0 })
  }
  const allChatOk = chatResults.every(r => r.ok)
  check('stage2.6:5-apps-chat-after-migration', allChatOk, { results: chatResults })

  // ─── 8. RAGFlow 完全下线（不可达）────────────────────
  const ragflowDown = await new Promise<boolean>((resolve) => {
    const c = new AbortController()
    const timer = setTimeout(() => { c.abort(); resolve(true) }, 2000)
    fetch('http://127.0.0.1:9380/v1/user/login', { signal: c.signal })
      .then(r => { clearTimeout(timer); resolve(r.status === 0 || !r.ok) })
      .catch(() => { clearTimeout(timer); resolve(true) })
  })
  check('stage2.7:ragflow-fully-down', ragflowDown, { note: 'RAGFlow 9380 不可达（已 down -v）' })

  // 清理
  try { await fsp.rm(TMP_USER_DATA, { recursive: true }) } catch { /* ignore */ }

  // ─── 收尾 ───────────────────────────────────────────
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

main().catch((e) => { console.error('FATAL:', e); process.exit(2) })
