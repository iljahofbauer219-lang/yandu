/**
 * 外置热更新目录约定（配套 tools/sync-hot.mjs）：
 * - HOT 根目录：环境变量 YANDU_HOT_DIR 或 ~/yandu-hot；
 * - main/preload 构建产物：<HOT>/main-dist/**（dist/main 整目录拷贝）；
 * - renderer 构建产物：<HOT>/renderer/**（dist/renderer 整目录拷贝）；
 * - <HOT>/disabled 标记文件存在时强制回退 asar 内置代码（排障用）。
 * 分发机器不存在该目录，自然走内置代码，OSS 正式更新通道零影响。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function hotRoot(): string {
  return process.env.YANDU_HOT_DIR || path.join(os.homedir(), 'yandu-hot')
}

export function hotEnabled(): boolean {
  return !fs.existsSync(path.join(hotRoot(), 'disabled'))
}

/** 返回 HOT 目录下指定相对路径的文件（存在时），否则 null */
export function hotFile(...segments: string[]): string | null {
  if (!hotEnabled()) return null
  const candidate = path.join(hotRoot(), ...segments)
  return fs.existsSync(candidate) ? candidate : null
}
