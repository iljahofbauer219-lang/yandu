const status = document.querySelector('#status')
const pairing = document.querySelector('#pairing')
const ready = document.querySelector('#ready')
const message = document.querySelector('#message')

function show(text, kind = '') { message.textContent = text; message.className = kind }
function connected(value) { pairing.hidden = value; ready.hidden = !value; status.textContent = value ? '已连接砚都跨境' : '尚未配对' }

async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'STATUS' })
  connected(Boolean(result?.ok && result?.paired))
  if (!result?.ok && result?.message) show(result.message)
}

document.querySelector('#pair').addEventListener('click', async () => {
  show('正在连接…')
  const result = await chrome.runtime.sendMessage({ type: 'PAIR', code: document.querySelector('#code').value })
  if (!result?.ok) return show(result?.message || '连接失败', 'error')
  connected(true)
  show('配对成功', 'ok')
})

document.querySelector('#collect').addEventListener('click', async () => {
  show('正在采集…')
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return show('未找到当前页面', 'error')
  const result = await chrome.tabs.sendMessage(tab.id, { type: 'COLLECT_CURRENT' }).catch(() => ({ ok: false, message: '当前页面不是已支持的采集平台' }))
  show(result?.ok ? (result.imported ? '商品已加入 AI 候选' : '候选商品已更新') : result?.message || '采集失败', result?.ok ? 'ok' : 'error')
})

void refresh()
