import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { CookieJar } from '../gatewayCookie'

describe('CookieJar', () => {
  it('parses a single Set-Cookie header', () => {
    const jar = new CookieJar()
    jar.setFromSetCookieHeader('__Host-yandu_harness=abc.def; Path=/; HttpOnly')
    expect(jar.getCookieHeader()).toBe('__Host-yandu_harness=abc.def')
  })

  it('parses an array of Set-Cookie headers', () => {
    const jar = new CookieJar()
    jar.setFromSetCookieHeader([
      '__Host-yandu_harness=abc.def; Path=/',
      'session=xyz; Path=/'
    ])
    expect(jar.getCookieHeader()).toBe('__Host-yandu_harness=abc.def; session=xyz')
  })

  it('handles undefined gracefully', () => {
    const jar = new CookieJar()
    jar.setFromSetCookieHeader(undefined)
    expect(jar.getCookieHeader()).toBe('')
  })

  it('clears all cookies', () => {
    const jar = new CookieJar()
    jar.setFromSetCookieHeader('a=1; Path=/')
    jar.clear()
    expect(jar.getCookieHeader()).toBe('')
  })

  it('overwrites same-name cookies', () => {
    const jar = new CookieJar()
    jar.setFromSetCookieHeader('a=1; Path=/')
    jar.setFromSetCookieHeader('a=2; Path=/')
    expect(jar.getCookieHeader()).toBe('a=2')
  })
})

/**
 * 网关下发的会话 cookie 是整个 harness 的授权凭据（换到的是每用户一个的隔离执行容器），
 * 它的安全属性必须守住。server.mjs 在 import 阶段就校验环境变量并 listen，无法在测试里加载，
 * 因此这里直接断言源码文本——是有意的粗粒度守卫，改动该文件时若破坏了这些属性会立刻红。
 */
describe('gateway 会话 cookie 安全属性', () => {
  // 用 process.cwd() 而非 import.meta：本文件被 tsconfig.main.json 当作 CJS 编译，import.meta 会报错；
  // vitest 恒从仓库根运行，故 cwd 定位可靠。
  const source = readFileSync(path.resolve(process.cwd(), 'src/main/advisor/gateway/server.mjs'), 'utf8')
  const setCookieLine = source.split('\n').find(line => line.includes("'set-cookie'")) ?? ''

  it('set-cookie 行存在', () => {
    expect(setCookieLine).not.toBe('')
  })

  it('使用 SameSite=Lax 而非 None（防跨站请求携带会话 cookie）', () => {
    expect(setCookieLine).toContain('SameSite=Lax')
    expect(setCookieLine).not.toContain('SameSite=None')
  })

  it('保留 __Host- 前缀所要求的 Secure + Path=/ 且不带 Domain，并维持 HttpOnly', () => {
    expect(setCookieLine).toContain('Secure')
    expect(setCookieLine).toContain('Path=/')
    expect(setCookieLine).toContain('HttpOnly')
    expect(setCookieLine).not.toMatch(/;\s*Domain=/i)
  })

  it('cookie 名仍是 __Host-yandu_harness（nginx 靠它把 /api/ 路由到网关 8788）', () => {
    expect(source).toContain("const cookieName = '__Host-yandu_harness'")
  })

  it('cookie 值带 HMAC 签名且校验用 timingSafeEqual', () => {
    expect(source).toContain('timingSafeEqual')
    expect(setCookieLine).toContain('${sign(id)}')
  })
})
