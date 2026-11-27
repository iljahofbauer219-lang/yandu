import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../../..')
const appSource = readFileSync(path.join(ROOT, 'src/renderer/App.tsx'), 'utf8')
const preloadSource = readFileSync(path.join(ROOT, 'src/preload/preload.ts'), 'utf8')
const workspaceSource = readFileSync(path.join(ROOT, 'src/main/browser/BrowserWorkspace.ts'), 'utf8')
const mainSource = readFileSync(path.join(ROOT, 'src/main/main.ts'), 'utf8')

describe('货盘采集平台独立：页签组/会话/凭据接线守卫', () => {
  it('进入货盘平台只开自身网址并绑定平台身份与页签组', () => {
    const branch = appSource.slice(appSource.indexOf('const activateProductWarehouse'), appSource.indexOf('const openWarehouseCandidates'))
    expect(branch).toContain('setSupplyGroup(code)')
    expect(branch).toContain("openTab('web',homeUrl,homeName,code)")
    expect(branch).toContain('supplyPlatforms:[code')
    expect(branch).toContain('setActiveWarehouse(code)')
    expect(branch).toContain('tab.group===code')
  })
  it('页签条按当前平台组过滤，跨平台页签不串显', () => {
    expect(appSource).toContain("(tab.group||'')===supplyGroup")
    expect(appSource).toContain("tab.id==='home-1688'?(supplyGroup===''||supplyGroup==='1688'||supplyGroup==='GIGACLOUD')")
    expect(appSource).toContain('if(tab.group)setSupplyGroup(tab.group)')
  })
  it('新建浏览页落入当前平台组', () => {
    expect(appSource).toContain("newTab('web',supplyGroup||undefined)")
  })
  it('左栏凭据按平台独立：登录页地址可手填并持久化', () => {
    const panel = appSource.slice(appSource.indexOf('function CredentialPanel'), appSource.indexOf('function PublishingWorkspace'))
    expect(panel).toContain('supply-login-url:')
    expect(panel).toContain('value={loginUrl} onChange')
    expect(panel).not.toContain('value={loginUrl} readOnly')
    expect(panel).toContain('openCredentialLogin(accountId,platformCode,loginUrl)')
    expect(panel).toContain('palletHomeUrls[platformCode')
  })
  it('身份摘要对未预置平台回落货盘名录名称而非 1688', () => {
    expect(appSource).toContain('productWarehouses.find(item=>item.code===task.supplyPlatforms[0])')
  })
  it('IPC 契约透传页签组与自定义登录地址', () => {
    expect(preloadSource).toContain("invoke('browser:open-tab', platform, url, title, group)")
    expect(preloadSource).toContain("invoke('browser:new-tab', platform, group)")
    expect(preloadSource).toContain("invoke('marketplace:credential:open-login', accountId, platformCode, loginUrl)")
    expect(mainSource).toContain("ipcMain.handle('browser:open-tab', (_event, platform: Platform, url: string, title?: string, group?: string)")
    expect(mainSource).toContain("loginUrl?: string")
  })
  it('BrowserWorkspace 页签带组且会话罐按货盘域名隔离', () => {
    expect(workspaceSource).toContain('group?: string')
    expect(workspaceSource).toContain('supplySessionPartitionForUrl(url)')
    expect(workspaceSource).toContain('group: tab.group')
    expect(workspaceSource).toContain('async openTab(platform: Platform, url: string, initialTitle?: string, group?: string)')
    expect(workspaceSource).toContain("async newTab(platform: 'web' | 'ie' = 'web', group?: string)")
  })
})
