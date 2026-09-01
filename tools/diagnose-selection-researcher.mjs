/**
 * 诊断：定位 5 路并行调研节点中抛异常的那一个
 * 原理：临时把 5 个节点的 enableException 关掉 → 异常时会以
 *       'Exception: ...' 文本 + node_status=ERROR 推入 SSE；跑完立即恢复原配置。
 * 运行：node tools/diagnose-selection-researcher.mjs
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const APP_ID = '01a043e0-d19b-7f20-8420-cfe8dad604a0'
const FIVE = ['sel-image-node', 'sel-knowledge-node', 'sel-1688-tool-node', '0bca4262-325b-4823-8839-d7245ecf8432', 'sel-amazon-node']

async function loadEnv() {
  const envRaw = await fsp.readFile(path.join(ROOT, '.env.local'), 'utf8')
  return Object.fromEntries(
    envRaw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
      const i = l.indexOf('=')
      return i === -1 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
  )
}

async function main() {
  const env = await loadEnv()
  const BASE = (env.MAXKB_BASE_URL || 'http://114.55.149.192:8080').replace(/\/+$/, '')
  const loginRes = await fetch(`${BASE}/admin/api/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.MAXKB_ADMIN_PASSWORD || '' })
  })
  const TOKEN = (await loginRes.json())?.data?.token
  if (!TOKEN) { console.error('FAIL: 登录失败'); process.exit(1) }
  const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

  // 1. 备份并临时关闭异常保护
  const appRes = await fetch(`${BASE}/admin/api/workspace/default/application/${APP_ID}`, { headers: H })
  const app = (await appRes.json()).data
  await fsp.writeFile(path.join(ROOT, '.tmp-diagnose-backup.json'), JSON.stringify(app, null, 2))
  for (const id of FIVE) {
    const n = app.work_flow.nodes.find(x => x.id === id)
    n.properties.enableException = false
  }
  if (!app.knowledge_setting || app.knowledge_setting.top_n == null) {
    app.knowledge_setting = { top_n: 5, similarity: 0.3, search_mode: 'blend', max_paragraph_char_number: 3000, no_references_setting: { status: 'designated_answer', value: '当前知识库未找到相关内容，以下回答基于模型知识。' } }
  }
  if (!app.model_setting || app.model_setting.no_references_prompt == null) app.model_setting = { prompt: '', system: '', no_references_prompt: '' }
  const putRes = await fetch(`${BASE}/admin/api/workspace/default/application/${APP_ID}`, { method: 'PUT', headers: H, body: JSON.stringify(app) })
  if ((await putRes.json())?.code !== 200) { console.error('FAIL: 临时写入失败'); process.exit(1) }
  console.log('OK: 已临时关闭 5 节点异常保护（备份 .tmp-diagnose-backup.json）')

  try {
    // 2. 跑一轮正例
    const openBody = await (await fetch(`${BASE}/admin/api/workspace/default/application/${APP_ID}/open`, { headers: H })).json()
    const chatId = openBody?.data
    const body = {
      message: '帮我调研这款产品能不能上亚马逊美国站：https://detail.1688.com/offer/810223061783.html',
      stream: true, re_chat: false,
      form_data: { model: { model_id: '01a043ee-be22-7e62-bd37-9617379ebb15', provider: 'model_openai_provider', model_name: 'gpt-5.6-luna', model_params_setting: { max_tokens: 60000, temperature: 0.3 } }, upload_url: BASE, upload_headers: TOKEN },
      image_list: [],
    }
    console.log('执行诊断对话（可能 3-8 分钟）…')
    const res = await fetch(`${BASE}/admin/api/chat_message/${chatId}`, {
      method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(15 * 60 * 1000),
    })
    let buffer = ''
    const events = []
    try {
      for await (const chunk of res.body) {
        buffer += Buffer.from(chunk).toString('utf8')
        let idx
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const m = buffer.slice(0, idx).trim().match(/^data: (.+)$/)
          if (m) { try { events.push(JSON.parse(m[1])) } catch {} }
          buffer = buffer.slice(idx + 1)
        }
      }
    } catch (e) { console.warn('WARN: 流中断', e.message) }

    // 3. 输出 ERROR 节点与异常消息
    console.log('\n──── 异常定位 ────')
    let found = false
    for (const ev of events) {
      if (ev.node_status === 'ERROR' || (ev.content || '').startsWith('Exception')) {
        found = true
        console.log(`节点: ${ev.node_name || ev.node_id} (${ev.node_type})`)
        console.log(`异常: ${(ev.content || '').slice(0, 600)}`)
      }
    }
    if (!found) console.log('本轮未见 ERROR 事件（可能 429 已恢复或异常仍在被吞）')
    const nodeLast = new Map()
    for (const ev of events) nodeLast.set(ev.real_node_id || ev.node_id, ev)
    console.log('\n──── 节点状态 ────')
    for (const ev of nodeLast.values()) console.log(`${String(ev.node_status || '?').padEnd(10)} | ${ev.node_type || '?'} | ${ev.node_name || ev.node_id}`)
    await fsp.writeFile(path.join(ROOT, '.tmp-diagnose-events.json'), JSON.stringify(events, null, 2))
  } finally {
    // 4. 恢复
    const backup = JSON.parse(await fsp.readFile(path.join(ROOT, '.tmp-diagnose-backup.json'), 'utf8'))
    const r = await fetch(`${BASE}/admin/api/workspace/default/application/${APP_ID}`, { method: 'PUT', headers: H, body: JSON.stringify(backup) })
    console.log(`\n恢复原配置: HTTP ${r.status} code=${(await r.json())?.code}`)
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
