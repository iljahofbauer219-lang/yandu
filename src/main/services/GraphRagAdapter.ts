/**
 * GraphRagAdapter（自研降级方案 C）：基于 MaxKB 共享 KB 文档构建轻量知识图谱
 *
 * 设计动机：
 * - 原 GraphRAG 基于 DeepDoc + Agent DSL（实体抽取、关系图谱、社区发现）
 *   v0.x 实体抽取成本高、跨库难对齐；v2 已弃用 → MaxKB 不继承该能力
 * - MaxKB v2.10.5-lts CE 不暴露知识图谱 API（OSS 才有 GraphRAG 选项）
 * - 自研方案：用滑窗词对共现（window=8）+ 跨文档共现权重，构建轻量"共现图"，
 *   给定查询 → 命中关键词 → 沿共现图扩展 → 输出扩展后的相关 chunk
 *
 * 核心特性：
 * - 纯本地、零外部依赖（不调 LLM 抽取）
 * - 索引增量更新：userData/maxkb-graph-index.json 持久化
 * - 跨文档共现：相同关键词出现在不同 doc → 提升跨文档关联强度
 * - 中文友好：jieba-like 简单切词（≥2 字 N-gram + 停用词过滤）
 * - 取代原 GraphRAG 的"实体 → 关系 → 社区"链路为"关键词 → 共现邻居 → 跨文档"（独立实现，不依赖 MaxKB）
 */
import { app } from 'electron'
import { promises as fsp } from 'node:fs'
import path from 'node:path'

// 简化的中文停用词表（按词频 + 噪音过滤）
const STOPWORDS = new Set([
  '的', '了', '和', '是', '在', '我', '有', '不', '这', '也', '就', '都', '而', '及', '与', '或',
  '一个', '没有', '可以', '需要', '应该', '这个', '那个', '什么', '怎么', '如何', '为什么',
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one',
  'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'its', 'may', 'new', 'now', 'old',
  'see', 'two', 'way', 'who', 'boy', 'did', 'let', 'put', 'say', 'she', 'too', 'use'
])

interface GraphNode {
  term: string
  /** 共现频次（含自身） */
  frequency: number
  /** 邻居词（term → 共现次数） */
  neighbors: Record<string, number>
  /** 所在 docId 集合 */
  docIds: Set<string>
  /** 所在 chunkId 集合（"docId:chunkIdx"） */
  chunkIds: Set<string>
}

interface GraphIndex {
  version: string
  builtAt: number
  docCount: number
  chunkCount: number
  /** 词 → node 序列化（Set 转 Array） */
  nodes: Record<string, { frequency: number; neighbors: Record<string, number>; docIds: string[]; chunkIds: string[] }>
  /** chunk 内容（"docId:chunkIdx" → 文本，供 expand 返回） */
  chunks: Record<string, KBChunk>
}

interface KBChunk {
  /** "docId:chunkIdx" */
  id: string
  docId: string
  docName: string
  kbId: string
  text: string
}

interface KBChunkSource {
  listDocs(kbId: string): Promise<{ docs: Array<{ id: string; name: string; meta?: Record<string, unknown> }> }>
  /** 拉取 doc 文本内容（MaxKB 暂不暴露；降级用 doc.name + 客户端 tag 索引） */
  fetchDocContent?(kbId: string, docId: string): Promise<string>
}

const CO_OCCURRENCE_WINDOW = 8
const INDEX_VERSION = '1.0'

export class GraphRagAdapter {
  private index: GraphIndex | null = null
  private buildPromise: Promise<GraphIndex> | null = null
  private indexPath(): string {
    // Electron 环境：走 userData；非 Electron 环境（tsx/单测）走 /tmp
    if (app && typeof app.getPath === 'function') {
      try { return path.join(app.getPath('userData'), 'maxkb-graph-index.json') } catch { /* ignore */ }
    }
    return path.join(process.env.TMPDIR || '/tmp', 'maxkb-graph-index.json')
  }

  /** 注入 MaxKB KB 来源（默认走 MaxkbKnowledgeService；测试可注入 mock） */
  constructor(
    private readonly source: KBChunkSource,
    private readonly kbIds: string[] = String(process.env.MAXKB_KNOWLEDGE_DATASETS || '').split(',').map(s => s.trim()).filter(Boolean)
  ) {}

  /** 轻量切词：CJK ≥2 字 N-gram + 英文单词，过滤停用词 */
  private tokenize(text: string): string[] {
    if (!text) return []
    const tokens: string[] = []
    // 1) 英文/数字单词
    const wordMatches = text.match(/[A-Za-z][A-Za-z0-9_-]{1,}/g) || []
    for (const w of wordMatches) {
      const lw = w.toLowerCase()
      if (!STOPWORDS.has(lw) && lw.length >= 2) tokens.push(lw)
    }
    // 2) 中文：连续 CJK ≥2 字 N-gram（window=2 滑窗）
    const cjkRuns = text.match(/[一-鿿]{2,}/g) || []
    for (const run of cjkRuns) {
      for (let i = 0; i <= run.length - 2; i++) {
        const bi = run.slice(i, i + 2)
        if (!STOPWORDS.has(bi)) tokens.push(bi)
      }
    }
    return tokens
  }

  /** 加载或重建索引 */
  async getIndex(): Promise<GraphIndex> {
    if (this.index) return this.index
    if (this.buildPromise) return this.buildPromise
    this.buildPromise = this.loadOrBuild()
    this.index = await this.buildPromise
    this.buildPromise = null
    return this.index
  }

  private async loadOrBuild(): Promise<GraphIndex> {
    try {
      const raw = await fsp.readFile(this.indexPath(), 'utf8')
      const parsed = JSON.parse(raw) as GraphIndex
      if (parsed.version === INDEX_VERSION) return parsed
    } catch { /* 首次或损坏：重建 */ }
    return this.build()
  }

  /** 强制重建索引（KB 增删文档后调用） */
  async rebuild(): Promise<GraphIndex> {
    this.index = null
    return this.getIndex()
  }

  private async build(): Promise<GraphIndex> {
    const nodes = new Map<string, GraphNode>()
    const chunks: GraphIndex['chunks'] = {}
    let docCount = 0
    let chunkCount = 0
    for (const kbId of this.kbIds) {
      let docs: Array<{ id: string; name: string; meta?: Record<string, unknown> }> = []
      try {
        const result = await this.source.listDocs(kbId)
        docs = result.docs
      } catch (error) {
        console.warn(`[graph-rag] KB ${kbId} 拉取失败：`, (error as Error).message)
        continue
      }
      for (const doc of docs) {
        docCount += 1
        // 拉 doc 文本（v2.10.5-lts 暂不暴露 paragraph API；降级用 doc.name + meta 拼 chunk）
        let content = doc.name
        if (this.source.fetchDocContent) {
          try { content = (await this.source.fetchDocContent(kbId, doc.id)) || doc.name } catch { /* keep name only */ }
        }
        // 简单按 \n\n 切 chunk
        const textChunks = content.split(/\n\n+/).map(s => s.trim()).filter(s => s.length >= 10)
        if (textChunks.length === 0) textChunks.push(doc.name) // 兜底：只存文件名
        textChunks.forEach((text, chunkIdx) => {
          const chunkId = `${doc.id}:${chunkIdx}`
          chunks[chunkId] = { id: chunkId, docId: doc.id, docName: doc.name, kbId, text }
          chunkCount += 1
          const tokens = this.tokenize(text)
          const windowed: string[] = []
          for (let i = 0; i < tokens.length; i++) {
            const term = tokens[i]
            windowed.push(term)
            if (windowed.length > CO_OCCURRENCE_WINDOW) windowed.shift()
            for (const other of windowed) {
              if (other === term) continue
              this.addEdge(nodes, term, other, chunkId, doc.id)
              this.addEdge(nodes, other, term, chunkId, doc.id)
            }
          }
          for (const term of tokens) this.touchNode(nodes, term, chunkId, doc.id)
        })
      }
    }
    // 序列化 Set → Array
    const serialized: GraphIndex['nodes'] = {}
    for (const [term, node] of nodes.entries()) {
      serialized[term] = {
        frequency: node.frequency,
        neighbors: node.neighbors,
        docIds: Array.from(node.docIds),
        chunkIds: Array.from(node.chunkIds)
      }
    }
    const idx: GraphIndex = { version: INDEX_VERSION, builtAt: Date.now(), docCount, chunkCount, nodes: serialized, chunks }
    try {
      await fsp.writeFile(this.indexPath(), JSON.stringify(idx), 'utf8')
    } catch (error) {
      console.warn('[graph-rag] 索引落盘失败：', (error as Error).message)
    }
    console.log(`[graph-rag] 索引构建完成：${docCount} doc, ${chunkCount} chunk, ${nodes.size} term`)
    return idx
  }

  private touchNode(nodes: Map<string, GraphNode>, term: string, chunkId: string, docId: string): void {
    let node = nodes.get(term)
    if (!node) {
      node = { term, frequency: 0, neighbors: {}, docIds: new Set(), chunkIds: new Set() }
      nodes.set(term, node)
    }
    node.frequency += 1
    node.docIds.add(docId)
    node.chunkIds.add(chunkId)
  }

  private addEdge(nodes: Map<string, GraphNode>, from: string, to: string, chunkId: string, docId: string): void {
    const node = nodes.get(from) ?? (() => { const n: GraphNode = { term: from, frequency: 0, neighbors: {}, docIds: new Set(), chunkIds: new Set() }; nodes.set(from, n); return n })()
    node.neighbors[to] = (node.neighbors[to] || 0) + 1
    node.docIds.add(docId)
    node.chunkIds.add(chunkId)
  }

  /**
   * 给定查询，沿共现图扩展并返回相关 chunk
   * @param query 查询文本
   * @param topK 返回 chunk 数量上限
   * @param hops 沿共现图扩展跳数（1-2 推荐）
   * @param sameDocBonus 同一文档内命中 chunk 额外加权（>1.0）
   * @param crossDocBonus 跨文档关联 chunk 加权（>1.0）
   */
  async expand(query: string, options: { topK?: number; hops?: number; sameDocBonus?: number; crossDocBonus?: number } = {}): Promise<Array<KBChunk & { score: number; matchedTerms: string[] }>> {
    const { topK = 5, hops = 1, sameDocBonus = 1.5, crossDocBonus = 1.0 } = options
    const idx = await this.getIndex()
    const queryTerms = this.tokenize(query)
    if (!queryTerms.length) return []

    // BFS 扩展邻居
    const seedScores = new Map<string, number>()
    const chunkScores = new Map<string, { score: number; matchedTerms: Set<string> }>()
    const visited = new Set<string>()
    const queue: Array<{ term: string; depth: number; weight: number }> = []
    for (const term of queryTerms) {
      seedScores.set(term, 1.0)
      queue.push({ term, depth: 0, weight: 1.0 })
    }
    while (queue.length) {
      const { term, depth, weight } = queue.shift()!
      if (visited.has(term) || depth > hops) continue
      visited.add(term)
      const node = idx.nodes[term]
      if (!node) continue
      // 命中 chunk 计分
      for (const chunkId of node.chunkIds) {
        const entry = chunkScores.get(chunkId) ?? { score: 0, matchedTerms: new Set() }
        entry.score += weight
        entry.matchedTerms.add(term)
        chunkScores.set(chunkId, entry)
      }
      // 扩展邻居（depth+1，weight 衰减 0.5）
      if (depth < hops) {
        const neighbors = Object.entries(node.neighbors).sort((a, b) => b[1] - a[1]).slice(0, 12)
        for (const [neighbor, coOcc] of neighbors) {
          if (visited.has(neighbor)) continue
          const decay = 0.5 * (coOcc / Math.max(1, node.frequency))
          queue.push({ term: neighbor, depth: depth + 1, weight: weight * decay })
        }
      }
    }
    // 后处理：跨文档 / 同文档加权
    const seedDocIds = new Set<string>()
    for (const term of queryTerms) {
      const node = idx.nodes[term]
      if (node) for (const docId of node.docIds) seedDocIds.add(docId)
    }
    const results: Array<KBChunk & { score: number; matchedTerms: string[] }> = []
    for (const [chunkId, entry] of chunkScores.entries()) {
      const chunk = idx.chunks[chunkId]
      if (!chunk) continue
      let score = entry.score
      if (seedDocIds.has(chunk.docId)) score *= sameDocBonus
      // 跨文档奖励：该 chunk 关联了 seed 词但在不同 doc（已通过 crossDocBonus 关闭则跳过）
      else if (crossDocBonus !== 1.0) score *= crossDocBonus
      results.push({ ...chunk, score, matchedTerms: Array.from(entry.matchedTerms) })
    }
    results.sort((a, b) => b.score - a.score)
    return results.slice(0, topK)
  }

  /** 索引统计（供调试 / 监控） */
  async stats(): Promise<GraphStats> {
    const idx = await this.getIndex()
    let bytes = 0
    try { bytes = (await fsp.stat(this.indexPath())).size } catch { /* ignore */ }
    return { docCount: idx.docCount, chunkCount: idx.chunkCount, termCount: Object.keys(idx.nodes).length, builtAt: idx.builtAt, indexBytes: bytes }
  }
}

// 对外类型导出（供 MaxkbKnowledgeService / 主进程 IPC / UI 层消费）
export type GraphExpandOptions = { topK?: number; hops?: number; sameDocBonus?: number; crossDocBonus?: number }
export type GraphExpandResult = KBChunk & { score: number; matchedTerms: string[] }
export type GraphStats = { docCount: number; chunkCount: number; termCount: number; builtAt: number; indexBytes: number }
