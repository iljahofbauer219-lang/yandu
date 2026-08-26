import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * 轻量 AES-256-GCM 加解密工具，用于零度API 抓取脚本中保存密码。
 *
 * - Key 派生：若主密钥不是 32 字节，则用 scrypt(passphrase, salt) 派生 32 字节；
 *   32 字节随机主密钥用 base64 编码存放于 .env.local (LINDUO_PRICING_AES_KEY)。
 * - 密文格式：base64(iv(12) || tag(16) || ciphertext)
 */

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12
const SALT = 'yandu-linduo-pricing-salt-v1'

/** 解出 32 字节主密钥；支持原文或 base64 编码的随机串 */
function resolveKey(raw: string): Buffer {
  const trimmed = (raw || '').trim()
  if (!trimmed) {
    // 开发兜底：使用项目名派生一个稳定但弱的密钥；生产必须显式配置
    return scryptSync('yandu-crossborder-default-aes', SALT, 32)
  }
  // 尝试 base64
  try {
    const buf = Buffer.from(trimmed, 'base64')
    if (buf.length === 32) return buf
  } catch {
    // ignore
  }
  // 兜底：当作 passphrase 派生
  return scryptSync(trimmed, SALT, 32)
}

/** 加密任意字符串 → base64 密文 */
export function encrypt(plain: string, rawKey: string): string {
  if (!plain) return ''
  const key = resolveKey(rawKey)
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGO, key, iv)
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

/** 解密 base64 密文 → 原文；失败抛错 */
export function decrypt(payload: string, rawKey: string): string {
  if (!payload) return ''
  const key = resolveKey(rawKey)
  const buf = Buffer.from(payload, 'base64')
  if (buf.length < IV_LENGTH + 16) throw new Error('密文长度不足')
  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + 16)
  const ct = buf.subarray(IV_LENGTH + 16)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/** 生成 32 字节随机密钥并以 base64 形式返回（用于 .env.local 初始化） */
export function generateKeyBase64(): string {
  return randomBytes(32).toString('base64')
}
