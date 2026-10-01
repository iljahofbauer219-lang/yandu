import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { MaxkbKnowledgeService as MaxkbKnowledgeServiceType } from '../MaxkbKnowledgeService'

/**
 * updateDoc / listDocs(progress) 的行为守卫。
 *
 * 两个此前静默失真的点：
 * 1) updateDoc 是「删旧 + 传新」，MaxKB 必然换 docId，但旧实现返回 Promise<void>，
 *    新 id 在函数内就被丢弃 → KbGuardian 软同步把已删除的旧 id 写回 hashes，
 *    孤儿清理再去删一个不存在的文档（见 KbGuardianService.softSync.test.ts）。
 * 2) parseProgress 算出了 aggs 的 total 却恒返回 100 → 解析中的文档在前端显示「已完成」。
 */

vi.mock('electron', async () => {
  const nodeOs = await import('node:os')
  const nodePath = await import('node:path')
  const fs = await import('node:fs')
  const dir = fs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'maxkb-doc-sync-test-'))
  return { app: { getPath: () => dir } }
})

let ServiceCtor: typeof MaxkbKnowledgeServiceType
let fetchCalls: Array<{ method: string; url: string }> = []
/** GET .../document 返回的文档列表（每个用例自行覆写） */
let rawDocs: Array<Record<string, unknown>> = []
/** POST 上传返回的新 docId 序列（按调用顺序取用） */
let uploadIds: string[] = []

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeAll(async () => {
  const mod = await import('../MaxkbKnowledgeService.js')
  ServiceCtor = mod.MaxkbKnowledgeService
})

beforeEach(() => {
  fetchCalls = []
  rawDocs = []
  uploadIds = ['doc-new']
  process.env.MAXKB_BASE_URL = 'http://maxkb.test'
  process.env.MAXKB_ADMIN_TOKEN = 'test-admin-token'
  process.env.MAXKB_KNOWLEDGE_DATASETS = 'kb-sourcing'
  vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string }) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    fetchCalls.push({ method, url })
    if (method === 'DELETE') return jsonResponse({ code: 200, message: 'ok', data: null })
    if (method === 'POST') {
      const id = uploadIds.shift() ?? 'doc-fallback'
      return jsonResponse({ code: 200, message: 'ok', data: [{ id, name: 'report.md' }] })
    }
    if (/\/document$/.test(url.split('?')[0])) return jsonResponse({ code: 200, message: 'ok', data: rawDocs })
    return jsonResponse({ code: 404, message: 'not found' }, 404)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function tempFile(name: string, content: string): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'maxkb-doc-sync-file-'))
  const file = path.join(dir, name)
  writeFileSync(file, content, 'utf8')
  return file
}

describe('MaxkbKnowledgeService.updateDoc', () => {
  it('返回重传后的新 docId，而不是把旧 id 留给调用方', async () => {
    uploadIds = ['doc-2nd']
    const service = new ServiceCtor()
    const newId = await service.updateDoc('kb-sourcing', 'doc-old', tempFile('report.md', '正文'))
    expect(newId).toBe('doc-2nd')
    // 先删旧文档，再上传新文档：顺序错了新 id 就不可信
    const methods = fetchCalls.map(call => call.method)
    expect(methods[0]).toBe('DELETE')
    expect(fetchCalls[0]?.url).toContain('/document/doc-old')
    expect(methods).toContain('POST')
  })

  it('上传未返回 docId 时抛错，不会把 undefined 当成功 id 交出去', async () => {
    uploadIds = []
    const service = new ServiceCtor()
    // 让 POST 返回空数组，模拟 MaxKB 上传失败
    vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string }) => {
      const method = init?.method ?? 'GET'
      fetchCalls.push({ method, url: String(input) })
      if (method === 'DELETE') return jsonResponse({ code: 200, message: 'ok', data: null })
      return jsonResponse({ code: 200, message: 'ok', data: [] })
    })
    await expect(service.updateDoc('kb-sourcing', 'doc-old', tempFile('report.md', '正文')))
      .rejects.toThrow(/未返回新 docId/)
  })
})

describe('MaxkbKnowledgeService.listDocs 解析进度', () => {
  const listProgress = async (statusMeta: unknown): Promise<number> => {
    rawDocs = [{ id: 'doc-1', name: 'report.md', status: 'nnn1', status_meta: statusMeta, char_length: 10, paragraph_count: 5 }]
    const view = await new ServiceCtor().listDocs('kb-sourcing')
    return view.docs[0]?.progress ?? -1
  }

  it('全部完成 → 100', async () => {
    expect(await listProgress({ aggs: [{ status: 'SUCCESS', count: 5 }] })).toBe(100)
  })

  it('解析中按已终结分片比例给真实进度（不再恒 100）', async () => {
    expect(await listProgress({ aggs: [{ status: 'SUCCESS', count: 3 }, { status: 'RUNNING', count: 2 }] })).toBe(60)
    expect(await listProgress({ aggs: [{ status: 'WAITING', count: 4 }] })).toBe(0)
  })

  it('失败分片算已终结：进度反映「跑完了」，成败由 run 字段表达', async () => {
    expect(await listProgress({ aggs: [{ status: 'FAIL', count: 1 }, { status: 'SUCCESS', count: 3 }] })).toBe(100)
  })

  it('无法识别的状态词一律视为已终结，避免换词表后就绪文档永久停在 0%', async () => {
    expect(await listProgress({ aggs: [{ status: 'SOMETHING_NEW', count: 2 }] })).toBe(100)
  })

  it('没有 aggs / 计数为 0 时沿用原口径', async () => {
    expect(await listProgress({})).toBe(100)
    expect(await listProgress({ aggs: [] })).toBe(100)
    expect(await listProgress({ aggs: [{ status: 'RUNNING', count: 0 }] })).toBe(0)
    expect(await listProgress(undefined)).toBe(0)
  })
})
