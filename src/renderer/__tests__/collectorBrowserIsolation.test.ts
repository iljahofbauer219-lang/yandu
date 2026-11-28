import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-28 10:51/10:54/10:55 三截图）：货盘采集各采集网址界面必须独立，
 * 大健云仓采购页签不得出现 IE浏览 导航址（114.55.149.192/nav/），地址栏与内容不得互跳串台。
 * 根因＝采集工作台 onState 无差别接收所有 platform 推送：ie nav 状态劫持 platform/address，
 * 随后 browser.show(platform) 把 ie 视图挂进采集槽；自动登录亦被带偏。
 * 修复＝onState 仅跟随「主进程当前 active 且属于采集工作台自身」的页签状态（排除 ie/scopeId/无组 web）。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('采集浏览器与IE浏览视图隔离', () => {
  it('onState 归属门卫：active 自身页签＋排除 ie＋排除 scopeId＋web 须有货盘组', () => {
    expect(app).toContain('const collectorActiveTabRef = useRef<BrowserTab | null>(null)')
    expect(app).toContain('const own = collectorActiveTabRef.current')
    expect(app).toContain("const owns = Boolean(own) && own!.platform === next.platform && own!.platform !== 'ie' && !own!.scopeId && (next.platform !== 'web' || Boolean(own!.group))")
    expect(app).toContain('if (!owns) return')
  })
  it('onTabs 同步 active 页签基准', () => {
    expect(app).toContain('collectorActiveTabRef.current = next.find(tab => tab.active) || null')
  })
  it('采集页签条本就不列 ie 页签', () => {
    expect(app).toContain("browserTabs.filter(tab=>!tab.scopeId&&tab.platform!=='ie'")
  })
})
