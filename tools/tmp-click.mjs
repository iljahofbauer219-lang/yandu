const re = new RegExp(String.raw`^AI跨境$`)
const nodes = [...document.querySelectorAll('button,[role="button"],a,.nav-btn,[class*="card"],[class*="Card"]')]
const hit = nodes.filter(n => n.getBoundingClientRect().width > 0 && re.test((n.textContent || '').trim().replace(/\s+/g, ' ')))
if (!hit.length) return JSON.stringify({ clicked: false, sample: nodes.slice(0, 0).map(n => n.textContent.trim()).slice(0, 20), visible: nodes.length })
const el = hit[0]
el.click()
return JSON.stringify({ clicked: true, text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60), tag: el.tagName, candidates: hit.length })
