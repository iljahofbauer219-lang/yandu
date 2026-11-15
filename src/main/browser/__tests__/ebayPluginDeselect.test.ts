import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 缺陷：研究页采集插件对「已入库(collected)」商品恒显 ✓ 且 toggle 早退
 * （`if(collected.has(url))return`），用户无法取消已选外观。
 * 修复口径：collected 徽标可被本地 dismissed 集合取消/恢复显示（仅视觉），
 * 不改动 collected（落库）与 selected（采集已选）集合，不改采集落库口径。
 * 这里钉住注入脚本三处：dismissed 集合、toggle 的 collected 分支可切换、update 将 dismissed 折入 isCollected。
 */
const source = readFileSync(path.resolve(process.cwd(), 'src/main/browser/BrowserWorkspace.ts'), 'utf8')

describe('eBay 研究页采集插件 · 已入库徽标可取消已选外观', () => {
  it('注入脚本维护 dismissed 集合', () => {
    expect(source).toContain('const dismissed=new Set()')
  })
  it('toggle 对 collected 不再盲早退，而是切换 dismissed（可取消/恢复）', () => {
    expect(source).toContain('if(collected.has(entry.product.url)){if(dismissed.has(entry.product.url))dismissed.delete(entry.product.url);else dismissed.add(entry.product.url);update(entry);return}')
  })
  it('update 将 dismissed 折入 isCollected，使取消后不再显 ✓/红底', () => {
    expect(source).toContain('const isCollected=collected.has(entry.product.url)&&!dismissed.has(entry.product.url)')
  })
})