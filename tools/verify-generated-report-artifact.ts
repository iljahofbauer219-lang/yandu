import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { generatedMarkdownPathFromReply } from '../src/shared/reportArtifact'
import { materializeGeneratedMarkdownReply } from '../src/main/services/generatedReportArtifact'

async function main() {
  const reportPath = path.join('/tmp', `yd-report-artifact-${process.pid}.md`)
  const markdown = '# Amazon 美国站选品分析报告\n\n| 指标 | 结果 |\n| --- | --- |\n| 平台 | Amazon 美国站 |\n\n这是用于验证历史报告恢复链路的完整 Markdown 正文。'.repeat(4)
  await fsp.writeFile(reportPath, markdown, 'utf8')
  try {
    const reply = `完整重写后的 Markdown 报告已输出至 ${reportPath}`
    if (generatedMarkdownPathFromReply(reply) !== reportPath) throw new Error('未识别智能体声明的 Markdown 路径')
    const recovered = await materializeGeneratedMarkdownReply(reply)
    if (!recovered.materialized || recovered.content !== markdown.trim()) throw new Error('未恢复完整 Markdown 正文')
    const rejected = await materializeGeneratedMarkdownReply('完整重写后的 Markdown 报告已输出至 /tmp/../private/secret.md')
    if (rejected.materialized) throw new Error('不安全路径不应被读取')
    console.log('PASS generated-report artifact materialization')
  } finally {
    await fsp.unlink(reportPath).catch(() => undefined)
  }
}

void main()
