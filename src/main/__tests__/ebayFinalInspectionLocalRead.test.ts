/**
 * 最终图集检查 cross-media 本地图接线守卫（main.ts）：
 * 检查链路不得把 cross-media/file/裸路径交给 Node undici fetch（不认自定义协议必失败），
 * 须按协议 handler 同根约束读本地文件；data:/http(s) 分支口径不动。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const main = readFileSync(path.resolve(__dirname, '../main.ts'), 'utf8')

describe('inspectEbayImages 本机媒体接线', () => {
  it('导入受限路径与 MIME 纯函数', () => {
    expect(main).toContain("import { imageHashService, confinedLocalMediaPath, imageContentTypeForPath } from './services/ImageHashService'")
  })

  it('cross-media 本地图按协议 handler 同根约束解路径', () => {
    expect(main).toContain("const localFile=confinedLocalMediaPath(url,path.join(app.getPath('userData'),'ebay-local-products'))")
  })

  it('本地分支直接读文件并给 MIME，不走 fetch', () => {
    expect(main).toContain('buffer=await fs.promises.readFile(localFile)')
    expect(main).toContain('contentType=imageContentTypeForPath(localFile)')
  })

  it('data: 与 http(s) 分支保留', () => {
    expect(main).toContain("if(url.startsWith('data:image/'))")
    expect(main).toContain("const response=await fetch(url,{signal:AbortSignal.timeout(12_000),headers:{'User-Agent':'Mozilla/5.0'}})")
  })

  it('批量读图有界并发（4），不再无限并发打爆上游', () => {
    expect(main).toContain("import { mapWithConcurrency } from '../shared/mapWithConcurrency'")
    expect(main).toContain('const images:EbayImageInspection[]=await mapWithConcurrency(unique,4,async url=>{')
  })

  it('瞬时网络失败重试一次，真问题不重试', () => {
    expect(main).toContain('const attempt=async():Promise<EbayImageInspection>=>{')
    expect(main).toContain("if(!outcome.reachable&&/aborted|timeout|fetch failed/i.test(outcome.findings.join(' ')))outcome=await attempt()")
  })
})