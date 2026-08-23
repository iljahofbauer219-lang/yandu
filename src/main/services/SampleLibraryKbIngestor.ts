/**
 * 报告样例库 → RAGFlow 知识库入库服务（I 阶段新增）。
 *
 * 目的：把 4 真实样例 + 决策门禁汇总 + 决策可追溯硬约束以 KB 文档形式归档到
 *   「选品分析师」RAGFlow 知识库（agentKey='sourcing'），让所有 AI 员工
 *   在跨任务中都能参考这 4 个标准答案与硬约束。
 *
 * 设计原则：
 *   - 幂等：按文件名去重，重复运行只解析新文档
 *   - 单库入口：统一调用 RagflowKnowledgeService，不重复造轮子
 *   - 多级分类：报告样例库/{A|B|C|D|决策门禁|可追溯约束} 由叶子名落 RAGFlow meta_fields.category
 *   - 错误聚合：单文件失败不影响其他文件上传；最终结果聚合返回
 *   - 预览支持：preview() 不触网，只返回 buildSampleLibraryKbIngestPlan() 的统计
 */
import { RagflowKnowledgeService, KB_AGENTS } from './RagflowKnowledgeService'
import type { KbView } from '../../shared/knowledge'
import {
  SAMPLE_LIBRARY_KB_TARGET,
  buildSampleLibraryKbIngestPlan,
  summarizeSampleLibraryKbIngestPlan,
  type SampleLibraryKbDoc,
  type SampleLibraryKbIngestResult
} from '../../shared/sampleLibraryKbIngest'

export class SampleLibraryKbIngestor {
  constructor(private readonly kb: RagflowKnowledgeService = new RagflowKnowledgeService()) {}

  /**
   * 预览入库计划（不触网；只走本地文件 size 检测）。
   * 桌面入口先调用此方法展示统计，用户点确认后再调 ingest()。
   */
  async preview(): Promise<{
    kb: KbView
    plan: SampleLibraryKbDoc[]
    summary: ReturnType<typeof summarizeSampleLibraryKbIngestPlan>
  }> {
    const kb = await this.kb.ensureAgentKb(SAMPLE_LIBRARY_KB_TARGET.agentKey)
    const plan = buildSampleLibraryKbIngestPlan()
    const summary = summarizeSampleLibraryKbIngestPlan(plan)
    return { kb, plan, summary }
  }

  /**
   * 执行入库：ensureAgentKb → 上传缺失文档 → 自动分类 → 触发解析。
   * 幂等：按文件名去重，重复运行只解析新文档。
   */
  async ingest(options: { parse?: boolean } = {}): Promise<SampleLibraryKbIngestResult> {
    const start = Date.now()
    const { parse = true } = options
    const plan = buildSampleLibraryKbIngestPlan()
    const errors: Array<{ file: string; error: string }> = []

    // 1) 确保目标 KB 存在（智能体键 → RAGFlow 数据集）
    const kb = await this.kb.ensureAgentKb(SAMPLE_LIBRARY_KB_TARGET.agentKey)

    // 2) 创建/补齐多级分类（叶子名 = ${root}/${sub}）
    await this.ensureCategories(kb.id, plan)

    // 3) 列出现有文档，按文件名去重
    const existing = await this.kb.listDocs(kb.id)
    const existingByName = new Map(existing.docs.map(d => [d.name, d]))

    // 4) 上传缺失文档（按文件分批；失败聚合到 errors 不中断）
    const uploaded: SampleLibraryKbDoc[] = []
    const skipped: SampleLibraryKbDoc[] = []
    const newlyUploadedIds: string[] = []
    const newlyUploadedMeta: Array<{ id: string; doc: SampleLibraryKbDoc }> = []

    for (const doc of plan) {
      try {
        if (doc.meta.size === 0) {
          errors.push({ file: doc.name, error: `本地文件不存在或为空：${doc.filePath}` })
          continue
        }
        if (existingByName.has(doc.name)) {
          skipped.push(doc)
          continue
        }
        const ids = await this.kb.uploadDocs(kb.id, [doc.filePath], doc.category)
        for (const id of ids) newlyUploadedIds.push(id)
        // 记录上传的元信息（id ↔ 计划项）
        for (let i = 0; i < ids.length; i++) {
          newlyUploadedMeta.push({ id: ids[i], doc })
        }
        uploaded.push(doc)
      } catch (err) {
        errors.push({ file: doc.name, error: (err as Error).message })
      }
    }

    // 5) 给跳过文档（同名已存在）做分类补齐：旧库可能没归类
    for (const doc of skipped) {
      try {
        const existingDoc = existingByName.get(doc.name)
        if (!existingDoc) continue
        const currentCategory = existingDoc.category
        if (currentCategory !== doc.category) {
          await this.kb.assignDocs(kb.id, [existingDoc.id], doc.category)
        }
      } catch (err) {
        errors.push({ file: doc.name, error: `分类补齐失败：${(err as Error).message}` })
      }
    }

    // 6) 给新上传文档兜底分类（RAGFlow uploadDocs 的 category 已在服务端写入；这里 double-check）
    for (const item of newlyUploadedMeta) {
      try {
        const refreshed = (await this.kb.listDocs(kb.id)).docs.find(d => d.id === item.id)
        if (refreshed && refreshed.category !== item.doc.category) {
          await this.kb.assignDocs(kb.id, [item.id], item.doc.category)
        }
      } catch (err) {
        errors.push({ file: item.doc.name, error: `分类校验失败：${(err as Error).message}` })
      }
    }

    // 7) 触发解析（新上传的）
    const parsed: string[] = []
    if (parse && newlyUploadedIds.length > 0) {
      try {
        await this.kb.parseDocs(kb.id, newlyUploadedIds)
        parsed.push(...newlyUploadedIds)
      } catch (err) {
        errors.push({ file: '<batch-parse>', error: `批量解析失败：${(err as Error).message}` })
      }
    }

    return {
      kbId: kb.id,
      plan,
      uploaded,
      skipped,
      parsed,
      errors,
      durationMs: Date.now() - start
    }
  }

  /**
   * 补齐 6 个叶子分类。RAGFlow 服务端只存 meta 不存目录树，
   * 树存 RagflowKnowledgeService 本地注册表；这里幂等创建。
   */
  private async ensureCategories(kbId: string, plan: SampleLibraryKbDoc[]): Promise<void> {
    // 先建根节点
    const root = SAMPLE_LIBRARY_KB_TARGET.categoryRoot
    try {
      await this.kb.createCategory(kbId, root)
    } catch (err) {
      // 同名分类已存在是预期行为
      if (!(err as Error).message.includes('同名分类已存在')) {
        // 别的错误就抛出
        throw err
      }
    }
    // 再建每个叶子（用 unique set 避免重复）
    const leaves = new Set(plan.map(d => d.category))
    for (const leaf of leaves) {
      const sub = leaf.split('/')[1]
      if (!sub) continue
      try {
        await this.kb.createCategory(kbId, sub, root)
      } catch (err) {
        if (!(err as Error).message.includes('同名分类已存在')) throw err
      }
    }
  }

  /** UI 展示用：智能体名 + 目标库名 */
  static describeTarget(): { agentName: string; agentRole: string; kbName: string; description: string; categoryRoot: string } {
    const agent = KB_AGENTS.find(a => a.key === SAMPLE_LIBRARY_KB_TARGET.agentKey)
    return {
      agentName: agent?.name ?? '未知智能体',
      agentRole: agent?.role ?? '',
      kbName: SAMPLE_LIBRARY_KB_TARGET.kbName,
      description: SAMPLE_LIBRARY_KB_TARGET.description,
      categoryRoot: SAMPLE_LIBRARY_KB_TARGET.categoryRoot
    }
  }
}

export type { SampleLibraryKbDoc, SampleLibraryKbIngestResult }
