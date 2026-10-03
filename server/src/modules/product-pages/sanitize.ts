/**
 * 产品详情页 HTML 净化：源页 HTML 来自第三方站点，属不可信输入，落盘前必须剥除全部可执行内容。
 * 公开详情页与 /api/* 同源（nginx location / 反代 8787），未净化的脚本可在本站源上执行并携带
 * __Host-yandu_harness cookie 访问 harness 网关 —— 净化 + 响应头 CSP 双层阻断。
 * CSP 里 base-uri 用 'self' 而非 'none'：servePage 需要注入本站 <base> 来解析 assets/ 相对路径，
 * 'self' 既保住这个能力，又阻止攻击者把 base 指向外部主机。
 */
import sanitizeHtml from 'sanitize-html'

/** 允许保留的排版标签。svg/math 可携带 script 与 foreignObject，一律不放行。 */
const ALLOWED_TAGS = [
  'a', 'address', 'article', 'aside', 'blockquote', 'br', 'caption', 'center', 'cite', 'code', 'col',
  'colgroup', 'dd', 'del', 'details', 'dfn', 'dialog', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure',
  'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'i', 'img', 'ins', 'kbd',
  'legend', 'li', 'main', 'mark', 'nav', 'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp',
  'section', 'small', 'span', 'strike', 'strong', 'style', 'sub', 'summary', 'sup', 'table', 'tbody',
  'td', 'tfoot', 'th', 'thead', 'time', 'tr', 'tt', 'u', 'ul', 'var', 'wbr'
]

const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  '*': ['class', 'id', 'style', 'title', 'lang', 'dir', 'align', 'valign', 'role', 'aria-label'],
  a: ['href', 'name', 'rel'],
  img: ['src', 'srcset', 'sizes', 'alt', 'width', 'height', 'loading', 'decoding'],
  col: ['span', 'width'],
  colgroup: ['span', 'width'],
  table: ['width', 'border', 'cellpadding', 'cellspacing'],
  td: ['colspan', 'rowspan', 'width', 'height'],
  th: ['colspan', 'rowspan', 'width', 'height', 'scope'],
  time: ['datetime'],
  ol: ['start', 'type'],
  del: ['datetime'],
  ins: ['datetime']
}

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: ALLOWED_ATTRIBUTES,
  // script/style/textarea 等的内容按 nonTextTags 整体丢弃，不会被转义成可见文本
  disallowedTagsMode: 'discard',
  // 在默认值基础上补 title/noscript/template：否则源页 <title> 的文字会漏成正文可见文本
  nonTextTags: ['script', 'style', 'textarea', 'option', 'title', 'noscript', 'template'],
  // 保留 <style> 是刻意的：源页外链样式表已被 CSP 挡掉，内联 <style> 块是仅剩的排版来源，
  // 剥掉会让详情页彻底塌陷。sanitize-html 对该标签的 XSS 告警针对 IE expression() / -moz-binding
  // 一类历史向量，在现代浏览器不成立，且 PRODUCT_PAGE_CSP 的 script-src 'none' 是最终强制层。
  allowVulnerableTags: true,
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesAppliedToAttributes: ['href', 'src', 'cite', 'action'],
  allowProtocolRelative: true,
  transformTags: {
    // 外链一律降级为不可反向操控的普通链接：去掉 target 防止 tab-nabbing，补 nofollow/noopener
    a: (tagName, attribs) => {
      const { target: _target, onclick: _onclick, ...rest } = attribs
      return { tagName, attribs: { ...rest, rel: 'nofollow noopener noreferrer' } }
    },
    // 图片去掉 referrerpolicy 以外的加载侧信道属性，longping 可被用于埋点
    img: (tagName, attribs) => {
      const { longping: _longping, ...rest } = attribs
      return { tagName, attribs: rest }
    }
  }
}

/**
 * 净化产品详情页 HTML。返回值可直接落盘并以 text/html 提供。
 * 注意：净化只负责剥除可执行内容，`<base>` 注入与 CSP 响应头在 routes.ts 的 servePage 中完成。
 */
export function sanitizeProductPageHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS)
}

/**
 * 公开详情页的 CSP。`script-src 'none'` 是决定性控制：即使净化漏了某种载荷，浏览器也不会执行。
 * `sandbox`（不带 allow-same-origin）让文档落到不透明源，切断对本站 storage/cookie 的访问，
 * 从而阻断「同源 fetch 自动附带 __Host-yandu_harness」这条提权路径。
 * `img-src` 保留 https: 是因为客户端对下载失败的图片保留源站直链。
 */
export const PRODUCT_PAGE_CSP = [
  "default-src 'none'",
  "img-src 'self' data: https:",
  "style-src 'unsafe-inline'",
  "font-src 'self' data:",
  "script-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  'sandbox'
].join('; ')

/** 详情页与静态资源共用的安全响应头 */
export function applyProductPageSecurityHeaders(setHeader: (name: string, value: string) => void): void {
  setHeader('content-security-policy', PRODUCT_PAGE_CSP)
  setHeader('x-content-type-options', 'nosniff')
  setHeader('referrer-policy', 'no-referrer')
  setHeader('x-robots-tag', 'noindex, nofollow')
}
