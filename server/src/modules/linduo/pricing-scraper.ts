import type { LinduoModelPricing, LinduoVendor } from './types.js'
import { config } from '../../config.js'
import { prisma } from '../../lib/prisma.js'
import { fallbackPricingList } from './pricing-fallback.js'
import {
  loadCookies,
  loadDecryptedPassword,
  needsRefresh,
  saveLoginSession
} from './pricing-login.js'

/**
 * 服务端 tsconfig 未启用 DOM lib，但 playwright `$$eval` 的回调参数会被推断成
 * `HTMLElement` / `SVGElement`。这里给出抓取页 DOM 元素所需的最小结构类型，
 * 让回调在无 DOM lib 的服务端也能通过类型检查。
 */
interface PriceCardElement {
  getAttribute(name: string): string | null
  querySelector(selector: string): PriceCardElement | null
  textContent: string | null
}

/**
 * 零度API 模型价格抓取（playwright-core + 本地 Chrome）。
 *
 * 关键策略：
 * - 抓取不依赖图形界面；playwright-core 启动 headless Chrome
 * - 登录态：首次需用户提供用户名+密码；之后自动维护 cookie，cookie 失效时用加密保存的密码自动重登
 * - 抓取失败时回退到 pricing-fallback.ts 的兜底常量，并把 stale=true
 *
 * DOM 适配：
 * api000.com/pricing 页面是单页应用，价格卡片渲染在 .model-card / [data-model-id] 等容器中；
 * 这里给出多层 selector 兜底，真实页面上线后需结合实际 DOM 调整 parsePriceCard 的 selector 优先级。
 */

const LOGIN_URL = () => `${config.linduoPricingBaseUrl.replace(/\/+$/, '')}/login`
const PRICING_URL = () => `${config.linduoPricingBaseUrl.replace(/\/+$/, '')}/pricing`

/** 默认 Chrome 路径：macOS / Windows / Linux 顺次探测 */
function defaultChromePath(): string {
  if (config.linduoPricingChromePath) return config.linduoPricingChromePath
  const candidates: Array<string> = []
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    candidates.push('/Applications/Chromium.app/Contents/MacOS/Chromium')
  } else if (process.platform === 'win32') {
    candidates.push('C:/Program Files/Google/Chrome/Application/chrome.exe')
    candidates.push('C:/Program Files (x86)/Google/Chrome/Application/chrome.exe')
  } else {
    candidates.push('/usr/bin/google-chrome')
    candidates.push('/usr/bin/chromium')
    candidates.push('/usr/bin/chromium-browser')
  }
  // require('node:fs').existsSync 同步探测（不阻塞异步函数）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('node:fs') as typeof import('node:fs')
  for (const path of candidates) {
    try { if (fs.existsSync(path)) return path } catch { /* ignore */ }
  }
  return candidates[0] ?? ''
}

interface ScrapeResult {
  items: LinduoModelPricing[]
  fromFallback: boolean
  loggedInJustNow: boolean
}

interface ScrapeOptions {
  /** 强制自动重新登录（即便 cookie 未过期） */
  forceRelogin?: boolean
  /** 显式提供的用户名密码（用于首次登录或用户主动重登） */
  credentials?: { username: string; password: string }
}

/** 用用户名+密码登录 api000.com 并把 cookie 写回 DB */
async function loginAndSaveCookies(
  username: string,
  password: string
): Promise<{ cookies: Array<Record<string, unknown>>; expiresAt: Date | null }> {
  // 动态 import，避免模块加载时就强依赖 playwright-core
  const { chromium } = await import('playwright-core')
  const executablePath = defaultChromePath()
  if (!executablePath) {
    throw new Error('未找到本地 Chrome / Chromium，请设置 LINDUO_PRICING_CHROME_PATH 或安装 Google Chrome')
  }
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      locale: 'zh-CN'
    })
    const page = await ctx.newPage()
    await page.goto(LOGIN_URL(), { waitUntil: 'domcontentloaded', timeout: 30_000 })
    // 自适应 selector：尝试常见写法
    const userSel = 'input[name="username"], input[type="email"], input[placeholder*="账号"], input[placeholder*="邮箱"]'
    const passSel = 'input[name="password"], input[type="password"]'
    await page.waitForSelector(userSel, { timeout: 15_000 }).catch(() => undefined)
    await page.waitForSelector(passSel, { timeout: 15_000 }).catch(() => undefined)
    await page.fill(userSel, username)
    await page.fill(passSel, password)
    // 点击提交并等待跳转
    const submitSel = 'button[type="submit"], button:has-text("登录"), button:has-text("Login")'
    await page.click(submitSel).catch(() => undefined)
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined)
    // 校验：当前 URL 不再是 /login
    if (page.url().includes('/login')) {
      throw new Error('登录失败：仍在登录页（用户名/密码错误，或页面需要二次验证）')
    }
    const cookies = await ctx.cookies(config.linduoPricingBaseUrl)
    // 估算过期时间：取 cookie 中 expires>0 的最小值；兜底 7 天
    const futureExpirations = cookies
      .map((cookie: any) => Number(cookie.expires))
      .filter((value: number) => Number.isFinite(value) && value > 0)
    const expiresAt = futureExpirations.length
      ? new Date(Math.min(...futureExpirations) * 1000)
      : new Date(Date.now() + 7 * 24 * 3600 * 1000)
    return {
      cookies: cookies as unknown as Array<Record<string, unknown>>,
      expiresAt
    }
  } finally {
    await browser.close()
  }
}

/** 抓取 /pricing 页面的模型价格 */
async function scrapePricingPage(cookies: Array<Record<string, unknown>>): Promise<LinduoModelPricing[]> {
  const { chromium } = await import('playwright-core')
  const executablePath = defaultChromePath()
  if (!executablePath) {
    throw new Error('未找到本地 Chrome / Chromium，请设置 LINDUO_PRICING_CHROME_PATH')
  }
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const ctx = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      locale: 'zh-CN'
    })
    if (cookies.length > 0) {
      await ctx.addCookies(cookies as unknown as Parameters<typeof ctx.addCookies>[0])
    }
    const page = await ctx.newPage()
    await page.goto(PRICING_URL(), { waitUntil: 'networkidle', timeout: 60_000 })
    // 服务端可能在 /login 与 /pricing 之间跳转；如果 URL 还包含 /login，说明 cookie 被拒绝
    if (page.url().includes('/login')) {
      throw new Error('COOKIE_REJECTED: 抓取页被重定向到登录页（cookie 失效）')
    }
    // 给前端框架一些时间渲染
    await page.waitForTimeout(2_000)
    // 优先按 data-model-id 提取；回退到常见 class selector；最差用 textContent 正则
    const cardSelector = '[data-model-id], [class*="model-card"], [class*="pricing-card"]'
    await page.waitForSelector(cardSelector, { timeout: 20_000 }).catch(() => undefined)
    // playwright $$eval() 将传入的静态函数序列化到浏览器上下文执行，不存在代码注入风险：
    // 整个回调是项目内常量函数，不接受任何用户输入作为代码片段执行。
    // 服务端 tsconfig 未启用 DOM lib（playwright $$eval 默认回调参数是 HTMLElement），
    // 通过 cast 让回调参数按最小结构 PriceCardElement 推断。
    type ScrapedCard = {
      modelId: string
      text: string
      inputPrice: number | null
      outputPrice: number | null
      cachePrice: number | null
    }
    const scrapeCards: (cards: PriceCardElement[]) => ScrapedCard[] = (cards) => cards.map((card) => {
      const modelId = card.getAttribute('data-model-id')
        || card.querySelector('[class*="model-id"], code, pre')?.textContent?.trim()
        || ''
      const text = (card.textContent || '').trim()
      // 价格解析：支持 "$0.3125" / "0.3125 USD" / "0.3125"
      const grab = (regex: RegExp): number | null => {
        const match = text.match(regex)
        if (!match) return null
        const num = parseFloat(match[1] ?? '')
        return Number.isFinite(num) ? num : null
      }
      return {
        modelId,
        text,
        inputPrice: grab(/输入\s*\$?(\d+(?:\.\d+)?)/) ?? grab(/Input\s*\$?(\d+(?:\.\d+)?)/i),
        outputPrice: grab(/输出\s*\$?(\d+(?:\.\d+)?)/) ?? grab(/Output\s*\$?(\d+(?:\.\d+)?)/i),
        cachePrice: grab(/缓存\s*\$?(\d+(?:\.\d+)?)/) ?? grab(/Cache\s*\$?(\d+(?:\.\d+)?)/i)
      }
    })
    const items = await (page.$$eval(cardSelector, scrapeCards) as unknown as Promise<ScrapedCard[]>)
    // 把 text 用于 vendor 推断（页面可能没标供应商色）
    return items
      .filter((item): item is { modelId: string; text: string; inputPrice: number | null; outputPrice: number | null; cachePrice: number | null } => Boolean(item.modelId))
      .map(item => normalizeItem(item.modelId, item.text, item.inputPrice, item.outputPrice, item.cachePrice))
  } finally {
    await browser.close()
  }
}

function detectVendor(modelId: string, text: string): LinduoVendor {
  const haystack = `${modelId} ${text}`.toLowerCase()
  if (/gpt|openai|dall-e|o1|o3|o4|whisper|tts|embedding/.test(haystack)) return 'openai'
  if (/gemini|imagen|veo|google/.test(haystack)) return 'google'
  if (/claude|anthropic/.test(haystack)) return 'anthropic'
  if (/vidu/.test(haystack)) return 'vidu'
  return 'openai'
}

function normalizeItem(
  modelId: string,
  text: string,
  inputPrice: number | null,
  outputPrice: number | null,
  cachePrice: number | null
): LinduoModelPricing {
  const lower = text.toLowerCase()
  let billingType: LinduoModelPricing['billingType'] = 'TOKEN'
  if (lower.includes('按张') || lower.includes('/image') || lower.includes('每张')) billingType = 'IMAGE'
  else if (lower.includes('按秒') || lower.includes('/秒') || lower.includes('每秒')) billingType = 'VIDEO'
  else if (lower.includes('按次')) billingType = 'REQUEST'
  return {
    modelId,
    vendor: detectVendor(modelId, text),
    inputPrice,
    outputPrice,
    cachePrice,
    currency: 'USD',
    billingType,
    pricePerUnit: billingType === 'IMAGE' || billingType === 'VIDEO' ? inputPrice : null,
    unitLabel: billingType === 'IMAGE' ? '张' : billingType === 'VIDEO' ? '秒' : billingType === 'REQUEST' ? '次' : '1M tokens',
    fetchedAt: new Date().toISOString(),
    stale: false
  }
}

/** 把抓取到的价格批量 upsert 到 DB */
async function persistPricings(items: LinduoModelPricing[]): Promise<number> {
  let count = 0
  for (const item of items) {
    await prisma.linduoModelPricing.upsert({
      where: { modelId: item.modelId },
      create: {
        modelId: item.modelId,
        vendor: item.vendor,
        inputPrice: item.inputPrice,
        outputPrice: item.outputPrice,
        cachePrice: item.cachePrice,
        currency: item.currency,
        billingType: item.billingType,
        pricePerUnit: item.pricePerUnit,
        unitLabel: item.unitLabel,
        fetchedAt: new Date(item.fetchedAt),
        stale: false
      },
      update: {
        vendor: item.vendor,
        inputPrice: item.inputPrice,
        outputPrice: item.outputPrice,
        cachePrice: item.cachePrice,
        currency: item.currency,
        billingType: item.billingType,
        pricePerUnit: item.pricePerUnit,
        unitLabel: item.unitLabel,
        fetchedAt: new Date(item.fetchedAt),
        stale: false
      }
    })
    count += 1
  }
  return count
}

/** 写入兜底价格（stale=true，让卡片有数据可显示） */
async function persistFallback(): Promise<number> {
  const list = fallbackPricingList()
  for (const item of list) {
    await prisma.linduoModelPricing.upsert({
      where: { modelId: item.modelId },
      create: {
        modelId: item.modelId,
        vendor: item.vendor,
        inputPrice: item.inputPrice,
        outputPrice: item.outputPrice,
        cachePrice: item.cachePrice,
        currency: item.currency,
        billingType: item.billingType,
        pricePerUnit: item.pricePerUnit,
        unitLabel: item.unitLabel,
        fetchedAt: new Date(item.fetchedAt),
        stale: true
      },
      update: {
        vendor: item.vendor,
        inputPrice: item.inputPrice,
        outputPrice: item.outputPrice,
        cachePrice: item.cachePrice,
        currency: item.currency,
        billingType: item.billingType,
        pricePerUnit: item.pricePerUnit,
        unitLabel: item.unitLabel,
        stale: true
      }
    })
  }
  return list.length
}

/** 把 DB 所有行置为 stale=true（抓取失败时调用） */
export async function markAllStale(): Promise<number> {
  const result = await prisma.linduoModelPricing.updateMany({ data: { stale: true } })
  return result.count
}

/** 公开入口：抓取并持久化。失败时回退到兜底常量。 */
export async function scrapeAndPersist(options: ScrapeOptions = {}): Promise<ScrapeResult> {
  let cookies: Array<Record<string, unknown>> = []
  let loggedInJustNow = false
  const credentials = options.credentials ?? null

  // 1. 拿 cookie（必要时重新登录）
  if (credentials) {
    const { cookies: newCookies, expiresAt } = await loginAndSaveCookies(credentials.username, credentials.password)
    await saveLoginSession({
      username: credentials.username,
      password: credentials.password,
      cookies: newCookies,
      expiresAt
    })
    cookies = newCookies
    loggedInJustNow = true
  } else if (options.forceRelogin || (await needsRefresh())) {
    const { username, cookies: existingCookies } = await loadCookies()
    const password = await loadDecryptedPassword()
    if (username && password) {
      try {
        const { cookies: newCookies, expiresAt } = await loginAndSaveCookies(username, password)
        await saveLoginSession({ username, password, cookies: newCookies, expiresAt })
        cookies = newCookies
        loggedInJustNow = true
      } catch (err) {
        // 自动重登失败：仍尝试用旧 cookie
        cookies = existingCookies
        console.warn('[linduo-pricing] 自动重登失败，将使用旧 cookie 尝试一次：', err instanceof Error ? err.message : err)
      }
    } else {
      cookies = existingCookies
    }
  } else {
    const { cookies: existingCookies } = await loadCookies()
    cookies = existingCookies
  }

  if (cookies.length === 0) {
    // 没有任何 cookie：回退到兜底
    await persistFallback()
    return { items: fallbackPricingList(), fromFallback: true, loggedInJustNow: false }
  }

  try {
    const items = await scrapePricingPage(cookies)
    if (items.length === 0) {
      await persistFallback()
      return { items: fallbackPricingList(), fromFallback: true, loggedInJustNow }
    }
    await persistPricings(items)
    return { items, fromFallback: false, loggedInJustNow }
  } catch (err) {
    // 服务端明确拒绝 cookie（页面跳到 /login）：用加密保存的密码重登后再试一次
    const isCookieRejected = err instanceof Error && err.message.startsWith('COOKIE_REJECTED:')
    if (isCookieRejected && !options.forceRelogin) {
      const { username } = await loadCookies()
      const password = await loadDecryptedPassword()
      if (username && password && !options.credentials) {
        console.warn('[linduo-pricing] 抓取页跳转到登录页，使用保存的密码自动重登一次')
        try {
          const { cookies: refreshedCookies, expiresAt } = await loginAndSaveCookies(username, password)
          await saveLoginSession({ username, password, cookies: refreshedCookies, expiresAt })
          const retryItems = await scrapePricingPage(refreshedCookies)
          if (retryItems.length > 0) {
            await persistPricings(retryItems)
            return { items: retryItems, fromFallback: false, loggedInJustNow: true }
          }
        } catch (reloginErr) {
          console.error('[linduo-pricing] 自动重登后仍失败：', reloginErr instanceof Error ? reloginErr.message : reloginErr)
        }
      }
    }
    console.error('[linduo-pricing] 抓取失败，回退到兜底常量：', err instanceof Error ? err.message : err)
    await persistFallback()
    return { items: fallbackPricingList(), fromFallback: true, loggedInJustNow }
  }
}

/** 公开：仅首次登录（不抓取），供前端「保存」按钮调用 */
export async function loginOnly(username: string, password: string): Promise<{ ok: boolean; expiresAt: string | null; error?: string }> {
  try {
    const { cookies, expiresAt } = await loginAndSaveCookies(username, password)
    await saveLoginSession({ username, password, cookies, expiresAt })
    return { ok: true, expiresAt: expiresAt ? expiresAt.toISOString() : null }
  } catch (err) {
    return { ok: false, expiresAt: null, error: err instanceof Error ? err.message : '登录失败' }
  }
}
