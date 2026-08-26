#!/usr/bin/env node
/**
 * 阶段 1.6 验证：GraphRagAdapter 端到端（mock source）
 * - 注入模拟的 4 个 doc，验证 build/expand/stats
 * - 不依赖 Electron，纯 Node 跑（GraphRagAdapter 用 mock 替代 app.getPath）
 */
import { GraphRagAdapter } from '../src/main/services/GraphRagAdapter.ts'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const TMP_INDEX = path.join('/tmp', 'maxkb-graph-test-' + Date.now() + '.json')
const REPORT_FILE = path.join(__dirname, 'verify-graph-rag-report.json')

// mock source：4 份选品方法论片段（仿真跨境运营知识库 + 试点库）
const mockDocs = {
  'kb-cross-border': [
    { id: 'doc-001', name: '选品方法论 v1.3.md', meta: { category: '方法论' }, text: '选品方法论 v1.3 包含五个维度：需求验证、竞争分析、利润核算、合规审查、流量策略。每个维度都有量化指标。需求验证要看月搜索量与转化率，竞争分析看 Top 10 卖家的集中度。' },
    { id: 'doc-002', name: '苦苹果防咬喷雾.md', meta: { category: '案例' }, text: '苦苹果防咬喷雾是宠物训练用品，需求验证显示月搜索量 2.1 万，竞争分析显示前 5 卖家占据 67% 份额。合规审查关注宠物接触安全。' },
    { id: 'doc-003', name: '宠物美容刷.md', meta: { category: '案例' }, text: '宠物美容刷属于美容护理品类，需求验证月搜索 5.8 万，竞争分析中档卖家分布。利润核算需考虑刷毛材质成本。流量策略推荐宠物视频内容。' },
    { id: 'doc-004', name: '亚马逊宠物用品评估表.md', meta: { category: '方法论' }, text: '亚马逊宠物用品评估表包括 5 个维度：需求验证、竞争分析、利润核算、合规审查、流量策略。每个维度有量化指标，用于批量评估宠物类选品。' }
  ]
}

const mockSource = {
  async listDocs(kbId) {
    return { docs: (mockDocs[kbId] || []).map(d => ({ id: d.id, name: d.name, meta: d.meta })) }
  },
  async fetchDocContent(kbId, docId) {
    return (mockDocs[kbId] || []).find(d => d.id === docId)?.text || ''
  }
}

const report = { started_at: new Date().toISOString(), checks: [] }
function check(name, status, detail) {
  report.checks.push({ name, status, detail })
  console.log(`[${status === 'pass' ? '✓' : '✗'}] ${name}: ${JSON.stringify(detail).slice(0, 250)}`)
}

async function main() {
  // ─── 1. build 索引 ────────────────────────────────────────────────
  const adapter = new GraphRagAdapter(mockSource, ['kb-cross-border'])
  // stub index path 写到 /tmp（避免依赖 electron）
  adapter.indexPath = () => TMP_INDEX

  const idx = await adapter.getIndex()
  check('build-index', idx.chunkCount > 0 && Object.keys(idx.nodes).length > 0 ? 'pass' : 'fail', {
    docCount: idx.docCount,
    chunkCount: idx.chunkCount,
    termCount: Object.keys(idx.nodes).length,
    sample_terms: Object.keys(idx.nodes).slice(0, 10)
  })

  // ─── 2. stats ───────────────────────────────────────────────────
  const stats = await adapter.stats()
  check('stats', stats.termCount > 10 ? 'pass' : 'fail', stats)

  // ─── 3. expand 测试 1：命中种子词 ─────────────────────────────
  const result1 = await adapter.expand('选品方法论 v1.3')
  check('expand-seed-terms', result1.length > 0 && result1[0].score > 0 ? 'pass' : 'fail', {
    query: '选品方法论 v1.3',
    top: result1.slice(0, 3).map(r => ({ doc: r.docName, score: r.score.toFixed(3), matched: r.matchedTerms.slice(0, 5) }))
  })

  // ─── 4. expand 测试 2：跨文档共现扩展 ───────────────────────
  const result2 = await adapter.expand('需求验证 竞争分析')
  check('expand-cross-doc', result2.length >= 2 ? 'pass' : 'fail', {
    query: '需求验证 竞争分析',
    docs_hit: Array.from(new Set(result2.map(r => r.docName))),
    top: result2.slice(0, 4).map(r => ({ doc: r.docName, score: r.score.toFixed(3) }))
  })

  // ─── 5. expand 测试 3：hops 扩展（看邻居命中）────────────────
  const result3 = await adapter.expand('苦苹果')
  check('expand-hops-1', result3.some(r => r.matchedTerms.includes('宠物') || r.matchedTerms.includes('训练') || r.matchedTerms.includes('接触')) ? 'pass' : 'fail', {
    query: '苦苹果',
    top_matched_terms: Array.from(new Set(result3.flatMap(r => r.matchedTerms))).slice(0, 10),
    chunks: result3.length
  })

  // ─── 6. 重建索引（验证幂等）──────────────────────────────────
  const idx2 = await adapter.rebuild()
  check('rebuild-idempotent', idx2.docCount === idx.docCount && idx2.chunkCount === idx.chunkCount ? 'pass' : 'fail', {
    before: { docs: idx.docCount, chunks: idx.chunkCount },
    after: { docs: idx2.docCount, chunks: idx2.chunkCount }
  })

  // ─── 7. stopwords 过滤 ───────────────────────────────────────
  const result4 = await adapter.expand('的 了 和 是')  // 全部停用词
  check('stopwords-all-empty', result4.length === 0 ? 'pass' : 'fail', {
    query: '的 了 和 是',
    result_count: result4.length
  })

  // ─── 8. 索引落盘验证 ────────────────────────────────────────
  try {
    const raw = await fsp.readFile(TMP_INDEX, 'utf8')
    const stat = await fsp.stat(TMP_INDEX)
    check('index-persisted', stat.size > 100 ? 'pass' : 'fail', { file: TMP_INDEX, size_bytes: stat.size, keys: Object.keys(JSON.parse(raw)) })
  } catch (e) {
    check('index-persisted', 'fail', { error: (e as Error).message })
  }

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

  // 清理
  try { await fsp.unlink(TMP_INDEX) } catch { /* ignore */ }
  process.exit(report.summary.fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('FATAL:', e)
  process.exit(2)
})
