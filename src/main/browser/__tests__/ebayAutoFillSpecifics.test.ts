import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BrowserWorkspace } from '../BrowserWorkspace'
import type { EbayLocalProduct } from '../../../shared/contracts'

/**
 * S3：自动填写必须把类目属性按产品真值写进当前页签（S1/S2 的回归锁）。
 * 行为层：fillCurrentEbayTab auto 档收到 specificsRows 时跑 specifics 写页脚本并按回读落定计数；
 * 接线层：main 处理器复用 shared 计划（规则别名＋LLM 真候选），prepare 与 auto 共用同一写页方法。
 */
const fillMethod = BrowserWorkspace.prototype.fillCurrentEbayTab as unknown as (
  this: Record<string, unknown>, accountId: string, product: EbayLocalProduct, mode: 'auto' | 'fixed',
  preset?: unknown, specificsRows?: Array<{ name: string; value: string; control: string; inferred?: boolean; evidence?: string }>,
  specificsManual?: Array<{ name: string; reason: string }>
) => Promise<{ filledFields: string[]; skippedFields: string[]; warnings: string[]; inferredFields: string[] }>

const PRODUCT = {
  id: 'lp1', storeId: 's1', listingId: 'T1', title: 'Seat', imageUrl: '', imageUrls: [], price: '9', currency: 'USD',
  quantity: 1, status: 'ACTIVE', versionCount: 1, updatedAt: '', categoryId: '', categoryName: '',
  snapshot: {
    details: { title: 'Seat', descriptionText: 'desc', itemSpecifics: [] },
    sourceListing: { title: 'Seat', price: '9' },
    media: [], completeness: 100, missingFields: [], contentHash: 'h', capturedAt: '', id: 'snap1', localProductId: 'lp1', version: 1
  }
} as unknown as EbayLocalProduct

function makeHost(settleRows?: Array<{ name: string; settled: boolean; reason: string }>) {
  const scripts: string[] = []
  const executeJavaScript = vi.fn(async (script: string) => {
    scripts.push(script)
    if (script.includes('__yanduSpecificsWrite')) return settleRows ?? [{ name: 'Brand', settled: true, reason: '' }, { name: 'Color', settled: false, reason: '候选里没有该值' }]
    if (script.includes('const targets=')) return { url: 'https://www.ebay.com/lstng?draftId=1&mode=AddItem', login: false, verification: false, errorPage: { detected: false, reason: '' }, ready: true, filledFields: ['标题'], skippedFields: [], policyPending: [], warnings: [] }
    return { policyModels: {} }
  })
  const proto = BrowserWorkspace.prototype as unknown as Record<string, unknown>
  const host: Record<string, unknown> = {
    activeTabId: 'tab-1',
    detailTabs: new Map([['tab-1', { view: { webContents: { executeJavaScript, getURL: () => 'https://www.ebay.com/lstng?draftId=1&mode=AddItem' } } }]]),
    sleep: async () => undefined,
    buildRevisionFillScript: proto.buildRevisionFillScript,
    buildSpecificsWriteScript: proto.buildSpecificsWriteScript,
    buildFixedFillScript: proto.buildFixedFillScript
  }
  return { host, scripts }
}

describe('fillCurrentEbayTab auto 档 · 类目属性写页', () => {
  it('收到 specificsRows 时跑 specifics 写页脚本，按回读落定计数并点名未落定行', async () => {
    const { host, scripts } = makeHost()
    const result = await fillMethod.call(host, 'ebay:s1', PRODUCT, 'auto', undefined, [
      { name: 'Brand', value: 'Unbranded', control: 'MENU' },
      { name: 'Color', value: 'Black', control: 'MENU' }
    ])
    expect(scripts.some(script => script.includes('__yanduSpecificsWrite'))).toBe(true)
    expect(result.filledFields).toContain('类目属性 1/2')
    expect(result.skippedFields.some(label => label.includes('Color') && label.includes('候选里没有该值'))).toBe(true)
    expect(result.warnings.some(text => text.includes('建议物品详情卡') && text.includes('未自动应用'))).toBe(true)
  })

  it('没有 specificsRows 时不跑 specifics 写页脚本', async () => {
    const { host, scripts } = makeHost()
    await fillMethod.call(host, 'ebay:s1', PRODUCT, 'auto', undefined, undefined)
    expect(scripts.some(script => script.includes('__yanduSpecificsWrite'))).toBe(false)
  })

  it('V：推断行落定后标「待确认+证据」，无源行按人工点名进跳过', async () => {
    const { host } = makeHost([{ name: 'Vintage Part', settled: true, reason: '' }])
    const result = await fillMethod.call(host, 'ebay:s1', PRODUCT, 'auto', undefined,
      [{ name: 'Vintage Part', value: 'No', control: 'YESNO', inferred: true, evidence: 'aftermarket racing seats' }],
      [{ name: 'UPC', reason: '无源数据，需人工填写' }])
    expect(result.inferredFields.some(label => label.includes('Vintage Part=No') && label.includes('待确认') && label.includes('aftermarket'))).toBe(true)
    expect(result.skippedFields.some(label => label.includes('UPC') && label.includes('需人工填写'))).toBe(true)
  })
})

describe('S 批接线守卫 · 单一写页来源与 shared 计划复用', () => {
  const workspaceSource = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')
  const mainSource = readFileSync(path.resolve(process.cwd(), 'src/main/main.ts'), 'utf8')

  it('prepare 与 auto 档共用 buildSpecificsWriteScript，页内不再各写一遍', () => {
    expect(workspaceSource).toContain('private buildSpecificsWriteScript(')
    expect((workspaceSource.match(/this\.buildSpecificsWriteScript\(/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('main auto 档复用 shared 计划与真候选，清单取产品行/类目缓存', () => {
    const start = mainSource.indexOf("ipcMain.handle('ebay:fill-current-tab'")
    expect(start).toBeGreaterThan(-1)
    const handler = mainSource.slice(start, mainSource.indexOf("ipcMain.handle('ebay:specifics-llm'", start))
    expect(handler).toContain('planEbaySpecificsFill(')
    expect(handler).toContain('applyLlmSpecificAnswers(')
    expect(handler).toContain('ebaySpecificsLlmOptions(slot)')
    expect(handler).toContain('getEbayCategorySpecificsSection(')
  })

  it('T2/U2：落定读开面板选项 aria-checked，面板按实际开合判断，检索框驱动重试，不用整 field 文本 includes', () => {
    const si = workspaceSource.indexOf('private buildSpecificsWriteScript(')
    expect(si).toBeGreaterThan(-1)
    const method = workspaceSource.slice(si, workspaceSource.indexOf('\n  private buildFixedFillScript(', si))
    expect(method).toContain("getAttribute('aria-checked')==='true'")
    expect(method).toContain('const ensureOpen=async()')
    expect(method).toContain('setNative(inp,part)')
    expect(method).not.toContain('valueText.toLowerCase().includes')
  })

  it('V：写页对推断行已有人工选中时不覆盖（五硬要求·不被覆盖）', () => {
    const si = workspaceSource.indexOf('private buildSpecificsWriteScript(')
    const method = workspaceSource.slice(si, workspaceSource.indexOf('\n  private buildFixedFillScript(', si))
    expect(method).toContain('row.inferred')
    expect(method).toContain('已有人工选中，不覆盖')
  })

  it('V：读取脚本多遍展开折叠尾巴行（红框九行入清单的根因修复），中英文开关都认', () => {
    const si = workspaceSource.indexOf('private buildInspectRequirementsScript(')
    expect(si).toBeGreaterThan(-1)
    const method = workspaceSource.slice(si, workspaceSource.indexOf('async fillCurrentEbayTab(', si))
    expect(method).toContain('for(let i=0;i<4;i+=1)')
    expect(method).toMatch(/show more/i)
    expect(method).toContain('显示更多内容')
  })

  it('V：main auto 档接 YESNO 证据推断与无源人工点名', () => {
    const start = mainSource.indexOf("ipcMain.handle('ebay:fill-current-tab'")
    const handler = mainSource.slice(start, mainSource.indexOf("ipcMain.handle('ebay:specifics-llm'", start))
    expect(handler).toContain('inferEbaySpecificsYesNo(')
    expect(handler).toContain('ebaySpecificsUnfilledRows(')
    expect(handler).toContain('inferred:true')
  })
})