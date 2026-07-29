import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { randomBytes, randomInt } from 'node:crypto'
import type { CollectorPluginImportResult, CollectorPluginProduct, CollectorPluginStatus } from '../../shared/contracts'

const PORT = 17321
const MAX_BODY_BYTES = 2 * 1024 * 1024

export class CollectorPluginBridge {
  private server: http.Server | null = null
  private readonly pairingCode = String(randomInt(100000, 1000000))
  private readonly tokenPath: string
  private token = ''
  private importedCount = 0

  constructor(
    userDataPath: string,
    private readonly extensionPath: string,
    private readonly importProducts: (products: CollectorPluginProduct[]) => CollectorPluginImportResult
  ) {
    this.tokenPath = path.join(userDataPath, 'collector-plugin-token')
    this.token = this.loadOrCreateToken()
  }

  async start() {
    if (this.server) return
    this.server = http.createServer((request, response) => void this.handle(request, response))
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(PORT, '127.0.0.1', () => resolve())
    })
  }

  async close() {
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>(resolve => server.close(() => resolve()))
  }

  status(): CollectorPluginStatus {
    return { running: Boolean(this.server?.listening), port: PORT, pairingCode: this.pairingCode, extensionPath: this.extensionPath, importedCount: this.importedCount }
  }

  private loadOrCreateToken() {
    try {
      const existing = fs.readFileSync(this.tokenPath, 'utf8').trim()
      if (existing.length >= 32) return existing
    } catch { /* first run */ }
    const token = randomBytes(32).toString('hex')
    fs.mkdirSync(path.dirname(this.tokenPath), { recursive: true })
    fs.writeFileSync(this.tokenPath, token, { mode: 0o600 })
    return token
  }

  private async handle(request: http.IncomingMessage, response: http.ServerResponse) {
    const origin = request.headers.origin || ''
    if (origin.startsWith('chrome-extension://')) response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    response.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (request.method === 'OPTIONS') return response.end()

    try {
      if (request.method === 'GET' && request.url === '/status') return this.send(response, 200, { running: true, paired: this.authorized(request) })
      if (request.method === 'POST' && request.url === '/pair') {
        const body = await this.readJson(request) as { code?: string }
        if (body.code !== this.pairingCode) return this.send(response, 403, { error: '配对码无效' })
        return this.send(response, 200, { token: this.token })
      }
      if (request.method === 'POST' && request.url === '/candidates') {
        if (!this.authorized(request)) return this.send(response, 401, { error: '插件尚未配对' })
        const body = await this.readJson(request) as { products?: unknown }
        if (!Array.isArray(body.products) || body.products.length < 1 || body.products.length > 100) return this.send(response, 400, { error: '商品数量必须为 1 至 100 个' })
        const products = body.products.map(item => this.validateProduct(item))
        const result = this.importProducts(products)
        this.importedCount += products.length
        return this.send(response, 200, result)
      }
      return this.send(response, 404, { error: '接口不存在' })
    } catch (error) {
      const message = error instanceof Error ? error.message : '采集插件请求处理失败'
      return this.send(response, message.includes('请求体') || message.includes('商品') ? 400 : 500, { error: message })
    }
  }

  private authorized(request: http.IncomingMessage) {
    return request.headers.authorization === `Bearer ${this.token}`
  }

  private readJson(request: http.IncomingMessage) {
    return new Promise<unknown>((resolve, reject) => {
      let size = 0
      const chunks: Buffer[] = []
      request.on('data', chunk => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          reject(new Error('请求体过大'))
          request.destroy()
          return
        }
        chunks.push(Buffer.from(chunk))
      })
      request.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')) }
        catch { reject(new Error('请求体不是有效 JSON')) }
      })
      request.on('error', reject)
    })
  }

  private validateProduct(value: unknown): CollectorPluginProduct {
    if (!value || typeof value !== 'object') throw new Error('商品数据格式无效')
    const item = value as Record<string, unknown>
    const platformCode = item.platformCode === '1688' ? '1688' : item.platformCode === 'GIGACLOUD' ? 'GIGACLOUD' : null
    if (!platformCode) throw new Error('暂不支持该采集平台')
    const url = String(item.url || '').trim()
    const parsed = new URL(url)
    const allowed = platformCode === 'GIGACLOUD' ? parsed.hostname === 'gigab2b.com' || parsed.hostname.endsWith('.gigab2b.com') : parsed.hostname === '1688.com' || parsed.hostname.endsWith('.1688.com')
    if (!allowed || parsed.protocol !== 'https:') throw new Error('商品链接与采集平台不匹配')
    const title = String(item.title || '').trim().slice(0, 500)
    if (!title) throw new Error('未识别到商品标题')
    return {
      platformCode,
      productId: String(item.productId || parsed.searchParams.get('product_id') || '').slice(0, 120),
      url: parsed.href,
      title,
      imageUrl: String(item.imageUrl || '').slice(0, 2000),
      priceText: String(item.priceText || '').slice(0, 120),
      salesText: String(item.salesText || '').slice(0, 120),
      shippingFeeText: String(item.shippingFeeText || '').slice(0, 120),
      sellableInventory: typeof item.sellableInventory === 'number' && Number.isFinite(item.sellableInventory) ? Math.max(0, Math.round(item.sellableInventory)) : null,
      promotionText: String(item.promotionText || '').slice(0, 80),
      supplierName: String(item.supplierName || '').slice(0, 300),
      gigaIndex: typeof item.gigaIndex === 'number' && Number.isFinite(item.gigaIndex) ? item.gigaIndex : null,
      storeReturnRate: String(item.storeReturnRate || '').slice(0, 80),
      capturedFrom: item.capturedFrom === 'LIST' ? 'LIST' : 'DETAIL'
    }
  }

  private send(response: http.ServerResponse, status: number, body: unknown) {
    response.statusCode = status
    response.end(JSON.stringify(body))
  }
}
