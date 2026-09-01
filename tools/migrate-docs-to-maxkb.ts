#!/usr/bin/env node
/**
 * 阶段 2.1-2.2：内容迁移（双轨）
 * 把 docs/*.md 业务资料批量迁入 MaxKB KB1
 * - 按文件名 + 路径判定 category（meta.category 多级分类）
 * - 已存在的跳过（幂等）
 * - 失败可重跑
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const REPORT_FILE = path.join(__dirname, 'migrate-docs-to-maxkb-report.json')

// ─── 1. 加载 .env ───────────────────────────────────────────
async function loadEnv() {
  const envRaw = await fsp.readFile(path.join(ROOT, '.env.local'), 'utf8')
  return Object.fromEntries(
    envRaw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
      const i = l.indexOf('='); return i === -1 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
  )
}

// ─── 2. 业务资料 → category 映射（多级分类）─────────────────
const MIGRATION_PLAN: Array<{ file: string; category: string; tags?: string[] }> = [
  // 选品方法论（4 份已在 KB1，跳过幂等更新）
  { file: '选品分析师-报告模板-v1.1.md',         category: '选品方法论/报告模板', tags: ['v1.1', '历史版本'] },
  { file: '选品分析师-报告模板-v1.2.md',         category: '选品方法论/报告模板', tags: ['v1.2', '历史版本'] },
  { file: '选品分析师-报告样例库.md',            category: '选品方法论/报告样例', tags: ['样例库'] },
  { file: '选品分析师-智能体提示词.md',          category: '选品方法论/智能体',   tags: ['提示词'] },
  { file: '亚马逊宠物用品评估表.md',             category: '选品方法论/评估表',   tags: ['宠物', '评估表'] },
  { file: '美容护理类-选品矩阵.md',              category: '选品方法论/品类矩阵', tags: ['美容护理'] },
  // 案例库
  { file: '苦苹果防咬喷雾-产品分析.md',           category: '案例库/宠物',         tags: ['宠物', '防咬'] },
  { file: '宠物美容刷-完整评估.md',               category: '案例库/宠物',         tags: ['宠物', '美容'] },
  // Listing 精造师系列
  { file: 'Listing精造师方法论.md',               category: 'Listing精造师/方法论', tags: ['listing'] },
  { file: 'Listing精造师-关键词库.md',            category: 'Listing精造师/词库',   tags: ['listing', '关键词'] },
  { file: 'Listing精造师-平台规则库.md',          category: 'Listing精造师/规则',   tags: ['listing', '平台规则'] },
  { file: 'Listing精造师-术语库.md',              category: 'Listing精造师/术语',   tags: ['listing', '术语'] },
  { file: 'Listing精造师-高分样例库.md',          category: 'Listing精造师/样例',   tags: ['listing', '样例'] },
  { file: 'Listing精造师-智能体提示词.md',        category: 'Listing精造师/智能体', tags: ['listing', '提示词'] },
  // 运维
  { file: '安装指南.md',                          category: '运维/安装',           tags: ['安装', '指南'] }
]

async function main() {
  const env = await loadEnv()
  const BASE = env.MAXKB_BASE_URL
  const KB = env.MAXKB_KNOWLEDGE_DATASETS.split(',')[0]  // 跨境运营知识库
  void KB

  // ─── 3. 登录 admin ─────────────────────────────────────
  const loginRes = await fetch(`${BASE}/admin/api/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: env.MAXKB_ADMIN_PASSWORD || '' })
  })
  const ADMIN_TOKEN = (await loginRes.json()).data.token
  const H = { Authorization: `Bearer ${ADMIN_TOKEN}` }

  // ─── 4. 拉 KB 现有 doc（用于幂等跳过）────────────────────
  const existList = (await (await fetch(`${BASE}/admin/api/workspace/default/knowledge/${KB}/document?page=1&page_size=100`, { headers: H })).json()).data || []
  const existNames = new Set(existList.map((d: { name: string }) => d.name))
  console.log(`[migrate] KB 现有 ${existList.length} 份文档`)
  for (const d of existList) console.log(`  · ${(d as { name: string }).name}`)

  // ─── 5. 逐份上传（缺则补；存在则跳过）────────────────
  const report = { started_at: new Date().toISOString(), base_url: BASE, kb_id: KB, results: [] as Array<Record<string, unknown>> }
  let okCount = 0, skipCount = 0, failCount = 0
  for (const item of MIGRATION_PLAN) {
    const filePath = path.join(ROOT, 'docs', item.file)
    if (existNames.has(item.file)) {
      console.log(`  [skip] ${item.file}（已存在）`)
      skipCount += 1
      report.results.push({ file: item.file, status: 'skip', reason: 'already exists' })
      continue
    }
    let content: string
    try {
      content = await fsp.readFile(filePath, 'utf8')
    } catch (e) {
      console.log(`  [fail] ${item.file} 读取失败：${(e as Error).message}`)
      failCount += 1
      report.results.push({ file: item.file, status: 'fail', reason: `read error: ${(e as Error).message}` })
      continue
    }
    if (content.length < 50) {
      console.log(`  [fail] ${item.file} 内容过短（${content.length} 字符）`)
      failCount += 1
      report.results.push({ file: item.file, status: 'fail', reason: 'content too short' })
      continue
    }
    const t0 = Date.now()
    const res = await fetch(`${BASE}/admin/api/workspace/default/knowledge/${KB}/document`, {
      method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: item.file,
        content,
        meta: { category: item.category, tags: item.tags || [], source: 'docs/migration-2026-08' }
      })
    })
    const body = await res.json()
    const elapsed = Date.now() - t0
    if (body?.code === 200) {
      console.log(`  [ok] ${item.file} → ${body.data?.id} (${elapsed}ms, ${(content.length / 1024).toFixed(1)}KB)`)
      okCount += 1
      report.results.push({ file: item.file, status: 'ok', id: body.data?.id, category: item.category, size_kb: +(content.length / 1024).toFixed(1), elapsed_ms: elapsed })
    } else {
      console.log(`  [fail] ${item.file} ${res.status} ${body?.code} ${body?.message}`)
      failCount += 1
      report.results.push({ file: item.file, status: 'fail', http: res.status, code: body?.code, message: body?.message })
    }
    // 避免压垮 MaxKB
    await new Promise(r => setTimeout(r, 200))
  }

  // ─── 6. 验证：拉一次 list 看 meta.category 持久化 ─────
  console.log('\n[migrate] 等 5 秒后验证 meta.category 持久化...')
  await new Promise(r => setTimeout(r, 5000))
  const verifyList = (await (await fetch(`${BASE}/admin/api/workspace/default/knowledge/${KB}/document?page=1&page_size=100`, { headers: H })).json()).data || []
  const verifyByCategory: Record<string, number> = {}
  for (const d of verifyList) {
    const cat = (d as { meta?: { category?: string } }).meta?.category || '(no-category)'
    verifyByCategory[cat] = (verifyByCategory[cat] || 0) + 1
  }
  console.log('[migrate] 按 category 分布：')
  for (const [cat, n] of Object.entries(verifyByCategory)) console.log(`  · ${cat}: ${n}`)

  report.finished_at = new Date().toISOString()
  report.summary = { total: MIGRATION_PLAN.length, ok: okCount, skip: skipCount, fail: failCount, by_category: verifyByCategory, total_kb_docs: verifyList.length }
  await fsp.writeFile(REPORT_FILE, JSON.stringify(report, null, 2), 'utf8')
  console.log(`\n[migrate] 报告：${REPORT_FILE}`)
  console.log(`[migrate] ${okCount} ok / ${skipCount} skip / ${failCount} fail (计划 ${MIGRATION_PLAN.length} 份)`)
  process.exit(failCount > 0 ? 1 : 0)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(2) })
