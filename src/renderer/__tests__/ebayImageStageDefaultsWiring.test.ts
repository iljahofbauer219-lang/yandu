import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const panel = readFileSync(resolve(__dirname, '../EbayImageStagePanel.tsx'), 'utf8')
const readPersistedBody = panel.slice(panel.indexOf('function readPersisted'), panel.indexOf('export default function EbayImageStagePanel'))

describe('图片优化新默认接线：进入即简版＋四格 0', () => {
  it('lane 初始化：仅显式持久化 model 才走模型档，其余（含无持久化）默认简版', () => {
    expect(panel).toContain("const [lane, setLane] = useState<'simple' | 'model'>(persisted.current?.lane === 'model' ? 'model' : 'simple')")
  })
  it('simpleCounts 初始化：无持久化时四类全 0（不再取 3/3/2/2 共享默认）', () => {
    expect(panel).toContain('persisted.current?.simpleCounts || { ...ZERO_EBAY_IMAGE_CATEGORY_COUNTS }')
  })
  it('模型档 counts 初始化保持共享默认不变（模型档下限 1，交互与上下限不变）', () => {
    expect(panel).toContain('persisted.current?.counts || { ...DEFAULT_EBAY_IMAGE_CATEGORY_COUNTS }')
  })
  it('readPersisted 调迁移判据函数', () => {
    expect(readPersistedBody).toContain('migrateEbayImageStageLane(')
  })
  it('readPersisted 命中旧默认时一次性写回 lane:simple', () => {
    expect(readPersistedBody).toContain('laneDecision.migrated')
    expect(readPersistedBody).toContain('localStorage.setItem(')
    expect(readPersistedBody).toContain("lane: 'simple'")
  })
  it('readPersisted 返回判据档位（缺失不再强制 model）', () => {
    expect(readPersistedBody).toContain('lane: laneDecision.lane')
    expect(readPersistedBody).not.toContain("lane: parsed.lane === 'simple' ? 'simple' : 'model'")
  })
  it('panel 从零默认与判据函数的共享模块导入', () => {
    expect(panel).toContain('ZERO_EBAY_IMAGE_CATEGORY_COUNTS')
    expect(panel).toContain('migrateEbayImageStageLane')
    expect(panel).toContain("from '../shared/ebayImageCategoryPlan'")
  })
  it('两档张数网格下限不变：模型档 1、简版档 0', () => {
    expect(panel).toContain('renderModelMode(EBAY_IMAGE_CATEGORY_COUNT_MIN, counts, onModelCount)')
    expect(panel).toContain('renderModelMode(SIMPLE_CATEGORY_COUNT_MIN, simpleCounts, onSimpleCount)')
  })
})