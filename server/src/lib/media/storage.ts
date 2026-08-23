/**
 * 媒体存储抽象：本地磁盘（开发/单机）与阿里云 OSS（生产）双驱动。
 * - local：文件落盘 MEDIA_LOCAL_DIR，下载走服务端公共路由 GET /media/*（HMAC-SHA256 签名验签）
 * - oss：对象直存 OSS，下载/上传均走 V1 预签名 URL（HMAC-SHA1，不引 SDK，服务端零中转流量）
 * 密钥只在服务端，客户端只拿到短时签名 URL。
 */
import { createHmac, timingSafeEqual } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { config } from '../../config.js'

export interface PutResult {
  key: string
  size: number
  url: string
}

export interface MediaStorage {
  readonly driver: 'local' | 'oss'
  /** 服务端直传（local 落盘；OSS 驱动不支持，须走 getUploadUrl 预签名直传） */
  put(key: string, body: Buffer, contentType: string): Promise<PutResult>
  /** 下载签名 URL（local=公共路由验签链接；oss=V1 签名 URL） */
  getSignedUrl(key: string, ttlSeconds: number): string
  /** 上传签名 URL（客户端直传；local 驱动返回 null，表示走 POST /api/media/uploads 服务端上传） */
  getUploadUrl(key: string, ttlSeconds: number): string | null
  remove(key: string): Promise<void>
  /** 仅 local：校验公共下载路由签名（未过期 + HMAC 匹配 + key 合法） */
  verifyDownloadSignature?(key: string, expires: number, signature: string): boolean
  /** 仅 local：打开本地文件流 */
  openReadStream?(key: string): { stream: Readable; size: number } | null
}

const SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_.-]{0,511}$/

/** 对象 key 安全校验：仅允许 ASCII 安全字符，拒绝路径穿越与空段，防止写出媒体根目录 */
export function assertSafeKey(key: string): void {
  if (
    !SAFE_KEY_PATTERN.test(key) ||
    key.includes('..') ||
    key.includes('//') ||
    key.startsWith('/') ||
    key.endsWith('/')
  ) {
    throw new Error(`非法媒体 key: ${key.slice(0, 64)}`)
  }
}

// ---------------------------------------------------------------- local 驱动

export class LocalMediaStorage implements MediaStorage {
  readonly driver = 'local' as const

  constructor(private options: { rootDir: string; publicBaseUrl: string; signingSecret: string }) {}

  private filePath(key: string): string {
    return path.join(this.options.rootDir, ...key.split('/'))
  }

  private sign(key: string, expires: number): string {
    return createHmac('sha256', this.options.signingSecret).update(`${key}\n${expires}`).digest('base64url')
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<PutResult> {
    assertSafeKey(key)
    const filePath = this.filePath(key)
    await mkdir(path.dirname(filePath), { recursive: true })
    await writeFile(filePath, body)
    return { key, size: body.length, url: this.getSignedUrl(key, 3600) }
  }

  getSignedUrl(key: string, ttlSeconds: number): string {
    assertSafeKey(key)
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds
    const signature = this.sign(key, expires)
    const base = this.options.publicBaseUrl.replace(/\/$/, '')
    return `${base}/media/${key}?expires=${expires}&signature=${encodeURIComponent(signature)}`
  }

  getUploadUrl(): string | null {
    return null
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key)
    const filePath = this.filePath(key)
    if (existsSync(filePath)) await unlink(filePath)
  }

  verifyDownloadSignature(key: string, expires: number, signature: string): boolean {
    if (!Number.isSafeInteger(expires) || expires < Math.floor(Date.now() / 1000)) return false
    try {
      assertSafeKey(key)
    } catch {
      return false
    }
    const expected = Buffer.from(this.sign(key, expires), 'utf8')
    const actual = Buffer.from(signature, 'utf8')
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  }

  openReadStream(key: string): { stream: Readable; size: number } | null {
    try {
      assertSafeKey(key)
    } catch {
      return null
    }
    const filePath = this.filePath(key)
    if (!existsSync(filePath)) return null
    // stat 的 try/catch 兜底：文件在 existsSync 与 stat 之间被删时返回 null 而不是抛异常
    try {
      return { stream: createReadStream(filePath), size: statSync(filePath).size }
    } catch {
      return null
    }
  }
}

// ---------------------------------------------------------------- OSS 驱动（V1 预签名，无 SDK）

export class OssMediaStorage implements MediaStorage {
  readonly driver = 'oss' as const

  constructor(private options: { bucket: string; endpoint: string; accessKeyId: string; accessKeySecret: string }) {}

  private host(): string {
    const endpoint = this.options.endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '')
    return `https://${this.options.bucket}.${endpoint}`
  }

  /** StringToSign = VERB + "\n" + Content-MD5 + "\n" + Content-Type + "\n" + Expires + "\n" + CanonicalizedResource */
  private sign(verb: string, key: string, expires: number): string {
    const stringToSign = `${verb}\n\n\n${expires}\n/${this.options.bucket}/${key}`
    return createHmac('sha1', this.options.accessKeySecret).update(stringToSign).digest('base64')
  }

  private signedUrl(verb: string, key: string, ttlSeconds: number): string {
    assertSafeKey(key)
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds
    const signature = this.sign(verb, key, expires)
    const params = new URLSearchParams({
      OSSAccessKeyId: this.options.accessKeyId,
      Expires: String(expires),
      Signature: signature
    })
    const encodedKey = key.split('/').map(encodeURIComponent).join('/')
    return `${this.host()}/${encodedKey}?${params.toString()}`
  }

  getSignedUrl(key: string, ttlSeconds: number): string {
    return this.signedUrl('GET', key, ttlSeconds)
  }

  getUploadUrl(key: string, ttlSeconds: number): string | null {
    return this.signedUrl('PUT', key, ttlSeconds)
  }

  // OSS 场景流量不经过服务端：客户端用 sign-upload 的预签名 PUT URL 直传
  async put(_key: string, _body: Buffer, _contentType: string): Promise<PutResult> {
    throw new Error('OSS 驱动不支持服务端直传，请使用 sign-upload 预签名 URL')
  }

  async remove(key: string): Promise<void> {
    const url = this.signedUrl('DELETE', key, 300)
    const response = await fetch(url, { method: 'DELETE' })
    if (!response.ok && response.status !== 404) {
      throw new Error(`OSS 删除失败：HTTP ${response.status}`)
    }
  }
}

// ---------------------------------------------------------------- 工厂

let cached: MediaStorage | null = null

export function createMediaStorage(): MediaStorage {
  if (cached) return cached
  if (config.mediaDriver === 'oss') {
    if (!config.ossBucket || !config.ossEndpoint || !config.ossAccessKeyId || !config.ossAccessKeySecret) {
      throw new Error('MEDIA_DRIVER=oss 需要配置 OSS_BUCKET / OSS_ENDPOINT / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET')
    }
    cached = new OssMediaStorage({
      bucket: config.ossBucket,
      endpoint: config.ossEndpoint,
      accessKeyId: config.ossAccessKeyId,
      accessKeySecret: config.ossAccessKeySecret
    })
  } else {
    cached = new LocalMediaStorage({
      rootDir: config.mediaLocalDir,
      publicBaseUrl: config.mediaPublicBaseUrl,
      signingSecret: config.mediaSigningSecret
    })
  }
  return cached
}

/** 测试专用：重置缓存实例（切换 MEDIA_DRIVER 配置后调用） */
export function resetMediaStorageForTest(): void {
  cached = null
}
