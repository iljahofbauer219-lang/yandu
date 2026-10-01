import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { KbGuardianService as KbGuardianServiceType } from '../KbGuardianService'
import type { MaxkbKnowledgeService } from '../MaxkbKnowledgeService'

/**
 * 软同步 docId 写回守卫。
 *
 * MaxKB 没有「原地替换文档」的 API：updateDoc 的实现是删旧文档 + 上传新文档，docId 必然变化。
 * 旧实现 updateDoc 返回 void、新 id 在函数内被丢弃，updateAndParse 拿旧 id 去 parseDocs/waitParse
 * → waitParse 报「解析中文档丢失」→ 触发 I.7 硬回退再传一次，于是每次软同步都：
 *   ① 在 KB 里泄漏一个没人记录的文档（旧实现删不到它）；
 *   ② 让 fallbackToHard 恒为 1，软同步形同虚设。
 * 本测试用「只认活文档」的假 KB 复刻这条链路。
 */

vi.mock('electron', async () => {
  const nodeOs = await import('node:os')
  const nodePath = await import('node:path')
  const fs = await import('node:fs')
  const dir = fs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'kb-guardian-soft-sync-'))
  return {
    app: { getPath: () => dir },
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) }
  }
})

let GuardianCtor: typeof KbGuardianServiceType
let userDataDir = ''

/** 假 MaxKB：live 集合是唯一的真相来源，listDocs 只返回活文档（与真实服务端一致） */
function createFakeKb() {
  const live = new Set<string>()
  const deleted: string[] = []
  const uploaded: string[] = []
  let sequence = 0
  const nextId = () => {
    sequence += 1
    const id = `doc-${sequence}`
    live.add(id)
    return id
  }
  const kb = {
    async createCategory() { /* 本用例不声明 ensureCategories */ },
    async uploadDocs(_kbId: string, filePaths: string[]) {
      uploaded.push(...filePaths)
      return [nextId()]
    },
    async deleteDocs(_kbId: string, docIds: string[]) {
      for (const docId of docIds) {
        deleted.push(docId)
        live.delete(docId)
      }
    },
    async parseDocs() { /* MaxKB v2 自动解析：noop */ },
    async updateDoc(_kbId: string, docId: string, _filePath: string) {
      // 复刻真实语义：删旧 + 传新 → 返回新 id
      live.delete(docId)
      return nextId()
    },
    async listDocs() {
      return { docs: [...live].map(id => ({ id, name: 'x', size: 1, chunkCount: 1, run: 'DONE', progress: 100, createDate: '', updateDate: '', category: '' })), categories: [] }
    }
  }
  return { kb: kb as unknown as MaxkbKnowledgeService, live, deleted, uploaded }
}

function persistFile(): string {
  return path.join(userDataDir, 'kb-guardian-skills.json')
}

type Persisted = { hashes: Record<string, Record<string, { hash: string; docId: string }>> }

function readHashes(): Persisted['hashes'] {
  return (JSON.parse(readFileSync(persistFile(), 'utf8')) as Persisted).hashes
}

beforeAll(async () => {
  const mod = await import('../KbGuardianService.js')
  GuardianCtor = mod.KbGuardianService
  const { app } = await import('electron')
  userDataDir = app.getPath('userData')
})

let sourceDir = ''

beforeEach(() => {
  sourceDir = mkdtempSync(path.join(os.tmpdir(), 'kb-guardian-source-'))
})

/** 跑一次守卫并等队列排空（enqueueRun 是链式排队，queue 字段即当前队尾） */
async function runOnce(guardian: KbGuardianServiceType, skillId: string) {
  const queued = await guardian.runNow(skillId)
  expect(queued.queued).toBe(true)
  await (guardian as unknown as { queue: Promise<unknown> }).queue
}

async function createGuardianSkill(fake: ReturnType<typeof createFakeKb>, syncMode: 'soft' | 'hard') {
  const guardian = new GuardianCtor(fake.kb, () => undefined)
  const skill = await guardian.createSkill({
    name: `软同步用例-${syncMode}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sourcePath: sourceDir,
    fileExts: ['.md'],
    targetKbId: 'kb-sourcing',
    targetKbName: '选品分析师知识库',
    frequency: 'manual',
    enabled: true,
    syncMode
  })
  return { guardian, skill }
}

describe('KbGuardianService 软同步 docId 写回', () => {
  it('内容变化后软同步把「新 docId」写回 hashes，且不触发硬回退', async () => {
    const fake = createFakeKb()
    writeFileSync(path.join(sourceDir, 'report.md'), '第一版正文', 'utf8')
    const { guardian, skill } = await createGuardianSkill(fake, 'soft')

    await runOnce(guardian, skill.id)
    expect(readHashes()[skill.id]?.['report.md']?.docId).toBe('doc-1')

    // 改内容 → hash 变化 → 走软同步替换
    writeFileSync(path.join(sourceDir, 'report.md'), '第二版正文（更长）', 'utf8')
    await runOnce(guardian, skill.id)

    const entry = readHashes()[skill.id]?.['report.md']
    expect(entry?.docId).toBe('doc-2')
    // KB 里只剩这一个活文档：没有因为盯着旧 id 而泄漏 doc-2 / 重传 doc-3
    expect([...fake.live]).toEqual(['doc-2'])
    const state = await guardian.state()
    const stats = state.skills.find(item => item.id === skill.id)?.lastStats
    expect(stats).toMatchObject({ added: 0, updated: 1, skipped: 0, failed: 0, fallbackToHard: 0 })
    const log = state.logs.find(item => item.skillId === skill.id)
    expect(log?.failures).toEqual([])
  })

  it('孤儿清理删的是写回后的新 docId，不是已被替换掉的旧 id', async () => {
    const fake = createFakeKb()
    writeFileSync(path.join(sourceDir, 'report.md'), '第一版正文', 'utf8')
    const { guardian, skill } = await createGuardianSkill(fake, 'soft')
    await runOnce(guardian, skill.id)
    writeFileSync(path.join(sourceDir, 'report.md'), '第二版正文（更长）', 'utf8')
    await runOnce(guardian, skill.id)
    expect(readHashes()[skill.id]?.['report.md']?.docId).toBe('doc-2')

    // 源文件被删 → 下一轮孤儿清理必须命中 doc-2
    rmSync(path.join(sourceDir, 'report.md'))
    await runOnce(guardian, skill.id)

    expect(fake.deleted).toContain('doc-2')
    expect(fake.live.size).toBe(0)
    expect(readHashes()[skill.id]).toEqual({})
    const state = await guardian.state()
    expect(state.skills.find(item => item.id === skill.id)?.lastStats?.orphansRemoved).toBe(1)
  })

  it('hash 未变时跳过，不动 KB 也不改 hashes', async () => {
    const fake = createFakeKb()
    writeFileSync(path.join(sourceDir, 'report.md'), '正文不变', 'utf8')
    const { guardian, skill } = await createGuardianSkill(fake, 'soft')
    await runOnce(guardian, skill.id)
    await runOnce(guardian, skill.id)
    expect(readHashes()[skill.id]?.['report.md']?.docId).toBe('doc-1')
    expect([...fake.live]).toEqual(['doc-1'])
    const state = await guardian.state()
    expect(state.skills.find(item => item.id === skill.id)?.lastStats).toMatchObject({ added: 0, updated: 0, skipped: 1 })
  })
})
