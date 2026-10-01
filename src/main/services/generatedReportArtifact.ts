import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { generatedMarkdownPathFromReply } from '../../shared/reportArtifact'

const MAX_REPORT_BYTES = 512 * 1024
const MIN_REPORT_CHARS = 200

/**
 * 临时目录白名单：全仓统一用 os.tmpdir()（与 advisor 的 advisor:download-output-file 同一口径）。
 * 此前这里硬编码 `/tmp`，Windows 上 os.tmpdir() 是 %TEMP%，白名单永远不匹配 → 报告恢复静默失效。
 * 每次调用现取，避免启动后 TMPDIR 变化（如测试/多用户环境）拿到过期根目录。
 */
function tempRoot(): string {
  return path.resolve(os.tmpdir())
}

export type GeneratedMarkdownMaterialization = {
  content: string
  materialized: boolean
}

/**
 * 仅恢复智能体明确声明的临时目录 Markdown 报告。路径、文件类型、软链接及大小均受限，
 * 不能借由聊天内容读取任意本地文件。
 */
export async function materializeGeneratedMarkdownReply(reply: string): Promise<GeneratedMarkdownMaterialization> {
  const original = String(reply || '')
  const declaredPath = generatedMarkdownPathFromReply(original)
  if (!declaredPath) return { content: original, materialized: false }

  const root = tempRoot()
  const filePath = path.resolve(declaredPath)
  if (!filePath.startsWith(`${root}${path.sep}`) || path.extname(filePath).toLowerCase() !== '.md') {
    return { content: original, materialized: false }
  }

  try {
    const stat = await fsp.lstat(filePath)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_REPORT_BYTES) {
      return { content: original, materialized: false }
    }
    const markdown = (await fsp.readFile(filePath, 'utf8')).trim()
    const looksLikeReport = markdown.length >= MIN_REPORT_CHARS && /(^#{1,6}\s+|\n\|[^\n]+\|)/m.test(markdown)
    return looksLikeReport
      ? { content: markdown, materialized: true }
      : { content: original, materialized: false }
  } catch {
    return { content: original, materialized: false }
  }
}
