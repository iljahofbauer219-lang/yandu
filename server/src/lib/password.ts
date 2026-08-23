import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { httpError } from './errors.js'

const scrypt = promisify(scryptCallback) as (password: string, salt: string, keylen: number) => Promise<Buffer>

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64)
  return `scrypt:${salt}:${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, hash] = parts
  if (!salt || !hash) return false
  const derived = await scrypt(password, salt, 64)
  const expected = Buffer.from(hash, 'hex')
  return expected.length === derived.length && timingSafeEqual(expected, derived)
}

export function assertPasswordStrength(password: string): void {
  if (password.length < 8 || password.length > 72 || !/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    throw httpError(400, 'WEAK_PASSWORD', '密码需为 8~72 位，且同时包含字母和数字')
  }
}
