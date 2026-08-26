/**
 * MultimodalVision 单元测试
 *
 * 覆盖：
 * - describeAttachments 跳过 kind=document 的附件（document 由 documentContext 路径处理）
 * - describeAttachments 跳过 available=false 的附件
 * - 默认无 kind 字段的旧 attachment 视为 image（向后兼容）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

// 用 vi.hoisted 先准备好 spawn mock（模块加载前要可用）
const spawnMock = vi.hoisted(() => {
  return vi.fn(() => {
    const child: {
      stderr: { on: (event: string, cb: (chunk: string) => void) => void; setEncoding: (enc: string) => void }
      stdin: { end: () => void }
      once: (event: string, cb: (...args: unknown[]) => void) => void
      on: (event: string, cb: (...args: unknown[]) => void) => void
      kill: (signal: string) => void
    } = {
      stderr: {
        on: () => undefined,
        setEncoding: () => undefined
      },
      stdin: { end: () => undefined },
      once: (event, cb) => {
        if (event === 'close') {
          setImmediate(() => (cb as (code: number | null, signal: string | null) => void)(0, null))
        }
      },
      on: () => undefined,
      kill: () => undefined
    }
    return child
  })
})

vi.mock('electron', () => ({
  app: { isPackaged: false }
}))

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(async () => 'fake-vision-description'),
    unlink: vi.fn(async () => undefined)
  }
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock
}))

import { describeAttachments } from '../MultimodalVision'
import type { AttachmentRecord } from '../AttachmentService'

function makeAttachment(overrides: Partial<AttachmentRecord>): AttachmentRecord {
  return {
    id: 'a1',
    sessionId: 's1',
    fileName: 'a.png',
    mimeType: 'image/png',
    size: 100,
    filePath: '/tmp/a.png',
    thumbnailPath: '',
    previewUrl: '',
    available: true,
    ...overrides
  }
}

describe('describeAttachments 文档过滤', () => {
  beforeEach(() => {
    spawnMock.mockClear()
  })

  it('跳过 kind=document 的附件，不进入 vision-sidecar', async () => {
    const attachments: AttachmentRecord[] = [
      makeAttachment({ id: 'img1', fileName: 'a.png', kind: 'image' }),
      makeAttachment({ id: 'doc1', fileName: 'r.pdf', kind: 'document' }),
      makeAttachment({ id: 'img2', fileName: 'b.jpg', kind: undefined })
    ]
    const results = await describeAttachments(attachments, '分析这些图片')
    const ids = results.map((r) => r.imageId).sort()
    expect(ids).toEqual(['img1', 'img2'])
    expect(spawnMock).toHaveBeenCalledTimes(2)
  })

  it('available=false 的附件被跳过', async () => {
    const attachments: AttachmentRecord[] = [
      makeAttachment({ id: 'img1', fileName: 'a.png', kind: 'image', available: false }),
      makeAttachment({ id: 'img2', fileName: 'b.jpg', kind: 'image' })
    ]
    const results = await describeAttachments(attachments, '分析')
    const ids = results.map((r) => r.imageId).sort()
    expect(ids).toEqual(['img2'])
    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('全 document 时返回空数组，不 spawn 任何进程', async () => {
    const attachments: AttachmentRecord[] = [
      makeAttachment({ id: 'doc1', fileName: 'r.pdf', kind: 'document' }),
      makeAttachment({ id: 'doc2', fileName: 'r2.docx', kind: 'document' })
    ]
    const results = await describeAttachments(attachments, '分析')
    expect(results).toEqual([])
    expect(spawnMock).not.toHaveBeenCalled()
  })
})
