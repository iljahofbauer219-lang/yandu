import { beforeEach, describe, expect, it, vi } from 'vitest'

const paths = { userData: '/app/userData', temp: '/tmp' }
let bitmapOverride: Uint8Array | null = null

vi.mock('electron', () => ({
  app: { getPath: (kind: string) => (kind === 'userData' ? paths.userData : paths.temp) },
  nativeImage: {
    createFromBuffer: (buffer: Buffer) => {
      if (!buffer.length) return { isEmpty: () => true, resize: () => ({ isEmpty: () => true }) }
      return {
        isEmpty: () => false,
        resize: () => ({
          isEmpty: () => false,
          getSize: () => ({ width: 9, height: 8 }),
          toBitmap: () => bitmapOverride ?? Uint8Array.from(Array.from({ length: 9 * 8 * 4 }, (_unused, offset) => {
            const channel = offset % 4
            const x = Math.floor(offset / 4) % 9
            if (channel === 3) return 255
            if (channel === 2) return 20 + x * 20
            return 0
          }))
        })
      }
    }
  }
}))

const fsMock = vi.hoisted(() => ({ existsSync: vi.fn(() => true), readFileSync: vi.fn((_filePath: string) => Buffer.from('fake-image')) }))
vi.mock('node:fs', () => ({ default: fsMock }))

import { ImageHashService, localPathForMediaValue } from '../ImageHashService' // eslint-disable-line import/order

describe('本地图片路径解析', () => {
  it('cross-media / file:// / 裸绝对路径都能还原为绝对路径，网络与 data 地址不算本地', () => {
    const abs = '/Users/zyc/Library/Application Support/app/generated/a.png'
    expect(localPathForMediaValue(`cross-media://local/${encodeURIComponent(abs)}`)).toBe(abs)
    expect(localPathForMediaValue('file:///app/a.png')).toBe('/app/a.png')
    expect(localPathForMediaValue('/app/a.png')).toBe('/app/a.png')
    expect(localPathForMediaValue('https://cdn.example/a.png')).toBeNull()
    expect(localPathForMediaValue('data:image/png;base64,AAAA')).toBeNull()
  })
})

describe('指纹取用约束', () => {
  const service = new ImageHashService()

  beforeEach(() => {
    bitmapOverride = null
    fsMock.existsSync.mockReset()
    fsMock.existsSync.mockReturnValue(true)
    fsMock.readFileSync.mockReset()
    fsMock.readFileSync.mockReturnValue(Buffer.from('fake-image'))
  })

  it('应用目录内的本地图正常出 16 位指纹', async () => {
    const hash = await service.computeHash(`cross-media://local/${encodeURIComponent(`${paths.userData}/generated/a.png`)}`)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
  })

  it('应用目录之外的本机路径一律拒绝（IPC 不能变成本机任意文件读取）', async () => {
    expect(await service.computeHash('/Users/zyc/.ssh/id_rsa.png')).toBeNull()
    expect(await service.computeHash('/etc/secret.png')).toBeNull()
    expect(fsMock.existsSync).not.toHaveBeenCalled()
  })

  it('非图片扩展名不读盘', async () => {
    expect(await service.computeHash(`${paths.userData}/note.txt`)).toBeNull()
    expect(fsMock.existsSync).not.toHaveBeenCalled()
  })

  it('文件不存在或解码失败返回 null，不抛异常', async () => {
    fsMock.existsSync.mockReturnValue(false)
    expect(await service.computeHash(`${paths.userData}/a.png`)).toBeNull()
    fsMock.existsSync.mockReturnValue(true)
    bitmapOverride = new Uint8Array(1)
    expect(await service.computeHash(`${paths.userData}/b.png`)).toBeNull()
  })

  it('同一地址只解码一次（缓存）', async () => {
    const url = `${paths.userData}/cached.png`
    await service.computeHash(url)
    const callsBefore = fsMock.readFileSync.mock.calls.length
    await service.computeHash(url)
    expect(fsMock.readFileSync.mock.calls.length).toBe(callsBefore)
  })

  it('fingerprintImages 丢弃非法入参并按 40 张截断', async () => {
    const values = Array.from({ length: 45 }, (_unused, index) => `${paths.userData}/batch-${index}.png`)
    const result = await service.fingerprintImages([...values, 42, '', null, {}])
    expect(result).toHaveLength(40)
    expect(result.every(item => item.hash && typeof item.url === 'string')).toBe(true)
    expect(await service.fingerprintImages('not-an-array')).toEqual([])
  })

  it('单张读盘失败只让该张为空串，其余照常出指纹', async () => {
    fsMock.readFileSync.mockImplementation((filePath: string) => {
      if (String(filePath).includes('io-fail')) throw new Error('磁盘读取失败')
      return Buffer.from('fake-image')
    })
    const result = await service.fingerprintImages([`${paths.userData}/io-fail.png`, `${paths.userData}/io-ok.png`])
    expect(result[0]).toEqual({ url: `${paths.userData}/io-fail.png`, hash: '', background: 'UNKNOWN' })
    expect(result[1].hash).toMatch(/^[0-9a-f]{16}$/)
    expect(result[1].background).toBe('UNKNOWN')
  })
})
