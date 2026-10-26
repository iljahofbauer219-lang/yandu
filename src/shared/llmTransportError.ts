export type LlmTransportFailureKind='dns'|'refused'|'connectTimeout'|'responseTimeout'|'reset'|'tls'|'aborted'|'unknown'
export interface LlmTransportFailure {
  kind:LlmTransportFailureKind
  /** 全中文可操作说明，绝不出现 fetch failed / Script failed 之类裸英文串 */
  reason:string
  /** 传输层瞬时故障：调用方可自动重试一次 */
  retryable:boolean
}

interface CauseRecord { name:string; code:string; message:string }

function causeRecords(error:unknown):CauseRecord[] {
  const records:CauseRecord[]=[]
  let cursor:unknown=error
  for(let depth=0;depth<5&&cursor;++depth) {
    const item=cursor as {name?:unknown;code?:unknown;message?:unknown;cause?:unknown}
    records.push({name:String(item.name||''),code:String(item.code||''),message:String(item.message||'')})
    cursor=item.cause
  }
  return records
}

function hostOf(endpoint:string):string {
  try { return new URL(endpoint).hostname } catch { return endpoint }
}

function codeSummary(records:CauseRecord[]):string {
  const code=records.find(record=>record.code)?.code||''
  return code?`（错误代码：${code}）`:''
}

/**
 * 把 undici 的 TypeError: fetch failed（error.cause 才是真原因）翻译成可操作中文。
 * 只做归类，不改写调用方的业务语义。
 */
export function describeLlmTransportFailure(error:unknown,options:{service?:string;endpoint:string;timeoutMs?:number}):LlmTransportFailure {
  const records=causeRecords(error)
  const service=options.service||'AI 模型'
  const host=hostOf(options.endpoint)
  const timeoutSeconds=Math.max(1,Math.round((options.timeoutMs||0)/1000))
  const names=records.map(record=>record.name)
  const codes=records.map(record=>record.code)
  const messages=records.map(record=>record.message)
  const prefix=`${service}服务（${host}）`
  const failed=`无法连接${prefix}`

  if(names.includes('TimeoutError')||codes.includes('UND_ERR_HEADERS_TIMEOUT')||codes.includes('UND_ERR_BODY_TIMEOUT'))
    return {kind:'responseTimeout',reason:`${prefix}在 ${timeoutSeconds} 秒内没有返回结果，可能是模型排队或本次内容过长。${codeSummary(records)}系统已自动重试，如仍失败请稍后再试或减少一次生成的内容量。`,retryable:true}
  if(names.includes('AbortError'))
    return {kind:'aborted',reason:`本次${prefix}请求已取消。`,retryable:false}
  if(codes.some(code=>['ENOTFOUND','EAI_AGAIN','EAI_FAIL','ENOENT'].includes(code))||messages.some(message=>/getaddrinfo|domain|名称解析|resolve/i.test(message)))
    return {kind:'dns',reason:`${failed}：本机 DNS 解析不到 ${host}。请确认网络已连通；若正在使用代理或 VPN，可切换网络后重试。${codeSummary(records)}`,retryable:true}
  if(codes.some(code=>['ERR_TLS_CERT_ALTNAME_INVALID','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','CERT_UNTRUSTED','CERT_HAS_EXPIRED','SELF_SIGNED_CERT_IN_CHAIN','SELF_SIGNED_CERT','DEPTH_ZERO_SELF_SIGNED_CERT','ERR_SSL_WRONG_VERSION','SSL_ERROR_SYSCALL'].includes(code))||codes.some(code=>code.startsWith('ERR_TLS')||code.startsWith('CERT_'))||messages.some(message=>/certificate|self signed|unable to verify|ssl|tls/i.test(message)))
    return {kind:'tls',reason:`${failed}：HTTPS 证书校验未通过。通常是代理、安全软件或系统时间偏差拦截了加密连接，请检查系统时间与网络代理后重试。${codeSummary(records)}`,retryable:false}
  if(codes.includes('ECONNREFUSED'))
    return {kind:'refused',reason:`${failed}：连接被拒绝，通常是本地代理、防火墙或安全软件拦截了 ${host}。请检查代理与防火墙设置后重试。${codeSummary(records)}`,retryable:false}
  if(codes.some(code=>['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(code)))
    return {kind:'connectTimeout',reason:`${failed}：在 ${timeoutSeconds} 秒内未能建立连接，请检查网络后重试。${codeSummary(records)}`,retryable:true}
  if(codes.some(code=>['ECONNRESET','ECONNABORTED','EPIPE','UND_ERR_SOCKET'].includes(code))||messages.some(message=>/socket hang up|connection (?:was )?reset|premature close/i.test(message)))
    return {kind:'reset',reason:`${failed}：连接在请求过程中断开，多为网络不稳或代理中断。${codeSummary(records)}系统已自动重试。`,retryable:true}
  return {kind:'unknown',reason:`${failed}：网络请求未完成${codeSummary(records)}。请检查网络（含代理或 VPN）后重试；仍失败请到「AI总部 › 大模型 API Key 管理」执行连接测试。`,retryable:false}
}

/** 模型服务返回 HTTP 错误码时的中文说明：保留接口原文供排查，但不让裸英文成为唯一提示 */
export function describeLlmHttpStatus(status:number,upstreamMessage:string|undefined,service='DeepSeek'):string {
  const detail=(upstreamMessage||'').replace(/\s+/g,' ').trim().slice(0,160)
  const suffix=detail?`（接口返回：${detail}）`:''
  if(status===401||status===403)return `${service} API Key 无效或没有权限（HTTP ${status}）${suffix}。请到「AI总部 › 大模型 API Key 管理」重新保存 Key 并执行连接测试。`
  if(status===402)return `${service} 账户余额不足（HTTP 402）${suffix}，请充值或更换可用 Key 后重试。`
  if(status===429)return `${service} 请求过于频繁（HTTP 429）${suffix}，请等待片刻后重试。`
  if(status>=500)return `${service} 服务暂时不可用（HTTP ${status}）${suffix}，请稍后重试。`
  return `${service} 请求失败：HTTP ${status}${suffix}`
}
