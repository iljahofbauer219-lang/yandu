import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { EbayItemSpecificsSection } from '../../../shared/ebayItemSpecificsModel'

/**
 * Task 8：Seller Hub ReviseItem「本地版本待确认」灌字段引擎从 3 项扩到 11 项（P1 收尾）。
 * 分工与 Task 5 同款：目标表（哪个字段 → 哪些正则 → 是否按政策 ID 命中）与 payload 构造（哪些值真的进页面）
 * 抽成纯模块 ebayLocalFill.ts，可离线断言；页内那段循环跑在 executeJavaScript 里，无法在这里执行，
 * 因此改为对「注入的脚本原文」做静态守卫（与 ebayPolicyScrape.test.ts 同一口径）。
 * 三条承重口径在这里钉死：
 *   1) APP 没记录（值为 undefined）的字段既不记 filled 也不记 skipped，页面原值不动（政策三项尤其重要）；
 *   2) 命中复选框一律算「跳过」，绝不点击——脚本里 .click( 只允许出现在 setValue 既有的复选框分支；
 *   3) 政策三项按 eBay 政策 ID 命中（option.value 或文本里的 `(政策ID)`），且只允许纯数字 ID 进下拉。
 * 真机待验（Task 9）：fixtures 证不了 eBay 页面真的把这三项政策渲染成可见的 <select>、
 * 也证不了 数量/所在地/邮编/SKU 的标签命中的是编辑框而不是复选框；见报告假设清单。
 */

vi.mock('electron', () => ({
  BaseWindow: class {},
  BrowserWindow: class {},
  WebContentsView: class {},
  WebContents: class {},
  clipboard: { readText: () => '', writeText: () => undefined }
}))

import { BrowserWorkspace } from '../BrowserWorkspace'
import { EBAY_LOCAL_FILL_TARGETS, ebayLocalFillPayload, ebayPolicyFillPlan } from '../ebayLocalFill'
import type { EbayLocalProduct, EbayProductDetails } from '../../../shared/contracts'
import type { EbayPolicyModelChoices } from '../../../shared/ebayPolicyModel'

const LABELS = ['标题', '价格', '描述', '数量', '商品状况', '付款政策', '运输政策', '退货政策', '商品所在地', '所在地邮编', '自定义编号']

/** brief 的样本 details（补齐 EbayProductDetails 的三个必填字段以过 typecheck，值本身与 brief 一致）。 */
const details: EbayProductDetails = {
  url: 'https://www.ebay.com/itm/T100', itemSpecifics: [], imageUrls: [],
  title: 'Bracket', descriptionHtml: '<p>x</p>', descriptionText: 'x', price: '9.9', quantity: '12', condition: 'New',
  paymentPolicy: '257217501013', shippingPolicy: '18510002003', returnPolicy: '19007008009',
  itemLocation: 'Guangdong, CN', postalCode: '528000', sku: 'PK-01'
}

const prepareMethod = BrowserWorkspace.prototype.prepareEbayLocalProductRevision as unknown as (
  this: Record<string, unknown>, accountId: string, product: EbayLocalProduct, section?: EbayItemSpecificsSection | null
) => Promise<{ reviseUrl: string; routeKind?: string; filledFields: string[]; skippedFields: string[]; warnings: string[]; submitButtonDetected: boolean; preparedAt: string }>

/** 现网内嵌模型的形状（与 ebayPolicyScrape.test.ts 同款构造器）：文案在 textSpans，编号在 option.value。 */
type ModelField = 'paymentPolicy' | 'shippingPolicy' | 'returnPolicy'
const modelSlice = (name: string, selected: number, options: Array<[number, string, string]>): string =>
  JSON.stringify({
    name,
    value: selected,
    options: options.map(([value, text, count]) => ({
      value,
      label: { _type: 'TextualDisplay', textSpans: [{ _type: 'TextSpan', text }] },
      ...(count ? { listingCount: { _type: 'TextualDisplay', textSpans: [{ _type: 'TextSpan', text: count }] } } : {})
    }))
  })
/** PRODUCT 的三个编号在这里都有唯一命中，所以默认计划是满的三条。 */
const LIVE_MODELS: Record<ModelField, string> = {
  paymentPolicy: modelSlice('paymentPolicyId', 257211994013, [[257211994013, 'eBay immediate payment', '[3409 listings]'], [257217501013, 'eBay Managed Payments (257217501013)', '[1 listing]']]),
  shippingPolicy: modelSlice('shippingPolicyId', 262233981013, [[262233981013, '云仓包邮', '(1901 listings)'], [18510002003, '云仓包邮经济', '(12 listings)']]),
  returnPolicy: modelSlice('returnsPolicyId', 262373278013, [[19007008009, '14天大健云仓退货', '(3407 listings)']])
}
const NO_MODELS: Record<ModelField, string> = { paymentPolicy: '', shippingPolicy: '', returnPolicy: '' }

/**
 * 用 fixtures 冒充内嵌浏览器：模型读取脚本回 policyModels，灌字段脚本回「已就绪且未提交」。
 * pending/passes 只服务 A4 的落定复检：
 *   pending  = 每一轮都报「点了但回读没确认」的政策（2026-11-08 现网取证到的失效率）；
 *   passes   = 按轮次给不同读数（第 1 轮没确认、第 2 轮确认），用来验主进程会不会重跑同一段脚本。
 */
function makeHost(page: {
  ready?: boolean
  submitButtonDetected?: boolean
  models?: Record<ModelField, string> | null
  pending?: string[]
  passes?: Array<{ filledFields?: string[]; skippedFields?: string[]; policyPending?: string[] }>
  specificsSettle?: Array<{ name: string; settled: boolean; reason: string }>
} = {}) {
  const scripts: string[] = []
  const modelScripts: string[] = []
  const models = page.models === null ? NO_MODELS : page.models ?? LIVE_MODELS
  let pass = 0
  const executeJavaScript = vi.fn(async (script: string) => {
    // E 批两段回读/横幅脚本：RTE 写入回读如实返 true（假页接受写入），横幅更新无返回值。
    if (script.includes('se-rte-frame')) return true
    // H5 类目属性写页脚本：按假页给的落定结果回传（缺省全落定），形状与页内脚本一致。
    if (script.includes('__yanduSpecificsWrite')) return page.specificsSettle ?? [{ name: 'Brand', settled: true, reason: '' }]
    if (script.includes('if(banner)banner.textContent=')) return undefined
    // 灌字段脚本带 const targets=，模型读取脚本只切三段内嵌模型原文；两类返回值形状不同，靠这个标记分流。
    if (!script.includes('const targets=')) {
      modelScripts.push(script)
      return { url: 'https://www.ebay.com/lstng?draftId=1&mode=ReviseItem', policyModels: models }
    }
    const step = page.passes?.[Math.min(pass, (page.passes?.length ?? 1) - 1)]
    pass += 1
    scripts.push(script)
    return {
      url: 'https://www.ebay.com/sl/list?mode=ReviseItem&itemId=T100',
      login: false,
      verification: false,
      // (b) 路由改造后页脚本恒带回 errorPage 读数（eBay 把开页拒成错误页时据此立即中止）；这里按「没落到错误页」如实冒充
      errorPage: { detected: false, reason: '' },
      ready: page.ready ?? true,
      filledFields: step?.filledFields ?? ['标题'],
      skippedFields: step?.skippedFields ?? (page.pending || []),
      // A4：政策点击的落定复检结果由页内带回；没有政策待确认时恒为空数组。
      policyPending: step?.policyPending ?? (page.pending || []),
      warnings: [],
      submitButtonDetected: page.submitButtonDetected ?? true
    }
  })
  const host: Record<string, unknown> = {
    newEbayTab: vi.fn(async () => 'tab-1'),
    detailTabs: new Map([['tab-1', { view: { webContents: { executeJavaScript } } }]]),
    sleep: async () => undefined
  }
  return { host, executeJavaScript, scripts, modelScripts }
}

const PRODUCT: EbayLocalProduct = {
  id: 'local-1', storeId: 's1', marketplaceId: 'EBAY_US', listingId: 'T100',
  categoryId: '601', categoryName: 'Cable Ties', platformCategoryId: '601', platformCategoryName: 'Cable Ties',
  coreTermZh: '扎带', coreTermEn: 'cable ties', title: 'Bracket', status: 'READY',
  versionCount: 1, latestSnapshotId: 'snap-1', downloadedAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z',
  snapshot: {
    id: 'snap-1', localProductId: 'local-1', version: 1,
    sourceListing: {
      id: 'listing-1', storeId: 's1', marketplaceId: 'EBAY_US', listingId: 'T100', sku: 'PK-01',
      title: '线上标题兜底', price: '7.5', currency: 'USD', quantity: 3, imageUrl: '',
      categoryId: '601', categoryName: 'Cable Ties', status: 'ACTIVE', viewUrl: 'https://www.ebay.com/itm/T100', updatedAt: '2026-11-01T00:00:00.000Z'
    },
    details,
    media: [
      { id: 'm1', mediaType: 'IMAGE', sortOrder: 0, remoteUrl: 'https://i.ebayimg.com/1', localPath: '/tmp/1.jpg', mimeType: 'image/jpeg', width: 1000, height: 1000, fileSize: 1, sha256: 'a', downloadStatus: 'DOWNLOADED' },
      { id: 'm2', mediaType: 'IMAGE', sortOrder: 1, remoteUrl: 'https://i.ebayimg.com/2', localPath: '', mimeType: 'image/jpeg', width: 0, height: 0, fileSize: 0, sha256: 'b', downloadStatus: 'FAILED' },
      { id: 'm3', mediaType: 'VIDEO', sortOrder: 2, remoteUrl: 'https://i.ebayimg.com/3', localPath: '/tmp/3.mp4', mimeType: 'video/mp4', width: 0, height: 0, fileSize: 1, sha256: 'c', downloadStatus: 'DOWNLOADED' }
    ],
    completeness: 100, missingFields: [], contentHash: 'hash', capturedAt: '2026-11-01T00:00:00.000Z'
  }
}

/** 注入页面的目标表线格式：patterns 已是 .source 源串。 */
type TargetWire = { label: string; key: string; byPolicyId?: boolean; patterns: string[]; selectors?: string }

/** 取出脚本里 `const <name>=<JSON>;` 那一行的字面量并解析回给定形状。 */
function literalOf<T = Record<string, unknown>>(script: string, name: string): T {
  const line = script.split('\n').map(item => item.trim()).find(item => item.startsWith(`const ${name}=`))
  if (!line) throw new Error(`注入脚本里找不到 const ${name}= 这一行`)
  const body = line.slice(`const ${name}=`.length)
  return JSON.parse(body.endsWith(';') ? body.slice(0, -1) : body) as T
}

const runPrepare = async (page: { ready?: boolean; submitButtonDetected?: boolean; models?: Record<ModelField, string> | null; specificsSettle?: Array<{ name: string; settled: boolean; reason: string }> } = {}) => {
  const { host, scripts, modelScripts, executeJavaScript } = makeHost(page)
  const result = await prepareMethod.call(host, 'ebay:s1', PRODUCT)
  // 现在四段：先读一次内嵌模型（现网模型跟页面 HTML 一起来，一次就有），再跑灌字段脚本，
  // E 批之后还有描述 RTE 回读落定与横幅按实际填/跳重写两次（harness 无 debugger，媒体段跳过）。
  expect(executeJavaScript).toHaveBeenCalledTimes(4)
  return { script: scripts[0], modelScript: modelScripts[0], result }
}

describe('eBay 本地版本灌字段目标表', () => {
  it('目标表覆盖 11 个字段，标题/价格/描述仍在最前且现有 label 文案不变', () => {
    expect(EBAY_LOCAL_FILL_TARGETS.map(item => item.label)).toEqual(LABELS)
  })

  it('政策三项按 policyId 命中，其它走文本匹配', () => {
    expect(EBAY_LOCAL_FILL_TARGETS.filter(item => item.byPolicyId).map(item => item.label)).toEqual(['付款政策', '运输政策', '退货政策'])
  })

  it('payload 只带非空值，空字段不进目标表以便计入 skipped 判定', () => {
    const payload = ebayLocalFillPayload({ ...details, condition: '', postalCode: '  ' })
    expect(payload.condition).toBeUndefined()
    expect(payload.postalCode).toBeUndefined()
    expect(payload.quantity).toBe('12')
    expect(payload.shippingPolicy).toBe('18510002003')
  })

  it('进 payload 的值一律裁边：纯空白等于没写，前后空格不会带到 eBay 输入框', () => {
    const payload = ebayLocalFillPayload({ ...details, quantity: ' 12 ', itemLocation: '  Guangdong, CN  ', sku: '\t\n' })
    expect(payload.quantity).toBe('12')
    expect(payload.itemLocation).toBe('Guangdong, CN')
    expect(payload.sku).toBeUndefined()
    expect(Object.values(payload).every(value => value === value.trim() && value.length > 0)).toBe(true)
  })

  it('描述优先 HTML，只有 HTML 为空才回落纯文本，两者皆空则整个字段不进 payload', () => {
    expect(ebayLocalFillPayload({ ...details, descriptionHtml: '  ', descriptionText: '纯文本详情' }).description).toBe('纯文本详情')
    expect(Object.keys(ebayLocalFillPayload({ ...details, descriptionHtml: '', descriptionText: '' }))).not.toContain('description')
  })

  it('payload 的键只能是目标表里出现过的 key，多出来的字段页面永远不会灌（防止静默漏字段）', () => {
    const keys = EBAY_LOCAL_FILL_TARGETS.map(item => item.key)
    expect(new Set(Object.keys(ebayLocalFillPayload(details)))).toEqual(new Set(keys))
    expect(keys).toEqual(['title', 'price', 'description', 'quantity', 'condition', 'paymentPolicy', 'shippingPolicy', 'returnPolicy', 'itemLocation', 'postalCode', 'sku'])
  })

  it('标题/价格可吃线上刊登兜底（含纯空白），其余 9 项没有兜底来源也不许吃标题的值', () => {
    const fallbacks = { title: '线上标题兜底', price: '7.5' }
    const payload = ebayLocalFillPayload({ ...details, title: '   ', price: '', quantity: '  ', sku: '' }, fallbacks)
    expect(payload.title).toBe('线上标题兜底')
    expect(payload.price).toBe('7.5')
    expect(payload.quantity).toBeUndefined()
    expect(payload.sku).toBeUndefined()
    expect(ebayLocalFillPayload({ ...details, title: '存档标题' }, fallbacks).title).toBe('存档标题')
    expect(ebayLocalFillPayload(details).title).toBe('Bracket')
  })
})

describe('Seller Hub 灌字段脚本 · 注入的目标表', () => {
  it('注入的 targets 恰好 11 项、标签顺序与目标表一致（页面按这张表循环）', async () => {
    const { script } = await runPrepare()
    const targets = literalOf<TargetWire[]>(script, 'targets')
    expect(Array.isArray(targets)).toBe(true)
    expect(targets).toHaveLength(11)
    expect(targets.map(item => item.label)).toEqual(LABELS)
    expect(targets.map(item => item.key)).toEqual(EBAY_LOCAL_FILL_TARGETS.map(item => item.key))
    expect(targets.filter(item => item.byPolicyId).map(item => item.label)).toEqual(['付款政策', '运输政策', '退货政策'])
  })

  it('序列化后的 patterns 是正则源串（.source）而非正则字面量：漏掉 .source 会让 JSON 变成空对象', async () => {
    const { script } = await runPrepare()
    const targets = literalOf<TargetWire[]>(script, 'targets')
    expect(targets.every(item => Array.isArray(item.patterns) && item.patterns.length > 0)).toBe(true)
    expect(targets.map(item => item.patterns)).toEqual(EBAY_LOCAL_FILL_TARGETS.map(item => item.patterns.map(pattern => pattern.source)))
    expect(targets.every(item => item.patterns.every(pattern => typeof pattern === 'string' && !/^\/.*\/[a-z]*$/.test(pattern)))).toBe(true)
  })

  it('页内用 i 标志重建正则：丢掉标志位就是真页面上的静默不命中', async () => {
    const { script } = await runPrepare()
    expect(script).toContain("patterns.map(source=>new RegExp(source,'i'))")
    expect(script.match(/new RegExp\(/g)).toHaveLength(1)
  })

  it('三处标签碰撞封死：数量模式不含 sold quantity 且中文支挡住已售数量，「所在地邮编」不被商品所在地命中（一律按页内重建后的源串断言）', async () => {
    const { script } = await runPrepare()
    const targets = literalOf<TargetWire[]>(script, 'targets')
    /**
     * 与页面完全同路：目标表先被 JSON 序列化（patterns 只剩 .source），页内再用 new RegExp(source,'i') 重建，
     * 这里照此重建后再 test，断言的是真页面上跑的那批模式，不是 TS 字面量。
     */
    const rebuilt = (key: string) => {
      const patterns = targets.find(item => item.key === key)?.patterns
      if (!patterns) throw new Error(`注入的 targets 里找不到 ${key}`)
      return patterns.map(source => new RegExp(source, 'i'))
    }
    const hits = (key: string, label: string) => rebuilt(key).some(pattern => pattern.test(label))

    // Important-1：已售数量属读取/抓取侧（src/shared/ebayMarketResearchParse.ts 的 TOTAL_SOLD），
    // 写入侧若命中它会把 APP 库存灌进销量框，还照报「填写 数量」。
    expect(rebuilt('quantity').map(pattern => pattern.source).some(source => /sold quantity/i.test(source))).toBe(false)
    expect(hits('quantity', 'Sold quantity')).toBe(false)
    expect(hits('quantity', 'sold quantity')).toBe(false)
    // 收紧只砍销量控件：正常数量框与「可用数量」口径不变。
    expect(hits('quantity', 'Quantity')).toBe(true)
    expect(hits('quantity', 'Available quantity')).toBe(true)
    expect(hits('quantity', 'Quantity available')).toBe(true)
    expect(hits('quantity', '数量')).toBe(true)
    // R3 同款对称口径：页内 test 的串以 label 开头（labelFor(field)+' '+name+' '+id），
    // 无锚点 /数量/ 会让中文界面的「已售数量」销量框抢走库存写入——与上面 Important-1 同一种「写错控件+假成功」，
    // 所以中文支用整串否定预查（.*(已售|销量) 出现即整串拒绝），同时保住带前缀的正常库存 label。
    expect(hits('quantity', '已售数量 quantity totalSoldQuantity')).toBe(false)
    expect(hits('quantity', '可用数量 quantity quantity-field')).toBe(true)

    // Important-2：「所在地」是「所在地邮编」的子串，邮编框在 DOM 里靠前时 itemLocation 的 find 会选中邮编框，
    // 随后 postalCode（循环第 9 项）再覆盖它 —— filledFields 同时报两项、真所在地却一个字没动（假成功）。
    expect(hits('itemLocation', '所在地邮编')).toBe(false)
    expect(hits('postalCode', '所在地邮编')).toBe(true)
    // 页内 label 的实际拼接形状是 labelFor(field)+' '+(field.name||'')+' '+(field.id||'')。
    expect(hits('itemLocation', '所在地邮编 postal-code itemLocation')).toBe(false)
    expect(hits('postalCode', '所在地邮编 postal-code itemLocation')).toBe(true)
    expect(hits('itemLocation', '商品所在地')).toBe(true)
    expect(hits('itemLocation', '所在地')).toBe(true)
    expect(hits('postalCode', '商品所在地')).toBe(false)
    // 英文侧模式与 postalCode 的模式本条未动，回归留痕。
    expect(hits('itemLocation', 'Item location')).toBe(true)
    expect(hits('itemLocation', 'Ships from')).toBe(true)
    expect(hits('postalCode', 'ZIP code')).toBe(true)
  })

  it('标题字段的 find 行与 ready 判定原样保留（主进程 if(!result.ready) 抛错仍成立）', async () => {
    const { script } = await runPrepare()
    expect(script).toContain(String.raw`const titleField=find([/^(item |listing )?title\b/i,/物品标题|商品标题|刊登标题/], 'input[name="title"],input[id="title"]');`)
    expect(script).toContain('ready:Boolean(titleField)')
  })

  it('desired 带齐 11 个非空值；本地图片数只算 DOWNLOADED 且有本地路径的行（沿用既有口径：视频行也计入）', async () => {
    const { script } = await runPrepare()
    const desired = literalOf(script, 'desired')
    expect(Object.keys(desired).sort()).toEqual([...EBAY_LOCAL_FILL_TARGETS.map(item => item.key), 'localImageCount'].sort())
    expect(desired.title).toBe('Bracket')
    expect(desired.paymentPolicy).toBe('257217501013')
    expect(desired.localImageCount).toBe(2)
  })

  it('details 缺标题/价格时仍回落到线上刊登原值（与主进程完成度读数同一口径）', async () => {
    const host = makeHost()
    await prepareMethod.call(host.host, 'ebay:s1', { ...PRODUCT, snapshot: { ...PRODUCT.snapshot, details: { ...details, title: '  ', price: '' } } })
    const desired = literalOf(host.scripts[0], 'desired')
    expect(desired.title).toBe('线上标题兜底')
    expect(desired.price).toBe('7.5')
  })
})

describe('Seller Hub 灌字段脚本 · 循环语义守卫', () => {
  it('APP 没记录的字段既不记 filled 也不记 skipped：undefined 判定必须在政策分支之前', async () => {
    const { script } = await runPrepare()
    expect(script).toContain('if(desired[target.key]===undefined)continue;')
    expect(script.indexOf('if(desired[target.key]===undefined)continue;')).toBeGreaterThan(script.indexOf('for(const target of targets){'))
    expect(script.indexOf('if(desired[target.key]===undefined)continue;')).toBeLessThan(script.indexOf('if(target.byPolicyId)'))
  })

  it('命中复选框一律算跳过、绝不点击（勾选框不是本计划授权写入的控件）', async () => {
    const { script } = await runPrepare()
    expect(script).toContain("if(field&&field.type==='checkbox'){skippedFields.push(target.label);continue}")
    const guard = script.indexOf("if(field&&field.type==='checkbox'){skippedFields.push(target.label);continue}")
    expect(guard).toBeGreaterThan(script.indexOf('const field=find('))
    expect(guard).toBeLessThan(script.indexOf('fill(target.label,'))
  })

  it('全脚本只有两处点击：复选框分支与政策选项分支；没有第三条点击路径，也没有任何 form 提交', async () => {
    const { script } = await runPrepare()
    expect(script.match(/\.click\(/g)).toHaveLength(2)
    const clickLines = script.split('\n').filter(line => line.includes('.click()'))
    expect(clickLines).toHaveLength(2)
    expect(clickLines.some(line => line.includes("if(field.type==='checkbox')"))).toBe(true)
    // 第二条只许点在 [role=option] 节点上（政策选项），绝不允许指向提交/保存类按钮
    expect(clickLines.some(line => /\[role="option"\]|option\b/i.test(line))).toBe(true)
    expect(clickLines.some(line => /button|submit|form/i.test(line))).toBe(false)
  })

  it('零提交底线：不新增 .submit( 调用，type="submit" 只允许留在既有的按钮探测里', async () => {
    const { script } = await runPrepare()
    expect(script).not.toMatch(/\.submit\(/)
    const submitSelectorLines = script.split('\n').filter(line => line.includes('type="submit"'))
    expect(submitSelectorLines).toHaveLength(1)
    expect(submitSelectorLines[0]).toContain('const submitButtonDetected=')
    expect(script).toContain('尚未提交')
  })

  it('政策三项改由主进程算出的计划驱动：命中不了的政策既不填也不跳，页面保留原值', async () => {
    const { script } = await runPrepare()
    expect(script).toContain('const plan=policyPlan.find(item=>item.key===target.key);')
    expect(script).toContain('if(!plan)continue;')
    expect(script).toContain('if(target.byPolicyId){')
    expect(script).not.toContain('if(selectByPolicyId(field,desired[target.key]))')
  })

  it('<select> 老路径一字不动：仍是纯数字 ID 门禁 + option.value 整串相等或 (编号) 文本兜底', async () => {
    const { script } = await runPrepare()
    expect(script).toContain('/^\\d+$/.test(want)')
    expect(script).toContain('clean(item.value)===want')
    expect(script).toContain("clean(item.textContent).includes('('+want+')')")
    expect(script).toContain("field.tagName!=='SELECT'")
  })

  it('描述仍走 textarea/contenteditable 专用分支，不复用文本 find', async () => {
    const { script } = await runPrepare()
    expect(script).toContain("if(target.key==='description'){")
    expect(script).toContain("fill('描述',field,desired.description);")
  })

  it('四行手写 fill 已被循环取代（标题/价格/描述的旧硬编码不再各写一遍）', async () => {
    const { script } = await runPrepare()
    expect(script).not.toContain("fill('标题',titleField,desired.title)")
    expect(script).not.toContain("fill('价格',find(")
    expect(script).not.toContain('const descriptionField=')
  })

  it('warnings 只点名本次真正填上/跳过的字段：固定枚举 11 类（会把没填的政策也说成填了）必须消失', async () => {
    const { script } = await runPrepare()
    const line = script.split('\n').map(item => item.trim()).find(item => item.startsWith("warnings.push('本次"))
    expect(line).toBeDefined()
    // 点名内容取自页内回读出来的两份清单，而不是写死的字段表
    expect(line).toContain('filledFields')
    expect(line).toContain('skippedFields')
    expect(line).toContain('人工核对')
    expect(line).toContain('尚未提交')
    expect(line).not.toContain('商品所在地、邮编与 SKU')
    expect(line).not.toContain('付款/运输/退货政策')
    expect(script).not.toContain('本次只准备标题、描述和价格')
  })

  it('标题字段始终读不到时按既有中文错误硬点名（扩到 11 项后 ready 判定不得被稀释）', async () => {
    // 这条守的是「修改页」这条老路：PRODUCT 的 T100 会被路由判成首次刊登，所以这里换一个真在架编号，让文案逐字锁回原句。
    const { host, executeJavaScript } = makeHost({ ready: false })
    await expect(prepareMethod.call(host, 'ebay:s1', { ...PRODUCT, listingId: '189035181453', platformCategoryId: '' }))
      .rejects
      .toThrow('Seller Hub 修改页尚未加载出标题字段，请确认商品仍在线后重试')
    // ready 抛错发生在 E 批两段回读之前：模型 1 次 + 轮询 20 次，不多不少。
    expect(executeJavaScript).toHaveBeenCalledTimes(21)
  })
})

/**
 * 缺陷 (a) 第 0 步：现网政策控件是 input[role=combobox]，框里存的是「名称 + 在架数」，往它写编号
 * 等于在页面上留一个谁都不认识的字符串（还会被报成已填）。要选中一项政策，得先在本页内嵌模型里
 * 把 APP 存的 政策编号 换成 该选项的显示文本，再把文本交给页面去点那个 [role=option]。
 * 这一步是纯映射，所以钉在这里：只有「编号是纯数字」且「本页模型里唯一命中该编号」才允许出计划，
 * 命中不了就一条都不出——宁可让页面保留 eBay 线上原值，也绝不按名称猜一条政策（猜错就是改错政策）。
 */
describe('政策灌字段计划 · 编号换选项显示文本', () => {
  const control = (controlName: string, pairs: Array<[string, string]>): EbayPolicyModelChoices => ({
    controlName,
    options: pairs.map(([id, text]) => ({ id, text }))
  })
  const models: Partial<Record<'paymentPolicy' | 'shippingPolicy' | 'returnPolicy', EbayPolicyModelChoices>> = {
    paymentPolicy: control('paymentPolicyId', [['257217501013', 'eBay Managed Payments (257217501013) [1 listing]']]),
    shippingPolicy: control('shippingPolicyId', [['18510002003', '云仓包邮 (1901 listings)']]),
    returnPolicy: control('returnsPolicyId', [['19007008009', '14天大健云仓退货 (3407 listings)']])
  }

  it('三项都能按编号命中 → 出三条计划，中文点名与 anchor 一并带上，顺序跟目标表一致', () => {
    expect(ebayPolicyFillPlan(details, models)).toEqual([
      { key: 'paymentPolicy', label: '付款政策', anchor: 'paymentPolicyId', policyId: '257217501013', optionText: 'eBay Managed Payments (257217501013) [1 listing]' },
      { key: 'shippingPolicy', label: '运输政策', anchor: 'shippingPolicyId', policyId: '18510002003', optionText: '云仓包邮 (1901 listings)' },
      { key: 'returnPolicy', label: '退货政策', anchor: 'returnsPolicyId', policyId: '19007008009', optionText: '14天大健云仓退货 (3407 listings)' }
    ])
  })

  it('APP 没记录的政策一条都不出（页面保留线上原值，既不填也不跳，与 payload 空值口径对称）', () => {
    const partial = ebayPolicyFillPlan({ ...details, returnPolicy: undefined }, models)
    expect(partial.map(item => item.key)).toEqual(['paymentPolicy', 'shippingPolicy'])
    expect(ebayPolicyFillPlan({ ...details, shippingPolicy: '   ' }, models).map(item => item.key)).toEqual(['paymentPolicy', 'returnPolicy'])
  })

  it('政策键里存的是历史脏名称而不是编号 → 不出计划；这种值写进 combobox 就是把框改坏', () => {
    expect(ebayPolicyFillPlan({ ...details, paymentPolicy: 'eBay Managed Payments' }, models).map(item => item.key)).toEqual(['shippingPolicy', 'returnPolicy'])
    expect(ebayPolicyFillPlan({ ...details, paymentPolicy: '25721750101 3' }, models).map(item => item.key)).toEqual(['shippingPolicy', 'returnPolicy'])
  })

  it('编号在本页模型选项里找不到（政策已删/换店铺）→ 不出计划，也绝不退回按名称猜一条', () => {
    const absent = { ...models, shippingPolicy: control('shippingPolicyId', [['266273287013', '中国直邮包邮 (1515 listings)']]) }
    expect(ebayPolicyFillPlan(details, absent).map(item => item.key)).toEqual(['paymentPolicy', 'returnPolicy'])
    // 名称几乎一样、编号不同的那一条不能被当成命中
    const nearMiss = { ...models, shippingPolicy: control('shippingPolicyId', [['262233981013', '云仓包邮 (1901 listings)']]) }
    expect(ebayPolicyFillPlan(details, nearMiss).map(item => item.key)).toEqual(['paymentPolicy', 'returnPolicy'])
  })

  it('同一编号在本页出现两次 → 歧义，一条都不点（点了也是赌哪个是它）', () => {
    const duplicated = { ...models, returnPolicy: control('returnsPolicyId', [['19007008009', '14天大健云仓退货 (3407 listings)'], ['19007008009', '14天大健云仓退货 (0 listings)']]) }
    expect(ebayPolicyFillPlan(details, duplicated).map(item => item.key)).toEqual(['paymentPolicy', 'shippingPolicy'])
  })

  it('模型没给出控件名 → 页内无从定位这个政策的框，不出计划', () => {
    const nameless = { ...models, paymentPolicy: control('', [['257217501013', 'eBay Managed Payments (257217501013) [1 listing]']]) }
    expect(ebayPolicyFillPlan(details, nameless).map(item => item.key)).toEqual(['shippingPolicy', 'returnPolicy'])
  })

  it('整页模型都没读到 → 空计划，不抛错（政策一项都不动，交回页面人工核对）', () => {
    expect(ebayPolicyFillPlan(details, {})).toEqual([])
    expect(ebayPolicyFillPlan(details, undefined)).toEqual([])
  })

  it('计划里的中文点名必须与目标表三项逐字一致（横幅与 skipped 计数靠同一个字符串对齐）', () => {
    const plan = ebayPolicyFillPlan(details, models)
    const tableLabels = EBAY_LOCAL_FILL_TARGETS.filter(item => item.byPolicyId).map(item => item.label)
    expect(plan.map(item => item.label)).toEqual(tableLabels)
    expect(plan.map(item => item.key)).toEqual(EBAY_LOCAL_FILL_TARGETS.filter(item => item.byPolicyId).map(item => item.key))
  })
})

/**
 * A4（2026-11-08 真机取证后的缺陷收口）：现网取证到「点中了 option、框里的文本当场变了，但 eBay 随后把政策控件
 * 按草稿原值重渲染」——同步回读 `combo.value===want` 在那一刻为真，于是 filledFields 谎报已填，页面实际一个字没动。
 * 同页稳定后再点同一选项却会一直生效（value 立即变、aria-selected 约 400ms 后跟上、20s 不回退），
 * 所以错的不是点击方式，而是「点得太早 + 回读太早」。这里钉三条：
 *   1) 政策分支必须等一次再回读，回读没确认就不算填上（进 skipped，同时进 policyPending 让主进程知道还没落定）；
 *   2) 主进程看到 policyPending 非空时重跑同一段脚本（页面更晚就更稳），但重试有上限，绝不把「准备发布」拖成无限等；
 *   3) 本页根本没有政策控件时算终局跳过，不许当成「待落定」空转重试。
 */
describe('Seller Hub 灌字段脚本 · 政策点击的落定复检与重试', () => {
  it('政策不许点完当场算填上：脚本改异步、点完等一次再回读，未确认进 policyPending', async () => {
    const { script } = await runPrepare()
    expect(script.trimStart().startsWith('(async () =>')).toBe(true)
    const branch = script.slice(script.indexOf('if(target.byPolicyId){'), script.indexOf('const field=find('))
    expect(branch).toContain('await wait(')
    expect(branch).toContain('policyPending.push(target.label)')
    expect(branch).toContain('skippedFields.push(target.label)')
    // 旧的那条「点完立刻同步读 value 就算填上」必须消失
    expect(script).not.toMatch(/hit\[0\]\.click\(\);if\(clean\(combo\.value\)/)
    // 点击仍只有一处，且只落在选项节点上
    expect(branch.match(/\.click\(/g)).toHaveLength(1)
  })

  it('本页没有该政策控件（现网退货政策就是如此）→ 终局跳过，不进 policyPending，免得主进程空转重试', async () => {
    const { script } = await runPrepare()
    const legacy = script.split('\n').find(line => line.includes("selectByPolicyId(document.querySelector('select[name=\"")) || ''
    expect(legacy).toContain('skippedFields.push(target.label)')
    expect(legacy).not.toContain('policyPending')
  })

  it('第 1 轮回读没确认、第 2 轮确认 → 主进程重跑同一段脚本，并按最后一轮的分类报（付款政策这次真算填上）', async () => {
    const { host, executeJavaScript } = makeHost({
      passes: [
        { filledFields: ['标题'], skippedFields: ['付款政策'], policyPending: ['付款政策'] },
        { filledFields: ['标题', '付款政策'], skippedFields: [], policyPending: [] }
      ]
    })
    const result = await prepareMethod.call(host, 'ebay:s1', PRODUCT)
    expect(executeJavaScript.mock.calls.filter(call => String(call[0]).includes('const targets='))).toHaveLength(2)
    expect(result.filledFields).toContain('付款政策')
    expect(result.skippedFields).not.toContain('付款政策')
  })

  it('一直落不定 → 有上限地重试后按未填处理并如实点名，绝不抛错也绝不限死等下去', async () => {
    const { host, executeJavaScript } = makeHost({ pending: ['付款政策'] })
    const result = await prepareMethod.call(host, 'ebay:s1', PRODUCT)
    const fillCalls = executeJavaScript.mock.calls.filter(call => String(call[0]).includes('const targets=')).length
    expect(fillCalls).toBeGreaterThan(1)
    expect(fillCalls).toBeLessThanOrEqual(6)
    expect(result.filledFields).not.toContain('付款政策')
    expect(result.skippedFields).toContain('付款政策')
    const named = result.warnings.filter(text => text.includes('付款政策') && text.includes('人工核对'))
    expect(named).toHaveLength(1)
    expect(named[0]).toContain('未计入已填')
  })
})

/**
 * 缺陷 (a) 的落点：计划由主进程算好后注入页面，页面只做三件事——
 * 按模型给出的控件名定位 combobox、在它 aria-controls 的列表里按整串文本找那唯一一条选项、点完回读。
 * 回读不认就算跳过：eBay 的 React 控件可以吞掉一次点击，吞掉却报「已填」就是把线上政策当已改。
 * 另一条底线是把编号写进框里这条路彻底封死：编号不是框认识的文本，写进去既显示不对也不算选中。
 */
describe('Seller Hub 灌字段脚本 · 政策 combobox 分支', () => {
  type PlanWire = { key: string; label: string; anchor: string; policyId: string; optionText: string }

  it('注入的 policyPlan 用本页模型算出：anchor 是模型自己的控件名，optionText 是选项整串（含在架数）', async () => {
    const { script } = await runPrepare()
    expect(literalOf<PlanWire[]>(script, 'policyPlan')).toEqual([
      { key: 'paymentPolicy', label: '付款政策', anchor: 'paymentPolicyId', policyId: '257217501013', optionText: 'eBay Managed Payments (257217501013) [1 listing]' },
      { key: 'shippingPolicy', label: '运输政策', anchor: 'shippingPolicyId', policyId: '18510002003', optionText: '云仓包邮经济 (12 listings)' },
      { key: 'returnPolicy', label: '退货政策', anchor: 'returnsPolicyId', policyId: '19007008009', optionText: '14天大健云仓退货 (3407 listings)' }
    ])
  })

  it('combobox 按 name 定位、选项只在该控件 aria-controls 的列表里找、整串文本唯一命中才点', async () => {
    const { script } = await runPrepare()
    expect(script).toContain('input[role="combobox"][name="')
    expect(script).toContain("getAttribute('aria-controls')")
    expect(script).toContain('[role="option"]')
    expect(script).toContain('clean(node.textContent)===want')
    expect(script).toContain('hit.length===1')
    expect(script).toContain('hit[0].click()')
  })

  it('点完必须回读才算填上：input value 整串相等或该选项 aria-selected=true，否则算跳过', async () => {
    const { script } = await runPrepare()
    expect(script).toContain('clean(combo.value)===want')
    expect(script).toContain("getAttribute('aria-selected')==='true'")
  })

  it('绝不把政策编号写进 combobox：页内没有任何对 combo 的 setValue 或对它的文本写入', async () => {
    const { script } = await runPrepare()
    expect(script).not.toMatch(/setValue\(combo/)
    expect(script).not.toMatch(/combo\.value=/)
  })

  it('命中 0 条或多条一律跳过、一次都不点（歧义时点中哪条是赌）', async () => {
    const { script } = await runPrepare()
    const branch = script.slice(script.indexOf('if(target.byPolicyId){'), script.indexOf('fill(target.label,'))
    expect(branch).toContain('else skippedFields.push(target.label)')
    // 政策分支里唯一的点击只有 hit[0].click() 这一处
    expect(branch.match(/\.click\(/g)).toHaveLength(1)
  })

  it('编号在本页选项里没找到 → 该政策不进计划、页面原值不动，并如实点名要人工核对', async () => {
    const { script, result } = await runPrepare({
      models: { ...LIVE_MODELS, shippingPolicy: modelSlice('shippingPolicyId', 262233981013, [[262233981013, '云仓包邮', '(1901 listings)']]) }
    })
    expect(literalOf<PlanWire[]>(script, 'policyPlan').map(item => item.key)).toEqual(['paymentPolicy', 'returnPolicy'])
    const named = result.warnings.filter(text => text.includes('运输政策'))
    expect(named).toHaveLength(1)
    expect(named[0]).toContain('人工核对')
    expect(result.warnings.filter(text => text.includes('付款政策'))).toHaveLength(0)
  })

  it('整页模型都没读到 → 计划为空、一项政策都不动，但绝不抛错打断「准备发布」这个动作', async () => {
    const { script, result } = await runPrepare({ models: null })
    expect(literalOf<PlanWire[]>(script, 'policyPlan')).toEqual([])
    const named = result.warnings.filter(text => text.includes('付款政策') && text.includes('运输政策') && text.includes('退货政策'))
    expect(named).toHaveLength(1)
    // E 批后描述走 RTE 回读落定：假页接受写入，故描述与标题同记已填。
    expect(result.filledFields).toEqual(['标题', '描述'])
  })

  it('模型原文用与政策抓取同一份锚点切片（两处各写一遍迟早漂移）', async () => {
    const { modelScript, script } = await runPrepare()
    for (const field of ['paymentPolicy', 'shippingPolicy', 'returnPolicy']) {
      expect(modelScript).toContain('"' + field + '":{"name"')
    }
    expect(modelScript).toContain('objectAt')
    // 灌字段脚本自己不读模型：编号→文本的映射已经在主进程做完
    expect(script).not.toContain('"paymentPolicy":{"name"')
  })
})

describe('AddItem 页图片与描述写入（E 批静态守卫）', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')
  it('图片走既有的 debugger 选文件通道：认 fehelix 上传控件，多文件一次投递', () => {
    expect(source).toContain('fehelix-uploader')
    expect(source).toContain('DOM.setFileInputFiles')
    expect(source).toContain('planEbayUploadMedia')
  })
  it('图片写入后回读缩略图计数落定才记 filled：不凭 setFileInputFiles 返回就谎报', () => {
    expect(source).toContain(')\\\\s*\\\\/\\\\s*25')
    expect(source).toContain('图片')
  })
  it('描述认 RTE 同源 iframe：写 contenteditable 并派 input 事件，回读文本长度落定', () => {
    expect(source).toContain('se-rte-frame')
    expect(source).toContain('contenteditable')
    expect(source).toContain('InputEvent')
  })
  it('判据不在页内：编排上限与丢弃原因都在 TS/shared 侧', () => {
    const pageScriptStart = source.indexOf('const fill=(label,field,value)')
    const pageScript = source.slice(pageScriptStart, source.indexOf('const POLICY_SETTLE_MAX_ATTEMPTS=6', pageScriptStart))
    expect(pageScriptStart).toBeGreaterThan(-1)
    expect(pageScript).not.toContain('planEbayUploadMedia(')
    expect(pageScript).not.toContain('EBAY_IMAGE_LIMIT')
  })
})

describe('H5 · 类目属性写页与回读落定', () => {
  const section: EbayItemSpecificsSection = {
    slots: [
      { name: 'Brand', group: 'ESSENTIAL', groupLabel: 'Required', control: 'MENU', required: true, placeholder: '', placeholderShown: '', maxLength: 0, value: '', suggested: '', counter: '', meta: '', metaKind: '', options: [], y: 1477 },
      { name: 'Vintage Part', group: 'OPTIONAL', groupLabel: 'Additional (optional)', control: 'YESNO', required: false, placeholder: '', placeholderShown: '', maxLength: 0, value: '', suggested: '', counter: '', meta: '', metaKind: '', options: [{ text: 'Yes', pressed: false }, { text: 'No', pressed: false }], y: 2177 }
    ],
    groups: [], toggleExpandedText: '', toggleCollapsedText: '', customActionText: '', collapsedSlotNames: []
  }
  const productWithSpecifics: EbayLocalProduct = {
    ...PRODUCT,
    snapshot: { ...PRODUCT.snapshot, details: { ...details, itemSpecifics: [{ name: 'Brand', value: 'Unbranded' }, { name: 'Vintage Part', value: 'No' }] } }
  }

  it('落定的记「类目属性 n/m」，落不定的进 skipped 并在 warnings 里点名带原因', async () => {
    const { host, executeJavaScript } = makeHost({ specificsSettle: [{ name: 'Brand', settled: true, reason: '' }, { name: 'Vintage Part', settled: false, reason: '候选里没有该值' }] })
    const result = await prepareMethod.call(host, 'ebay:s1', productWithSpecifics, section)
    expect(result.filledFields).toContain('类目属性 1/2')
    expect(result.skippedFields).toContain('类目属性')
    expect(result.warnings.some(text => text.includes('Vintage Part') && text.includes('候选里没有该值'))).toBe(true)
    const script = executeJavaScript.mock.calls.map(call => String(call[0])).find(text => text.includes('__yanduSpecificsWrite')) || ''
    // 三种控件各走各的写法：菜单开面板检索点选、Yes/No 点 pill 回读 aria-pressed、输入框原生 setter 直写回读
    expect(script).toContain('se-expand-button__button')
    expect(script).toContain('aria-pressed')
    expect(script).toContain('textbox__control')
  })

  it('本地没记属性值时不写不记，prepare 调用次数与 H5 之前一致', async () => {
    const { host, executeJavaScript } = makeHost({})
    const result = await prepareMethod.call(host, 'ebay:s1', PRODUCT, section)
    expect(executeJavaScript.mock.calls.some(call => String(call[0]).includes('__yanduSpecificsWrite'))).toBe(false)
    expect(result.filledFields.some(label => label.startsWith('类目属性'))).toBe(false)
    expect(executeJavaScript).toHaveBeenCalledTimes(4)
  })
})
