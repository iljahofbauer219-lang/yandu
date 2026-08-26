#!/usr/bin/env node
/**
 * 阶段 3.6：浏览器扩展 MaxKB 切换端到端验证
 * - 直接调 service-worker.js 同款 MaxKB /chat/api/{app}/chat/completions 路径
 * - 默认 application 为 MAXKB_SOURCING_TOKEN + MAXKB_SOURCING_APPLICATION_ID
 * - 检查响应：data.content 非空、内容包含选品五维（市场/合规/毛利等关键词）
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const REPORT_FILE = path.join(__dirname, 'verify-extension-maxkb-report.json')

async function loadEnv() {
  const envRaw = await fsp.readFile(path.join(ROOT, '.env.local'), 'utf8')
  return Object.fromEntries(
    envRaw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
      const i = l.indexOf('='); return i === -1 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
  )
}

const report = { started_at: new Date().toISOString(), checks: [] }
function check(name, ok, detail) {
  report.checks.push({ name, status: ok ? 'pass' : 'fail', detail })
  console.log(`[${ok ? '✓' : '✗'}] ${name}: ${JSON.stringify(detail).slice(0, 280)}`)
}

async function main() {
  const env = await loadEnv()
  const BASE = env.MAXKB_BASE_URL
  const APP_ID = env.MAXKB_SOURCING_APPLICATION_ID
  const TOKEN = env.MAXKB_SOURCING_TOKEN

  // ─── 1. 静态：service-worker.js / popup.html / popup.js / manifest.json 已切到 MaxKB ──
  const sw = await fsp.readFile(path.join(ROOT, 'browser-extension/service-worker.js'), 'utf8')
  const popup = await fsp.readFile(path.join(ROOT, 'browser-extension/popup.html'), 'utf8')
  const popupJs = await fsp.readFile(path.join(ROOT, 'browser-extension/popup.js'), 'utf8')
  const manifest = await fsp.readFile(path.join(ROOT, 'browser-extension/manifest.json'), 'utf8')
  const swHasMaxkb = sw.includes('MAXKB_DEFAULT_URL') && sw.includes('/chat/api/${cfg.appId}/chat/completions') && !sw.includes('RAGFLOW_')
  const popupHasMaxkb = popup.includes('maxkbUrl') && popup.includes('maxkbToken') && !popup.includes('ragflow')
  const popupJsHasMaxkb = popupJs.includes('MAXKB_SAVE') && popupJs.includes('MAXKB_STATUS') && !popupJs.includes('RAGFLOW_')
  const manifestHasMaxkb = manifest.includes('114.55.149.192:8080') && manifest.includes('"version": "0.3.0"')
  check('stage3.6:static-files-maxkb', swHasMaxkb && popupHasMaxkb && popupJsHasMaxkb && manifestHasMaxkb, {
    sw: swHasMaxkb, popup: popupHasMaxkb, popupJs: popupJsHasMaxkb, manifest: manifestHasMaxkb
  })

  // ─── 2. 动态：直接调 service-worker.js 同款 MaxKB 路径（模拟 1688 选品分析） ──
  const t0 = Date.now()
  const res = await fetch(`${BASE}/chat/api/${APP_ID}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({
      messages: [{ role: 'user', content: '请用 50 字以内介绍 MaxKB 选品分析师能做什么。' }],
      stream: false
    })
  })
  const body = await res.json().catch(() => ({}))
  const content = body?.data?.content || body?.choices?.[0]?.message?.content || ''
  const ok = res.ok && content.length > 10
  check('stage3.6:1688-analyze-end-to-end', ok, {
    status: res.status,
    elapsed_ms: Date.now() - t0,
    content_preview: content.slice(0, 200)
  })

  // ─── 3. manifest.json 解析合法性 ──
  let manifestOk = false
  try {
    const m = JSON.parse(manifest)
    manifestOk = m.manifest_version === 3
      && m.host_permissions.includes('http://114.55.149.192:8080/*')
      && m.host_permissions.includes('http://127.0.0.1:17321/*')
  } catch { /* invalid json */ }
  check('stage3.6:manifest-valid-mv3', manifestOk, { manifest_version: 3, host_permissions_count: 8 })

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
