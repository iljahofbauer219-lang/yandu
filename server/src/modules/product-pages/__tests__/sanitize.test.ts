import { describe, expect, it } from 'vitest'
import { PRODUCT_PAGE_CSP, applyProductPageSecurityHeaders, sanitizeProductPageHtml } from '../sanitize.js'

describe('sanitizeProductPageHtml', () => {
  it('剥除 script 标签且不把脚本内容泄漏成可见文本', () => {
    const out = sanitizeProductPageHtml('<div>标题</div><script>window.__pwned=1</script>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('__pwned')
    expect(out).toContain('标题')
  })

  it('剥除内联事件属性，保留元素本身与合法属性', () => {
    const out = sanitizeProductPageHtml('<img src="assets/01.jpg" alt="主图" onerror="alert(1)"><div onclick="steal()">正文</div>')
    expect(out).not.toMatch(/on(error|click)/i)
    expect(out).toContain('src="assets/01.jpg"')
    expect(out).toContain('alt="主图"')
    expect(out).toContain('正文')
  })

  it('剥除 iframe / object / embed / form / input 等可执行或可提交容器', () => {
    const out = sanitizeProductPageHtml([
      '<iframe src="//evil.example/x"></iframe>',
      '<object data="x.swf"></object>',
      '<embed src="x.swf">',
      '<form action="//evil.example/steal"><input name="pwd"><button>提交</button></form>'
    ].join(''))
    expect(out).not.toMatch(/<(iframe|object|embed|form|input|button)/i)
    expect(out).not.toContain('evil.example/steal')
  })

  it('剥除 meta refresh 跳转与源页 base / link', () => {
    const out = sanitizeProductPageHtml('<head><base href="//evil.example/"><link rel="stylesheet" href="//evil.example/a.css"><meta http-equiv="refresh" content="0;url=https://evil.example"></head><body>正文</body>')
    expect(out).not.toMatch(/<(base|link|meta)/i)
    expect(out).not.toContain('evil.example')
    expect(out).toContain('正文')
  })

  it('剥除 svg/math 载体（可携带 script 与 foreignObject）', () => {
    const out = sanitizeProductPageHtml('<svg><script>alert(1)</script><foreignObject><div>x</div></foreignObject></svg><math><mtext>y</mtext></math>')
    expect(out).not.toMatch(/<(svg|math|foreignObject|script)/i)
    expect(out).not.toContain('alert')
  })

  it('掐断 javascript: 与 data:text/html 协议', () => {
    const out = sanitizeProductPageHtml('<a href="javascript:alert(1)">点我</a><a href="data:text/html,<script>alert(2)</script>">点我2</a>')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('data:text/html')
    expect(out).not.toContain('alert')
    expect(out).toContain('点我')
  })

  it('外链降级：去掉 target 防 tab-nabbing，补 nofollow noopener noreferrer', () => {
    const out = sanitizeProductPageHtml('<a href="https://detail.1688.com/offer/123.html" target="_blank">源页</a>')
    expect(out).toContain('href="https://detail.1688.com/offer/123.html"')
    expect(out).not.toContain('target=')
    expect(out).toContain('rel="nofollow noopener noreferrer"')
    expect(out).toContain('源页')
  })

  it('保留正常商品页结构：图片、表格、内联 style 属性与 style 块', () => {
    const out = sanitizeProductPageHtml([
      '<style>.price{color:#f40;font-weight:700}</style>',
      '<h1 class="title" style="font-size:18px">纯棉 T 恤</h1>',
      '<img src="assets/01.jpg" alt="主图" width="800">',
      '<table><thead><tr><th colspan="2">规格</th></tr></thead><tbody><tr><td>材质</td><td>棉</td></tr></tbody></table>',
      '<ul><li>透气</li><li>不起球</li></ul>'
    ].join(''))
    expect(out).toContain('.price{color:#f40')
    expect(out).toContain('style="font-size:18px"')
    expect(out).toContain('<img src="assets/01.jpg"')
    expect(out).toContain('colspan="2"')
    expect(out).toContain('<li>透气</li>')
  })

  it('对完整 HTML 文档不崩溃，且净化后不含任何可执行载体', () => {
    const out = sanitizeProductPageHtml('<!DOCTYPE html><html><head><title>t</title><script>a()</script></head><body><p>ok</p></body></html>')
    expect(out).not.toMatch(/<(script|html|head|body|title)/i)
    expect(out).toContain('ok')
  })

  it('源页 title/noscript/template 的文字内容不漏成正文可见文本', () => {
    const out = sanitizeProductPageHtml('<head><title>纯棉 T 恤</title><noscript>请开启 JS</noscript></head><body><template><div>模板内容</div></template><p>正文</p></body>')
    expect(out).not.toContain('请开启 JS')
    expect(out).not.toContain('模板内容')
    expect(out).toContain('正文')
  })

  it('净化是幂等的：对已净化结果再跑一次不产生变化', () => {
    const dirty = '<div><script>a()</script><img src="assets/01.jpg" onerror="b()"><a href="javascript:c()">x</a></div>'
    const once = sanitizeProductPageHtml(dirty)
    expect(sanitizeProductPageHtml(once)).toBe(once)
  })
})

describe('PRODUCT_PAGE_CSP', () => {
  it('禁止一切脚本执行（决定性控制）', () => {
    expect(PRODUCT_PAGE_CSP).toContain("script-src 'none'")
    expect(PRODUCT_PAGE_CSP).toContain("default-src 'none'")
  })

  it('sandbox 摘掉同源特权，阻断 harness cookie 提权路径', () => {
    expect(PRODUCT_PAGE_CSP.split(';').map(part => part.trim())).toContain('sandbox')
    expect(PRODUCT_PAGE_CSP).not.toContain('allow-same-origin')
  })

  it('禁止被嵌套、禁止表单提交，base 限定本站（servePage 需注入本站 base 解析 assets）', () => {
    expect(PRODUCT_PAGE_CSP).toContain("frame-ancestors 'none'")
    expect(PRODUCT_PAGE_CSP).toContain("form-action 'none'")
    expect(PRODUCT_PAGE_CSP).toContain("base-uri 'self'")
    expect(PRODUCT_PAGE_CSP).not.toContain("base-uri 'none'")
  })

  it('style-src 不含外部主机，@import 外联被 CSP 拦下', () => {
    expect(PRODUCT_PAGE_CSP).toContain("style-src 'unsafe-inline'")
    expect(PRODUCT_PAGE_CSP).not.toMatch(/style-src[^;]*https?:/)
  })

  it('img-src 保留 https: 以兼容客户端保留的源站直链图片', () => {
    expect(PRODUCT_PAGE_CSP).toContain("img-src 'self' data: https:")
  })
})

describe('applyProductPageSecurityHeaders', () => {
  it('下发 CSP / nosniff / referrer-policy / noindex', () => {
    const headers = new Map<string, string>()
    applyProductPageSecurityHeaders((name, value) => headers.set(name, value))
    expect(headers.get('content-security-policy')).toBe(PRODUCT_PAGE_CSP)
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('referrer-policy')).toBe('no-referrer')
    expect(headers.get('x-robots-tag')).toContain('noindex')
  })
})
