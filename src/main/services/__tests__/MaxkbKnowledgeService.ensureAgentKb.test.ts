import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MaxkbKnowledgeService as MaxkbKnowledgeServiceType } from '../MaxkbKnowledgeService'
import { SAMPLE_LIBRARY_KB_TARGET } from '../../../shared/sampleLibraryKbIngest'

/**
 * ensureAgentKb 的行为守卫。
 *
 * 背景：MaxKB v2.10.5-lts CE 的 admin API 不支持建库，此前 ensureAgentKb 无条件抛
 * ERR_KB_ENSURE_UNSUPPORTED，而 SampleLibraryKbIngestor.preview/ingest 与
 * SampleLibraryKbGuardianLauncher.ensure 都以它为第一步 → 样本库一键入库与预置守卫必然失败。
 * 现在改为从 .env.local 的 MAXKB_KNOWLEDGE_DATASETS 已声明的库里按名称归类解析。
 */

vi.mock('electron', async () => {
  const os = await import('node:os')
  const nodePath = await import('node:path')
  const fs = await import('node:fs')
  const dir = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'maxkb-kb-test-'))
  return { app: { getPath: () => dir } }
})

/** 模拟 MaxKB 里已存在的知识库（id → 库名）。库名决定它被归类到哪个智能体 */
const KB_NAMES: Record<string, string> = {
  'kb-sourcing': '选品分析师知识库',
  'kb-listing': 'Listing精造师知识库',
  'kb-misc': '杂项资料库'
}

let ServiceCtor: typeof MaxkbKnowledgeServiceType
let fetchCalls: Array<{ method: string; url: string }> = []

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

beforeAll(async () => {
  const mod = await import('../MaxkbKnowledgeService.js')
  ServiceCtor = mod.MaxkbKnowledgeService
})

beforeEach(() => {
  fetchCalls = []
  process.env.MAXKB_BASE_URL = 'http://maxkb.test'
  process.env.MAXKB_ADMIN_TOKEN = 'test-admin-token'
  process.env.MAXKB_KNOWLEDGE_DATASETS = 'kb-sourcing,kb-listing,kb-misc'
  vi.stubGlobal('fetch', async (input: unknown, init?: { method?: string }) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    fetchCalls.push({ method, url })
    const match = url.match(/\/admin\/api\/workspace\/default\/knowledge\/([^/?]+)/)
    if (match && method === 'GET') {
      const name = KB_NAMES[match[1]]
      if (name) {
        return jsonResponse({
          code: 200,
          message: 'ok',
          data: { id: match[1], name, desc: '', document_count: 3, update_time: '2026-09-28T00:00:00Z' }
        })
      }
    }
    return jsonResponse({ code: 404, message: 'not found' }, 404)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MaxkbKnowledgeService.ensureAgentKb', () => {
  it('按库名归类解析出智能体对应的 KB（不再抛"不支持"）', async () => {
    const service = new ServiceCtor()
    const kb = await service.ensureAgentKb('sourcing')
    expect(kb.id).toBe('kb-sourcing')
    expect(kb.name).toBe('选品分析师知识库')
    expect(kb.agentKey).toBe('sourcing')
    expect(kb.category).toBe('agent')
  })

  it('解析结果与 list() 的智能体槽位一致（单一解析口径）', async () => {
    const service = new ServiceCtor()
    const listed = (await service.list()).agents.find(slot => slot.key === 'listing')?.kb
    const ensured = await new ServiceCtor().ensureAgentKb('listing')
    expect(listed?.id).toBe('kb-listing')
    expect(ensured.id).toBe(listed?.id)
  })

  it('样本库入库的目标智能体（sourcing）可解析 —— 即被堵死的链路已打通', async () => {
    expect(SAMPLE_LIBRARY_KB_TARGET.agentKey).toBe('sourcing')
    const kb = await new ServiceCtor().ensureAgentKb(SAMPLE_LIBRARY_KB_TARGET.agentKey)
    expect(kb.id).toBe('kb-sourcing')
  })

  it('目标智能体的库未声明时，抛出含库名规则与配置指引的可操作错误', async () => {
    process.env.MAXKB_KNOWLEDGE_DATASETS = 'kb-sourcing,kb-misc'
    const service = new ServiceCtor()
    await expect(service.ensureAgentKb('compliance')).rejects.toThrow(/AI合规顾问/)
    await expect(new ServiceCtor().ensureAgentKb('compliance')).rejects.toThrow(/MAXKB_KNOWLEDGE_DATASETS/)
    await expect(new ServiceCtor().ensureAgentKb('compliance')).rejects.toThrow(/重启应用/)
  })

  it('未配置 MAXKB_KNOWLEDGE_DATASETS 时给出专门的配置指引', async () => {
    process.env.MAXKB_KNOWLEDGE_DATASETS = ''
    const service = new ServiceCtor()
    await expect(service.ensureAgentKb('sourcing')).rejects.toThrow(/未配置 MAXKB_KNOWLEDGE_DATASETS/)
    expect(fetchCalls).toHaveLength(0)
  })

  it('未知智能体键直接报错，不发任何请求', async () => {
    const service = new ServiceCtor()
    await expect(service.ensureAgentKb('nonexistent' as never)).rejects.toThrow(/未知的智能体键/)
    expect(fetchCalls).toHaveLength(0)
  })

  it('声明了库但一个都读不到时，报"拉取失败"而不是误导性的"库名不匹配"', async () => {
    // 真实场景：MAXKB_ADMIN_TOKEN 缺失 → adminRequest 抛错 → fetchDatasets 只 warn 后返回空，
    // 若不区分就会把鉴权问题误报成命名问题，把人引到"去 Web Console 建库"这条错路上。
    delete process.env.MAXKB_ADMIN_TOKEN
    const error = await new ServiceCtor().ensureAgentKb('sourcing').catch((reason: unknown) => reason) as Error
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('一个都没能读取到')
    expect(error.message).toContain('MAXKB_ADMIN_TOKEN')
    expect(error.message).not.toContain('库名需匹配')
  })

  it('全程只读：绝不尝试建库或改写 MaxKB（CE 版本会 405/404）', async () => {
    const service = new ServiceCtor()
    await service.ensureAgentKb('sourcing')
    await service.ensureAgentKb('listing')
    expect(fetchCalls.length).toBeGreaterThan(0)
    expect(fetchCalls.every(call => call.method === 'GET')).toBe(true)
    expect(fetchCalls.some(call => /\/knowledge$/.test(call.url.split('?')[0]))).toBe(false)
  })
})
