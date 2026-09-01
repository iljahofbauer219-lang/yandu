/**
 * 临时探针：独立最小工作流验证 Markdown转HTML 工具的 result 结构
 * - 复用线上工具节点（md_text/filename 改静态输入）
 * - 最终回复直接输出整个 result，看引擎实际暴露的字段
 * 跑完自动删除探针应用。
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const APP_ID = '01a043e0-d19b-7f20-8420-cfe8dad604a0'

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
    body: JSON.stringify({ username: 'admin', password: env.MAXKB_ADMIN_PASSWORD || '' })
  })
  const TOKEN = (await loginRes.json())?.data?.token
  const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

  const app = (await (await fetch(`${BASE}/admin/api/workspace/default/application/${APP_ID}`, { headers: H })).json()).data
  const FOLDER = app.folder?.id || app.folder

  // 清理上一轮残留探针（按名称）
  const list = (await (await fetch(`${BASE}/admin/api/workspace/default/application?folder_id=${FOLDER}&page=1&limit=100`, { headers: H })).json())?.data
  for (const a of list?.records || list || []) {
    if (a?.name === '探针-MD转HTML' && a.id) {
      await fetch(`${BASE}/admin/api/workspace/default/application/${a.id}`, { method: 'DELETE', headers: H })
      console.log('清理残留探针:', a.id)
    }
  }

  const toolNode = JSON.parse(JSON.stringify(app.work_flow.nodes.find(n => n.id === 'fa51d6bc-a3e2-4c67-b89a-f174ee33bda2')))
  const baseNode = JSON.parse(JSON.stringify(app.work_flow.nodes.find(n => n.id === 'base-node')))
  for (const f of toolNode.properties.node_data.input_field_list) {
    if (f.name === 'md_text') { f.source = 'custom'; f.value = '# 探针报告标题\n## 第一节\n- 内容 A\n- 内容 B' }
    if (f.name === 'filename') { f.source = 'custom'; f.value = '探针测试' }
  }
  toolNode.x = 800; toolNode.y = 400
  const startNode = { id: 'probe-start', type: 'start-node', x: 100, y: 400, properties: { stepName: '开始', node_data: { api_input_field_list: [], user_input_field_list: [], file_upload_enable: false }, config: { fields: [] } } }
  // 探针回复：复制线上回复节点的完整 node_data 结构（含 reply_type 等必填字段），仅换内容
  const replyTpl = JSON.parse(JSON.stringify(app.work_flow.nodes.find(n => n.type === 'reply-node')))
  const replyNode = { id: 'probe-reply', type: 'reply-node', x: 1500, y: 400, properties: { ...replyTpl.properties, stepName: '探针回复' } }
  replyNode.properties.node_data.content = 'RESULT_START\n{{Markdown转HTML工具（深度报告）.result}}\nRESULT_END'
  const probe = {
    name: '探针-MD转HTML', desc: '临时诊断', type: 'WORK_FLOW', icon: 'app', folder_id: FOLDER,
    prologue: '', model_setting: { prompt: '', system: '', no_references_prompt: '' },
    knowledge_setting: { top_n: 5, similarity: 0.3, search_mode: 'blend', max_paragraph_char_number: 3000, no_references_setting: { status: 'designated_answer', value: '' } },
    work_flow: {
      nodes: [baseNode, startNode, toolNode, replyNode],
      edges: [
        { id: 'pe1', sourceNodeId: 'base-node', targetNodeId: 'probe-start', sourceAnchorId: 'base-node_right', targetAnchorId: 'probe-start_left' },
        { id: 'pe2', sourceNodeId: 'probe-start', targetNodeId: toolNode.id, sourceAnchorId: 'probe-start_right', targetAnchorId: toolNode.id + '_left' },
        { id: 'pe3', sourceNodeId: toolNode.id, targetNodeId: 'probe-reply', sourceAnchorId: toolNode.id + '_right', targetAnchorId: 'probe-reply_left' },
      ],
      global_variable: [],
    },
  }
  const cj = await (await fetch(`${BASE}/admin/api/workspace/default/application`, { method: 'POST', headers: H, body: JSON.stringify(probe) })).json()
  const probeId = cj?.data?.id
  if (!probeId) { console.error('创建失败', JSON.stringify(cj).slice(0, 300)); process.exit(1) }
  console.log('探针已创建:', probeId)

  try {
    const chatId = (await (await fetch(`${BASE}/admin/api/workspace/default/application/${probeId}/open`, { headers: H })).json())?.data
    const body = {
      message: 'run', stream: true, re_chat: false,
      form_data: {
        model: { model_id: '01a000f4-9bde-7e40-84e3-4e2f8867e2ab', provider: 'aliyun_bai_lian_model_provider', model_name: 'qwen3.6-flash', model_params_setting: { max_tokens: 4000, temperature: 0.2 } },
        upload_url: BASE,
        upload_headers: TOKEN, // access_token 无法通过 /chat/api/oss/file 认证（401），必须用 admin TOKEN
      },
      image_list: [],
    }
    const res = await fetch(`${BASE}/admin/api/chat_message/${chatId}`, {
      method: 'POST', headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(120000),
    })
    let buffer = '', answer = ''
    try {
      for await (const chunk of res.body) {
        buffer += Buffer.from(chunk).toString('utf8')
        let idx
        while ((idx = buffer.indexOf('\n')) >= 0) {
          const m = buffer.slice(0, idx).trim().match(/^data: (.+)$/)
          if (m) { try { const e = JSON.parse(m[1]); if (e.content) answer += e.content } catch { } }
          buffer = buffer.slice(idx + 1)
        }
      }
    } catch (e) { console.warn('WARN: 流中断', e.message) }
    console.log('HTTP', res.status)
    console.log(answer.slice(0, 2000))
  } finally {
    const del = await fetch(`${BASE}/admin/api/workspace/default/application/${probeId}`, { method: 'DELETE', headers: H })
    console.log('清理探针:', del.status)
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
