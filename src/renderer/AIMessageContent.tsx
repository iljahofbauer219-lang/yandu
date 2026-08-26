import { ComponentPropsWithoutRef, Fragment, MouseEvent, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { stripAppendix } from '../shared/reportEnhance'
import { reportPlatform } from '../shared/selectionExtract'
import { enhanceReportDom } from './reportEnhanceDom'

// 把项目里的“竞品截图清单”表格自动转成 markdown 图片块（兌底：AI 偶尔忘了写 ![]() 也能渲染）
// 表格特征:首列名是“文件” / “file” / “filename” / “截图” 等，且该列出现 .png/.jpg/.jpeg/.webp 路径
function injectScreenshotImages(markdown: string, workspacePath: string | undefined): string {
  if (!workspacePath || !markdown) return markdown
  const imageExt = /\.(png|jpe?g|webp|gif)(?:\b|$)/i
  // 拆分所有 markdown 表格(以 | 开头/结尾 + 包含分隔行 |---|)
  const tableRe = /(?:^|\n)(\|[^\n]*\|[\t ]*\n\|[\t ]*[-:]+[\t ]*\|[^\n]*\n(?:\|[^\n]*\|[\t ]*\n?)+)/g
  const fileHeaders = /^(文件|filename|file|file\s*name|截图|图片|image|path|路径)$/i
  return markdown.replace(tableRe, (full, tableBlock) => {
    const lines = tableBlock.trimEnd().split('\n')
    if (lines.length < 3) return full
    const headerCells = lines[0].split('|').slice(1, -1).map((c: string) => c.trim().replace(/`/g, ''))
    const fileColIdx = headerCells.findIndex((h: string) => fileHeaders.test(h))
    if (fileColIdx < 0) return full
    // 收集该列所有图片路径
    const imagePaths: string[] = []
    for (let i = 2; i < lines.length; i++) {
      const cells = lines[i].split('|').slice(1, -1).map((c: string) => c.trim().replace(/`/g, ''))
      const cell = cells[fileColIdx]
      if (!cell) continue
      // 单元格可能是 `path` 或裸路径
      const m = cell.match(/[\w./\\-]+\.(?:png|jpe?g|webp|gif)/i)
      if (m) imagePaths.push(m[0])
    }
    if (imagePaths.length === 0) return full
    // 在表格后追加图片块
    const imageBlock = '\n\n' + imagePaths.map(p => `![${p.split('/').pop() || p}](${p})`).join('\n\n') + '\n'
    return full + imageBlock
  })
}

// AI 输出文件链接识别器：将报告里“输出文件: /var/folders/.../x.docx”这种纯文本路径转成可下载链接。
// 越权与限制都交给后端 advisor:download-output-file IPC，这里只负责挑出可被后端接受的路径。
// 允许范围 = os.tmpdir() 的常见表达：
//   macOS:  /var/folders/<u>/<s>/T/... 或 /private/var/folders/.../T/...
//   Linux:  /tmp/...
//   Windows: C:\Users\<name>\AppData\Local\Temp\... 或 C:\Windows\Temp\...
const DOWNLOAD_LINK_PREFIX = 'advisor-download:'
const DOWNLOAD_FILE_EXTS =
  '(?:docx|xlsx|pptx|pdf|csv|txt|md|json|zip|rar|7z|doc|xls|ppt|rtf|odt|ods|odp|html|htm|xml|png|jpe?g|webp|gif|svg|mp3|mp4|mov|wav)'
const DOWNLOAD_PATH_RE = new RegExp(
  // 字符类里不放反斜杠——文件路径里基本不需要排除 \,避免与 JS/正则双重转义打架
  "(\\/(?:var\\/folders\\/[^/\\s]+\\/[^/\\s]+\\/T(?:[\\/]|$)|private\\/var\\/folders\\/[^/\\s]+\\/[^/\\s]+\\/T(?:[\\/]|$)|tmp(?:[\\/]|$))[^\\s<>\"\'`]+\\.)" +
  DOWNLOAD_FILE_EXTS +
  "|" +
  "([A-Z]:\\\\(?:Users\\\\[^\\\\\\s]+\\\\AppData\\\\Local\\\\Temp|Windows\\\\Temp)(?:\\\\|$)[^\\s<>\"\'`]+\\.)" +
  DOWNLOAD_FILE_EXTS,
  "gi"
)
type DownloadInfo = {
  // 用 url 协议 + 编码后路径作 key(同 injectDownloadableFiles 旧逻辑,保持与 IPC 期望一致)
  key: string
  fileName: string
  filePath: string
}

// 拆分器：在可下载路径处把 markdown 切成若干段 + 抽出 downloads 列表。
// 渲染时每段独立走 ReactMarkdown，中间插入真正的 React <button> 组件，完全脱离
// react-markdown 的链接解析路径(避免其对自定义 scheme 的各种回退坑)。
function splitByDownloads(markdown: string): { segments: string[]; downloads: DownloadInfo[] } {
  if (!markdown) return { segments: [''], downloads: [] }
  const segments: string[] = []
  const downloads: DownloadInfo[] = []
  let lastIndex = 0
  for (const match of markdown.matchAll(DOWNLOAD_PATH_RE)) {
    const filePath = match[0]
    const fileName = filePath.split(/[\\/]/).pop() || filePath
    const key = `${DOWNLOAD_LINK_PREFIX}${encodeURIComponent(filePath)}`
    segments.push(markdown.slice(lastIndex, match.index!))
    downloads.push({ key, fileName, filePath })
    lastIndex = match.index! + match[0].length
  }
  segments.push(markdown.slice(lastIndex))
  return { segments, downloads }
}
function decodeDownloadHref(href: string): string | null {
  if (!href || !href.startsWith(DOWNLOAD_LINK_PREFIX)) return null
  try {
    return decodeURIComponent(href.slice(DOWNLOAD_LINK_PREFIX.length))
  } catch {
    return null
  }
}

// 把 markdown 图片 src 解析成可在 Electron 内显示的 URL
//  - http(s)://  走原样
//  - 绝对路径    file:// 转码(浏览器对 file:// 限制多，常见 404；尽量走 cross-media)
//  - 项目内相对  走 cross-media://project/<encodedWorkspace>/<path>，由 main 端安全读取
//  - data:      走原样
// 没有 workspacePath 时，相对路径直接放弃渲染(避免 404 噪音)
function resolveImageSrc(src: string | undefined, workspacePath: string | undefined): string | null {
  if (!src) return null
  const trimmed = src.trim()
  if (!trimmed) return null
  if (/^(https?:|data:|cross-media:|blob:)/i.test(trimmed)) return trimmed
  // 绝对路径 (C:\... 或 /Users/...)：转换成 file:// 让浏览器加载
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(trimmed)) {
    return 'file://' + encodeURI(trimmed).replace(/#/g, '%23')
  }
  // 项目内相对路径：必须有 workspacePath 才安全加载
  if (!workspacePath) return null
  const workspace = workspacePath.replace(/\\/g, '/').replace(/\/$/, '')
  const relative = trimmed.replace(/^\.\//, '').replace(/^\//, '')
  return `cross-media://project/${encodeURIComponent(workspace)}/${encodeURIComponent(relative).replace(/%2F/g, '/')}`
}

function tableRows(table: HTMLTableElement): string[][] {
  return Array.from(table.rows).map(row =>
    Array.from(row.cells).map(cell => (cell.textContent || '').trim())
  )
}

function rowsAsTsv(rows: string[][]): string {
  return rows.map(row => row.join('\t')).join('\n')
}

function rowsAsCsv(rows: string[][]): string {
  return '\uFEFF' + rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\n')
}

function MarkdownTable(props: ComponentPropsWithoutRef<'table'>) {
  const tableRef = useRef<HTMLTableElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [notice, setNotice] = useState('')

  const copyTable = async () => {
    if (!tableRef.current) return
    await navigator.clipboard.writeText(rowsAsTsv(tableRows(tableRef.current)))
    setNotice('已复制')
    window.setTimeout(() => setNotice(''), 1500)
  }

  const downloadCsv = () => {
    if (!tableRef.current) return
    const url = URL.createObjectURL(new Blob([rowsAsCsv(tableRows(tableRef.current))], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `AI表格-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
    setNotice('已下载')
    window.setTimeout(() => setNotice(''), 1500)
  }

  return <section className={`ai-markdown-table-card${expanded ? ' expanded' : ''}`}>
    <header>
      <b>表格</b>
      <span aria-live="polite">{notice}</span>
      <button type="button" aria-label="复制表格" title="复制表格" onClick={() => void copyTable()}>复制</button>
      <button type="button" aria-label="下载CSV" title="下载CSV" onClick={downloadCsv}>CSV</button>
      <button type="button" aria-label={expanded ? '退出表格大图' : '展开表格'} title={expanded ? '退出大图' : '展开表格'} onClick={() => setExpanded(value => !value)}>{expanded ? '退出大图' : '展开'}</button>
    </header>
    <div className="ai-markdown-table-scroll" tabIndex={0} aria-label="可横向滚动的表格">
      <table ref={tableRef} {...props} />
    </div>
  </section>
}

export default function AIMessageContent({ content, tone = 'answer', onPrompt, feedback, workspacePath, onImageClick }: { content: string; tone?: 'answer' | 'question'; onPrompt?: (prompt: string) => void; feedback?: { currentRating?: 'up' | 'down'; isBusy?: boolean; onRerun?: () => void; onRate?: (rating: 'up' | 'down') => void }; workspacePath?: string; onImageClick?: (info: { url: string; fileName: string }) => void }) {
  const [copied, setCopied] = useState(false)
  const [actionNotice, setActionNotice] = useState('')
  const [documentReady, setDocumentReady] = useState(false)
  const [documentBusy, setDocumentBusy] = useState<'word' | 'markdown' | ''>('')
  const [documentEditing, setDocumentEditing] = useState(false)
  const [editedContent, setEditedContent] = useState('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [favorited, setFavorited] = useState(false)
  // advisor-download: 链接的下载状态(按编码后的路径作 key),在 React 重新渲染后保留状态
  const [downloadState, setDownloadState] = useState<Record<string, 'idle' | 'downloading' | 'downloaded' | 'failed'>>({})
  const rootRef = useRef<HTMLDivElement>(null)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  // v1.4：旧报告自带的附录不再展示（省版面），渲染前剩除
  // 渲染前依次处理：剥附录 → 补截图 → 抽下载点拆段
  const rendered = useMemo(() => injectScreenshotImages(stripAppendix(content), workspacePath), [content, workspacePath])
  const { segments, downloads } = useMemo(() => splitByDownloads(rendered), [rendered])
  const documentStorageKey = `yd.aiEmployee.document:${encodeURIComponent(rendered.slice(0, 120))}`
  const favoriteStorageKey = `yd.aiEmployee.favorite:${encodeURIComponent(rendered.slice(0, 120))}`

  // 报告增强：旧报告追溯补链 + 证据等级标签 + 术语悬停注解（rendered 变化后重跑）
  useEffect(() => {
    enhanceReportDom(rootRef.current)
  }, [rendered])

  // DOM 兑底：不论 react-markdown 为什么没解析成 <a>，扫出文本里还存在的
  // `[filename](advisor-download:encoded)` 原始 markdown，将其就地换成 <button>。
  // click handler 走 ref、避免闭包捕获过期 state
  const handleDownloadClickRef = useRef<(encoded: string) => void>(() => undefined)
  useEffect(() => {
    if (!rootRef.current) return
    const root = rootRef.current
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
    const textNodes: Text[] = []
    let node: Node | null
    while ((node = walker.nextNode())) {
      if ((node.textContent || '').includes(DOWNLOAD_LINK_PREFIX)) textNodes.push(node as Text)
    }
    if (textNodes.length === 0) return
    const linkRe = /\[([^\]]+)\]\(advisor-download:([^)]+)\)/g
    for (const textNode of textNodes) {
      const text = textNode.textContent || ''
      linkRe.lastIndex = 0
      let m: RegExpExecArray | null
      let lastIndex = 0
      const fragment = document.createDocumentFragment()
      let matched = false
      while ((m = linkRe.exec(text)) !== null) {
        matched = true
        if (m.index > lastIndex) fragment.appendChild(document.createTextNode(text.slice(lastIndex, m.index)))
        const fileName = m[1]
        const encodedPath = m[2]
        const shortName = fileName.length > FILE_NAME_MAX ? `${fileName.slice(0, FILE_NAME_MAX - 1)}…` : fileName
        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'downloadable-file'
        btn.title = fileName
        btn.dataset.dlKey = `${DOWNLOAD_LINK_PREFIX}${encodedPath}`
        const icon = document.createElement('span')
        icon.className = 'downloadable-file-icon'
        icon.setAttribute('aria-hidden', 'true')
        icon.textContent = '📥'
        const nameSpan = document.createElement('span')
        nameSpan.className = 'downloadable-file-name'
        nameSpan.textContent = shortName
        btn.appendChild(icon)
        btn.appendChild(nameSpan)
        btn.addEventListener('click', event => {
          event.preventDefault()
          event.stopPropagation()
          void handleDownloadClickRef.current(btn.dataset.dlKey || '')
        })
        fragment.appendChild(btn)
        lastIndex = m.index + m[0].length
      }
      if (!matched) continue
      if (lastIndex < text.length) fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
      textNode.parentNode?.replaceChild(fragment, textNode)
    }
  }, [rendered, segments])
  useEffect(() => {
    try { setEditedContent(localStorage.getItem(documentStorageKey) || rendered) } catch { setEditedContent(rendered) }
  }, [documentStorageKey, rendered])
  useEffect(() => {
    try { setFavorited(localStorage.getItem(favoriteStorageKey) === '1') } catch { setFavorited(false) }
  }, [favoriteStorageKey])
  useEffect(() => {
    if (!moreOpen) return
    // 同时监听 mousedown / pointerdown，鼠标与触屏点击都靠上
    // 走冒泡到 document 后才判断包含关系，避免被 React 合成事件提前停止
    const closeOutside = (event: Event) => {
      const target = event.target as Node | null
      if (!moreMenuRef.current?.contains(target)) setMoreOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [moreOpen])

  const copyAnswer = async () => {
    await navigator.clipboard.writeText(rendered)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1500)
  }

  const documentTitle = rendered.match(/^#\s+(.+)$/m)?.[1]?.trim() || 'Amazon选品分析报告'
  const documentPlatform = reportPlatform(editedContent || rendered)
  const documentPrompts = useMemo(() => {
    const prompts: string[] = []
    if (/待验证|未知|数据不足/.test(editedContent || rendered)) prompts.push('请优先核验这份报告中的待验证数据，并按重要性排序。')
    if (/竞品|ASIN|商品\/品牌链接/.test(editedContent || rendered)) prompts.push('请根据报告中的竞品表，筛选出最值得重点研究的 5 个 Amazon 竞品。')
    if (/利润|成本|FBA|毛利|盈亏/.test(editedContent || rendered)) prompts.push('请补充采购成本、物流、FBA费用、广告费和退货率，计算 Amazon 美国站利润。')
    if (/合规|FDA|EPA|知识产权|专利/.test(editedContent || rendered)) prompts.push('请检查报告中的合规与知识产权风险，并列出需要人工确认的事项。')
    prompts.push('请根据这份 Amazon 选品报告制定 30 天验证计划和止损条件。')
    return [...new Set(prompts)].slice(0, 4)
  }, [editedContent, rendered])
  const createDocument = () => {
    setDocumentReady(true)
    setDocumentEditing(true)
    setActionNotice('文档已生成，可直接编辑。')
  }
  const downloadDocument = async (format: 'word' | 'markdown') => {
    setDocumentBusy(format)
    setActionNotice('')
    try {
      const result = await window.desktop.aiEmployee.exportListing({
        title: documentTitle,
        format,
        material: '',
        packages: [{ siteLabel: `${documentPlatform}选品分析报告`, languageCode: 'zh-CN', conclusion: '', content: editedContent || rendered }]
      })
      if (!result.canceled) setActionNotice(`已下载：${result.filePath || documentTitle}`)
    } catch (error) {
      setActionNotice(`文档下载失败：${error instanceof Error ? error.message : '未知错误'}`)
    } finally {
      setDocumentBusy('')
    }
  }

  const updateDocument = (value: string) => {
    setEditedContent(value)
    try { localStorage.setItem(documentStorageKey, value) } catch { /* ignore quota errors */ }
    setActionNotice('已自动保存')
  }

  const toggleFavorite = () => {
    const next = !favorited
    setFavorited(next)
    setMoreOpen(false)
    try {
      if (next) localStorage.setItem(favoriteStorageKey, '1')
      else localStorage.removeItem(favoriteStorageKey)
    } catch { /* ignore quota errors */ }
    setActionNotice(next ? '已收藏这条回复。' : '已取消收藏。')
  }

  const downloadFromMore = (format: 'word' | 'markdown') => {
    setMoreOpen(false)
    void downloadDocument(format)
  }

  // AI 输出文件下载：从 advisor-download: 链接提取原始路径，调用主进程 IPC 弹保存对话框
  // 状态机:idle → downloading → downloaded / failed；同一路径再次点击会重置为 downloading
  const handleDownloadClick = async (encodedPath: string) => {
    const filePath = decodeDownloadHref(encodedPath)
    if (!filePath) {
      setActionNotice('下载链接解析失败')
      return
    }
    if (downloadState[encodedPath] === 'downloading') return
    setDownloadState(prev => ({ ...prev, [encodedPath]: 'downloading' }))
    try {
      const result = await window.desktop.advisor.downloadOutputFile(filePath)
      if (result && 'canceled' in result && result.canceled) {
        // 用户取消：状态回到 idle，不弹错误
        setDownloadState(prev => {
          const next = { ...prev }
          delete next[encodedPath]
          return next
        })
        return
      }
      if (result && 'ok' in result && result.ok) {
        setDownloadState(prev => ({ ...prev, [encodedPath]: 'downloaded' }))
        setActionNotice(`已下载：${('fileName' in result && result.fileName) || filePath.split(/[\\/]/).pop() || filePath}`)
        return
      }
      const error = (result && 'error' in result && result.error) || '下载失败'
      setDownloadState(prev => ({ ...prev, [encodedPath]: 'failed' }))
      setActionNotice(`下载失败：${error}`)
    } catch (error) {
      setDownloadState(prev => ({ ...prev, [encodedPath]: 'failed' }))
      setActionNotice(`下载失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }
  // 保持 DOM 兑底扫描里的 click handler 拿到的始终是最新闭包
  handleDownloadClickRef.current = handleDownloadClick

  // 链接点击：优先内置浏览器 web 标签（报告旁直接核验竞店），失败降级系统浏览器
  const smartOpen = (href: string, label: string) => {
    void (async () => {
      try {
        await window.desktop.browser.openTab('web', href, label)
      } catch {
        await window.desktop.system.openExternal(href).catch(() => undefined)
      }
    })()
  }

  const onLinkClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a[href]')
    const href = anchor?.getAttribute('href') || ''
    if (!anchor || !/^https?:\/\//.test(href)) return
    event.preventDefault()
    smartOpen(href, (anchor.textContent || href).slice(0, 24))
  }

  // 截断文件名到指定长度(按字符数计,中文/emoji 算 1)
  const FILE_NAME_MAX = 24
  const truncateFileName = (text: string) =>
    text.length > FILE_NAME_MAX ? `${text.slice(0, FILE_NAME_MAX - 1)}…` : text

  return <div ref={rootRef} onClick={onLinkClick} className={`ai-markdown-content ai-markdown-${tone}`}>
    {segments.map((seg, i) => {
      const download = downloads[i]
      return <Fragment key={i}>
        {seg && <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            table: MarkdownTable,
            a: ({ children, ...props }) => {
              const href = props.href || ''
              // 兼容旧报告里还在的 [filename](advisor-download:...) 文本
              if (href.startsWith(DOWNLOAD_LINK_PREFIX)) {
                const state = downloadState[href] || 'idle'
                const stateLabel = state === 'downloading' ? '下载中…'
                  : state === 'downloaded' ? '已下载 ✓'
                  : state === 'failed' ? '重试 ↻'
                  : null
                const fullName = typeof children === 'string'
                  ? children
                  : Array.isArray(children) ? children.filter((c): c is string => typeof c === 'string').join('')
                  : String(children ?? '')
                const shortName = truncateFileName(fullName.trim())
                return <a
                  {...props}
                  title={fullName.trim() || '下载文件'}
                  className={['downloadable-file', state !== 'idle' ? `is-${state}` : ''].filter(Boolean).join(' ')}
                  onClick={event => {
                    event.preventDefault()
                    event.stopPropagation()
                    void handleDownloadClick(href)
                  }}
                ><span className="downloadable-file-icon" aria-hidden="true">📥</span><span className="downloadable-file-name">{shortName}</span>{stateLabel && <span className="downloadable-file-state">{stateLabel}</span>}</a>
              }
              return <a
                {...props}
                target="_blank"
                rel="noreferrer"
                onClick={event => {
                  if (!/^https?:\/\//.test(href)) return
                  event.preventDefault()
                  event.stopPropagation()
                  smartOpen(href, (event.currentTarget.textContent || href).slice(0, 24))
                }}
              >{children}</a>
            },
            // 自定义 img：项目目录下的相对路径 → cross-media://project/...，点击弹大图
            img: ({ src, alt, ...props }) => {
              const url = resolveImageSrc(src, workspacePath)
              if (!url) return null
              const fileName = (alt || (typeof src === 'string' ? src.split('/').pop() : '') || '图片')
              return <img
                {...props}
                src={url}
                alt={alt || fileName}
                loading="lazy"
                className="ai-markdown-screenshot"
                onClick={() => onImageClick?.({ url, fileName })}
                role={onImageClick ? 'button' : undefined}
                tabIndex={onImageClick ? 0 : undefined}
                onKeyDown={event => {
                  if (onImageClick && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault()
                    onImageClick({ url, fileName })
                  }
                }}
              />
            }
          }}
        >{seg}</ReactMarkdown>}
        {download && (() => {
          const state = downloadState[download.key] || 'idle'
          const stateLabel = state === 'downloading' ? '下载中…'
            : state === 'downloaded' ? '已下载 ✓'
            : state === 'failed' ? '重试 ↻'
            : null
          const shortName = truncateFileName(download.fileName)
          return <button
            type="button"
            title={download.fileName}
            data-dl-key={download.key}
            className={['downloadable-file', state !== 'idle' ? `is-${state}` : ''].filter(Boolean).join(' ')}
            onClick={event => {
              event.preventDefault()
              event.stopPropagation()
              void handleDownloadClick(download.key)
            }}
          ><span className="downloadable-file-icon" aria-hidden="true">📥</span><span className="downloadable-file-name">{shortName}</span>{stateLabel && <span className="downloadable-file-state">{stateLabel}</span>}</button>
        })()}
      </Fragment>
    })}
    {tone === 'answer' && <footer className="ai-markdown-answer-actions" aria-label="回复操作">
      <button type="button" onClick={() => void copyAnswer()}>{copied ? '已复制' : '复制回答'}</button>
      <button type="button" className="primary" onClick={createDocument}>✎ 转为文档编辑</button>
      <div className="ai-markdown-answer-more" ref={moreMenuRef}>
        <button type="button" aria-haspopup="menu" aria-expanded={moreOpen} onClick={() => setMoreOpen(value => !value)}>••• 更多</button>
        {moreOpen && <div className="ai-markdown-answer-more-menu" role="menu" aria-label="更多回复操作">
          <button type="button" role="menuitem" disabled={!!documentBusy} onClick={() => downloadFromMore('word')}>下载 Word</button>
          <button type="button" role="menuitem" disabled={!!documentBusy} onClick={() => downloadFromMore('markdown')}>下载 Markdown</button>
          <button type="button" role="menuitem" onClick={toggleFavorite}>{favorited ? '取消收藏' : '收藏回复'}</button>
        </div>}
      </div>
      {actionNotice && <small role="status">{actionNotice}</small>}
      {feedback && (
        <div className="ai-markdown-answer-feedback" aria-label="回答反馈">
          <button
            type="button"
            className="message-action-retry"
            aria-label="重新生成这条回答"
            title={feedback.isBusy ? '请先停止当前任务' : '把这条 user 消息重新填入 Composer'}
            disabled={feedback.isBusy}
            onClick={() => feedback.onRerun?.()}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">
              <path d="M3.5 10a6.5 6.5 0 0 1 11.13-4.55M16.5 10a6.5 6.5 0 0 1-11.13 4.55M14.6 3.4v2.55h-2.55M5.4 16.6v-2.55h2.55" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            重新生成
          </button>
          <button
            type="button"
            className={`feedback-up ${feedback.currentRating === 'up' ? 'active' : ''}`}
            aria-label="这条回答有帮助"
            aria-pressed={feedback.currentRating === 'up'}
            title="这条回答有帮助"
            onClick={() => feedback.onRate?.('up')}
          >
            <span aria-hidden="true">👍</span>
            有帮助
          </button>
          <button
            type="button"
            className={`feedback-down ${feedback.currentRating === 'down' ? 'active' : ''}`}
            aria-label="这条回答需要改进"
            aria-pressed={feedback.currentRating === 'down'}
            title="这条回答需要改进"
            onClick={() => feedback.onRate?.('down')}
          >
            <span aria-hidden="true">👎</span>
            需要改进
          </button>
        </div>
      )}
    </footer>}
    {tone === 'answer' && documentReady && <section className="ai-markdown-document-card" aria-label="已生成的报告文档">
      <header><b>文档已准备</b><span>{documentEditing ? '编辑中 · 自动保存' : '可下载编辑版文件'}</span></header>
      <p title={documentTitle}>{documentTitle}</p>
      {documentEditing && <textarea aria-label="报告文档编辑区" value={editedContent} onChange={event => updateDocument(event.target.value)} />}
      <div>
        <button type="button" onClick={() => setDocumentEditing(value => !value)}>{documentEditing ? '完成编辑' : '编辑文档'}</button>
        <button type="button" disabled={!!documentBusy} onClick={() => void downloadDocument('word')}>{documentBusy === 'word' ? '生成中…' : '下载 Word'}</button>
        <button type="button" disabled={!!documentBusy} onClick={() => void downloadDocument('markdown')}>{documentBusy === 'markdown' ? '生成中…' : '下载 Markdown'}</button>
      </div>
      {onPrompt && <div className="ai-markdown-document-prompts" aria-label="基于文档的提问建议">
        <b>基于文档继续提问</b>
        {documentPrompts.map(prompt => <button key={prompt} type="button" onClick={() => onPrompt(prompt)}>{prompt} <span>→</span></button>)}
      </div>}
    </section>}
  </div>
}
