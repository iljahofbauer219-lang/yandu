import { safeStorage } from 'electron'

// macOS 钥匙串授权弹窗按 safeStorage 访问触发，签名不受信任时「允许」仅单次有效。
// 此处保证每次进程启动至多一次钥匙串访问：首次加解密成功后结果入内存缓存，同内容不再触碰 safeStorage。
const cipherCache = new Map<string, string>()
const plainCache = new Map<string, string>()
let keychainHits = 0

export function secretStorageAvailable(): boolean {
  return safeStorage.isEncryptionAvailable()
}

export function encryptSecret(plain: string): string {
  const cached = plainCache.get(plain)
  if (cached !== undefined) return cached
  keychainHits += 1
  console.info(`[secure-vault] 钥匙串访问 #${keychainHits}（encrypt）`)
  const cipher = safeStorage.encryptString(plain).toString('base64')
  plainCache.set(plain, cipher)
  cipherCache.set(cipher, plain)
  return cipher
}

export function decryptSecret(cipherBase64: string): string {
  const cached = cipherCache.get(cipherBase64)
  if (cached !== undefined) return cached
  keychainHits += 1
  console.info(`[secure-vault] 钥匙串访问 #${keychainHits}（decrypt）`)
  const plain = safeStorage.decryptString(Buffer.from(cipherBase64, 'base64'))
  cipherCache.set(cipherBase64, plain)
  plainCache.set(plain, cipherBase64)
  return plain
}

// 启动时集中触碰一次钥匙串：若授权弹窗不可避免，让它出现在启动时刻而非业务流程中途，并顺带创建钥匙串项。
export function warmSecretStorage(): void {
  try {
    if (!safeStorage.isEncryptionAvailable()) return
    decryptSecret(encryptSecret(''))
  } catch (error) {
    console.warn('[secure-vault] 启动钥匙串预热失败（首次使用时重试）：', (error as Error).message)
  }
}
