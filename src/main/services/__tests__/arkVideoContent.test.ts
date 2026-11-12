import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildArkVideoContent } from '../ArkVideoService'

/**
 * 方舟多图视频 400 根因：content 的 image_url 项缺 role。
 * 官方口径：单图 role 可省略（默认 first_frame）；多图必须显式 role；
 * Seedance 2.0 多参考用 reference_image（1-9 张）。
 */
describe('方舟视频 content 组装 · role 规则', () => {
  const a = 'data:image/jpeg;base64,AAA'
  const b = 'data:image/jpeg;base64,BBB'

  it('多图每张都带 reference_image，文本项在首', () => {
    const content = buildArkVideoContent('prompt', [a, b])
    expect(content[0]).toEqual({ type: 'text', text: 'prompt' })
    expect(content.slice(1)).toEqual([
      { type: 'image_url', image_url: { url: a }, role: 'reference_image' },
      { type: 'image_url', image_url: { url: b }, role: 'reference_image' }
    ])
  })

  it('单图保持省略 role，不改变能力探针既有语义', () => {
    const content = buildArkVideoContent('prompt', [a])
    expect(content[1]).toEqual({ type: 'image_url', image_url: { url: a } })
    expect(content[1]).not.toHaveProperty('role')
  })

  it('无图时只有文本项', () => {
    expect(buildArkVideoContent('prompt', [])).toEqual([{ type: 'text', text: 'prompt' }])
  })
})

describe('方舟视频 content 组装 · 接线守卫', () => {
  const source = readFileSync(path.join(__dirname, '..', 'ArkVideoService.ts'), 'utf8')

  it('createTask 走统一组装函数，不再手拼无 role 的 image_url', () => {
    const start = source.indexOf('private async createTask(')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf('private async waitForTask(', start))
    expect(body).toContain('buildArkVideoContent(')
    expect(body).not.toMatch(/return \{type:'image_url',image_url:\{url:imageData\}\}/)
  })
})