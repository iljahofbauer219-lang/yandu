import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'
import type { EbayScrapedPolicyOption } from '../../../shared/contracts'

/**
 * 回归守卫：eBay 店铺级业务政策（付款/运输/退货）是「零新 API」方案下唯一可复用的发布资产。
 * 语义：政策 ID 从下拉文本括号里解出；无 ID 的行不入库；同类目重复抓取覆盖标签与计数，不产生重复行；
 * 「当前选中」映射为 is_default，供 APP 下一次发布默认选同一政策。
 * 破坏面守卫：清空范围只来自通过 ID 门禁的行——某类全行解不出 ID（eBay 改下拉结构）或提交空数组时，
 * 跳过该类 DELETE 且整体 no-op，绝不清空这份可复用政策资产；整个 DELETE+INSERT 走单事务。
 * 代价（Task 4 裁定，Task 5 已在抓取侧点名）：eBay 真删光某一类政策时本方法清不掉旧行，
 * 因为「显式删除信号」必须由抓取侧给出，本表不自行推断整体消失。
 */

const ctx=vi.hoisted(()=>({dir:''}))

vi.mock('electron',async()=>{
  const os=await import('node:os')
  const nodePath=await import('node:path')
  const fs=await import('node:fs')
  ctx.dir=fs.mkdtempSync(nodePath.join(os.tmpdir(),'appdb-policies-test-'))
  return {app:{getPath:()=>ctx.dir}}
})

const option=(kind:EbayScrapedPolicyOption['kind'],label:string,policyId:string|undefined,selected=false):EbayScrapedPolicyOption=>
  ({...(policyId?{policyId}:{}),kind,label,selected})

describe('AppDatabase · eBay 业务政策库', () => {
  let database:AppDatabaseType
  let storeId=''

  beforeAll(async()=>{
    const {AppDatabase}=await import('../AppDatabase.js')
    database=new AppDatabase()
    storeId=database.createEbayStore('政策验收店','qa@example.test','enc','EBAY_US').id
  })

  it('首抓落库三类政策，is_default 跟随 selected，无 policyId 的行被丢弃', () => {
    const rows=database.saveEbayBusinessPolicies(storeId,[
      option('PAYMENT','eBay Managed Payments','257217501013',true),
      option('PAYMENT','没有 ID 的旧样式',undefined),
      option('SHIPPING','云仓包邮','18510002003'),
      option('SHIPPING','标准运输','18510002004',true),
      option('RETURN','14天大健云仓退货','19007008009',true)
    ])
    expect(rows).toHaveLength(4)
    expect(database.getEbayBusinessPolicies(storeId).map(item=>item.label)).toEqual(
      ['eBay Managed Payments','14天大健云仓退货','云仓包邮','标准运输']
    )
    expect(database.getEbayBusinessPolicies(storeId,'SHIPPING').map(item=>item.policyId)).toEqual(['18510002004','18510002003'])
    expect(database.getEbayBusinessPolicies(storeId,'PAYMENT').find(item=>item.policyId==='257217501013')?.isDefault).toBe(true)
  })

  it('二抓同 ID 改名 → 覆盖不增行；某类政策整体消失 → 该类旧行清空', () => {
    database.saveEbayBusinessPolicies(storeId,[option('SHIPPING','云仓包邮（改）','18510002003',true)])
    const shipping=database.getEbayBusinessPolicies(storeId,'SHIPPING')
    expect(shipping.map(item=>item.label)).toEqual(['云仓包邮（改）'])
    expect(shipping[0].isDefault).toBe(true)
    expect(database.getEbayBusinessPolicies(storeId,'PAYMENT')).toHaveLength(1)
  })

  it('listingCount 从文本计数写入并可原样读回', () => {
    database.saveEbayBusinessPolicies(storeId,[{kind:'RETURN',label:'30天退货',policyId:'19007008010',listingCount:2050,selected:true}])
    expect(database.getEbayBusinessPolicies(storeId,'RETURN').find(item=>item.policyId==='19007008010')?.listingCount).toBe(2050)
  })

  it('空数组提交是 no-op：不删不增，既有政策原样保留（Task 5 允许零结果抓取）', () => {
    const before=database.getEbayBusinessPolicies(storeId)
    expect(before.length).toBeGreaterThan(0)
    expect(database.saveEbayBusinessPolicies(storeId,[])).toEqual([])
    expect(database.getEbayBusinessPolicies(storeId)).toEqual(before)
  })

  it('某类政策全部行过不了 ID 门禁 → 跳过该类 DELETE，既有政策原样保留', () => {
    const before=database.getEbayBusinessPolicies(storeId)
    expect(before.length).toBeGreaterThan(0)
    expect(database.saveEbayBusinessPolicies(storeId,[
      option('SHIPPING','eBay 新版下拉（解不出数字 ID）A','12345'),
      option('SHIPPING','eBay 新版下拉（解不出数字 ID）B',undefined),
      option('PAYMENT','付款新样式','abc')
    ])).toEqual([])
    expect(database.getEbayBusinessPolicies(storeId)).toEqual(before)
  })

  it('同批重复 policyId 走 ON CONFLICT 覆盖：库里只留最后一行的标签与计数', () => {
    const saved=database.saveEbayBusinessPolicies(storeId,[
      option('FULFILLMENT','云仓履约','20250001001',true),
      {kind:'FULFILLMENT',label:'云仓履约（改名）',policyId:'20250001001',listingCount:12,selected:false}
    ])
    const id=`${storeId}:FULFILLMENT:20250001001`
    expect(saved.map(item=>item.id)).toEqual([id,id])
    expect(database.getEbayBusinessPolicies(storeId,'FULFILLMENT')).toEqual([
      {id,storeId,kind:'FULFILLMENT',policyId:'20250001001',label:'云仓履约（改名）',listingCount:12,isDefault:false,updatedAt:saved[0].updatedAt}
    ])
  })

  it('行主键固定为 storeId:kind:policyId（Task 7 fixtures 依赖该格式）', () => {
    const saved=database.saveEbayBusinessPolicies(storeId,[option('RETURN','90天退货','19007008099')])
    expect(saved[0].id).toBe(`${storeId}:RETURN:19007008099`)
    expect(database.getEbayBusinessPolicies(storeId,'RETURN').map(item=>item.id)).toEqual([`${storeId}:RETURN:19007008099`])
  })

  it('店铺之间互不可见', () => {
    const other=database.createEbayStore('别家店','other@example.test','enc','EBAY_US').id
    expect(database.getEbayBusinessPolicies(other)).toEqual([])
  })
})
