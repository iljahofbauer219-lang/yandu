import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { shouldRetryWithoutProxy } from '../../../shared/ebayDirectFallback'

const source = (relative: string) => readFileSync(path.resolve(process.cwd(), relative), 'utf8')

describe('eBay 店铺类目目录同步的直连回落', () => {
  it('类目页在系统代理下断连时命中直连回落判定', () => {
    const error = Object.assign(new Error("ERR_CONNECTION_CLOSED (-100) loading 'https://www.ebay.com/sh/str/category'"), { code: 'ERR_CONNECTION_CLOSED', errno: -100 })
    expect(shouldRetryWithoutProxy(error)).toBe(true)
  })

  it('源码守卫：readEbayStoreCategories 必须经 loadEbayWithDirectFallback 加载类目页', () => {
    const workspace = source('src/main/browser/BrowserWorkspace.ts')
    expect(workspace).toContain("loadEbayWithDirectFallback(view.webContents, 'https://www.ebay.com/sh/str/category'")
    expect(workspace).not.toContain("view.webContents.loadURL('https://www.ebay.com/sh/str/category')")
  })

  it('源码守卫：同步目录失败文案经 friendlyEbayError 中文化，不直出英文原串', () => {
    const app = source('src/renderer/App.tsx')
    expect(app).toContain("friendlyEbayError(readableError(reason,'eBay店铺目录同步失败'))")
    expect(app).not.toContain("setEbayError(readableError(reason,'eBay店铺目录同步失败'))")
  })
})
