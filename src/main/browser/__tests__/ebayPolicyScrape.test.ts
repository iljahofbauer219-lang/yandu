import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * Task 5：ReviseItem 页政策下拉 → EbayScrapedPolicyOption 的映射与落库接线（离线 fixtures）。
 * 口径：页内脚本只回下拉的原始文本与选中态，id/在架数一律在 TS 里由 extractPolicyIdFromLabel 解出；
 * 抓不到政策只点名缺口，绝不抛错打断「读取刊登规则」这个既有动作（门禁不得 brick 操作）。
 * 评审修复三条口径也在这里钉死：一个 <select> 只认一个类别（claimed）、命中优先取可见下拉、
 * 陈旧风险按类别逐个点名（不再「全有或全无」一条汇总）、空 label 回落原始文本。
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
type ModelField = 'paymentPolicy' | 'shippingPolicy' | 'returnPolicy'
type PageResult = { ready?: boolean; categorySpecifics?: unknown[]; policyOptions?: RawOption[]; policyModels?: Partial<Record<ModelField, string>>; url?: string; attributeRows?: unknown[]; attributeGroups?: Array<{ text: string; y: number; blurb?: string }>; attributeToggles?: Array<{ text: string }>; attributeCustomAction?: string; attributeCollapsedRows?: unknown[]; attributeCollapsedToggles?: Array<{ text: string }>; attributeCard?: { text: string; options: Array<{ label: string; checked: boolean }>; buttons: string[] } }
type InspectMethod = (this: Host, accountId: string, listingId: string, title: string, categoryId?: string) => Promise<{
  sourceUrl: string
  categorySpecifics: unknown[]
  attributeSection: {
    slots: Array<{ name: string; group: string; groupLabel: string; control: string; required: boolean; value: string; placeholder: string; placeholderShown: string; suggested: string; maxLength: number; counter: string; meta: string; metaKind: string; options: Array<{ text: string; pressed: boolean }>; y: number }>
    groups: Array<{ name: string; blurb: string }>
    toggleExpandedText: string
    toggleCollapsedText: string
    customActionText: string
    collapsedSlotNames: string[]
  }
  suggestedCard: { title: string; blurb: string; items: Array<{ name: string; value: string; checked: boolean }>; applyAll: string } | null
  policies: Array<{ kind: string; label: string; policyId?: string; listingCount?: number; selected: boolean }>
  inspectedAt: string
  warnings: string[]
}>

const inspectMethod = BrowserWorkspace.prototype.inspectEbayListingRequirements as unknown as InspectMethod
const source = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), 'utf8')

const CATEGORY = [{ name: 'Brand', required: true, value: '', options: [], source: 'SELLER_HUB' }]

/** 现网内嵌模型的形状：文案是 textSpans 数组，编号在 option.value，在架数另起一段文字。 */
const modelSlice = (name: string, selected: number, options: Array<[number, string, string]>): string =>
  JSON.stringify({
    name,
    value: selected,
    label: { _type: 'TextualDisplay', textSpans: [{ _type: 'TextSpan', text: name }] },
    options: options.map(([value, text, count]) => ({
      value,
      label: { _type: 'TextualDisplay', textSpans: [{ _type: 'TextSpan', text }] },
      ...(count ? { listingCount: { _type: 'TextualDisplay', textSpans: [{ _type: 'TextSpan', text: count }] } } : {})
    }))
  })

/** 2026-11-09 现网 draftId=5306791224420 的 ITEM SPECIFICS 段原文（见 ~/.yandu-acceptance/2026-11-09-R5/R5-rows.json 与 R5-section.json），页内脚本应当照这几项回传。 */
const ATTRIBUTE_ROWS = [
  { name: 'attributes.Brand', id: '', tag: 'BUTTON', controlClass: 'se-expand-button__button fake-menu-button__button btn', labelText: 'Brand *', labelClass: 'summary__attributes--label required-field', text: 'Unbranded', value: '', placeholder: '', panelPlaceholder: 'Search or enter your own', maxLength: '', valueText: 'Unbranded', y: 1547 },
  { name: 'attributes.Type', id: '', tag: 'BUTTON', controlClass: 'se-expand-button__button fake-menu-button__button btn', labelText: 'Type', labelClass: 'summary__attributes--label', text: '', value: '', placeholder: '', panelPlaceholder: 'Search or enter your own', maxLength: '', valueText: '', y: 1603 },
  { name: 'attributes.Model', id: 's0-1-0-25-15-@ATTRIBUTES-1-34-4-2[2[ESSENTIAL]]-2-se-textbox', tag: 'INPUT', controlClass: 'textbox__control', labelText: 'Model', labelClass: 'summary__attributes--label', text: '', value: '', placeholder: 'Enter your own', panelPlaceholder: '', maxLength: '', valueText: 'Suggested: Suzuki Grand Vitara II 2.0 J20A 95200-64JB1 95200-64JB0', y: 1659 },
  { name: 'attributes.Item Width', id: '', tag: 'BUTTON', controlClass: 'se-expand-button__button fake-menu-button__button btn', labelText: 'Item Width', labelClass: 'summary__attributes--label', text: '', value: '', placeholder: '', panelPlaceholder: 'Search or enter your own', maxLength: '', valueText: '', y: 2046 },
  { name: 'attributes.California Prop 65 Warning', id: 's0-1-0-25-15-@ATTRIBUTES-1-34-4-27[13[OPTIONAL]]-4-se-textarea', tag: 'TEXTAREA', controlClass: 'textbox__control', labelText: 'California Prop 65 Warning', labelClass: 'summary__attributes--label', text: '', value: '', placeholder: 'Enter your own', panelPlaceholder: '', maxLength: '800', valueText: '0/800', y: 2773 },
  { name: 'attributes.Unit Quantity', id: '', tag: 'INPUT', controlClass: 'textbox__control', labelText: 'Unit Quantity', labelClass: 'summary__attributes--label', text: '', value: '', placeholder: 'Enter your own', panelPlaceholder: '', maxLength: '', valueText: '', y: 2853 },
  // 段外噪声：标题/描述也在这页上，name 不带 attributes 前缀，页内脚本就该整行跳过
  { name: 'title', id: '', tag: 'INPUT', controlClass: 'textbox__control', labelText: 'Item title', labelClass: '', text: '', value: 'Compressor', placeholder: '', panelPlaceholder: '', maxLength: '', valueText: '', y: 900 }
]
const ATTRIBUTE_GROUPS = [{ text: 'Essential', y: 1507 }, { text: 'Optional', y: 2006 }]
/**
 * 2026-11-09 15:17 现网 ITEM SPECIFICS 段顶部那张 eBay.ai 建议卡的原文（截图
 * ~/.yandu-acceptance/2026-11-09-R6/C01-ebay-live-item-specifics.png）。卡片按条件渲染：
 * 同一张草稿页重载后就不再出现，所以这里只有截图原文、没有 DOM 导出。
 */
const ATTRIBUTE_CARD = {
  text: 'Suggested item specifics\nQuickly add item specifics using info from your photos and title, powered by eBay.ai—this helps buyers find your item faster.\nYear Manufactured: 2020\nNumber of Compressors: 1\nApply all',
  options: [
    { label: 'Year Manufactured: 2020', checked: false },
    { label: 'Number of Compressors: 1', checked: false }
  ],
  buttons: ['Apply all']
}

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
      attributeRows: page.attributeRows ?? [],
      attributeGroups: page.attributeGroups ?? [],
      attributeToggles: page.attributeToggles ?? [],
      attributeCustomAction: page.attributeCustomAction ?? '',
      attributeCollapsedRows: page.attributeCollapsedRows ?? [],
      attributeCollapsedToggles: page.attributeCollapsedToggles ?? [],
      attributeCard: page.attributeCard ?? { text: '', options: [], buttons: [] },
      policyOptions: page.policyOptions ?? [],
      policyModels: { paymentPolicy: '', shippingPolicy: '', returnPolicy: '', ...(page.policyModels ?? {}) }
    }
  })
  const host: Host = {
    newEbayTab: vi.fn(async () => 'tab-1'),
    detailTabs: new Map([['tab-1', { view: { webContents: { executeJavaScript } } }]]),
    sleep: async () => undefined
  }
  return { host, executeJavaScript, scripts }
}

const inspect = (page: PageResult = {}) => inspectMethod.call(makeHost(page).host, 'ebay:s1', '189035181453', 'Bracket')

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

  it('选项文本只剩编号时 label 兜底带走原始文本，不把空名字写进政策库', async () => {
    const { policies } = await inspect({
      policyOptions: [
        { kind: 'PAYMENT', raw: '(257217501013)', selected: true },
        { kind: 'RETURN', raw: '14天退货 (19007008010)', selected: false }
      ]
    })
    expect(policies[0]).toStrictEqual({ kind: 'PAYMENT', label: '(257217501013)', policyId: '257217501013', selected: true })
    expect(policies.every(item => item.label.trim().length > 0)).toBe(true)
  })
})

describe('ReviseItem 政策抓取 · 缺口点名不阻断', () => {
  it('整块政策都没读到仍正常返回，点名「未读取到付款/运输/退货政策」而不抛错', async () => {
    const { policies, warnings } = await inspect({ policyOptions: [] })
    expect(policies).toEqual([])
    expect(warnings).toContain('页面未读取到付款/运输/退货政策；本地政策保持上一次抓取的结果，请在 Seller Hub 修改页确认政策区块已加载后重试')
    expect(warnings).not.toContain('页面未读取到类目属性；可能是页面结构变化或该类目没有可见属性')
  })

  it('类目属性也为空时两条缺口同时点名（抓取失败绝不硬阻断既有按钮）', async () => {
    const { warnings } = await inspect({ policyOptions: [], categorySpecifics: [] })
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('页面未读取到类目属性')
    expect(warnings[1]).toContain('页面未读取到付款/运输/退货政策')
  })

  it('某类读到选项但全类解析不出编号 → 只点名那一类，与「整类没读到」区分开', async () => {
    const { policies, warnings } = await inspect({
      policyOptions: [
        { kind: 'PAYMENT', raw: 'eBay 管理付款 (257217501013)', selected: true },
        { kind: 'SHIPPING', raw: '云仓包邮 (18510002004)', selected: false },
        { kind: 'RETURN', raw: '30天退货（改版后不带编号）', selected: false }
      ]
    })
    expect(policies.filter(item => item.kind === 'RETURN').every(item => item.policyId === undefined)).toBe(true)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('退货政策读到了选项但都解析不出政策编号')
    expect(warnings[0]).toContain('本地退货政策保持上一次抓取的结果')
    for (const silent of ['付款', '运输', '发货']) expect(warnings.some(item => item.includes(`${silent}政策读到了选项`))).toBe(false)
  })

  it('多类同时解析不出编号 → 每类各点名一次（不再汇总成一条），且点名用中文不带裸英文类别串', async () => {
    const { warnings } = await inspect({
      policyOptions: [
        { kind: 'PAYMENT', raw: 'eBay 新版付款政策（无编号）', selected: true },
        { kind: 'RETURN', raw: '14天退货 (19007008010)', selected: false },
        { kind: 'FULFILLMENT', raw: '标准发货政策 (1851)', selected: false }
      ]
    })
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('付款政策读到了选项但都解析不出政策编号')
    expect(warnings[1]).toContain('发货政策读到了选项但都解析不出政策编号')
    expect(warnings.some(item => item.includes('退货政策读到了选项'))).toBe(false)
    expect(warnings.some(item => item.includes('运输政策读到了选项'))).toBe(false)
    expect(warnings.every(item => !/PAYMENT|SHIPPING|RETURN|FULFILLMENT/.test(item))).toBe(true)
  })

  it('全部类别都解析不出编号 → 逐类点名且不误报「未读取到政策」', async () => {
    const { warnings } = await inspect({
      policyOptions: [
        { kind: 'PAYMENT', raw: 'eBay 新版付款政策（无编号）', selected: true },
        { kind: 'RETURN', raw: '1851 listings 样式改动 (1851)', selected: false }
      ]
    })
    expect(warnings).toHaveLength(2)
    expect(warnings[0]).toContain('付款政策读到了选项')
    expect(warnings[1]).toContain('退货政策读到了选项')
    expect(warnings.some(item => item.includes('页面未读取到付款/运输/退货政策'))).toBe(false)
  })
})

describe('ReviseItem 政策抓取 · 页内脚本边界', () => {
  it('真机待验（Task 9）：脚本只回原始文本，解析与类别白名单都在 TS 一侧', async () => {
    const { host, scripts } = makeHost({ policyOptions: [{ kind: 'PAYMENT', raw: 'eBay Managed Payments (257217501013)', selected: true }] })
    await inspectMethod.call(host, 'ebay:s1', '189035181453', 'Bracket')
    const script = scripts[0]
    // 原始文本 + 选中态：政策解析（id / 在架数）一律不在页内做
    expect(script).toContain("policyOptions.push({kind:group.kind,raw,selected:option.selected})")
    expect(script).not.toContain('extractPolicyIdFromLabel')
    expect(script).not.toContain('d{6,}')
    // 类别清单两侧必须一致：页内 policyGroups 的 kind 集合 == TS 白名单
    const pageKinds = [...script.matchAll(/\{kind:'([A-Z]+)',patterns:/g)].map(match => match[1])
    expect(pageKinds).toEqual(EBAY_POLICY_SCRAPE_KINDS)
    // 零新 API 底线：只读 DOM，绝不提交、绝不点按钮
    // 零新 API 底线：只读 DOM，绝不提交；唯一例外是视觉折叠开关 Show more 的一次点击，
    // 它只改页面折叠态、折叠遍与展开遍都如实回传由 TS 侧解（AddItem 取证 2026-11-09 22:1x）
    expect(script).not.toMatch(/form\.submit\(|\.submit\(|type="submit"/)
    // J3 起菜单候选零点击（J1-premounted-options.json：列表未点开就已挂好），全脚本唯一点击是 Show more 展开折叠段
    expect(script.match(/\.click\(/g) || []).toHaveLength(1)
    expect(script).toContain('showMore.click()')
    expect((script.match(/btn\.click\(\)/g) || []).length).toBe(0)
  })

  it('页内一个下拉只认一个类别：已认领的节点会被后续类别跳过（双认领会让 DAO 互抹政策）', async () => {
    const { host, scripts } = makeHost({ policyOptions: [{ kind: 'SHIPPING', raw: '运输政策 (18510002004)', selected: true }] })
    await inspectMethod.call(host, 'ebay:s1', '189035181453', 'Bracket')
    const script = scripts[0]
    expect(script).toContain('const claimed=new Set();')
    expect(script).toContain('field.tagName===\'SELECT\'&&!claimed.has(field)&&group.patterns.some(')
    expect(script).toContain('claimed.add(select);')
    // 旧的单命中写法必须消失：它会让同一个 <select> 被 shipping/handling 两组各抓一次
    expect(script).not.toMatch(/const select=fields\.find\(/)
  })

  it('页内命中优先取可见下拉，全不可见才回落第一个（隐藏的旧控件不再直接决定入库内容）', async () => {
    const { host, scripts } = makeHost({ policyOptions: [{ kind: 'RETURN', raw: '退货政策 (19007008010)', selected: true }] })
    await inspectMethod.call(host, 'ebay:s1', '189035181453', 'Bracket')
    const script = scripts[0]
    expect(script).toContain('const matches=fields.filter(field=>field.tagName===\'SELECT\'&&!claimed.has(field)')
    expect(script).toContain('const select=matches.find(field=>visible(field))||matches[0];')
    // 命中区间仍走同一批模式，只是将 select 来源从 fields.find 换成两段式 matches
    expect(script).toContain("group.patterns.some(pattern=>pattern.test(labelFor(field)+' '+(field.name||'')+' '+(field.id||'')))")
  })

  it('政策区块与标题字段在同一次开页里一起读，不额外开第二个标签', async () => {
    const { host, executeJavaScript } = makeHost({ policyOptions: [{ kind: 'RETURN', raw: '退货 (19007008009)', selected: true }] })
    const requirements = await inspectMethod.call(host, 'ebay:s1', '189035181453', 'Bracket')
    expect(executeJavaScript).toHaveBeenCalledTimes(1)
    expect(host.newEbayTab).toHaveBeenCalledTimes(1)
    expect(requirements.sourceUrl).toContain('mode=ReviseItem')
    expect(requirements.policies).toHaveLength(1)
  })
})

describe('ReviseItem 政策抓取 · 内嵌模型优先（R2 现网控件是 combobox）', () => {
  const LIVE_MODELS = {
    paymentPolicy: modelSlice('paymentPolicyId', 257211994013, [[257211994013, 'eBay immediate payment', '[3409 listings]'], [257217501013, 'eBay Managed Payments (257217501013)', '[1 listing]']] as Array<[number, string, string]>),
    shippingPolicy: modelSlice('shippingPolicyId', 266273287013, [[262233981013, '云仓包邮', '(1901 listings)'], [266273287013, '中国直邮包邮', '(1515 listings)']] as Array<[number, string, string]>),
    returnPolicy: modelSlice('returnsPolicyId', 262373278013, [[262373278013, '14天大健云仓退货', '(3407 listings)']] as Array<[number, string, string]>)
  }

  it('现网一页一个政策 <select> 都没有：模型三段照样抓出付款/运输/退货并带出编号', async () => {
    const { policies, warnings } = await inspect({ policyOptions: [], policyModels: LIVE_MODELS })
    expect(policies).toStrictEqual([
      { kind: 'PAYMENT', label: 'eBay immediate payment', policyId: '257211994013', listingCount: 3409, selected: true },
      { kind: 'PAYMENT', label: 'eBay Managed Payments', policyId: '257217501013', listingCount: 1, selected: false },
      { kind: 'SHIPPING', label: '云仓包邮', policyId: '262233981013', listingCount: 1901, selected: false },
      { kind: 'SHIPPING', label: '中国直邮包邮', policyId: '266273287013', listingCount: 1515, selected: true },
      { kind: 'RETURN', label: '14天大健云仓退货', policyId: '262373278013', listingCount: 3407, selected: true }
    ])
    expect(warnings).toEqual([])
  })

  it('模型命中的那一类不再收旧下拉行（两处来源同政策会互相抹编号），未被模型覆盖的发货类仍走下拉', async () => {
    const { policies } = await inspect({
      policyModels: { paymentPolicy: LIVE_MODELS.paymentPolicy },
      policyOptions: [
        { kind: 'PAYMENT', raw: 'eBay 管理付款 (257217501013)', selected: true },
        { kind: 'FULFILLMENT', raw: '标准发货政策 (18510002004)', selected: false }
      ]
    })
    expect(policies).toStrictEqual([
      { kind: 'PAYMENT', label: 'eBay immediate payment', policyId: '257211994013', listingCount: 3409, selected: true },
      { kind: 'PAYMENT', label: 'eBay Managed Payments', policyId: '257217501013', listingCount: 1, selected: false },
      { kind: 'FULFILLMENT', label: '标准发货政策', policyId: '18510002004', selected: false }
    ])
  })

  it('模型只有付款一段 → 退货整段回落旧下拉，别把上一版能读到的类别读成空', async () => {
    const { policies, warnings } = await inspect({
      policyModels: { paymentPolicy: LIVE_MODELS.paymentPolicy },
      policyOptions: [{ kind: 'RETURN', raw: '30天退货 (19007008010)', selected: false }]
    })
    expect(policies.map(item => `${item.kind}:${item.policyId}`)).toEqual(['PAYMENT:257211994013', 'PAYMENT:257217501013', 'RETURN:19007008010'])
    expect(warnings).toEqual([])
  })

  it('模型原文语法坏了 → 该类回落旧下拉且不抛错（eBay 改模型结构不能让按钮变红）', async () => {
    const { policies } = await inspect({
      policyModels: { paymentPolicy: '{"options":[{"value":257211994013,', shippingPolicy: 'null', returnPolicy: '' },
      policyOptions: [{ kind: 'PAYMENT', raw: 'eBay 管理付款 (257217501013)', selected: true }]
    })
    expect(policies).toStrictEqual([{ kind: 'PAYMENT', label: 'eBay 管理付款', policyId: '257217501013', selected: true }])
  })

  it('页内脚本仍只切原文：解析与映射一句都不在页面里做，也绝不点控件', async () => {
    const { host, scripts } = makeHost({ policyModels: LIVE_MODELS })
    await inspectMethod.call(host, 'ebay:s1', '189035181453', 'Bracket')
    const script = scripts[0]
    expect(script).not.toContain('parseEbayPolicyModel')
    for (const field of ['paymentPolicy', 'shippingPolicy', 'returnPolicy']) expect(script, field).toContain(`"${field}":{"name"`)
    expect(script).toContain('policyModels')
    expect(script).not.toContain('d{6,}')
    expect(script).not.toMatch(/form\.submit\(|\.submit\(|type="submit"/)
    // J3 起菜单候选零点击（J1-premounted-options.json：列表未点开就已挂好），全脚本唯一点击是 Show more 展开折叠段
    expect(script.match(/\.click\(/g) || []).toHaveLength(1)
    expect(script).toContain('showMore.click()')
    expect((script.match(/btn\.click\(\)/g) || []).length).toBe(0)
  })
})

describe('ReviseItem 类目属性段抓取 · 槽位清单（R5 现网 ITEM SPECIFICS）', () => {
  it('页内回传的原文行在 TS 侧解成槽位：分组/控件类型/必填/占位/Suggested 全对得上现网', async () => {
    const { attributeSection } = await inspect({ attributeRows: ATTRIBUTE_ROWS, attributeGroups: ATTRIBUTE_GROUPS })
    const attributeSlots = attributeSection.slots
    expect(attributeSlots.map(item => item.name)).toEqual(['Brand', 'Type', 'Model', 'Item Width', 'California Prop 65 Warning', 'Unit Quantity'])
    expect(attributeSlots.find(item => item.name === 'Brand')).toMatchObject({ group: 'ESSENTIAL', control: 'MENU', required: true, value: 'Unbranded', placeholder: 'Search or enter your own' })
    expect(attributeSlots.find(item => item.name === 'Item Width')?.group).toBe('OPTIONAL')
    expect(attributeSlots.find(item => item.name === 'Model')).toMatchObject({ control: 'TEXT', suggested: 'Suzuki Grand Vitara II 2.0 J20A 95200-64JB1 95200-64JB0' })
    expect(attributeSlots.find(item => item.name === 'California Prop 65 Warning')).toMatchObject({ control: 'TEXTAREA', maxLength: 800, counter: '0/800' })
    expect(attributeSlots.find(item => item.name === 'Type')?.required).toBe(false)
  })

  it('槽位与旧 categorySpecifics 各走各的：Unit Quantity 这类带 quantity 的行不再被标签正则误删', async () => {
    const { attributeSection, categorySpecifics } = await inspect({ attributeRows: ATTRIBUTE_ROWS, attributeGroups: ATTRIBUTE_GROUPS })
    const attributeSlots = attributeSection.slots
    expect(attributeSlots.map(item => item.name)).toContain('Unit Quantity')
    expect(categorySpecifics).toEqual(CATEGORY)
  })

  it('一页只开一次就把槽位读回来，不额外开标签、不点任何控件', async () => {
    const { host, executeJavaScript } = makeHost({ attributeRows: ATTRIBUTE_ROWS })
    await inspectMethod.call(host, 'ebay:s1', '189035181453', 'Bracket')
    expect(executeJavaScript).toHaveBeenCalledTimes(1)
    expect(host.newEbayTab).toHaveBeenCalledTimes(1)
  })

  it('页内脚本只抄原文：分组/必填/控件类型判据一律不在属性采样这一段里做', async () => {
    const { host, scripts } = makeHost({ attributeRows: ATTRIBUTE_ROWS, attributeGroups: ATTRIBUTE_GROUPS })
    await inspectMethod.call(host, 'ebay:s1', '189035181453', 'Bracket')
    const script = scripts[0]
    const start = script.indexOf('const collectAttributes=()=>{')
    // 采样段必须真实存在且排在 return 之前，否则下面所有「段内不含判据」的断言都是空跑
    expect(start).toBeGreaterThan(-1)
    expect(script.indexOf('return {url:')).toBeGreaterThan(start)
    const section = script.slice(start, script.indexOf('return {url:'))
    expect(section).toContain('rows.push(')
    expect(section).toContain('groups.push(')
    expect(section).toContain('summary__attributes')
    expect(section).not.toContain('parseEbayItemSpecifics')
    // 判据用的类名与组名一个都不许出现在页内：页面只把 className/标签文本当原文抄走
    expect(section).not.toMatch(/parseEbayItemSpecifics|required-field|fake-menu-button|ESSENTIAL|OPTIONAL|YESNO|TRENDING|SEARCH_COUNT/)
    expect(script).not.toMatch(/form\.submit\(|\.submit\(|type="submit"/)
    // J3 起菜单候选零点击（J1-premounted-options.json：列表未点开就已挂好），全脚本唯一点击是 Show more 展开折叠段
    expect(script.match(/\.click\(/g) || []).toHaveLength(1)
    expect(script).toContain('showMore.click()')
    expect((script.match(/btn\.click\(\)/g) || []).length).toBe(0)
  })

  it('一段槽位都没读到 → 点名「页面未读取到类目属性」且返回空数组，不抛错（门禁不能 brick 读取动作）', async () => {
    const { attributeSection, warnings } = await inspect({ categorySpecifics: [], attributeRows: [], attributeGroups: [] })
    const attributeSlots = attributeSection.slots
    expect(attributeSlots).toEqual([])
    expect(warnings.filter(item => item.includes('页面未读取到类目属性'))).toHaveLength(1)
  })

  it('旧版页面根本没有 summary__attributes 区块 → 槽位为空但 categorySpecifics 照旧返回，且不误报类目属性缺口', async () => {
    const { attributeSection, categorySpecifics, warnings } = await inspect({ attributeRows: [], attributeGroups: [] })
    const attributeSlots = attributeSection.slots
    expect(attributeSlots).toEqual([])
    expect(categorySpecifics).toEqual(CATEGORY)
    expect(warnings.some(item => item.includes('页面未读取到类目属性'))).toBe(false)
  })
})

describe('ReviseItem 类目属性段抓取 · Suggested item specifics 卡片', () => {
  it('页内回传的卡片原文在 TS 侧解成建议卡：标题/逐项建议/Apply all 都对得上现网', async () => {
    const { suggestedCard } = await inspect({ attributeRows: ATTRIBUTE_ROWS, attributeGroups: ATTRIBUTE_GROUPS, attributeCard: ATTRIBUTE_CARD })
    expect(suggestedCard).toMatchObject({
      title: 'Suggested item specifics',
      items: [
        { name: 'Year Manufactured', value: '2020', checked: false },
        { name: 'Number of Compressors', value: '1', checked: false }
      ],
      applyAll: 'Apply all'
    })
    expect(suggestedCard?.blurb).toContain('powered by eBay.ai')
  })

  it('卡片没渲染出来就回 null，槽位清单照旧读到、不抛错（重载后 eBay.ai 卡片确实会消失）', async () => {
    const { suggestedCard, attributeSection } = await inspect({ attributeRows: ATTRIBUTE_ROWS, attributeGroups: ATTRIBUTE_GROUPS })
    const attributeSlots = attributeSection.slots
    expect(suggestedCard).toBeNull()
    expect(attributeSlots.map(item => item.name)).toContain('Brand')
  })

  it('卡片整块原文按行抄回：标题与说明的分界是块级换行，页内一把 clean 就把它抹平了', async () => {
    // 真机取证 2026-11-09 17:38：现网卡片 innerText 本来是 5 行，被 clean(/\s+/g,' ') 合成一行后
    // TS 侧无法分标题与说明，整段散文全被当成标题画出来。
    const { host, scripts } = makeHost({ attributeRows: ATTRIBUTE_ROWS, attributeGroups: ATTRIBUTE_GROUPS, attributeCard: ATTRIBUTE_CARD })
    await inspectMethod.call(host, 'ebay:s1', '189035181453', 'Bracket')
    const script = scripts[0]
    expect(script).toMatch(/const cleanLines=[^;]*split\('\\n'\)/)
    expect(script).toContain('attributeCard.text=cleanLines(cardNode.innerText)')
  })

  it('页内脚本补取卡片：只按文字锚点找块并抄整块原文与勾选态，判据一律不在页内做', async () => {
    const { host, scripts } = makeHost({ attributeRows: ATTRIBUTE_ROWS, attributeGroups: ATTRIBUTE_GROUPS, attributeCard: ATTRIBUTE_CARD })
    await inspectMethod.call(host, 'ebay:s1', '189035181453', 'Bracket')
    const script = scripts[0]
    const start = script.indexOf('const collectAttributes=()=>{')
    const section = script.slice(script.indexOf('const cleanLines='), script.indexOf('return {url:'))
    expect(start).toBeGreaterThan(-1)
    expect(section).toContain('attributeCard')
    expect(section).toContain('input[type=checkbox]')
    // 标题原文是定位锚点（页内按不区分大小写的正则找），可以出现在页内；解卡片与按钮的判据必须在 TS 侧
    expect(section).toMatch(/suggested item specifics/i)
    expect(section).not.toMatch(/parseEbayItemSpecifics|required-field|fake-menu-button|ESSENTIAL|OPTIONAL|applyAll/)
  })
})

describe('ReviseItem 政策抓取 · 落库与读取接线', () => {
  it('源码守卫：槽位清单跟着 requirements 走，不落库、不进 publish task', () => {
    expect(source('src/shared/contracts.ts')).toContain('attributeSection:EbayItemSpecificsSection')
    expect(source('src/main/main.ts')).not.toContain('saveEbayItemSpecificSlots')
    const handler = source('src/main/main.ts')
    const body = handler.slice(handler.indexOf("ipcMain.handle('ebay:local-products:requirements'"))
    const prepare = body.slice(0, body.indexOf("ipcMain.handle('ebay:local-products:prepare-revision'"))
    expect(prepare).not.toContain('attributeSlots')
    // 建议卡与槽位清单同口径：只在本次会话里给编辑器用，不落库、不进 publish task
    expect(source('src/shared/contracts.ts')).toContain('suggestedCard:EbaySuggestedSpecificsCard|null')
    expect(prepare).not.toContain('suggestedCard')
  })

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

/** 2026-11-09 22:1x AddItem 草稿页现网原文（导出与复原记录见会话）：pill 行、meta 按钮、组说明句、折叠两态。 */
const ADD_ITEM_ROWS = [
  { name: 'attributes.Brand', id: '', tag: 'BUTTON', controlClass: 'se-expand-button__button fake-menu-button__button btn', labelText: 'Brand', labelClass: '', text: '', value: '', placeholder: '', panelPlaceholder: '', maxLength: '', valueText: '', metaText: '', pills: [], hidden: false, y: 1477 },
  { name: 'attributes.Seat Type', id: '', tag: 'BUTTON', controlClass: 'se-expand-button__button fake-menu-button__button btn', labelText: 'Seat Type Trending', labelClass: '', text: '', value: '', placeholder: '', panelPlaceholder: '', maxLength: '', valueText: '', metaText: 'Trending', pills: [], hidden: false, y: 1785 },
  { name: 'Vintage Part', id: '', tag: 'PILLS', controlClass: '', labelText: 'Vintage Part ~ 209 searches', labelClass: '', text: '', value: '', placeholder: '', panelPlaceholder: '', maxLength: '', valueText: 'Yes No', metaText: '~ 209 searches', pills: [{ text: 'Yes', pressed: false }, { text: 'No', pressed: false }], hidden: false, y: 2177 },
  { name: 'universalProductCode', id: '', tag: 'INPUT', controlClass: 'textbox__control', labelText: 'UPC', labelClass: '', text: '', value: '', placeholder: 'Enter number', panelPlaceholder: '', maxLength: '20', valueText: '', metaText: '', pills: [], hidden: false, y: 2591 }
]
const ADD_ITEM_GROUPS = [
  { text: 'Required', y: 1417, blurb: 'Buyers need these details to find your item.' },
  { text: 'Additional (optional)', y: 1557, blurb: 'Buyers also search for these details.' }
]

describe('AddItem 现网形状回传 · TS 侧映射', () => {
  it('pill/meta/组说明句/折叠两态/加属性按钮都进 section，判据不在页内', async () => {
    const { attributeSection } = await inspect({
      attributeRows: ADD_ITEM_ROWS,
      attributeGroups: ADD_ITEM_GROUPS,
      attributeToggles: [{ text: 'Show less' }],
      attributeCustomAction: 'Add custom item specific',
      attributeCollapsedRows: ADD_ITEM_ROWS.slice(0, 2),
      attributeCollapsedToggles: [{ text: 'Show more' }]
    })
    expect(attributeSection.slots.find(item => item.name === 'Vintage Part')).toMatchObject({ control: 'YESNO', meta: '~ 209 searches', metaKind: 'SEARCH_COUNT' })
    expect(attributeSection.slots.find(item => item.name === 'Vintage Part')?.options).toEqual([{ text: 'Yes', pressed: false }, { text: 'No', pressed: false }])
    expect(attributeSection.slots.find(item => item.name === 'UPC')).toMatchObject({ control: 'TEXT', placeholder: 'Enter number' })
    expect(attributeSection.slots.find(item => item.name === 'Seat Type')?.metaKind).toBe('TRENDING')
    expect(attributeSection.groups).toEqual([
      { name: 'Required', blurb: 'Buyers need these details to find your item.' },
      { name: 'Additional (optional)', blurb: 'Buyers also search for these details.' }
    ])
    expect(attributeSection.toggleExpandedText).toBe('Show less')
    expect(attributeSection.toggleCollapsedText).toBe('Show more')
    expect(attributeSection.customActionText).toBe('Add custom item specific')
    expect(attributeSection.collapsedSlotNames).toEqual(['Brand', 'Seat Type'])
  })

  it('页内脚本只抄原文：pill 选中态与 meta 按钮照抄，判据词一个都不带', async () => {
    const made = makeHost({ attributeRows: [], attributeGroups: [] })
    await inspectMethod.call(made.host, 'ebay:s1', '189035181453', 'Bracket')
    const pageScript = made.scripts[0]
    expect(pageScript).toContain('aria-pressed')
    expect(pageScript).toContain('infotip__host')
    expect(pageScript).toContain('--custom-specific')
    expect(pageScript).toContain('show more')
    expect(pageScript).not.toContain('YESNO')
    expect(pageScript).not.toContain('SEARCH_COUNT')
    expect(pageScript).not.toContain('TRENDING')
  })
})

describe('读取刊登规则 · 开页路由（C5：载体优先 revise，缺载体按类目直入 AddItem）', () => {
  it('产品自身编号不是 eBay 在架编号时按平台类目直入首次刊登页，不再硬拼 ReviseItem', async () => {
    const made = makeHost({ attributeRows: [], attributeGroups: [] })
    await inspectMethod.call(made.host, 'ebay:s1', 'PALLET-W1739S00002', 'Bracket', '33701')
    const opened = (made.host.newEbayTab as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(opened[2])).toContain('mode=AddItem')
    expect(String(opened[2])).toContain('categoryId=33701')
    expect(String(opened[2])).not.toContain('mode=ReviseItem')
  })

  it('在架编号合法时照旧开修改页', async () => {
    const made = makeHost({ attributeRows: [], attributeGroups: [] })
    await inspectMethod.call(made.host, 'ebay:s1', '189035181453', 'Bracket', '')
    const opened = (made.host.newEbayTab as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(opened[2])).toContain('mode=ReviseItem&itemId=189035181453')
  })

  it('既无在架编号也无合格类目时不开页：把路由点名原句抛给操作员', async () => {
    const made = makeHost({ attributeRows: [], attributeGroups: [] })
    await expect(inspectMethod.call(made.host, 'ebay:s1', 'PALLET-X', 'Bracket', 'not-a-category'))
      .rejects.toThrow(/List an item|新建刊登/)
    expect((made.host.newEbayTab as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })
})

describe('ReviseItem 政策抓取 · I3/J3 菜单面板选项捕获', () => {
  const captureRegion = (script: string) =>
    script.slice(script.indexOf('const captureMenuOptions'), script.indexOf('return {url:location.href'))

  it('J3 按控件 name 绑行读该行自己的面板：不再拿被 clean 压平粘上 meta 的 labelText 去比对', async () => {
    const { host, scripts } = makeHost({})
    await inspectMethod.call(host, 'ebay:s1', '189035181453', 'Bracket')
    const region = captureRegion(scripts[0])
    expect(region).toContain('captureMenuOptions')
    // 现网展开按钮自带 name="attributes.X"（J1-named-controls.json），按 name 精确绑行
    expect(region).toContain('button.se-expand-button__button[name=')
    expect(region).toContain(".closest('.summary__attributes--field')")
    // 面板就嵌在本行 field 里（J1-panel-timing.json inField=true），不再抢「文档里第一个可见面板」
    expect(region).toContain("field.querySelector('.se-filter-menu-button__menu-container')")
    expect(region).not.toContain('clean(row.labelText)')
    expect(region).not.toContain('getClientRects')
  })

  it('J3 候选列表未点开就已挂好：整段捕获零点击，不改页面任何状态', async () => {
    const { host, scripts } = makeHost({})
    await inspectMethod.call(host, 'ebay:s1', '189035181453', 'Bracket')
    const region = captureRegion(scripts[0])
    expect(region).not.toContain('.click(')
    expect(region).not.toContain('setTimeout')
    expect(region).toContain('.filter-menu__items')
    expect(region).toContain('.menu__items')
    expect(region).toContain('out of\\s+([\\d,]+)\\s+options')
    expect(region).toContain('row.menuOptions=opts')
    expect(region).toContain('catch(error){row.menuOptions=[]')
  })

  it('J3 候选原文只取标签自己的文本节点：别名 span（textual-display）不粘进候选', async () => {
    const { host, scripts } = makeHost({})
    await inspectMethod.call(host, 'ebay:s1', '189035181453', 'Bracket')
    const region = captureRegion(scripts[0])
    expect(region).toContain('.filter-menu__text')
    expect(region).toContain('childNodes')
    expect(region).toContain('nodeType===3')
  })

  it('J3 失败事实照原文回传（按钮/面板在不在），是不是自行输入的判据不在页内做', async () => {
    const { host, scripts } = makeHost({})
    await inspectMethod.call(host, 'ebay:s1', '189035181453', 'Bracket')
    const script = scripts[0]
    const region = captureRegion(script)
    expect(region).toContain('row.menuButtonFound=')
    expect(region).toContain('row.menuPanelFound=')
    expect(script).not.toContain('Enter your own')
    expect(script).not.toContain('NO_LIST')
    expect(script).not.toContain('menuFreeText')
  })
})
