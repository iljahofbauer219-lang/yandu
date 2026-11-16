import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const appSource = readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8')

/**
 * 用户口径（2026-11-15 截图）：顶栏「刷新」应刷新当前界面内容，而不是把 eBay 工作台顶回「店铺采集」。
 * 刷新走整窗 reload，一级页已有 LAST_PAGE_KEY 会话保持；子页签此前无持久化，reload 即回落 browser。
 * 这里钉住：子页签写/读会话存储 + 页签清单提为模块常量后六项不丢。
 */
describe('eBay 子页签跨 reload 保持', () => {
  it('页签清单六项 id/名称/顺序不丢（提为模块常量供初值校验与渲染共用）', () => {
    const block = appSource.slice(appSource.indexOf('const EBAY_WORKSPACE_TABS'), appSource.indexOf('const ebayWorkspaceTabKey'))
    const ids = [...block.matchAll(/\{id:'([a-z]+)',name:'([^']+)'\}/g)].map(m => [m[1], m[2]])
    expect(ids).toEqual([
      ['browser', '店铺浏览'],
      ['local', '本地产品'],
      ['optimize', 'AI优化'],
      ['premium', '优品仓库'],
      ['publish', '线上发布'],
      ['library', '线上产品'],
    ])
  })

  it('初值读会话存储恢复子页签，显式 initialTab 优先；变更写回会话存储', () => {
    expect(appSource).toContain('sessionStorage.getItem(ebayWorkspaceTabKey(workspace))')
    expect(appSource).toContain('if(initialTab)return initialTab')
    expect(appSource).toContain('sessionStorage.setItem(ebayWorkspaceTabKey(workspace),activeTabState)')
  })

  it('一级页跨 reload 保持仍在（LAST_PAGE_KEY 写/读）', () => {
    expect(appSource).toContain('sessionStorage.setItem(LAST_PAGE_KEY, page)')
    expect(appSource).toContain('sessionStorage.getItem(LAST_PAGE_KEY)')
  })

  it('入口意图默认 undefined：ebayEntryTab 不得带默认页签，否则 reload 后会话恢复被默认值覆盖', () => {
    expect(appSource).toContain('const [ebayEntryTab, setEbayEntryTab] = useState<EbayWorkspaceTab|undefined>(undefined)')
  })
})