import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import type { AppDatabase as AppDatabaseType } from '../AppDatabase'

/**
 * 死表清理守卫（2026-09-29）。
 *
 * 客服工单域 support_*、本地知识库域 knowledge_*、AI 客服域 ai_support_* 共 14 张表
 * 长期只被 CREATE、零 INSERT/SELECT/UPDATE（客服与知识库能力实际跑在服务端 Postgres / MaxKB 上）。
 * 现已从建表 schema 中移除：新装不再建，老库残留表不删（DROP 一旦误判即不可逆数据丢失）。
 *
 * 同时守住「不能顺手删过头」：purchase_orders / reconciliation_records 仍被 getWorkflowCounts() 读取，
 * sales_orders / shipments 被保留表以外键引用，删了会在全新库留下悬空外键。
 */

const ctx = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', async () => {
  const nodeOs = await import('node:os')
  const nodePath = await import('node:path')
  const fs = await import('node:fs')
  ctx.dir = fs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'appdb-dead-tables-'))
  return { app: { getPath: () => ctx.dir } }
})

/** 已从建表 schema 移除的死表 */
const REMOVED_TABLES = [
  'support_channels', 'support_customers', 'support_customer_identities', 'support_conversations',
  'support_messages', 'support_attachments', 'support_tickets',
  'knowledge_documents', 'knowledge_document_versions', 'knowledge_chunks',
  'ai_support_runs', 'ai_support_replies', 'ai_support_tool_calls', 'ai_support_escalations'
]

/** 必须继续存在的表：仍被读取，或被保留表以外键引用 */
const RETAINED_TABLES = [
  'purchase_orders', 'reconciliation_records', 'sales_orders', 'shipments',
  'translation_glossary', 'supply_candidates', 'ebay_local_product_media'
]

let AppDatabaseCtor: typeof AppDatabaseType

function tableNames(database: AppDatabaseType): string[] {
  const sqlite = (database as unknown as {
    database: { prepare(statement: string): { all(...args: unknown[]): unknown[] } }
  }).database
  const rows = sqlite.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{ name: string }>
  return rows.map(row => row.name)
}

function query(database: AppDatabaseType, sql: string): Array<Record<string, unknown>> {
  const sqlite = (database as unknown as {
    database: { prepare(statement: string): { all(...args: unknown[]): unknown[] } }
  }).database
  return sqlite.prepare(sql).all() as Array<Record<string, unknown>>
}

beforeAll(async () => {
  await import('electron') // 触发 mock 工厂，填充 ctx.dir
  const module = await import('../AppDatabase.js')
  AppDatabaseCtor = module.AppDatabase
})

describe('AppDatabase 死表清理 · 全新安装', () => {
  it('不再创建 support_* / knowledge_* / ai_support_* 死表及其索引', () => {
    ctx.dir = mkdtempSync(path.join(os.tmpdir(), 'appdb-fresh-'))
    const database = new AppDatabaseCtor()
    const tables = tableNames(database)
    for (const table of REMOVED_TABLES) expect(tables, `新装不应再建 ${table}`).not.toContain(table)
    const indexes = query(database, `SELECT name FROM sqlite_master WHERE type='index'`).map(row => String(row.name))
    expect(indexes).not.toContain('idx_support_conversation_queue')
    expect(indexes).not.toContain('idx_support_message_conversation')
  })

  it('仍被读取/被外键引用的表照常创建，getWorkflowCounts 可用', () => {
    ctx.dir = mkdtempSync(path.join(os.tmpdir(), 'appdb-fresh-2-'))
    const database = new AppDatabaseCtor()
    const tables = tableNames(database)
    for (const table of RETAINED_TABLES) expect(tables, `新装必须仍建 ${table}`).toContain(table)
    // purchasing / reconciled 直接 COUNT purchase_orders / reconciliation_records：表被误删就会抛错
    expect(database.getWorkflowCounts()).toMatchObject({ purchasing: 0, reconciled: 0 })
  })
})

describe('AppDatabase 死表清理 · 老库升级', () => {
  it('残留的死表与其中的历史行原样保留（不做 DROP）', async () => {
    ctx.dir = mkdtempSync(path.join(os.tmpdir(), 'appdb-legacy-'))
    const { DatabaseSync } = await import('node:sqlite')
    const sqlite = new DatabaseSync(path.join(ctx.dir, 'sourcing-data.sqlite'))
    // 只建最小列集：这些表已无任何读写方，本用例只验证"不被删"
    sqlite.exec(`
      CREATE TABLE support_conversations (id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'OPEN');
      INSERT INTO support_conversations (id, status) VALUES ('legacy-conv', 'OPEN');
      CREATE TABLE knowledge_documents (id TEXT PRIMARY KEY, title TEXT NOT NULL);
      INSERT INTO knowledge_documents (id, title) VALUES ('legacy-doc', '旧知识库文档');
    `)
    sqlite.close()

    const database = new AppDatabaseCtor()
    const tables = tableNames(database)
    expect(tables).toContain('support_conversations')
    expect(tables).toContain('knowledge_documents')
    expect(query(database, `SELECT id FROM support_conversations`)).toEqual([{ id: 'legacy-conv' }])
    expect(query(database, `SELECT title FROM knowledge_documents`)).toEqual([{ title: '旧知识库文档' }])
  })
})
