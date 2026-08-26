import { useEffect, useRef, useState } from 'react'
import AIMessageContent from './AIMessageContent'
import { baseLanguageCode, buildListingQuery, findListingLanguage, LISTING_LANGUAGES, LISTING_MATERIAL_TERMS, LISTING_SITES } from '../shared/listingLocales'
import { LISTING_ARCHIVE_KEY, normalizeBatchForRestore, summarizeBatch, upsertBatch } from '../shared/listingArchive'
import type { ListingBatchRecord, ListingTaskRecord, ListingTaskStatus } from '../shared/listingArchive'
import { defaultLanguagesForSites, formatDraftAsMaterial, formatExtractedAsMaterial, siteIdsForMarketplace } from '../shared/listingBridge'
import type { ListingDraftEntry } from '../shared/listingBridge'
import type { MarketplacePlatformCode, MarketplacePublishDraft } from '../shared/contracts'
import './listing-workbench.css'

/** 示例素材（含品牌/型号/术语命中词，便于完整走六阶段流程） */
const SAMPLE_MATERIAL = '商品名称：一键退毛自洁梳；品牌：PetPal；型号：PP-201；材质：ABS手柄+不锈钢针+TPU软垫；重量180g；包装尺寸22×10×5 cm；功能：双弹簧一键退毛按钮、一体成型不锈钢针头、圆头针尖、TPE防滑握柄；场景：家庭猫犬美容；认证：无。'

// 前端自检口径与稳定性验收脚本一致：禁词只查「五、」之前的文案正文
const FORBIDDEN_WORDS = ['best seller', 'fda approved', 'free shipping']
const FORBIDDEN_PATTERNS: RegExp[] = [/\bcure\b/i, /100%/]

interface CheckItem {
  label: string
  ok: boolean
  detail?: string
}

function selfCheckListing(content: string, languageCode: string, material: string): CheckItem[] {
  const checks: CheckItem[] = []
  const conclusion = content.match(/可直接发布|需人工复核后发布|红线阻断/)
  checks.push({ label: '发布结论', ok: Boolean(conclusion), detail: conclusion?.[0] })
  const sections = new Set(content.match(/^(一|二|三|四|五|六)、/gm) || [])
  checks.push({ label: '六段结构', ok: sections.size >= 5, detail: `${sections.size}/6 段` })
  const bodyEnd = content.search(/^五、/m)
  const body = (bodyEnd >= 0 ? content.slice(0, bodyEnd) : content).toLowerCase()
  const hits = [
    ...FORBIDDEN_WORDS.filter(word => body.includes(word)),
    ...FORBIDDEN_PATTERNS.filter(pattern => pattern.test(body)).map(pattern => pattern.source)
  ]
  checks.push({ label: '禁词为零', ok: hits.length === 0, detail: hits.length ? hits.join('、') : undefined })
  const base = baseLanguageCode(languageCode)
  const misses = LISTING_MATERIAL_TERMS
    .filter(term => material.includes(term.zh) && term.map[base])
    .filter(term => !content.toLowerCase().includes(term.map[base].toLowerCase()))
    .map(term => term.zh)
  checks.push({ label: '术语命中', ok: misses.length === 0, detail: misses.length ? `缺 ${misses.join('、')}` : undefined })
  return checks
}

function conclusionOf(content: string): string {
  return content.match(/可直接发布|需人工复核后发布|红线阻断/)?.[0] || ''
}

function readableError(reason: unknown): string {
  if (reason instanceof Error) {
    return reason.message
      .replace(/^Error invoking remote method '[^']+': Error:\s*/, '')
      .replace(/^Error:\s*/, '') || '生成请求失败'
  }
  return '生成请求失败'
}

function loadArchive(): ListingBatchRecord[] {
  try {
    const raw = localStorage.getItem(LISTING_ARCHIVE_KEY)
    const items: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(items) ? (items as ListingBatchRecord[]) : []
  } catch {
    return []
  }
}

function saveArchive(items: ListingBatchRecord[]) {
  try {
    localStorage.setItem(LISTING_ARCHIVE_KEY, JSON.stringify(items))
  } catch {
    // ignore quota errors
  }
}

const STATUS_LABEL: Record<ListingTaskStatus, string> = {
  pending: '排队中',
  running: '生成中…',
  done: '',
  failed: '失败',
  interrupted: '已中断'
}

export default function ListingWorkbench() {
  // 进入时恢复最近批次（在途任务转「已中断」），实现刷新/重启无丢失
  const [initial] = useState(() => {
    const archive = loadArchive()
    const latest = archive[0] ? normalizeBatchForRestore(archive[0]) : null
    return { archive, latest }
  })
  const [archive, setArchive] = useState<ListingBatchRecord[]>(initial.archive)
  const [batch, setBatch] = useState<ListingBatchRecord | null>(initial.latest)

  const [material, setMaterial] = useState(initial.latest?.material || SAMPLE_MATERIAL)
  const [siteIds, setSiteIds] = useState<string[]>(initial.latest?.siteIds.length ? initial.latest.siteIds : ['amazon-us', 'ebay-us', 'shopee-my'])
  const [langCodes, setLangCodes] = useState<string[]>(initial.latest?.langCodes.length ? initial.latest.langCodes : ['en-US', 'de', 'ms'])
  const [running, setRunning] = useState(false)
  const [retryingId, setRetryingId] = useState('')
  const [expanded, setExpanded] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  // P4 带入：1688 页面提取 / 发布草稿一键带入素材
  const [extracting, setExtracting] = useState(false)
  const [drafts, setDrafts] = useState<ListingDraftEntry[]>([])
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [loadingDrafts, setLoadingDrafts] = useState(false)
  const cancelRef = useRef(false)

  const tasks = batch?.tasks || []

  // 批次任何变化（含逐包完成）立即写归档，刷新也不丢
  useEffect(() => {
    if (!batch) return
    setArchive(prev => {
      const merged = upsertBatch(prev, batch)
      saveArchive(merged)
      return merged
    })
  }, [batch])

  const patchTask = (taskId: string, patch: Partial<ListingTaskRecord>) => {
    setBatch(prev => prev ? { ...prev, tasks: prev.tasks.map(task => task.id === taskId ? { ...task, ...patch } : task) } : prev)
  }

  const toggleSite = (siteId: string) => {
    setSiteIds(prev => {
      if (prev.includes(siteId)) return prev.filter(item => item !== siteId)
      // 勾选站点时自动并入其默认语言
      const site = LISTING_SITES.find(item => item.id === siteId)
      if (site) setLangCodes(langs => [...new Set([...langs, ...site.defaultLanguages])])
      return [...prev, siteId]
    })
  }

  const toggleLang = (code: string) => {
    setLangCodes(prev => prev.includes(code) ? prev.filter(item => item !== code) : [...prev, code])
  }

  const toggleExpand = (id: string) => {
    setExpanded(prev => prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id])
  }

  const runTask = async (site: { id: string; platform: string; site: string }, taskId: string, languageCode: string, text: string) => {
    patchTask(taskId, { status: 'running', error: undefined })
    try {
      const query = buildListingQuery(site.platform, site.site, languageCode, text)
      const result = await window.desktop.aiEmployee.ask({ query, modelId: 'listing-agent' })
      patchTask(taskId, { status: 'done', content: result.content })
    } catch (reason) {
      patchTask(taskId, { status: 'failed', error: readableError(reason) })
    }
  }

  const generate = async () => {
    const text = material.trim()
    if (!text || running) return
    const sites = LISTING_SITES.filter(site => siteIds.includes(site.id))
    if (!sites.length || !langCodes.length) {
      setNotice('请至少选择一个平台站点和一种目标语言')
      return
    }
    cancelRef.current = false
    setNotice('')
    setExpanded([])
    const combos = sites.flatMap(site => langCodes.map(code => ({ site, code })))
    const newBatch: ListingBatchRecord = {
      id: `batch-${Date.now()}`,
      createdAt: Date.now(),
      material: text,
      siteIds: [...siteIds],
      langCodes: [...langCodes],
      tasks: combos.map((combo, index) => ({
        id: `lw-${Date.now()}-${index}`,
        siteId: combo.site.id,
        siteLabel: `${combo.site.platform} ${combo.site.site}`,
        languageCode: combo.code,
        status: 'pending',
        content: ''
      }))
    }
    setBatch(newBatch)
    setRunning(true)
    // 串行生成：单包为六段长文，避免并发拖垮中央 MaxKB 服务
    for (const task of newBatch.tasks) {
      if (cancelRef.current) break
      const site = sites.find(item => item.id === task.siteId)
      if (!site) continue
      await runTask(site, task.id, task.languageCode, text)
    }
    setRunning(false)
    if (cancelRef.current) setNotice('已停止；未完成的包可在卡片上单独重试')
  }

  const retryTask = async (taskId: string) => {
    if (running || retryingId || !batch) return
    const task = batch.tasks.find(item => item.id === taskId)
    const site = task && LISTING_SITES.find(item => item.id === task.siteId)
    if (!task || !site) return
    setRetryingId(taskId)
    await runTask(site, taskId, task.languageCode, batch.material)
    setRetryingId('')
  }

  const stop = () => { cancelRef.current = true }

  // 扩展端一键提取：从 AI员工浏览器当前 1688 商品页抽取事实，格式化为素材填入
  const extractFromPage = async () => {
    if (extracting) return
    setExtracting(true)
    setNotice('')
    try {
      const result = await window.desktop.aiEmployee.extractCurrent()
      if (result.ok && result.info) {
        const materialText = formatExtractedAsMaterial(result.info)
        setMaterial(materialText)
        setNotice('已从 1688 页面提取商品事实，请补充品牌/型号/认证后生成')
      } else {
        setNotice(result.message || '提取失败，请先在「浏览器」tab 打开 1688 商品详情页')
      }
    } catch (reason) {
      setNotice(readableError(reason))
    } finally {
      setExtracting(false)
    }
  }

  // 发布草稿带入：跨平台拉取草稿列表，选中后素材/站点/语言一键就位
  const openDraftPicker = async () => {
    const next = !draftsOpen
    setDraftsOpen(next)
    if (next && !drafts.length && !loadingDrafts) {
      setLoadingDrafts(true)
      try {
        const codes: MarketplacePlatformCode[] = ['AMAZON', 'EBAY', 'ALIEXPRESS', 'TEMU', 'OZON']
        const lists = await Promise.all(codes.map(code =>
          window.desktop.marketplacePublish.list(code)
            .then(items => items.map((draft: MarketplacePublishDraft) => ({
              id: draft.id, marketplaceCode: draft.marketplaceCode, title: draft.title,
              platformSku: draft.platformSku, priceText: draft.priceText,
              imageUrl: draft.imageUrl, status: draft.status
            })))
            .catch(() => [] as ListingDraftEntry[])))
        setDrafts(lists.flat().sort((a, b) => a.marketplaceCode.localeCompare(b.marketplaceCode)))
      } finally {
        setLoadingDrafts(false)
      }
    }
  }

  const importDraft = (draft: ListingDraftEntry) => {
    if (running) return
    setMaterial(formatDraftAsMaterial(draft))
    const sites = siteIdsForMarketplace(draft.marketplaceCode)
    if (sites.length) {
      setSiteIds(sites)
      setLangCodes(defaultLanguagesForSites(sites))
    }
    setDraftsOpen(false)
    setNotice(`已带入 ${draft.marketplaceCode} 草稿 ${draft.platformSku || draft.title.slice(0, 24)}；草稿字段较薄，建议补充材质/功能等事实后生成`)
  }

  const loadBatch = (record: ListingBatchRecord) => {
    if (running) return
    const restored = normalizeBatchForRestore(record)
    setBatch(restored)
    setMaterial(restored.material)
    setSiteIds(restored.siteIds)
    setLangCodes(restored.langCodes)
    setExpanded([])
    setNotice('')
  }

  const deleteBatch = (batchId: string) => {
    setArchive(prev => {
      const next = prev.filter(item => item.id !== batchId)
      saveArchive(next)
      return next
    })
    if (batch?.id === batchId) setBatch(null)
  }

  const exportPackages = async (format: 'word' | 'markdown' | 'csv', only?: ListingTaskRecord) => {
    if (!batch) return
    const source = only ? [only] : tasks.filter(task => task.status === 'done')
    if (!source.length) return
    const stamp = new Date(batch.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(/[/:]/g, '')
    const title = only ? `Listing包-${only.siteLabel}-${only.languageCode}` : `Listing批次-${stamp}-${source.length}包`
    try {
      const result = await window.desktop.aiEmployee.exportListing({
        title,
        format,
        material: batch.material,
        packages: source.map(task => ({
          siteLabel: task.siteLabel,
          languageCode: task.languageCode,
          conclusion: conclusionOf(task.content),
          content: task.content
        }))
      })
      if (!result.canceled) setNotice(`已下载：${result.filePath || title}`)
    } catch (reason) {
      setNotice(readableError(reason))
    }
  }

  const doneTasks = tasks.filter(task => task.status === 'done')
  const failedCount = tasks.filter(task => task.status === 'failed').length
  const checkResults = new Map(doneTasks.map(task => [task.id, selfCheckListing(task.content, task.languageCode, batch?.material || '')]))
  const allGreen = tasks.length > 0
    && tasks.every(task => task.status === 'done')
    && [...checkResults.values()].every(checks => checks.every(check => check.ok))

  return (
    <div className="listing-workbench">
      <aside className="listing-workbench-config">
        <section className="lw-config-block">
          <header>
            <b>中文商品素材</b>
            <span className="lw-material-actions">
              <button type="button" disabled={extracting} onClick={() => void extractFromPage()}>{extracting ? '提取中…' : '📥 1688提取'}</button>
              <button type="button" onClick={() => void openDraftPicker()}>📋 草稿</button>
              <button type="button" onClick={() => setMaterial(SAMPLE_MATERIAL)}>示例</button>
            </span>
          </header>
          {draftsOpen && (
            <div className="lw-draft-picker">
              {loadingDrafts
                ? <small>正在拉取各平台发布草稿…</small>
                : drafts.length === 0
                  ? <small>暂无发布草稿（可先在「跨境分发」流程生成）</small>
                  : drafts.map(draft => (
                    <button key={draft.id} type="button" disabled={running} onClick={() => importDraft(draft)}>
                      <b>{draft.marketplaceCode}</b>
                      <span>{draft.title || draft.platformSku}</span>
                      <i>{draft.platformSku} · {draft.status}</i>
                    </button>
                  ))}
            </div>
          )}
          <textarea
            rows={9}
            placeholder={'粘贴中文事实卡：商品名称、品牌、型号、材质、尺寸、功能、场景、认证…\n禁止编造字段，素材不足时智能体会列「需补充字段」。'}
            value={material}
            onChange={event => setMaterial(event.target.value)}
          />
        </section>
        <section className="lw-config-block">
          <header><b>平台 × 站点</b><small>已选 {siteIds.length}</small></header>
          <div className="lw-chips">
            {LISTING_SITES.map(site => (
              <button
                key={site.id}
                type="button"
                className={`lw-chip${siteIds.includes(site.id) ? ' active' : ''}`}
                onClick={() => toggleSite(site.id)}
              >
                {site.platform} {site.site}
              </button>
            ))}
          </div>
        </section>
        <section className="lw-config-block">
          <header><b>目标语言</b><small>已选 {langCodes.length}</small></header>
          <div className="lw-chips">
            {LISTING_LANGUAGES.map(language => (
              <button
                key={language.code}
                type="button"
                className={`lw-chip${langCodes.includes(language.code) ? ' active' : ''}`}
                onClick={() => toggleLang(language.code)}
              >
                {language.label}
              </button>
            ))}
          </div>
        </section>
        <footer className="lw-config-footer">
          {notice && <p className="lw-notice">{notice}</p>}
          <div className="lw-config-actions">
            {running
              ? <button type="button" onClick={stop}>停止生成</button>
              : <button type="button" className="primary" disabled={!material.trim() || !siteIds.length || !langCodes.length} onClick={() => void generate()}>
                  生成 Listing 包（{siteIds.length}×{langCodes.length}）
                </button>}
          </div>
          <small>每包约 1-3 分钟，串行生成；逐包自动归档，刷新或重启后可恢复。</small>
        </footer>
      </aside>

      <div className="listing-workbench-results">
        <header className="lw-results-header">
          <b>生成结果</b>
          {tasks.length > 0 && (
            <span className="lw-results-summary">
              {doneTasks.length}/{tasks.length} 完成{failedCount > 0 && <i className="lw-failed-count"> · {failedCount} 失败</i>}
              {allGreen && <em className="lw-all-green">✓ 自检全绿</em>}
              {doneTasks.length > 0 && (
                <span className="lw-download-group" title="整批下载">
                  <button type="button" onClick={() => void exportPackages('markdown')}>⬇ MD</button>
                  <button type="button" onClick={() => void exportPackages('word')}>⬇ Word</button>
                  <button type="button" onClick={() => void exportPackages('csv')}>⬇ CSV</button>
                </span>
              )}
            </span>
          )}
        </header>

        {archive.length > 0 && (
          <details className="lw-archive">
            <summary>📁 归档批次（{archive.length}）</summary>
            <div className="lw-archive-list">
              {archive.map(item => {
                const summary = summarizeBatch(item)
                const isCurrent = batch?.id === item.id
                return (
                  <div key={item.id} className={`lw-archive-row${isCurrent ? ' current' : ''}`}>
                    <b>{new Date(item.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</b>
                    <span>{summary.total} 包 · 成功 {summary.done}{summary.failed ? ` · 失败 ${summary.failed}` : ''}{summary.interrupted ? ` · 中断 ${summary.interrupted}` : ''}</span>
                    <small title={item.material}>{item.material.slice(0, 24)}</small>
                    {isCurrent
                      ? <em>当前</em>
                      : <button type="button" disabled={running} onClick={() => loadBatch(item)}>载入</button>}
                    <button type="button" className="lw-archive-del" disabled={running} onClick={() => deleteBatch(item.id)}>×</button>
                  </div>
                )
              })}
            </div>
          </details>
        )}

        {tasks.length === 0 ? (
          <div className="lw-results-empty">
            <span>📦</span>
            <b>素材 × 平台 × 语言 → 母语级 Listing 包</b>
            <small>左侧填入中文事实卡，勾选平台站点与目标语言后点击「生成 Listing 包」。每包含标题/要点/描述/搜索词、自检表与发布结论；生成结果自动归档，可下载 Word/Markdown/CSV。</small>
          </div>
        ) : (
          <div className="lw-task-list">
            {tasks.map(task => {
              const checks = checkResults.get(task.id) || []
              const langLabel = findListingLanguage(task.languageCode)?.label || task.languageCode
              const conclusion = task.status === 'done' ? conclusionOf(task.content) : ''
              const greenCount = checks.filter(check => check.ok).length
              const isOpen = expanded.includes(task.id)
              const retryable = (task.status === 'failed' || task.status === 'interrupted') && !running && !retryingId
              return (
                <article key={task.id} className={`lw-task lw-task-${task.status}`}>
                  <header onClick={() => toggleExpand(task.id)}>
                    <b>{task.siteLabel}</b>
                    <span className="lw-task-lang">{langLabel}</span>
                    <i className={`lw-status lw-status-${task.status}`}>
                      {task.status === 'done' ? `自检 ${greenCount}/${checks.length}` : retryingId === task.id ? '重试中…' : STATUS_LABEL[task.status]}
                    </i>
                    {conclusion && <em className={`lw-conclusion ${conclusion === '可直接发布' ? 'ok' : conclusion === '红线阻断' ? 'block' : 'review'}`}>{conclusion}</em>}
                    {retryable && <button type="button" className="lw-retry" onClick={event => { event.stopPropagation(); void retryTask(task.id) }}>↻ 重试</button>}
                    {task.status === 'done' && (
                      <span className="lw-download-group" onClick={event => event.stopPropagation()}>
                        <button type="button" title="下载 Markdown" onClick={() => void exportPackages('markdown', task)}>MD</button>
                        <button type="button" title="下载 Word" onClick={() => void exportPackages('word', task)}>W</button>
                        <button type="button" title="下载 CSV（标题/要点/描述/搜索词字段）" onClick={() => void exportPackages('csv', task)}>CSV</button>
                      </span>
                    )}
                  </header>
                  {isOpen && (
                    <div className="lw-task-body">
                      {task.status === 'failed' ? (
                        <p className="lw-task-error">⚠️ {task.error}</p>
                      ) : task.status === 'done' ? (
                        <>
                          <div className="lw-checks">
                            {checks.map(check => (
                              <span key={check.label} className={`lw-check${check.ok ? ' ok' : ' bad'}`} title={check.detail}>
                                {check.ok ? '✓' : '✗'} {check.label}{check.detail ? ` · ${check.detail}` : ''}
                              </span>
                            ))}
                          </div>
                          <AIMessageContent content={task.content} tone="answer" />
                        </>
                      ) : (
                        <p className="lw-task-waiting">
                          {task.status === 'running' && '正在调用 Listing精造师智能体生成长文，请稍候…'}
                          {task.status === 'pending' && '等待前序任务完成…'}
                          {task.status === 'interrupted' && '生成被中断（页面刷新/停止），可点击「重试」单独补跑。'}
                        </p>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
