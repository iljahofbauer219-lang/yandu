import { afterEach, describe, expect, it, vi } from 'vitest'
import { EbayOptimizationService } from '../EbayOptimizationService'

const originalFetch=globalThis.fetch
const transportFailure=(code:string,message:string)=>()=>Object.assign(new TypeError('fetch failed'),{cause:Object.assign(new Error(message),{code})})
const nodes=[{categoryId:'42289',path:'Home & Garden > Outdoor'}]
const input={title:'3 Piece Patio Set',sourceCategory:'家居',nodes}

afterEach(()=>{globalThis.fetch=originalFetch})

describe('EbayOptimizationService 传输层故障处理', () => {
  it('DNS 解析失败自动重试一次并给出中文原因', async () => {
    let calls=0
    globalThis.fetch=vi.fn(async()=>{calls+=1;throw transportFailure('ENOTFOUND','getaddrinfo ENOTFOUND api.deepseek.com')()}) as unknown as typeof fetch
    const result=await new EbayOptimizationService('sk-test','https://api.deepseek.com','deepseek-v4-flash').classifyCategory(input)
    expect(result.categoryId).toBeNull()
    expect(result.reason).toContain('DNS')
    expect(result.reason).not.toMatch(/fetch failed|getaddrinfo/i)
    expect(calls).toBe(2)
  })

  it('连接被拦截时不做无谓重试', async () => {
    let calls=0
    globalThis.fetch=vi.fn(async()=>{calls+=1;throw transportFailure('ECONNREFUSED','connect ECONNREFUSED 127.0.0.1:443')()}) as unknown as typeof fetch
    const result=await new EbayOptimizationService('sk-test','https://api.deepseek.com','deepseek-v4-flash').classifyCategory(input)
    expect(result.reason).toContain('防火墙')
    expect(calls).toBe(1)
  })

  it('瞬时断连重试成功即照常产出结果，不打回用户', async () => {
    let calls=0
    globalThis.fetch=vi.fn(async()=>{
      calls+=1
      if(calls===1)throw transportFailure('ECONNRESET','socket hang up')()
      return {ok:true,status:200,json:async()=>({choices:[{message:{content:'{"categoryId":"42289","reason":"类目路径匹配商品标题"}'}}]})}
    }) as unknown as typeof fetch
    const result=await new EbayOptimizationService('sk-test','https://api.deepseek.com','deepseek-v4-flash').classifyCategory(input)
    expect(result.categoryId).toBe('42289')
    expect(calls).toBe(2)
  })

  it('HTTP 401 也给出中文原因，不透出接口裸英文串', async () => {
    globalThis.fetch=vi.fn(async()=>({ok:false,status:401,json:async()=>({error:{message:'Authentication Fails'}})})) as unknown as typeof fetch
    const result=await new EbayOptimizationService('sk-test','https://api.deepseek.com','deepseek-v4-flash').classifyCategory(input)
    expect(result.reason).toContain('API Key 无效或没有权限（HTTP 401）')
    expect(result.reason).toContain('大模型 API Key 管理')
    expect(result.reason).not.toMatch(/^Authentication Fails/)
  })

  it('未配置 Key 时保持原有中文提示', async () => {
    const result=await new EbayOptimizationService('','https://api.deepseek.com','deepseek-v4-flash').classifyCategory(input)
    expect(result.reason).toContain('未配置 DeepSeek API Key')
  })
})
