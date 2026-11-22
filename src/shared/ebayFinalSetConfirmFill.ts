import type { EbayImageCategory } from './ebayImageCategoryPlan'
import { simpleSourceCategory } from './ebayImageSimpleLane'

const PURPOSES: EbayImageCategory[] = ['HERO', 'PRODUCT', 'PAIN_POINT', 'SCENE']

/** 「确认所有最终图片」缺类补齐：已采纳类不动；缺类优先该类生成图，否则按已选原图角色（角色缺位按池序）沿用原图；同 URL 不跨类重复；无源可补保持缺失 */
export function fillMissingFinalCategories(input: {
  kept: Partial<Record<EbayImageCategory, string[]>>
  sources: Array<{ url: string; role: string }>
  generated: Partial<Record<EbayImageCategory, string[]>>
}): Partial<Record<EbayImageCategory, string[]>> {
  const out: Partial<Record<EbayImageCategory, string[]>> = {}
  const used = new Set<string>()
  for (const purpose of PURPOSES) {
    const urls = (input.kept[purpose] || []).filter(Boolean)
    if (urls.length) {
      out[purpose] = urls
      urls.forEach(url => used.add(url))
    }
  }
  const pool = input.sources.filter(source => source.url && !used.has(source.url))
  for (const purpose of PURPOSES) {
    if (out[purpose]?.length) continue
    const generated = (input.generated[purpose] || []).filter(url => !used.has(url))
    if (generated.length) {
      out[purpose] = generated
      generated.forEach(url => used.add(url))
      continue
    }
    const byRole = pool.filter(source => simpleSourceCategory(source.role) === purpose)
    const pick = (byRole.length ? byRole : pool)[0]
    if (!pick) continue
    out[purpose] = [pick.url]
    used.add(pick.url)
    pool.splice(pool.indexOf(pick), 1)
  }
  return out
}