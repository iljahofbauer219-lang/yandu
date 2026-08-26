import { prisma } from '../../lib/prisma.js'
import { config } from '../../config.js'
import { encrypt, decrypt } from '../../lib/crypto.js'

/**
 * 零度API 价格抓取的登录态管理。
 *
 * 流程：
 * 1. 渲染端提供用户名 + 密码 → 走 playwright 自动登录（pricing-scraper 调用）
 * 2. 登录成功后，cookie 序列化为 JSON 存到 LinduoLoginSession
 * 3. 抓取脚本读取 cookie 注入 playwright context
 * 4. cookie 失效时（expiresAt < now + 24h），自动用解密后的密码重新登录
 *
 * 安全：
 * - 密码用 AES-256-GCM 加密落库；密钥 LINDUO_PRICING_AES_KEY 由运维在 .env.local 维护
 * - 服务端不向前端回传密码（连密文都不返回）
 */

const LOGIN_SESSION_ID = 'singleton'

export interface LoginResult {
  ok: boolean
  expiresAt?: string
  error?: string
}

/** 读取当前登录态（不含密码 / cookie 明文） */
export async function getLoginStatus(): Promise<{
  loggedIn: boolean
  username: string | null
  expiresAt: string | null
  lastUsedAt: string | null
  expiresInSeconds: number | null
}> {
  const session = await prisma.linduoLoginSession.findUnique({ where: { id: LOGIN_SESSION_ID } })
  if (!session) {
    return { loggedIn: false, username: null, expiresAt: null, lastUsedAt: null, expiresInSeconds: null }
  }
  const expiresAt = session.expiresAt ? session.expiresAt.toISOString() : null
  const expiresInSeconds = session.expiresAt
    ? Math.floor((session.expiresAt.getTime() - Date.now()) / 1000)
    : null
  return {
    loggedIn: true,
    username: session.username,
    expiresAt,
    lastUsedAt: session.lastUsedAt.toISOString(),
    expiresInSeconds
  }
}

/** 把 playwright 抓到的 cookie 数组保存到 DB；密码加密后存 passwordEnc（用于续期） */
export async function saveLoginSession(input: {
  username: string
  password: string
  cookies: Array<Record<string, unknown>>
  expiresAt: Date | null
}): Promise<void> {
  const passwordEnc = encrypt(input.password, config.linduoPricingAesKey)
  const cookiesJson = JSON.stringify(input.cookies)
  await prisma.linduoLoginSession.upsert({
    where: { id: LOGIN_SESSION_ID },
    create: {
      id: LOGIN_SESSION_ID,
      username: input.username,
      passwordEnc,
      cookies: cookiesJson,
      expiresAt: input.expiresAt
    },
    update: {
      username: input.username,
      passwordEnc,
      cookies: cookiesJson,
      expiresAt: input.expiresAt,
      lastUsedAt: new Date()
    }
  })
}

/** 读取已保存的 cookie 数组（注入到 playwright context 用） */
export async function loadCookies(): Promise<{ cookies: Array<Record<string, unknown>>; username: string | null }> {
  const session = await prisma.linduoLoginSession.findUnique({ where: { id: LOGIN_SESSION_ID } })
  if (!session) return { cookies: [], username: null }
  let parsed: Array<Record<string, unknown>> = []
  try {
    const value = JSON.parse(session.cookies) as unknown
    if (Array.isArray(value)) parsed = value as Array<Record<string, unknown>>
  } catch {
    parsed = []
  }
  // 顺手刷新 lastUsedAt
  prisma.linduoLoginSession.update({ where: { id: LOGIN_SESSION_ID }, data: { lastUsedAt: new Date() } }).catch(() => undefined)
  return { cookies: parsed, username: session.username }
}

/** 取回解密后的密码（仅用于 cookie 失效后的自动重登） */
export async function loadDecryptedPassword(): Promise<string | null> {
  const session = await prisma.linduoLoginSession.findUnique({ where: { id: LOGIN_SESSION_ID } })
  if (!session) return null
  try {
    return decrypt(session.passwordEnc, config.linduoPricingAesKey)
  } catch {
    return null
  }
}

/** 是否需要自动重新登录（cookie 即将过期或不存在） */
export async function needsRefresh(): Promise<boolean> {
  const session = await prisma.linduoLoginSession.findUnique({ where: { id: LOGIN_SESSION_ID } })
  if (!session) return true
  if (!session.expiresAt) return true
  // 距离过期 < 24h 视为需要续期
  return session.expiresAt.getTime() - Date.now() < 24 * 3600 * 1000
}

/** 清除登录态（用户主动登出/重置时使用） */
export async function clearLoginSession(): Promise<void> {
  await prisma.linduoLoginSession.deleteMany({ where: { id: LOGIN_SESSION_ID } }).catch(() => undefined)
}
