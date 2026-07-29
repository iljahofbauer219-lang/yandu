const API = 'http://127.0.0.1:17321'

async function storedToken() {
  return (await chrome.storage.local.get('collectorToken')).collectorToken || ''
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
    throw new Error('未知操作')
  })().then(sendResponse).catch(error => sendResponse({ ok: false, message: error instanceof Error ? error.message : '操作失败' }))
  return true
})
