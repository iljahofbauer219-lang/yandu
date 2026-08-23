/**
 * 服务端地址配置（S2 客户端远程模式）。
 * - 配置持久化于 userData/server-config.json，主进程启动时据此决定是否拉起本地服务栈
 * - 渲染层在登录页保存服务器地址时经 IPC 同步到这里
 */
import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

export const DEFAULT_SERVER_URL = 'https://114.55.149.192'

const CONFIG_FILE = 'server-config.json'

function configFile(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE)
}

function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** 读取已持久化的服务器地址；未配置时返回默认中央服务器 */
export function readServerUrl(): string {
  try {
    const raw = fs.readFileSync(configFile(), 'utf8')
    const parsed = JSON.parse(raw) as { serverUrl?: unknown }
    if (typeof parsed.serverUrl === 'string' && parsed.serverUrl.trim()) return normalize(parsed.serverUrl)
  } catch { /* 未配置或损坏：走默认 */ }
  return DEFAULT_SERVER_URL
}

export function writeServerUrl(url: string): void {
  try {
    fs.writeFileSync(configFile(), JSON.stringify({ serverUrl: normalize(url) }, null, 2), 'utf8')
  } catch (error) {
    console.error('[server-config] 持久化失败：', error)
  }
}

/** 是否指向本机（决定要不要拉起本地服务栈） */
export function isLocalServerUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1'
  } catch {
    return false
  }
}
