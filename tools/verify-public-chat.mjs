// 公共频道冒烟测试：模拟发布页（/chat/<access_token>/）匿名访问链路
// 用法: node tools/verify-public-chat.mjs
import fs from 'node:fs'

const envRaw = fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
const env = Object.fromEntries(
  envRaw.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] })
)
const BASE = (env.MAXKB_BASE_URL || 'http://114.55.149.192:8080').replace(/\/+$/, '')
const ACCESS_TOKEN = '405fd4d4eb425d0f'

const t0 = Date.now()
// 1. 匿名认证
const auth = await (await fetch(`${BASE}/chat/api/auth/anonymous`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ access_token: ACCESS_TOKEN })
})).json()
if (auth.code !== 200) { console.error('auth failed', auth); process.exit(1) }
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + auth.data }

// 2. 打开会话
const open = await (await fetch(`${BASE}/chat/api/open`, { method: 'GET', headers: H })).json()
if (open.code !== 200) { console.error('open failed', open); process.exit(1) }
const chatId = open.data?.id || open.data?.chat_id || open.data
console.log('chat_id:', chatId)

// 3. 发送 1688 链接消息（SSE）
const msg = '帮我调研这个1688商品在亚马逊美国站的机会：https://detail.1688.com/offer/1063181641931.html'
const res = await fetch(`${BASE}/chat/api/chat_message/${chatId}`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ message: msg, stream: true, re_chat: false, form_data: {}, image_list: [] })
})
console.log('chat_message status:', res.status)
const reader = res.body.getReader()
const dec = new TextDecoder()
let buf = '', answer = '', nodes = new Map(), broken = false
while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  let idx
  while ((idx = buf.indexOf('\n\n')) !== -1) {
    const raw = buf.slice(0, idx); buf = buf.slice(idx + 2)
    for (const line of raw.split('\n')) {
      if (!line.startsWith('data:')) continue
      try {
        const ev = JSON.parse(line.slice(5))
        if (ev.node_view_type || ev.name || ev.node_id) {
          const key = ev.node_id || ev.name
          if (key) nodes.set(key, { name: ev.name || ev.node_name || key, status: ev.status || ev.node_status, runTime: ev.run_time })
        }
        if (ev.event === 'message' || ev.content !== undefined && ev.chat_id) answer += ev.content || ''
        if (ev.is_stop) broken = true
      } catch {}
    }
  }
}
const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log('elapsed:', secs + 's')
for (const [k, v] of nodes) console.log(' -', v.name, '|', v.status)
console.log('answer head:', answer.slice(0, 300).replace(/\n+/g, ' '))
// 呈现模式断言：正文内嵌 + Word/HTML 双下载链接非空
const wordM = answer.match(/\[下载 Word 版（\.doc）\]\((https?:\/\/[^)\s]+)\)/)
const htmlM = answer.match(/\[下载 HTML 版（\.html）\]\((https?:\/\/[^)\s]+)\)/)
console.log('word link:', wordM ? wordM[1] : '(none)')
console.log('html link:', htmlM ? htmlM[1] : '(none)')
let fail = false
const assert = (name, ok) => { console.log(`${ok ? 'OK ' : 'FAIL'}: ${name}`); if (!ok) fail = true }
assert('正文内嵌（含“第一部分”且长度>3000）', answer.includes('第一部分') && answer.length > 3000)
assert('含双下载链接文案', answer.includes('下载 Word 版') && answer.includes('下载 HTML 版'))
assert('Word 链接非空', !!wordM)
assert('HTML 链接非空', !!htmlM)
assert('无空 href 链接', !answer.includes(']()'))
for (const [name, url] of [['Word', wordM?.[1]], ['HTML', htmlM?.[1]]]) {
  if (!url) continue
  const hr = await fetch(url, { method: 'HEAD' })
  const disp = hr.headers.get('content-disposition') || ''
  assert(`${name} 链接可下载（200+attachment）`, hr.status === 200 && disp.includes('attachment'))
  console.log(`   ${name}:`, hr.status, disp.slice(0, 90))
}
fs.writeFileSync('.tmp-smoke-public-out.json', JSON.stringify({ secs, nodes: [...nodes.values()], answerLen: answer.length, word: wordM?.[1] || null, html: htmlM?.[1] || null }, null, 2))
if (fail) { console.error('SMOKE FAIL'); process.exit(1) }
console.log('SMOKE ALL PASS')
