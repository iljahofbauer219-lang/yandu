/**
 * AttachmentService 文档路径单元测试
 *
 * 覆盖：
 * - extractDocumentText：纯文本/未知扩展名直读
 * - saveIncomingDocuments：保存文档、超过 15 MB 报错、不支持扩展名报错
 * - listAttachments 兼容：同一 sessionId 下 image 与 document 混合，document 不生成缩略图
 * - cloneAttachmentSession：image 走原逻辑，document 走新逻辑
 * - removeAttachment：删 document 时不要求 thumbnailPath 存在
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// 用 vi.hoisted 在模块加载前先 mock electron.app
const userDataMock = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('node:path') as typeof import('node:path')
  const os = require('node:os') as typeof import('node:os')
  const tmp = path.join(os.tmpdir(), `yandu-advisor-test-${Date.now()}`)
  return { dir: tmp }
})

vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => (key === 'userData' ? userDataMock.dir : os.tmpdir())
  },
  nativeImage: {
    createFromBuffer: (_buf: Buffer) => ({
      isEmpty: () => false,
      getSize: () => ({ width: 100, height: 100 }),
      resize: () => ({ toPNG: () => Buffer.from([]) })
    })
  }
}))

// 屏蔽 mammoth/pdf-parse/word-extractor/officeparser 的副作用
vi.mock('mammoth', () => ({
  extractRawText: vi.fn(async () => ({ value: 'mammoth-text' }))
}))
vi.mock('pdf-parse', () => ({
  default: vi.fn(async () => ({ text: 'pdf-text' }))
}))
vi.mock('word-extractor', () => {
  class FakeDoc {
    getBody() {
      return 'word-extractor-text'
    }
  }
  class FakeExtractor {
    async extract() {
      return new FakeDoc()
    }
  }
  return { default: FakeExtractor }
})
vi.mock('officeparser', () => {
  const fakeAst = { toText: () => 'officeparser-text' }
  return {
    OfficeParser: {
      parseOffice: vi.fn(async () => fakeAst)
    },
    parseOffice: vi.fn(async () => fakeAst),
    default: { parseOffice: vi.fn(async () => fakeAst) }
  }
})

// 在 vi.hoisted 之后再 import node 内置模块与被测模块
const path = require('node:path') as typeof import('node:path')
const os = require('node:os') as typeof import('node:os')
const fs = require('node:fs/promises') as typeof import('node:fs/promises')
const crypto = require('node:crypto') as typeof import('node:crypto')

import {
  saveIncomingDocuments,
  saveIncomingImages,
  listAttachments,
  removeAttachment,
  cloneAttachmentSession,
  extractDocumentText,
  isImagePath,
  type IncomingDocument
} from '../AttachmentService'

const SESSION = 'task_' + crypto.randomBytes(8).toString('hex')

beforeEach(async () => {
  await fs.mkdir(userDataMock.dir, { recursive: true })
})

afterEach(async () => {
  await fs.rm(userDataMock.dir, { recursive: true, force: true })
})

describe('extractDocumentText', () => {
  it('txt 扩展名：直接 utf-8 读取', async () => {
    const utf8Bytes = Buffer.from('你好，世界\nhello', 'utf8')
    const text = await extractDocumentText(utf8Bytes, '.txt', 'sample.txt')
    expect(text).toContain('你好，世界')
    expect(text).toContain('hello')
  })

  it('未知扩展名：返回空字符串', async () => {
    const text = await extractDocumentText(Buffer.from('xxx'), '.xyz', 'a.xyz')
    expect(text).toBe('')
  })

  it('docx：调用 officeparser 拿到纯文本', async () => {
    const text = await extractDocumentText(Buffer.from('fake-docx-bytes'), '.docx', 'a.docx')
    expect(text).toBe('officeparser-text')
  })

  it('rtf：调用 officeparser 拿到纯文本', async () => {
    const text = await extractDocumentText(Buffer.from('fake-rtf'), '.rtf', 'a.rtf')
    expect(text).toBe('officeparser-text')
  })

  it('doc：调用 word-extractor 拿到纯文本', async () => {
    const text = await extractDocumentText(Buffer.from('fake-doc'), '.doc', 'a.doc')
    expect(text).toBe('word-extractor-text')
  })

  it('pdf：调用 officeparser 拿到纯文本', async () => {
    const text = await extractDocumentText(Buffer.from('fake-pdf'), '.pdf', 'a.pdf')
    expect(text).toBe('officeparser-text')
  })
})

describe('saveIncomingDocuments', () => {
  it('保存一个文档，AttachmentRecord.kind === "document" 且不带缩略图', async () => {
    const docs: IncomingDocument[] = [
      {
        name: 'report.pdf',
        mimeType: 'application/pdf',
        bytes: Buffer.from('fake-pdf-bytes')
      }
    ]
    const saved = await saveIncomingDocuments(SESSION, docs)
    expect(saved).toHaveLength(1)
    const record = saved[0]
    expect(record.kind).toBe('document')
    expect(record.fileName).toBe('report.pdf')
    expect(record.thumbnailPath).toBe('')
    expect(record.previewUrl).toBe('')
    expect(record.available).toBe(true)
    expect(record.size).toBe(Buffer.byteLength('fake-pdf-bytes'))
  })

  it('超过 15 MB 抛错', async () => {
    const docs: IncomingDocument[] = [
      {
        name: 'huge.pdf',
        mimeType: 'application/pdf',
        bytes: Buffer.alloc(16 * 1024 * 1024)
      }
    ]
    await expect(saveIncomingDocuments(SESSION, docs)).rejects.toThrow(/15 MB/)
  })

  it('不支持的扩展名抛错', async () => {
    const docs: IncomingDocument[] = [
      {
        name: 'evil.exe',
        mimeType: 'application/octet-stream',
        bytes: Buffer.from('x')
      }
    ]
    await expect(saveIncomingDocuments(SESSION, docs)).rejects.toThrow(/受支持/)
  })

  it('多次保存可累加，并通过 listAttachments 同时拿到 image 与 document', async () => {
    const imageRecords = await saveIncomingImages(SESSION, [
      {
        name: 'a.png',
        mimeType: 'image/png',
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47])
      }
    ])
    expect(imageRecords[0].kind).toBe('image')

    const docRecords = await saveIncomingDocuments(SESSION, [
      {
        name: 'b.pdf',
        mimeType: 'application/pdf',
        bytes: Buffer.from('fake')
      }
    ])
    expect(docRecords[0].kind).toBe('document')

    const all = await listAttachments(SESSION)
    expect(all).toHaveLength(2)
    const kinds = all.map((r) => r.kind).sort()
    expect(kinds).toEqual(['document', 'image'])
  })
})

describe('cloneAttachmentSession / removeAttachment', () => {
  it('cloneAttachmentSession 复制 image 与 document 到目标 session', async () => {
    await saveIncomingImages(SESSION, [
      {
        name: 'a.png',
        mimeType: 'image/png',
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47])
      }
    ])
    await saveIncomingDocuments(SESSION, [
      {
        name: 'b.pdf',
        mimeType: 'application/pdf',
        bytes: Buffer.from('pdf')
      }
    ])

    const target = 'task_' + crypto.randomBytes(8).toString('hex')
    const cloned = await cloneAttachmentSession(SESSION, target)
    expect(cloned).toHaveLength(2)
    const kinds = cloned.map((r) => r.kind).sort()
    expect(kinds).toEqual(['document', 'image'])
  })

  it('removeAttachment 删除 document 时不要求 thumbnailPath 存在', async () => {
    const [doc] = await saveIncomingDocuments(SESSION, [
      {
        name: 'a.pdf',
        mimeType: 'application/pdf',
        bytes: Buffer.from('pdf')
      }
    ])
    const removed = await removeAttachment(SESSION, doc.id)
    expect(removed).toBe(true)
    const all = await listAttachments(SESSION)
    expect(all).toHaveLength(0)
  })
})

/**
 * isImagePath：advisor:attachments:select 统一入口的分桶依据，
 * 走 saveIncomingImages 还是 saveIncomingDocuments。
 */
describe('isImagePath', () => {
  it('png/jpg/jpeg/webp/gif/heic/tif/tiff/bmp 都判为图片', () => {
    for (const ext of [
      '.png', '.jpg', '.jpeg', '.webp', '.gif', '.heic', '.tif', '.tiff', '.bmp'
    ]) {
      expect(isImagePath(`/tmp/photo${ext}`)).toBe(true)
    }
  })

  it('大写扩展名仍判为图片', () => {
    expect(isImagePath('/tmp/photo.PNG')).toBe(true)
    expect(isImagePath('/tmp/photo.JpG')).toBe(true)
  })

  it('pdf/docx/doc/rtf/txt/md 都判为非图片', () => {
    for (const ext of ['.pdf', '.docx', '.doc', '.rtf', '.txt', '.md']) {
      expect(isImagePath(`/tmp/file${ext}`)).toBe(false)
    }
  })

  it('未知扩展名判为非图片', () => {
    expect(isImagePath('/tmp/file.xyz')).toBe(false)
    expect(isImagePath('/tmp/file')).toBe(false)
  })
})
