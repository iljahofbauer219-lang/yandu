import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { generatedMarkdownPathFromReply } from '../../shared/reportArtifact'

const TEMP_ROOT = path.resolve('/tmp')
const MAX_REPORT_BYTES = 512 * 1024
const MIN_REPORT_CHARS = 200

export type GeneratedMarkdownMaterialization = {
  content: string
  materialized: boolean
}

/**
 * 仅恢复智能体明确声明的 /tmp Markdown 报告。路径、文件类型、软链接及大小均受限，
 * 不能借由聊天内容读取任意本地文件。
 */
export async function materializeGeneratedMarkdownReply(reply: string): Promise<GeneratedMarkdownMaterialization> {
  const original = String(reply || '')
  const declaredPath = generatedMarkdownPathFromReply(original)
  if (!declaredPath) return { content: original, materialized: false }

  const filePath = path.resolve(declaredPath)
  if (!filePath.startsWith(`${TEMP_ROOT}${path.sep}`) || path.extname(filePath).toLowerCase() !== '.md') {
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
