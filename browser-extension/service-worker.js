// 砚都跨境采集助手 service worker（阶段 3.6 切到 MaxKB）
// - 阶段 3.6：1688 AI 选品分析从 RAGFlow 切到 MaxKB v2.10.5-lts CE
//   - 默认服务地址：远端中央 MaxKB 8080（与桌面端 .env.local 一致）
//   - 默认智能体：sourcing 选品分析师（MAXKB_SOURCING_APPLICATION_ID + secret_key）
//   - 鉴权：Bearer secret_key（直连 chat，不需要 admin token）
// - 采集入口（PAIR / STATUS / COLLECT）继续走桌面端 17321（与 MaxKB 切换无关）
const API = 'http://127.0.0.1:17321'
const MAXKB_DEFAULT_URL = 'http://114.55.149.192:8080'
const MAXKB_DEFAULT_TOKEN = 'agent-9bd465c72fe21d328d51ceefa18ef679'
const MAXKB_APPLICATION_ID = '01a02f8c-66d2-7803-b02b-e67d1cc6e02b'

async function storedToken() {
  return (await chrome.storage.local.get('collectorToken')).collectorToken || ''
}

async function maxkbConfig() {
  const cfg = await chrome.storage.local.get(['maxkbUrl', 'maxkbToken', 'maxkbAppId'])
  return {
    url: (cfg.maxkbUrl || MAXKB_DEFAULT_URL).replace(/\/$/, ''),
    token: cfg.maxkbToken || MAXKB_DEFAULT_TOKEN,
    appId: cfg.maxkbAppId || MAXKB_APPLICATION_ID
  }
}

async function api(path, options = {}) {
  const token = await storedToken()
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) }
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `请求失败（${response.status}）`)
  return body
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    if (message.type === 'PAIR') {
      const result = await api('/pair', { method: 'POST', body: JSON.stringify({ code: String(message.code || '').trim() }) })
      await chrome.storage.local.set({ collectorToken: result.token })
      return { ok: true }
    }
    if (message.type === 'STATUS') {
      const token = await storedToken()
      if (!token) return { ok: false, paired: false, message: '请输入桌面端显示的配对码' }
      const status = await api('/status')
      return { ok: true, paired: status.paired }
    }
    if (message.type === 'COLLECT') {
      const result = await api('/candidates', { method: 'POST', body: JSON.stringify({ products: message.products }) })
      return { ok: true, ...result }
    }
    if (message.type === 'ANALYZE_1688') {
      const cfg = await maxkbConfig()
      if (!cfg.token || !cfg.appId) return { ok: false, message: '请先在设置中填写 MaxKB Token 与 application_id' }
      const response = await fetch(`${cfg.url}/chat/api/${cfg.appId}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.token}` },
        body: JSON.stringify({
          messages: [{ role: 'user', content: message.prompt }],
          stream: false
        })
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body.message || `分析请求失败（${response.status}）`)
      const content = body?.data?.content || body?.choices?.[0]?.message?.content
      if (!content) throw new Error('智能体未返回内容')
      return { ok: true, content }
    }
    if (message.type === 'MAXKB_SAVE') {
      await chrome.storage.local.set({ maxkbUrl: message.url, maxkbToken: message.token, maxkbAppId: message.appId })
      return { ok: true }
    }
    if (message.type === 'MAXKB_STATUS') {
      const cfg = await maxkbConfig()
      const custom = (await chrome.storage.local.get(['maxkbToken', 'maxkbAppId']))
      const usingDefault = !custom.maxkbToken && !custom.maxkbAppId
      return { ok: true, url: cfg.url, appId: cfg.appId, configured: true, usingDefault }
    }
    throw new Error('未知操作')
  })().then(sendResponse).catch(error => sendResponse({ ok: false, message: error instanceof Error ? error.message : '操作失败' }))
  return true
})
