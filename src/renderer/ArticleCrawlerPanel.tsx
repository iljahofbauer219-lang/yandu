/**
 * ArticleCrawlerPanel
 * --------------------------------------------------------------
 * AI总部 → 文章抓取 工作台。
 *
 * 设计原则：
 * - 顶部状态条：服务运行状态 + 启动/停止 + 数据目录
 * - 中部内嵌 NewsCrawler Web UI（端口 3021，BrowserView 复用模式）
 * - 右侧抽屉：「抓取记录」列表，每条带「查看 Markdown」「同步到知识库」
 * - 5s 状态轮询；卸载时 hide() 关闭 BrowserView
 * - 「立即抓取」走 articleCrawler.extract(URL) 直接 POST 后端 8000 端口
 * - 「同步到知识库」走 articleCrawler.importToKnowledge
 */
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { KbListView } from '../shared/knowledge'

type CrawlerServiceState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'START_FAILED'

interface CrawlerConfig {
  installPath: string
  webUiUrl: string
  dataDir: string
  autoStart: boolean
}

interface CrawlerStatus {
  state: CrawlerServiceState
  config: CrawlerConfig
  dockerAvailable: boolean
  dockerComposeAvailable: boolean
  installPathValid: boolean
  dataDirValid: boolean
  webUiReachable: boolean
  message: string
  lastCheckedAt: string
}

interface CrawlerArticleSummary {
  fileName: string
  filePath: string
  platform: string
  title: string
  url: string
  author: string
  publishTime: string
  sizeBytes: number
  charCount: number
  content: string
  format: 'markdown' | 'json'
}

interface CrawlerImportResult {
  kbId: string
  kbName: string
  uploaded: Array<{ fileName: string; docId: string }>
  failed: Array<{ fileName: string; error: string }>
}

const STATUS_LABEL: Record<CrawlerServiceState, string> = {
  STOPPED: '未启动',
  STARTING: '启动中',
  RUNNING: '运行中',
  START_FAILED: '启动失败'
}

const STATUS_TONE: Record<CrawlerServiceState, string> = {
  STOPPED: 'muted',
  STARTING: 'warning',
  RUNNING: 'success',
  START_FAILED: 'danger'
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function truncate(s: string, max = 80): string {
  if (!s) return ''
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export function ArticleCrawlerPanel(props: { onBack: () => void }) {
  const { onBack } = props
  const [status, setStatus] = useState<CrawlerStatus | null>(null)
  const [articles, setArticles] = useState<CrawlerArticleSummary[]>([])
  const [busy, setBusy] = useState<'start' | 'stop' | 'extract' | 'import' | null>(null)
  const [extractUrl, setExtractUrl] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(true)
  const [kbList, setKbList] = useState<KbListView | null>(null)
  const [selectedKb, setSelectedKb] = useState('')
  const [importCategory, setImportCategory] = useState('crawler')
  const [importedArticle, setImportedArticle] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'info' | 'success' | 'danger'; text: string } | null>(null)
  const [previewing, setPreviewing] = useState<CrawlerArticleSummary | null>(null)
  const slotRef = useRef<HTMLDivElement>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.desktop.articleCrawler.status()
      setStatus(s)
    } catch (err) {
      console.warn('[article-crawler] status 失败：', err)
    }
  }, [])

  const refreshArticles = useCallback(async () => {
    try {
      const list = await window.desktop.articleCrawler.listArticles()
      setArticles(list)
    } catch (err) {
      console.warn('[article-crawler] list 失败：', err)
    }
  }, [])

  const refreshKbs = useCallback(async () => {
    try {
      const list = await window.desktop.kb.list()
      setKbList(list)
    } catch (err) {
      console.warn('[article-crawler] kb.list 失败：', err)
    }
  }, [])

  // 5s 轮询服务状态；首次挂载时拉一次
  useEffect(() => {
    void refreshStatus()
    void refreshArticles()
    void refreshKbs()
    const timer = window.setInterval(() => { void refreshStatus() }, 5000)
    return () => window.clearInterval(timer)
  }, [refreshStatus, refreshArticles, refreshKbs])

  // BrowserView 复用：show('web') + 跟随 slot bounds + 卸载时 hide
  useEffect(() => {
    const updateBounds = () => {
      const rect = slotRef.current?.getBoundingClientRect()
      if (rect) void window.desktop.browser.setBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    }
    updateBounds()
    void window.desktop.browser.show('web')
    const observer = new ResizeObserver(updateBounds)
    if (slotRef.current) observer.observe(slotRef.current)
    window.addEventListener('resize', updateBounds)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateBounds)
    }
  }, [])

  // 一旦 Web UI 可达，自动 navigate 到 NewsCrawler 首页
  useEffect(() => {
    if (status?.webUiReachable && status.config.webUiUrl) {
      void window.desktop.browser.navigate('web', status.config.webUiUrl).catch(() => undefined)
    }
  }, [status?.webUiReachable, status?.config.webUiUrl])

  // 卸载时关闭 BrowserView
  useEffect(() => () => { void window.desktop.browser.hide() }, [])

  const handleStart = async () => {
    setBusy('start')
    setMessage(null)
    try {
      const s = await window.desktop.articleCrawler.start()
      setStatus(s)
      setMessage({ tone: s.webUiReachable ? 'success' : 'info', text: s.message })
    } catch (err) {
      setMessage({ tone: 'danger', text: `启动失败：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setBusy(null)
    }
  }

  const handleStop = async () => {
    setBusy('stop')
    setMessage(null)
    try {
      const s = await window.desktop.articleCrawler.stop()
      setStatus(s)
      setMessage({ tone: 'info', text: s.message })
    } catch (err) {
      setMessage({ tone: 'danger', text: `停止失败：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setBusy(null)
    }
  }

  const handleOpenInstallDir = async () => {
    try { await window.desktop.articleCrawler.openInstallDir() }
    catch (err) { setMessage({ tone: 'danger', text: err instanceof Error ? err.message : String(err) }) }
  }

  const handleOpenDataDir = async () => {
    try { await window.desktop.articleCrawler.openDataDir() }
    catch (err) { setMessage({ tone: 'danger', text: err instanceof Error ? err.message : String(err) }) }
  }

  const handleExtract = async (e: FormEvent) => {
    e.preventDefault()
    if (!extractUrl.trim()) return
    setBusy('extract')
    setMessage(null)
    try {
      const article = await window.desktop.articleCrawler.extract(extractUrl.trim())
      setMessage({ tone: 'success', text: `已抓取：${article.title}` })
      setExtractUrl('')
      await refreshArticles()
      await refreshStatus()
    } catch (err) {
      setMessage({ tone: 'danger', text: `抓取失败：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setBusy(null)
    }
  }

  const handleImportOne = async (article: CrawlerArticleSummary) => {
    if (!window.confirm(`将「${truncate(article.title, 40)}」上传到知识库？`)) return
    setBusy('import')
    setImportedArticle(article.fileName)
    setMessage(null)
    try {
      const result = await window.desktop.articleCrawler.importToKnowledge({
        kbId: selectedKb || undefined,
        filePaths: [article.filePath],
        category: importCategory.trim() || undefined
      })
      const failCount = result.failed.length
      const okCount = result.uploaded.length
      setMessage({
        tone: failCount === 0 ? 'success' : 'danger',
        text: `上传到「${result.kbName}」：成功 ${okCount} 篇，失败 ${failCount} 篇${failCount ? `（${result.failed[0].error}）` : ''}`
      })
    } catch (err) {
      setMessage({ tone: 'danger', text: `上传失败：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setImportedArticle(null)
      setBusy(null)
    }
  }

  const handleImportAll = async () => {
    if (!articles.length) return
    if (!window.confirm(`将 ${articles.length} 篇抓取记录全部上传到知识库？每篇间隔 2 秒，可能需要 ${articles.length * 2} 秒以上。`)) return
    setBusy('import')
    setMessage(null)
    try {
      const result = await window.desktop.articleCrawler.importToKnowledge({
        kbId: selectedKb || undefined,
        filePaths: articles.map(a => a.filePath),
        category: importCategory.trim() || undefined
      })
      setMessage({
        tone: result.failed.length === 0 ? 'success' : 'danger',
        text: `批量上传到「${result.kbName}」：成功 ${result.uploaded.length} 篇，失败 ${result.failed.length} 篇`
      })
    } catch (err) {
      setMessage({ tone: 'danger', text: `批量上传失败：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      setBusy(null)
    }
  }

  const allKbs = kbList ? [
    ...kbList.agents.map(a => ({ id: a.kb?.id || '', name: a.kb?.name || a.name })),
    ...kbList.customs.map(c => ({ id: c.id, name: c.name }))
  ].filter(kb => kb.id) : []

  const stateTone = status ? STATUS_TONE[status.state] : 'muted'
  const stateLabel = status ? STATUS_LABEL[status.state] : '检测中'
  const stateText = status?.message || '正在检测服务状态…'
  const isRunning = status?.state === 'RUNNING'
  const canStart = status?.dockerAvailable && status?.dockerComposeAvailable && status?.installPathValid

  return <section className="crawler-page">
    <header className="crawler-header">
      <div className="crawler-header-left">
        <button type="button" className="crawler-back" onClick={onBack}>← 返回 AI总部</button>
        <div>
          <h2>文章抓取 <small>NewsCrawler · 12 平台</small></h2>
          <p>Docker 一键启停 · 内嵌 Web UI · 同步到 MaxKB 知识库</p>
        </div>
      </div>
      <div className="crawler-header-status">
        <span className={`crawler-state-tag crawler-state-${stateTone}`}>
          <i className={isRunning ? 'pulse' : ''} />
          {stateLabel}
        </span>
        <span className="crawler-state-msg" title={stateText}>{truncate(stateText, 60)}</span>
      </div>
    </header>

    {message && <div className={`crawler-banner crawler-banner-${message.tone}`} role="status">{message.text}</div>}

    <div className="crawler-toolbar">
      <div className="crawler-toolbar-group">
        <button type="button" className="primary" disabled={busy === 'start' || canStart === false} onClick={() => void handleStart()}>
          {busy === 'start' ? '启动中…' : '▶ 启动 NewsCrawler'}
        </button>
        <button type="button" disabled={busy === 'stop' || !isRunning} onClick={() => void handleStop()}>
          {busy === 'stop' ? '停止中…' : '■ 停止'}
        </button>
        <button type="button" disabled={!status?.installPathValid} onClick={() => void handleOpenInstallDir()}>📁 打开安装目录</button>
        <button type="button" disabled={!status?.dataDirValid} onClick={() => void handleOpenDataDir()}>📂 打开数据目录</button>
        <button type="button" onClick={() => setDrawerOpen(value => !value)}>
          {drawerOpen ? '隐藏抓取记录' : `显示抓取记录（${articles.length}）`}
        </button>
      </div>

      <form className="crawler-extract-form" onSubmit={handleExtract}>
        <input
          aria-label="待抓取文章 URL"
          placeholder="粘贴文章 URL，触发 NewsCrawler 后端抓取"
          value={extractUrl}
          onChange={e => setExtractUrl(e.target.value)}
        />
        <button type="submit" className="primary" disabled={busy === 'extract' || !isRunning || !extractUrl.trim()}>
          {busy === 'extract' ? '抓取中…' : '＋ 立即抓取'}
        </button>
      </form>
    </div>

    {!status?.dockerAvailable && <Notice tone="warning" role="alert">未检测到 docker 命令，请先安装 Docker Desktop</Notice>}
    {status?.dockerAvailable && !status?.dockerComposeAvailable && <Notice tone="warning" role="alert">未检测到 docker compose 子命令，请升级到 Docker Desktop 4.x+</Notice>}
    {status?.dockerAvailable && status?.dockerComposeAvailable && !status?.installPathValid && (
      <Notice tone="warning" role="alert">
        未找到 docker-compose.yml：{status?.config.installPath}。请到「系统管理 → 文章抓取」配置安装路径或先克隆 NewsCrawler 仓库。
      </Notice>
    )}

    <div className={`crawler-body ${drawerOpen ? 'with-drawer' : 'no-drawer'}`}>
      <div className="crawler-viewer">
        {!isRunning ? (
          <div className="crawler-viewer-empty">
            <div>
              <h3>NewsCrawler 尚未启动</h3>
              <p>点击上方「启动 NewsCrawler」后，内嵌浏览器将自动打开 <code>{status?.config.webUiUrl || 'http://localhost:3021'}</code>。</p>
              <small>抓取记录会出现在右侧抽屉，可逐篇或批量同步到 MaxKB 知识库。</small>
            </div>
          </div>
        ) : (
          <div ref={slotRef} className="crawler-viewer-slot" />
        )}
      </div>

      {drawerOpen && <aside className="crawler-drawer">
        <div className="crawler-drawer-header">
          <h3>抓取记录 <small>共 {articles.length} 篇</small></h3>
          <button type="button" onClick={() => void refreshArticles()}>↻ 刷新</button>
        </div>

        <div className="crawler-import-config">
          <label>
            <span>目标知识库</span>
            <select value={selectedKb} onChange={e => setSelectedKb(e.target.value)}>
              <option value="">默认（运维/合规/选品 优先）</option>
              {allKbs.map(kb => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
            </select>
          </label>
          <label>
            <span>分类标签</span>
            <input value={importCategory} onChange={e => setImportCategory(e.target.value)} placeholder="例如：crawler / news" />
          </label>
          <button type="button" className="primary" disabled={busy === 'import' || articles.length === 0} onClick={() => void handleImportAll()}>
            {busy === 'import' ? '上传中…' : '批量同步到知识库'}
          </button>
        </div>

        <div className="crawler-article-list">
          {articles.length === 0 && <div className="crawler-empty">尚无抓取记录。先在 Web UI 完成一次抓取，或在顶部粘贴 URL 触发。</div>}
          {articles.map(article => (
            <article key={article.filePath} className={`crawler-article-card${importedArticle === article.fileName ? ' importing' : ''}`}>
              <header>
                <span className={`crawler-platform-tag crawler-platform-${article.platform}`}>{article.platform || 'unknown'}</span>
                <b title={article.title}>{truncate(article.title, 40)}</b>
              </header>
              <p className="crawler-article-meta">
                {article.author && <span>👤 {truncate(article.author, 18)}</span>}
                {article.publishTime && <span>🕐 {formatTime(article.publishTime)}</span>}
                <span>📦 {formatBytes(article.sizeBytes)} · {article.charCount} 字</span>
              </p>
              {article.url && <p className="crawler-article-url"><a onClick={() => void window.desktop.system.openExternal(article.url)}>🔗 原文</a></p>}
              <footer>
                <button type="button" onClick={() => setPreviewing(article)}>👁 预览</button>
                <button
                  type="button"
                  className="primary"
                  disabled={busy === 'import'}
                  onClick={() => void handleImportOne(article)}
                >
                  {importedArticle === article.fileName ? '上传中…' : '↥ 同步到知识库'}
                </button>
              </footer>
            </article>
          ))}
        </div>
      </aside>}
    </div>

    {previewing && (
      <div className="crawler-preview-backdrop" onClick={() => setPreviewing(null)}>
        <div className="crawler-preview-modal" onClick={e => e.stopPropagation()}>
          <header>
            <div>
              <b>{previewing.title}</b>
              <small>{previewing.platform} · {formatBytes(previewing.sizeBytes)} · {previewing.fileName}</small>
            </div>
            <button type="button" onClick={() => setPreviewing(null)}>×</button>
          </header>
          <pre className="crawler-preview-body">{previewing.content}</pre>
        </div>
      </div>
    )}
  </section>
}

function Notice(props: { tone: 'info' | 'warning' | 'success' | 'danger'; role: string; children: React.ReactNode }) {
  return <div className={`crawler-notice crawler-notice-${props.tone}`} role={props.role}>{props.children}</div>
}
