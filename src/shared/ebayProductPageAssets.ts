/**
 * 服务器产品页图集与本地快照地址的对齐。
 *
 * 「下载图文」重下是整批替换：同名图片可能换扩展名（08.jpg → 08.png），旧快照里残留的地址
 * 在服务器上直接 404，界面就出现破图。这两个纯函数以服务器当前批次为唯一口径重整地址清单，
 * 页面资产按路径识别（换服务器域名也能纠偏），其它域名地址（源站主图、AI 资产）一律不动。
 */

export interface ProductPageAssetRef {
  pageId: string
  name: string
}

const PAGE_ASSET_PATH = /^\/product-pages\/([A-Za-z0-9_-]+)\/assets\/([^/?#]+)$/

/** 产品页资产地址 → {页面标识, 文件名}；非页面资产或非法地址返回 null */
export function productPageAssetName(url: string): ProductPageAssetRef | null {
  if (!/^https?:\/\//i.test(url)) return null
  let pathname = ''
  try {
    pathname = new URL(url).pathname
  } catch {
    return null
  }
  const match = PAGE_ASSET_PATH.exec(pathname)
  if (!match) return null
  try {
    return { pageId: match[1], name: decodeURIComponent(match[2]) }
  } catch {
    return { pageId: match[1], name: match[2] }
  }
}

function assetUrl(serverUrl: string, pageId: string, name: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/product-pages/${pageId}/assets/${encodeURIComponent(name)}`
}

/** 页面资产以外保持原顺序，其后按服务器当前批次补齐（幂等：已一致时原样返回） */
export function applyServerAssetBatch(
  urls: string[],
  options: { serverUrl: string; pageId: string; assets: string[] }
): string[] {
  const { serverUrl, pageId, assets } = options
  if (!serverUrl || !pageId || !assets.length) return urls
  const kept = urls.filter(url => productPageAssetName(url)?.pageId !== pageId)
  return [...new Set([...kept, ...assets.map(name => assetUrl(serverUrl, pageId, name))])]
}

/** 指向该页产品图集、但已不在服务器当前批次里的地址（批次未知时不判失效，宁可保留） */
export function isStaleProductPageAsset(
  url: string,
  options: { serverUrl: string; pageId: string; assets: string[] }
): boolean {
  const { pageId, assets } = options
  if (!pageId || !assets.length) return false
  const ref = productPageAssetName(url)
  if (!ref || ref.pageId !== pageId) return false
  return !assets.includes(ref.name)
}
