const status = document.querySelector('#status')
const pairing = document.querySelector('#pairing')
const ready = document.querySelector('#ready')
const message = document.querySelector('#message')
const pageHint = document.querySelector('#pageHint')
const previewEl = document.querySelector('#extractedPreview')
const analyzeBtn = document.querySelector('#analyze1688')
const reportArea = document.querySelector('#reportArea')

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

// ---------- AI 选品分析（1688） ----------
function renderReport(markdown) {
  // 极简 markdown 渲染：加粗 + 段落 + 列表
  const esc = markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const html = esc
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h3>$1</h3>')
    .replace(/^[-*] (.*)$/gm, '<li>$1</li>')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
  reportArea.innerHTML = `<p>${html}</p>`
  reportArea.hidden = false
}

async function detectPage() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  const url = tab?.url || ''
  if (/1688\.com\/offer\//.test(url) || /detail\.1688\.com/.test(url)) {
    pageHint.textContent = '已检测到 1688 商品页，可一键提取分析'
    pageHint.className = 'hint ok'
    analyzeBtn.hidden = false
    previewEl.hidden = true
    reportArea.hidden = true
    return true
  }
  pageHint.textContent = '请打开 1688 商品详情页后使用'
  pageHint.className = 'hint'
  analyzeBtn.hidden = true
  return false
}

async function extractCurrent() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.id) return { ok: false, message: '未找到当前页面' }
  const result = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_1688' }).catch(() => null)
  if (!result?.ok) return { ok: false, message: '提取失败，请确认当前页面是 1688 商品详情页' }
  return result
}

analyzeBtn.addEventListener('click', async () => {
  show('正在提取商品信息…')
  const extracted = await extractCurrent()
  if (!extracted.ok) return show(extracted.message, 'error')
  const info = extracted.info
  previewEl.textContent = [
    info.title && `标题：${info.title}`,
    info.price && `价格：${info.price}`,
    info.seller && `供应商：${info.seller}`,
    info.moq && `起订量：${info.moq}`,
    info.attributes.length && `规格属性：${info.attributes.length} 项`,
    info.images.length && `图片：${info.images.length} 张`,
  ].filter(Boolean).join('\n')
  previewEl.hidden = false

  show('智能体分析中，约需 20-60 秒…')
  analyzeBtn.disabled = true
  try {
    const result = await chrome.runtime.sendMessage({ type: 'ANALYZE_1688', prompt: extracted.prompt })
    if (!result?.ok) throw new Error(result?.message || '分析失败')
    renderReport(result.content)
    show('分析完成', 'ok')
  } catch (error) {
    show(error.message || '分析失败', 'error')
  } finally {
    analyzeBtn.disabled = false
  }
})

// ---------- RAGFlow 设置 ----------
async function loadSettings() {
  const result = await chrome.runtime.sendMessage({ type: 'RAGFLOW_STATUS' })
  if (!result?.ok) return
  document.querySelector('#ragflowUrl').value = result.url
  if (result.usingDefault) {
    document.querySelector('#ragflowKey').placeholder = '已内置默认 Key，无需填写'
  } else {
    const stored = await chrome.storage.local.get('ragflowKey')
    if (stored.ragflowKey) document.querySelector('#ragflowKey').value = stored.ragflowKey
  }
}

document.querySelector('#saveRagflow').addEventListener('click', async () => {
  const url = document.querySelector('#ragflowUrl').value.trim()
  const key = document.querySelector('#ragflowKey').value.trim()
  if (!url || !key) return show('请填写服务地址和 API Key', 'error')
  const result = await chrome.runtime.sendMessage({ type: 'RAGFLOW_SAVE', url, key })
  show(result?.ok ? '设置已保存' : (result?.message || '保存失败'), result?.ok ? 'ok' : 'error')
})

void refresh()
void detectPage()
void loadSettings()
