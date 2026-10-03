import { describe, expect, it } from 'vitest'
import type { CurrentUser } from '../../../plugins/auth.js'
import {
  ERP_SOURCE_SENSITIVE_FIELDS,
  canViewErpSource,
  erpProductSelect,
  isExternalUrlToken,
  redactErrorText,
  redactFailedUrls,
  stripErpSourceFields
} from '../projection.js'

function fakeUser(overrides: Partial<CurrentUser>): CurrentUser {
  return {
    id: 'u1',
    orgId: 'org1',
    email: 't@t.com',
    name: 't',
    isOwner: false,
    permissions: new Set<string>(),
    storeScope: null,
    ...overrides
  }
}

const collector = fakeUser({ permissions: new Set(['erp.source.view', 'erp.warehouse.view']) })
const operator = fakeUser({ permissions: new Set(['erp.warehouse.view']) })
const owner = fakeUser({ isOwner: true })

const fullRow: Record<string, unknown> = {
  id: 'p1',
  orgId: 'org1',
  supplierId: 's1',
  sourceProductId: 'SP-1',
  sourceUrl: 'https://gigab2b.com/product/1',
  sourceSku: 'SKU-1',
  collectedBy: 'u-collector',
  crawlConfig: { selectors: {} },
  supplier: { id: 's1', code: 'GIGACLOUD', name: '大健云仓' },
  titleOriginal: '刹车片套装',
  costPrice: 12.5,
  status: 'COLLECTED'
}

describe('ERP 敏感字段投影（规格 §2.2）', () => {
  it('采集专员/主帐号可见来源字段，运营不可见', () => {
    expect(canViewErpSource(collector)).toBe(true)
    expect(canViewErpSource(owner)).toBe(true)
    expect(canViewErpSource(operator)).toBe(false)
  })

  it('运营角色 SQL select 白名单不含任何敏感列', () => {
    const select = erpProductSelect(operator) as Record<string, unknown>
    for (const field of ERP_SOURCE_SENSITIVE_FIELDS) {
      expect(select[field]).toBeUndefined()
    }
    expect(select.titleOriginal).toBe(true)
    expect(select.status).toBe(true)
  })

  it('采集角色 SQL select 白名单包含全部敏感列与供应商摘要', () => {
    const select = erpProductSelect(collector) as Record<string, unknown>
    for (const field of ERP_SOURCE_SENSITIVE_FIELDS) {
      expect(select[field]).toBeDefined()
    }
  })

  it('运营响应 JSON 快照：剥离 6 个敏感字段', () => {
    expect(Object.keys(stripErpSourceFields(fullRow, operator)).sort()).toMatchSnapshot()
  })

  it('采集响应 JSON 快照：保留全部字段', () => {
    expect(Object.keys(stripErpSourceFields(fullRow, collector)).sort()).toMatchSnapshot()
  })

  it('剥离后的运营 payload 逐字段断言（防 F12 抓包）', () => {
    const projected = stripErpSourceFields(fullRow, operator)
    expect(projected).not.toHaveProperty('supplierId')
    expect(projected).not.toHaveProperty('sourceUrl')
    expect(projected).not.toHaveProperty('sourceProductId')
    expect(projected).not.toHaveProperty('sourceSku')
    expect(projected).not.toHaveProperty('collectedBy')
    expect(projected).not.toHaveProperty('crawlConfig')
    expect(projected).not.toHaveProperty('supplier')
    expect(projected).toHaveProperty('titleOriginal', '刹车片套装')
    expect(projected).toHaveProperty('costPrice', 12.5)
  })
})

/** 展示必需列：两角色都要取（缺任一都会让前端图墙/状态标签裂开） */
const IMAGE_DISPLAY_FIELDS = ['id', 'imageType', 'localPath', 'platform', 'isSelected', 'sortOrder'] as const

function imagesSelectOf(user: CurrentUser): Record<string, unknown> {
  const select = erpProductSelect(user) as { images: { select: Record<string, unknown> } }
  return select.images.select
}

describe('images 子投影按角色条件化（缺陷 A：货盘外链旁路）', () => {
  it('运营 images.select 不含 sourceUrl，采集含', () => {
    expect(imagesSelectOf(operator).sourceUrl).toBeUndefined()
    expect(imagesSelectOf(collector).sourceUrl).toBe(true)
    expect(imagesSelectOf(owner).sourceUrl).toBe(true)
  })

  it('两角色都取到全部展示必需列', () => {
    for (const user of [operator, collector]) {
      const select = imagesSelectOf(user)
      for (const field of IMAGE_DISPLAY_FIELDS) expect(select[field]).toBe(true)
    }
  })
})

describe('failed_urls / error 读时红化（缺陷 A：下载任务旁路 + 存量毒数据）', () => {
  it('外链 token 被红化，图片行主键原样保留', () => {
    expect(isExternalUrlToken('https://cdn.gigab2b.com/a/1.jpg')).toBe(true)
    expect(isExternalUrlToken('http://img.1688.com/x.jpeg')).toBe(true)
    expect(isExternalUrlToken('clx8f3k2a0000abcd1234')).toBe(false)
    expect(redactFailedUrls(['https://cdn.gigab2b.com/a/1.jpg', 'clx8f3k2a0000abcd1234']))
      .toEqual(['[REDACTED]', 'clx8f3k2a0000abcd1234'])
  })

  it('无 scheme:// 的条目不误伤（裸主机名、相对路径、空串）', () => {
    expect(redactFailedUrls(['cdn.gigab2b.com/a.jpg', '/media/erp/x.jpg', '']))
      .toEqual(['cdn.gigab2b.com/a.jpg', '/media/erp/x.jpg', ''])
  })

  it('脏 Json（null / 对象 / 字符串）归零为空数组而不抛异常', () => {
    expect(redactFailedUrls(null)).toEqual([])
    expect(redactFailedUrls(undefined)).toEqual([])
    expect(redactFailedUrls({ url: 'https://cdn.gigab2b.com/a.jpg' })).toEqual([])
    expect(redactFailedUrls('https://cdn.gigab2b.com/a.jpg')).toEqual([])
    expect(redactFailedUrls([])).toEqual([])
  })

  it('error 文本内的 URL 全部替换，纯中文计数信息不动', () => {
    expect(redactErrorText('下载失败 3 张，共尝试 3 次')).toBe('下载失败 3 张，共尝试 3 次')
    expect(redactErrorText('')).toBe('')
    expect(redactErrorText('fetch failed for https://cdn.gigab2b.com/a.jpg (HTTP 403)'))
      .toBe('fetch failed for [REDACTED] (HTTP 403)')
    expect(redactErrorText('http://a.com/1 与 https://b.com/2 均超时'))
      .toBe('[REDACTED] 与 [REDACTED] 均超时')
  })
})
