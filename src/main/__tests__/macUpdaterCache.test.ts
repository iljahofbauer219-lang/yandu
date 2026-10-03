import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveMacUpdaterZipPath } from '../macUpdaterCache'

let cacheDir = ''

afterEach(() => {
  if (cacheDir) fs.rmSync(cacheDir, { recursive: true, force: true })
})

describe('macOS 更新缓存路径选择', () => {
  it('根 update.zip 与已完成 pending ZIP 同时存在时选择 pending 文件', () => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-updater-cache-'))
    fs.writeFileSync(path.join(cacheDir, 'update.zip'), 'partial')

    const pendingDir = path.join(cacheDir, 'pending')
    fs.mkdirSync(pendingDir)
    const pendingZip = path.join(pendingDir, 'YanduCrossBorder-1.0.20-x64.zip')
    fs.writeFileSync(pendingZip, 'complete')
    fs.writeFileSync(
      path.join(pendingDir, 'update-info.json'),
      JSON.stringify({ fileName: path.basename(pendingZip), sha512: 'verified-by-electron-updater' })
    )

    expect(resolveMacUpdaterZipPath(cacheDir)).toBe(pendingZip)
  })

  it('pending 元数据损坏时回退根 update.zip', () => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-updater-cache-'))
    const directZip = path.join(cacheDir, 'update.zip')
    fs.writeFileSync(directZip, 'complete')
    const pendingDir = path.join(cacheDir, 'pending')
    fs.mkdirSync(pendingDir)
    fs.writeFileSync(path.join(pendingDir, 'update-info.json'), '{invalid')

    expect(resolveMacUpdaterZipPath(cacheDir)).toBe(directZip)
  })

  it('pending 元数据目标不存在时回退根 update.zip', () => {
    cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-updater-cache-'))
    const directZip = path.join(cacheDir, 'update.zip')
    fs.writeFileSync(directZip, 'complete')
    const pendingDir = path.join(cacheDir, 'pending')
    fs.mkdirSync(pendingDir)
    fs.writeFileSync(
      path.join(pendingDir, 'update-info.json'),
      JSON.stringify({ fileName: 'missing.zip', sha512: 'verified-by-electron-updater' })
    )

    expect(resolveMacUpdaterZipPath(cacheDir)).toBe(directZip)
  })
})
