const BUTTON_CLASS = 'sourcing-collector-button'

function textOf(node) {
  return (node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim()
}

function productFrom(anchor, capturedFrom) {
  const url = new URL(anchor?.href || location.href, location.href)
  const productId = url.searchParams.get('product_id') || textOf(document.body).match(/Item\s*Code\s*:\s*([\w-]+)/i)?.[1] || ''
  let container = capturedFrom === 'DETAIL' ? document.body : anchor.closest('[class*="product"], [class*="goods"], [class*="card"], li, article')
  if (!container || textOf(container).length < 15) container = anchor.parentElement?.parentElement || document.body
  const text = textOf(container)
  const heading = capturedFrom === 'DETAIL' ? document.querySelector('h1, [class*="product-name"], [class*="product-title"]') : null
  const image = container.querySelector('img') || document.querySelector('[class*="product"] img')
  const title = textOf(heading) || anchor?.getAttribute('title') || image?.alt || text.slice(0, 180)
  const priceText = text.match(/(?:US)?\$\s*[\d,.]+(?:\s*-\s*(?:US)?\$?\s*[\d,.]+)?/i)?.[0] || ''
  const stockText = text.match(/(?:Available\s*Stock|可售库存|库存)\s*[:：]?\s*[\d,]+/i)?.[0] || ''
  const sellableInventory = Number(stockText.match(/[\d,]+/)?.[0]?.replace(/,/g, '') || 0) || null
  const shippingFeeText = text.match(/(?:Shipping(?:\s*Fee)?|物流费)\s*[:：]?\s*((?:US)?\$\s*[\d,.]+(?:\s*-\s*(?:US)?\$?\s*[\d,.]+)?(?:\s*\/件)?)/i)?.[1] || ''
  const promotionText = text.match(/\d+(?:\.\d+)?%\s*OFF/i)?.[0] || ''
  const gigaIndex = Number(text.match(/(?:Seller\s*)?GIGA\s*Index\s*[:：]?\s*(\d+(?:\.\d+)?)/i)?.[1] || 0) || null
  const storeReturnRate = text.match(/(?:店铺退货率|Shop\s*Return\s*Rate)\s*[:：]?\s*([^|,，;；]{1,20})/i)?.[1]?.trim() || ''
  const supplierName = text.match(/(?:Seller|Supplier|供应商)\s*[:：]\s*([^|,，;；]{2,80})/i)?.[1]?.trim() || ''
  return { platformCode: 'GIGACLOUD', productId, url: url.href, title, imageUrl: image?.currentSrc || image?.src || '', priceText, salesText: stockText, shippingFeeText, sellableInventory, promotionText, supplierName, gigaIndex, storeReturnRate, capturedFrom }
}

async function collect(button, product) {
  const original = button.textContent
  button.disabled = true
  button.textContent = '采集中…'
  const result = await chrome.runtime.sendMessage({ type: 'COLLECT', products: [product] })
  if (result?.ok) {
    button.textContent = result.imported ? '已采集' : '已更新'
    button.classList.add('is-collected')
    return
  }
  button.disabled = false
  button.textContent = original
  window.alert(`采集失败：${result?.message || '请先打开插件完成配对'}`)
}

function addDetailButton() {
  if (!location.href.includes('route=product/product') || document.querySelector('.sourcing-collector-floating')) return
  const button = document.createElement('button')
  button.className = `${BUTTON_CLASS} sourcing-collector-floating`
  button.textContent = '＋ 采集此产品'
  button.addEventListener('click', () => void collect(button, productFrom(null, 'DETAIL')))
  document.documentElement.appendChild(button)
}

function addListButtons() {
  const anchors = document.querySelectorAll('a[href*="route=product/product"][href*="product_id="]')
  anchors.forEach(anchor => {
    if (anchor.dataset.sourcingCollectorBound === '1') return
    anchor.dataset.sourcingCollectorBound = '1'
    const container = anchor.closest('[class*="product"], [class*="goods"], [class*="card"], li, article') || anchor.parentElement
    if (!container || container.querySelector(`.${BUTTON_CLASS}`)) return
    const button = document.createElement('button')
    button.className = `${BUTTON_CLASS} sourcing-collector-inline`
    button.textContent = '＋ 采集'
    button.addEventListener('click', event => {
      event.preventDefault()
      event.stopPropagation()
      void collect(button, productFrom(anchor, 'LIST'))
    })
    container.appendChild(button)
  })
}

let scanTimer = 0
function scheduleScan() {
  window.clearTimeout(scanTimer)
  scanTimer = window.setTimeout(() => { addDetailButton(); addListButtons() }, 300)
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== 'COLLECT_CURRENT') return
  if (!location.href.includes('route=product/product')) {
    sendResponse({ ok: false, message: '请先打开大健云仓商品详情页；列表商品请点击卡片旁的“＋ 采集”' })
    return
  }
  const product = productFrom(null, 'DETAIL')
  chrome.runtime.sendMessage({ type: 'COLLECT', products: [product] }).then(sendResponse)
  return true
})

scheduleScan()
new MutationObserver(scheduleScan).observe(document.documentElement, { childList: true, subtree: true })
