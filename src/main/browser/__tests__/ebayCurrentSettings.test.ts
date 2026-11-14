import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BrowserWorkspace } from '../BrowserWorkspace'

/**
 * AA：预设五项（运送/付款/退货政策、所在地、邮编）打开时自动读现网已有设置作默认。
 * 政策当前选中ID与选项来自内嵌 Helix 模型（value+options），所在地/邮编来自偏好设置摘要，均只读不写。
 */
const method = BrowserWorkspace.prototype.readCurrentEbaySettings as unknown as (
  this: Record<string, unknown>, accountId: string
) => Promise<{ paymentPolicy: { current: string; options: Array<{ id: string; text: string }> }; shippingPolicy: { current: string }; returnPolicy: { current: string }; itemLocation: string; postalCode: string }>

const model = (name: string, value: string, label: string, count: string) => JSON.stringify({
  name, value,
  options: [{ value, label: { textSpans: [{ text: label }] }, listingCount: { textSpans: [{ text: count }] } }]
})

function makeHost() {
  const executeJavaScript = vi.fn(async (script: string) => {
    if (script.includes('policyModels') || script.includes('paymentPolicy')) return {
      policyModels: {
        paymentPolicy: model('paymentPolicyId', '257217501013', 'eBay immediate payment', '[4285 件物品刊登]'),
        shippingPolicy: model('shippingPolicyId', '2585', '云仓包邮', '(2639 件物品刊登)'),
        returnPolicy: model('returnsPolicyId', '123456789', '14天大健云仓退货', '(100 件物品刊登)')
      }
    }
    return JSON.stringify({ location: '91789 (Walnut, California, United States)', postal: '91789' })
  })
  const host: Record<string, unknown> = {
    activeTabId: 'tab-1',
    detailTabs: new Map([['tab-1', { view: { webContents: { executeJavaScript, getURL: () => 'https://www.ebay.com/lstng?draftId=1&mode=AddItem' } } }]])
  }
  return { host, executeJavaScript }
}

describe('readCurrentEbaySettings · 读现网已有设置', () => {
  it('政策当前ID+选项来自模型，所在地/邮编来自偏好摘要', async () => {
    const { host } = makeHost()
    const r = await method.call(host, 'ebay:s1')
    expect(r.paymentPolicy.current).toBe('257217501013')
    expect(r.paymentPolicy.options[0].text).toContain('eBay immediate payment')
    expect(r.shippingPolicy.current).toBe('2585')
    expect(r.returnPolicy.current).toBe('123456789')
    expect(r.itemLocation).toContain('91789')
    expect(r.postalCode).toBe('91789')
  })
})

describe('AA 接线守卫', () => {
  const mainSource = readFileSync(path.resolve(process.cwd(), 'src/main/main.ts'), 'utf8')
  const preloadSource = readFileSync(path.resolve(process.cwd(), 'src/preload/preload.ts'), 'utf8')
  const appSource = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')
  it('main 注册读取 IPC、preload 暴露、弹窗打开时预填', () => {
    expect(mainSource).toContain('readCurrentEbaySettings')
    expect(preloadSource).toContain('readCurrentEbaySettings')
    expect(appSource).toContain('readCurrentEbaySettings')
  })
  it('弹窗政策三项为可选下拉（绑定选项），不再空白文本框', () => {
    expect(appSource).toContain('presetPolicyOptions')
  })
})