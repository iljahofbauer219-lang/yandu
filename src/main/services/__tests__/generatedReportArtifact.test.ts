import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generatedMarkdownPathFromReply } from '../../../shared/reportArtifact'
import { materializeGeneratedMarkdownReply } from '../generatedReportArtifact'

/**
 * 临时目录口径守卫：交付语句解析 + os.tmpdir() 白名单。
 *
 * 此前存在两套约定 —— reportArtifact 的正则只认 `/tmp/`、generatedReportArtifact 的
 * TEMP_ROOT 硬编码 `/tmp`，而 advisor 的下载白名单用 `os.tmpdir()`。
 * Windows 上 os.tmpdir() 是 %TEMP%，两处硬编码让「报告已输出至临时文件」的恢复链路整体失效。
 * 现在三处统一为 os.tmpdir()。
 */

const REPORT_BODY = `# 选品分析报告

| 指标 | 结果 |
| --- | --- |
| 平台 | Amazon 美国站 |

${'这是用于验证历史报告恢复链路的完整 Markdown 正文，长度需要超过最小阈值才会被当作报告。'.repeat(4)}`

const created: string[] = []

function writeTempReport(name: string, content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'report-artifact-test-'))
  const file = path.join(dir, name)
  writeFileSync(file, content, 'utf8')
  created.push(dir)
  return file
}

afterEach(() => {
  while (created.length) {
    const dir = created.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('generatedMarkdownPathFromReply 交付语句解析', () => {
  it('识别 POSIX 绝对路径（os.tmpdir() 在 macOS/Linux 的形态）', () => {
    const reply = `完整重写后的 Markdown 报告已输出至 ${path.join(os.tmpdir(), 'yd-report.md')}`
    expect(generatedMarkdownPathFromReply(reply)).toBe(path.join(os.tmpdir(), 'yd-report.md'))
  })

  it('识别 Windows 盘符绝对路径（旧正则只认 /tmp/，Windows 永远匹配不到）', () => {
    expect(generatedMarkdownPathFromReply('Markdown 报告已输出至 C:\\Users\\me\\AppData\\Local\\Temp\\report.md'))
      .toBe('C:\\Users\\me\\AppData\\Local\\Temp\\report.md')
    expect(generatedMarkdownPathFromReply('Markdown 报告已输出至 `C:/Temp/report.md`')).toBe('C:/Temp/report.md')
  })

  it('没有交付语句时不把任意路径当报告', () => {
    expect(generatedMarkdownPathFromReply('你可以看看 /tmp/whatever.md 这个文件')).toBeNull()
    expect(generatedMarkdownPathFromReply('')).toBeNull()
  })
})

describe('materializeGeneratedMarkdownReply 临时目录白名单', () => {
  it('恢复 os.tmpdir() 之下的报告正文', async () => {
    const file = writeTempReport('report.md', REPORT_BODY)
    const result = await materializeGeneratedMarkdownReply(`完整重写后的 Markdown 报告已输出至 ${file}`)
    expect(result.materialized).toBe(true)
    expect(result.content).toBe(REPORT_BODY.trim())
  })

  it('临时目录之外的路径一律不读取（白名单仍然生效）', async () => {
    const result = await materializeGeneratedMarkdownReply('完整重写后的 Markdown 报告已输出至 /tmp/../private/secret.md')
    expect(result.materialized).toBe(false)
    expect(result.content).toContain('/private/secret.md')
  })

  it('非 .md 后缀不读取', async () => {
    const file = writeTempReport('secret.txt', REPORT_BODY)
    const result = await materializeGeneratedMarkdownReply(`Markdown 报告已输出至 ${file}`)
    expect(result.materialized).toBe(false)
  })

  it('正文太短或不含报告结构时不替换原回复', async () => {
    const file = writeTempReport('short.md', '# 标题\n\n太短了。')
    const result = await materializeGeneratedMarkdownReply(`Markdown 报告已输出至 ${file}`)
    expect(result.materialized).toBe(false)
  })
})
