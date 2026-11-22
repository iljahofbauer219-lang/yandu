import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeEnglishDescription } from '../../../shared/ebaySpecificsEnglish'
import { EbayOptimizationService } from '../EbayOptimizationService'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

const TITLE = '6" Running Boards Side Steps for 2009-2024 Dodge Ram 1500 2500 3500 Crew Cab'

const reply = {
  overview: 'Running boards for Dodge Ram trucks.',
  benefits: [1, 2, 3].map(index => ({
    painPoint: `Stock side steps feel flimsy ${index}`,
    solution: 'Carbon steel construction helps support daily entry',
    customerBenefit: 'Helps owners step into the cab with confidence',
    evidenceFactIds: ['F002']
  })),
  scenarios: [1, 2, 3].map(index => ({
    title: `Daily Driving ${index}`,
    description: 'Suitable for trucks used on paved roads',
    evidenceFactIds: ['F003']
  })),
  storyboard: []
}

describe('详情生成概览段不被中文事实行清空', () => {
  it('SOURCE_DESCRIPTION 含中文行时 SUMMARY 仍非空且过 normalize 存活', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] })
    })) as unknown as typeof fetch
    const service = new EbayOptimizationService('sk-test', 'https://api.deepseek.com', 'deepseek-v4-flash')
    const result = await service.optimizeContent({
      listingId: 'PALLET-overview-test',
      originalTitle: 'Running Boards',
      selectedTitle: TITLE,
      categoryName: 'Running Boards & Nerf Bars',
      condition: 'New',
      itemSpecifics: [
        { name: 'Brand', value: 'XINHUIYING' },
        { name: 'Color', value: 'Black' },
        { name: 'Material', value: 'Carbon Steel' }
      ],
      sourceDescription: '图文描述\nHeavy Duty Carbon Steel Construction\nPowder Coated Finish',
      sellerNotes: ''
    })
    const summary = result.sections.find(section => section.id === 'SUMMARY')
    expect(summary?.content).toContain(TITLE)
    expect(summary?.content).toContain('Heavy Duty Carbon Steel Construction')
    expect(summary?.content).not.toMatch(/[一-鿿]/)
    expect(normalizeEnglishDescription(summary?.content || '')).not.toBe('')
    expect(result.englishDescription).toMatch(/PRODUCT OVERVIEW\n\S/)
  })
})