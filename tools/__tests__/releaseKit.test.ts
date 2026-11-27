import { describe, expect, it } from 'vitest'
import { bumpSemver, renderDownloadPage, verifySha256, winBuildArgs } from '../releaseKit.mjs'

describe('bumpSemver', () => {
  it('patch/minor/major 各进各位，低位归零', () => {
    expect(bumpSemver('1.0.25', 'patch')).toBe('1.0.26')
    expect(bumpSemver('1.0.25', 'minor')).toBe('1.1.0')
    expect(bumpSemver('1.0.25', 'major')).toBe('2.0.0')
  })

  it('非法版本或非法段位抛错，不静默产出坏版本号', () => {
    expect(() => bumpSemver('1.0', 'patch')).toThrow()
    expect(() => bumpSemver('1.0.25', 'hotfix')).toThrow()
  })
})

describe('winBuildArgs', () => {
  it('必须把 electronDist 指向 win 运行时目录', () => {
    const args = winBuildArgs('/repo', '/repo/.cache/electron-win32-x64')
    expect(args).toContain('--win')
    expect(args).toContain('--publish')
    expect(args).toContain('never')
    expect(args).toContain('--config.electronDist=/repo/.cache/electron-win32-x64')
  })

  it('不得回落到 mac 运行时（本轮 ENOENT 根因）', () => {
    const args = winBuildArgs('/repo', '/repo/.cache/electron-win32-x64')
    expect(args.join(' ')).not.toContain('node_modules/electron/dist')
  })
})

describe('verifySha256', () => {
  it('大小写与首尾空白归一后比对', () => {
    expect(verifySha256('ABC123', ' abc123 ')).toBe(true)
  })

  it('不一致即 false', () => {
    expect(verifySha256('abc123', 'abc124')).toBe(false)
    expect(verifySha256('', 'abc')).toBe(false)
  })
})

describe('renderDownloadPage', () => {
  const template = [
    '<p class="sub">工作台 · Windows v{{WIN_VERSION}} / macOS v{{MAC_VERSION}}</p>',
    '<a href="https://oss/YanduCrossBorder-Setup-{{WIN_VERSION}}.exe">Windows 版下载（exe 安装包 · v{{WIN_VERSION}}）</a>',
    '<a href="https://oss/YanduCrossBorder-{{MAC_VERSION}}-x64.dmg">macOS 版下载（dmg，Intel 芯片 · v{{MAC_VERSION}}）</a>'
  ].join('\n')

  it('两平台版本各自独立替换，同版本时全页一致', () => {
    const html = renderDownloadPage(template, { win: '1.0.26', mac: '1.0.26' })
    expect(html).toContain('Setup-1.0.26.exe')
    expect(html).toContain('YanduCrossBorder-1.0.26-x64.dmg')
    expect(html).toContain('Windows v1.0.26 / macOS v1.0.26')
  })

  it('只发一个平台时，另一平台如实显示其线上版本', () => {
    const html = renderDownloadPage(template, { win: '1.0.26', mac: '1.0.25' })
    expect(html).toContain('Setup-1.0.26.exe')
    expect(html).toContain('YanduCrossBorder-1.0.25-x64.dmg')
    expect(html).toContain('Windows v1.0.26 / macOS v1.0.25')
  })

  it('渲染后不得残留占位符', () => {
    expect(renderDownloadPage(template, { win: '1.0.26', mac: '1.0.25' })).not.toContain('{{')
  })

  it('模板缺占位符或版本为空即抛，绝不产出错版本页面', () => {
    expect(() => renderDownloadPage('<p>没有占位符</p>', { win: '1.0.26', mac: '1.0.25' })).toThrow()
    expect(() => renderDownloadPage(template, { win: '', mac: '1.0.25' })).toThrow()
  })
})