export interface GigaImageChoice {
  url: string
  inGallery: boolean
  dimmed: boolean
  naturalWidth: number
}

// 大健云仓主图选择：主图容器（画廊）优先，排除灰置/隐藏节点（跨变体页共享的 opacity-40 缩略图），
// 同池内按已加载宽度取最宽。画廊懒加载未就绪时回退非灰置活图，调用方负责轮询等待画廊。
export function pickGigaMainImage(choices: GigaImageChoice[]): string {
  const live = choices.filter(item => item.url && !item.dimmed)
  const pool = live.some(item => item.inGallery) ? live.filter(item => item.inGallery) : live
  if (!pool.length) return ''
  return pool.slice().sort((left, right) => (right.naturalWidth || 0) - (left.naturalWidth || 0))[0].url
}
