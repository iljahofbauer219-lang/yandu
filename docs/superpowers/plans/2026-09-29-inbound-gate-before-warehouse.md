# 入库处理闸口前移 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让所有货源的选品审批通过后先落入货盘仓库「入库处理」待确认队列，编辑/确认后才双写正式入库与货盘存放，并提供单件退回操作。

**Architecture:** 复用本地 SQLite 表 `inbound_processing_items` 作唯一闸口队列（重建为 origin/source_id/selection_id/status/snapshot_json 结构）；闸口下沉到 `AppDatabase.updateSelectionDecision`；写通道 IPC 由主进程经服务器 `/api/erp/capabilities` 强校验 `erp.warehouse.edit`（60s 缓存、fail closed）。

**Tech Stack:** Electron 主进程（better-sqlite3）、React 渲染器、vitest、Playwright（tools 验收脚本）、node:sqlite（fixture）。

**Spec:** `docs/superpowers/specs/2026-09-29-inbound-gate-before-warehouse-design.md`

**通用约定：**
- 每任务结束跑 `npm run typecheck`（根目录）；涉及主进程逻辑的任务跑对应 vitest。
- 提交信息风格沿用仓库中文 conventional commits。
- 渲染器会话重试 helper `runWithSessionRetry` 在 Task 5 定义，Task 6/7 使用。

---

### Task 1: 契约类型（src/shared/contracts.ts）

**Files:**
- Modify: `src/shared/contracts.ts:1800-1836`（InboundSnapshotInput/InboundPatchInput/InboundProcessingItem 块）
- Modify: `src/shared/contracts.ts:1965-1969`（ComparisonPromotionResult）

- [ ] **Step 1: 替换入库队列类型块**

将 1800-1836 行整块替换为：

```ts
/** 入库处理：快照来源（选品审批 / 服务器采集池） */
export type InboundOrigin = 'SELECTION' | 'ERP'
export type InboundStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED'

/** 入库处理：入库快照（编辑=覆盖快照；目标仓/货位=warehouseCode+三级类目） */
export interface InboundSnapshot {
  platformCode: string
  warehouseCode: SupplyWarehouseCode
  itemCode: string
  title: string
  imageUrl: string
  priceText: string
  category: string
  subcategory: string
  tertiaryCategory: string
  sourceUrl: string
  tags: string[]
  collectedAt: string
}

/** 入库处理：待确认队列行（本地持久化，唯一闸口真源） */
export interface InboundProcessingItem {
  id: string
  origin: InboundOrigin
  sourceId: string
  selectionId: string
  status: InboundStatus
  snapshot: InboundSnapshot
  createdAt: string
  updatedAt: string
  confirmedAt: string | null
}

/** erp:intake 入参：服务器采集池快照 */
export interface InboundErpIntakeInput {
  sourceId: string
  snapshot: InboundSnapshot
}
```

- [ ] **Step 2: 替换 ComparisonPromotionResult**

```ts
export interface ComparisonPromotionResult {
  comparison: ComparisonRecordView
  selection: SelectionCatalogItem
  inboundItemId: string
}
```

- [ ] **Step 3: 类型检查（预期报错指向旧引用，Task 2-7 消除）**

Run: `npm run typecheck`
Expected: 报错集中在 AppDatabase/main/preload/PalletWarehousePage/App（旧类型引用），contracts 自身无错。

- [ ] **Step 4: 提交**

```bash
git add src/shared/contracts.ts
git commit -m "feat(contracts): 入库闸口队列类型重构——origin/status/snapshot 单一快照模型"
```

---

### Task 2: AppDatabase 表重建迁移 + 新读取映射（TDD）

**Files:**
- Modify: `src/main/database/AppDatabase.ts:848-870`（CREATE TABLE inbound_processing_items）
- Modify: `src/main/database/AppDatabase.ts:1319-1355`（ensureColumn 区块后挂迁移调用）
- Modify: `src/main/database/AppDatabase.ts:2737-2765`（listInbound/mapInboundRow/upsertInboundSnapshots）
- Test: `src/main/database/__tests__/AppDatabase.inboundGate.test.ts`（新建）

- [ ] **Step 1: 写失败测试——老库搬运**

新建 `src/main/database/__tests__/AppDatabase.inboundGate.test.ts`：

```ts
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', async () => {
  const os = await import('node:os')
  const nodePath = await import('node:path')
  const fs = await import('node:fs')
  ctx.dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'appdb-inbound-gate-'))
  return { app: { getPath: () => ctx.dir } }
})

async function seedLegacyInboundTable() {
  const { default: Database } = await import('better-sqlite3')
  const db = new Database(path.join(ctx.dir, 'sourcing-data.sqlite'))
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/main/database/__tests__/AppDatabase.inboundGate.test.ts`
Expected: FAIL（listInbound 仍返回旧平铺映射/表结构不匹配）。

- [ ] **Step 3: 改 schema CREATE TABLE 为新结构**

将 AppDatabase.ts 848-870 的 `CREATE TABLE IF NOT EXISTS inbound_processing_items (...)` 整块替换为：

```sql
      CREATE TABLE IF NOT EXISTS inbound_processing_items (
        id TEXT PRIMARY KEY,
        origin TEXT NOT NULL,
        source_id TEXT NOT NULL,
        selection_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'PENDING',
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmed_at TEXT
      );
```

（唯一索引在迁移方法内建，原因同 media_key：老库重建后才存在新列。）

- [ ] **Step 4: 加迁移方法并在构造函数挂载**

在 `ensureColumn('ebay_local_product_media', 'media_key', ...)` 回填块之后、`this.seedComplianceKnowledge()` 之前插入调用：

```ts
    this.migrateInboundProcessingQueue()
```

在 `migrateProductIntakeRegistry()` 方法附近新增：

```ts
  /** 入库闸口 v2：老平铺表重建为 (origin, source_id, selection_id, status, snapshot_json)，存量行按 origin=ERP 搬运 */
  private migrateInboundProcessingQueue() {
    const columns = this.database.prepare(`PRAGMA table_info(inbound_processing_items)`).all() as Array<{ name: string }>
    if (columns.some(item => item.name === 'snapshot_json')) {
      this.database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_origin_source ON inbound_processing_items(origin, source_id)`)
      return
    }
    this.database.exec(`
      CREATE TABLE inbound_processing_items_v2 (
        id TEXT PRIMARY KEY,
        origin TEXT NOT NULL,
        source_id TEXT NOT NULL,
        selection_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        confirmed_at TEXT
      );
      INSERT INTO inbound_processing_items_v2 (id, origin, source_id, selection_id, status, snapshot_json, created_at, updated_at, confirmed_at)
      SELECT id, 'ERP', erp_product_id, '', review_status, json_object(
        'platformCode', platform_code,
        'warehouseCode', CASE WHEN platform_code = 'GIGACLOUD' THEN 'GIGACLOUD' ELSE '1688' END,
        'itemCode', item_code,
        'title', CASE WHEN title_edit <> '' THEN title_edit ELSE title END,
        'imageUrl', image_url,
        'priceText', CASE WHEN price_edit <> '' THEN price_edit ELSE price_text END,
        'category', CASE WHEN category_edit <> '' THEN category_edit ELSE category END,
        'subcategory', CASE WHEN subcategory_edit <> '' THEN subcategory_edit ELSE subcategory END,
        'tertiaryCategory', CASE WHEN tertiary_edit <> '' THEN tertiary_edit ELSE tertiary_category END,
        'sourceUrl', source_url,
        'tags', json(tags),
        'collectedAt', collected_at
      ), created_at, updated_at, CASE WHEN review_status = 'CONFIRMED' THEN updated_at ELSE NULL END
      FROM inbound_processing_items;
      DROP TABLE inbound_processing_items;
      ALTER TABLE inbound_processing_items_v2 RENAME TO inbound_processing_items;
      CREATE UNIQUE INDEX uq_inbound_origin_source ON inbound_processing_items(origin, source_id);
    `)
  }
```

- [ ] **Step 5: 替换 listInbound/mapInboundRow，删除 upsertInboundSnapshots**

将 2737-2765 行（listInbound、mapInboundRow、upsertInboundSnapshots 三个方法）替换为：

```ts
  /** 入库处理：全状态队列（UI 侧筛选），按更新时间倒序 */
  listInbound(): InboundProcessingItem[] {
    const rows = this.database.prepare(`SELECT * FROM inbound_processing_items ORDER BY updated_at DESC`).all() as unknown as Array<Record<string, unknown>>
    return rows.map(row => this.mapInboundRow(row))
  }

  private mapInboundRow(row: Record<string, unknown>): InboundProcessingItem {
    return {
      id: String(row.id), origin: String(row.origin) as InboundProcessingItem['origin'], sourceId: String(row.source_id), selectionId: String(row.selection_id),
      status: String(row.status) as InboundProcessingItem['status'], snapshot: JSON.parse(String(row.snapshot_json)) as InboundSnapshot,
      createdAt: String(row.created_at), updatedAt: String(row.updated_at), confirmedAt: row.confirmed_at ? String(row.confirmed_at) : null
    }
  }
```

并在文件顶部 contracts import 中补 `InboundSnapshot`（替换已删除的 `InboundSnapshotInput`）。

- [ ] **Step 6: 运行测试确认通过**

Run: `npx vitest run src/main/database/__tests__/AppDatabase.inboundGate.test.ts`
Expected: PASS（搬运用例绿）。

- [ ] **Step 7: 提交**

```bash
git add src/main/database/AppDatabase.ts src/main/database/__tests__/AppDatabase.inboundGate.test.ts
git commit -m "feat(db): 入库闸口队列重建迁移——平铺列搬 origin/source_id/status/snapshot_json"
```

---

### Task 3: 队列操作 + 闸口下沉（TDD）

**Files:**
- Modify: `src/main/database/AppDatabase.ts`（updateSelectionDecision 2578-2590、promoteComparisonToWarehouse 2523-2535、启动回填 1354、patchInbound/confirmInbound/rejectInbound 2767-2802）
- Test: `src/main/database/__tests__/AppDatabase.inboundGate.test.ts`（追加 describe）

- [ ] **Step 1: 写失败测试——审批过闸、确认双写、退回、冻结、回填跳过**

在测试文件追加：

```ts
describe('入库闸口流转', () => {
  let db: AppDatabaseType
  beforeAll(async () => {
    AppDatabase = AppDatabase || (await import('../AppDatabase')).AppDatabase
    db = new AppDatabase()
  })

  function seedSelection(id: string, decision: string) {
    // 经公开 IPC 同构路径写入 selection_records：先以 PENDING payload 落库，再由 updateSelectionDecision 推进
    const payload = {
      id, taskId: 'task-1', sourceArea: 'SUPPLY', sourceUrl: `https://giga/${id}`, productId: 'P1', platformCode: 'GIGACLOUD',
      title: `闸口床 ${id}`, imageUrl: `https://giga/${id}.png`, priceText: '$10', score: 80, category: '家具', subcategory: '卧室家具', tertiaryCategory: '床架',
      decision, reason: '', recommendation: '', riskFlags: [], updatedAt: '2026-09-25T00:00:00.000Z'
    }
    db.importSelectionForTest(payload)
  }

  it('选品审批通过不再直写正式入库，而是落 PENDING 选品快照', () => {
    seedSelection('sel-1', 'PENDING')
    db.updateSelectionDecision('sel-1', 'APPROVED')
    expect(db.getSupplyWarehouseProducts().filter(item => item.selectionId === 'sel-1')).toHaveLength(0)
    const queue = db.listInbound().filter(item => item.sourceId === 'sel-1')
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ origin: 'SELECTION', sourceId: 'sel-1', selectionId: 'sel-1', status: 'PENDING' })
    expect(queue[0].snapshot.title).toBe('闸口床 sel-1')
    expect(queue[0].snapshot.warehouseCode).toBe('GIGACLOUD')
  })
```

（`seedSelection` 的落库实现：在 AppDatabase 上新增测试专用公开方法 `importSelectionForTest(payload)`，内部仅执行 selection_records 的 INSERT（与 importSelection 的写入列一致，去掉候选依赖）。在 Task 3 Step 4 的 AppDatabase 修改中一并加入：

```ts
  /** 测试专用：直接落 selection_records 行（绕开候选任务依赖） */
  importSelectionForTest(payload: SelectionCatalogItem): void {
    this.database.prepare(`INSERT INTO selection_records (id, task_id, ozon_url, comparison_id, decision, reason, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(payload.id, payload.taskId, payload.sourceUrl, null, payload.decision, payload.reason, JSON.stringify(payload), payload.updatedAt)
  }
```）

```ts
  it('确认入库双写正式入库与货盘存放，队列置 CONFIRMED', () => {
    seedSelection('sel-2', 'PENDING')
    db.updateSelectionDecision('sel-2', 'APPROVED')
    const queueId = db.listInbound().find(item => item.sourceId === 'sel-2')!.id
    db.confirmInbound(queueId)
    const warehouse = db.getSupplyWarehouseProducts().filter(item => item.selectionId === 'sel-2')
    expect(warehouse).toHaveLength(1)
    expect(warehouse[0]).toMatchObject({ warehouseCode: 'GIGACLOUD', status: 'ACTIVE', selectionId: 'sel-2' })
    const pallet = db.listPalletItems().filter(item => item.warehouseProductId === warehouse[0].id)
    expect(pallet).toHaveLength(1)
    expect(db.listInbound().find(item => item.sourceId === 'sel-2')!.status).toBe('CONFIRMED')
    expect(db.listInbound().find(item => item.sourceId === 'sel-2')!.confirmedAt).not.toBeNull()
  })

  it('已确认快照冻结：reedit 抛错', () => {
    seedSelection('sel-3', 'PENDING')
    db.updateSelectionDecision('sel-3', 'APPROVED')
    const item = db.listInbound().find(entry => entry.sourceId === 'sel-3')!
    db.confirmInbound(item.id)
    expect(() => db.reeditInbound(item.id, { ...item.snapshot, title: '改' })).toThrow('已确认商品请从正式入库退回后再修改')
  })

  it('退回入库处理：正式入库归档、货盘删除、队列回 PENDING', () => {
    seedSelection('sel-4', 'PENDING')
    db.updateSelectionDecision('sel-4', 'APPROVED')
    db.confirmInbound(db.listInbound().find(entry => entry.sourceId === 'sel-4')!.id)
    const warehouseId = db.getSupplyWarehouseProducts().find(item => item.selectionId === 'sel-4')!.id
    db.returnToInbound(warehouseId)
    expect(db.getSupplyWarehouseProducts().filter(item => item.selectionId === 'sel-4')).toHaveLength(0)
    expect(db.listPalletItems().filter(item => item.warehouseProductId === warehouseId)).toHaveLength(0)
    const back = db.listInbound().find(entry => entry.sourceId === 'sel-4')!
    expect(back).toMatchObject({ origin: 'SELECTION', sourceId: 'sel-4', status: 'PENDING' })
    expect(back.confirmedAt).toBeNull()
  })

  it('驳回不写任何库，重新编辑回 PENDING', () => {
    seedSelection('sel-5', 'PENDING')
    db.updateSelectionDecision('sel-5', 'APPROVED')
    const item = db.listInbound().find(entry => entry.sourceId === 'sel-5')!
    db.rejectInbound(item.id)
    expect(db.getSupplyWarehouseProducts().filter(entry => entry.selectionId === 'sel-5')).toHaveLength(0)
    expect(db.listInbound().find(entry => entry.sourceId === 'sel-5')!.status).toBe('REJECTED')
    db.reeditInbound(item.id, { ...item.snapshot, title: '复活' })
    const revived = db.listInbound().find(entry => entry.sourceId === 'sel-5')!
    expect(revived.status).toBe('PENDING')
    expect(revived.snapshot.title).toBe('复活')
  })

  it('启动回填跳过已有正式入库记录的 APPROVED 选品（存量豁免）', () => {
    seedSelection('sel-6', 'APPROVED')
    db.importWarehouseForTest('wh-6', 'sel-6')
    const reopened = new AppDatabase()
    expect(reopened.listInbound().filter(entry => entry.sourceId === 'sel-6')).toHaveLength(0)
  })
})
```

（`importWarehouseForTest(warehouseId, selectionId)` 同为测试专用公开方法，插入一条 ACTIVE 的 supply_warehouse_products 行（source_url 与 sel-6 payload 的 sourceUrl 一致以满足 UNIQUE）：

```ts
  /** 测试专用：直接落 ACTIVE 正式入库行 */
  importWarehouseForTest(id: string, selectionId: string): void {
    const now = new Date().toISOString()
    this.database.prepare(`INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, payload, created_at, updated_at)
      VALUES (?, 'GIGACLOUD', ?, ?, 'P1', '闸口床 ' || ?, '', '$10', '', '家具', '卧室家具', '床架', 'ACTIVE', '{}', ?, ?)`)
      .run(id, selectionId, `https://giga/${selectionId}`, selectionId, now, now)
  }
```）
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/main/database/__tests__/AppDatabase.inboundGate.test.ts`
Expected: FAIL（reeditInbound/returnToInbound 不存在、审批仍直写仓库）。

- [ ] **Step 3: 闸口下沉 updateSelectionDecision**

将 2585-2588 行：

```ts
    if (payload.sourceArea === 'SUPPLY' || payload.supplierUrl) {
      if (decision === 'APPROVED') this.upsertSupplyWarehouseProduct(payload)
      else this.database.prepare(`UPDATE supply_warehouse_products SET status = 'ARCHIVED', updated_at = ? WHERE selection_id = ?`).run(payload.updatedAt, payload.id)
    }
```

替换为：

```ts
    if (payload.sourceArea === 'SUPPLY' || payload.supplierUrl) {
      if (decision === 'APPROVED') this.upsertInboundFromSelection(payload)
      else this.database.prepare(`UPDATE supply_warehouse_products SET status = 'ARCHIVED', updated_at = ? WHERE selection_id = ?`).run(payload.updatedAt, payload.id)
    }
```

- [ ] **Step 4: 新增队列操作方法（替换 patchInbound/confirmInbound/rejectInbound 2767-2802）**

整块替换为：

```ts
  /** 选品审批过闸：APPROVED 不落正式入库，落 SELECTION 待确认快照 */
  private upsertInboundFromSelection(item: SelectionCatalogItem): InboundProcessingItem[] {
    const now = new Date().toISOString()
    const warehouseCode: SupplyWarehouseCode = item.platformCode === 'GIGACLOUD' ? 'GIGACLOUD' : '1688'
    const snapshot: InboundSnapshot = {
      platformCode: item.platformCode, warehouseCode, itemCode: item.productId, title: item.title, imageUrl: item.imageUrl, priceText: item.priceText,
      category: item.category, subcategory: item.subcategory, tertiaryCategory: item.tertiaryCategory,
      sourceUrl: item.supplierUrl || item.sourceUrl, tags: [], collectedAt: now
    }
    return this.upsertInboundRow({ origin: 'SELECTION', sourceId: item.id, selectionId: item.id, snapshot, now })
  }

  /** 建/刷新队列行；CONFIRMED 行冻结不覆盖 */
  private upsertInboundRow(input: { origin: InboundOrigin; sourceId: string; selectionId: string; snapshot: InboundSnapshot; now: string }): InboundProcessingItem[] {
    const existing = this.database.prepare(`SELECT id, status FROM inbound_processing_items WHERE origin = ? AND source_id = ?`).get(input.origin, input.sourceId) as { id: string; status: string } | undefined
    if (existing && existing.status === 'CONFIRMED') return this.listInbound()
    const snapshotJson = JSON.stringify(input.snapshot)
    if (existing) {
      this.database.prepare(`UPDATE inbound_processing_items SET selection_id = ?, status = 'PENDING', snapshot_json = ?, updated_at = ?, confirmed_at = NULL WHERE id = ?`)
        .run(input.selectionId, snapshotJson, input.now, existing.id)
    } else {
      this.database.prepare(`INSERT INTO inbound_processing_items (id, origin, source_id, selection_id, status, snapshot_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)`)
        .run(crypto.randomUUID(), input.origin, input.sourceId, input.selectionId, snapshotJson, input.now, input.now)
    }
    return this.listInbound()
  }

  /** 服务器采集池 intake（origin=ERP） */
  erpIntake(rows: InboundErpIntakeInput[]): InboundProcessingItem[] {
    const now = new Date().toISOString()
    for (const row of rows) this.upsertInboundRow({ origin: 'ERP', sourceId: row.sourceId, selectionId: '', snapshot: row.snapshot, now })
    return this.listInbound()
  }

  /** 重新编辑：覆盖快照回 PENDING；CONFIRMED 冻结 */
  reeditInbound(id: string, snapshot: InboundSnapshot): InboundProcessingItem[] {
    const row = this.database.prepare(`SELECT status FROM inbound_processing_items WHERE id = ?`).get(id) as { status: string } | undefined
    if (!row) throw new Error('待确认产品不存在')
    if (row.status === 'CONFIRMED') throw new Error('已确认商品请从正式入库退回后再修改')
    this.database.prepare(`UPDATE inbound_processing_items SET snapshot_json = ?, status = 'PENDING', updated_at = ?, confirmed_at = NULL WHERE id = ?`)
      .run(JSON.stringify(snapshot), new Date().toISOString(), id)
    return this.listInbound()
  }

  /** 审核确认：双写正式入库（ACTIVE）+ 货盘存放，队列置 CONFIRMED */
  confirmInbound(id: string): InboundProcessingItem[] {
    const row = this.database.prepare(`SELECT * FROM inbound_processing_items WHERE id = ?`).get(id) as Record<string, unknown> | undefined
    if (!row) throw new Error('待确认产品不存在')
    const item = this.mapInboundRow(row)
    if (item.status !== 'PENDING') throw new Error('仅待确认产品可确认入库')
    const now = new Date().toISOString()
    const snapshot = item.snapshot
    const existingWarehouse = this.database.prepare(`SELECT id FROM supply_warehouse_products WHERE warehouse_code = ? AND source_url = ?`).get(snapshot.warehouseCode, snapshot.sourceUrl) as { id: string } | undefined
    const warehouseId = existingWarehouse?.id || crypto.randomUUID()
    const payload = JSON.stringify(snapshot)
    this.database.prepare(`INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, payload, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, 'ACTIVE', ?, ?, ?)
      ON CONFLICT(warehouse_code, source_url) DO UPDATE SET selection_id=excluded.selection_id, product_id=excluded.product_id, title=excluded.title, image_url=excluded.image_url, price_text=excluded.price_text, category=excluded.category, subcategory=excluded.subcategory, tertiary_category=excluded.tertiary_category, status='ACTIVE', payload=excluded.payload, updated_at=excluded.updated_at`)
      .run(warehouseId, snapshot.warehouseCode, item.selectionId, snapshot.sourceUrl, snapshot.itemCode, snapshot.title, snapshot.imageUrl, snapshot.priceText, snapshot.category, snapshot.subcategory, snapshot.tertiaryCategory, payload, now, now)
    const palletExists = this.database.prepare(`SELECT 1 FROM pallet_warehouse_items WHERE warehouse_product_id = ? LIMIT 1`).get(warehouseId)
    if (!palletExists) {
      this.database.prepare(`INSERT INTO pallet_warehouse_items (id, warehouse_product_id, warehouse_code, item_code, title, image_url, price_text, category, subcategory, tertiary_category, source_url, stored_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(crypto.randomUUID(), warehouseId, snapshot.warehouseCode, snapshot.itemCode, snapshot.title, snapshot.imageUrl, snapshot.priceText, snapshot.category, snapshot.subcategory, snapshot.tertiaryCategory, snapshot.sourceUrl, now)
    }
    this.registerProductIntake(snapshot.warehouseCode, snapshot.itemCode, snapshot.sourceUrl, snapshot.title, 'WAREHOUSE', now)
    this.database.prepare(`UPDATE inbound_processing_items SET status = 'CONFIRMED', confirmed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id)
    return this.listInbound()
  }

  /** 审核驳回：置 REJECTED，不写任何库 */
  rejectInbound(id: string): InboundProcessingItem[] {
    this.database.prepare(`UPDATE inbound_processing_items SET status = 'REJECTED', updated_at = ? WHERE id = ?`).run(new Date().toISOString(), id)
    return this.listInbound()
  }

  /** 单件退回：正式入库归档 + 货盘删除 + 队列回 PENDING（含 CONFIRMED 重置） */
  returnToInbound(warehouseProductId: string): InboundProcessingItem[] {
    const row = this.database.prepare(`SELECT * FROM supply_warehouse_products WHERE id = ?`).get(warehouseProductId) as Record<string, unknown> | undefined
    if (!row || String(row.status) !== 'ACTIVE') throw new Error('正式入库商品不存在或已归档')
    const now = new Date().toISOString()
    const selectionId = String(row.selection_id || '')
    const origin: InboundOrigin = selectionId ? 'SELECTION' : 'ERP'
    const sourceId = selectionId || warehouseProductId
    const existing = this.database.prepare(`SELECT id, snapshot_json FROM inbound_processing_items WHERE origin = ? AND source_id = ?`).get(origin, sourceId) as { id: string; snapshot_json: string } | undefined
    const inheritTags = existing ? (JSON.parse(existing.snapshot_json) as InboundSnapshot).tags : []
    const snapshot: InboundSnapshot = {
      platformCode: String(row.warehouse_code), warehouseCode: String(row.warehouse_code) as SupplyWarehouseCode, itemCode: String(row.product_id),
      title: String(row.title), imageUrl: String(row.image_url), priceText: String(row.price_text),
      category: String(row.category), subcategory: String(row.subcategory), tertiaryCategory: String(row.tertiary_category),
      sourceUrl: String(row.source_url), tags: inheritTags, collectedAt: now
    }
    const snapshotJson = JSON.stringify(snapshot)
    if (existing) {
      this.database.prepare(`UPDATE inbound_processing_items SET selection_id = ?, status = 'PENDING', snapshot_json = ?, updated_at = ?, confirmed_at = NULL WHERE id = ?`)
        .run(selectionId, snapshotJson, now, existing.id)
    } else {
      this.database.prepare(`INSERT INTO inbound_processing_items (id, origin, source_id, selection_id, status, snapshot_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'PENDING', ?, ?, ?)`)
        .run(crypto.randomUUID(), origin, sourceId, selectionId, snapshotJson, now, now)
    }
    this.database.prepare(`UPDATE supply_warehouse_products SET status = 'ARCHIVED', updated_at = ? WHERE id = ?`).run(now, warehouseProductId)
    this.database.prepare(`DELETE FROM pallet_warehouse_items WHERE warehouse_product_id = ?`).run(warehouseProductId)
    return this.listInbound()
  }

  /** 测试专用：直接落 selection_records 行（绕开候选任务依赖） */
  importSelectionForTest(payload: SelectionCatalogItem): void {
    this.database.prepare(`INSERT INTO selection_records (id, task_id, ozon_url, comparison_id, decision, reason, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(payload.id, payload.taskId, payload.sourceUrl, null, payload.decision, payload.reason, JSON.stringify(payload), payload.updatedAt)
  }

  /** 测试专用：直接落 ACTIVE 正式入库行（source_url 与选品 payload 一致以满足 UNIQUE） */
  importWarehouseForTest(id: string, selectionId: string): void {
    const now = new Date().toISOString()
    this.database.prepare(`INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, payload, created_at, updated_at)
      VALUES (?, 'GIGACLOUD', ?, ?, 'P1', ?, '', '$10', '', '家具', '卧室家具', '床架', 'ACTIVE', '{}', ?, ?)`)
      .run(id, selectionId, `https://giga/${selectionId}`, `闸口床 ${selectionId}`, now, now)
  }
```

并在 contracts import 补 `InboundOrigin`、`InboundErpIntakeInput`。

- [ ] **Step 5: promoteComparisonToWarehouse 去除当场仓库依赖**

将 2531-2534 行：

```ts
    const warehouseProduct = this.getSupplyWarehouseProducts().find(item=>item.selectionId===selection.id)
    if (!warehouseProduct) throw new Error('供应仓商品生成失败')
    this.database.prepare(`INSERT INTO workflow_events (task_id, ozon_url, stage, action, detail, created_at) VALUES (?, ?, 'REVERSE_COMPARE', 'PROMOTE_TO_SUPPLY_WAREHOUSE', ?, ?)`).run(comparison.taskId,comparison.marketProduct.url,JSON.stringify({comparisonId:comparison.id,selectionId:selection.id,warehouseProductId:warehouseProduct.id,supplierUrl:primary.url,estimatedMargin:comparison.estimatedMargin}),new Date().toISOString())
    return {comparison:this.getComparisons().find(item=>item.id===request.id)!,selection,warehouseProduct}
```

替换为：

```ts
    const inboundItem = this.listInbound().find(item=>item.origin==='SELECTION'&&item.sourceId===selection.id)
    if (!inboundItem) throw new Error('入库处理队列条目生成失败')
    this.database.prepare(`INSERT INTO workflow_events (task_id, ozon_url, stage, action, detail, created_at) VALUES (?, ?, 'REVERSE_COMPARE', 'PROMOTE_TO_INBOUND', ?, ?)`).run(comparison.taskId,comparison.marketProduct.url,JSON.stringify({comparisonId:comparison.id,selectionId:selection.id,inboundItemId:inboundItem.id,supplierUrl:primary.url,estimatedMargin:comparison.estimatedMargin}),new Date().toISOString())
    return {comparison:this.getComparisons().find(item=>item.id===request.id)!,selection,inboundItemId:inboundItem.id}
```

- [ ] **Step 6: 启动回填加豁免条件**

将 1354 行：

```ts
    this.getSelectionCatalog().filter(item => item.decision === 'APPROVED' && (item.sourceArea === 'SUPPLY' || Boolean(item.supplierUrl))).forEach(item => this.upsertSupplyWarehouseProduct(item))
```

替换为：

```ts
    this.getSelectionCatalog()
      .filter(item => item.decision === 'APPROVED' && (item.sourceArea === 'SUPPLY' || Boolean(item.supplierUrl)))
      .forEach(item => {
        const warehoused = this.database.prepare(`SELECT 1 FROM supply_warehouse_products WHERE selection_id = ? LIMIT 1`).get(item.id)
        const queued = this.database.prepare(`SELECT 1 FROM inbound_processing_items WHERE origin = 'SELECTION' AND source_id = ? LIMIT 1`).get(item.id)
        if (!warehoused && !queued) this.upsertInboundFromSelection(item)
      })
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npx vitest run src/main/database/__tests__/AppDatabase.inboundGate.test.ts`
Expected: 全部 PASS。

- [ ] **Step 8: 提交**

```bash
git add src/main/database/AppDatabase.ts src/main/database/__tests__/AppDatabase.inboundGate.test.ts
git commit -m "feat(db): 入库闸口下沉——审批落待确认快照、确认双写、单件退回与存量豁免回填"
```

---

### Task 4: 主进程权限强校验服务（TDD）

**Files:**
- Create: `src/main/services/InboundPermissionGuard.ts`
- Test: `src/main/services/__tests__/inboundPermissionGuard.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/main/services/__tests__/inboundPermissionGuard.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearInboundPermissionCache, requireInboundEditPermission } from '../InboundPermissionGuard'

vi.mock('../../serverConfig', () => ({ readServerUrl: () => 'https://mock.invalid' }))

function mockFetchOnce(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => ({ status, ok: status >= 200 && status < 300, json: async () => body }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => { clearInboundPermissionCache(); vi.unstubAllGlobals() })

describe('入库写操作权限强校验', () => {
  it('canEdit=true 放行', async () => {
    mockFetchOnce(200, { canEdit: true })
    await expect(requireInboundEditPermission('tok')).resolves.toBeUndefined()
  })

  it('canEdit=false 抛语义化无权限错误', async () => {
    mockFetchOnce(200, { canEdit: false })
    await expect(requireInboundEditPermission('tok')).rejects.toThrow('无入库处理权限（需 erp.warehouse.edit）')
  })

  it('401 抛 SERVER_SESSION_EXPIRED', async () => {
    mockFetchOnce(401, {})
    await expect(requireInboundEditPermission('tok')).rejects.toThrow('SERVER_SESSION_EXPIRED')
  })

  it('网络不可达 fail closed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    await expect(requireInboundEditPermission('tok')).rejects.toThrow('权限校验失败，请检查网络后重试')
  })

  it('60s 缓存：连续两次只请求一次', async () => {
    const fetchMock = mockFetchOnce(200, { canEdit: true })
    await requireInboundEditPermission('tok')
    await requireInboundEditPermission('tok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('缺 token 直接拒绝', async () => {
    await expect(requireInboundEditPermission('')).rejects.toThrow('登录状态缺失，请重新登录后重试')
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/main/services/__tests__/inboundPermissionGuard.test.ts`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 实现 guard**

新建 `src/main/services/InboundPermissionGuard.ts`：

```ts
/**
 * 入库写操作的主进程权限强校验（spec §6.2）。
 * UI 隐藏不算验证：confirm/reject/reedit/return/erpIntake 执行前必须经服务器 capabilities 确认 erp.warehouse.edit。
 */
import { readServerUrl } from '../serverConfig'

const TTL_MS = 60_000
const cache = new Map<string, { canEdit: boolean; fetchedAt: number }>()

export function clearInboundPermissionCache(): void {
  cache.clear()
}

const NO_PERMISSION = '无入库处理权限（需 erp.warehouse.edit）'
const VERIFY_FAILED = '权限校验失败，请检查网络后重试'

export async function requireInboundEditPermission(accessToken: string): Promise<void> {
  if (!accessToken) throw new Error('登录状态缺失，请重新登录后重试')
  const fingerprint = accessToken.slice(-24)
  const hit = cache.get(fingerprint)
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
    if (!hit.canEdit) throw new Error(NO_PERMISSION)
    return
  }
  let canEdit: boolean
  try {
    const response = await fetch(`${readServerUrl()}/api/erp/capabilities`, { headers: { authorization: `Bearer ${accessToken}` } })
    if (response.status === 401) throw new Error('SERVER_SESSION_EXPIRED')
    if (response.status === 403) canEdit = false
    else if (!response.ok) throw new Error(VERIFY_FAILED)
    else canEdit = ((await response.json()) as { canEdit?: boolean }).canEdit === true
  } catch (error) {
    if (error instanceof Error && error.message === 'SERVER_SESSION_EXPIRED') throw error
    throw new Error(VERIFY_FAILED)
  }
  cache.set(fingerprint, { canEdit, fetchedAt: Date.now() })
  if (!canEdit) throw new Error(NO_PERMISSION)
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/main/services/__tests__/inboundPermissionGuard.test.ts`
Expected: 6 例全 PASS。

- [ ] **Step 5: 提交**

```bash
git add src/main/services/InboundPermissionGuard.ts src/main/services/__tests__/inboundPermissionGuard.test.ts
git commit -m "feat(auth): 入库写操作主进程强校验——capabilities 60s 缓存、fail closed、401 透传"
```

---

### Task 5: IPC / preload / 会话重试 helper 接线

**Files:**
- Modify: `src/main/main.ts:2595-2611`（inbound handlers）与 contracts import 行
- Modify: `src/preload/preload.ts:380-386`（inbound 块）
- Modify: `src/renderer/global.d.ts`（inbound 声明块，grep 定位）
- Modify: `src/renderer/serverApi.ts`（追加 runWithSessionRetry）

- [ ] **Step 1: serverApi 追加会话重试 helper**

先 `Read src/renderer/serverApi.ts` 确认现有导出，然后追加：

```ts
import { getTokens, refreshSession } from '../shared/serverHttp'

/** 写操作会话过期重试一次（与 handleWarehouseDownload 同模式） */
export async function runWithSessionRetry<T>(operation: (accessToken: string) => Promise<T>): Promise<T> {
  try {
    return await operation(getTokens()?.accessToken ?? '')
  } catch (reason) {
    if (!(reason instanceof Error) || reason.message !== 'SERVER_SESSION_EXPIRED') throw reason
    const refreshed = await refreshSession(getTokens()?.accessToken ?? '')
    if (!refreshed) throw new Error('登录会话已过期，请重新登录后重试')
    return operation(getTokens()?.accessToken ?? '')
  }
}
```

（若文件已从 shared/serverHttp 重导出 getTokens/refreshSession，复用现有 import，不重复。）

- [ ] **Step 2: main.ts 替换 inbound handlers**

将 2595-2611 行整块替换为：

```ts
ipcMain.handle('inbound:list', () => database?.listInbound() ?? [])
ipcMain.handle('erp:intake', async (_event, rows: InboundErpIntakeInput[], accessToken: string) => {
  if (!database) throw new Error('数据库尚未初始化')
  await requireInboundEditPermission(accessToken)
  return database.erpIntake(Array.isArray(rows) ? rows : [])
})
ipcMain.handle('inbound:reedit', async (_event, id: string, snapshot: InboundSnapshot, accessToken: string) => {
  if (!database) throw new Error('数据库尚未初始化')
  await requireInboundEditPermission(accessToken)
  return database.reeditInbound(id, snapshot)
})
ipcMain.handle('inbound:confirm', async (_event, id: string, accessToken: string) => {
  if (!database) throw new Error('数据库尚未初始化')
  await requireInboundEditPermission(accessToken)
  return database.confirmInbound(id)
})
ipcMain.handle('inbound:reject', async (_event, id: string, accessToken: string) => {
  if (!database) throw new Error('数据库尚未初始化')
  await requireInboundEditPermission(accessToken)
  return database.rejectInbound(id)
})
ipcMain.handle('inbound:return', async (_event, warehouseProductId: string, accessToken: string) => {
  if (!database) throw new Error('数据库尚未初始化')
  await requireInboundEditPermission(accessToken)
  return database.returnToInbound(warehouseProductId)
})
```

并在 main.ts 顶部：contracts import 中 `InboundSnapshotInput, InboundPatchInput` 替换为 `InboundSnapshot, InboundErpIntakeInput`；新增 `import { requireInboundEditPermission } from './services/InboundPermissionGuard'`。

- [ ] **Step 3: preload 替换 inbound 块**

将 preload.ts 380-386 的 `inbound: {...}` 块替换为：

```ts
  inbound: {
    list: (): Promise<InboundProcessingItem[]> => ipcRenderer.invoke('inbound:list'),
    erpIntake: (rows: InboundErpIntakeInput[], accessToken: string): Promise<InboundProcessingItem[]> => ipcRenderer.invoke('erp:intake', rows, accessToken),
    reedit: (id: string, snapshot: InboundSnapshot, accessToken: string): Promise<InboundProcessingItem[]> => ipcRenderer.invoke('inbound:reedit', id, snapshot, accessToken),
    confirm: (id: string, accessToken: string): Promise<InboundProcessingItem[]> => ipcRenderer.invoke('inbound:confirm', id, accessToken),
    reject: (id: string, accessToken: string): Promise<InboundProcessingItem[]> => ipcRenderer.invoke('inbound:reject', id, accessToken),
    return: (warehouseProductId: string, accessToken: string): Promise<InboundProcessingItem[]> => ipcRenderer.invoke('inbound:return', warehouseProductId, accessToken)
  },
```

同步 preload 顶部 contracts import（删 InboundSnapshotInput/InboundPatchInput，加 InboundSnapshot/InboundErpIntakeInput）。

- [ ] **Step 4: global.d.ts 同步声明**

Run: `grep -n "inbound:" src/renderer/global.d.ts` 定位声明块，将其替换为与 Step 3 相同的六个方法签名（类型从 contracts import，确认 import 行同步更新）。

- [ ] **Step 5: 类型检查**

Run: `npm run typecheck`
Expected: 仅剩 PalletWarehousePage/App 的旧调用报错（Task 6/7 消除）。

- [ ] **Step 6: 提交**

```bash
git add src/main/main.ts src/preload/preload.ts src/renderer/global.d.ts src/renderer/serverApi.ts
git commit -m "feat(ipc): 入库队列 IPC 重构——写通道带 token 强校验，新增 reedit/return/erpIntake"
```

---

### Task 6: 货盘仓库页入库处理 tab 重构

**Files:**
- Modify（整文件重写）: `src/renderer/erp/PalletWarehousePage.tsx`

- [ ] **Step 1: 用以下内容整文件替换 PalletWarehousePage.tsx**

```tsx
/**
 * 货盘仓库（ai-hub-warehouse 同级入口）：参照设计图三区布局。
 * 红区 = 顶部 9 Tab 筛选/操作栏（selection-module-nav warehouse-flow-nav）；
 * 蓝区 = 左侧产品目录树（catalog-panel）；黄区 = 右侧产品列表（candidate-catalog-main）。
 * 入库处理 tab = 本地待确认队列（inbound_processing_items）：选品审批与服务器采集池双 intake；
 * 确认入库双写正式入库与货盘存放（spec 2026-09-29-inbound-gate-before-warehouse）。
 */
import { useEffect, useMemo, useState } from 'react'
import { PanelCollapseButton, PanelExpandRail, usePanelCollapse } from '../panel-collapse'
import type { InboundProcessingItem, InboundSnapshot, PalletWarehouseItem } from '../../shared/contracts'
import { fetchErpCapabilities, fetchErpProducts, type ErpCapabilities } from './erpApi'
import { runWithSessionRetry } from '../serverApi'
import { MOCK_CATEGORIES, MOCK_TERTIARY_CATALOG } from './warehouseCatalogData'

const HUB_TABS = ['入库处理', '全部产品', '新品速递', '热销产品', '时节热品', '限时促销', '地区选品', '即将到货', '下架产品'] as const
type HubTab = (typeof HUB_TABS)[number]

// 已接入数据源的 Tab：入库处理（本地队列+服务器采集池同步）/ 全部产品 / 新品速递（入库 7 天内）；其余 Tab 暂无数据源
const DATA_READY_TABS: HubTab[] = ['入库处理', '全部产品', '新品速递']

const SEGMENTS = [
  { key: 'ALL', label: '全部商品' },
  { key: 'WAREHOUSE', label: '正式入库' },
  { key: 'KEYWORD', label: '关键词搜索' },
  { key: 'PRODUCT_URL', label: '单链接采集' },
  { key: 'CATEGORY_URL', label: '类目页采集' }
] as const

const INBOUND_FILTERS = [
  { key: 'PENDING', label: '待确认' },
  { key: 'CONFIRMED', label: '已确认' },
  { key: 'REJECTED', label: '已驳回' }
] as const
type InboundFilter = (typeof INBOUND_FILTERS)[number]['key']

const DAY_MS = 86400000

export function PalletWarehousePage({ onOpenSource, canEdit = false, onReturn }: {
  onOpenSource?: (item: PalletWarehouseItem) => void
  canEdit?: boolean
  onReturn?: (item: PalletWarehouseItem) => Promise<void> | void
}) {
  const catalogPanel = usePanelCollapse('pallet-catalog')
  const [hubTab, setHubTab] = useState<HubTab>('全部产品')
  const [selected, setSelected] = useState('ALL')
  const [expanded, setExpanded] = useState('')
  const [selectedSubcategory, setSelectedSubcategory] = useState('')
  const [segment, setSegment] = useState<'ALL' | 'WAREHOUSE' | 'KEYWORD' | 'PRODUCT_URL' | 'CATEGORY_URL'>('ALL')
  const [query, setQuery] = useState('')
  const [batchId, setBatchId] = useState('ALL')
  const [status, setStatus] = useState('ALL')
  const [batchMode, setBatchMode] = useState(false)
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set())
  const [items, setItems] = useState<PalletWarehouseItem[]>([])
  const [notice, setNotice] = useState('')
  const [inboundItems, setInboundItems] = useState<InboundProcessingItem[]>([])
  const [inboundFilter, setInboundFilter] = useState<InboundFilter>('PENDING')
  const [inboundNotice, setInboundNotice] = useState('')
  const [inboundOk, setInboundOk] = useState('')
  const [caps, setCaps] = useState<ErpCapabilities | null>(null)
  const [capsLoaded, setCapsLoaded] = useState(false)
  const [inboundTagDrafts, setInboundTagDrafts] = useState<Record<string, string>>({})
  const [inboundEdit, setInboundEdit] = useState<{ id: string; draft: InboundSnapshot } | null>(null)

  useEffect(() => {
    let alive = true
    window.desktop.pallet.list()
      .then(list => { if (alive) setItems(list) })
      .catch(reason => { if (alive) setNotice(reason instanceof Error ? reason.message : '货盘仓库加载失败') })
    return () => { alive = false }
  }, [])

  // ERP 能力摘要惰性加载：仅进入「入库处理」tab 才拉取；无 canEdit 不发起同步与队列加载
  useEffect(() => {
    if (hubTab !== '入库处理' || capsLoaded) return
    let alive = true
    fetchErpCapabilities()
      .then(result => { if (alive) setCaps(result) })
      .catch(reason => { if (alive) setInboundNotice(reason instanceof Error ? reason.message : 'ERP 能力摘要获取失败，无法校验入库处理权限') })
      .finally(() => { if (alive) setCapsLoaded(true) })
    return () => { alive = false }
  }, [hubTab, capsLoaded])

  const reloadInbound = () => window.desktop.inbound.list().then(setInboundItems).catch(reason => setInboundNotice(reason instanceof Error ? reason.message : '入库队列加载失败'))

  // 进入 tab 且具备 canEdit：先同步服务器采集池（COLLECTED）快照，再加载本地队列
  useEffect(() => {
    if (hubTab !== '入库处理' || !caps?.canEdit) return
    let alive = true
    fetchErpProducts({ status: 'COLLECTED', pageSize: 100 })
      .then(result => runWithSessionRetry(token => window.desktop.inbound.erpIntake(result.items.map(product => ({
        sourceId: product.id,
        snapshot: {
          platformCode: product.supplier?.code ?? '1688',
          warehouseCode: (product.supplier?.code ?? '1688') === 'GIGACLOUD' ? 'GIGACLOUD' : '1688',
          itemCode: product.sourceProductId || '',
          title: product.titleOriginal || '（无标题）',
          imageUrl: product.images?.[0]?.url || '',
          priceText: product.costPrice != null ? `${product.currency} ${product.costPrice}` : '',
          category: product.category || '',
          subcategory: '',
          tertiaryCategory: '',
          sourceUrl: product.sourceUrl || '',
          tags: [],
          collectedAt: product.createdAt
        }
      })), token)))
      .then(list => { if (alive) setInboundItems(list) })
      .catch(reason => { if (alive) { setInboundOk(''); setInboundNotice(reason instanceof Error ? reason.message : '入库处理同步失败'); void reloadInbound() } })
    return () => { alive = false }
  }, [hubTab, caps])

  const removeItems = (ids: string[]) => {
    if (!ids.length) return
    void window.desktop.pallet.remove(ids)
      .then(list => { setItems(list); setCheckedKeys(new Set()) })
      .catch(reason => setNotice(reason instanceof Error ? reason.message : '删除失败'))
  }

  const inboundVisible = useMemo(() => {
    const byStatus = inboundItems.filter(item => item.status === inboundFilter)
    const normalized = query.trim().toLocaleLowerCase()
    if (!normalized) return byStatus
    return byStatus.filter(item => `${item.snapshot.title} ${item.snapshot.itemCode}`.toLocaleLowerCase().includes(normalized))
  }, [inboundItems, inboundFilter, query])

  const patchSnapshot = (item: InboundProcessingItem, next: InboundSnapshot, okMessage: string) => {
    void runWithSessionRetry(token => window.desktop.inbound.reedit(item.id, next, token))
      .then(list => { setInboundItems(list); setInboundEdit(null); setInboundNotice(''); setInboundOk(okMessage) })
      .catch(reason => { setInboundOk(''); setInboundNotice(reason instanceof Error ? reason.message : '保存失败') })
  }

  const addInboundTag = (item: InboundProcessingItem) => {
    const value = (inboundTagDrafts[item.id] || '').trim()
    if (!value || item.snapshot.tags.includes(value)) return
    patchSnapshot(item, { ...item.snapshot, tags: [...item.snapshot.tags, value] }, '标签已补充')
    setInboundTagDrafts(current => ({ ...current, [item.id]: '' }))
  }

  const confirmInbound = (id: string) => {
    void runWithSessionRetry(token => window.desktop.inbound.confirm(id, token))
      .then(list => {
        setInboundItems(list)
        return window.desktop.pallet.list()
      })
      .then(list => { setItems(list); setInboundNotice(''); setInboundOk('已确认转入正式入库与货盘仓库') })
      .catch(reason => { setInboundOk(''); setInboundNotice(reason instanceof Error ? reason.message : '确认入库失败') })
  }

  const rejectInbound = (id: string) => {
    if (!window.confirm('确认驳回该产品？驳回后不写入正式入库与货盘仓库。')) return
    void runWithSessionRetry(token => window.desktop.inbound.reject(id, token))
      .then(list => { setInboundItems(list); setInboundNotice(''); setInboundOk('已驳回') })
      .catch(reason => { setInboundOk(''); setInboundNotice(reason instanceof Error ? reason.message : '驳回失败') })
  }

  const returnPalletItem = (item: PalletWarehouseItem) => {
    void Promise.resolve(onReturn?.(item))
      .then(() => window.desktop.pallet.list())
      .then(list => setItems(list))
      .catch(reason => setNotice(reason instanceof Error ? reason.message : '退回入库处理失败'))
  }

  const countCategory = (name: string) => items.filter(item => item.category === name).length
  const countSubcategory = (category: string, sub: string) => items.filter(item => item.category === category && item.subcategory === sub).length

  const visible = useMemo(() => {
    if (hubTab !== '全部产品' && hubTab !== '新品速递') return [] as PalletWarehouseItem[]
    const base = hubTab === '新品速递'
      ? items.filter(item => Date.now() - Date.parse(item.storedAt) <= 7 * DAY_MS).sort((a, b) => Date.parse(b.storedAt) - Date.parse(a.storedAt))
      : items
    const normalized = query.trim().toLocaleLowerCase()
    return base.filter(item => {
      if (segment !== 'ALL' && segment !== 'WAREHOUSE') return false
      if (selected !== 'ALL' && item.category !== selected && item.subcategory !== selected && item.tertiaryCategory !== selected) return false
      if (normalized && !`${item.title} ${item.itemCode}`.toLocaleLowerCase().includes(normalized)) return false
      return true
    })
  }, [items, hubTab, selected, query, segment])

  const toggleKey = (id: string) => setCheckedKeys(current => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const tertiaryOptions = useMemo(() => {
    if (!selectedSubcategory) return [] as { name: string; icon: string; count: number }[]
    return (MOCK_TERTIARY_CATALOG[selectedSubcategory] || []).map(option => ({ ...option, count: items.filter(item => item.tertiaryCategory === option.name).length }))
  }, [items, selectedSubcategory])

  return <>
    <div className="selection-module-nav warehouse-flow-nav">
      {HUB_TABS.map(tab => <button key={tab} className={hubTab === tab ? 'active' : ''} onClick={() => setHubTab(tab)}><span>{tab}</span></button>)}
    </div>
    <section className={`candidate-page${catalogPanel.collapsed?' side-collapsed':''}`}>
      {catalogPanel.collapsed?<PanelExpandRail panel={catalogPanel} label="产品目录库"/>:<aside className="catalog-panel collapsible-aside">
        <PanelCollapseButton panel={catalogPanel}/>
        <div className="catalog-heading"><small>PRODUCT CATALOG</small><h2>产品目录库</h2><p>大健云仓三级目录 · 支持人工调整</p></div>
        <button className={`catalog-all ${selected === 'ALL' ? 'active' : ''}`} onClick={() => { setSelected('ALL'); setSelectedSubcategory('') }}><span>全部产品</span><em>{items.length}</em></button>
        <div className="catalog-tree">
          {MOCK_CATEGORIES.map(group => {
            const open = expanded === group.name
            return <div className="catalog-group" key={group.name}>
              <button className={selected === group.name ? 'active' : ''} onClick={() => { setSelected(group.name); setExpanded(open ? '' : group.name); setSelectedSubcategory(open ? '' : group.children[0] || '') }}>
                <i>{open ? '⌄' : '›'}</i><span>{group.name}</span><em>{countCategory(group.name)}</em>
              </button>
              {open && <div>
                {group.children.map(child => <button key={child} className={selected === child ? 'active' : ''} onClick={() => { setSelected(child); setSelectedSubcategory(child) }}>
                  <span>{child}</span><em>{countSubcategory(group.name, child)}</em>
                </button>)}
              </div>}
            </div>
          })}
        </div>
        {selectedSubcategory && tertiaryOptions.length > 0 && <div className="tertiary-flyout">
          <div><small>LEVEL 3 CATEGORY</small><b>{selectedSubcategory}</b><button onClick={() => setSelectedSubcategory('')}>×</button></div>
          <div className="tertiary-icon-grid">
            {tertiaryOptions.map(option => <button key={option.name} className={selected === option.name ? 'active' : ''} onClick={() => { setSelected(option.name); setSelectedSubcategory('') }}>
              <i>{option.icon.endsWith('.png') ? <img src={option.icon} alt={option.name}/> : option.icon}</i><span>{option.name}</span><em>{option.count}</em>
            </button>)}
          </div>
        </div>}
      </aside>}
      <div className="candidate-catalog-main">
        <div className="warehouse-page-heading"><div><small>货盘仓库</small><div className="pallet-heading-title-row"><b>{hubTab === '入库处理' ? '入库处理 · 待确认队列' : '全部货源 · 已存放'}</b><em>{hubTab === '入库处理' ? inboundVisible.length : visible.length}</em></div></div><div className="pallet-heading-switch"><div className="candidate-view-switch">
          {SEGMENTS.map(item => <button key={item.key} className={segment === item.key ? 'active' : ''} onClick={() => setSegment(item.key)}>{item.label}</button>)}
        </div></div></div>
        <div className="candidate-filterbar">
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索商品标题、商品ID或供应商"/>
          <select value={batchId} onChange={event => setBatchId(event.target.value)}>
            <option value="ALL">全部采集批次</option>
          </select>
          <select value={status} onChange={event => setStatus(event.target.value)}>
            <option value="ALL">全部状态</option>
            <option value="SELECTED">AI已入选</option>
            <option value="REVIEW">待人工复核</option>
            <option value="DELETED">已删除</option>
          </select>
          <button className={batchMode ? 'active candidate-batch-toggle' : 'candidate-batch-toggle'} onClick={() => { setBatchMode(!batchMode); setCheckedKeys(new Set()) }}>{batchMode ? '退出批量' : '批量管理'}</button>
        </div>
        {batchMode && <div className="candidate-batchbar">
          <label><input type="checkbox" checked={visible.length > 0 && visible.every(item => checkedKeys.has(item.id))} onChange={event => setCheckedKeys(event.target.checked ? new Set(visible.map(item => item.id)) : new Set())}/>全选当前结果</label>
          <span>已选 <b>{checkedKeys.size}</b> 个</span>
          <button className="danger" disabled={!checkedKeys.size} onClick={() => removeItems([...checkedKeys])}>删除已选</button>
        </div>}
        {hubTab === '入库处理' && <div className="candidate-view-switch inbound-status-filter">
          {INBOUND_FILTERS.map(filter => <button key={filter.key} className={inboundFilter === filter.key ? 'active' : ''} onClick={() => setInboundFilter(filter.key)}>
            {filter.label} <em>{inboundItems.filter(item => item.status === filter.key).length}</em>
          </button>)}
        </div>}
        <div className="candidate-zone-summary">
          {hubTab === '入库处理' ? <>
            <span>待确认 <b>{inboundItems.filter(item => item.status === 'PENDING').length}</b></span>
            <span>采集源 <b>{new Set(inboundItems.map(item => item.snapshot.platformCode)).size}</b></span>
            <span>当前显示 <b>{inboundVisible.length}</b></span>
          </> : <>
            <span>货盘商品 <b>{items.length}</b></span>
            <span>采集批次 <b>—</b></span>
            <span>采集方式 <b>{items.length ? 1 : 0}</b></span>
            <span>当前显示 <b>{visible.length}</b></span>
          </>}
        </div>
        {inboundOk ? <div className="erp-banner erp-banner-ok">{inboundOk}</div> : null}
        {inboundNotice ? <div className="erp-banner erp-banner-error">{inboundNotice}</div> : null}
        {notice ? <div className="erp-banner erp-banner-error">{notice}</div> : null}
        {(hubTab === '全部产品' || hubTab === '新品速递') && segment !== 'ALL' && segment !== 'WAREHOUSE' ? (
          <div className="erp-banner erp-banner-info">采集方式「{SEGMENTS.find(item => item.key === segment)?.label ?? segment}」尚未接入数据源，列表已过滤为空；当前商品均来自入库处理确认。</div>
        ) : null}
        {hubTab === '入库处理' ? (
          caps !== null && !caps.canEdit ? (
            <div className="empty-state"><span>◎</span><h2>无入库处理权限</h2><p>当前账号缺少 ERP 仓库编辑权限（erp.warehouse.edit），无法同步采集池与确认入库，请联系管理员开通。</p></div>
          ) : inboundVisible.length === 0 ? <div className="empty-state"><span>◎</span><h2>暂无{INBOUND_FILTERS.find(filter => filter.key === inboundFilter)?.label}产品</h2><p>各货盘（1688、大健云仓等）选品审批通过或服务器采集池 COLLECTED 的原始产品会集中在这里待确认。</p></div> : (
          <div className="product-grid">
            {inboundVisible.map(item => {
              const snapshot = item.snapshot
              const edit = inboundEdit?.id === item.id ? inboundEdit.draft : null
              return (
              <article className="product-card candidate-product-card supply-source-card" key={item.id}>
                <button type="button" className="product-image" aria-label={`查看商品图片：${snapshot.title}`}>
                  {snapshot.imageUrl ? <img src={snapshot.imageUrl} alt={snapshot.title}/> : <span>无图</span>}
                </button>
                <div className="product-info supply-source-info">
                  <small>
                    <span className={`inbound-origin-badge ${item.origin === 'SELECTION' ? 'origin-selection' : 'origin-erp'}`}>{item.origin === 'SELECTION' ? '选品审批' : '服务器采集池'}</span>
                    {snapshot.platformCode === 'GIGACLOUD' ? '大健云仓' : snapshot.platformCode} · Item Code {snapshot.itemCode || '—'} · {INBOUND_FILTERS.find(filter => filter.key === item.status)?.label}
                  </small>
                  <b title={snapshot.title}>{snapshot.title}</b>
                  <strong>{snapshot.priceText || '价格待核验'}</strong>
                  <dl className="candidate-source-facts">
                    <div><dt>目标仓/货位</dt><dd title={`${snapshot.category} / ${snapshot.subcategory} / ${snapshot.tertiaryCategory}`}>{snapshot.warehouseCode} / {snapshot.category || '—'} / {snapshot.subcategory || '—'} / {snapshot.tertiaryCategory || '—'}</dd></div>
                    <div><dt>采集时间</dt><dd>{(snapshot.collectedAt || '').slice(0, 10) || '—'}</dd></div>
                    {item.status === 'REJECTED' && <div><dt>驳回时间</dt><dd>{(item.updatedAt || '').slice(0, 10)}</dd></div>}
                    {item.status === 'CONFIRMED' && <div><dt>确认时间</dt><dd>{(item.confirmedAt || '').slice(0, 10)}</dd></div>}
                  </dl>
                  {edit ? (
                    <div className="inbound-edit-form">
                      <label>标题<input value={edit.title} onChange={event => setInboundEdit({ id: item.id, draft: { ...edit, title: event.target.value } })}/></label>
                      <label>价格<input value={edit.priceText} onChange={event => setInboundEdit({ id: item.id, draft: { ...edit, priceText: event.target.value } })}/></label>
                      <label>目标仓<select value={edit.warehouseCode} onChange={event => setInboundEdit({ id: item.id, draft: { ...edit, warehouseCode: event.target.value as '1688' | 'GIGACLOUD' } })}>
                        <option value="1688">1688</option><option value="GIGACLOUD">大健云仓</option>
                      </select></label>
                      <label>一级类目<input value={edit.category} onChange={event => setInboundEdit({ id: item.id, draft: { ...edit, category: event.target.value } })}/></label>
                      <label>二级类目<input value={edit.subcategory} onChange={event => setInboundEdit({ id: item.id, draft: { ...edit, subcategory: event.target.value } })}/></label>
                      <label>三级类目<input value={edit.tertiaryCategory} onChange={event => setInboundEdit({ id: item.id, draft: { ...edit, tertiaryCategory: event.target.value } })}/></label>
                      <div className="product-actions candidate-next-actions"><button className="primary" onClick={() => patchSnapshot(item, edit, '已保存编辑')}>保存</button><button onClick={() => setInboundEdit(null)}>取消</button></div>
                    </div>
                  ) : (
                    <div className="product-tags">
                      {snapshot.tags.map(tag => <span key={tag}>{tag}</span>)}
                      {item.status !== 'CONFIRMED' && <>
                        <input className="inbound-tag-input" placeholder="补标签" value={inboundTagDrafts[item.id] || ''} onChange={event => setInboundTagDrafts(current => ({ ...current, [item.id]: event.target.value }))} onKeyDown={event => { if (event.key === 'Enter') addInboundTag(item) }}/>
                        <button type="button" onClick={() => addInboundTag(item)}>添加</button>
                      </>}
                    </div>
                  )}
                  <div className="product-actions candidate-next-actions">
                    {item.status === 'PENDING' && <>
                      <button onClick={() => setInboundEdit(edit ? null : { id: item.id, draft: { ...snapshot } })}>{edit ? '收起编辑' : '重新编辑'}</button>
                      <button className="primary" onClick={() => confirmInbound(item.id)}>确认入库</button>
                      <button className="candidate-delete" onClick={() => rejectInbound(item.id)}>驳回</button>
                    </>}
                    {item.status === 'REJECTED' && <button onClick={() => setInboundEdit({ id: item.id, draft: { ...snapshot } })}>重新编辑</button>}
                  </div>
                </div>
              </article>
              )
            })}
          </div>)
        ) : !DATA_READY_TABS.includes(hubTab) ? (
          <div className="empty-state"><span>◎</span><h2>{hubTab} · 即将上线</h2><p>该栏目暂未接入数据源，敬请期待；当前可使用「入库处理 / 全部产品 / 新品速递」。</p></div>
        ) : visible.length === 0 ? <div className="empty-state"><span>◎</span><h2>暂无货盘商品</h2><p>当前栏目或筛选条件下没有商品。产品经“入库处理”审核确认后转入这里。</p></div> : <div className="product-grid">
          {visible.map(item => <article className="product-card candidate-product-card supply-source-card" key={item.id}>
            <div className="candidate-card-tools">{batchMode ? <label title="选择商品"><input type="checkbox" checked={checkedKeys.has(item.id)} onChange={() => toggleKey(item.id)}/></label> : null}</div>
            <button type="button" className="product-image" aria-label={`查看商品图片：${item.title}`}>
              {item.imageUrl ? <img src={item.imageUrl} alt={item.title}/> : <span>无图</span>}
            </button>
            <div className="product-info supply-source-info">
              <small>{item.warehouseCode === 'GIGACLOUD' ? '大健云仓' : '1688'} · Item Code {item.itemCode || '—'} · 来源批次 —</small>
              <b title={item.title}>{item.title}</b>
              <strong>{item.priceText || '价格待核验'}</strong>
              <dl className="candidate-source-facts">
                <div><dt>物流费</dt><dd>待补采</dd></div>
                <div><dt>可售库存</dt><dd>待补采</dd></div>
                <div><dt>原始类目</dt><dd title={`${item.category} / ${item.subcategory} / ${item.tertiaryCategory}`}>{item.category} / {item.subcategory} / {item.tertiaryCategory}</dd></div>
                <div><dt>GIGA Index</dt><dd>—</dd></div>
              </dl>
              <div className="original-price">入库处理确认 · 正式入库并存放</div>
              <div className="product-tags"><span>入库确认</span></div>
              <div className="product-actions candidate-next-actions">
                <button onClick={() => onOpenSource?.(item)}>原址 <i>↗</i></button>
                {canEdit && <button onClick={() => returnPalletItem(item)}>退回入库处理</button>}
                <button className="candidate-delete" onClick={() => removeItems([item.id])}>删除</button>
              </div>
            </div>
          </article>)}
        </div>}
      </div>
    </section>
  </>
}
```

- [ ] **Step 2: 补来源徽标样式**

在渲染器全局样式（`src/renderer/styles/` 下货盘/候选相关 css，grep `candidate-product-card` 定位文件）追加：

```css
.inbound-origin-badge { display: inline-block; margin-right: 6px; padding: 1px 6px; border-radius: 999px; font-size: 11px; }
.inbound-origin-badge.origin-selection { background: color-mix(in srgb, var(--accent, #0d9488) 14%, transparent); color: var(--accent, #0d9488); }
.inbound-origin-badge.origin-erp { background: rgba(100, 116, 139, .14); color: #64748b; }
.inbound-status-filter { margin: 0 0 10px; }
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 仅剩 App.tsx 旧 props/调用报错。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/erp/PalletWarehousePage.tsx src/renderer/styles/
git commit -m "feat(ui): 货盘仓库入库处理 tab 重构——状态筛选、来源徽标、按状态操作与退回按钮"
```

---

### Task 7: App.tsx 反向流拆除 + 正式入库卡退回

**Files:**
- Modify: `src/renderer/App.tsx`（793/794 状态、912-913 effects、938-959 handleStorePallet、1715 props、1822 文案、1971/1976 组件）

- [ ] **Step 1: 删除反向流状态与 effects**

删除以下四段（grep 锚点确认行号）：

```ts
  const [palletKeys, setPalletKeys] = useState<Set<string>>(new Set())
```
```ts
  const [inboundPendingKeys, setInboundPendingKeys] = useState<Set<string>>(new Set())
```
```ts
  useEffect(() => { void window.desktop.pallet.list().then(items => setPalletKeys(new Set(items.map(item => item.warehouseProductId)))).catch(() => undefined) }, [])
  useEffect(() => { void window.desktop.inbound.list().then(items => setInboundPendingKeys(new Set(items.map(item => item.erpProductId)))).catch(() => undefined) }, [])
```

- [ ] **Step 2: handleStorePallet 替换为 canEdit + handleReturnToInbound**

将 938-959 的 `handleStorePallet` useCallback 整块替换为：

```ts
  const [erpCanEdit, setErpCanEdit] = useState(false)
  useEffect(() => {
    fetchErpCapabilities().then(caps => setErpCanEdit(caps.canEdit)).catch(() => setErpCanEdit(false))
  }, [])
  const handleReturnToInbound = useCallback(async (item: SupplyWarehouseProduct) => {
    if (!window.confirm(`确认将「${item.title}」退回入库处理？将同时从正式入库与货盘仓库移除。`)) return
    try {
      await runWithSessionRetry(token => window.desktop.inbound.return(item.id, token))
      reviewNotice(item.id, '已退回入库处理（待确认）')
      setWarehouseProducts(await window.desktop.warehouses.list())
    } catch (reason) {
      reviewNotice(item.id, reason instanceof Error ? reason.message : '退回入库处理失败')
    }
  }, [reviewNotice])
```

并在 import 区（`import { PalletWarehousePage } from './erp/PalletWarehousePage'` 行后）追加：

```ts
import { fetchErpCapabilities } from './erp/erpApi'
import { runWithSessionRetry } from './serverApi'
```

- [ ] **Step 3: 1715 行 props 接线替换**

在 1715 行内做两处子串替换：
- `palletKeys={palletKeys} inboundPendingKeys={inboundPendingKeys} ` → 删除（替换为空串）
- `onStorePallet={item=>void handleStorePallet(item)}` → `canEdit={erpCanEdit} onReturn={item=>void handleReturnToInbound(item)}`

- [ ] **Step 4: SupplyWarehouseWorkspace 签名与按钮替换**

将 1971 行签名中的 `palletKeys, inboundPendingKeys, notices, onDownload, onOpenDownload, onStorePallet }: { ... palletKeys: Set<string>; inboundPendingKeys: Set<string>; notices: Record<string, string>; onDownload: (product: SupplyWarehouseProduct) => void; onOpenDownload: (warehouseProductId: string) => void; onStorePallet: (product: SupplyWarehouseProduct) => void }` 替换为：

```ts
function SupplyWarehouseWorkspace({ products, warehouse, onOpenSelection, onOpenCatalog, onCreateImage, downloads, downloadingIds, canEdit, notices, onDownload, onOpenDownload, onReturn }: { products: SupplyWarehouseProduct[]; warehouse:SupplyWarehouseProduct['warehouseCode']; onOpenSelection: () => void; onOpenCatalog:()=>void; onCreateImage: (product: SupplyWarehouseProduct) => void; downloads: Record<string, SupplyProductDownload>; downloadingIds: Set<string>; canEdit: boolean; notices: Record<string, string>; onDownload: (product: SupplyWarehouseProduct) => void; onOpenDownload: (warehouseProductId: string) => void; onReturn: (product: SupplyWarehouseProduct) => void }) {
```

将 1976 行按钮组：

```tsx
<div><button disabled={downloadingIds.has(item.id)} onClick={()=>onDownload(item)}>{downloadingIds.has(item.id)?'下载中…':downloads[item.id]?.status==='DOWNLOADED'?'重新下载':downloads[item.id]?.status==='FAILED'?'下载失败·重试':'下载产品'}</button><button className="primary" disabled={palletKeys.has(item.id) || inboundPendingKeys.has(item.id)} onClick={()=>onStorePallet(item)}>{palletKeys.has(item.id)?'已正式入库':inboundPendingKeys.has(item.id)?'入库处理中':'送入库处理'}</button></div>
```

替换为：

```tsx
<div><button disabled={downloadingIds.has(item.id)} onClick={()=>onDownload(item)}>{downloadingIds.has(item.id)?'下载中…':downloads[item.id]?.status==='DOWNLOADED'?'重新下载':downloads[item.id]?.status==='FAILED'?'下载失败·重试':'下载产品'}</button>{canEdit&&<button onClick={()=>onReturn(item)}>退回入库处理</button>}</div>
```

- [ ] **Step 5: 比价提升成功文案更新（1822 行）**

`setMessage(`“${record.marketProduct.title}”已根据主货源进入供应仓。`)` → `setMessage(`“${record.marketProduct.title}”已送入入库处理待确认，请在货盘仓库「入库处理」确认。`)`

- [ ] **Step 6: PalletWarehousePage 调用补 props（1583 行）**

`<PalletWarehousePage onOpenSource={openPalletSource}/>` → `<PalletWarehousePage onOpenSource={openPalletSource} canEdit={erpCanEdit} onReturn={async item => { await runWithSessionRetry(token => window.desktop.inbound.return(item.warehouseProductId, token)) }}/>`

- [ ] **Step 7: 类型检查 + 全量单测**

Run: `npm run typecheck && npx vitest run src/main/database/__tests__/AppDatabase.inboundGate.test.ts src/main/services/__tests__/inboundPermissionGuard.test.ts`
Expected: typecheck 0 错；测试全绿。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/App.tsx
git commit -m "feat(ui): 拆除正式入库反向送审流，正式入库/货盘卡新增单件退回入库处理"
```

---

### Task 8: tools 验收脚本适配（本地 mock 服务器 + 新流转断言）

**Files:**
- Modify: `tools/fixture-seed-pallet-warehouse.cjs`
- Modify（重写流转段）: `tools/verify-warehouse-review-actions.cjs`
- Modify: `tools/verify-pallet-warehouse-ui.cjs`

背景：写通道 IPC 现在由**主进程**直连服务器校验权限，`page.route` 拦不到主进程 fetch；两脚本必须起本地 mock HTTP 服务器并把 `userData/server-config.json` 与渲染层 localStorage 都指向它。

- [ ] **Step 1: 两脚本共用 mock 服务器 helper**

在两个 verify 脚本顶部 require 区追加：

```js
const http = require('node:http')

function startMockServer(routes) {
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://local').pathname
    const body = routes[pathname]
    res.setHeader('content-type', 'application/json')
    if (!body) { res.statusCode = 404; res.end(JSON.stringify({ message: 'not mocked' })); return }
    res.end(JSON.stringify(body))
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}
```

- [ ] **Step 2: verify-warehouse-review-actions.cjs 换 mock 并写 server-config**

将现有 `await page.route('**/api/**', ...)` 块删除；在 `electron.launch` 之前插入：

```js
  const capabilities = { canViewSource: true, canCollect: true, canEdit: true, canPricing: true, canResolveChanges: true }
  const server = await startMockServer({
    '/api/auth/me': ownerProfile,
    '/api/erp/capabilities': capabilities,
    '/api/erp/products': { items: [], total: 0, page: 1, pageSize: 100 }
  })
  const mockUrl = `http://127.0.0.1:${server.address().port}`
  fs.writeFileSync(path.join(userDataDir, 'server-config.json'), JSON.stringify({ serverUrl: mockUrl }, null, 2))
```

并将 `page.evaluate` 中 localStorage 的 `sourcing.server-url:v1` 值改为 `mockUrl`（模板串）。脚本末尾 `finally` 中加 `server.close()`。

- [ ] **Step 3: verify-warehouse-review-actions.cjs 流转断言重写**

将「点击『货盘仓库』→ 复制存放」起的整段断言（从 `const downloadButton =` 到 reload 持久段结束）替换为：

```js
    const downloadButton = card.getByRole('button', { name: '下载产品', exact: true })
    const returnButton = card.getByRole('button', { name: '退回入库处理', exact: true })
    assert('按钮一文案为「下载产品」', await downloadButton.count() === 1)
    assert('按钮二文案为「退回入库处理」', await returnButton.count() === 1)

    page.on('dialog', dialog => dialog.accept())
    await returnButton.click()
    await page.waitForTimeout(800)
    const warehouseAfter = await page.evaluate(() => window.desktop.warehouses.list())
    assert('退回后正式入库列表为空（ARCHIVED）', Array.isArray(warehouseAfter) && warehouseAfter.length === 0)
    const inboundAfter = await page.evaluate(() => window.desktop.inbound.list())
    assert('退回后入库队列含 1 条 PENDING 选品快照', inboundAfter.length === 1 && inboundAfter[0].status === 'PENDING' && inboundAfter[0].origin === 'SELECTION')
    assert('快照标题继承正式入库', inboundAfter[0].snapshot.title === FIXTURE_TITLE)
    const palletAfter = await page.evaluate(() => window.desktop.pallet.list())
    assert('退回后货盘存放已删除', palletAfter.length === 0)

    // 入库处理 tab 再确认 → 双写恢复
    await page.locator('.sidebar').getByRole('button', { name: '货盘仓库', exact: true }).click()
    await page.waitForTimeout(800)
    await page.locator('.selection-module-nav.warehouse-flow-nav').getByRole('button', { name: '入库处理', exact: true }).click()
    await page.waitForTimeout(800)
    const inboundCard = page.locator('.product-card', { hasText: FIXTURE_TITLE })
    assert('入库处理待确认卡出现', await inboundCard.count() === 1)
    assert('来源徽标为选品审批', (await inboundCard.innerText()).includes('选品审批'))
    await inboundCard.getByRole('button', { name: '确认入库', exact: true }).click()
    await page.waitForTimeout(800)
    const warehouseBack = await page.evaluate(() => window.desktop.warehouses.list())
    const palletBack = await page.evaluate(() => window.desktop.pallet.list())
    assert('确认后正式入库恢复 1 条 ACTIVE', warehouseBack.length === 1 && warehouseBack[0].status === 'ACTIVE')
    assert('确认后货盘存放恢复 1 条', palletBack.length === 1 && palletBack[0].warehouseProductId === warehouseBack[0].id)
    await page.screenshot({ path: path.join(ARTIFACTS, '02-return-confirm-roundtrip.png') })
```

同步更新文件头注释：覆盖「退回入库处理 → 队列 PENDING → 确认双写恢复」闭环。

- [ ] **Step 4: verify-pallet-warehouse-ui.cjs 换 mock 服务器**

同 Step 2：删除 `page.route` 块，launch 前起 mock 服务器，routes 含 `/api/auth/me`、`/api/erp/capabilities`（canEdit true）、`/api/erp/products`（返回 ERP_COLLECTED_MOCK 包装 `{ items: ERP_COLLECTED_MOCK, total: 3, page: 1, pageSize: 100 }`）；写 `server-config.json`；localStorage server-url 改 mockUrl；finally 关服务器。

- [ ] **Step 5: verify-pallet-warehouse-ui.cjs 补双写断言**

在 449 行 `assert('确认入库后待确认余 2 卡', ...)` 之后插入：

```js
    const palletAfterConfirm = await page.evaluate(() => window.desktop.pallet.list())
    assert('确认入库双写货盘存放', palletAfterConfirm.some(entry => entry.title === '入库模拟产品 One'))
    const warehouseAfterConfirm = await page.evaluate(() => window.desktop.warehouses.list())
    assert('确认入库双写正式入库', warehouseAfterConfirm.some(entry => entry.title === '入库模拟产品 One' && entry.status === 'ACTIVE'))
```

- [ ] **Step 6: 跑两个验收脚本**

Run: `node tools/verify-warehouse-review-actions.cjs && node tools/verify-pallet-warehouse-ui.cjs`
Expected: 两脚本均 `失败 0 项` 退出码 0。

- [ ] **Step 7: 提交**

```bash
git add tools/fixture-seed-pallet-warehouse.cjs tools/verify-warehouse-review-actions.cjs tools/verify-pallet-warehouse-ui.cjs
git commit -m "test(tools): 入库闸口验收适配——本地 mock 服务器供主进程权限校验，退回/确认闭环断言"
```

---

### Task 9: 全量验证与收尾

- [ ] **Step 1: 类型检查 + 单测**

Run: `npm run typecheck && npx vitest run src/main/database src/main/services`
Expected: 0 错、全绿。

- [ ] **Step 2: 手动黄金路径（dev 应用，spec §7 第 1-7 条）**

Run: `npm run dev`，按 spec §7 手动验证清单逐条执行并记录截图：
1. 大健云仓采集→选品审批通过→正式入库无新增、入库处理出现「选品审批」徽标待确认卡；
2. 重新编辑保存仍待确认；
3. 确认入库→正式入库 ACTIVE + 货盘「全部产品」卡、队列卡转已确认只读；
4. 驳回→不写库；重新编辑回待确认；
5. 正式入库卡退回→两页消失、回待确认；再确认恢复双写；
6. 服务器采集池快照「服务器采集池」徽标入队、确认双写；
7. 重启不重复补快照。

- [ ] **Step 3: 权限路径验证（spec §7 第 8-11 条）**

用无 `erp.warehouse.edit` 账号登录 dev 应用：入库处理 tab 空状态、无退回按钮；控制台直调 `window.desktop.inbound.confirm(id, token)` 被拒且队列/两表无变化。OWNER 账号正常。断网点确认报「权限校验失败，请检查网络后重试」。

- [ ] **Step 4: 回归点核查**

- `comparison:promote` 不再抛「供应仓商品生成失败」（走 Task 3 Step 5 新返回）；
- 正式入库 tab 计数徽标（`warehouseCount`）只统计 ACTIVE，退回后即时减少；
- SupplyProductDownloadService 对 ARCHIVED 行的下载按既有报错「正式入库商品不存在或已归档」，无新崩溃。

- [ ] **Step 5: 收尾提交（如有遗留修正）**

```bash
git add -A src tools docs
git commit -m "chore(inbound-gate): 验收遗留修正"
```

---

## 验收标准汇总

| # | 标准 | 验证手段 |
|---|---|---|
| 1 | 选品审批通过不直写正式入库，落 PENDING 选品快照 | 单测「选品审批通过不再直写正式入库」+ 手动路径 1 |
| 2 | 确认入库双写正式入库 ACTIVE + 货盘存放，队列 CONFIRMED 冻结 | 单测 + 手动路径 3 + verify-pallet-warehouse-ui 双写断言 |
| 3 | 驳回不写库；重新编辑回 PENDING | 单测 + 手动路径 4 |
| 4 | 单件退回：正式入库归档 + 货盘删除 + 队列回 PENDING（含标签继承） | 单测 + verify-warehouse-review-actions 闭环 |
| 5 | 存量豁免：已有正式入库记录的 APPROVED 选品重启不补快照 | 单测 + 手动路径 7 |
| 6 | 写 IPC 无 canEdit 被主进程拒绝；401 透传刷新重试；断网 fail closed | guard 单测 6 例 + 手动路径 8-11 |
| 7 | 服务器采集池 intake 保持 origin=ERP 徽标与确认双写 | verify-pallet-warehouse-ui 入库处理段 |
| 8 | typecheck / vitest / 两验收脚本全绿 | Task 9 Step 1-2 命令 |
