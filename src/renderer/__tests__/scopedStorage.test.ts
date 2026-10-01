/**
 * scopedStorage 单测：纯函数（索引解析 / LRU 裁剪）+ 内存替身驱动的读写与历史键迁移。
 * 说明：仓库根 vitest.config.ts 的 include 只覆盖 src/main、src/shared、server/src 的 __tests__，
 * 渲染进程目录暂未被采集；本文件随 tsconfig（include: src/renderer）参与 tsc --noEmit 类型校验，
 * 需要实跑时用一份把 include 指向本目录的临时 vitest 配置即可（不依赖 DOM，environment: node）。
 */
import { describe, expect, it } from 'vitest'
import {
  SCOPED_STORAGE_LIMIT,
  SCOPED_STORAGE_ORDER_KEY,
  SCOPED_STORAGE_PREFIX,
  parseScopedOrder,
  pruneScopedKeys,
  readScopedItem,
  scopedStorageKey,
  writeScopedItem,
  type ScopedStore
} from '../scopedStorage'

/** 内存版 localStorage 替身：只实现工具用到的三个方法 */
function createMemoryStore(initial: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(initial))
  const store: ScopedStore = {
    getItem: key => (map.has(key) ? map.get(key) ?? null : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: key => { map.delete(key) }
  }
  return { store, map }
}

const orderOf = (map: Map<string, string>) => parseScopedOrder(map.get(SCOPED_STORAGE_ORDER_KEY) ?? null)

describe('scopedStorageKey', () => {
  it('统一前缀 + family + id，去掉前缀即历史键名', () => {
    const key = scopedStorageKey('ebay-source-selection:v1', 'L-1')
    expect(key).toBe(`${SCOPED_STORAGE_PREFIX}ebay-source-selection:v1:L-1`)
    expect(key.slice(SCOPED_STORAGE_PREFIX.length)).toBe('ebay-source-selection:v1:L-1')
  })

  it('多维度 id 直接拼接（店铺:商品）', () => {
    expect(scopedStorageKey('ebay-research-query', 'S-9:L-1')).toBe(`${SCOPED_STORAGE_PREFIX}ebay-research-query:S-9:L-1`)
  })
})

describe('parseScopedOrder', () => {
  it('空值与非法内容一律回退空索引', () => {
    expect(parseScopedOrder(null)).toEqual([])
    expect(parseScopedOrder('')).toEqual([])
    expect(parseScopedOrder('not-json')).toEqual([])
    expect(parseScopedOrder('{"a":1}')).toEqual([])
  })

  it('过滤非字符串与空串，并按首次出现位置去重', () => {
    expect(parseScopedOrder(JSON.stringify(['b', 1, '', 'a', 'b', null]))).toEqual(['b', 'a'])
  })
})

describe('pruneScopedKeys', () => {
  it('未超上限时只把命中键提到队首', () => {
    expect(pruneScopedKeys(['a', 'b', 'c'], 'c', 10)).toEqual({ order: ['c', 'a', 'b'], evicted: [] })
  })

  it('新键写入不重复计数', () => {
    expect(pruneScopedKeys(['a', 'b'], 'n', 10)).toEqual({ order: ['n', 'a', 'b'], evicted: [] })
  })

  it('超出上限时淘汰最旧键', () => {
    expect(pruneScopedKeys(['a', 'b', 'c'], 'd', 3)).toEqual({ order: ['d', 'a', 'b'], evicted: ['c'] })
  })

  it('limit <= 0 视为不裁剪', () => {
    expect(pruneScopedKeys(['a', 'b', 'c'], 'd', 0).evicted).toEqual([])
    expect(pruneScopedKeys(['a', 'b', 'c'], 'd', -1).order).toEqual(['d', 'a', 'b', 'c'])
  })
})

describe('writeScopedItem / readScopedItem', () => {
  it('写入后登记索引，读取返回原值', () => {
    const { store, map } = createMemoryStore()
    const key = scopedStorageKey('ebay-profit-assumptions', 'P-1')
    writeScopedItem(store, key, '{"fee":1}')
    expect(readScopedItem(store, key)).toBe('{"fee":1}')
    expect(orderOf(map)).toEqual([key])
  })

  it('重复写入同一键不撑大索引，且刷新到队首', () => {
    const { store, map } = createMemoryStore()
    const first = scopedStorageKey('ebay-profit-assumptions', 'P-1')
    const second = scopedStorageKey('ebay-profit-assumptions', 'P-2')
    writeScopedItem(store, first, '1')
    writeScopedItem(store, second, '2')
    writeScopedItem(store, first, '1b')
    expect(orderOf(map)).toEqual([first, second])
    expect(readScopedItem(store, first)).toBe('1b')
  })

  it('超过上限时连带删除最旧的维度键', () => {
    const { store, map } = createMemoryStore()
    const keys = Array.from({ length: SCOPED_STORAGE_LIMIT + 5 }, (_, index) => scopedStorageKey('ebay-profit-assumptions', `P-${index}`))
    for (const key of keys) writeScopedItem(store, key, 'x')
    const order = orderOf(map)
    expect(order).toHaveLength(SCOPED_STORAGE_LIMIT)
    expect(order[0]).toBe(keys[keys.length - 1])
    // 最旧 5 个键既不在索引中，也已从存储里删除
    for (const stale of keys.slice(0, 5)) {
      expect(order).not.toContain(stale)
      expect(readScopedItem(store, stale)).toBeNull()
    }
    expect([...map.keys()].filter(key => key !== SCOPED_STORAGE_ORDER_KEY)).toHaveLength(SCOPED_STORAGE_LIMIT)
  })

  it('命中历史键时迁移到新键、删除历史键并登记索引', () => {
    const legacy = 'ebay-image-source-curation:v1:L-7'
    const key = scopedStorageKey('ebay-image-source-curation:v1', 'L-7')
    const { store, map } = createMemoryStore({ [legacy]: '{"a":{"enabled":true}}' })
    expect(readScopedItem(store, key)).toBe('{"a":{"enabled":true}}')
    expect(map.has(legacy)).toBe(false)
    expect(map.get(key)).toBe('{"a":{"enabled":true}}')
    expect(orderOf(map)).toEqual([key])
  })

  it('新旧键都缺失时返回 null 且不写索引', () => {
    const { store, map } = createMemoryStore()
    expect(readScopedItem(store, scopedStorageKey('ebay-research-query', 'S:L'))).toBeNull()
    expect(map.size).toBe(0)
  })

  it('存储抛异常（配额不足）时读写都不向上冒泡', () => {
    const broken: ScopedStore = {
      getItem: () => { throw new Error('quota') },
      setItem: () => { throw new Error('quota') },
      removeItem: () => { throw new Error('quota') }
    }
    expect(writeScopedItem(broken, 'scoped:v1:x:1', 'v')).toEqual([])
    expect(readScopedItem(broken, 'scoped:v1:x:1')).toBeNull()
  })
})
