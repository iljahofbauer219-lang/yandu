/**
 * 报告样例库在线预览（G 阶段新增）。
 *
 * 数据源：artifacts/online-advisor-parity/sample-{A,B,C,D}-*.md + .docx
 *
 * UI 结构：
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  📚 报告样例库（G 阶段新增）  v1.2 决策可追溯 4 样例            │
 *   ├────────────┬─────────────────────────────────────────────────┤
 *   │ 4 卡片列表 │ 选中样例渲染区                                    │
 *   │  A ✅      │  [📄 Markdown 原文] [📦 打开 .docx]              │
 *   │  B ⚠️      │  ─────────────────────────────────────────       │
 *   │  C ❌      │  ReactMarkdown 渲染区 / .docx 系统打开提示         │
 *   │  D ❓      │                                                 │
 *   └────────────┴─────────────────────────────────────────────────┘
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  SAMPLE_DECISION_TOKENS,
  assertDecisionConsistency,
  extractReportMetadata,
  listSampleLetters,
  loadSampleLibrary,
  loadSampleMarkdown,
  type LoadedSample,
  type LoadError,
  type SampleLetter,
  type SampleMeta
} from '../shared/sampleLibrary'
import './sample-library.css'

type RenderTab = 'markdown' | 'docx'

const LETTER_DESCRIPTIONS: Record<SampleLetter, string> = {
  A: '全部证据完整 + 利润达标',
  B: '合规证据偏短（< 8 字符）',
  C: '成本过重，定价不可行',
  D: '23 evidence 全未核验'
}

type IngestStatus =
  | { phase: 'idle' }
  | { phase: 'loading-target' }
  | { phase: 'previewing' }
  | { phase: 'ingesting' }
  | { phase: 'done'; summary: { uploaded: number; skipped: number; parsed: number; errors: number; durationMs: number; kbName: string } }
  | { phase: 'error'; message: string }

// I.2 阶段新增：守卫状态
type GuardianStatus =
  | { phase: 'loading' }
  | { phase: 'launching' }
  // I.6 阶段新增：lastStats 补 orphansRemoved（孤儿文档清理数）
  // I.7 阶段新增：lastStats 补 fallbackToHard（软→硬回退次数）
  | { phase: 'present'; skill: { id: string; name: string; sourcePath: string; frequency: string; enabled: boolean; syncMode?: 'soft' | 'hard'; lastRunAt?: number; lastStats?: { added: number; updated: number; skipped: number; failed: number; orphansRemoved?: number; fallbackToHard?: number } } }
  | { phase: 'absent' }
  | { phase: 'error'; message: string }

export default function SampleLibrary({ onBackToHub }: { onBackToHub?: () => void }) {
  const library: SampleMeta[] = useMemo(() => loadSampleLibrary(), [])
  const [activeLetter, setActiveLetter] = useState<SampleLetter>('A')
  const [activeTab, setActiveTab] = useState<RenderTab>('markdown')
  const [sample, setSample] = useState<LoadedSample | LoadError | null>(null)
  const [loading, setLoading] = useState(false)
  const [openDocxStatus, setOpenDocxStatus] = useState<string>('')
  const [ingest, setIngest] = useState<IngestStatus>({ phase: 'idle' })
  const [targetLabel, setTargetLabel] = useState<{ agentName: string; kbName: string; categoryRoot: string } | null>(null)
  // I.2 阶段新增：守卫状态
  const [guardian, setGuardian] = useState<GuardianStatus>({ phase: 'loading' })
  // J 阶段新增：守卫运行进度条状态
  // - runStartedAt：记录 started 事件发生时间；finished 时清理
  // - progress：主进程推来的最近一次 progress 事件
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [progress, setProgress] = useState<{ processed: number; total: number; sinceStartMs: number; added?: number; updated?: number; skipped?: number; fallbackToHard?: number } | null>(null)
  // J 阶段新增：ticker 每秒触发重渲染
  const [, setTick] = useState(0)
  // actuallyRunning：仅在收到 started 事件后为 true，收到 finished 后立即清零
  const actuallyRunning = guardian.phase === 'present' && runStartedAt !== null
  useEffect(() => {
    if (!actuallyRunning) return
    const timer = setInterval(() => setTick(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [actuallyRunning])
  // J 阶段新增：订阅 run-event
  useEffect(() => {
    const api = window.desktop?.kbGuardian
    if (!api?.onRunEvent) return
    return api.onRunEvent(event => {
      if (event.type === 'started') {
        setRunStartedAt(Date.now())
        setProgress(null)
      } else if (event.type === 'progress') {
        setProgress(event)
      } else if (event.type === 'finished') {
        setRunStartedAt(null)
        setProgress(null)
      }
    })
  }, [])

  // 选中样例变化时重新加载 markdown
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setOpenDocxStatus('')
    Promise.resolve().then(() => {
      const loaded = loadSampleMarkdown(activeLetter)
      if (!cancelled) {
        setSample(loaded)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [activeLetter])

  const activeMeta = useMemo(() => library.find(s => s.letter === activeLetter) ?? null, [library, activeLetter])

  const metadata = useMemo(() => {
    if (!sample || !sample.ok) return null
    return extractReportMetadata(sample.content)
  }, [sample])

  const consistency = useMemo(() => {
    if (!sample || !sample.ok || !activeMeta) return null
    return assertDecisionConsistency(activeMeta, sample.content)
  }, [sample, activeMeta])

  // 一次拉取目标 KB 描述（轻量IPC 调 3 个：describe / 静默），出错时也不阻塞预览
  useEffect(() => {
    const api = window.desktop?.aiEmployee?.sampleLibraryKb
    if (!api?.describe) return
    let cancelled = false
    Promise.resolve()
      .then(() => api.describe())
      .then((info) => {
        if (cancelled) return
        setTargetLabel({ agentName: info.agentName, kbName: info.kbName, categoryRoot: info.categoryRoot })
      })
      .catch(() => {
        if (cancelled) return
        setTargetLabel(null)
      })
    return () => { cancelled = true }
  }, [])

  // I.2 阶段新增：拉取守卫状态（启动时静默拉一次，状态有变化时重拉）
  const refreshGuardian = useCallback(async () => {
    const api = window.desktop?.aiEmployee?.sampleLibraryKb
    if (!api?.guardianStatus) return
    try {
      const result = await api.guardianStatus()
      if (result.present && result.skill) {
        setGuardian({
          phase: 'present',
          skill: {
            id: result.skill.id,
            name: result.skill.name,
            sourcePath: result.skill.sourcePath,
            frequency: result.skill.frequency,
            enabled: Boolean(result.skill.enabled),
            syncMode: (result.skill.syncMode ?? 'soft') as 'soft' | 'hard',
            lastRunAt: result.skill.lastRunAt,
            // I.6 阶段新增：补 orphansRemoved 字段（老 I.5 持久化缺省时为 0）
            // I.7 阶段新增：补 fallbackToHard 字段（老 I.6 持久化缺省时为 0）
            lastStats: result.skill.lastStats
              ? {
                  added: result.skill.lastStats.added,
                  updated: result.skill.lastStats.updated,
                  skipped: result.skill.lastStats.skipped,
                  failed: result.skill.lastStats.failed,
                  orphansRemoved: result.skill.lastStats.orphansRemoved ?? 0,
                  fallbackToHard: result.skill.lastStats.fallbackToHard ?? 0
                }
              : undefined
          }
        })
      } else {
        setGuardian({ phase: 'absent' })
      }
    } catch (err) {
      setGuardian({ phase: 'error', message: (err as Error).message })
    }
  }, [])

  useEffect(() => {
    void refreshGuardian()
  }, [refreshGuardian])

  const handleIngest = async () => {
    const api = window.desktop?.aiEmployee?.sampleLibraryKb
    if (!api?.ingest) {
      setIngest({ phase: 'error', message: '当前环境未注入 sampleLibraryKb.ingest API（请更新 main / preload）' })
      return
    }
    setIngest({ phase: 'previewing' })
    try {
      const preview = await api.preview()
      const label = targetLabel ?? { agentName: preview.kb.name, kbName: preview.kb.name, categoryRoot: preview.summary.categoryRoot }
      setTargetLabel(label)
      setIngest({ phase: 'ingesting' })
      const result = await api.ingest({ parse: true })
      setIngest({
        phase: 'done',
        summary: {
          uploaded: result.uploaded.length,
          skipped: result.skipped.length,
          parsed: result.parsed.length,
          errors: result.errors.length,
          durationMs: result.durationMs,
          kbName: label.kbName
        }
      })
    } catch (err) {
      setIngest({ phase: 'error', message: (err as Error).message })
    }
  }

  // I.2 阶段新增：启用守卫（创建预置技能并立即跑一次）
  const handleLaunchGuardian = async () => {
    const api = window.desktop?.aiEmployee?.sampleLibraryKb
    if (!api?.launch) {
      setGuardian({ phase: 'error', message: '当前环境未注入 sampleLibraryKb.launch API（请更新 main / preload）' })
      return
    }
    setGuardian({ phase: 'launching' })
    try {
      await api.launch()
      await refreshGuardian()
    } catch (err) {
      setGuardian({ phase: 'error', message: (err as Error).message })
    }
  }

  // I.2 阶段新增：立即同步（仅调用 runNow，技能需已存在）
  const handleRunNowGuardian = async () => {
    const api = window.desktop?.aiEmployee?.sampleLibraryKb
    if (!api?.launch) return
    if (guardian.phase !== 'present') return
    try {
      setGuardian({ phase: 'launching' })
      await api.launch()
      await refreshGuardian()
    } catch (err) {
      setGuardian({ phase: 'error', message: (err as Error).message })
    }
  }
  // J 阶段新增：重试状态（与 launching 互不干扰，红 chip 点重试时独立打转）
  const [retrying, setRetrying] = useState(false)
  const [retryNotice, setRetryNotice] = useState<{ ok: boolean; msg: string } | null>(null)
  // J 阶段新增：一键重试 = 拉该 skill 的 logs → 找最后一条有失败的 log → 调 retryFailed
  const handleRetryLastFailed = async () => {
    if (guardian.phase !== 'present') return
    const api = window.desktop?.kbGuardian
    if (!api?.logs || !api?.retryFailed) {
      setRetryNotice({ ok: false, msg: '当前环境未注入 kbGuardian.retryFailed API' })
      return
    }
    setRetrying(true)
    setRetryNotice(null)
    try {
      const skillId = guardian.skill.id
      const logs = await api.logs(skillId)
      // 优先选最后一条有失败项的；没有失败项的依然取最近一条（用户点的时候是“最近一次”）
      const target = [...logs].reverse().find(item => item.failures.length > 0) ?? logs[0]
      if (!target) {
        setRetryNotice({ ok: false, msg: '该技能尚无运行日志，无法重试' })
        return
      }
      const result = await api.retryFailed({ skillId, logId: target.id })
      const okMsg = `重试完成：处理 ${result.retried} · 成功 ${result.succeeded} · 跳过 ${result.skipped} · 仍失败 ${result.failed}`
      setRetryNotice({ ok: result.failed === 0, msg: okMsg })
      await refreshGuardian()
    } catch (err) {
      setRetryNotice({ ok: false, msg: (err as Error).message })
    } finally {
      setRetrying(false)
    }
  }

  // I.5 阶段新增：切换 syncMode（软同步 ⇄ 硬同步）。调现有 kbGuardian.update IPC 不重加新入口
  const handleToggleSyncMode = async () => {
    if (guardian.phase !== 'present') return
    const nextMode: 'soft' | 'hard' = (guardian.skill.syncMode ?? 'soft') === 'soft' ? 'hard' : 'soft'
    const api = window.desktop?.kbGuardian
    if (!api?.update) {
      setGuardian({ phase: 'error', message: '当前环境未注入 kbGuardian.update API' })
      return
    }
    try {
      // 从 state() 拿当前 skill 完整字段，传给 update 以保证其他字段不变
      const state = await api.state()
      const current = state.skills.find(s => s.id === guardian.skill!.id)
      if (!current) {
        setGuardian({ phase: 'error', message: '找不到当前守卫技能' })
        return
      }
      await api.update(current.id, {
        name: current.name,
        sourcePath: current.sourcePath,
        fileExts: current.fileExts,
        targetKbId: current.targetKbId,
        targetKbName: current.targetKbName,
        frequency: current.frequency,
        enabled: current.enabled,
        category: current.category,
        ensureCategories: current.ensureCategories,
        syncMode: nextMode
      })
      await refreshGuardian()
    } catch (err) {
      setGuardian({ phase: 'error', message: (err as Error).message })
    }
  }

  const handleOpenDocx = async () => {
    if (!activeMeta) return
    setOpenDocxStatus('正在调起系统应用打开 .docx …')
    try {
      const api = window.desktop?.aiEmployee?.sampleLibrary
      if (!api?.openDocx) {
        setOpenDocxStatus('当前环境未注入 openDocx API（开发模式下可手动打开文件）')
        return
      }
      const result = await api.openDocx({ filePath: activeMeta.docxPath })
      if (result.ok) {
        setOpenDocxStatus(`✅ 已调起系统应用打开：${activeMeta.docxFile}`)
      } else {
        setOpenDocxStatus(`⚠️ 打开失败：${result.error ?? '未知错误'}（路径：${activeMeta.docxPath}）`)
      }
    } catch (err) {
      setOpenDocxStatus(`⚠️ 异常：${(err as Error).message}`)
    }
  }

  return (
    <section className="sample-library">
      <header className="sample-library-header">
        <div>
          <h2>📚 报告样例库</h2>
          <p>v1.2 决策可追溯 · 4 真实样例覆盖 4 种决策 · 决策系统结论 = 报告最终结论</p>
        </div>
        <div className="sample-library-header-actions">
          <div className="sample-library-ingest-info">
            {targetLabel ? (
              <span className="sample-library-ingest-target">
                🎯 目标：<b>{targetLabel.agentName}</b> · {targetLabel.kbName} · 多级分类「{targetLabel.categoryRoot}」
              </span>
            ) : (
              <span className="sample-library-ingest-target muted">未检测到目标 KB 描述（需在 AI 参谋中打开）</span>
            )}
          </div>
          <button
            type="button"
            className="sample-library-ingest-btn"
            onClick={handleIngest}
            disabled={ingest.phase === 'previewing' || ingest.phase === 'ingesting' || ingest.phase === 'loading-target'}
            title="把 4 样例 + 决策门禁 + 决策可追溯硬约束一键上传到「选品分析师」RAGFlow 知识库"
          >
            {ingest.phase === 'previewing' ? '⏳ 预览中…'
              : ingest.phase === 'ingesting' ? '⏳ 入库中…'
              : ingest.phase === 'loading-target' ? '⏳ 准备中…'
              : '📥 一键入库到知识库'}
          </button>
          {/* I.2 阶段新增：守卫启用/立即同步按钮 */}
          {(() => {
            const phase = guardian.phase
            const isLaunching = phase === 'launching'
            if (phase === 'present') {
              return (
                <button
                  type="button"
                  className="sample-library-guardian-btn secondary"
                  onClick={handleRunNowGuardian}
                  disabled={isLaunching}
                  title="立即按 sha256 差异更新 KB（无变化则全部 skipped）"
                >
                  {isLaunching ? '⏳ 同步中…' : '🔄 立即同步'}
                </button>
              )
            }
            return (
              <button
                type="button"
                className="sample-library-guardian-btn"
                onClick={handleLaunchGuardian}
                disabled={isLaunching || phase === 'loading'}
                title="注册「报告样例库自动同步」预置守卫技能，以后每天 ≥ 09:00 自动按 sha256 差异更新"
              >
                {isLaunching ? '⏳ 启用中…'
                  : phase === 'loading' ? '⏳ 状态加载中…'
                  : '🛡 启用守卫自动同步'}
              </button>
            )
          })()}
        </div>
        {onBackToHub && (
          <button className="sample-library-back" onClick={onBackToHub} type="button">
            ← 返回 AI 参谋
          </button>
        )}
      </header>

      {/* I 阶段新增：入库结果面板 */}
      {ingest.phase === 'done' && (
        <div className="sample-library-ingest-result ok" role="status">
          ✅ 入库完成 · 上传 <b>{ingest.summary.uploaded}</b> · 跳过 <b>{ingest.summary.skipped}</b> · 解析 <b>{ingest.summary.parsed}</b> · 错误 <b>{ingest.summary.errors}</b> · 耗时 {ingest.summary.durationMs}ms · 目标 <b>{ingest.summary.kbName}</b>
        </div>
      )}
      {ingest.phase === 'error' && (
        <div className="sample-library-ingest-result err" role="alert">
          ⚠️ 入库失败：{ingest.message}
        </div>
      )}

      {/* I.2 阶段新增：守卫状态卡 */}
      {guardian.phase === 'present' && (
        <div className="sample-library-guardian-card ok" role="status">
          <div className="sample-library-guardian-card-head">
            <b>🛡 守卫自动同步已启用</b>
            <span>频率：{guardian.skill.frequency} · 源：{guardian.skill.sourcePath.split('/').slice(-2).join('/')}</span>
          </div>
          <div className="sample-library-guardian-card-stats">
            {/* I.5 阶段新增：同步模式 chip + 切换按钮 */}
            同步模式：<b style={{ color: (guardian.skill.syncMode ?? 'soft') === 'soft' ? '#0d9488' : '#b45309' }}>
              {(guardian.skill.syncMode ?? 'soft') === 'soft' ? '🟢 软同步（保留旧 docId）' : '🟠 硬同步（先删旧再传新）'}
            </b>
            {' · '}
            <button
              type="button"
              className="sample-library-guardian-sync-mode-btn"
              onClick={handleToggleSyncMode}
              title={(guardian.skill.syncMode ?? 'soft') === 'soft'
                ? '点击切换为硬同步（I.2 默认行为：先删旧 docId 再传新，丢旧 chunk）'
                : '点击切换为软同步（推荐：保留旧 docId + RAGFlow update_doc 替换文件，重解析期间旧 chunk 仍可检索）'}
            >
              切到 {(guardian.skill.syncMode ?? 'soft') === 'soft' ? '硬同步' : '软同步'}
            </button>
          </div>
          {guardian.skill.lastRunAt ? (
            <div className="sample-library-guardian-card-stats">
              最近一次同步：<b>{new Date(guardian.skill.lastRunAt).toLocaleString('zh-CN', { hour12: false })}</b>
              {/* J 阶段新增：> 30s 长时运行进度条（actuallyRunning 为 true 且 elapsed > 30s） */}
              {(() => {
                const elapsed = progress?.sinceStartMs ?? (runStartedAt ? Date.now() - runStartedAt : 0)
                const showProgress = actuallyRunning && elapsed > 30_000
                if (!showProgress) return null
                const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.processed / progress.total) * 100)) : null
                return (
                  <div className="sample-library-guardian-progress" role="status" aria-live="polite">
                    <div className="sample-library-guardian-progress-text">
                      ⏳ 已运行 <b>{Math.floor(elapsed / 1000)}s</b>
                      {progress && <> · 已处理 <b>{progress.processed}</b>/<b>{progress.total || '?'}</b></>}
                      {progress?.added !== undefined && <> · 新增 <b>{progress.added}</b></>}
                      {progress?.updated !== undefined && <> · 更新 <b>{progress.updated}</b></>}
                      {progress?.skipped !== undefined && progress.skipped > 0 && <> · 跳过 <b>{progress.skipped}</b></>}
                      {progress?.fallbackToHard !== undefined && progress.fallbackToHard > 0 && <> · 软→硬 <b>{progress.fallbackToHard}</b></>}
                    </div>
                    <div className={`sample-library-guardian-progress-bar ${percent === null ? 'indeterminate' : ''}`}>
                      {percent !== null ? (
                        <div className="sample-library-guardian-progress-bar-fill" style={{ width: `${percent}%` }} />
                      ) : (
                        <div className="sample-library-guardian-progress-bar-indet" />
                      )}
                    </div>
                  </div>
                )
              })()}
              {guardian.skill.lastStats && (
                <>
                  {' '}· 新增 <b>{guardian.skill.lastStats.added}</b>
                  {' '}· 更新 <b>{guardian.skill.lastStats.updated}</b>
                  {' '}· 跳过 <b>{guardian.skill.lastStats.skipped}</b>
                  {guardian.skill.lastStats.failed > 0 && (
                    <>
                      {' '}· <span className="sample-library-guardian-stat failed" title="本次运行失败的文件数（可点右侧「🔁 一键重试」重跑）">失败 <b>{guardian.skill.lastStats.failed}</b></span>
                      <button
                        type="button"
                        className="sample-library-guardian-retry-btn"
                        onClick={handleRetryLastFailed}
                        disabled={retrying}
                        title="拉取该技能的最近一次失败运行，重试其中所有失败文件"
                      >
                        {retrying ? '⏳ 重试中…' : '🔁 一键重试'}
                      </button>
                    </>
                  )}
                  {/* I.6 阶段新增：孤儿清理统计（仅 > 0 时显示） */}
                  {(guardian.skill.lastStats.orphansRemoved ?? 0) > 0 && (
                    <> · <span className="sample-library-guardian-stat orphans" title="源文件被删/重命名后，KB 中残留的旧 docId 已被自动清理">🧹 孤儿清理 <b>{guardian.skill.lastStats.orphansRemoved}</b></span></>
                  )}
                  {/* I.7 阶段新增：软→硬回退 chip（仅 > 0 显示） */}
                  {(guardian.skill.lastStats.fallbackToHard ?? 0) > 0 && (
                    <> · <span className="sample-library-guardian-stat fallback" title="软同步（update_doc）失败时已自动回退到硬同步（先删旧 docId 再传新）">🔁 软→硬回退 <b>{guardian.skill.lastStats.fallbackToHard}</b></span></>
                  )}
                </>
              )}
              {retryNotice && (
                <div className={`sample-library-ingest-result ${retryNotice.ok ? 'ok' : 'err'}`} role="status">
                  {retryNotice.ok ? '✅' : '⚠️'} {retryNotice.msg}
                </div>
              )}
            </div>
          ) : (
            <div className="sample-library-guardian-card-stats">尚未运行过（每日 ≥ 09:00 自动检测，或点上方「🔄 立即同步」手动跑）</div>
          )}
        </div>
      )}
      {guardian.phase === 'absent' && (
        <div className="sample-library-guardian-card idle" role="status">
          <b>🛡 守卫自动同步未启用</b>
          <span>点上方按钮注册预置技能后，每日 ≥ 09:00 自动按 sha256 差异更新 KB；任一文档修改都会触发增量重新上传。</span>
        </div>
      )}
      {guardian.phase === 'error' && (
        <div className="sample-library-guardian-card err" role="alert">
          ⚠️ 守卫状态加载失败：{guardian.message}
        </div>
      )}

      <div className="sample-library-grid">
        {/* ── 左侧 4 样例卡片 ── */}
        <aside className="sample-library-list" aria-label="样例列表">
          {library.map(meta => {
            const token = SAMPLE_DECISION_TOKENS[meta.decision]
            const isActive = meta.letter === activeLetter
            return (
              <button
                key={meta.letter}
                type="button"
                className={`sample-library-card${isActive ? ' active' : ''}`}
                onClick={() => setActiveLetter(meta.letter)}
                style={{ borderLeftColor: token.accentColor, background: isActive ? token.bgColor : undefined }}
              >
                <div className="sample-library-card-head">
                  <span className="sample-library-letter" style={{ background: token.accentColor, color: '#fff' }}>{meta.letter}</span>
                  <span className="sample-library-decision" style={{ color: token.textColor, background: token.bgColor }}>{meta.decision}</span>
                </div>
                <div className="sample-library-card-title">{meta.title}</div>
                <div className="sample-library-card-desc">{LETTER_DESCRIPTIONS[meta.letter]}</div>
                <div className="sample-library-card-metrics">
                  {meta.keyMetrics.baseMargin !== null && (
                    <span className="sample-library-metric">
                      <b style={{ color: meta.keyMetrics.baseMargin >= 30 ? '#047857' : meta.keyMetrics.baseMargin >= 0 ? '#b45309' : '#b91c1c' }}>
                        毛利 {meta.keyMetrics.baseMargin.toFixed(1)}%
                      </b>
                    </span>
                  )}
                  {meta.keyMetrics.downsideProfit !== null && (
                    <span className="sample-library-metric">
                      <b style={{ color: meta.keyMetrics.downsideProfit >= 0 ? '#047857' : '#b91c1c' }}>
                        悲观 ${meta.keyMetrics.downsideProfit.toFixed(2)}
                      </b>
                    </span>
                  )}
                  {meta.keyMetrics.directCount !== null && (
                    <span className="sample-library-metric">
                      <em>DIRECT {meta.keyMetrics.directCount}</em>
                    </span>
                  )}
                </div>
                {meta.failedGates.length > 0 && (
                  <div className="sample-library-card-failed">
                    ⚠️ 失败门禁：{meta.failedGates.join('、')}
                  </div>
                )}
              </button>
            )
          })}
        </aside>

        {/* ── 右侧渲染区 ── */}
        <main className="sample-library-detail" aria-label="样例详情">
          {activeMeta && (
            <div className="sample-library-detail-head">
              <div>
                <h3>
                  样本 {activeMeta.letter}：{activeMeta.title}
                  <span style={{ color: SAMPLE_DECISION_TOKENS[activeMeta.decision].textColor, marginLeft: 12 }}>
                    {activeMeta.decision}
                  </span>
                </h3>
                <p className="sample-library-reason">{activeMeta.reason}</p>
              </div>
              <div className="sample-library-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'markdown'}
                  className={`sample-library-tab${activeTab === 'markdown' ? ' active' : ''}`}
                  onClick={() => setActiveTab('markdown')}
                >
                  📄 Markdown 原文
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'docx'}
                  className={`sample-library-tab${activeTab === 'docx' ? ' active' : ''}`}
                  onClick={() => setActiveTab('docx')}
                >
                  📦 .docx 二进制
                </button>
              </div>
            </div>
          )}

          {/* 元数据条 */}
          {metadata && (
            <div className="sample-library-meta-bar">
              <span><b>{metadata.h1Title ?? '—'}</b></span>
              <span>H2 × {metadata.h2Count}</span>
              <span>H3 × {metadata.h3Count}</span>
              <span>表格 × {metadata.tableCount}</span>
              <span>段落 × {metadata.paragraphCount}</span>
              <span>列表 × {metadata.listItemCount}</span>
              <span>链接 × {metadata.linkCount}</span>
              <span className={metadata.hasAppendix ? 'ok' : 'warn'}>
                {metadata.hasAppendix ? '✅' : '⚠️'} 附录
              </span>
              <span className={metadata.hasSixParts ? 'ok' : 'warn'}>
                {metadata.hasSixParts ? '✅' : '⚠️'} 6 部分
              </span>
            </div>
          )}

          {/* 决策可追溯硬约束 */}
          {consistency && !consistency.ok && (
            <div className="sample-library-alert" role="alert">
              ⚠️ 决策可追溯失败：{consistency.reason}
            </div>
          )}
          {consistency && consistency.ok && activeMeta && (
            <div className="sample-library-trace">
              ✅ 决策可追溯：<code>{activeMeta.decision}</code> ↔ 报告最终结论 <code>{activeMeta.decision}</code>
            </div>
          )}

          {/* 渲染区 */}
          {loading && <div className="sample-library-loading">加载中…</div>}

          {!loading && sample && !sample.ok && (
            <div className="sample-library-alert" role="alert">
              加载失败：{sample.error}
            </div>
          )}

          {!loading && sample && sample.ok && activeTab === 'markdown' && (
            <article className="sample-library-markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{sample.content}</ReactMarkdown>
            </article>
          )}

          {!loading && sample && sample.ok && activeTab === 'docx' && activeMeta && (
            <div className="sample-library-docx">
              <p>📦 .docx 文件：<code>{activeMeta.docxPath}</code></p>
              <p>文件大小：<b>{(activeMeta.docxSize / 1024).toFixed(1)} KB</b></p>
              <button type="button" className="sample-library-docx-btn" onClick={handleOpenDocx}>
                ⇩ 用系统应用（Word / WPS / LibreOffice）打开
              </button>
              {openDocxStatus && <p className="sample-library-docx-status">{openDocxStatus}</p>}
              <details className="sample-library-docx-hint">
                <summary>为什么不是内置预览？</summary>
                <p>
                  .docx 是 OOXML 2007+ 压缩包，内置预览需要 5MB+ 的渲染器依赖（如 mammoth）。
                  选品分析师报告样例库优先保证工件的"原生可分发性"——发到工厂/客户/团队用 Word 直接打开，避免任何格式损耗。
                </p>
              </details>
            </div>
          )}
        </main>
      </div>

      <footer className="sample-library-footer">
        样例库元数据：{library.length} 个决策 ·{' '}
        {library.filter(s => s.markdownSize > 0).length}/{library.length} markdown 存在 ·{' '}
        {library.filter(s => s.docxSize > 0).length}/{library.length} docx 存在
        · 维护文档 <a href="file://./docs/选品分析师-报告样例库.md" target="_blank" rel="noreferrer">docs/选品分析师-报告样例库.md</a>
      </footer>
    </section>
  )
}

// 保留 listSampleLetters 引用防止 lint 警告（verify 工具会用）
void listSampleLetters
