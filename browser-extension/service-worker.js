const API = 'http://127.0.0.1:17321'
const RAGFLOW_DEFAULT_URL = 'http://114.55.149.192:8090'
const RAGFLOW_DEFAULT_KEY = 'ragflow-QSmWWnQG96rLlX-_tpHKT6hKSQ_j-85vyY4s7OMXNTA'
const RAGFLOW_AGENT_ID = '8563cdb690e611f1b36bf39ef484774d'

async function storedToken() {
  return (await chrome.storage.local.get('collectorToken')).collectorToken || ''
}

async function ragflowConfig() {
  const cfg = await chrome.storage.local.get(['ragflowUrl', 'ragflowKey'])
  return {
    url: (cfg.ragflowUrl || RAGFLOW_DEFAULT_URL).replace(/\/$/, ''),
    key: cfg.ragflowKey || RAGFLOW_DEFAULT_KEY
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
      const cfg = await ragflowConfig()
      if (!cfg.key) return { ok: false, message: '请先在设置中填写 RAGFlow API Key' }
      const response = await fetch(`${cfg.url}/api/v1/agents/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.key}` },
        body: JSON.stringify({
          agent_id: RAGFLOW_AGENT_ID,
          messages: [{ role: 'user', content: message.prompt }],
          "openai-compatible": true,
          stream: false
        })
      })
      const body = await response.json().catch(() => ({ message: '响应解析失败' }))
      if (!response.ok) throw new Error(body.message || `分析请求失败（${response.status}）`)
      const content = body?.choices?.[0]?.message?.content
      if (!content) throw new Error('智能体未返回内容')
      return { ok: true, content }
    }
    if (message.type === 'RAGFLOW_SAVE') {
      await chrome.storage.local.set({ ragflowUrl: message.url, ragflowKey: message.key })
      return { ok: true }
    }
    if (message.type === 'RAGFLOW_STATUS') {
      const cfg = await ragflowConfig()
      const custom = (await chrome.storage.local.get('ragflowKey')).ragflowKey
      return { ok: true, url: cfg.url, configured: true, usingDefault: !custom }
    }
    throw new Error('未知操作')
  })().then(sendResponse).catch(error => sendResponse({ ok: false, message: error instanceof Error ? error.message : '操作失败' }))
  return true
})
