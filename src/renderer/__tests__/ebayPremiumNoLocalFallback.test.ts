import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 优品卡两按钮死路修复（2026-11-18）：进入发布无本地行→中文模态（含去本地产品动作），
 * 查看优化版本无本地行→内存恢复载体（restore-<draftId>，媒体 downloadStatus FAILED，不写库），
 * 离开 optimize 即清；不得仅行内 notice 或空工作区。
 */
const app = readFileSync(path.resolve(process.cwd(), 'src/renderer/App.tsx'), 'utf8')

describe('优品卡 · 无本地行兜底', () => {
  it('进入发布无本地行置模态而非行内 notice', () => {
    expect(app).toContain('if(!lp){setPublishNoMatchDraft(premium);return}')
    expect(app).not.toContain("setNotice('未找到本地产品，请先在本地产品中同步该商品')")
    expect(app).toContain('id="ebay-publish-nomatch-title"')
    expect(app).toContain('尚未同步为本地产品')
    expect(app).toContain('>去本地产品</button>')
  })
  it('查看优化版本无本地行用内存恢复载体兜底', () => {
    expect(app).toContain('const [premiumRestoreCarrier,setPremiumRestoreCarrier]=useState<EbayLocalProduct|null>(null)')
    expect(app).toContain('||(premiumRestoreCarrier&&selectedLocalProductId===premiumRestoreCarrier.id?premiumRestoreCarrier:undefined)')
    expect(app).toContain('const carrierId=`restore-${draft.id}`')
    expect(app).toContain("downloadStatus:'FAILED' as const")
  })
  it('离开 optimize 即清恢复载体（不污染本地列表）', () => {
    expect(app).toContain("if(activeTab!=='optimize')setPremiumRestoreCarrier(null)")
    expect(app).not.toContain('saveOptimizationDraft(carrier')
  })
})