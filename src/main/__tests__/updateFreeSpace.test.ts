import { describe, expect, it } from 'vitest'
import { hasFreeSpaceForUpdate, UPDATE_REQUIRED_FREE_BYTES } from '../updateFreeSpace'

function fakeStatfs(availBytes: number) {
  const bsize = 4096
  return (() => ({ bavail: Math.floor(availBytes / bsize), bsize })) as never
}

describe('更新安装磁盘空间预检', () => {
  it('空间充足放行', () => {
    expect(hasFreeSpaceForUpdate('/any', UPDATE_REQUIRED_FREE_BYTES, fakeStatfs(5 * 1024 * 1024 * 1024))).toBe(true)
  })

  it('空间不足拒绝（复现 ShipIt ditto ENOSPC 场景）', () => {
    expect(hasFreeSpaceForUpdate('/any', UPDATE_REQUIRED_FREE_BYTES, fakeStatfs(800 * 1024 * 1024))).toBe(false)
  })

  it('临界值等于阈值时放行', () => {
    expect(hasFreeSpaceForUpdate('/any', UPDATE_REQUIRED_FREE_BYTES, fakeStatfs(UPDATE_REQUIRED_FREE_BYTES))).toBe(true)
  })
})
