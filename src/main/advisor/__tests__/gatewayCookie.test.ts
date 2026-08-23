import { describe, it, expect } from 'vitest'
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
