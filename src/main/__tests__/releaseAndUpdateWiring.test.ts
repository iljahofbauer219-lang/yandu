import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 发版链路接线守卫：三处历史断点——win 构建失败被静默降级只发 mac（导致两平台长期不齐）、
 * win 用了 mac 运行时、下载页脱离发布流程手改。这里钉住脚本本身，任一处漂回即红。
 * 客户端侧节奏另有 shared/appUpdatePolicy 单测与 main 接线守卫。
 */
const root = path.join(__dirname, '..', '..', '..')
const publishSource = readFileSync(path.join(root, 'tools', 'publish-release.mjs'), 'utf8')
const mainSource = readFileSync(path.join(root, 'src', 'main', 'main.ts'), 'utf8')
const pillSource = readFileSync(path.join(root, 'src', 'renderer', 'UpdateStatusPill.tsx'), 'utf8')

describe('发布脚本：双平台齐平与下载页同步', () => {
  it('win 构建失败不再静默降级只发 mac', () => {
    expect(publishSource).not.toContain('targets.splice')
    expect(publishSource).not.toContain('本次仅发布 mac')
  })

  it('win 构建走 shared 工具给出的 electronDist 参数，不用 mac 运行时', () => {
    expect(publishSource).toContain('winBuildArgs')
    expect(publishSource).toContain('releaseKit.mjs')
  })

  it('支持 --bump 且在版本校验之前落 package.json', () => {
    const bumpAt = publishSource.indexOf('bumpSemver')
    const checkAt = publishSource.indexOf('── 1. 版本校验')
    expect(bumpAt).toBeGreaterThan(-1)
    expect(checkAt).toBeGreaterThan(-1)
    expect(bumpAt).toBeLessThan(checkAt)
  })

  it('下载页由模板渲染并在上传后同步，收尾回读页面版本', () => {
    expect(publishSource).toContain('renderDownloadPage')
    expect(publishSource).toContain('download-page.template.html')
    expect(publishSource).toContain('/opt/yandu/download/index.html')
  })
})

describe('客户端：轮询节奏取自 shared 常量', () => {
  it('main 引用 appUpdatePolicy，且不再硬编码 4 小时轮询', () => {
    expect(mainSource).toContain("from '../shared/appUpdatePolicy'")
    expect(mainSource).toContain('UPDATE_POLL_INTERVAL_MS')
    expect(mainSource).not.toContain('4 * 60 * 60 * 1000')
  })

  it('已下载待安装提示常驻（ttl=0），只有 error/info 才自动消失', () => {
    expect(pillSource).toContain("status.phase === 'error' ? 30_000 : status.phase === 'info' ? 8_000 : 0")
  })
})