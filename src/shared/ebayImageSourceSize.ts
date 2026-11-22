/** CDN URL 自身声明的缩放尺寸（阿里云 OSS x-oss-process=image/resize,w_N,h_N），尺寸表缺口时的已知尺寸来源 */
export function declaredRemoteImageSize(url: string): { width: number; height: number } | null {
  const match = url.match(/x-oss-process=image(?:%2F|\/)resize(?:%2C|,)w_(\d+)(?:%2C|,)h_(\d+)/i)
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null
  return { width, height }
}