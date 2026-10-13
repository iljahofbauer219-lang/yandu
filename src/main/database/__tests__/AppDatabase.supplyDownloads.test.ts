import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

let db: AppDatabaseType

async function freshDatabase(): Promise<AppDatabaseType> {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-dl-total-'))
  const module = await import('../AppDatabase.js')
  return new module.AppDatabase()
}

const record = (estimatedTotal: string) => ({
  warehouseProductId: 'wp-total-1',
  pageId: 'page-1',
  pageUrl: 'https://mock.invalid/product-pages/x',
  imageCount: 3,
  failedCount: 0,
  status: 'DOWNLOADED' as const,
  error: '',
  estimatedTotal,
  downloadedAt: '2026-10-12T00:00:00.000Z'
})

describe('下载档案预估总额(含物流费)落库与补修', () => {
  afterEach(() => {
    if (ctx.dir) fs.rmSync(ctx.dir, { recursive: true, force: true })
  })

  it('下载建档写入预估总额并可读回', async () => {
    db = await freshDatabase()
    db.upsertSupplyDownload(record('$282.68 /件'))
    expect(db.listSupplyDownloads()[0]?.estimatedTotal).toBe('$282.68 /件')
    expect(db.getSupplyDownload('wp-total-1')?.estimatedTotal).toBe('$282.68 /件')
  })

  it('存量空值经补修写入口径可重读', async () => {
    db = await freshDatabase()
    db.upsertSupplyDownload(record(''))
    expect(db.listSupplyDownloads()[0]?.estimatedTotal).toBe('')
    db.setSupplyDownloadEstimatedTotal('wp-total-1', '$146.00 /件')
    expect(db.listSupplyDownloads()[0]?.estimatedTotal).toBe('$146.00 /件')
  })
})
