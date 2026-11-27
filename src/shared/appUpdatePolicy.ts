/**
 * 自动更新节奏：同事装的是打包版，只认 OSS feed；轮询太长会让「已发版」与「同事用上」之间空等数小时。
 * 30 分钟是收敛延迟与请求开销的折中；启动失败补查仍 5 分钟，避免断网启动错过整轮窗口。
 */
export const UPDATE_POLL_INTERVAL_MS = 30 * 60 * 1000
export const UPDATE_RETRY_DELAY_MS = 5 * 60 * 1000