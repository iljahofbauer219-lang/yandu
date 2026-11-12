import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const mainSource = readFileSync(path.join(__dirname, '..', '..', 'main', 'main.ts'), 'utf8')
const appSource = readFileSync(path.join(__dirname, '..', '..', 'renderer', 'App.tsx'), 'utf8')

const slice = (source: string, from: string, to: string) => {
  const start = source.indexOf(from)
  expect(start, `${from} 必须存在`).toBeGreaterThan(-1)
  const rest = source.slice(start)
  const end = rest.indexOf(to, from.length)
  return end === -1 ? rest : rest.slice(0, end)
}

describe('视频链路 · 三处接线不得回退', () => {
  it('主进程图片判据只看 ebayImageRuleRows 过滤后的行，视频不参与格式与体积校验', () => {
    const rules = slice(mainSource, 'function updateEbayLocalProduct', 'if(validationErrors.length)')
    expect(rules).toContain('ebayImageRuleRows(')
    expect(rules).not.toMatch(/downloadedMedia\.some|!downloadedMedia\.length/)
  })

  it('发布编辑器用 mergeEbayPublishMedia 保留快照视频，不再整份替换媒体清单', () => {
    const open = slice(appSource, 'const openPublishEditorFromDraft', 'const uploadPublishEditorMedia')
    expect(open).toContain('mergeEbayPublishMedia')
    expect(open).not.toMatch(/media=result\.media\.slice/)
  })

  it('主进程与渲染器都从 shared 取这两个判据，不在本地另抄一份', () => {
    expect(mainSource).toMatch(/from '[^']*shared\/ebayLocalMedia'/)
    expect(appSource).toMatch(/from '[^']*shared\/ebayLocalMedia'/)
  })
})
