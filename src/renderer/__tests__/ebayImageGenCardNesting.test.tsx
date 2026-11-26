import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import EbayImageStagePanel from '../EbayImageStagePanel'

/**
 * 模型档「⑥ 审核与采纳」卡片：缩略图按钮化后曾嵌在整卡采纳按钮内（HTML 非法嵌套交互控件，
 * 且内层 stopPropagation 让点图不再采纳）。这里对真实渲染输出扫描 button 嵌套，
 * 并钉住「容器 div ＋ 看原大按钮 ＋ 独立采纳按钮」三件，任一漂回嵌套即红。
 */
const css = readFileSync(path.join(__dirname, '..', 'ebay-image-stage-panel.css'), 'utf8')
const LISTING = 'gen-card-nesting'
const IMAGE_URL = 'https://img.test/hero.jpg'

function renderCard(kept: boolean): string {
  const state = {
    lane: 'model',
    generated: [{ cardId: 'C1', category: 'HERO', title: '主图', url: IMAGE_URL, model: 'm1' }],
    keptByCategory: kept ? { HERO: [IMAGE_URL] } : {}
  }
  const store = new Map<string, string>([[`ebay-image-simplified:v1:${LISTING}`, JSON.stringify(state)]])
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) }
  })
  try {
    return renderToStaticMarkup(<EbayImageStagePanel
      listingId={LISTING}
      sourceImages={[IMAGE_URL]}
      sourceLabels={['原图 1']}
      title="实木床架"
      description="描述"
      itemSpecifics={[]}
      coreTerm="床架"
      searchTerms={[]}
      sourceRoles={['主图']}
      sourceChecks={[]}
      imageModels={[{ id: 'm1', name: '模型一', description: '' }]}
      onAllStagesConfirmed={() => undefined}
    />)
  } finally {
    vi.unstubAllGlobals()
  }
}

/** 顺序扫描渲染后的 HTML：某个 button 尚未闭合又开一个 button 即嵌套违规 */
function nestedButtonCount(html: string): number {
  let depth = 0
  let violations = 0
  for (const match of html.matchAll(/<button\b|<\/button>/g)) {
    if (match[0] === '</button>') depth = Math.max(0, depth - 1)
    else {
      if (depth > 0) violations += 1
      depth += 1
    }
  }
  return violations
}

describe('模型档生成卡：看原大与采纳互不嵌套', () => {
  it('渲染输出里没有任何 button 嵌 button', () => {
    const html = renderCard(false)
    expect(html).toContain('ebay-stage-gen-item')
    expect(nestedButtonCount(html)).toBe(0)
  })

  it('卡片容器是 div，采纳改由独立按钮承担', () => {
    const html = renderCard(false)
    expect(html).not.toMatch(/<button[^>]*class="[^"]*ebay-stage-gen-item/)
    expect(html).toMatch(/<div[^>]*class="[^"]*ebay-stage-gen-item/)
    expect(html).toContain('ebay-stage-gen-adopt')
    expect(html).toContain('点击采纳')
  })

  it('看原大按钮与采纳按钮各自独立，已采纳态文案随选区', () => {
    expect(renderCard(false)).toContain('查看原大 主图 1')
    const kept = renderCard(true)
    expect(kept).toContain('✓ 已采纳')
    expect(nestedButtonCount(kept)).toBe(0)
  })

  it('CSS：采纳按钮自成可点区且键盘焦点可见', () => {
    expect(css).toContain('.ebay-stage-gen-adopt')
    expect(css).toContain('.ebay-stage-gen-adopt:focus-visible')
  })
})