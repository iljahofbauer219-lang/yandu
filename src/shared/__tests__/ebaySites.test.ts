import { describe, expect, it } from 'vitest'
import { EBAY_SITE_ALLOWED_MESSAGE, EBAY_SITE_ROOT_DOMAINS, isEbayDotComHost, isEbaySiteHost, isEbaySiteUrl } from '../ebaySites'

describe('eBay 站点域名白名单', () => {
  it('各国官方站点与子域放行，ebay.com 仍在列', () => {
    ;['ebay.com', 'www.ebay.com', 'www.ebay.cn', 'motors.ebay.com', 'www.ebay.de', 'ebay.co.uk', 'www.ebay.com.au', 'www.ebay.com.hk'].forEach(host => {
      expect(isEbaySiteHost(host)).toBe(true)
    })
  })

  it('后缀拼接与形近域名一律拒绝', () => {
    ;['evil-ebay.com', 'ebay.com.evil.co', 'ebay.de.evil.net', 'ebay.co', 'ebayy.com', ''].forEach(host => {
      expect(isEbaySiteHost(host)).toBe(false)
    })
  })

  it('裸串走 URL 判定：http 与非法串不放行', () => {
    expect(isEbaySiteUrl('https://www.ebay.fr/sch/i.html?_nkw=bag')).toBe(true)
    expect(isEbaySiteUrl('http://www.ebay.de/')).toBe(false)
    expect(isEbaySiteUrl('not-a-url')).toBe(false)
  })

  it('业务级判定仍只认 ebay.com', () => {
    expect(isEbayDotComHost('accountsettings.ebay.com')).toBe(true)
    expect(isEbayDotComHost('www.ebay.de')).toBe(false)
    expect(isEbayDotComHost('www.ebay.cn')).toBe(false)
  })

  it('白名单与横幅文案自洽：文案至少列出 ebay.com 与两例国家站', () => {
    expect(EBAY_SITE_ROOT_DOMAINS).toContain('ebay.com')
    ;['ebay.de', 'ebay.co.uk', 'ebay.cn'].forEach(domain => expect(EBAY_SITE_ROOT_DOMAINS).toContain(domain))
    ;['ebay.com', 'ebay.de', 'ebay.co.uk', 'ebay.cn'].forEach(domain => expect(EBAY_SITE_ALLOWED_MESSAGE).toContain(domain))
  })
})
