import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

async function seedLegacyInboundTable() {
  const os = await import('node:os')
  const nodePath = await import('node:path')
  const fs = await import('node:fs')
  ctx.dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'appdb-inbound-gate-'))
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(path.join(ctx.dir, 'sourcing-data.sqlite'))
  db.exec(`
    CREATE TABLE inbound_processing_items (
      id TEXT PRIMARY KEY,
      erp_product_id TEXT NOT NULL UNIQUE,
      platform_code TEXT NOT NULL DEFAULT '',
      item_code TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      price_text TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      subcategory TEXT NOT NULL DEFAULT '',
      tertiary_category TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      collected_at TEXT NOT NULL DEFAULT '',
      title_edit TEXT NOT NULL DEFAULT '',
      price_edit TEXT NOT NULL DEFAULT '',
      category_edit TEXT NOT NULL DEFAULT '',
      subcategory_edit TEXT NOT NULL DEFAULT '',
      tertiary_edit TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      review_status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    INSERT INTO inbound_processing_items (id, erp_product_id, platform_code, item_code, title, image_url, price_text, category, subcategory, tertiary_category, source_url, collected_at, title_edit, tags, review_status, created_at, updated_at)
    VALUES ('legacy-1', 'erp-1', 'GIGACLOUD', 'C1', '老标题', '', '10', '家具', '', '', 'https://x/1', '2026-09-01T00:00:00.000Z', '改后标题', '["重点"]', 'CONFIRMED', '2026-09-01T00:00:00.000Z', '2026-09-02T00:00:00.000Z');
  `)
  db.close()
}

let AppDatabase: typeof AppDatabaseType

describe('入库闸口队列迁移', () => {
  beforeAll(async () => {
    await seedLegacyInboundTable()
    AppDatabase = (await import('../AppDatabase')).AppDatabase
  })

  it('老表平铺行搬运为 origin=ERP 快照行，编辑值覆盖原始值', () => {
    const db = new AppDatabase()
    const rows = db.listInbound()
    expect(rows).toHaveLength(1)
    expect(rows[0].origin).toBe('ERP')
    expect(rows[0].sourceId).toBe('erp-1')
    expect(rows[0].status).toBe('CONFIRMED')
    expect(rows[0].snapshot.title).toBe('改后标题')
    expect(rows[0].snapshot.warehouseCode).toBe('GIGACLOUD')
    expect(rows[0].snapshot.tags).toEqual(['重点'])
    expect(rows[0].confirmedAt).toBe('2026-09-02T00:00:00.000Z')
  })
})
