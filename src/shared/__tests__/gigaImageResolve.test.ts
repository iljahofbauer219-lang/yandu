import { describe, expect, it } from 'vitest'
import { pickGigaMainImage, type GigaImageChoice } from '../gigaImageResolve'

const choice = (over: Partial<GigaImageChoice>): GigaImageChoice => ({ url: 'https://x/i.jpg', inGallery: false, dimmed: false, naturalWidth: 100, ...over })

describe('pickGigaMainImage', () => {
  it('画廊已加载时优先画廊内最宽图，即使页内其它图更宽', () => {
    const picked = pickGigaMainImage([
      choice({ url: 'https://x/strip.jpg', inGallery: false, naturalWidth: 900 }),
      choice({ url: 'https://x/gallery.jpg', inGallery: true, naturalWidth: 500 })
    ])
    expect(picked).toBe('https://x/gallery.jpg')
  })

  it('排除灰置节点：共享变体缩略图不得当选', () => {
    const picked = pickGigaMainImage([
      choice({ url: 'https://x/shared-dimmed.jpg', inGallery: false, dimmed: true, naturalWidth: 500 }),
      choice({ url: 'https://x/gallery.jpg', inGallery: true, naturalWidth: 500 })
    ])
    expect(picked).toBe('https://x/gallery.jpg')
  })

  it('画廊未加载时回退非灰置活图', () => {
    const picked = pickGigaMainImage([
      choice({ url: 'https://x/shared-dimmed.jpg', dimmed: true, naturalWidth: 500 }),
      choice({ url: 'https://x/strip-live.jpg', naturalWidth: 300 }),
      choice({ url: '', inGallery: true, naturalWidth: 0 })
    ])
    expect(picked).toBe('https://x/strip-live.jpg')
  })

  it('画廊内按宽度排序取最宽', () => {
    const picked = pickGigaMainImage([
      choice({ url: 'https://x/g-small.jpg', inGallery: true, naturalWidth: 120 }),
      choice({ url: 'https://x/g-main.jpg', inGallery: true, naturalWidth: 800 })
    ])
    expect(picked).toBe('https://x/g-main.jpg')
  })

  it('无可用图返回空串', () => {
    expect(pickGigaMainImage([])).toBe('')
    expect(pickGigaMainImage([choice({ url: '' }), choice({ url: 'https://x/d.jpg', dimmed: true })])).toBe('')
  })
})
