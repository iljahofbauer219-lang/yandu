import { describe, expect, it } from 'vitest'
import { describeLlmHttpStatus, describeLlmTransportFailure } from '../llmTransportError'

const ENDPOINT='https://api.deepseek.com/chat/completions'
const fetchFailed=(cause:unknown)=>Object.assign(new TypeError('fetch failed'),{cause})
const coded=(code:string,message:string,name='Error')=>Object.assign(new Error(message),{name,code})

describe('describeLlmTransportFailure', () => {
  it('把 DNS 失败翻译成可操作中文并允许重试', () => {
    const result=describeLlmTransportFailure(fetchFailed(coded('ENOTFOUND','getaddrinfo ENOTFOUND api.deepseek.com')),{service:'DeepSeek',endpoint:ENDPOINT,timeoutMs:45_000})
    expect(result.kind).toBe('dns')
    expect(result.retryable).toBe(true)
    expect(result.reason).toContain('api.deepseek.com')
    expect(result.reason).toContain('DNS')
    expect(result.reason).toContain('ENOTFOUND')
  })

  it('临时解析失败（EAI_AGAIN）同样归为 DNS', () => {
    expect(describeLlmTransportFailure(fetchFailed(coded('EAI_AGAIN','api.deepseek.com EAI_AGAIN')),{endpoint:ENDPOINT}).kind).toBe('dns')
  })

  it('识别两层深处的原因', () => {
    const result=describeLlmTransportFailure(fetchFailed({name:'Error',cause:coded('ECONNRESET','socket hang up')}),{service:'DeepSeek',endpoint:ENDPOINT})
    expect(result.kind).toBe('reset')
    expect(result.retryable).toBe(true)
  })

  it('连接被拒判为不可重试并提示代理与防火墙', () => {
    const result=describeLlmTransportFailure(fetchFailed(coded('ECONNREFUSED','connect ECONNREFUSED 127.0.0.1:443')),{service:'DeepSeek',endpoint:ENDPOINT})
    expect(result.kind).toBe('refused')
    expect(result.retryable).toBe(false)
    expect(result.reason).toContain('防火墙')
  })

  it('45 秒超时说明等待时长而不是裸 TimeoutError', () => {
    const result=describeLlmTransportFailure(Object.assign(new Error('The operation was aborted due to timeout'),{name:'TimeoutError'}),{service:'DeepSeek',endpoint:ENDPOINT,timeoutMs:45_000})
    expect(result.kind).toBe('responseTimeout')
    expect(result.retryable).toBe(true)
    expect(result.reason).toContain('45 秒')
    expect(result.reason).not.toContain('TimeoutError')
  })

  it('undici 头/正文超时同样归为未返回结果', () => {
    expect(describeLlmTransportFailure(fetchFailed(coded('UND_ERR_HEADERS_TIMEOUT','Timeout while waiting for headers')),{service:'DeepSeek',endpoint:ENDPOINT,timeoutMs:20_000}).kind).toBe('responseTimeout')
    expect(describeLlmTransportFailure(fetchFailed(coded('UND_ERR_BODY_TIMEOUT','Timeout while waiting for body')),{service:'DeepSeek',endpoint:ENDPOINT}).kind).toBe('responseTimeout')
  })

  it('证书校验失败提示代理与系统时间且不自愈重试', () => {
    const result=describeLlmTransportFailure(fetchFailed(coded('ERR_TLS_CERT_ALTNAME_INVALID','Hostname/IP does not match certificate')),{service:'DeepSeek',endpoint:ENDPOINT})
    expect(result.kind).toBe('tls')
    expect(result.retryable).toBe(false)
    expect(result.reason).toContain('证书')
  })

  it('连接建立超时与主动取消分别归类', () => {
    expect(describeLlmTransportFailure(fetchFailed(coded('UND_ERR_CONNECT_TIMEOUT','Connect Timeout Error')),{service:'DeepSeek',endpoint:ENDPOINT}).kind).toBe('connectTimeout')
    const aborted=describeLlmTransportFailure(Object.assign(new Error('This operation was aborted'),{name:'AbortError'}),{service:'DeepSeek',endpoint:ENDPOINT})
    expect(aborted.kind).toBe('aborted')
    expect(aborted.retryable).toBe(false)
  })

  it('未知原因保留错误代码并给出自查入口', () => {
    const result=describeLlmTransportFailure(fetchFailed(coded('ESOMETHING_ODD','odd transport failure')),{service:'DeepSeek',endpoint:ENDPOINT})
    expect(result.kind).toBe('unknown')
    expect(result.reason).toContain('ESOMETHING_ODD')
    expect(result.reason).toContain('大模型 API Key')
  })

  it('任何分支都不会把裸英文串透出去', () => {
    const samples:unknown[]=[
      fetchFailed(coded('ENOTFOUND','getaddrinfo ENOTFOUND')),
      fetchFailed(coded('ECONNREFUSED','connect ECONNREFUSED')),
      fetchFailed(coded('ECONNRESET','socket hang up')),
      fetchFailed(coded('SELF_SIGNED_CERT_IN_CHAIN','self signed certificate in certificate chain')),
      fetchFailed('a string cause'),
      'a thrown string',
      new Error('')
    ]
    for(const sample of samples) {
      const reason=describeLlmTransportFailure(sample,{service:'DeepSeek',endpoint:ENDPOINT,timeoutMs:45_000}).reason
      expect(reason).not.toMatch(/fetch failed/i)
      expect(reason).not.toMatch(/TypeError|socket hang up|getaddrinfo/i)
      expect(reason).toContain('DeepSeek')
    }
  })

  it('非 URL 端点也不抛异常', () => {
    const result=describeLlmTransportFailure(fetchFailed(coded('ENOTFOUND','getaddrinfo ENOTFOUND api.example.test')),{service:'DeepSeek',endpoint:'api.example.test'})
    expect(result.reason).toContain('api.example.test')
  })
})

describe('describeLlmHttpStatus', () => {
  it('鉴权失败说明该去哪里重存 Key', () => {
    const reason=describeLlmHttpStatus(401,'Authentication Fails!')
    expect(reason).toContain('API Key 无效或没有权限（HTTP 401）')
    expect(reason).toContain('大模型 API Key 管理')
    expect(reason).toContain('Authentication Fails!')
  })

  it('余额不足与限流、服务端错误各有中文口径', () => {
    expect(describeLlmHttpStatus(402,'Insufficient Balance')).toContain('余额不足')
    expect(describeLlmHttpStatus(429,undefined)).toContain('请求过于频繁')
    expect(describeLlmHttpStatus(503,undefined)).toContain('服务暂时不可用')
    expect(describeLlmHttpStatus(400,'bad request')).toContain('请求失败：HTTP 400')
  })

  it('超长接口原文截断，不撑爆提示条', () => {
    const reason=describeLlmHttpStatus(400,'x'.repeat(500))
    expect(reason.length).toBeLessThan(400)
  })
})
