#!/usr/bin/env node
/**
 * 将零度API（Linduo / api000.com）的生图模型注册进 MaxKB 模型列表（私有模型，TTI 图片生成类型）
 * - 模型：GPT-Image-2 (gpt-image-2) / Nano Banana Pro (nano-banana-pro)
 * - 供应商：model_openai_provider（api000 以 OpenAI 兼容 /v1/images/generations 代理全厂商生图，同 LinduoImageService 链路）
 * - 凭据：api_base=LINDUO_BASE_URL(默认 https://api000.com/v1) + api_key=LINDUO_API_KEY
 * - 幂等：同名 / 同 model_name 已存在则跳过，可重复运行
 * - LINDUO_API_KEY 仅内存使用，不落盘 / 不写日志
 *
 * 运行：node tools/add-maxkb-linduo-image-models.mjs
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const ENV_FILE = path.join(ROOT, '.env.local')

const PROVIDER = 'model_openai_provider'
const MODEL_TYPE = 'TTI'
const MODELS = [
  { display: 'GPT-Image-2', base: 'gpt-image-2' },
  { display: 'Nano Banana Pro', base: 'nano-banana-pro' }
]

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
  const LINDUO_KEY = (env.LINDUO_API_KEY || '').trim()
  const API_BASE = (env.LINDUO_BASE_URL || 'https://api000.com/v1').replace(/\/+$/, '')
  if (!LINDUO_KEY) { console.error('FAIL: .env.local 缺 LINDUO_API_KEY'); process.exit(1) }

  // ─── 1. admin 登录（凭据仅内存；同 verify-maxkb-knowledge.mjs 惯例） ─────
  const loginRes = await fetch(`${BASE}/admin/api/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: process.env.MAXKB_ADMIN_PASSWORD || '' })
  })
  const ADMIN_TOKEN = (await loginRes.json())?.data?.token
  if (!ADMIN_TOKEN) { console.error('FAIL: admin 登录失败'); process.exit(1) }
  const H = { Authorization: `Bearer ${ADMIN_TOKEN}`, 'Content-Type': 'application/json' }

  // ─── 2. 现有模型（幂等去重 + 零改动佐证） ─────────────────────────
  const before = (await (await fetch(`${BASE}/admin/api/workspace/default/model`, { headers: H })).json())?.data || []
  console.log(`BEFORE: 现有 ${before.length} 个模型:`, before.map(m => m.name).join(' / '))

  for (const item of MODELS) {
    const exist = before.find(m => m.name === item.display || m.model_name === item.base)
    if (exist) { console.log(`SKIP: ${item.display} 已存在 id=${exist.id} status=${exist.status}`); continue }

    // ─── 3. 供应商 TTI 表单校验（api_base + api_key） ───────────────
    const formQ = `provider=${PROVIDER}&model_type=${MODEL_TYPE}&model_name=${item.base}`
    const credForm = (await (await fetch(`${BASE}/admin/api/provider/model_form?${formQ}`, { headers: H })).json())?.data || []
    const credFields = credForm.map(f => f.field)
    if (!credFields.includes('api_base') || !credFields.includes('api_key')) {
      console.warn(`WARN: ${item.base} TTI 表单字段不符:`, JSON.stringify(credFields))
      continue
    }

    // ─── 4. 创建模型（私有模型，workspace=default） ─────────────────
    const createRes = await fetch(`${BASE}/admin/api/workspace/default/model`, {
      method: 'POST', headers: H,
      body: JSON.stringify({
        name: item.display,
        model_type: MODEL_TYPE,
        model_name: item.base,
        provider: PROVIDER,
        credential: { api_base: API_BASE, api_key: LINDUO_KEY },
        model_params_form: []
      })
    })
    const createBody = await createRes.json()
    if (createRes.status !== 200 || createBody?.code !== 200) {
      console.warn(`WARN: 创建 ${item.base} 失败 HTTP ${createRes.status}（上游通道可能未开放）:`, JSON.stringify(createBody).slice(0, 300))
      continue
    }
    console.log(`CREATED: ${item.display}`)
  }

  // ─── 5. 验收：模型列表 ─────────────────────────────────────────
  const after = (await (await fetch(`${BASE}/admin/api/workspace/default/model`, { headers: H })).json())?.data || []
  const pending = []
  for (const item of MODELS) {
    const m = after.find(x => x.model_name === item.base)
    if (!m) { pending.push(item.base); console.log(`PENDING: ${item.base} 未注册`); continue }
    console.log(`OK: 模型列表已含 ${m.name} id=${m.id} type=${m.model_type} provider=${m.provider} status=${m.status}`)
  }
  const untouched = before.every(b => after.some(a => a.id === b.id && a.name === b.name && a.model_type === b.model_type))
  console.log(`OK: 现有模型零改动=${untouched}`)
  if (pending.length) { console.log(`PENDING-MODELS: ${pending.join(',')}`); process.exit(1) }
  console.log('ALL REGISTERED')
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1) })
