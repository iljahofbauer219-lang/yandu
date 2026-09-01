/**
 * 将百炼（DashScope）视觉模型 qwen3-vl-plus 注册进 MaxKB 模型列表
 * - 供应商：model_openai_provider（DashScope compatible-mode 走 OpenAI 兼容协议）
 * - 模型类型：IMAGE（视觉模型），供工作流"图片理解"节点使用
 * - 凭据：api_base=VLM_API_BASE(默认 https://dashscope.aliyuncs.com/compatible-mode/v1) + api_key=BAILIAN_API_KEY
 * - 幂等：同名 / 同 model_name 已存在则跳过，可重复运行
 * - API KEY 仅内存使用，不落盘 / 不写日志
 *
 * 运行：node tools/add-maxkb-vision-model.mjs
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(ROOT, '.env.local')

const MODEL_DISPLAY_NAME = '通义千问 Qwen3-VL Plus（视觉）'
const MODEL_BASE_NAME = 'qwen3-vl-plus'
const PROVIDER = 'model_openai_provider'
const MODEL_TYPE = 'IMAGE'

async function loadEnv() {
  const envRaw = await fsp.readFile(ENV_FILE, 'utf8')
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
  const VLM_KEY = (env.BAILIAN_API_KEY || '').trim()
  const API_BASE = (env.VLM_API_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '')
  if (!VLM_KEY) { console.error('FAIL: .env.local 缺 BAILIAN_API_KEY'); process.exit(1) }

  // ─── 1. admin 登录（凭据仅内存；同现有工具脚本惯例） ─────────────
  const loginRes = await fetch(`${BASE}/admin/api/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: env.MAXKB_ADMIN_PASSWORD || '' })
  })
  const ADMIN_TOKEN = (await loginRes.json())?.data?.token
  if (!ADMIN_TOKEN) { console.error('FAIL: admin 登录失败'); process.exit(1) }
  const H = { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' }

  // ─── 2. 幂等检查 ─────────────────────────────────────────────
  const models = (await (await fetch(`${BASE}/admin/api/workspace/default/model`, { headers: H })).json())?.data || []
  const exist = models.find(m => m.name === MODEL_DISPLAY_NAME || m.model_name === MODEL_BASE_NAME)
  if (exist) {
    console.log(`SKIP: 模型已存在 id=${exist.id} name=${exist.name} status=${exist.status}`)
    return
  }

  // ─── 3. 拉取供应商表单（credential 字段 + 默认参数表单） ─────────────
  const formQ = `provider=${PROVIDER}&model_type=${MODEL_TYPE}&model_name=${MODEL_BASE_NAME}`
  const credForm = (await (await fetch(`${BASE}/admin/api/provider/model_form?${formQ}`, { headers: H })).json())?.data || []
  const credFields = credForm.map(f => f.field)
  if (!credFields.includes('api_base') || !credFields.includes('api_key')) {
    console.error('FAIL: OpenAI 供应商表单字段不符:', JSON.stringify(credFields))
    process.exit(1)
  }
  const paramsForm = (await (await fetch(`${BASE}/admin/api/provider/model_params_form?${formQ}`, { headers: H })).json())?.data || []

  // ─── 4. 创建模型（私有模型，workspace=default） ─────────────────
  const createRes = await fetch(`${BASE}/admin/api/workspace/default/model`, {
    method: 'POST', headers: H,
    body: JSON.stringify({
      name: MODEL_DISPLAY_NAME,
      model_type: MODEL_TYPE,
      model_name: MODEL_BASE_NAME,
      provider: PROVIDER,
      credential: { api_base: API_BASE, api_key: VLM_KEY },
      model_params_form: Array.isArray(paramsForm) ? paramsForm : []
    })
  })
  const createBody = await createRes.json()
  if (createRes.status !== 200 || createBody?.code !== 200) {
    console.error(`FAIL: 创建模型 HTTP ${createRes.status}:`, JSON.stringify(createBody).slice(0, 500))
    process.exit(1)
  }
  console.log('CREATED:', JSON.stringify(createBody?.data ?? createBody).slice(0, 300))

  // ─── 5. 验收：模型列表 + 工作流可选下拉 ─────────────────────────
  const after = (await (await fetch(`${BASE}/admin/api/workspace/default/model`, { headers: H })).json())?.data || []
  const created = after.find(m => m.model_name === MODEL_BASE_NAME)
  if (!created) { console.error('FAIL: 创建后模型列表未找到新模型'); process.exit(1) }
  console.log(`OK: 模型列表已含 ${created.name} id=${created.id} type=${created.model_type} provider=${created.provider} status=${created.status}`)
  const selectList = await (await fetch(`${BASE}/admin/api/workspace/default/model_list?model_type=IMAGE`, { headers: H })).json()
  const inSelect = JSON.stringify(selectList).includes(MODEL_BASE_NAME)
  console.log(`OK: 视觉模型下拉(model_list?model_type=IMAGE) 可见=${inSelect}`)

  // ─── 6. 上游连通性 ping（直连 DashScope，不经过 MaxKB；失败仅告警） ─
  try {
    const ping = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${VLM_KEY}` },
      body: JSON.stringify({
        model: MODEL_BASE_NAME,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'ping, 返回 OK 即可' }] }],
        max_tokens: 8
      })
    })
    const pingBody = await ping.text()
    console.log(`PING DashScope ${MODEL_BASE_NAME}: HTTP ${ping.status} ${pingBody.slice(0, 200)}`)
  } catch (e) {
    console.warn('WARN: 上游 ping 失败（不影响 MaxKB 注册）:', e.message)
  }
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
