import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * Task 5：ReviseItem 页政策下拉 → EbayScrapedPolicyOption 的映射与落库接线（离线 fixtures）。
 * 口径：页内脚本只回下拉的原始文本与选中态，id/在架数一律在 TS 里由 extractPolicyIdFromLabel 解出；
 * 抓不到政策只点名缺口，绝不抛错打断「读取刊登规则」这个既有动作（门禁不得 brick 操作）。
 * 下面「真机待验（Task 9）」那一条列出的是 fixtures 无法证明、必须回到 Seller Hub 真实页面复验的假设。
 */

vi.mock('electron', () => ({
  BaseWindow: class {},
  BrowserWindow: class {},
  WebContentsView: class {},
  WebContents: class {},
  clipboard: { readText: () => '', writeText: () => undefined }
}))

import { BrowserWorkspace, EBAY_POLICY_SCRAPE_KINDS } from '../BrowserWorkspace'

type Host = Record<string, unknown>
type RawOption = { kind: string; raw: string; selected: boolean }
type PageResult = { ready?: boolean; categorySpecifics?: unknown[]; policyOptions?: RawOption[]; url?: string }
type InspectMethod = (this: Host, accountId: string, listingId: string, title: string) => Promise<{
  sourceUrl: string
  categorySpecifics: unknown[]
  policies: Array<{ kind: string; label: string; policyId?: string; listingCount?: number; selected: boolean }>
  inspectedAt: string
  warnings: string[]
}>

const inspectMethod = BrowserWorkspace.prototype.inspectEbayListingRequirements as unknown as InspectMethod
const source = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), 'utf8')

const CATEGORY = [{ name: 'Brand', required: true, value: '', options: [], source: 'SELLER_HUB' }]

/** 用 fixtures 冒充内嵌浏览器：executeJavaScript 收到真实页脚本字符串，返回 page 里给定的原始文本。 */
function makeHost(page: PageResult = {}) {
  const scripts: string[] = []
  const executeJavaScript = vi.fn(async (script: string) => {
    scripts.push(script)
    return {
      url: page.url || 'https://www.ebay.com/sl/list?mode=ReviseItem&itemId=T100',
      login: false,
      verification: false,
      ready: page.ready ?? true,
      categorySpecifics: page.categorySpecifics ?? CATEGORY,
      policyOptions: page.policyOptions ?? []
    }
  })
  const host: Host = {
    newEbayTab: vi.fn(async () => 'tab-1'),
    detailTabs: new Map([['tab-1', { view: { webContents: { executeJavaScript } } }]]),
    sleep: async () => undefined
  }
  return { host, executeJavaScript, scripts }
}

const inspect = (page: PageResult = {}) => inspectMethod.call(makeHost(page).host, 'ebay:s1', 'T100', 'Bracket')

describe('ReviseItem 政策抓取 · TS 侧映射', () => {
  it('括号里的 ≥6 位数字进 policyId、带 listings 量词的短数字进 listingCount、纯文本两者都不进', async () => {
    const { policies } = await inspect({
      policyOptions: [
        { kind: 'PAYMENT', raw: '  eBay   Managed  Payments (257217501013) ', selected: true },
        { kind: 'SHIPPING', raw: '云仓包邮 (1851 listings)', selected: false },
        { kind: 'RETURN', raw: '14天大健云仓退货', selected: false },
        { kind: 'FULFILLMENT', raw: '标准运输政策 (18510002004)', selected: true }
      ]
    })
    expect(policies).toStrictEqual([
      { kind: 'PAYMENT', label: 'eBay Managed Payments', policyId: '257217501013', selected: true },
      { kind: 'SHIPPING', label: '云仓包邮', listingCount: 1851, selected: false },
      { kind: 'RETURN', label: '14天大健云仓退货', selected: false },
      { kind: 'FULFILLMENT', label: '标准运输政策', policyId: '18510002004', selected: true }
    ])
  })

  it('空白折叠后的标签与选中态原样带走，政策 id 交给下游存 details 三字段', async () => {
    const { policies } = await inspect({
      policyOptions: [{ kind: 'SHIPPING', raw: '\n\n  eBay   Plus\tpret \n (18510002007)  ', selected: true }]
    })
    expect(policies).toStrictEqual([{ kind: 'SHIPPING', label: 'eBay Plus pret', policyId: '18510002007', selected: true }])
  })

  it('页内多出的未知类别被运行时白名单丢弃，合法类别照常映射', async () => {
    const { policies } = await inspect({
      policyOptions: [
        { kind: 'TAX', raw: '税率政策 (19007008001)', selected: true },
        { kind: 'RETURN', raw: '30天退货 (19007008010)', selected: false }
      ]
    })
    expect(policies).toStrictEqual([{ kind: 'RETURN', label: '30天退货', policyId: '19007008010', selected: false }])
    expect(EBAY_POLICY_SCRAPE_KINDS).toEqual(['PAYMENT', 'SHIPPING', 'RETURN', 'FULFILLMENT'])
  })
})

describe('ReviseItem 政策抓取 · 缺口点名不阻断', () => {
  it('政策下拉为空时仍正常返回，点名「未读取到政策下拉」而不抛错', async () => {
    const { policies, warnings } = await inspect({ policyOptions: [] })
    expect(policies).toEqual([])
    expect(warnings).toContain('页面未读取到付款/运输/退货政策下拉；请在 Seller Hub 修改页确认政策区块已加载后重试')
    expect(warnings).not.toContain('页面未读取到类目属性；可能是页面结构变化或该类目没有可见属性')
  })

  it('类目属性也为空时两条缺口同时点名（抓取失败绝不硬阻断既有按钮）', async () => {
    const { warnings } = await inspect({ policyOptions: [], categorySpecifics: [] })
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('页面未读取到类目属性')
    expect(warnings[1]).toContain('页面未读取到付款/运输/退货政策下拉')
  })

  it('读到选项但全部解析不出编号 → 点名「政策库保持上一次抓取结果」，与「没读到下拉」区分开', async () => {
    const { policies, warnings } = await inspect({
      policyOptions: [
        { kind: 'PAYMENT', raw: 'eBay 新版付款政策（无编号）', selected: true },
        { kind: 'RETURN', raw: '1851 listings 样式改动 (1851)', selected: false }
      ]
    })
    expect(policies.map(item=>item.policyId)).toEqual([undefined, undefined])
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('政策下拉读到了选项但都解析不出政策编号')
  })
})

describe('ReviseItem 政策抓取 · 页内脚本边界', () => {
  it('真机待验（Task 9）：脚本只回原始文本，解析与类别白名单都在 TS 一侧', async () => {
    const { host, scripts } = makeHost({ policyOptions: [{ kind: 'PAYMENT', raw: 'eBay Managed Payments (257217501013)', selected: true }] })
    await inspectMethod.call(host, 'ebay:s1', 'T100', 'Bracket')
    const script = scripts[0]
    // 原始文本 + 选中态：政策解析（id / 在架数）一律不在页内做
    expect(script).toContain("policyOptions.push({kind:group.kind,raw,selected:option.selected})")
    expect(script).not.toContain('extractPolicyIdFromLabel')
    expect(script).not.toContain('d{6,}')
    // 类别清单两侧必须一致：页内 policyGroups 的 kind 集合 == TS 白名单
    const pageKinds = [...script.matchAll(/\{kind:'([A-Z]+)',patterns:/g)].map(match => match[1])
    expect(pageKinds).toEqual(EBAY_POLICY_SCRAPE_KINDS)
    // 零新 API 底线：只读 DOM，绝不提交、绝不点按钮
    expect(script).not.toMatch(/form\.submit\(|\.submit\(|\.click\(|type="submit"/)
  })

  it('政策区块与标题字段在同一次开页里一起读，不额外开第二个标签', async () => {
    const { host, executeJavaScript } = makeHost({ policyOptions: [{ kind: 'RETURN', raw: '退货 (19007008009)', selected: true }] })
    const requirements = await inspectMethod.call(host, 'ebay:s1', 'T100', 'Bracket')
    expect(executeJavaScript).toHaveBeenCalledTimes(1)
    expect(host.newEbayTab).toHaveBeenCalledTimes(1)
    expect(requirements.sourceUrl).toContain('mode=ReviseItem')
    expect(requirements.policies).toHaveLength(1)
  })
})

describe('ReviseItem 政策抓取 · 落库与读取接线', () => {
  it('源码守卫：requirements 抓完即入库，且绝不把 DAO 包进外层事务', () => {
    const main = source('src/main/main.ts')
    const handler = main.slice(main.indexOf("ipcMain.handle('ebay:local-products:requirements'"))
    const body = handler.slice(0, handler.indexOf("ipcMain.handle('ebay:local-products:prepare-revision'"))
    expect(body).toContain('database.saveEbayBusinessPolicies(storeId,requirements.policies)')
    expect(body).not.toContain(".exec('BEGIN")
    expect(body).not.toContain('.exec(`BEGIN')
    expect(body).toContain('店铺政策已读取但未能写入本地库')
  })

  it('源码守卫：政策列表 IPC + preload + 渲染器类型三处一致接通', () => {
    expect(source('src/main/main.ts')).toContain("ipcMain.handle('ebay:business-policies:list', (_event, storeId:string, kind?:EbayBusinessPolicyKind) => database?.getEbayBusinessPolicies(storeId,kind)||[])")
    expect(source('src/preload/preload.ts')).toContain("businessPolicies: (storeId:string,kind?:EbayBusinessPolicyKind):Promise<EbayStoreBusinessPolicy[]> => ipcRenderer.invoke('ebay:business-policies:list',storeId,kind)")
    expect(source('src/renderer/global.d.ts')).toContain('businessPolicies(storeId:string,kind?:EbayBusinessPolicyKind):Promise<EbayStoreBusinessPolicy[]>')
  })
})
