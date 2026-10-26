// 原站「物流方式」区两张卡都写「预估物流费」，按文档序抓必误取未选中的云送仓套；此处按 DOM 容器锁定「一件代发」卡直读。
// 自包含纯函数，经 toString() 注入页面执行，禁止引用模块作用域外的任何标识符。
export function pickDropshipShippingFee(cardTexts: string[]): string {
  const money = '((?:US\\s?\\$|\\$)\\s?[\\d,.]+(?:\\s*[~～\\-–]\\s*(?:US\\s?\\$|\\$)?\\s?[\\d,.]+)?(?:\\s*/\\s*件)?)'
  const texts: string[] = []
  for (const raw of cardTexts || []) texts.push(String(raw || '').replace(/\s+/g, ' ').trim())
  const anchor = /一件代发[^$]{0,60}?预估物流费/
  let best = ''
  for (const text of texts) {
    if (!text || text.length > 400) continue
    if (best && text.length >= best.length) continue
    if (!anchor.test(text)) continue
    best = text
  }
  if (!best) {
    // 部分页面把「一件代发」页签与费用卡拆成两个节点：退化为「只含一件代发、不含云送仓」的卡里取第一个预估物流费
    for (const text of texts) {
      if (!text || text.length > 400 || !/一件代发/.test(text) || /云送仓/.test(text)) continue
      const loose = new RegExp('预估物流费\\s*[:：]?\\s{0,3}' + money).exec(text)
      if (loose && loose[1]) return loose[1].trim()
    }
    return ''
  }
  const direct = new RegExp('一件代发[^$]{0,60}?预估物流费\\s*[:：]?\\s{0,3}' + money).exec(best)
  if (direct && direct[1]) return direct[1].trim()
  const first = new RegExp('预估物流费\\s*[:：]?\\s{0,3}' + money).exec(best)
  return first && first[1] ? first[1].trim() : ''
}
