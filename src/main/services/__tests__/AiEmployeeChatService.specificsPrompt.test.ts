import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * K1 证据源守卫：真机取证（2026-11-11 赛车座椅）显示模型只拿到描述前 2000 字，
 * 而图文页规格与材质/钢架/滑轨/通用性这些关键事实全在 2000 字之后；
 * 且菜单行候选一律被写成「无（自由填写）」，模型自创值后被闭合白名单全拒。
 * 提示词口径与描述截断长度都是行为判据，用源码切片钉住，避免改回去没人发现。
 */
const source = readFileSync(path.join(__dirname, '..', 'AiEmployeeChatService.ts'), 'utf8')

const method = (() => {
  const from = source.indexOf('async deriveEbaySpecifics(')
  expect(from, '锚点必须存在：deriveEbaySpecifics').toBeGreaterThan(-1)
  const to = source.indexOf('async deriveAmazonKeywords(', from)
  return source.slice(from, to === -1 ? undefined : to)
})()

describe('K1 · 类目属性复核提示词的候选与证据源口径', () => {
  it('多选槽位允许从候选里选多个并用逗号分隔，不再一律「只能选一个」', () => {
    expect(method).toContain('MENU_MULTI')
    expect(method).toMatch(/多选[^」]*逗号/)
  })

  it('列了候选的槽位禁止自创值，候选没列全也一样', () => {
    expect(method).toMatch(/候选[^。]*没列全[^。]*不要自创/)
  })

  it('列了候选的槽位不许整行留空：真机上 Seat Type/Headrest Type 候选已给全，模型仍一行不答', () => {
    expect(method).toContain('不要整行留空')
    expect(method).toMatch(/必须从候选里选/)
  })

  it('描述证据不再截到 2000 字：图文页规格表与材质事实在其后', () => {
    expect(method).not.toContain('descriptionText.slice(0, 2000)')
    const bound = Number(method.match(/descriptionText\.slice\(0,\s*(\d+)\)/)?.[1] || 0)
    expect(bound).toBeGreaterThanOrEqual(6000)
  })

  it('超时预算容得下扩证后的真实响应：旧 25s 预算下小提示词实测 23.1s 才回，扩证后必然超时归零', () => {
    const budget = Number(method.match(/setTimeout\(\(\) => controller\.abort\(\),\s*(\d+)\)/)?.[1] || 0)
    expect(budget).toBeGreaterThanOrEqual(60000)
  })
})