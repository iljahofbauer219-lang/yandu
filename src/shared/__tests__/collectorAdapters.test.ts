import { describe, expect, it } from 'vitest'
import { COLLECTOR_ADAPTERS, adapterForCode, adapterForHost, buildCollectorScript, buildRegistryExtractScript } from '../collectorAdapters'

describe('名录货盘采集适配器口径', () => {
  it('区域变体归同族适配器', () => {
    expect(adapterForCode('SALEYEE_NA')?.family).toBe('SALEYEE')
    expect(adapterForCode('SALEYEE_EU')?.family).toBe('SALEYEE')
    expect(adapterForCode('KJDS_CN')?.family).toBe('KJDS')
    expect(adapterForCode('CJDROP_AU')?.family).toBe('CJDROP')
  })
  it('渲染态取证后 SPA 壳平台也归族，既有平台不冒领', () => {
    expect(adapterForCode('XIZHIYUE_NA')?.family).toBe('XIZHIYUE')
    expect(adapterForCode('XIZHIYUE_CN')?.family).toBe('XIZHIYUE')
    expect(adapterForCode('HAIBEI')?.family).toBe('HAIBEI')
    expect(adapterForCode('HAIBEI_EU')?.family).toBe('HAIBEI')
    expect(adapterForCode('GIGACLOUD')).toBeNull()
    expect(adapterForCode('1688')).toBeNull()
    expect(adapterForCode('NOT_A_PLATFORM')).toBeNull()
  })
  it('无锚点卡片的产品页解析口径（路由模板/卡片属性）', () => {
    const wm = adapterForHost('www.westmonth.com')
    expect(wm?.urlTemplate).toBe('https://www.westmonth.com/products/{id}')
    expect(wm?.idAttr).toBe('data-sensors-exposure-property-item_id')
    expect(wm?.listUrl).toContain('westmonth.com/products/all')
    expect(adapterForHost('www.haibeigoods.com')?.cardUrlAttr).toBe('data-href')
  })
  it('子域匹配与坏域拒绝', () => {
    expect(adapterForHost('global.saleyee.com')?.family).toBe('SALEYEE')
    expect(adapterForHost('pic.kjds.com')?.family).toBe('KJDS')
    expect(adapterForHost('oss-cf.cjdropshipping.com')?.family).toBe('CJDROP')
    expect(adapterForHost('evil.com')).toBeNull()
    expect(adapterForHost('saleyee.com.evil.com')).toBeNull()
  })
  it('选择器均以 fixture 取证且非空', () => {
    for (const adapter of COLLECTOR_ADAPTERS) {
      expect(adapter.cardSelector, adapter.family).toBeTruthy()
      if (!adapter.cardUrlAttr && !adapter.urlTemplate) expect(adapter.linkSelector, adapter.family).toBeTruthy()
      expect(adapter.imageSelector, adapter.family).toBeTruthy()
      expect(adapter.titleSelector, adapter.family).toBeTruthy()
      expect(() => new RegExp(adapter.productUrlPattern), adapter.family).not.toThrow()
      expect(() => new RegExp(adapter.productIdPattern), adapter.family).not.toThrow()
    }
  })
  it('注入脚本保持既有采集器契约', () => {
    const adapter = COLLECTOR_ADAPTERS[0]
    const script = buildCollectorScript(adapter, 'SALEYEE_NA', [], [])
    for (const key of ['snapshot', 'sync', 'stop', 'remove', '__crossBorderCollector', 'cross-border-collector-select']) expect(script).toContain(key)
    const extract = buildRegistryExtractScript(adapter, 'SALEYEE_NA')
    expect(extract).toContain(adapter.cardSelector)
    expect(extract).toContain('platformCode')
  })
})
