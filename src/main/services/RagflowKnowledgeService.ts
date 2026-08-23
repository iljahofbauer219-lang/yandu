/**
 * RAGFlow 知识库管理服务：两大类（智能体知识库 / 自定义知识库）+ 自研文件管理。
 * - 分类注册表持久化在 userData/knowledge-registry.json；首跑按名称种子化存量库
 *   （Listing精造师知识库 → 智能体·listing；跨境运营知识库 → 自定义）
 * - 智能体知识库：每个员工角色一库，ensureAgentKb 按需创建；应用侧不暴露删除入口
 * - 自定义知识库：对话框创建、可删除（渲染层二次确认）
 * - 文件管理：上传（multipart）/ 解析 / 停止 / 删除，全部走 RAGFlow HTTP API
 */
import { app } from 'electron'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import { readServerUrl } from '../serverConfig'
import type { AgentKbSlot, KbAgentKey, KbCategory, KbCategoryNode, KbDocView, KbDocsView, KbListView, KbView } from '../../shared/knowledge'

export type { AgentKbSlot, KbAgentKey, KbCategory, KbCategoryNode, KbDocView, KbDocsView, KbListView, KbView }

// RAGFlow API Key 外置到 .env.local（RAGFLOW_API_KEY）；严禁模块顶层读 process.env：
// 服务模块 import 早于 loadLocalEnvironment() 执行，顶层读会得 undefined，只能在方法内懒读取

// 与 AI员工 页角色保持一致（AIEmployee.tsx AGENTS）
export const KB_AGENTS: Array<{ key: KbAgentKey; name: string; role: string; color: string; icon: string }> = [
  { key: 'sourcing', name: '选品分析师', role: '1688 商品机会评估 · 亚马逊选品分析', color: '#0ea5e9', icon: '选' },
  { key: 'listing', name: 'Listing精造师', role: '多平台 Listing 文案 · 母语级多语翻译', color: '#10b981', icon: '精' },
  { key: 'compliance', name: 'AI合规顾问', role: '合规规则问答 · 知识库检索', color: '#f59e0b', icon: '规' },
  { key: 'ops', name: 'AI运营助理', role: '运营数据 · 文案与推广支持', color: '#8b5cf6', icon: '运' }
]

interface RawDataset { id: string; name: string; description?: string | null; document_count?: number; chunk_count?: number; update_date?: string }
interface RawDoc { id: string; name: string; size?: number; chunk_count?: number; run?: string; progress?: number; create_date?: string; update_date?: string; meta_fields?: Record<string, unknown> }
type RegistryEntry = { kbId: string; category: KbCategory; agentKey?: KbAgentKey; createdAt: number }
// 注册表文件：entries = 一级归类；kbCategories = 各库多级分类树（文档归属存 RAGFlow meta_fields.category 叶子名）
type RegistryFile = { entries?: RegistryEntry[]; kbCategories?: Record<string, Array<string | KbCategoryNode>> }

// 首跑种子：存量两个库的归类（跨境运营知识库按用户决策归自定义）
const SEED_BY_NAME: Array<{ name: string; category: KbCategory; agentKey?: KbAgentKey }> = [
  { name: 'Listing精造师知识库', category: 'agent', agentKey: 'listing' },
  { name: '跨境运营知识库', category: 'custom' }
]

export class RagflowKnowledgeService {
  private registry: RegistryEntry[] | null = null
  private kbCategories: Record<string, KbCategoryNode[]> | null = null

  private baseUrl(): string | null {
    try {
      const base = new URL(readServerUrl())
      base.port = '8090'
      base.pathname = '/'
      return base.toString().replace(/\/+$/, '')
    } catch {
      return null
    }
  }

  private registryPath(): string {
    return path.join(app.getPath('userData'), 'knowledge-registry.json')
  }

  private async request<T>(method: string, pathname: string, body?: unknown, form?: FormData): Promise<T> {
    const base = this.baseUrl()
    if (!base) throw new Error('未配置中央服务器地址')
    const apiKey = String(process.env.RAGFLOW_API_KEY || '').trim()
    if (!apiKey) throw new Error('未配置 RAGFLOW_API_KEY：请在「大模型API Key」页设置')
    const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` }
    if (form === undefined && body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(`${base}/api/v1${pathname}`, {
      method,
      headers,
      body: form !== undefined ? form : body !== undefined ? JSON.stringify(body) : undefined
    })
    if (!response.ok) throw new Error(`RAGFlow 服务响应异常（HTTP ${response.status}）`)
    const payload = await response.json() as { code?: number; message?: string; data?: T }
    if (payload.code !== 0) throw new Error(payload.message || `RAGFlow 业务错误（code=${payload.code}）`)
    return payload.data as T
  }

  private async fetchDatasets(): Promise<RawDataset[]> {
    const data = await this.request<RawDataset[] | { datasets?: RawDataset[] }>('GET', '/datasets?page=1&page_size=100')
    return Array.isArray(data) ? data : (data?.datasets ?? [])
  }

  private async saveRegistry(): Promise<void> {
    try {
      const payload: RegistryFile = { entries: this.registry ?? [], kbCategories: this.kbCategories ?? {} }
      await fsp.writeFile(this.registryPath(), JSON.stringify(payload, null, 2), 'utf8')
    } catch (error) {
      console.warn('[kb] 注册表写入失败：', (error as Error).message)
    }
  }

  private async loadRegistry(): Promise<RegistryEntry[]> {
    if (this.registry) return this.registry
    try {
      const raw = await fsp.readFile(this.registryPath(), 'utf8')
      const parsed = JSON.parse(raw) as RegistryFile
      this.registry = Array.isArray(parsed.entries) ? parsed.entries : []
      const rawCats = (parsed.kbCategories && typeof parsed.kbCategories === 'object' ? parsed.kbCategories : {}) as Record<string, Array<string | KbCategoryNode>>
      // 向后兼容：旧版平铺 string[] 转为顶层节点
      this.kbCategories = {}
      for (const [id, value] of Object.entries(rawCats)) {
        this.kbCategories[id] = (Array.isArray(value) ? value : []).map((item): KbCategoryNode => typeof item === 'string' ? { name: item } : item)
      }
      return this.registry
    } catch {
      // 首跑：按名称种子化存量库；服务不可达时不落盘，下次调用重试
      const entries: RegistryEntry[] = []
      this.kbCategories = this.kbCategories ?? {}
      try {
        const datasets = await this.fetchDatasets()
        for (const seed of SEED_BY_NAME) {
          const hit = datasets.find(item => item.name === seed.name)
          if (hit) entries.push({ kbId: hit.id, category: seed.category, agentKey: seed.agentKey, createdAt: Date.now() })
        }
        this.registry = entries
        await this.saveRegistry()
      } catch {
        this.registry = entries
      }
      return this.registry
    }
  }

  private toView(dataset: RawDataset, entry: RegistryEntry | undefined): KbView {
    const agent = entry?.agentKey ? KB_AGENTS.find(item => item.key === entry.agentKey) : undefined
    return {
      id: dataset.id,
      name: dataset.name,
      description: dataset.description || '',
      documentCount: dataset.document_count ?? 0,
      chunkCount: dataset.chunk_count ?? 0,
      updateDate: dataset.update_date || '',
      category: entry?.category ?? 'custom',
      agentKey: entry?.agentKey,
      agentName: agent?.name
    }
  }

  // ─── 知识库列表（两大类视图） ─────────────────────────────────────────────
  async list(): Promise<KbListView> {
    const [registry, datasets] = await Promise.all([this.loadRegistry(), this.fetchDatasets()])
    const byId = new Map(registry.map(entry => [entry.kbId, entry]))
    const views = datasets.map(dataset => this.toView(dataset, byId.get(dataset.id)))
    // 未注册但名称符合「<智能体>知识库」约定的（如 RAGFlow 网页侧直接创建）自动归入智能体类
    for (const view of views) {
      if (view.category === 'custom' && !byId.has(view.id)) {
        const agent = KB_AGENTS.find(item => view.name === `${item.name}知识库`)
        if (agent) {
          view.category = 'agent'
          view.agentKey = agent.key
          view.agentName = agent.name
        }
      }
    }
    const agents: AgentKbSlot[] = KB_AGENTS.map(agent => ({ ...agent, kb: views.find(view => view.agentKey === agent.key) ?? null }))
    return { agents, customs: views.filter(view => view.category === 'custom') }
  }

  // ─── 自定义知识库：创建 / 删除 ────────────────────────────────────────────
  async createCustom(name: string, description: string): Promise<KbView> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('知识库名称不能为空')
    const created = await this.request<RawDataset>('POST', '/datasets', { name: trimmed, description: description.trim(), chunk_method: 'naive' })
    const id = created?.id
    if (!id) throw new Error('创建成功但未返回知识库 ID')
    this.registry = [...(this.registry ?? []), { kbId: id, category: 'custom', createdAt: Date.now() }]
    await this.saveRegistry()
    return { id, name: trimmed, description: description.trim(), documentCount: 0, chunkCount: 0, updateDate: new Date().toISOString().slice(0, 19).replace('T', ' '), category: 'custom' }
  }

  async deleteKb(kbId: string): Promise<void> {
    const current = await this.list()
    const target = [...current.customs, ...current.agents.map(slot => slot.kb).filter((kb): kb is KbView => kb !== null)].find(kb => kb.id === kbId)
    if (!target) throw new Error('知识库不存在')
    if (target.category !== 'custom') throw new Error('智能体知识库不可删除')
    await this.request<unknown>('DELETE', '/datasets', { ids: [kbId] })
    this.registry = (this.registry ?? []).filter(entry => entry.kbId !== kbId)
    if (this.kbCategories) delete this.kbCategories[kbId]
    await this.saveRegistry()
  }

  // ─── 智能体知识库：按需生成（一智能体一库） ───────────────────────────────
  async ensureAgentKb(agentKey: KbAgentKey): Promise<KbView> {
    const agent = KB_AGENTS.find(item => item.key === agentKey)
    if (!agent) throw new Error('未知的智能体角色')
    const current = await this.list()
    const existing = current.agents.find(slot => slot.key === agentKey)?.kb
    if (existing) return existing
    const created = await this.request<RawDataset>('POST', '/datasets', { name: `${agent.name}知识库`, description: `${agent.name} 专属知识库 · ${agent.role}`, chunk_method: 'naive' })
    const id = created?.id
    if (!id) throw new Error('创建成功但未返回知识库 ID')
    this.registry = [...(this.registry ?? []), { kbId: id, category: 'agent', agentKey, createdAt: Date.now() }]
    await this.saveRegistry()
    return { id, name: `${agent.name}知识库`, description: `${agent.name} 专属知识库 · ${agent.role}`, documentCount: 0, chunkCount: 0, updateDate: new Date().toISOString().slice(0, 19).replace('T', ' '), category: 'agent', agentKey, agentName: agent.name }
  }

  // ─── 文件管理：列表 / 上传 / 解析 / 停止 / 删除 ───────────────────────────
  // RAGFlow 限制 page_size ≤ 100：分页循环累积至 total
  private async fetchRawDocs(kbId: string): Promise<RawDoc[]> {
    const docs: RawDoc[] = []
    for (let page = 1; ; page++) {
      const data = await this.request<{ docs?: RawDoc[]; total?: number }>('GET', `/datasets/${kbId}/documents?page=${page}&page_size=100`)
      const batch = data.docs ?? []
      docs.push(...batch)
      const total = data.total ?? docs.length
      if (batch.length === 0 || docs.length >= total) break
    }
    return docs
  }

  private docCategory(doc: RawDoc): string {
    const value = doc.meta_fields?.category
    return typeof value === 'string' && value ? value : ''
  }

  private async updateDocMeta(kbId: string, docId: string, meta: Record<string, unknown>): Promise<void> {
    await this.request<unknown>('PUT', `/datasets/${kbId}/documents/${docId}`, { meta_fields: meta })
  }

  async listDocs(kbId: string): Promise<KbDocsView> {
    await this.loadRegistry()
    const raw = await this.fetchRawDocs(kbId)
    const docs: KbDocView[] = raw.map(doc => ({
      id: doc.id,
      name: doc.name,
      size: doc.size ?? 0,
      chunkCount: doc.chunk_count ?? 0,
      run: doc.run ?? 'UNSTART',
      progress: doc.progress ?? 0,
      createDate: doc.create_date || '',
      updateDate: doc.update_date || '',
      category: this.docCategory(doc)
    }))
    // 显示分类 = 本地树 ∪ 文档 meta 中出现过的分类（孤儿分类补为顶层，保序）
    const categories: KbCategoryNode[] = [...(this.kbCategories?.[kbId] ?? [])]
    for (const doc of docs) if (doc.category && !categories.some(node => node.name === doc.category)) categories.push({ name: doc.category })
    return { docs, categories }
  }

  async uploadDocs(kbId: string, filePaths: string[], category?: string): Promise<string[]> {
    const uploadedIds: string[] = []
    for (const filePath of filePaths) {
      const buffer = await fsp.readFile(filePath)
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(buffer)]), path.basename(filePath))
      const data = await this.request<Array<{ id?: string; name?: string }>>('POST', `/datasets/${kbId}/documents`, undefined, form)
      for (const item of Array.isArray(data) ? data : []) if (item.id) uploadedIds.push(item.id)
    }
    if (uploadedIds.length && category) await this.assignDocs(kbId, uploadedIds, category)
    return uploadedIds
  }

  async parseDocs(kbId: string, docIds: string[]): Promise<void> {
    if (!docIds.length) return
    await this.request<unknown>('POST', `/datasets/${kbId}/chunks`, { document_ids: docIds })
  }

  async stopParse(kbId: string, docIds: string[]): Promise<void> {
    if (!docIds.length) return
    await this.request<unknown>('DELETE', `/datasets/${kbId}/chunks`, { document_ids: docIds })
  }

  async deleteDocs(kbId: string, docIds: string[]): Promise<void> {
    if (!docIds.length) return
    await this.request<unknown>('DELETE', `/datasets/${kbId}/documents`, { ids: docIds })
  }

  // I.5 阶段新增：RAGFlow update_doc API（保留 docId，替换文件内容 + 触发重解析）
  // - 路径：PUT /datasets/{kbId}/documents/{docId}（RAGFlow 0.11+ 标准）
  // - 语义：保留原 docId，RAGFlow 内部替换文件并自动重新解析（调本方法后需独立调 parseDocs + waitParse）
  // - 优势：重解析期间旧 chunk 仍可被检索，RAGFlow 侧按版本号管理 chunk，平滑过渡
  async updateDoc(kbId: string, docId: string, filePath: string): Promise<void> {
    const buffer = await fsp.readFile(filePath)
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array(buffer)]), path.basename(filePath))
    await this.request<unknown>('PUT', `/datasets/${kbId}/documents/${docId}`, undefined, form)
  }

  // ─── 多级分类：目录树存本地注册表，文档归属存 RAGFlow meta_fields.category 叶子名 ─────
  async createCategory(kbId: string, name: string, parent?: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('分类名称不能为空')
    await this.loadRegistry()
    const map = this.kbCategories ?? (this.kbCategories = {})
    const list = map[kbId] ?? (map[kbId] = [])
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
    const map = this.kbCategories ?? (this.kbCategories = {})
    const list = map[kbId] ?? (map[kbId] = [])
    if (list.some(node => node.name === trimmed)) throw new Error('同名分类已存在')
    // 先同步服务端 meta，再改本地目录，避免改名中断产生孤儿分类
    for (const doc of await this.fetchRawDocs(kbId)) {
      if (this.docCategory(doc) !== oldName) continue
      await this.updateDocMeta(kbId, doc.id, { ...(doc.meta_fields ?? {}), category: trimmed })
    }
    const target = list.find(node => node.name === oldName)
    if (target) target.name = trimmed
    else list.push({ name: trimmed })
    // 子节点的 parent 引用同步改名（名字全库唯一，无需改服务端）
    for (const node of list) if (node.parent === oldName) node.parent = trimmed
    await this.saveRegistry()
  }

  async deleteCategory(kbId: string, name: string): Promise<void> {
    await this.loadRegistry()
    const map = this.kbCategories ?? (this.kbCategories = {})
    const list = map[kbId] ?? (map[kbId] = [])
    // 递归收集子树：删除父分类时其下所有子分类的文档一并回落未分类
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
    // 清除子树下文档的 meta 归属（回落未分类），不删除文件本身
    for (const doc of await this.fetchRawDocs(kbId)) {
      if (!subtree.has(this.docCategory(doc))) continue
      const meta = { ...(doc.meta_fields ?? {}) }
      delete meta.category
      await this.updateDocMeta(kbId, doc.id, meta)
    }
    map[kbId] = list.filter(node => !subtree.has(node.name))
    await this.saveRegistry()
  }

  async assignDocs(kbId: string, docIds: string[], category: string | null): Promise<void> {
    if (!docIds.length) return
    const byId = new Map((await this.fetchRawDocs(kbId)).map(doc => [doc.id, doc]))
    for (const docId of docIds) {
      const doc = byId.get(docId)
      if (!doc) continue
      const meta = { ...(doc.meta_fields ?? {}) }
      if (category) meta.category = category
      else delete meta.category
      await this.updateDocMeta(kbId, docId, meta)
    }
  }
}
