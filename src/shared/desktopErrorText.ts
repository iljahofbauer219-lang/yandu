/**
 * 桌面 IPC 错误中文化：把底层英文技术串（Error invoking remote method / No handler registered / 超时等）
 * 转成中文全文提示；未知错误中文兜底并保留原文含义，供横幅全文展示（配合动作按钮，不截断不直显英文串）。
 */
export function describeDesktopError(reason: unknown, context: string): string {
  const raw = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : ''
  const message = raw.trim()
  if (!message) return `${context}失败：未知错误。请重试，仍失败请重启应用后再试`
  const handlerChannel = message.match(/No handler registered for '([^']+)'/)?.[1]
    || (/Error invoking remote method/.test(message) ? (message.match(/Error invoking remote method '([^']+)'/)?.[1] ?? '') : '')
  if (handlerChannel || /Error invoking remote method/.test(message)) {
    return `${context}失败：本地服务通道${handlerChannel ? `『${handlerChannel}』` : ''}未注册，通常为应用未重启加载新版本。请重启应用后重试`
  }
  if (/SERVER_SESSION_EXPIRED/.test(message)) return `${context}失败：登录会话已过期，刷新后将自动重试一次，仍失败请重新登录`
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return `${context}失败：服务响应超时，请检查网络或服务器状态后重试`
  return `${context}失败：${message}。请重试，仍失败请重启应用后再试`
}
