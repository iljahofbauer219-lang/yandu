import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const src = fs.readFileSync(path.join(__dirname, '../BrowserWorkspace.ts'), 'utf8')

describe('加载芯片信号改主框架 DOM 就绪口径源码守卫', () => {
  it('getState 的 loading 读标志表，未绑定的视图回落 isLoading', () => {
    expect(src).toContain('loading: this.viewLoading.get(contents) ?? contents.isLoading()')
  })
  it('bindLoadingSignal：start 置真、dom-ready/finish/stop/fail 清假且都发射状态', () => {
    const start = src.indexOf('private bindLoadingSignal')
    expect(start).toBeGreaterThan(-1)
    const body = src.slice(start, src.indexOf('private emitState'))
    expect(body).toContain("wc.on('did-start-loading'")
    expect(body).toContain('this.viewLoading.set(wc,true)')
    expect(body).toContain("wc.on('dom-ready'")
    expect(body).toContain("wc.on('did-finish-load'")
    expect(body).toContain("wc.on('did-stop-loading'")
    expect(body).toContain("wc.on('did-fail-load'")
    expect(body).toContain('this.viewLoading.set(wc,false)')
    expect((body.match(/emit\(\)/g) || []).length).toBeGreaterThanOrEqual(5)
  })
  it('凭据视图与 eBay 新标签两个绑定点都接信号helper', () => {
    expect((src.match(/this\.bindLoadingSignal\(view/g) || []).length).toBe(2)
  })
})