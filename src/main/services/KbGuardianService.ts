/**
 * 知识库守卫：技能注册表 + 定时调度 + 哈希差异增量更新。
 * - 持久化 userData/kb-guardian-skills.json（skills / 每技能文件哈希表 / 运行日志）
 * - 调度：每分钟 tick；daily=每天≥09:00 且当日未跑；weekly=每周一同规则；启动 60s 后补跑错过周期
 * - 串行队列：同一时刻仅一个技能运行，避免 RAGFlow 解析队列堆积
 * - 差异：sha256 未变跳过；新增上传；变化先删旧文档再上传（覆盖更新，避免旧 chunk 残留）
 * - 写入全部复用 RagflowKnowledgeService（uploadDocs/parseDocs/deleteDocs/listDocs）
 */
import { app, dialog } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import path from 'node:path'
import type { RagflowKnowledgeService } from './RagflowKnowledgeService'
import type { GuardianCategorySpec, GuardianRetryRequest, GuardianRetryResult, GuardianRunEvent, GuardianRunLog, GuardianRunOptions, GuardianRunTrigger, GuardianSkill, GuardianSkillInput, GuardianState, GuardianSyncMode } from '../../shared/kbGuardian'

const TICK_MS = 60_000
const CATCHUP_DELAY_MS = 60_000
const PARSE_POLL_MS = 4_000
const PARSE_TIMEOUT_MS = 5 * 60_000
const LOG_LIMIT_PER_SKILL = 20
const DAILY_HOUR = 9

type HashEntry = { hash: string; docId: string }
type PersistFile = { skills: GuardianSkill[]; hashes: Record<string, Record<string, HashEntry>>; logs: GuardianRunLog[] }

function startOfToday(): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

// 本周一 00:00（周日视为上周）
function startOfWeek(): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  const day = date.getDay() === 0 ? 7 : date.getDay()
  return date.getTime() - (day - 1) * 24 * 60 * 60 * 1000
}

// 能力代表主进程可选的“文件名 → 叶子分类”映射器（I.2 阶段新增）。
// 命中后 meta_fields.category 落这个值；未命中则回退到技能自身的 category
export type GuardianCategoryResolver = (fileName: string) => string | undefined

export class KbGuardianService {
  private data: PersistFile | null = null
  private running = new Set<string>()
  private queue: Promise<unknown> = Promise.resolve()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private kb: RagflowKnowledgeService,
    private emit: (event: GuardianRunEvent) => void,
    // I.2 阶段新增：可选的文件名→分类映射器（预置技能启动同步时注入）
    private categoryResolver?: GuardianCategoryResolver
  ) {}

  // I.2 阶段新增：后注入 resolver（解决 main.ts 启动顺序：kbGuardian 需在 launcher 可用后注入）
  setCategoryResolver(resolver: GuardianCategoryResolver | undefined): void {
    this.categoryResolver = resolver
  }

  private filePath(): string {
    return path.join(app.getPath('userData'), 'kb-guardian-skills.json')
  }

  private async load(): Promise<PersistFile> {
    if (this.data) return this.data
    try {
      const raw = await fsp.readFile(this.filePath(), 'utf8')
      const parsed = JSON.parse(raw) as Partial<PersistFile>
      this.data = {
        skills: Array.isArray(parsed.skills) ? parsed.skills : [],
        hashes: parsed.hashes && typeof parsed.hashes === 'object' ? parsed.hashes : {},
        logs: Array.isArray(parsed.logs) ? parsed.logs : []
      }
    } catch {
      this.data = { skills: [], hashes: {}, logs: [] }
    }
    // 兼容老持久化：补齐 I.2 阶段新增的 category/ensureCategories 字段
    for (const skill of this.data.skills) {
      if (typeof (skill as GuardianSkill & { category?: string }).category !== 'string') {
        (skill as GuardianSkill & { category?: string }).category = ''
      }
      if (!Array.isArray((skill as GuardianSkill & { ensureCategories?: GuardianCategorySpec[] }).ensureCategories)) {
        (skill as GuardianSkill & { ensureCategories?: GuardianCategorySpec[] }).ensureCategories = []
      }
      // I.5 阶段新增：补齐 syncMode 字段（老持久化缺省时为 'soft'，升纵到软同步）
      const mode = (skill as GuardianSkill & { syncMode?: GuardianSyncMode }).syncMode
      if (mode !== 'soft' && mode !== 'hard') {
        (skill as GuardianSkill & { syncMode?: GuardianSyncMode }).syncMode = 'soft'
      }
    }
    return this.data
  }

  private async save(): Promise<void> {
    if (!this.data) return
    try {
      await fsp.writeFile(this.filePath(), JSON.stringify(this.data, null, 2), 'utf8')
    } catch (error) {
      console.warn('[kb-guardian] 注册表写入失败：', (error as Error).message)
    }
  }

  // ─── 视图与 CRUD ─────────────────────────────────────────────────────────
  async state(): Promise<GuardianState> {
    const data = await this.load()
    return {
      skills: data.skills.map(skill => ({ ...skill, running: this.running.has(skill.id) })),
      logs: [...data.logs].sort((a, b) => b.startedAt - a.startedAt)
    }
  }

  async logs(skillId?: string): Promise<GuardianRunLog[]> {
    const data = await this.load()
    const list = skillId ? data.logs.filter(log => log.skillId === skillId) : data.logs
    return [...list].sort((a, b) => b.startedAt - a.startedAt)
  }

  private validate(input: GuardianSkillInput): void {
    if (!input.name.trim()) throw new Error('技能名称不能为空')
    if (!input.sourcePath.trim()) throw new Error('请先选择源目录')
    if (!input.fileExts.length) throw new Error('请至少选择一种文件类型')
    if (!input.targetKbId) throw new Error('请选择目标知识库')
  }

  async createSkill(input: GuardianSkillInput): Promise<GuardianSkill> {
    this.validate(input)
    const data = await this.load()
    const skill: GuardianSkill = {
      id: `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: input.name.trim(),
      sourceType: 'local-dir',
      sourcePath: input.sourcePath.trim(),
      fileExts: input.fileExts.map(ext => ext.toLowerCase()),
      targetKbId: input.targetKbId,
      targetKbName: input.targetKbName,
      frequency: input.frequency,
      enabled: input.enabled,
      category: (input.category ?? '').trim(),
      ensureCategories: (input.ensureCategories ?? []).map(spec => ({ name: spec.name.trim(), parent: spec.parent?.trim() })),
      // I.5 阶段新增：syncMode（缺省 soft）
      syncMode: input.syncMode ?? 'soft'
    }
    data.skills.push(skill)
    await this.save()
    return skill
  }

  async updateSkill(id: string, input: GuardianSkillInput): Promise<GuardianSkill> {
    this.validate(input)
    const data = await this.load()
    const skill = data.skills.find(item => item.id === id)
    if (!skill) throw new Error('技能不存在')
    // 目标库变更：旧哈希表的 docId 指向旧库，清空避免误删新库文档
    if (skill.targetKbId !== input.targetKbId) delete data.hashes[id]
    skill.name = input.name.trim()
    skill.sourcePath = input.sourcePath.trim()
    skill.fileExts = input.fileExts.map(ext => ext.toLowerCase())
    skill.targetKbId = input.targetKbId
    skill.targetKbName = input.targetKbName
    skill.frequency = input.frequency
    skill.enabled = input.enabled
    skill.category = (input.category ?? '').trim()
    skill.ensureCategories = (input.ensureCategories ?? []).map(spec => ({ name: spec.name.trim(), parent: spec.parent?.trim() }))
    // I.5 阶段新增：syncMode 同步写回（缺省 soft）
    skill.syncMode = input.syncMode ?? 'soft'
    await this.save()
    return { ...skill, running: this.running.has(id) }
  }

  async deleteSkill(id: string): Promise<void> {
    const data = await this.load()
    data.skills = data.skills.filter(skill => skill.id !== id)
    delete data.hashes[id]
    data.logs = data.logs.filter(log => log.skillId !== id)
    await this.save()
  }

  async pickDir(): Promise<string | null> {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择守卫源目录' })
    return result.canceled || !result.filePaths.length ? null : result.filePaths[0]
  }

  // ─── 调度 ───────────────────────────────────────────────────────────────
  startScheduler(): void {
    if (this.timer) return
    this.timer = setInterval(() => { void this.tick(false) }, TICK_MS)
    this.timer.unref?.()
  }

  // 启动补跑：app ready 后延迟调用，对错过周期的 daily/weekly 技能补跑一次
  scheduleCatchup(): void {
    const timer = setTimeout(() => { void this.tick(true) }, CATCHUP_DELAY_MS)
    timer.unref?.()
  }

  private due(skill: GuardianSkill, catchup: boolean): boolean {
    if (skill.frequency === 'manual') return false
    const last = skill.lastRunAt ?? 0
    const now = new Date()
    if (skill.frequency === 'daily') {
      return catchup ? last < startOfToday() : now.getHours() >= DAILY_HOUR && last < startOfToday()
    }
    return catchup ? last < startOfWeek() : now.getDay() === 1 && now.getHours() >= DAILY_HOUR && last < startOfWeek()
  }

  private async tick(catchup: boolean): Promise<void> {
    const data = await this.load()
    for (const skill of data.skills) {
      if (!skill.enabled || this.running.has(skill.id) || !this.due(skill, catchup)) continue
      this.enqueueRun(skill.id, catchup ? 'catchup' : 'schedule')
    }
  }

  // I.5 阶段新增：runNow 接收可选 options.syncMode（不改持久化，仅本次运行生效）
  async runNow(id: string, options?: GuardianRunOptions): Promise<{ queued: boolean; reason?: string }> {
    const data = await this.load()
    const skill = data.skills.find(item => item.id === id)
    if (!skill) return { queued: false, reason: '技能不存在' }
    if (this.running.has(id)) return { queued: false, reason: '该技能正在运行' }
    this.enqueueRun(id, 'manual', options)
    return { queued: true }
  }

  // 串行队列：链式排队，避免并发写入 RAGFlow
  private enqueueRun(skillId: string, trigger: GuardianRunTrigger, options?: GuardianRunOptions): void {
    this.queue = this.queue
      .then(() => this.runSkill(skillId, trigger, options))
      .catch(error => console.warn('[kb-guardian] 运行失败：', (error as Error).message))
  }

  // ─── 执行管线 ────────────────────────────────────────────────────────────
  private async runSkill(skillId: string, trigger: GuardianRunTrigger, options?: GuardianRunOptions): Promise<void> {
    const data = await this.load()
    const skill = data.skills.find(item => item.id === skillId)
    if (!skill || this.running.has(skillId)) return
    this.running.add(skillId)
    this.emit({ type: 'started', skillId })
    const startedAt = Date.now()
    let added = 0
    let updated = 0
    let skipped = 0
    let orphansRemoved = 0
    // I.7 阶段新增：软同步失败时自动回退到硬同步的次数（docId 失效/老版本 RAGFlow）
    let fallbackToHard = 0
    const failures: Array<{ name: string; reason: string }> = []

    try {
      const exts = new Set(skill.fileExts.map(ext => ext.toLowerCase()))
      let files: string[]
      try {
        files = await this.scanDir(skill.sourcePath, exts)
      } catch {
        files = []
        failures.push({ name: skill.sourcePath, reason: '源目录不存在或不可读' })
      }
      // I.2 阶段新增：先幂等补齐多级分类（保证后续 assignDocs 有父节点可查）
      const ensureSpecs = skill.ensureCategories ?? []
      for (const spec of ensureSpecs) {
        if (!spec.name) continue
        try {
          await this.kb.createCategory(skill.targetKbId, spec.name, spec.parent)
        } catch (error) {
          const message = (error as Error).message
          if (!message.includes('同名分类已存在') && !message.includes('父分类不存在')) {
            failures.push({ name: `[ensure-category:${spec.name}]`, reason: message })
          }
        }
      }
      const hashes = data.hashes[skillId] ?? (data.hashes[skillId] = {})
      const defaultCategory = (skill.category ?? '').trim()
      // I.5 阶段新增：有效同步模式（运行时 options 优先，其次技能本身，缺省 soft）
      const effectiveSyncMode: GuardianSyncMode = (options?.syncMode ?? skill.syncMode ?? 'soft')
      const total = files.length
      let processed = 0
      for (const relPath of files) {
        const absPath = path.join(skill.sourcePath, relPath)
        const basename = path.basename(absPath)
        // 分类三路合并：注入的 resolver  >  技能自身 category  >  不指定
        const resolved = this.categoryResolver?.(basename) ?? (defaultCategory || undefined)
        const outcome = await this.processOneFile(
          skill,
          relPath,
          absPath,
          resolved,
          effectiveSyncMode,
          hashes,
          options
        )
        added += outcome.added
        updated += outcome.updated
        skipped += outcome.skipped
        fallbackToHard += outcome.fallbackToHard
        if (outcome.failure) failures.push(outcome.failure)
        // J 阶段新增：每处理一个文件发一次 progress 事件，携带 processed / total / sinceStartMs + 增量统计
        processed += 1
        this.emit({
          type: 'progress',
          skillId,
          processed,
          total,
          sinceStartMs: Date.now() - startedAt,
          added,
          updated,
          skipped,
          fallbackToHard
        })
      }
      // I.6 阶段新增：孤儿文档清理（源文件被删/重命名后 KB 中残留的旧 docId）
      // - diff: Object.keys(hashes[skillId]) 中不在当前 files[] 里的 relPath 视为孤儿
      // - 受 options?.orphanCleanup !== false 控制（缺省 true）
      // - 单个孤儿失败 catch 不阻塞其他
      if (options?.orphanCleanup !== false) {
        const tracked = Object.keys(hashes)
        const fileSet = new Set(files)
        const orphanPaths = tracked.filter(rel => !fileSet.has(rel))
        for (const relPath of orphanPaths) {
          const orphan = hashes[relPath]
          if (!orphan?.docId) {
            delete hashes[relPath]
            continue
          }
          try {
            await this.kb.deleteDocs(skill.targetKbId, [orphan.docId])
            delete hashes[relPath]
            orphansRemoved += 1
          } catch (error) {
            failures.push({ name: relPath, reason: `清理孤儿失败：${(error as Error).message}` })
          }
        }
      }
    } finally {
      const finishedAt = Date.now()
      const status = failures.length === 0 ? 'ok' : added + updated > 0 ? 'partial' : 'failed'
      const log: GuardianRunLog = {
        id: `run-${finishedAt.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        skillId,
        skillName: skill.name,
        startedAt,
        finishedAt,
        status,
        trigger,
        added,
        updated,
        skipped,
        orphansRemoved,
        // I.7 阶段新增：软同步回退到硬同步的次数
        fallbackToHard,
        failures
      }
      // 日志保留策略：当前技能保留最近 20 条，其余技能合计保留最近 180 条（全局截断会误删当前技能旧日志）
      const own = [log, ...data.logs.filter(item => item.skillId === skillId)].slice(0, LOG_LIMIT_PER_SKILL)
      const others = data.logs.filter(item => item.skillId !== skillId).slice(0, 180)
      data.logs = [...own, ...others]
      skill.lastRunAt = finishedAt
      skill.lastStats = { added, updated, skipped, failed: failures.length, orphansRemoved, fallbackToHard }
      await this.save()
      this.running.delete(skillId)
      this.emit({ type: 'finished', skillId })
    }
  }

  // J 阶段新增：处理单个文件的同步（runSkill 和 retryFailedFiles 复用）
  // - 走 runSkill 原内层循环逻辑：hash 跳过 / soft + softFallbackHard / hard + delete
  // - 不改 hashes[relPath] 以外的状态
  // - 出现任何失败都 catch 后返回 failure 项；不抛错外层
  // 返回值: { added, updated, skipped, fallbackToHard, failure? }
  private async processOneFile(
    skill: GuardianSkill,
    relPath: string,
    absPath: string,
    resolved: string | undefined,
    effectiveSyncMode: GuardianSyncMode,
    hashes: Record<string, HashEntry>,
    options?: GuardianRunOptions
  ): Promise<{
    added: number
    updated: number
    skipped: number
    fallbackToHard: number
    failure?: { name: string; reason: string }
  }> {
    let added = 0
    let updated = 0
    let skipped = 0
    let fallbackToHard = 0
    try {
      const buffer = await fsp.readFile(absPath)
      const hash = createHash('sha256').update(buffer).digest('hex')
      const entry = hashes[relPath]
      if (entry && entry.hash === hash) {
        skipped += 1
        return { added, updated, skipped, fallbackToHard }
      }
      let docId: string
      let softSyncHandled = false  // 软同步成功且不需要回退时为 true（避免软+硬都走时重复 ++updated）
      // I.5 阶段新增：软/硬两路同步
      if (entry && effectiveSyncMode === 'soft') {
        // soft：保留旧 docId，调用 RAGFlow update_doc 替换文件 + 重解析
        try {
          docId = await this.updateAndParse(skill.targetKbId, entry.docId, absPath)
          softSyncHandled = true
        } catch (softError) {
          // I.7 阶段新增：软同步失败时自动回退到硬同步（docId 失效/老版本 RAGFlow）
          // - 受 options?.softFallbackHard !== false 控制（缺省 true）
          // - 硬回退独立 try/catch，软+硬双错才计入 failure
          if (options?.softFallbackHard !== false) {
            try {
              await this.kb.deleteDocs(skill.targetKbId, [entry.docId])
              docId = await this.uploadAndParse(skill.targetKbId, absPath, resolved)
              updated += 1
              fallbackToHard += 1
            } catch (fallbackError) {
              return {
                added,
                updated,
                skipped,
                fallbackToHard,
                failure: {
                  name: relPath,
                  reason: `软同步 + 硬回退均失败：软=${(softError as Error).message}；硬=${(fallbackError as Error).message}`
                }
              }
            }
          } else {
            return {
              added,
              updated,
              skipped,
              fallbackToHard,
              failure: { name: relPath, reason: `软同步更新失败：${(softError as Error).message}` }
            }
          }
        }
        if (softSyncHandled) updated += 1
      } else {
        // hard 或新增：hard 先删旧 docId，然后上传新文件 + 重解析
        if (entry) {
          try {
            await this.kb.deleteDocs(skill.targetKbId, [entry.docId])
          } catch (error) {
            return {
              added,
              updated,
              skipped,
              fallbackToHard,
              failure: { name: relPath, reason: `删除旧文档失败：${(error as Error).message}` }
            }
          }
        }
        docId = await this.uploadAndParse(skill.targetKbId, absPath, resolved)
        if (entry) updated += 1
        else added += 1
      }
      hashes[relPath] = { hash, docId }
    } catch (error) {
      return {
        added,
        updated,
        skipped,
        fallbackToHard,
        failure: { name: relPath, reason: (error as Error).message }
      }
    }
    return { added, updated, skipped, fallbackToHard }
  }

  // J 阶段新增：按 logId 重试该次运行中所有失败的文件
  // - 不修改 runSkill；不触发 run-event；不写新的 GuardianRunLog（重试结果仅返回给 UI）
  // - 复用 processOneFile 走 soft + softFallbackHard 路径
  // - 单文件 catch 不抛错；返回明细
  // - 只重试仍存在于源目录 + 仍在 fileExts 内的文件（被删的文件计入 skipped）
  // - 写回 hashes[relPath] 让重试成功的文件后续 runSkill 走 hash 跳过分支
  async retryFailedFiles(request: GuardianRetryRequest): Promise<GuardianRetryResult> {
    const data = await this.load()
    const skill = data.skills.find(item => item.id === request.skillId)
    if (!skill) throw new Error('技能不存在')
    if (!skill.enabled) throw new Error('技能已禁用')
    if (this.running.has(skill.id)) throw new Error('该技能正在运行，请等待完成后再试')
    const log = data.logs.find(item => item.id === request.logId && item.skillId === request.skillId)
    if (!log) throw new Error('日志不存在')
    if (!log.failures.length) {
      return { retried: 0, succeeded: 0, skipped: 0, failed: 0, failures: [] }
    }
    // 1) 重试时只跑那些文件名前的扩展名仍在 fileExts 内的失败项
    const exts = new Set(skill.fileExts.map(ext => ext.toLowerCase()))
    const failedNames = log.failures.map(f => f.name)
    // 2) 重新扫描源目录，过滤出仍存在的失败文件
    let currentFiles: string[]
    try {
      currentFiles = await this.scanDir(skill.sourcePath, exts)
    } catch (error) {
      throw new Error(`源目录扫描失败：${(error as Error).message}`)
    }
    const currentSet = new Set(currentFiles)
    const targets = failedNames.filter(name => currentSet.has(name) && exts.has(path.extname(name).toLowerCase()))
    const skipped = failedNames.length - targets.length
    // 3) 复用 I.5/I.6/I.7 路径：effectiveSyncMode + softFallbackHard 默认值
    const effectiveSyncMode: GuardianSyncMode = skill.syncMode ?? 'soft'
    const hashes = data.hashes[skill.id] ?? (data.hashes[skill.id] = {})
    const defaultCategory = (skill.category ?? '').trim()
    const retryOptions: GuardianRunOptions = { softFallbackHard: true }
    let succeeded = 0
    let retried = 0
    const newFailures: Array<{ name: string; reason: string }> = []
    // J 阶段新增：重试路径也发 progress 事件，让 UI 在 retryFailedFiles 期间也能看到进度条
    // - added/updated/skipped/fallbackToHard 不带（重试语义不同；succeeded 通过事件外的 setNotice 反映）
    const retryStartedAt = Date.now()
    const total = targets.length
    let processed = 0
    // J 阶段新增：重试起始事件（让 UI 进入 retry 进度模式）—— 复用 progress 类型
    this.emit({ type: 'progress', skillId: skill.id, processed: 0, total, sinceStartMs: 0 })
    for (const relPath of targets) {
      const absPath = path.join(skill.sourcePath, relPath)
      const basename = path.basename(absPath)
      const resolved = this.categoryResolver?.(basename) ?? (defaultCategory || undefined)
      retried += 1
      const outcome = await this.processOneFile(
        skill,
        relPath,
        absPath,
        resolved,
        effectiveSyncMode,
        hashes,
        retryOptions
      )
      if (outcome.failure) {
        newFailures.push(outcome.failure)
      } else {
        // 同步成功：added/updated 任一非零即算 succeeded
        if (outcome.added + outcome.updated > 0) succeeded += 1
        else if (outcome.skipped > 0) {
          // hash 跳过：文件未变化；按 succeeded 计（已经达到目标状态）
          succeeded += 1
        }
      }
      // J 阶段新增：每处理一个失败文件发一次 progress 事件
      processed += 1
      this.emit({
        type: 'progress',
        skillId: skill.id,
        processed,
        total,
        sinceStartMs: Date.now() - retryStartedAt
      })
    }
    // 4) 重试过程也会写回 hashes 与 runSkill 相同；为不污染 lastStats，此处仅写回 hashes 不更新 lastStats
    // （lastStats 仍是上一次完整 runSkill 的结果；重试是独立操作，不刷新最后运行结果）
    await this.save()
    return {
      retried,
      succeeded,
      skipped,
      failed: newFailures.length,
      failures: newFailures
    }
  }

  private async uploadAndParse(kbId: string, absPath: string, category?: string): Promise<string> {
    const ids = await this.kb.uploadDocs(kbId, [absPath], category)
    if (!ids.length) throw new Error('上传未返回文档 ID')
    await this.kb.parseDocs(kbId, ids)
    await this.waitParse(kbId, ids[0])
    return ids[0]
  }

  // I.5 阶段新增：软同步专用路径（保留 docId，调用 RAGFlow update_doc 替换文件 + 重解析）
  private async updateAndParse(kbId: string, docId: string, absPath: string): Promise<string> {
    await this.kb.updateDoc(kbId, docId, absPath)
    await this.kb.parseDocs(kbId, [docId])
    await this.waitParse(kbId, docId)
    return docId
  }

  // 轮询解析状态至 DONE；FAIL/CANCEL 抛错；5 分钟超时记失败不阻塞其余
  private async waitParse(kbId: string, docId: string): Promise<void> {
    const deadline = Date.now() + PARSE_TIMEOUT_MS
    for (;;) {
      const view = await this.kb.listDocs(kbId)
      const doc = view.docs.find(item => item.id === docId)
      if (!doc) throw new Error('解析中文档丢失')
      if (doc.run === 'DONE') return
      if (doc.run === 'FAIL' || doc.run === 'CANCEL') throw new Error(`解析${doc.run === 'FAIL' ? '失败' : '被停止'}`)
      if (Date.now() > deadline) throw new Error('解析超时（5 分钟）')
      await new Promise(resolve => setTimeout(resolve, PARSE_POLL_MS))
    }
  }

  // 递归扫描源目录，按扩展名过滤，返回相对路径（排序保证稳定顺序）
  private async scanDir(root: string, exts: Set<string>): Promise<string[]> {
    const results: string[] = []
    const walk = async (dir: string): Promise<void> => {
      const entries = await fsp.readdir(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        const abs = path.join(dir, entry.name)
        if (entry.isDirectory()) await walk(abs)
        else if (entry.isFile() && exts.has(path.extname(entry.name).toLowerCase())) results.push(path.relative(root, abs))
      }
    }
    await walk(root)
    return results.sort()
  }
}
