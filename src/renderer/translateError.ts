// 网页翻译错误归一：缺百炼 API Key 时转为引导文案，避免向用户暴露 IPC 原始错误堆栈
export function isBailianKeyMissing(reason: unknown): boolean {
  const message = reason instanceof Error ? reason.message : String(reason)
  return message.includes('BAILIAN_KEY_MISSING') || message.includes('未配置百炼 API Key')
}

export function describeTranslateError(reason: unknown, fallback = '网页翻译失败'): string {
  if (isBailianKeyMissing(reason)) return '网页翻译需要先配置百炼 API Key：请前往 AI总部 → 大模型API Key 保存后重试（保存后立即生效，无需重启）。'
  if (!(reason instanceof Error)) return fallback
  // 剥离 IPC 信封前缀（Error invoking remote method 'x': Error: ），只保留业务文案
  return reason.message.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '') || fallback
}
