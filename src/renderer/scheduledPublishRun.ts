import { raceTimeout } from '../shared/raceTimeout'

/**
 * 到点自动发布执行链（从 App.tsx 抽离，行为零变化）＋挂起修复：
 * scheduledRunning 复位只在链落定后到达，prepare 长挂（captcha/半死连接）时 flag 恒 true、
 * 后续到点被永久跳过。这里给整链加 300s 竞态超时：超时即 reject，调用方走既有失败路径
 * （复位 flag＋markScheduleFailure）。底层 IPC 可能晚到落定，token 守卫在每个 await 后拦截，
 * 过期即中止——杜绝迟到续跑造成重复刊登/误删本地行。
 */
export const SCHEDULED_RUN_TIMEOUT_MS=300_000
export const SCHEDULED_RUN_TIMEOUT_MESSAGE='自动发布执行超时（300秒），已中止本轮，可重新开启自动发布重试'

export interface ScheduledRunDeps {
  title:string
  prepare:()=>Promise<{refDeleted?:boolean}>
  readDraftTitle:()=>Promise<{title:string}>
  fillAuto:()=>Promise<unknown>
  fillFixed:()=>Promise<unknown>
  // 已存 eBay 草稿＝内容已是用户确认快照：只开草稿+刊登，跳过重填（政策/媒体重灌易失败/挂起）
  skipFill?:boolean
  publish:()=>Promise<{status:string;message:string}>
  refreshLocal:()=>Promise<unknown>
  removeLocal:()=>Promise<unknown>
  refreshListings:()=>Promise<unknown>
  afterPublished:()=>void
  delay?:(ms:number)=>Promise<void>
}

export async function runScheduledPublishChain(deps:ScheduledRunDeps,timeoutMs:number=SCHEDULED_RUN_TIMEOUT_MS):Promise<void> {
  let expired=false
  const guard=()=>{if(expired)throw new Error(SCHEDULED_RUN_TIMEOUT_MESSAGE)}
  const delay=deps.delay??(ms=>new Promise<void>(resolve=>setTimeout(resolve,ms)))
  const chain=(async()=>{
    let lastError:unknown=null
    for(let attempt=0;attempt<2;attempt+=1){
      try{
        const prep=await deps.prepare();guard()
        if(prep.refDeleted){await deps.refreshLocal();guard();throw new Error('eBay 草稿已删除，已中止自动发布（不新建顶替）；完成态已清空')}
        const gate=await deps.readDraftTitle();guard()
        if(gate.title&&gate.title!==deps.title.trim())throw new Error(`草稿标题与本地不符（${gate.title.slice(0,30)}），已中止自动发布，请先修复草稿`)
        if(!deps.skipFill){await deps.fillAuto();guard();await deps.fillFixed();guard()}
        const pub=await deps.publish();guard()
        if(pub.status!=='PUBLISHED')throw new Error(pub.message)
        await deps.refreshLocal();guard()
        await deps.removeLocal();guard()
        await deps.refreshLocal();guard()
        await deps.refreshListings();guard()
        deps.afterPublished()
        return
      }catch(reason){
        if(expired)throw reason
        lastError=reason
        if(attempt===0){await delay(1500);guard()}
      }
    }
    throw lastError instanceof Error?lastError:new Error(String(lastError))
  })()
  try{
    await raceTimeout(chain,timeoutMs,SCHEDULED_RUN_TIMEOUT_MESSAGE)
  }catch(error){
    expired=true
    throw error
  }
}