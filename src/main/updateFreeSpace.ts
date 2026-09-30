/**
 * 更新安装磁盘空间预检。
 * 背景：macOS ShipIt 解包更新 zip 需要「包体拷贝 + 约 2.2GB 解包」的连续空间；
 * 数据卷接近满时 ditto 会 No space left on device 中断，用户只看到晦涩的 ditto 报错。
 * 安装前预检并把不足情况转成可读提示（根治项 D）。
 */
import { statfsSync } from 'node:fs'

/** 安装一次更新所需的最低可用空间：852MB 包拷贝 + ~2.2GB 解包 + 替换余量 */
export const UPDATE_REQUIRED_FREE_BYTES = 4 * 1024 * 1024 * 1024

export function freeBytesOnVolume(dir: string, statfsImpl: typeof statfsSync = statfsSync): number {
  const stats = statfsImpl(dir)
  return stats.bavail * stats.bsize
}

export function hasFreeSpaceForUpdate(dir: string, requiredBytes: number = UPDATE_REQUIRED_FREE_BYTES, statfsImpl: typeof statfsSync = statfsSync): boolean {
  return freeBytesOnVolume(dir, statfsImpl) >= requiredBytes
}
