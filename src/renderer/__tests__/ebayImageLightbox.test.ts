import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 用户口径（2026-11-24 三截图红框）：图片优化环节缩略图（原图/分诊沿用/生成/排序/模型档）
 * 点击弹出原大图片查看。实现＝panel 根委托点击仅 IMG 目标开 lightbox（不扰勾选/重生成/排序按钮），
 * ×／backdrop／Esc 关闭；原大 url、max 90vw/90vh 等比。
 */
const panel = readFileSync(path.resolve(process.cwd(), 'src/renderer/EbayImageStagePanel.tsx'), 'utf8')
const css = readFileSync(path.resolve(process.cwd(), 'src/renderer/ebay-image-stage-panel.css'), 'utf8')

describe('缩略图点击看原大', () => {
  it('根委托点击仅 IMG 目标开 lightbox', () => {
    expect(panel).toContain("return <div className=\"ebay-stage-panel\" onClick={event=>{const target=event.target as HTMLElement;if(target.tagName==='IMG'){const img=target as HTMLImageElement;const src=img.currentSrc||img.src;if(src)setLightboxUrl(src)}}}>")
    expect(panel).toContain('const [lightboxUrl,setLightboxUrl]=useState<string|null>(null)')
  })
  it('lightbox 渲染：原大 img＋×＋backdrop 关闭＋Esc', () => {
    expect(panel).toContain('{lightboxUrl&&<div className="ebay-image-lightbox" role="dialog" aria-label="原大图片查看" onClick={()=>setLightboxUrl(null)}>')
    expect(panel).toContain('<img src={lightboxUrl} alt="原大图片" onClick={event=>event.stopPropagation()}/>')
    expect(panel).toContain('className="ebay-image-lightbox-close"')
    expect(panel).toContain("if(event.key==='Escape')setLightboxUrl(null)")
  })
  it('CSS：zoom-in 提示＋fixed 遮罩＋90vw/90vh 等比', () => {
    expect(css).toContain('.ebay-stage-panel img{cursor:zoom-in}')
    expect(css).toContain('.ebay-image-lightbox{position:fixed;inset:0;z-index:120;display:grid;place-items:center;')
    expect(css).toContain('.ebay-image-lightbox img{max-width:90vw;max-height:90vh;object-fit:contain;')
  })
})