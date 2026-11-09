import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { decideEbayReadOutcome, ebayReadFailureMessage } from '../ebayReadOutcome'

/**
 * C 批「eBay 发布链路报错时机」口径：
 * did-finish-load 未在预算内触发（长连接/挂端子资源，eBay 与 Seller Hub 常态）不得再直接判失败；
 * 成败只由内容轮询决定，最终失败文案要说清「卡在哪」，且不得直出 net::/ERR_ 技术串。
 */
interface Probe {
  login?: boolean
  verification?: boolean
  priceReady?: boolean
  descriptionReady?: boolean
}

describe('decideEbayReadOutcome', () => {
  it('页面探针还没回来时只算未就绪，不判失败', () => {
    expect(decideEbayReadOutcome<Probe>(null, () => true)).toBe('WAIT')
  })

  it('登录失效优先于安全验证与就绪', () => {
    const probe: Probe = { login: true, verification: true, priceReady: true, descriptionReady: true }
    expect(decideEbayReadOutcome(probe, () => true)).toBe('LOGIN')
  })

  it('要求安全验证优先于就绪', () => {
    const probe: Probe = { verification: true, priceReady: true, descriptionReady: true }
    expect(decideEbayReadOutcome(probe, () => true)).toBe('VERIFY')
  })

  it('字段读全即就绪', () => {
    const probe: Probe = { priceReady: true, descriptionReady: true }
    expect(decideEbayReadOutcome(probe, p => Boolean(p.priceReady && p.descriptionReady))).toBe('READY')
  })

  it('未读全且未失效时继续轮询（这就是口径变更：加载事件慢不算失败）', () => {
    const probe: Probe = { priceReady: true, descriptionReady: false }
    expect(decideEbayReadOutcome(probe, p => Boolean(p.priceReady && p.descriptionReady))).toBe('WAIT')
  })
})

describe('ebayReadFailureMessage', () => {
  it('内容渲染出来但字段没读全时，文案说明是字段问题并给出退路', () => {
    const message = ebayReadFailureMessage({ pageLabel: 'Seller Hub 修改页', loadEventSettled: true, sawContent: true })
    expect(message).toContain('Seller Hub 修改页')
    expect(message).toContain('已打开')
    expect(message).toMatch(/价格|描述|字段/)
  })

  it('加载事件超时但页面其实有内容时，不得把责任推给网络', () => {
    const message = ebayReadFailureMessage({ pageLabel: 'eBay 原商品页', loadEventSettled: false, sawContent: true })
    expect(message).toContain('已打开')
    expect(message).not.toMatch(/网络/)
  })

  it('页面始终空白时提示可能是会话或验证问题，并指出去哪里确认', () => {
    const message = ebayReadFailureMessage({ pageLabel: 'eBay 原商品页', loadEventSettled: true, sawContent: false })
    expect(message).toMatch(/空白|没渲染|没渲染出内容/)
    expect(message).toMatch(/店铺采集|人工验证|验证/)
  })

  it('三种文案都不得直出 net:: 或 ERR_ 技术串', () => {
    for (const sawContent of [true, false]) {
      for (const loadEventSettled of [true, false]) {
        const message = ebayReadFailureMessage({ pageLabel: 'eBay 原商品页', loadEventSettled, sawContent })
        expect(message).not.toMatch(/net::|ERR_/)
        expect(message.length).toBeGreaterThan(20)
      }
    }
  })
})

describe('BrowserWorkspace 接线不回流到老口径', () => {
  const source = readFileSync(new URL('../../main/browser/BrowserWorkspace.ts', import.meta.url), 'utf8')

  it('两处加载竞速不再直接抛「加载超时」', () => {
    expect(source).not.toMatch(/加载超时，请检查网络或登录状态后重试/)
    expect(source).not.toMatch(/25_000\.then\(\(\)\s*=>\s*\{\s*throw new Error/)
  })

  it('两处都改用软等待 + 内容判定', () => {
    expect((source.match(/let loadEventSettled\s*=\s*false/g) || []).length).toBe(2)
    expect((source.match(/decideEbayReadOutcome\(/g) || []).length).toBe(2)
    expect((source.match(/ebayReadFailureMessage\(/g) || []).length).toBe(2)
  })

  it('25 秒预算仍在（只是不再当作失败），最坏耗时口径不变', () => {
    expect((source.match(/this\.sleep\(25_000\)/g) || []).length).toBe(2)
  })

  it('登录与安全验证两条文案一字未改', () => {
    expect(source).toContain("throw new Error('eBay登录会话已失效，请先返回店铺采集完成登录')")
    expect(source).toContain("throw new Error('eBay要求安全验证，请先在店铺采集浏览器中完成人工验证')")
    expect(source).toContain("throw new Error('eBay 登录会话已失效，请先完成登录')")
    expect(source).toContain("throw new Error('eBay 要求安全验证，请人工完成后重试')")
  })
})
