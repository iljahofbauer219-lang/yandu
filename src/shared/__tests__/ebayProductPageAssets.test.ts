/**
 * 「① 产品原图」必须等于服务器产品页当前批次的资产地址。
 * 重下是整批替换（同名可能换扩展名），旧快照里残留的 08.jpg/09.jpg 在服务器上已是 404，
 * 读取时按当前批次对齐，界面才不会出破图。
 */
import { describe, expect, it } from 'vitest'
import { applyServerAssetBatch, isStaleProductPageAsset, productPageAssetName } from '../ebayProductPageAssets'

const SERVER = 'http://114.55.149.192'
const PAGE_ID = 'VvvHDTiUXSyXlHDm'
const asset = (name: string, server = SERVER, pageId = PAGE_ID) => `${server}/product-pages/${pageId}/assets/${name}`
const CURRENT_BATCH = ['01.jpg', '02.jpg', '03.jpg', '04.jpg', '05.jpg', '06.jpg', '07.jpg', '08.png', '09.png', '10.jpg', '11.jpg', '12.jpg', '13.jpg', '14.jpg', '15.jpg']
const STALE_SNAPSHOT = ['https://b2bfiles1.gigab2b.cn/image/wkseller/22567/20230509_main.jpg', ...['01.jpg', '02.jpg', '03.jpg', '04.jpg', '05.jpg', '06.jpg', '07.jpg', '08.jpg', '09.jpg', '10.jpg', '11.jpg', '12.jpg', '13.jpg', '14.jpg', '15.jpg'].map(name => asset(name))]

describe('applyServerAssetBatch：原图地址对齐服务器当前批次', () => {
  it('失效的 08.jpg/09.jpg 被当前批次的 08.png/09.png 取代，其余保持不变', () => {
    const next = applyServerAssetBatch(STALE_SNAPSHOT, { serverUrl: SERVER, pageId: PAGE_ID, assets: CURRENT_BATCH })
    expect(next).not.toContain(asset('08.jpg'))
    expect(next).not.toContain(asset('09.jpg'))
    expect(next).toContain(asset('08.png'))
    expect(next).toContain(asset('09.png'))
    expect(next.filter(url => productPageAssetName(url)?.pageId === PAGE_ID)).toEqual(CURRENT_BATCH.map(name => asset(name)))
  })

  it('非产品页地址原样保留并排在批次资产之前', () => {
    const next = applyServerAssetBatch(STALE_SNAPSHOT, { serverUrl: SERVER, pageId: PAGE_ID, assets: CURRENT_BATCH })
    expect(next[0]).toBe('https://b2bfiles1.gigab2b.cn/image/wkseller/22567/20230509_main.jpg')
    expect(next).toHaveLength(1 + CURRENT_BATCH.length)
  })

  it('按当前服务器地址重写页面资产（服务器换域名后旧地址不再残留）', () => {
    const legacy = [...CURRENT_BATCH.map(name => asset(name, 'http://10.0.0.9')), 'https://example.test/a.jpg']
    const next = applyServerAssetBatch(legacy, { serverUrl: SERVER, pageId: PAGE_ID, assets: CURRENT_BATCH })
    expect(next.filter(url => url.startsWith(SERVER))).toHaveLength(CURRENT_BATCH.length)
    expect(next.filter(url => url.startsWith('http://10.0.0.9'))).toEqual([])
  })

  it('批次为空或页面标识缺失时不动原清单（未重下不得误删）', () => {
    expect(applyServerAssetBatch(STALE_SNAPSHOT, { serverUrl: SERVER, pageId: PAGE_ID, assets: [] })).toEqual(STALE_SNAPSHOT)
    expect(applyServerAssetBatch(STALE_SNAPSHOT, { serverUrl: SERVER, pageId: '', assets: CURRENT_BATCH })).toEqual(STALE_SNAPSHOT)
    expect(applyServerAssetBatch(STALE_SNAPSHOT, { serverUrl: '', pageId: PAGE_ID, assets: CURRENT_BATCH })).toEqual(STALE_SNAPSHOT)
  })

  it('已是当前批次时幂等：不重复追加', () => {
    const fresh = ['https://example.test/first.jpg', ...CURRENT_BATCH.map(name => asset(name))]
    expect(applyServerAssetBatch(fresh, { serverUrl: SERVER, pageId: PAGE_ID, assets: CURRENT_BATCH })).toEqual(fresh)
  })

  it('脏数据（非法地址）不参与判定也不报错', () => {
    const dirty = ['', 'not-a-url', asset('08.jpg')]
    const next = applyServerAssetBatch(dirty, { serverUrl: SERVER, pageId: PAGE_ID, assets: CURRENT_BATCH })
    expect(next).toContain('not-a-url')
    expect(next).not.toContain(asset('08.jpg'))
  })
})

describe('isStaleProductPageAsset：媒体行是否指向已被替换掉的页面资产', () => {
  const options = { serverUrl: SERVER, pageId: PAGE_ID, assets: [...CURRENT_BATCH, 'v-01.mp4'] }

  it('批次外的页面资产判为失效', () => {
    expect(isStaleProductPageAsset(asset('08.jpg'), options)).toBe(true)
  })

  it('批次内的图片与视频判为有效', () => {
    expect(isStaleProductPageAsset(asset('08.png'), options)).toBe(false)
    expect(isStaleProductPageAsset(asset('v-01.mp4'), options)).toBe(false)
  })

  it('其它页面与其它域名不受影响', () => {
    expect(isStaleProductPageAsset(asset('08.jpg', SERVER, 'OtherPageId'), options)).toBe(false)
    expect(isStaleProductPageAsset('http://114.55.149.192/ai-assets/abc/01.jpg', options)).toBe(false)
    expect(isStaleProductPageAsset('', options)).toBe(false)
  })

  it('批次为空时一律判为有效（宁可保留也不清空）', () => {
    expect(isStaleProductPageAsset(asset('08.jpg'), { serverUrl: SERVER, pageId: PAGE_ID, assets: [] })).toBe(false)
  })
})
