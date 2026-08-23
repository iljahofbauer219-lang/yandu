// 1688 商品详情页信息提取（供「选品分析师」一键分析使用）
// 在用户浏览器中运行（真实 IP + 登录态），不会被 1688 风控拦截。
(() => {
  const clean = (text) => (text || '').replace(/\s+/g, ' ').trim()
  const firstText = (els) => {
    for (const el of els) {
      const t = clean(el?.textContent)
      if (t) return t
    }
    return ''
  }

  function extractInfo() {
    const info = {}
    const $ = (sel) => document.querySelector(sel)
    const $$ = (sel) => Array.from(document.querySelectorAll(sel))

    // 1. 标题：优先商品标题容器；页面首个 h1 可能是商家名，需避免
    info.title = firstText([
      $('.title-content'), $('.d-title'), $('.title-text'),
    ]) || (() => {
      const h1s = $$('h1').map(h => clean(h.textContent)).filter(Boolean)
      return h1s.length ? h1s[h1s.length - 1] : ''
    })() || document.title.replace(/\s*[-_|].*$/, '').trim()
    info.url = location.href
    info.analysisDate = new Date().toLocaleDateString('en-CA')

    // 2. 价格：优先纯净价格元素，避免带“登录查看更多优惠”的长文本
    info.price = firstText([
      $('.price-info'), $('.price-comp'), $('.price-text'), $('.price'),
    ]) || (document.querySelector('meta[property="og:price:amount"]')?.content || '')

    // 3. 规格属性表（dt/dd 或 th/td）
    const attrs = []
    const seen = new Set()
    const seenKeys = new Set()
    const push = (k, v) => {
      k = clean(k); v = clean(v)
      if (k && v && !seen.has(k + v) && !seenKeys.has(k) && attrs.length < 40) {
        seen.add(k + v); seenKeys.add(k); attrs.push(`${k}：${v}`)
      }
    }
    const bodyText = document.body.innerText || ''
    const bodyLines = bodyText.split(/\n+/).map(clean).filter(Boolean)
    const knownLabels = ['材质', '品牌', '包装数量(片)', '货号', '是否进口', '是否专利货源', '规格', '是否跨境出口专供货源', '主要销售地区', '主要下游平台', '有可授权的自有品牌', '适用对象']
    for (const label of knownLabels) {
      const index = bodyLines.indexOf(label)
      if (index >= 0 && bodyLines[index + 1]) push(label, bodyLines[index + 1])
    }
    // 只在同一属性项内配对标签和值，避免页面中不同 dl 的 dt/dd 串位。
    $$('dt').forEach(dt => {
      const sibling = dt.nextElementSibling
      if (sibling?.tagName === 'DD') push(dt.textContent, sibling.textContent)
    })
    const trEls = $$('tr')
    trEls.forEach(tr => {
      const cells = tr.querySelectorAll('th, td')
      if (cells.length >= 2) push(cells[0].textContent, cells[cells.length - 1].textContent)
    })
    info.attributes = attrs

    // 4. 图片
    const imgs = []
    for (const img of $$('img[src], img[data-src], img[data-lazyload]')) {
      let src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-lazyload') || ''
      if (src.startsWith('//')) src = 'https:' + src
      if (src && /\.(jpe?g|png|webp)(\?|$)/i.test(src) && !imgs.includes(src)) imgs.push(src)
      if (imgs.length >= 10) break
    }
    info.images = imgs

    // 5. 供应商 / 店铺
    info.seller = firstText([
      $('.seller-name'), $('.company-name'), $('[class*="seller-name"]'),
      $('[class*="company"]'), $('[class*="shop-name"]'), $('[class*="ShopName"]'),
    ])

    // 6. 起订量 / 发货地 / 成交：从正文正则提取
    const moqMatch = bodyText.match(/起订量[：:\s]*(\d+\s*[件个套箱]?)/)
    const shipMatch = bodyText.match(/(?:发货地|所在地|发货城市)[：:\s]*([^\n，。;；]{2,20})/)
    const dealMatch = bodyText.match(/(\d[\d,]*)\s*(?:件)?成交/) || bodyText.match(/成交[：:\s]*(\d[\d,]*)/)
    if (moqMatch) info.moq = clean(moqMatch[1])
    if (shipMatch) info.shipFrom = clean(shipMatch[1])
    if (dealMatch) info.deals = clean(dealMatch[1])

    return info
  }

  function toPromptText(info) {
    const lines = ['我在1688看到一款商品，商品信息如下：']
    if (info.url) lines.push(`- 1688商品URL：${info.url}`)
    if (info.analysisDate) lines.push(`- 分析日期：${info.analysisDate}`)
    if (info.title) lines.push(`- 标题：${info.title}`)
    if (info.price) lines.push(`- 价格：${info.price}`)
    if (info.seller) lines.push(`- 供应商/店铺：${info.seller}`)
    if (info.moq) lines.push(`- 起订量：${info.moq}`)
    if (info.shipFrom) lines.push(`- 发货地：${info.shipFrom}`)
    if (info.deals) lines.push(`- 成交：${info.deals} 件`)
    if (info.attributes.length) lines.push('- 规格属性：\n' + info.attributes.map(a => `  * ${a}`).join('\n'))
    if (info.images.length) lines.push(`- 图片：${info.images.length} 张`)
    lines.push('请帮我分析这款产品在亚马逊是否有机会，按方法论文档输出完整评估报告。')
    return lines.join('\n')
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message.type === 'EXTRACT_1688') {
      const info = extractInfo()
      sendResponse({ ok: true, info, prompt: toPromptText(info) })
    }
    return true
  })
})()
