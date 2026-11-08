import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

/**
 * 缺陷 (b)：「保存并准备到 eBay」把货盘本地编号 `PALLET-<uuid>` 直接拼进 ReviseItem 的 itemId，
 * eBay 拒成 lstng/error?reason=createOrGetDraft:undefined:XS_PROMISE_REJECTED，
 * 用户看到的是「代码没生效」。路由判定抽到 shared/ebayListingTarget 后，这里锁三件事：
 *   1) 三种本地状态各开各的页，URL 里永远不出现 PALLET-；
 *   2) 落地 eBay 错误页立刻点名并停止重试（旧代码要空转 20 次再把真因说成「尚未加载出标题字段」）；
 *   3) 「List an item」首页本来就没有可灌字段，不跑灌字段脚本、也不谎报填了几项。
 */

vi.mock('electron', () => ({
  BaseWindow: class {},
  BrowserWindow: class {},
  WebContentsView: class {},
  WebContents: class {},
  clipboard: { readText: () => '', writeText: () => undefined }
}))

import { BrowserWorkspace } from '../BrowserWorkspace'
import type { EbayLocalProduct } from '../../../shared/contracts'

type Host = Record<string, unknown>
type PageResult = {
  url?: string
  ready?: boolean
  login?: boolean
  verification?: boolean
  errorPage?: { detected: boolean; reason: string }
  filledFields?: string[]
  skippedFields?: string[]
  policyPending?: string[]
  warnings?: string[]
  submitButtonDetected?: boolean
}

const REVISE_URL = 'https://www.ebay.com/sl/list?mode=ReviseItem&itemId=189035181453&ReturnURL=https%3A%2F%2Fwww.ebay.com%2Fsh%2Flst%2Factive'
const ADD_URL = 'https://www.ebay.com/lstng?mode=AddItem&categoryId=33701'
const PRELIST_URL = 'https://www.ebay.com/sl/prelist/suggest?sr=shstart'
const ERROR_URL = 'https://www.ebay.com/lstng/error?reason=createOrGetDraft:undefined:XS_PROMISE_REJECTED&uuid=1055da8d'

const prepare = BrowserWorkspace.prototype.prepareEbayLocalProductRevision as unknown as (
  this: Host, accountId: string, product: EbayLocalProduct
) => Promise<{ reviseUrl: string; routeKind: string; filledFields: string[]; skippedFields: string[]; warnings: string[]; submitButtonDetected: boolean }>

const productOf = (listingId: string, platformCategoryId?: string): EbayLocalProduct =>
  ({
    id: 'lp-1', storeId: 's1', listingId, platformCategoryId, title: 'Quilted Gift Storage Basket',
    snapshot: { sourceListing: { title: '线上标题', price: '12.50' }, details: { title: '本地标题', price: '13.90', quantity: '6' }, media: [] }
  }) as unknown as EbayLocalProduct

function makeHost(page: PageResult | PageResult[] = {}) {
  const pages = Array.isArray(page) ? page : [page]
  const scripts: string[] = []
  const executeJavaScript = vi.fn(async (script: string) => {
    scripts.push(String(script))
    const next = pages[Math.min(pages.length - 1, scripts.length - 1)]
    return {
      url: next.url || REVISE_URL, login: false, verification: false, ready: next.ready ?? true,
      errorPage: next.errorPage || { detected: false, reason: '' },
      filledFields: next.filledFields ?? ['标题'], skippedFields: next.skippedFields ?? [],
      // 现网灌字段脚本恒带回 policyPending（政策点了没落定的那几项）；这里默认空数组＝政策一项都没挂着，收单不再重跑。
      policyPending: next.policyPending ?? [],
      warnings: next.warnings ?? [], submitButtonDetected: next.submitButtonDetected ?? true
    }
  })
  const opened: { url: string; title: string }[] = []
  const host: Host = {
    newEbayTab: vi.fn(async (_accountId: string, title: string, url: string) => { opened.push({ url, title }); return 'tab-1' }),
    detailTabs: new Map([['tab-1', { view: { webContents: { executeJavaScript } } }]]),
    sleep: async () => undefined
  }
  return { host, opened, scripts, executeJavaScript }
}

const run = (listingId: string, platformCategoryId?: string, page: PageResult | PageResult[] = {}) => {
  const made = makeHost(page)
  return { made, result: prepare.call(made.host, 'ebay:s1', productOf(listingId, platformCategoryId)) }
}

describe('本地版本准备发布 · 路由判定', () => {
  it('有真在架编号时仍开修改页，URL 与现网口径逐字一致', async () => {
    const { made, result } = run('189035181453')
    await expect(result).resolves.toBeTruthy()
    expect(made.opened[0].url).toBe(REVISE_URL)
    expect((await result).routeKind).toBe('revise')
  })

  it('货盘编号配真叶类目改开首次刊登页，URL 不含 PALLET', async () => {
    const { made, result } = run('PALLET-4b695b47-8c63-4e5b-bf0e-97fe2dbe0e4d', '33701', { url: ADD_URL })
    const ready = await result
    expect(made.opened[0].url).toBe(ADD_URL)
    expect(made.opened[0].url).not.toContain('PALLET')
    expect(ready.routeKind).toBe('add')
    expect(ready.reviseUrl).toBe(ADD_URL)
  })

  it('既没编号又没类目时开 eBay 新建刊登首页，且不跑灌字段脚本、不谎报填写项', async () => {
    const { made, result } = run('PALLET-d20c1159-bf99-41de-ad82-887db2410074', undefined, { url: PRELIST_URL })
    const ready = await result
    expect(made.opened[0].url).toBe(PRELIST_URL)
    expect(ready.routeKind).toBe('prelist')
    expect(ready.filledFields).toEqual([])
    expect(ready.skippedFields).toEqual([])
    expect(ready.warnings.join(' ')).toMatch(/平台类目|类目/)
    expect(made.executeJavaScript).toHaveBeenCalledTimes(1)
    expect(made.scripts[0]).not.toMatch(/EBAY_LOCAL_FILL_TARGETS|__cross_border_local_revision_guard|已从本地版本填写/)
  })

  it('三条路由的标签名都点名了商品，操作手在页签上一眼认得出是哪件货', async () => {
    const titles = [
      run('189035181453').made.opened[0].title,
      run('PALLET-4b695b47', '33701').made.opened[0].title,
      run('PALLET-d20c1159').made.opened[0].title
    ]
    for (const title of titles) expect(title).toMatch(/Quilted Gift Storage Basket/)
  })
})

describe('本地版本准备发布 · 落地错误页立刻点名', () => {
  it('eBay 回错误页时只探一次就抛，并把 eBay 的 reason 原文带进中文点名', async () => {
    const { made, result } = run('PALLET-e60d1bbf-ba1a-4a44-84cd-cf23e40429f2', 'abc', {
      url: ERROR_URL, ready: false, submitButtonDetected: false,
      errorPage: { detected: true, reason: 'createOrGetDraft:undefined:XS_PROMISE_REJECTED' }
    })
    await expect(result).rejects.toThrow(/createOrGetDraft:undefined:XS_PROMISE_REJECTED/)
    expect(made.executeJavaScript).toHaveBeenCalledTimes(1)
  })

  it('页面还在加载时按原有节奏重试，不误判成错误页', async () => {
    const { made, result } = run('189035181453', undefined, [
      { ready: false, submitButtonDetected: false, filledFields: [], skippedFields: [] },
      { ready: true, submitButtonDetected: true, filledFields: ['标题'], skippedFields: [] }
    ])
    const ready = await result
    expect(ready.filledFields).toEqual(['标题'])
    expect(made.executeJavaScript.mock.calls.length).toBeGreaterThan(1)
  })
})

describe('本地版本准备发布 · 页面没加载出来时按路由点名', () => {
  it('修改页仍说修改页：既有中文错误原文一字不改，扩了路由也不许稀释', async () => {
    const { result } = run('189035181453', undefined, { ready: false })
    await expect(result).rejects.toThrow('Seller Hub 修改页尚未加载出标题字段，请确认商品仍在线后重试')
  })

  it('首次刊登页加载不出来时不谎称修改页，也不叫用户去确认商品在线', async () => {
    const { result } = run('PALLET-4b695b47-8c63-4e5b-bf0e-97fe2dbe0e4d', '33701', { ready: false })
    const message = await result.then(() => '').catch((error: unknown) => String((error as Error).message))
    expect(message).toContain('eBay 首次刊登页尚未加载出标题字段')
    expect(message).not.toContain('Seller Hub 修改页')
    expect(message).not.toContain('确认商品仍在线')
    // 路由说明照旧带上，操作手才知道开的是哪一页
    expect(message).toContain('首次刊登')
  })
})

describe('本地版本准备发布 · 回归锁', () => {
  const source = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), 'utf8')

  it('引擎里不再存在「拿本地编号拼 ReviseItem」的写法', () => {
    const text = source('src/main/browser/BrowserWorkspace.ts')
    expect(text).not.toContain('mode=ReviseItem&itemId=${encodeURIComponent(product.listingId)}')
    expect(text).toMatch(/resolveEbayListingTarget/)
  })
})
