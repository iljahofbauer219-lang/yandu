import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runScheduledPublishChain, SCHEDULED_RUN_TIMEOUT_MS, type ScheduledRunDeps } from '../scheduledPublishRun'

/**
 * 到点执行链挂起修复（2026-11-17）：scheduledRunning 复位只在 IPC 链落定后到达，
 * prepare 长挂（captcha/半死连接）时 flag 恒 true、后续到点被永久跳过。
 * 修复＝整链 raceTimeout(300s)＋超时后 token 守卫丢弃迟到结果。这里用假时钟跑真实模块：
 * 挂起必在 300s 落定失败（调用方得以复位 flag 并记失败态），迟到续跑零副作用，正常路径不回归。
 */
const okDeps=(over:Partial<ScheduledRunDeps>={}):ScheduledRunDeps=>({
  title:'Bracket',
  prepare:async()=>({}),
  readDraftTitle:async()=>({title:'Bracket'}),
  fillAuto:async()=>undefined,
  fillFixed:async()=>undefined,
  publish:async()=>({status:'PUBLISHED',message:''}),
  refreshLocal:async()=>undefined,
  removeLocal:async()=>undefined,
  refreshListings:async()=>undefined,
  afterPublished:()=>undefined,
  ...over
})
const never=<T,>():Promise<T>=>new Promise<T>(()=>{})

beforeEach(()=>{vi.useFakeTimers()})
afterEach(()=>{vi.useRealTimers()})

describe('到点执行链 · 挂起超时与迟到守卫', () => {
  it('prepare 永不落定：300s 整链超时失败，中文点名', async () => {
    const promise=runScheduledPublishChain(okDeps({prepare:()=>never()}))
    const assertion=expect(promise).rejects.toThrow('自动发布执行超时（300秒）')
    await vi.advanceTimersByTimeAsync(SCHEDULED_RUN_TIMEOUT_MS)
    await assertion
  })
  it('超时后 prepare 迟到落定：不再走填写/刊登/删除，零副作用', async () => {
    let releasePrepare:(value:{})=>void=()=>{}
    const publish=vi.fn(async()=>({status:'PUBLISHED',message:''}))
    const removeLocal=vi.fn(async()=>undefined)
    const fillAuto=vi.fn(async()=>undefined)
    const promise=runScheduledPublishChain(okDeps({
      prepare:()=>new Promise<{}>(resolve=>{releasePrepare=resolve}),
      publish,removeLocal,fillAuto
    }))
    const assertion=expect(promise).rejects.toThrow('自动发布执行超时')
    await vi.advanceTimersByTimeAsync(SCHEDULED_RUN_TIMEOUT_MS)
    await assertion
    releasePrepare({})
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fillAuto).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
    expect(removeLocal).not.toHaveBeenCalled()
  })
  it('publish 挂起（前段落定）：同样 300s 超时，迟到成功不得删本地行/刷新列表', async () => {
    const removeLocal=vi.fn(async()=>undefined)
    const refreshListings=vi.fn(async()=>undefined)
    const afterPublished=vi.fn()
    let releasePublish:(value:{status:string;message:string})=>void=()=>{}
    const promise=runScheduledPublishChain(okDeps({
      publish:()=>new Promise<{status:string;message:string}>(resolve=>{releasePublish=resolve}),
      removeLocal,refreshListings,afterPublished
    }))
    const assertion=expect(promise).rejects.toThrow('自动发布执行超时')
    await vi.advanceTimersByTimeAsync(SCHEDULED_RUN_TIMEOUT_MS)
    await assertion
    releasePublish({status:'PUBLISHED',message:''})
    await vi.advanceTimersByTimeAsync(60_000)
    expect(removeLocal).not.toHaveBeenCalled()
    expect(refreshListings).not.toHaveBeenCalled()
    expect(afterPublished).not.toHaveBeenCalled()
  })
  it('超时前一刻落定成功不算超时（边界不误杀）', async () => {
    const afterPublished=vi.fn()
    const promise=runScheduledPublishChain(okDeps({afterPublished}))
    await vi.advanceTimersByTimeAsync(SCHEDULED_RUN_TIMEOUT_MS-1)
    await expect(promise).resolves.toBeUndefined()
    expect(afterPublished).toHaveBeenCalledTimes(1)
  })
})

describe('到点执行链 · 既有语义不回归', () => {
  it('正常成功：prepare→标题门→auto→fixed→刊登→刷新/移除/列表→afterPublished 各一次', async () => {
    const calls:string[]=[]
    const deps=okDeps({
      prepare:async()=>{calls.push('prepare');return {}},
      readDraftTitle:async()=>{calls.push('gate');return {title:'Bracket'}},
      fillAuto:async()=>{calls.push('auto')},
      fillFixed:async()=>{calls.push('fixed')},
      publish:async()=>{calls.push('publish');return {status:'PUBLISHED',message:''}},
      removeLocal:async()=>{calls.push('remove')},
      refreshListings:async()=>{calls.push('listings')},
      afterPublished:()=>{calls.push('after')}
    })
    const promise=runScheduledPublishChain(deps)
    await vi.advanceTimersByTimeAsync(0)
    await expect(promise).resolves.toBeUndefined()
    expect(calls).toEqual(['prepare','gate','auto','fixed','publish','remove','listings','after'])
  })
  it('首次失败 1.5s 后重试一次成功（重试延迟走注入 delay，可被假时钟推进）', async () => {
    let attempt=0
    const publish=vi.fn(async()=>{attempt+=1;if(attempt===1)throw new Error('网络抖动');return {status:'PUBLISHED',message:''}})
    const promise=runScheduledPublishChain(okDeps({publish}))
    await vi.advanceTimersByTimeAsync(1500)
    await expect(promise).resolves.toBeUndefined()
    expect(publish).toHaveBeenCalledTimes(2)
  })
  it('两次都失败：抛出最后一次错误原文（调用方记失败态）', async () => {
    const promise=runScheduledPublishChain(okDeps({publish:async()=>{throw new Error('eBay 拒绝刊登')}}))
    const assertion=expect(promise).rejects.toThrow('eBay 拒绝刊登')
    await vi.advanceTimersByTimeAsync(1500)
    await assertion
  })
  it('标题不符：中止且不点刊登', async () => {
    const publish=vi.fn(async()=>({status:'PUBLISHED',message:''}))
    const promise=runScheduledPublishChain(okDeps({readDraftTitle:async()=>({title:'别的标题'}),publish}))
    const assertion=expect(promise).rejects.toThrow('草稿标题与本地不符')
    await vi.advanceTimersByTimeAsync(1500)
    await assertion
    expect(publish).not.toHaveBeenCalled()
  })
  it('refDeleted：先刷新本地列表再中止（不新建顶替）', async () => {
    const order:string[]=[]
    const promise=runScheduledPublishChain(okDeps({
      prepare:async()=>({refDeleted:true}),
      refreshLocal:async()=>{order.push('refresh')},
      publish:async()=>{order.push('publish');return {status:'PUBLISHED',message:''}}
    }))
    const assertion=expect(promise).rejects.toThrow('eBay 草稿已删除')
    await vi.advanceTimersByTimeAsync(1500)
    await assertion
    expect(order).toEqual(['refresh','refresh'])
  })
  it('刊登返回非 PUBLISHED：按失败重试，不得走成功移除', async () => {
    const removeLocal=vi.fn(async()=>undefined)
    const promise=runScheduledPublishChain(okDeps({publish:async()=>({status:'FAILED',message:'落地页非上架成功页'}),removeLocal}))
    const assertion=expect(promise).rejects.toThrow('落地页非上架成功页')
    await vi.advanceTimersByTimeAsync(1500)
    await assertion
    expect(removeLocal).not.toHaveBeenCalled()
  })
})