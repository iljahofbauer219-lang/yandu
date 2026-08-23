/** 将 OmkarCloud 的配额/鉴权/限流错误转为可执行中文提示；不包含或回传 API Key。 */
export function describeOmkarCloudError(status: number, body: unknown): string {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {}
  const detail = String(record.detail || record.message || '').replace(/\s+/g, ' ').trim()
  const normalized = detail.toLowerCase()
  if (/monthly request limit|request limit of|quota|额度/.test(normalized)) {
    return 'OmkarCloud 当月请求额度已用尽；请升级套餐或等待额度重置。系统将继续尝试 Amazon 页面补充，未补齐字段仍为“待验证”。'
  }
  if (status === 401 || status === 403 || /api.?key|unauthori[sz]ed|forbidden/.test(normalized)) {
    return 'OmkarCloud API Key 无效或无权限；请在 AI总部的 Amazon 数据源配置中重新保存并测试连接。'
  }
  if (status === 429 || /rate limit|too many requests/.test(normalized)) {
    return 'OmkarCloud 请求过于频繁；请稍后重试。系统将继续尝试 Amazon 页面补充。'
  }
  return detail ? `OmkarCloud 接口返回 HTTP ${status}：${detail}` : `OmkarCloud 接口返回 HTTP ${status}`
}
