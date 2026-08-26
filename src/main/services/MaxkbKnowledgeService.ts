/**
 * MaxKB 知识库管理服务（v2.10.5-lts CE）
 * - KbListView / KbDocView / KbDocsView 接口面向前端 KnowledgeHub / 守卫调度统一
 * - 降级方案 B：KB 列表固定为 .env.local MAXKB_KNOWLEDGE_DATASETS 中的共享 KB
 *   （不支持创建/删除 KB —— v2.10.5-lts admin API POST/PUT/PATCH /workspace/default/knowledge
 *    全部 405/404，需用户在 Web Console 手动管理）
 * - 多级分类：本地 kbCategories 注册表（userData/maxkb-kb-categories.json）
 *   + 服务端 doc.meta.category 字段
 *   （注：v2.10.5-lts 的 doc.tags[] 字段 PUT 200 但不持久化，放弃使用）
 * - 上传/解析：MaxKB v2 自动解析（status=nnn2 等价于"已就绪"），无需手动 parse
 * - PDF 解析降级方案 A：上传前客户端用 pdf-parse 提取纯文本（fallback to 原文件）
 */
import { app } from 'electron'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import type { AgentKbSlot, KbAgentKey, KbCategory, KbCategoryNode, KbDocView, KbDocsView, KbListView, KbView } from '../../shared/knowledge'
import { GraphRagAdapter, type GraphExpandOptions, type GraphExpandResult, type GraphStats } from './GraphRagAdapter'

export type { AgentKbSlot, KbAgentKey, KbCategory, KbCategoryNode, KbDocView, KbDocsView, KbListView, KbView }

// 与 AI员工 页角色保持一致（AIEmployee.tsx AGENTS）
export const KB_AGENTS: Array<{ key: KbAgentKey; name: string; role: string; color: string; icon: string }> = [
  { key: 'sourcing', name: '选品分析师', role: '1688 商品机会评估 · 亚马逊选品分析', color: '#0ea5e9', icon: '选' },
  { key: 'listing', name: 'Listing精造师', role: '多平台 Listing 文案 · 母语级多语翻译', color: '#10b981', icon: '精' },
  { key: 'compliance', name: 'AI合规顾问', role: '合规规则问答 · 知识库检索', color: '#f59e0b', icon: '规' },
  { key: 'ops', name: 'AI运营助理', role: '运营数据 · 文案与推广支持', color: '#8b5cf6', icon: '运' }
]

interface RawKnowledge { id: string; name: string; desc?: string; type?: number; workspace_id?: string; folder_id?: string; application_id?: string; user_id?: string; create_time?: string; update_time?: string; document_count?: number; char_length?: number }
interface RawDoc { id: string; name: string; char_length?: number; paragraph_count?: number; tag_count?: number; tags?: string[]; status?: string; status_meta?: Record<string, unknown>; is_active?: boolean; type?: number; hit_handling_method?: string; directly_return_similarity?: number; meta?: Record<string, unknown>; create_time?: string; update_time?: string; knowledge_id?: string; user_id?: string; nick_name?: string }

// 分类注册表：kbCategories[kbId] = 分类目录树（叶子名为 doc.meta.category 同步键）
type CategoryFile = { kbCategories?: Record<string, KbCategoryNode[]> }

// 名称 → 智能体归类映射（与知识库命名约定一致）
const NAME_TO_AGENT: Array<{ match: RegExp; agentKey: KbAgentKey }> = [
  { match: /Listing精造师/, agentKey: 'listing' },
  { match: /选品|选品分析师/, agentKey: 'sourcing' },
  { match: /合规/, agentKey: 'compliance' },
  { match: /运营/, agentKey: 'ops' }
]

/** MaxKB v2.10.5-lts CE 不支持 KB CRUD —— 抛错统一文案，UI 层捕获后引导走 Web Console */
export const ERR_KB_CREATE_UNSUPPORTED = 'MaxKB v2.10.5-lts CE 暂不支持 API 创建知识库；请在 MaxKB Web Console（http://114.55.149.192:8080/admin）手动创建后，将 KB ID 加入 .env.local 的 MAXKB_KNOWLEDGE_DATASETS'
export const ERR_KB_DELETE_UNSUPPORTED = 'MaxKB v2.10.5-lts CE 暂不支持 API 删除知识库；请在 MaxKB Web Console 操作'
export const ERR_KB_ENSURE_UNSUPPORTED = 'MaxKB v2.10.5-lts CE 暂不支持 API 按需创建智能体知识库；5 个 application 共享 .env.local 中声明的固定 KB'

export class MaxkbKnowledgeService {
  private categories: Record<string, KbCategoryNode[]> = {}
  private loaded = false
  // 静态 KB 列表缓存：避免每次 list() 都请求服务端
  private kbCache: RawKnowledge[] | null = null
  private kbCacheAt = 0
  private static readonly KB_CACHE_TTL_MS = 30_000

  private baseUrl(): string | null {
    const explicit = String(process.env.MAXKB_BASE_URL || '').trim()
    if (explicit) return explicit.replace(/\/+$/, '')
    return null
  }

  private datasets(): string[] {
    return String(process.env.MAXKB_KNOWLEDGE_DATASETS || '').split(',').map(s => s.trim()).filter(Boolean)
  }

  private registryPath(): string {
    // Electron 环境：走 userData；非 Electron 环境（tsx/单测）走 /tmp
    if (app && typeof app.getPath === 'function') {
      try { return path.join(app.getPath('userData'), 'maxkb-kb-categories.json') } catch { /* ignore */ }
    }
    return path.join(process.env.TMPDIR || '/tmp', 'maxkb-kb-categories.json')
  }

  private async adminRequest<T>(method: string, pathname: string, body?: unknown, form?: FormData): Promise<T> {
    const base = this.baseUrl()
    if (!base) throw new Error('未配置 MAXKB_BASE_URL（请检查 .env.local）')
    const apiKey = String(process.env.MAXKB_ADMIN_TOKEN || '').trim()
    if (!apiKey) throw new Error('未配置 MAXKB_ADMIN_TOKEN：阶段 1.5 publish-maxkb-agent.mjs 注入；运行期只读场景可使用 secret_key 替代')
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
    if (form === undefined && body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(`${base}/admin/api${pathname}`, {
      method,
      headers,
      body: form !== undefined ? form : body !== undefined ? JSON.stringify(body) : undefined
    })
    if (!response.ok) throw new Error(`MaxKB admin 服务响应异常（HTTP ${response.status} ${response.statusText}）`)
    const payload = await response.json() as { code?: number; message?: string; data?: T }
    if (payload.code !== 200) throw new Error(payload.message || `MaxKB admin 业务错误（code=${payload.code}）`)
    return payload.data as T
  }

  /** 拉取所有声明的 KB 详情（缓存 30s） */
  private async fetchDatasets(): Promise<RawKnowledge[]> {
    const now = Date.now()
    if (this.kbCache && now - this.kbCacheAt < MaxkbKnowledgeService.KB_CACHE_TTL_MS) return this.kbCache
    const ids = this.datasets()
    if (!ids.length) return []
    const results: RawKnowledge[] = []
    for (const id of ids) {
      try {
        const kb = await this.adminRequest<RawKnowledge>('GET', `/workspace/default/knowledge/${id}`)
        if (kb?.id) results.push(kb)
      } catch (error) {
        // 单个 KB 拉取失败不阻塞其它
        console.warn(`[maxkb-kb] 拉取 KB ${id} 失败：`, (error as Error).message)
      }
    }
    this.kbCache = results
    this.kbCacheAt = now
    return results
  }

  /** 拉取 KB 下的文档（直连服务端，不缓存：保证 listDocs 实时反映状态变化） */
  private async fetchRawDocs(kbId: string): Promise<RawDoc[]> {
    const data = await this.adminRequest<RawDoc[]>('GET', `/workspace/default/knowledge/${kbId}/document`)
    return Array.isArray(data) ? data : []
  }

  private async loadRegistry(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = await fsp.readFile(this.registryPath(), 'utf8')
      const parsed = JSON.parse(raw) as CategoryFile
      const rawCats = (parsed.kbCategories && typeof parsed.kbCategories === 'object' ? parsed.kbCategories : {}) as Record<string, Array<string | KbCategoryNode>>
      this.categories = {}
      for (const [id, value] of Object.entries(rawCats)) {
        this.categories[id] = (Array.isArray(value) ? value : []).map((item): KbCategoryNode => typeof item === 'string' ? { name: item } : item)
      }
    } catch {
      this.categories = {}
    }
    this.loaded = true
  }

  private async saveRegistry(): Promise<void> {
    try {
      const payload: CategoryFile = { kbCategories: this.categories }
      await fsp.writeFile(this.registryPath(), JSON.stringify(payload, null, 2), 'utf8')
    } catch (error) {
      console.warn('[maxkb-kb] 分类注册表写入失败：', (error as Error).message)
    }
  }

  /** doc.category 解析：服务端 doc.meta.category 字段 */
  private async docCategory(doc: RawDoc): Promise<string> {
    const metaCat = doc.meta?.category
    return typeof metaCat === 'string' ? metaCat.trim() : ''
  }

  /** 同步服务端 doc.meta.category：把 docId → category 写到 MaxKB doc.meta.category */
  private async syncDocCategoryServer(kbId: string, docId: string, category: string | null): Promise<void> {
    try {
      const docs = await this.fetchRawDocs(kbId)
      const doc = docs.find(d => d.id === docId)
      if (!doc) return
      const meta = { ...(doc.meta || {}) }
      if (category) meta.category = category
      else delete meta.category
      await this.adminRequest<unknown>('PUT', `/workspace/default/knowledge/${kbId}/document/${docId}`, { meta })
    } catch (error) {
      // 同步失败不影响本地一致性；下次重启会重新拉取
      console.warn(`[maxkb-kb] 同步 doc ${docId} 服务端 meta.category 失败：`, (error as Error).message)
    }
  }

  private matchAgent(name: string): KbAgentKey | undefined {
    for (const rule of NAME_TO_AGENT) if (rule.match.test(name)) return rule.agentKey
    return undefined
  }

  private toView(kb: RawKnowledge): KbView {
    const agentKey = this.matchAgent(kb.name)
    const agent = agentKey ? KB_AGENTS.find(item => item.key === agentKey) : undefined
    return {
      id: kb.id,
      name: kb.name,
      description: kb.desc || '',
      documentCount: kb.document_count ?? 0,
      chunkCount: 0, // MaxKB v2.10.5-lts 不暴露 chunk 数；前端用 paragraph_count 显示
      updateDate: kb.update_time || '',
      category: agentKey ? 'agent' : 'custom',
      agentKey,
      agentName: agent?.name
    }
  }

  // ─── 知识库列表（固定 2 个共享 KB + 按名称归类） ──────────────────────────
  async list(): Promise<KbListView> {
    await this.loadRegistry()
    const datasets = await this.fetchDatasets()
    const views = datasets.map(kb => this.toView(kb))
    const agents: AgentKbSlot[] = KB_AGENTS.map(agent => ({ ...agent, kb: views.find(view => view.agentKey === agent.key) ?? null }))
    return { agents, customs: views.filter(view => view.category === 'custom') }
  }

  // ─── 自定义知识库：CRUD 在 v2.10.5-lts 不可用，全部抛错 ──────────────────
  async createCustom(_name: string, _description: string): Promise<KbView> {
    throw new Error(ERR_KB_CREATE_UNSUPPORTED)
  }

  async deleteKb(_kbId: string): Promise<void> {
    throw new Error(ERR_KB_DELETE_UNSUPPORTED)
  }

  async ensureAgentKb(agentKey: KbAgentKey): Promise<KbView> {
    void agentKey
    throw new Error(ERR_KB_ENSURE_UNSUPPORTED)
  }

  // ─── 文件管理：列表 / 上传 / 解析（v2 自动解析：noop）/ 停止（v2 noop）/ 删除 / 更新 ──
  async listDocs(kbId: string): Promise<KbDocsView> {
    await this.loadRegistry()
    const raw = await this.fetchRawDocs(kbId)
    const docs: KbDocView[] = await Promise.all(raw.map(async doc => ({
      id: doc.id,
      name: doc.name,
      size: doc.char_length ?? 0,
      chunkCount: doc.paragraph_count ?? 0,
      run: this.mapStatus(doc.status),
      progress: this.parseProgress(doc.status_meta),
      createDate: doc.create_time || '',
      updateDate: doc.update_time || '',
      category: await this.docCategory(doc)
    })))
    const categories: KbCategoryNode[] = [...(this.categories[kbId] ?? [])]
    for (const doc of docs) if (doc.category && !categories.some(node => node.name === doc.category)) categories.push({ name: doc.category })
    return { docs, categories }
  }

  /** status 字符串 → run 字段（前端渲染统一：DONE / EMBEDDING / UNSTART） */
  private mapStatus(status: string | undefined): string {
    if (!status) return 'UNSTART'
    // nnn2 = 已完成/ready；数字越大越靠后；前端关心 DONE/EMBEDDING/UNSTART
    if (status === 'nnn2') return 'DONE'
    if (status === 'nnn1') return 'EMBEDDING'
    return status.toUpperCase()
  }

  private parseProgress(statusMeta: Record<string, unknown> | undefined): number {
    if (!statusMeta) return 0
    const aggs = statusMeta.aggs as Array<{ count?: number; status?: string }> | undefined
    if (!Array.isArray(aggs) || !aggs.length) return 100
    const total = aggs.reduce((sum, item) => sum + (item.count || 0), 0)
    if (!total) return 0
    return 100
  }

  async uploadDocs(kbId: string, filePaths: string[], category?: string): Promise<string[]> {
    const uploadedIds: string[] = []
    for (const filePath of filePaths) {
      const buffer = await fsp.readFile(filePath)
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(buffer)]), path.basename(filePath))
      const data = await this.adminRequest<Array<{ id?: string; name?: string }>>('POST', `/workspace/default/knowledge/${kbId}/document`, undefined, form)
      for (const item of Array.isArray(data) ? data : []) if (item.id) uploadedIds.push(item.id)
    }
    if (uploadedIds.length && category) await this.assignDocs(kbId, uploadedIds, category)
    return uploadedIds
  }

  /** MaxKB v2 上传后自动解析；status=nnn2 即就绪。此方法保留为 noop 以兼容老调用方 */
  async parseDocs(_kbId: string, _docIds: string[]): Promise<void> {
    // noop: MaxKB v2 自动解析，无需手动触发
  }

  async stopParse(_kbId: string, _docIds: string[]): Promise<void> {
    // noop: MaxKB v2 不暴露停止解析 API
  }

  async deleteDocs(kbId: string, docIds: string[]): Promise<void> {
    if (!docIds.length) return
    for (const docId of docIds) {
      try {
        await this.adminRequest<unknown>('DELETE', `/workspace/default/knowledge/${kbId}/document/${docId}`)
      } catch (error) {
        console.warn(`[maxkb-kb] 删除 doc ${docId} 失败：`, (error as Error).message)
      }
    }
  }

  /** 重新上传：先 DELETE 再上传（v2 不暴露 update_doc 等价 API） */
  async updateDoc(kbId: string, docId: string, filePath: string): Promise<void> {
    await this.deleteDocs(kbId, [docId])
    const [newId] = await this.uploadDocs(kbId, [filePath])
    if (!newId) throw new Error('MaxKB 重新上传失败：未返回新 docId')
  }

  // ─── 多级分类：本地目录树 + 服务端 tags[] 同步（segment tag 模拟） ─────
  async createCategory(kbId: string, name: string, parent?: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('分类名称不能为空')
    await this.loadRegistry()
    const list = this.categories[kbId] ?? (this.categories[kbId] = [])
    if (parent && !list.some(node => node.name === parent)) throw new Error('父分类不存在')
    if (list.some(node => node.name === trimmed)) throw new Error('同名分类已存在')
    list.push(parent ? { name: trimmed, parent } : { name: trimmed })
    await this.saveRegistry()
  }

  async renameCategory(kbId: string, oldName: string, newName: string): Promise<void> {
    const trimmed = newName.trim()
    if (!trimmed) throw new Error('分类名称不能为空')
    if (trimmed === oldName) return
    await this.loadRegistry()
    const list = this.categories[kbId] ?? (this.categories[kbId] = [])
    if (list.some(node => node.name === trimmed)) throw new Error('同名分类已存在')
    // 同步服务端 tags + 本地 docTags
    const docs = await this.fetchRawDocs(kbId)
    for (const doc of docs) {
      if (await this.docCategory(doc) !== oldName) continue
      await this.syncDocCategoryServer(kbId, doc.id, trimmed)
    }
    const target = list.find(node => node.name === oldName)
    if (target) target.name = trimmed
    else list.push({ name: trimmed })
    for (const node of list) if (node.parent === oldName) node.parent = trimmed
    await this.saveRegistry()
  }

  async deleteCategory(kbId: string, name: string): Promise<void> {
    await this.loadRegistry()
    const list = this.categories[kbId] ?? (this.categories[kbId] = [])
    const subtree = new Set([name])
    let changed = true
    while (changed) {
      changed = false
      for (const node of list) {
        if (!subtree.has(node.name) && node.parent && subtree.has(node.parent)) {
          subtree.add(node.name)
          changed = true
        }
      }
    }
    const docs = await this.fetchRawDocs(kbId)
    for (const doc of docs) {
      if (!subtree.has(await this.docCategory(doc))) continue
      await this.syncDocCategoryServer(kbId, doc.id, null)
    }
    this.categories[kbId] = list.filter(node => !subtree.has(node.name))
    await this.saveRegistry()
  }

  async assignDocs(kbId: string, docIds: string[], category: string | null): Promise<void> {
    if (!docIds.length) return
    for (const docId of docIds) {
      await this.syncDocCategoryServer(kbId, docId, category)
    }
  }

  // ─── GraphRag 集成（降级方案 C：自研轻量共现图）────────────────────
  // - 取代实体抽取式 GraphRAG：取代"实体 → 关系 → 社区"链路为"关键词 → 共现邻居 → 跨文档"
  // - 主要作用：增强 LLM 查询的语义覆盖（不替代 MaxKB 内部 RAG）
  private graphAdapter: GraphRagAdapter | null = null

  private getGraphAdapter(): GraphRagAdapter {
    if (this.graphAdapter) return this.graphAdapter
    const source = {
      listDocs: async (kbId: string) => {
        const docs = await this.fetchRawDocs(kbId)
        return { docs: docs.map(d => ({ id: d.id, name: d.name, meta: d.meta })) }
      },
      // v2.10.5-lts 不暴露 paragraph 文本 API；降级为 doc.name + meta，供 GraphRagAdapter 提取领域关键词
      fetchDocContent: async (kbId: string, docId: string) => {
        try {
          const kb = await this.adminRequest<RawKnowledge>('GET', `/workspace/default/knowledge/${kbId}`)
          const docs = await this.fetchRawDocs(kbId)
          const doc = docs.find(d => d.id === docId)
          if (!doc) return ''
          // 拼接 name + meta + kb desc 作为轻量语义载体
          const parts: string[] = [doc.name, kb.desc || '']
          if (doc.meta?.category) parts.push(String(doc.meta.category))
          if (Array.isArray(doc.meta?.tags)) parts.push((doc.meta!.tags as string[]).join(' '))
          return parts.join(' ')
        } catch {
          return ''
        }
      }
    }
    this.graphAdapter = new GraphRagAdapter(source, this.datasets())
    return this.graphAdapter
  }

  /** 查 GraphRagAdapter 索引统计：doc / chunk / term 数、构建时间、索引体积 */
  async graphStats(): Promise<GraphStats> {
    return this.getGraphAdapter().stats()
  }

  /** 查 GraphRag 扩展后的相关 chunk（用于增强 LLM 查询语义覆盖） */
  async graphExpand(query: string, options: GraphExpandOptions = {}): Promise<GraphExpandResult[]> {
    if (!query.trim()) return []
    return this.getGraphAdapter().expand(query, options)
  }

  /** 重建 GraphRag 索引（KB 增删文档后调用） */
  async graphRebuild(): Promise<GraphStats> {
    const adapter = this.getGraphAdapter()
    await adapter.rebuild()
    return adapter.stats()
  }
}
