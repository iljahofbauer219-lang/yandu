/**
 * 智能体偶发把完整报告写入临时 Markdown 文件后，只在回复中给出路径。
 * 此处只识别该明确交付语句，避免把普通聊天中的任意路径当作可读取文件。
 *
 * 临时目录约定（全仓统一）：一律以 `os.tmpdir()` 为准 —— 与 advisor 的
 * `advisor:download-output-file` 下载白名单同一口径。这里**不再硬编码 `/tmp/`**：
 * Windows 上 os.tmpdir() 是 `%TEMP%`（形如 `C:\Users\xxx\AppData\Local\Temp`），
 * 只认 `/tmp/` 会让 Windows 永远匹配不到交付语句。
 * 因此本模块只负责「从交付语句里取出声明的绝对路径」，是否允许读取由主进程
 * `src/main/services/generatedReportArtifact.ts` 用 os.tmpdir() 白名单二次裁决。
 */
// 交付语句里的路径：POSIX 绝对路径（/…）或 Windows 盘符绝对路径（C:\… / C:/…）
const GENERATED_MARKDOWN_REPLY = /(?:完整(?:重写)?后的?\s*Markdown\s*报告已输出至|Markdown\s*报告已输出至)\s*[`'\"]?((?:[A-Za-z]:[\\/]|\/)[^\s`'\"]+?\.md)\b/i

export function generatedMarkdownPathFromReply(content: string): string | null {
  const match = String(content || '').match(GENERATED_MARKDOWN_REPLY)
  return match?.[1] || null
}
