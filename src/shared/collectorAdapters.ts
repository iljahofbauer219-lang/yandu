// 名录货盘平台商品采集适配器：选择器均以存档 HTML fixture 取证（/tmp/collector-fixtures），
// 仅覆盖服务端渲染出商品卡的平台；SPA 壳平台（西之月/海贝等）无 SSR 卡片证据，保持诚实未接入提示。
import { PALLET_HOME_URLS, registrableDomain } from './supplyPlatformSessions'

export interface CollectorAdapter {
  family: string
  domains: string[]
  cardSelector: string
  linkSelector: string
  productUrlPattern: string
  titleSelector: string
  priceSelector: string
  imageSelector: string
  productIdPattern: string
}

export const COLLECTOR_ADAPTERS: CollectorAdapter[] = [
  {
    family: 'SALEYEE',
    domains: ['saleyee.com'],
    cardSelector: '.goods_box',
    linkSelector: 'a[href*="-p"][href$=".html"]',
    productUrlPattern: '-p\\d+\\.html$',
    titleSelector: '.goods_infor a',
    priceSelector: '',
    imageSelector: '.goods_img img',
    productIdPattern: '-p(\\d+)\\.html$'
  },
  {
    family: 'KJDS',
    domains: ['kjds.com'],
    cardSelector: '.product_item',
    linkSelector: 'a[href^="/sells/products/"]',
    productUrlPattern: '/sells/products/\\d+',
    titleSelector: '.title p',
    priceSelector: '',
    imageSelector: '.each_box img',
    productIdPattern: '/sells/products/(\\d+)'
  },
  {
    family: 'CJDROP',
    domains: ['cjdropshipping.com'],
    cardSelector: '.sp-product',
    linkSelector: 'a[href^="/product/"]',
    productUrlPattern: '/product/[^"]+\\.html$',
    titleSelector: '.product-title a',
    priceSelector: '.product-price',
    imageSelector: '.product-image img',
    productIdPattern: '-p-(\\d+)\\.html$'
  }
]

export function adapterForHost(host: string): CollectorAdapter | null {
  const domain = registrableDomain(host)
  return COLLECTOR_ADAPTERS.find(adapter => adapter.domains.includes(domain)) || null
}

export function adapterForCode(code: string): CollectorAdapter | null {
  const home = PALLET_HOME_URLS[code]
  if (!home) return null
  try { return adapterForHost(new URL(home).hostname) } catch { return null }
}

const SCRIPT_HELPERS = String.raw`
  const textOf = node => (node?.innerText || node?.textContent || '').replace(/\s+/g,' ').trim();
  const isRealProductImage = url => /^https?:\/\//i.test(url || '') && !/(?:product_base|placeholder|default[-_]?image|loading|lazyload|blank|transparent|no[-_]?image)/i.test(url);
  const imageUrlOf = image => {
    if (!image) return '';
    const srcset = (image.getAttribute('srcset') || image.getAttribute('data-srcset') || '').split(',').map(value=>value.trim().split(/\s+/)[0]).filter(Boolean).pop() || '';
    return [image.currentSrc,image.src,image.getAttribute('data-src'),image.getAttribute('data-original'),image.getAttribute('data-lazy-src'),image.getAttribute('data-url'),srcset].find(isRealProductImage) || '';
  };
`

/** 当前页全量商品提取脚本：返回 CollectedSupplyProduct 形状数组，供 collectRegistryList 使用 */
export function buildRegistryExtractScript(adapter: CollectorAdapter, platformCode: string): string {
  return String.raw`(() => {
    ${SCRIPT_HELPERS}
    const adapter = ${JSON.stringify(adapter)};
    const platformCode = ${JSON.stringify(platformCode)};
    const linkRe = new RegExp(${JSON.stringify(adapter.productUrlPattern)});
    const idRe = new RegExp(${JSON.stringify(adapter.productIdPattern)});
    const seen = new Set();
    const products = [];
    for (const card of document.querySelectorAll(adapter.cardSelector)) {
      const anchor = [...card.querySelectorAll(adapter.linkSelector)].find(node => linkRe.test(node.href || node.getAttribute('href') || ''));
      if (!anchor) continue;
      const url = new URL(anchor.href || anchor.getAttribute('href'), location.href).href;
      if (seen.has(url)) continue;
      seen.add(url);
      const titleNode = card.querySelector(adapter.titleSelector);
      const title = textOf(titleNode) || anchor.getAttribute('title') || card.querySelector('img')?.alt || textOf(card).slice(0, 180);
      const priceText = adapter.priceSelector ? textOf(card.querySelector(adapter.priceSelector)) : '';
      const imageUrl = imageUrlOf(card.querySelector(adapter.imageSelector)) || imageUrlOf(card.querySelector('img'));
      const productId = (url.match(idRe) || [])[1] || '';
      products.push({ platformCode, productId, url, title, imageUrl, priceText, salesText: '', shippingFeeText: '', sellableInventory: null, promotionText: '', supplierName: '', gigaIndex: null, gigaIndexText: '', storeReturnRate: '', capturedFrom: 'LIST' });
    }
    return products;
  })()`
}

/** 交互采集器注入脚本：与 gigab2b 注入同契约 window.__crossBorderCollector{snapshot,sync,stop,remove} */
export function buildCollectorScript(adapter: CollectorAdapter, platformCode: string, seeded: unknown[], collectedUrls: string[]): string {
  return String.raw`(() => {
    const previousSnapshot = window.__crossBorderCollector?.snapshot?.() || {products:[],changes:[]};
    const previousSelected = previousSnapshot.products || [];
    const changes = previousSnapshot.changes || [];
    window.__crossBorderCollector?.stop?.();
    const selected = new Map([...${JSON.stringify(seeded)},...previousSelected].map(item => [item.url, item]));
    const collected = new Set(${JSON.stringify(collectedUrls)});
    ${SCRIPT_HELPERS}
    const adapter = ${JSON.stringify(adapter)};
    const platformCode = ${JSON.stringify(platformCode)};
    const linkRe = new RegExp(${JSON.stringify(adapter.productUrlPattern)});
    const idRe = new RegExp(${JSON.stringify(adapter.productIdPattern)});
    const buttonClass = 'cross-border-collector-select';
    const overlay = document.createElement('div'); overlay.id = 'cross-border-collector-overlay'; document.documentElement.appendChild(overlay);
    const entries = new Map();
    const extractOf = (card, anchor) => {
      const url = new URL(anchor.href || anchor.getAttribute('href'), location.href).href;
      const titleNode = card.querySelector(adapter.titleSelector);
      const title = textOf(titleNode) || anchor.getAttribute('title') || card.querySelector('img')?.alt || textOf(card).slice(0, 180);
      const priceText = adapter.priceSelector ? textOf(card.querySelector(adapter.priceSelector)) : '';
      const imageUrl = imageUrlOf(card.querySelector(adapter.imageSelector)) || imageUrlOf(card.querySelector('img'));
      const productId = (url.match(idRe) || [])[1] || '';
      return { platformCode, productId, url, title, imageUrl, priceText, salesText: '', shippingFeeText: '', sellableInventory: null, promotionText: '', supplierName: '', gigaIndex: null, gigaIndexText: '', storeReturnRate: '', capturedFrom: 'LIST' };
    };
    const update = entry => { const isCollected = collected.has(entry.product.url); const chosen = selected.has(entry.product.url) || isCollected; entry.button.textContent = chosen ? '✓' : '🤖'; entry.button.classList.toggle('is-selected', chosen); entry.button.classList.toggle('is-collected', isCollected); entry.button.title = isCollected ? '已入库' : ''; entry.card?.classList.toggle('cross-border-collector-card-active', chosen); };
    const toggle = entry => { if (collected.has(entry.product.url)) return; const isSelected = !selected.has(entry.product.url); if (isSelected) { entry.product = extractOf(entry.card, entry.anchor); selected.set(entry.product.url, entry.product); } else selected.delete(entry.product.url); changes.push({ selected: isSelected, product: entry.product }); update(entry); };
    const removeEntry = entry => { entry.card?.classList.remove('cross-border-collector-card-active'); entry.button.remove(); entries.delete(entry.product.url); };
    const position = () => { entries.forEach(entry => { if (!entry.anchor?.isConnected) { removeEntry(entry); return; } const rect = entry.target.getBoundingClientRect(); const visible = rect.width > 40 && rect.height > 40 && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth; entry.button.hidden = !visible; if (!visible) return; entry.button.style.top = Math.max(6, rect.top + 8) + 'px'; entry.button.style.left = Math.min(innerWidth - 8, Math.max(rect.left + 80, rect.right - 52)) + 'px'; update(entry); }); };
    const scan = () => {
      const currentUrls = new Set();
      for (const card of document.querySelectorAll(adapter.cardSelector)) {
        const anchor = [...card.querySelectorAll(adapter.linkSelector)].find(node => linkRe.test(node.href || ''));
        if (!anchor) continue;
        const url = new URL(anchor.href || anchor.getAttribute('href'), location.href).href;
        currentUrls.add(url);
        if (entries.has(url)) { const existing = entries.get(url); if (existing.anchor === anchor) { existing.target = card.querySelector(adapter.imageSelector) || anchor; continue; } removeEntry(existing); }
        const product = extractOf(card, anchor);
        const button = document.createElement('button'); button.type = 'button'; button.className = buttonClass;
        const entry = { anchor, card, target: card.querySelector(adapter.imageSelector) || anchor, product, button };
        button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); toggle(entry); });
        entries.set(url, entry); overlay.appendChild(button); update(entry);
      }
      entries.forEach(entry => { if (!currentUrls.has(entry.product.url)) removeEntry(entry); });
      position();
    };
    const observer = new MutationObserver(() => scan());
    observer.observe(document.body, { childList: true, subtree: true });
    addEventListener('scroll', () => position(), { passive: true });
    addEventListener('resize', () => position());
    scan();
    window.__crossBorderCollector = {
      snapshot: () => ({ products: [...selected.values()], visibleUrls: [...entries.keys()], changes: changes.splice(0) }),
      sync: products => { const wanted = new Map((products || []).map(item => [item.url, item])); selected.clear(); wanted.forEach((value, key) => selected.set(key, value)); entries.forEach(update); },
      remove: url => { selected.delete(url); const entry = entries.get(url); if (entry) update(entry); },
      stop: () => { observer.disconnect(); overlay.remove(); entries.forEach(entry => entry.button.remove()); entries.clear(); }
    };
    return true;
  })()`
}
