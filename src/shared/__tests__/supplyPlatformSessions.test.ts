import { describe, expect, it } from 'vitest'
import { PALLET_HOME_URLS, supplySessionPartitionForUrl, supplyPartitionForGroup } from '../supplyPlatformSessions'

describe('货盘平台会话罐隔离', () => {
  it('大健云仓与1688沿用既有供应罐（零回归）', () => {
    expect(supplySessionPartitionForUrl('https://www.gigab2b.com/index.php?route=common/home')).toBe('persist:supply:GIGACLOUD:default')
    expect(supplySessionPartitionForUrl('https://detail.1688.com/offer/1.html')).toBe('persist:supply:1688:default')
  })
  it('赛盈/越域网/西之月/海贝各自独立罐且互不相同', () => {
    const partitions = ['https://global.saleyee.com/', 'https://www.kjds.com/', 'https://westmonth.com/', 'https://www.haibeigoods.com/'].map(url => supplySessionPartitionForUrl(url))
    expect(partitions).toEqual(['persist:supply-site:saleyee.com', 'persist:supply-site:kjds.com', 'persist:supply-site:westmonth.com', 'persist:supply-site:haibeigoods.com'])
    expect(new Set(partitions).size).toBe(4)
  })
  it('同平台多入口共用一罐', () => {
    expect(supplySessionPartitionForUrl(PALLET_HOME_URLS.SALEYEE_EU)).toBe(supplySessionPartitionForUrl(PALLET_HOME_URLS.SALEYEE_NA))
    expect(supplyPartitionForGroup('SALEYEE_EU')).toBe(supplyPartitionForGroup('SALEYEE_NA'))
  })
  it('多级后缀域名取注册域', () => {
    expect(supplySessionPartitionForUrl('https://home.droplatam.com.br/')).toBe('persist:supply-site:droplatam.com.br')
    expect(supplySessionPartitionForUrl('https://dcmshop.easyseller.com/')).toBe('persist:supply-site:easyseller.com')
  })
  it('非货盘域名与坏网址回落 null（通用罐不变）', () => {
    expect(supplySessionPartitionForUrl('https://example.com/')).toBeNull()
    expect(supplySessionPartitionForUrl('not a url')).toBeNull()
  })
  it('每个货盘首页都有独立罐（GIGACLOUD/1688 除外走既有罐）', () => {
    for (const [code, url] of Object.entries(PALLET_HOME_URLS)) {
      const partition = supplySessionPartitionForUrl(url)
      expect(partition, code).toBeTruthy()
      if (code !== 'GIGACLOUD' && code !== '1688' && code !== '1688GLOBAL' && code !== 'ALIBABA_US' && !code.startsWith('ALIDROP')) expect(partition, code).toMatch(/^persist:supply-site:/)
    }
  })
})
