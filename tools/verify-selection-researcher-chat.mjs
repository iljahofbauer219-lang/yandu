/**
 * 选品调研员Agent 联调验收（admin 调试对话 API，不依赖浏览器）
 * - 开启调试对话：GET  /admin/api/workspace/default/application/{app}/open（debug 会话）
 * - 发送消息：    POST /admin/api/chat_message/{chat_id}（stream，SSE 事件含逐节点状态；form_data 全局变量）
 * - 节点明细：    直接解析 SSE 事件（调试对话不落库，chat_record 为空）
 *
 * 用法：
 *   node tools/verify-selection-researcher-chat.mjs negative   # 负例（闲聊）
 *   node tools/verify-selection-researcher-chat.mjs lack       # 要素不足
 *   node tools/verify-selection-researcher-chat.mjs link       # 正例（1688链接）
 *   node tools/verify-selection-researcher-chat.mjs image <图片URL或本地路径>  # 仅图片
 */
import crypto from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const APP_ID = '01a043e0-d19b-7f20-8420-cfe8dad604a0'
const LUNA = { model_id: '01a043ee-be22-7e62-bd37-9617379ebb15', provider: 'model_openai_provider', model_name: 'gpt-5.6-luna', model_params_setting: { max_tokens: 60000, temperature: 0.3 } }

const SCENARIOS = {
  negative: '你好，今天天气怎么样？',
  lack: '帮我选品',
  link: '帮我调研这款产品能不能上亚马逊美国站：https://detail.1688.com/offer/810223061783.html',
}

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
  const scenario = process.argv[2] || 'negative'
  const extraArg = process.argv[3]
  if (!SCENARIOS[scenario] && scenario !== 'image') {
    console.error('用法：verify-selection-researcher-chat.mjs <negative|lack|link|image <图片URL>>')
    process.exit(1)
  }
  const message = scenario === 'image' ? '这是一款不锈钢保温杯的产品图片，请调研图中产品在亚马逊美国站的入市机会' : SCENARIOS[scenario]
  let imageList = []
  if (scenario === 'image') {
    if (extraArg && /^https?:\/\//.test(extraArg)) {
      imageList = [{ url: extraArg }]
    } else if (extraArg) {
      // 本地图片 → 先上传到 MaxKB OSS，再以 file_id 传入
      imageList = [{ __upload_local: extraArg }]
    } else {
      console.error('用法：image <图片URL或本地路径>'); process.exit(1)
    }
  }

  const env = await loadEnv()
  const BASE = (env.MAXKB_BASE_URL || 'http://114.55.149.192:8080').replace(/\/+$/, '')

  // 1. 登录
  const loginRes = await fetch(`${BASE}/admin/api/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.MAXKB_ADMIN_PASSWORD || '' })
  })
  const TOKEN = (await loginRes.json())?.data?.token
  if (!TOKEN) { console.error('FAIL: 登录失败'); process.exit(1) }
  const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }

  // 2. 应用访问令牌（仅记录；注意：access_token 无法通过 /chat/api/oss/file 认证（401），
  //    HTML 上传必须用 admin TOKEN，故下方 upload_headers 固定用 TOKEN）
  const tokRes = await (await fetch(`${BASE}/admin/api/workspace/default/application/${APP_ID}/access_token`, { headers: H })).json()
  const APP_TOKEN = tokRes?.data?.access_token || ''
  console.log('access_token:', APP_TOKEN ? 'OK（不用于上传）' : 'WARN 未取到')

  // 3. 开启调试对话（GET open → 服务端创建 debug 会话缓存）
  const openRes = await fetch(`${BASE}/admin/api/workspace/default/application/${APP_ID}/open`, { headers: H })
  const openBody = await openRes.json().catch(() => null)
  console.log(`开启对话: HTTP ${openRes.status}`, JSON.stringify(openBody).slice(0, 200))
  const chatId = typeof openBody?.data === 'string' ? openBody.data : (openBody?.data?.chat_id || openBody?.data?.id)
  if (openRes.status !== 200 || openBody?.code !== 200 || !chatId) process.exit(1)
  console.log('chat_id:', chatId)

  // 3.5 本地图片上传（admin token → /chat/api/oss/file，返回 url，末段即 file_id）
  for (let i = 0; i < imageList.length; i++) {
    const it = imageList[i]
    if (!it.__upload_local) continue
    const buf = await fsp.readFile(it.__upload_local)
    const fd = new FormData()
    fd.append('file', new Blob([buf]), path.basename(it.__upload_local))
    const upRes = await fetch(`${BASE}/chat/api/oss/file`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: fd,
    })
    const upBody = await upRes.json().catch(() => null)
    const fileUrl = typeof upBody?.data === 'string' ? upBody.data : ''
    if (upRes.status !== 200 || !fileUrl) {
      console.error('FAIL: 图片上传失败', JSON.stringify(upBody).slice(0, 300)); process.exit(1)
    }
    const fileId = fileUrl.split('/').pop()
    imageList[i] = { file_id: fileId }
    console.log(`图片已上传: file_id=${fileId}`)
  }

  // 4. 发送消息（流式，逐节点状态事件；长超时）
  const body = {
    message, stream: true, re_chat: false,
    form_data: {
      model: LUNA,
      upload_url: BASE,
      upload_headers: TOKEN, // /chat/api/oss/file 只认 admin/用户 token，access_token 会 401
    },
    image_list: imageList,
  }
  console.log(`\n场景: ${scenario}\n消息: ${message}${imageList.length ? `\n图片: ${JSON.stringify(imageList[0])}` : ''}\n执行中（完整调研可能需 3-8 分钟）…\n`)
  const t0 = Date.now()
  const chatRes = await fetch(`${BASE}/admin/api/chat_message/${chatId}`, {
    method: 'POST', headers: H, body: JSON.stringify(body),
    signal: AbortSignal.timeout(15 * 60 * 1000),
  })
  // 增量读取流式响应：连接中断也保留已收到的事件（落盘便于诊断）
  const events = []
  let buffer = ''
  const parseLine = line => {
    const m = line.match(/^data: (.+)$/)
    if (!m) return
    try { events.push(JSON.parse(m[1])) } catch { /* 忽略半包 */ }
  }
  let streamBroken = false
  try {
    for await (const chunk of chatRes.body) {
      buffer += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        parseLine(buffer.slice(0, idx).trim())
        buffer = buffer.slice(idx + 1)
      }
    }
  } catch (e) {
    streamBroken = true
    console.warn(`WARN: 流式连接中断（${e.message}），已收到 ${events.length} 条事件，继续解析…`)
  }
  console.log(`回答: HTTP ${chatRes.status} 耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s${streamBroken ? '（流中断）' : ''}`)
  const nodeLast = new Map()
  const replyContent = new Map()
  for (const ev of events) {
    const key = ev.real_node_id || ev.node_id
    nodeLast.set(key, ev)
    if (ev.content) replyContent.set(key, (replyContent.get(key) || '') + ev.content)
  }
  const finalEvent = [...events].reverse().find(e => e.is_end) || events[events.length - 1]
  let answer = replyContent.get(finalEvent?.real_node_id || finalEvent?.node_id)
    || finalEvent?.content
    || [...replyContent.values()].pop()
    || (streamBroken ? '（流中断，未收到最终回答）' : '')
  console.log('──── 最终回答（前 800 字）────')
  console.log(String(answer).slice(0, 800))

  // 5. 节点执行明细（来自流式事件，调试模式不落库）
  console.log('\n──── 节点执行明细 ────')
  for (const ev of nodeLast.values()) {
    console.log(`${String(ev.node_status || '?').padEnd(10)} | ${ev.node_type || '?'} | ${ev.node_name || ev.node_id}`)
  }
  const out = path.join(ROOT, `.tmp-verify-chat-${scenario}.json`)
  await fsp.writeFile(out, JSON.stringify({ message, imageList, streamBroken, nodes: [...nodeLast.values()], answer, rawEvents: events }, null, 2))
  console.log(`\n完整结果已存: ${out}`)
  if (streamBroken) process.exit(2)
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
