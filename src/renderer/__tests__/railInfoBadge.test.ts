import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const appSource = fs.readFileSync(path.join(__dirname, '../App.tsx'), 'utf8')
const railSource = fs.readFileSync(path.join(__dirname, '../panel-collapse.tsx'), 'utf8')
const cssSource = fs.readFileSync(path.join(__dirname, '../panel-collapse.css'), 'utf8')

describe('折叠 rail 未读汇报徽标（11-20 折叠不渲染口径的可达性补充）', () => {
  it('PanelExpandRail 接收 infoCount 且大于0渲染计数徽标', () => {
    expect(railSource).toContain('infoCount=0')
    expect(railSource).toContain('{infoCount>0&&<em className="rail-info-badge"')
  })
  it('四个 eBay 折叠 rail 按页签归属传未读计数', () => {
    expect(appSource).toContain('const infoCountFor=')
    for (const tab of ['browser', 'library', 'local', 'premium']) {
      expect(appSource).toContain(`infoCount={infoCountFor('${tab}')}`)
    }
  })
  it('未读计数口径＝notice/error/toast 三者有内容各计1', () => {
    const start = appSource.indexOf('const infoCountFor=')
    const line = appSource.slice(start, appSource.indexOf('\n', start))
    expect(line).toContain('noticeByTab[tab]')
    expect(line).toContain('ebayErrorByTab[tab]')
    expect(line).toContain('downloadToastByTab[tab]')
  })
  it('徽标样式：rail 相对定位＋绝对定位计数泡', () => {
    const railBlock = cssSource.slice(cssSource.indexOf('.panel-expand-rail {'), cssSource.indexOf('}', cssSource.indexOf('.panel-expand-rail {')))
    expect(railBlock).toContain('position:relative')
    expect(cssSource).toContain('.rail-info-badge{')
  })
  it('不改动 11-20 渲染点口径：五左栏槽与顶栏槽删除保持', () => {
    expect(appSource.split('className="ebay-workbench-info"').length - 1).toBe(5)
    expect(appSource).not.toContain('ebay-head-info')
  })
})