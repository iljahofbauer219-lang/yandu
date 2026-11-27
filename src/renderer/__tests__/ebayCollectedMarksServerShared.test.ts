/**
 * 已采集红勾服务端全员统一守卫：
 * 红勾原仅来自本地 SQLite（main.ts collectedUrlProvider → listCollectedCandidateUrls），每用户各自一份；
 * 现注入器 collected 集合并服务端推送集（syncServerSupplyCollectedUrls → __crossBorderCollector.syncCollected），
 * 渲染层在采集器开启/定时/确认采集成功后从 /api/erp/products 拉组织级记录回推；服务端失败保留现有标记不误报未采集。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../..')
const ws = readFileSync(path.join(root, 'src/main/browser/BrowserWorkspace.ts'), 'utf8')
const main = readFileSync(path.join(root, 'src/main/main.ts'), 'utf8')
const preload = readFileSync(path.join(root, 'src/preload/preload.ts'), 'utf8')
const app = readFileSync(path.join(root, 'src/renderer/App.tsx'), 'utf8')

describe('注入器服务端标记通道', () => {
  it('collected 种子合并本地与服务端推送集', () => {
    expect(ws).toContain('const collected = new Set([...${JSON.stringify(this.supplyCollectedUrls)}, ...${JSON.stringify(this.serverSupplyCollectedUrls)}]);')
  })

  it('window API 暴露 syncCollected 增量合并并重画', () => {
    expect(ws).toContain('syncCollected: urls => { (urls||[]).forEach(u=>collected.add(u)); entries.forEach(update); },')
  })

  it('主进程推送方法写缓存并下发所有 GIGA 视图', () => {
    expect(ws).toContain('syncServerSupplyCollectedUrls(urls: string[])')
    expect(ws).toContain('window.__crossBorderCollector?.syncCollected?.(')
  })

  it('IPC 与 preload 契约齐备', () => {
    expect(main).toContain("ipcMain.handle('browser:collector:sync-server-collected'")
    expect(preload).toContain('syncServerCollected:')
  })
})

describe('渲染层组织级拉取与回推', () => {
  it('refresh helper 拉组织级候选池并回推', () => {
    expect(app).toContain('const refreshServerCollectedMarks=async()=>')
    expect(app).toContain("apiFetch<{ supplyProducts:Array<{ url:string; platformCode:string }> }>('/api/collection/candidates')")
    expect(app).toContain('window.desktop.browser.syncServerCollected(urls)')
  })

  it('采集器开启期间定时刷新（60s）', () => {
    expect(app).toContain('60_000')
  })

  it('确认采集成功后回写服务端候选池再刷新标记', () => {
    const seg = app.split('const confirmBuiltInCollector =')[1]?.split('\n  const ')[0] ?? ''
    expect(seg).toContain("'/api/collection/tasks/import-plugin-candidates'")
    expect(seg).toContain('result.mapped')
    expect(seg).toContain('refreshServerCollectedMarks()')
  })

  it('主进程 confirm 返回 mapped 供服务端回写', () => {
    expect(main).toContain('return { imported, updated, total, blocked, duplicates, mapped: mappedAll }')
  })

  it('服务端失败保留现有标记（catch 不清标记）', () => {
    const seg = app.split('const refreshServerCollectedMarks=')[1]?.split('\n  const ')[0] ?? ''
    expect(seg).toContain('catch')
    expect(seg).not.toContain('syncServerCollected([])')
  })
})