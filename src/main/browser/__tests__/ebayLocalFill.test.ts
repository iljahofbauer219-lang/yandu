import { describe, expect, it, vi } from 'vitest'

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
import { EBAY_LOCAL_FILL_TARGETS, ebayLocalFillPayload } from '../ebayLocalFill'
import type { EbayLocalProduct, EbayProductDetails } from '../../../shared/contracts'

const LABELS = ['标题', '价格', '描述', '数量', '商品状况', '付款政策', '运输政策', '退货政策', '商品所在地', '所在地邮编', '自定义编号']

/** brief 的样本 details（补齐 EbayProductDetails 的三个必填字段以过 typecheck，值本身与 brief 一致）。 */
const details: EbayProductDetails = {
  url: 'https://www.ebay.com/itm/T100', itemSpecifics: [], imageUrls: [],
  title: 'Bracket', descriptionHtml: '<p>x</p>', descriptionText: 'x', price: '9.9', quantity: '12', condition: 'New',
  paymentPolicy: '257217501013', shippingPolicy: '18510002003', returnPolicy: '19007008009',
  itemLocation: 'Guangdong, CN', postalCode: '528000', sku: 'PK-01'
}

const prepareMethod = BrowserWorkspace.prototype.prepareEbayLocalProductRevision as unknown as (
  this: Record<string, unknown>, accountId: string, product: EbayLocalProduct
) => Promise<{ reviseUrl: string; filledFields: string[]; skippedFields: string[]; warnings: string[]; submitButtonDetected: boolean; preparedAt: string }>

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

/** 用 fixtures 冒充内嵌浏览器：executeJavaScript 收到真实页脚本原文，页面一律返回「已就绪且未提交」。 */
function makeHost(page: { ready?: boolean; submitButtonDetected?: boolean } = {}) {
  const scripts: string[] = []
  const executeJavaScript = vi.fn(async (script: string) => {
    scripts.push(script)
    return {
      url: 'https://www.ebay.com/sl/list?mode=ReviseItem&itemId=T100',
      login: false,
      verification: false,
      ready: page.ready ?? true,
      filledFields: ['标题'],
      skippedFields: [],
      warnings: [],
      submitButtonDetected: page.submitButtonDetected ?? true
    }
  })
  const host: Record<string, unknown> = {
    newEbayTab: vi.fn(async () => 'tab-1'),
    detailTabs: new Map([['tab-1', { view: { webContents: { executeJavaScript } } }]]),
    sleep: async () => undefined
  }
  return { host, executeJavaScript, scripts }
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

const runPrepare = async (page: { ready?: boolean; submitButtonDetected?: boolean } = {}) => {
  const { host, scripts, executeJavaScript } = makeHost(page)
  const result = await prepareMethod.call(host, 'ebay:s1', PRODUCT)
  expect(executeJavaScript).toHaveBeenCalledTimes(1)
  return { script: scripts[0], result }
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
    expect(guard).toBeLessThan(script.indexOf('if(target.byPolicyId)'))
    expect(guard).toBeLessThan(script.indexOf('fill(target.label,'))
  })

  it('全脚本唯一的点击仍是 setValue 既有的复选框分支；除此之外没有任何新点击路径', async () => {
    const { script } = await runPrepare()
    expect(script.match(/\.click\(/g)).toHaveLength(1)
    const clickLine = script.split('\n').find(line => line.includes('field.click()'))
    expect(clickLine).toContain("if(field.type==='checkbox')")
  })

  it('零提交底线：不新增 .submit( 调用，type="submit" 只允许留在既有的按钮探测里', async () => {
    const { script } = await runPrepare()
    expect(script).not.toMatch(/\.submit\(/)
    const submitSelectorLines = script.split('\n').filter(line => line.includes('type="submit"'))
    expect(submitSelectorLines).toHaveLength(1)
    expect(submitSelectorLines[0]).toContain('const submitButtonDetected=')
    expect(script).toContain('尚未提交')
  })

  it('政策三项自己记 filled/skipped，且只允许纯数字 ID 进下拉、名称后缀 (政策ID) 仍是兜底命中', async () => {
    const { script } = await runPrepare()
    expect(script).toContain("if(selectByPolicyId(field,desired[target.key]))filledFields.push(target.label);else skippedFields.push(target.label);continue")
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

  it('warnings 文案点名全部 11 类字段、保留人工核对与未提交口径，旧的「只准备标题、描述和价格」必须消失', async () => {
    const { script } = await runPrepare()
    const line = script.split('\n').map(item => item.trim()).find(item => item.startsWith("warnings.push('本次填写"))
    expect(line).toBeDefined()
    for (const name of ['标题', '描述', '价格', '数量', '商品状况', '付款', '运输', '退货政策', '商品所在地', '邮编', 'SKU']) {
      expect(line).toContain(name)
    }
    expect(line).toContain('人工核对')
    expect(line).toContain('尚未提交')
    expect(script).not.toContain('本次只准备标题、描述和价格')
  })

  it('标题字段始终读不到时按既有中文错误硬点名（扩到 11 项后 ready 判定不得被稀释）', async () => {
    const { host, executeJavaScript } = makeHost({ ready: false })
    await expect(prepareMethod.call(host, 'ebay:s1', PRODUCT))
      .rejects
      .toThrow('Seller Hub 修改页尚未加载出标题字段，请确认商品仍在线后重试')
    expect(executeJavaScript).toHaveBeenCalledTimes(20)
  })
})
