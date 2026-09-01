#!/usr/bin/env node
/**
 * 探针：MaxKB doc upload/delete API 端到端
 */
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
async function loadEnv() {
  const envRaw = await fsp.readFile(path.join(ROOT, '.env.local'), 'utf8')
  return Object.fromEntries(
    envRaw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => {
      const i = l.indexOf('='); return i === -1 ? [l, ''] : [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    })
  )
}

async function main() {
  const env = await loadEnv()
  const BASE = env.MAXKB_BASE_URL
  const PASSWORD = env.MAXKB_ADMIN_PASSWORD || ''
  const KB = '01a00117-e215-7e90-b6ed-e782da8ddbb1'
  const loginRes = await fetch(`${BASE}/admin/api/user/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: PASSWORD })
  })
  const ADMIN_TOKEN = (await loginRes.json()).data.token
  const H = { Authorization: `Bearer ${ADMIN_TOKEN}` }

  // 1) 看下 doc list
  console.log('--- 现有 doc ---')
  const listRes = await fetch(`${BASE}/admin/api/workspace/default/knowledge/${KB}/document?page=1&page_size=20`, { headers: H })
  const list = (await listRes.json()).data || []
  for (const d of list) console.log(`  - ${d.id} | ${d.name} | status=${d.status || d.type}`)

  // 2) POST 一个测试 doc
  console.log('\n--- POST 新 doc (with content + meta) ---')
  const testContent = '# 测试文档\n\n这是一个测试内容。包含分类为 test-category。'
  const createRes = await fetch(`${BASE}/admin/api/workspace/default/knowledge/${KB}/document`, {
    method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '__probe__.md', content: testContent, meta: { category: 'probe' } })
  })
  const createBody = await createRes.json()
  console.log(`HTTP: ${createRes.status}, code: ${createBody?.code}, msg: ${createBody?.message}`)
  const newId = createBody?.data?.id
  console.log(`new doc id: ${newId}`)

  if (newId) {
    // 3) GET 回读
    console.log('\n--- GET 回读 ---')
    const getRes = await fetch(`${BASE}/admin/api/workspace/default/knowledge/${KB}/document/${newId}`, { headers: H })
    const got = (await getRes.json()).data
    console.log(`name=${got?.name}, status=${got?.status}, meta=${JSON.stringify(got?.meta)}`)
    console.log(`content_len=${got?.content?.length || 'no content field'}`)

    // 4) 等 3 秒看是否进入 nnn2
    console.log('\n--- 等 3 秒 ---')
    await new Promise(r => setTimeout(r, 3000))
    const getRes2 = await fetch(`${BASE}/admin/api/workspace/default/knowledge/${KB}/document/${newId}`, { headers: H })
    const got2 = (await getRes2.json()).data
    console.log(`status=${got2?.status}, status_msg=${got2?.status_msg}`)

    // 5) DELETE 清理
    console.log('\n--- DELETE 清理 ---')
    const delRes = await fetch(`${BASE}/admin/api/workspace/default/knowledge/${KB}/document/${newId}`, { method: 'DELETE', headers: H })
    const delBody = await delRes.json()
    console.log(`HTTP: ${delRes.status}, code: ${delBody?.code}, msg: ${delBody?.message}`)
  }
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
