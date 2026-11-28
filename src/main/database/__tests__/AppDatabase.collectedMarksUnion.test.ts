import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({ app: { getPath: () => ctx.dir } }))

let db: AppDatabaseType

const URL_LIVE = 'https://www.gigab2b.com/index.php?route=product/product&product_id=1'
const URL_SELECTION = 'https://www.gigab2b.com/index.php?route=product/product&product_id=2'
const URL_WAREHOUSE = 'https://www.gigab2b.com/index.php?route=product/product&product_id=3'
const URL_HISTORY = 'https://www.gigab2b.com/index.php?route=product/product&product_id=4'
const URL_OTHER = 'https://www.1688.com/offer/9.html'

beforeAll(async () => {
  ctx.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appdb-collected-marks-'))
  const { DatabaseSync } = await import('node:sqlite')
  const { AppDatabase } = await import('../AppDatabase.js')
  db = new AppDatabase()
  const raw = new DatabaseSync(path.join(ctx.dir, 'sourcing-data.sqlite'))
  raw.exec(`
    INSERT INTO selection_tasks (id, payload, stage, created_at) VALUES ('task-marks', '{}', 'IDLE', '2026-11-28T00:00:00.000Z');
    INSERT INTO supply_candidates (task_id, url, payload, score, selected, sort_order, deleted_at)
      VALUES ('task-marks', '${URL_LIVE}', '{"platformCode":"GIGACLOUD","productId":"1"}', 0, 0, 0, NULL);
    INSERT INTO supply_candidates (task_id, url, payload, score, selected, sort_order, deleted_at)
      VALUES ('task-marks', '${URL_HISTORY}', '{"platformCode":"GIGACLOUD","productId":"4"}', 0, 0, 1, '2026-07-13T00:00:00.000Z');
    INSERT INTO supply_candidates (task_id, url, payload, score, selected, sort_order, deleted_at)
      VALUES ('task-marks', '${URL_OTHER}', '{"platformCode":"1688","productId":"9"}', 0, 0, 2, NULL);
    INSERT INTO selection_records (id, task_id, ozon_url, decision, payload, updated_at)
      VALUES ('sel-marks', 'task-marks', '${URL_SELECTION}', 'APPROVED', '{"platformCode":"GIGACLOUD","productId":"2","sourceUrl":"${URL_SELECTION}"}', '2026-11-28T00:00:00.000Z');
    INSERT INTO selection_records (id, task_id, ozon_url, decision, payload, updated_at)
      VALUES ('sel-wh', 'task-marks', '${URL_WAREHOUSE}', 'APPROVED', '{}', '2026-11-28T00:00:00.000Z');
    INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, status, created_at, updated_at)
      VALUES ('wh-marks', 'GIGACLOUD', 'sel-wh', '${URL_WAREHOUSE}', '3', 't', 'DELISTED', '2026-11-28T00:00:00.000Z', '2026-11-28T00:00:00.000Z');
    INSERT INTO product_intake_registry (identity_key, platform_code, product_id, canonical_url, title_snapshot, first_collected_at, last_seen_at, last_stage, candidate_deleted_at)
      VALUES ('GIGACLOUD:4', 'GIGACLOUD', '4', '${URL_HISTORY}', 't', '2026-07-01T00:00:00.000Z', '2026-07-13T00:00:00.000Z', 'HISTORY', '2026-07-13T00:00:00.000Z');
    INSERT INTO product_intake_registry (identity_key, platform_code, product_id, canonical_url, title_snapshot, first_collected_at, last_seen_at, last_stage, candidate_deleted_at)
      VALUES ('GIGACLOUD:URL:empty', 'GIGACLOUD', '', '', 't', '2026-07-01T00:00:00.000Z', '2026-07-01T00:00:00.000Z', 'HISTORY', NULL);
  `)
  raw.close()
})

describe('已采集标识 URL 集覆盖全部收录阶段', () => {
  it('提供 listCollectedSupplyUrls 方法', () => {
    expect(typeof (db as unknown as { listCollectedSupplyUrls?: unknown }).listCollectedSupplyUrls).toBe('function')
  })
  it('存活候选/优选/正式入库(含下架)/曾收录后删候选 四阶段并集去重', () => {
    const urls = db.listCollectedSupplyUrls('GIGACLOUD')
    expect([...urls].sort()).toEqual([URL_LIVE, URL_SELECTION, URL_WAREHOUSE, URL_HISTORY].sort())
  })
  it('不串平台且不收空 URL', () => {
    const urls = db.listCollectedSupplyUrls('GIGACLOUD')
    expect(urls).not.toContain(URL_OTHER)
    expect(urls).not.toContain('')
    expect(db.listCollectedSupplyUrls('1688')).toContain(URL_OTHER)
  })
  it('主进程红勾 provider 改接全阶段并集', () => {
    const main = readFileSync(path.resolve(process.cwd(), 'src/main/main.ts'), 'utf8')
    expect(main).toContain("database?.listCollectedSupplyUrls('GIGACLOUD')")
    expect(main).not.toContain('listCollectedCandidateUrls')
  })
})