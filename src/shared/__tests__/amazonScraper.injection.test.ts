import vm from 'node:vm'
import { describe, expect, it } from 'vitest'
import { AMAZON_LISTING_EVIDENCE_SCRIPT, AMAZON_REVIEW_EVIDENCE_SCRIPT, AMAZON_SAMPLES_SCRIPT } from '../amazonScraper'

/**
 * 这两个常量会被 toString 序列化后注入到 Amazon 页面的隐藏视图里执行。
 * 页面上下文没有模块作用域：任何对模块级变量/函数的引用都会抛 ReferenceError，
 * 而调用方（BrowserWorkspace）用空 catch 吞掉，故障表现为「证据静默为空」。
 * 因此这里在全新 vm 上下文中真实执行注入串——只要不自包含就必然失败。
 */

/** 详情页桩：Item Weight 1.2 磅、Package Dimensions 10×8×2 英寸，足以走到三个 helper 的调用点 */
function makeDetailDocument() {
  const row = (th: string, td: string) => ({
    querySelector: (selector: string) => (selector.startsWith('th') ? { textContent: th } : { textContent: td })
  })
  const detailRows = [row('Item Weight', '1.2 pounds'), row('Package Dimensions', '10 x 8 x 2 inches')]
  return {
    title: 'Amazon.com: Cotton T-Shirt',
    documentElement: { innerHTML: '' },
    querySelector: (selector: string) => {
      if (selector === '#ASIN') return { value: 'B0TESTASIN' }
      if (selector === '#productTitle') return { textContent: ' 纯棉 T 恤 ' }
      return null
    },
    querySelectorAll: (selector: string) => (selector.includes('productDetails_detailBullets_sections1 tr') ? detailRows : [])
  }
}

/** 搜索页桩：一张结果卡，足以走完 extractAmazonSamples 的取字段路径 */
function makeSearchDocument() {
  const card = {
    getAttribute: (name: string) => (name === 'data-asin' ? 'B0SEARCHASIN' : null),
    querySelector: (selector: string) => {
      if (selector === 'h2') return { textContent: ' Sample Title ' }
      if (selector === '.a-price .a-offscreen') return { textContent: '$19.99' }
      if (selector.startsWith('i.a-icon-star span')) return { textContent: '4.5 out of 5 stars' }
      return null
    }
  }
  return {
    title: 'Amazon.com: search results',
    querySelector: () => null,
    querySelectorAll: (selector: string) => (selector.includes('s-search-result') ? [card] : [])
  }
}

function runInPage(script: string, document: unknown): unknown {
  const context = vm.createContext({ document, location: { href: 'https://www.amazon.com/dp/B0TESTASIN' } })
  return vm.runInContext(script, context)
}

/** 评论页桩：路径含 product-reviews/<ASIN>，一条可见评论 */
function makeReviewDocument() {
  const card = {
    querySelector: (selector: string) => {
      if (selector.includes('review-star-rating')) return { textContent: '4.0 out of 5 stars' }
      if (selector.includes('review-title')) return { textContent: ' 不错 ' }
      if (selector.includes('review-body')) return { textContent: ' 面料舒服 ' }
      return null
    }
  }
  return {
    title: 'Amazon.com: customer reviews',
    location: { pathname: '/product-reviews/B0TESTASIN', href: 'https://www.amazon.com/product-reviews/B0TESTASIN' },
    querySelector: () => null,
    querySelectorAll: (selector: string) => (selector.includes('data-hook="review"') ? [card] : [])
  }
}

describe('Amazon 注入脚本自包含性', () => {
  it('详情页脚本在无模块作用域的上下文中执行成功，并算出重量/尺寸/尺码段', () => {
    const result = runInPage(AMAZON_LISTING_EVIDENCE_SCRIPT, makeDetailDocument()) as Record<string, unknown> | null
    expect(result).not.toBeNull()
    expect(result?.asin).toBe('B0TESTASIN')
    expect(result?.title).toBe('纯棉 T 恤')
    // 1.2 lb → round(1.2 × 453.592)
    expect(result?.itemWeightGrams).toBe(544)
    // 10 × 8 × 2 in → cm
    expect(result?.packageDimensionsCm).toEqual({ length: 25.4, width: 20.32, height: 5.08 })
    expect(result?.sizeTierGuess).toBe('LargeStandard')
    expect(result?.url).toBe('https://www.amazon.com/dp/B0TESTASIN')
  })

  it('详情页脚本注入了三个 helper 的函数定义', () => {
    for (const name of ['parseAmazonItemWeightGrams', 'parseAmazonPackageDimensionsCm', 'determineAmazonSizeTier']) {
      expect(AMAZON_LISTING_EVIDENCE_SCRIPT).toContain(`function ${name}`)
    }
  })

  it('搜索页脚本同样自包含（回归守卫）', () => {
    const samples = runInPage(AMAZON_SAMPLES_SCRIPT, makeSearchDocument()) as Array<Record<string, unknown>> | null
    expect(samples).toHaveLength(1)
    expect(samples?.[0]).toMatchObject({ asin: 'B0SEARCHASIN', title: 'Sample Title', price: 19.99, rating: 4.5, sponsored: false, source: 'browser' })
  })

  it('评论页脚本同样自包含（回归守卫）', () => {
    const result = runInPage(AMAZON_REVIEW_EVIDENCE_SCRIPT, makeReviewDocument()) as Record<string, unknown> | null
    expect(result).not.toBeNull()
    expect(result?.asin).toBe('B0TESTASIN')
    expect(result?.url).toBe('https://www.amazon.com/product-reviews/B0TESTASIN')
    expect(result?.snippets).toEqual([{ rating: 4, title: '不错', body: '面料舒服' }])
  })

  it('三个脚本都不残留对模块级符号的裸引用', () => {
    // helper 已被一并注入，因此它们的出现是定义而非未定义引用；
    // 这里守住「不要引入新的模块级依赖」：注入串里不得出现 import/export 或其它已知模块常量名
    for (const script of [AMAZON_LISTING_EVIDENCE_SCRIPT, AMAZON_SAMPLES_SCRIPT, AMAZON_REVIEW_EVIDENCE_SCRIPT]) {
      expect(script).not.toMatch(/\b(import|export|require)\b/)
      expect(script).not.toContain('AMAZON_FBA_FEE_TABLE')
      expect(script).not.toContain('EBAY_')
    }
  })
})
