/**
 * 知识库中心：两大类（智能体知识库 / 自定义知识库）+ 自研文件管理视图。
 * - 智能体区：每个 AI 员工固定卡位，未生成可一键生成专属库
 * - 自定义区：对话框创建、可删除（卡片内二次确认）
 * - 文件管理：上传 → 自动解析 → 状态轮询（RUNNING 每 3 秒刷新）
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { getServerBaseUrl } from '../shared/serverHttp'
import type { KbAgentKey, KbCategoryNode, KbDocsView, KbListView, KbView } from '../shared/knowledge'
import type { GuardianFrequency, GuardianRunLog, GuardianRunStatus, GuardianSkill, GuardianSkillInput, GuardianState } from '../shared/kbGuardian'
import './knowledge-hub.css'

type Tab = 'all' | 'agent' | 'custom'
type View = { kind: 'home' } | { kind: 'kb'; kb: KbView }
// 分类树展平项：供下拉选项与管理对话框使用
type FlatCat = { name: string; path: string; depth: number; hasChildren: boolean }

const RUN_META: Record<string, { label: string; cls: string }> = {
  DONE: { label: '已解析', cls: 'done' },
  RUNNING: { label: '解析中', cls: 'running' },
  UNSTART: { label: '未解析', cls: 'idle' },
  FAIL: { label: '解析失败', cls: 'fail' },
  CANCEL: { label: '已停止', cls: 'idle' }
}

function formatSize(size: number): string {
  if (!size) return '—'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatDate(value: string): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function ragflowConsoleUrl(): string {
  try {
    const base = new URL(getServerBaseUrl())
    base.port = '8090'
    base.pathname = '/'
    return base.toString()
  } catch {
    return 'http://114.55.149.192:8090/'
  }
}

export default function KnowledgeHub({ onOpenEmployee }: { onOpenEmployee?: () => void }) {
  const [view, setView] = useState<View>({ kind: 'home' })
  const [data, setData] = useState<KbListView | null>(null)
  const [failure, setFailure] = useState('')
  const [tab, setTab] = useState<Tab>('all')
  const [query, setQuery] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      setData(await window.desktop.kb.list())
      setFailure('')
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : '知识库列表加载失败')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  // 知识库守卫：技能状态独立加载（服务不可用时不影响知识库主页）
  const [guardian, setGuardian] = useState<GuardianState | null>(null)
  const loadGuardian = useCallback(async () => {
    try {
      setGuardian(await window.desktop.kbGuardian.state())
    } catch {
      // 旧主进程无守卫通道时静默降级
    }
  }, [])
  useEffect(() => { void loadGuardian() }, [loadGuardian])
  useEffect(() => window.desktop.kbGuardian.onRunEvent(event => {
    void loadGuardian()
    if (event.type === 'finished') void load()
  }), [loadGuardian, load])

  if (view.kind === 'kb') {
    return <KbFilesView kb={view.kb} onBack={() => { setView({ kind: 'home' }); void load() }} />
  }

  const keyword = query.trim()
  const agents = (data?.agents ?? []).filter(slot => !keyword || slot.name.includes(keyword) || (slot.kb?.name ?? '').includes(keyword))
  const customs = (data?.customs ?? []).filter(kb => !keyword || kb.name.includes(keyword) || kb.description.includes(keyword))
  const generatedCount = (data?.agents ?? []).filter(slot => slot.kb).length
  const guardianKbIds = new Set((guardian?.skills ?? []).map(skill => skill.targetKbId))

  const generate = async (agentKey: KbAgentKey) => {
    setBusy(agentKey)
    try {
      await window.desktop.kb.ensureAgent(agentKey)
      await load()
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : '生成智能体知识库失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="kb-hub">
      <header className="kb-hub-header">
        <div>
          <h1>知识库</h1>
          <p>两大类：智能体知识库 · 自定义知识库</p>
        </div>
        <div className="kb-hub-actions">
          <input className="kb-hub-search" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索知识库…" />
          <button type="button" className="kb-btn ghost" onClick={() => void window.desktop.system.openExternal(ragflowConsoleUrl())}>RAGFlow 控制台</button>
          <button type="button" className="kb-btn primary" onClick={() => setCreateOpen(true)}>＋ 创建自定义知识库</button>
        </div>
      </header>

      <div className="kb-hub-tabs">
        <button type="button" className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>全部</button>
        <button type="button" className={tab === 'agent' ? 'active' : ''} onClick={() => setTab('agent')}>智能体知识库{data ? ` · ${generatedCount}/${data.agents.length}` : ''}</button>
        <button type="button" className={tab === 'custom' ? 'active' : ''} onClick={() => setTab('custom')}>自定义知识库{data ? ` · ${data.customs.length}` : ''}</button>
      </div>

      {failure && <div className="kb-hub-error"><span>{failure}</span><button type="button" onClick={() => void load()}>重试</button></div>}

      <div className="kb-hub-body">
        <GuardianSection state={guardian} onChanged={() => { void loadGuardian(); void load() }} />
        {tab !== 'custom' && (
          <section className="kb-hub-section">
            <h2>智能体知识库<small>每个 AI 员工自动生成各自专属知识库</small></h2>
            <div className="kb-hub-grid">
              {agents.map(slot => (
                <article className="kb-card" key={slot.key}>
                  <header>
                    <span className="kb-card-icon" style={{ color: slot.color, background: `${slot.color}16`, borderColor: `${slot.color}3a` }}>{slot.icon}</span>
                    <div className="kb-card-title">
                      <b>{slot.name}<em className="kb-badge agent">智能体</em>{slot.kb && guardianKbIds.has(slot.kb.id) && <em className="kb-badge guardian">守卫写入</em>}</b>
                      <small>{slot.role}</small>
                    </div>
                  </header>
                  {slot.kb ? (
                    <>
                      <div className="kb-card-stats">
                        <span><b>{slot.kb.documentCount}</b> 文件</span>
                        <span><b>{slot.kb.chunkCount}</b> 片段</span>
                        <span>更新 {formatDate(slot.kb.updateDate)}</span>
                      </div>
                      <footer>
                        <button type="button" className="kb-btn" onClick={() => setView({ kind: 'kb', kb: slot.kb as KbView })}>文件管理</button>
                        {onOpenEmployee && <button type="button" className="kb-btn" onClick={onOpenEmployee}>提问它</button>}
                      </footer>
                    </>
                  ) : (
                    <footer className="kb-card-empty">
                      <small>尚未生成专属知识库</small>
                      <button type="button" className="kb-btn primary" disabled={busy === slot.key} onClick={() => void generate(slot.key)}>{busy === slot.key ? '生成中…' : '生成知识库'}</button>
                    </footer>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
        {tab !== 'agent' && (
          <section className="kb-hub-section">
            <h2>自定义知识库<small>根据个人需求创建</small></h2>
            {customs.length === 0 ? (
              <div className="kb-hub-empty">暂无自定义知识库，点击右上角「创建自定义知识库」开始。</div>
            ) : (
              <div className="kb-hub-grid">
                {customs.map(kb => <CustomKbCard key={kb.id} kb={kb} guardianWritten={guardianKbIds.has(kb.id)} onOpen={() => setView({ kind: 'kb', kb })} onDeleted={() => void load()} />)}
              </div>
            )}
          </section>
        )}
      </div>

      {createOpen && <CreateKbDialog onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); void load() }} />}
    </section>
  )
}

// ─── 自定义知识库卡片（含删除二次确认） ─────────────────────────────────────
function CustomKbCard({ kb, onOpen, onDeleted, guardianWritten }: { kb: KbView; onOpen: () => void; onDeleted: () => void; guardianWritten?: boolean }) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const remove = async () => {
    setBusy(true)
    try {
      await window.desktop.kb.remove(kb.id)
      onDeleted()
    } catch {
      setBusy(false)
      setArmed(false)
    }
  }
  return (
    <article className="kb-card">
      <header>
        <span className="kb-card-icon custom">自</span>
        <div className="kb-card-title">
          <b>{kb.name}<em className="kb-badge custom">自定义</em>{guardianWritten && <em className="kb-badge guardian">守卫写入</em>}</b>
          <small>{kb.description || '个人自定义知识库'}</small>
        </div>
      </header>
      <div className="kb-card-stats">
        <span><b>{kb.documentCount}</b> 文件</span>
        <span><b>{kb.chunkCount}</b> 片段</span>
        <span>更新 {formatDate(kb.updateDate)}</span>
      </div>
      <footer>
        <button type="button" className="kb-btn" onClick={onOpen}>文件管理</button>
        {armed ? (
          <>
            <button type="button" className="kb-btn danger" disabled={busy} onClick={() => void remove()}>{busy ? '删除中…' : '确认删除'}</button>
            <button type="button" className="kb-btn" disabled={busy} onClick={() => setArmed(false)}>取消</button>
          </>
        ) : (
          <button type="button" className="kb-btn danger-ghost" onClick={() => setArmed(true)}>删除</button>
        )}
      </footer>
    </article>
  )
}

// ─── 创建自定义知识库对话框 ─────────────────────────────────────────────────
function CreateKbDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    if (!name.trim()) { setError('名称不能为空'); return }
    setBusy(true)
    setError('')
    try {
      await window.desktop.kb.createCustom({ name, description })
      onCreated()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败')
      setBusy(false)
    }
  }
  return (
    <div className="kb-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="kb-dialog" role="dialog" aria-modal="true" aria-labelledby="kb-create-title">
        <header><h3 id="kb-create-title">创建自定义知识库</h3><button type="button" aria-label="关闭" disabled={busy} onClick={onClose}>×</button></header>
        <label><span>名称 *</span><input autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={60} placeholder="例如：我的选品笔记" /></label>
        <label><span>描述</span><textarea value={description} onChange={event => setDescription(event.target.value)} maxLength={200} rows={3} placeholder="用途说明（可选）" /></label>
        {error && <p className="kb-dialog-error">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="primary" disabled={busy || !name.trim()} onClick={() => void submit()}>{busy ? '创建中…' : '创建'}</button>
        </footer>
      </div>
    </div>
  )
}

// ─── 自研文件管理视图 ───────────────────────────────────────────────────────
function KbFilesView({ kb, onBack }: { kb: KbView; onBack: () => void }) {
  const [payload, setPayload] = useState<KbDocsView | null>(null)
  const [failure, setFailure] = useState('')
  const [busy, setBusy] = useState('')
  const [armed, setArmed] = useState('')
  // rootFilter: 顶层视图过滤 · drill: 面包屑下钻路径（分类名数组）
  const [rootFilter, setRootFilter] = useState<'all' | 'none'>('all')
  const [drill, setDrill] = useState<string[]>([])
  const [uploadCat, setUploadCat] = useState('')
  const [catDialog, setCatDialog] = useState<'create' | 'manage' | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      setPayload(await window.desktop.kb.docs(kb.id))
      setFailure('')
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : '文件列表加载失败')
    }
  }, [kb.id])
  useEffect(() => { void load() }, [load])

  // 解析中轮询：存在 RUNNING 文档时每 3 秒刷新
  useEffect(() => {
    if (!payload?.docs.some(doc => doc.run === 'RUNNING')) return
    const timer = setTimeout(() => void load(), 3000)
    return () => clearTimeout(timer)
  }, [payload, load])

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    const paths = Array.from(files).map(file => (file as File & { path?: string }).path).filter((item): item is string => Boolean(item))
    if (fileRef.current) fileRef.current.value = ''
    if (!paths.length) return
    setBusy('upload')
    try {
      const ids = await window.desktop.kb.upload({ kbId: kb.id, filePaths: paths, category: uploadCat || undefined })
      if (ids.length) await window.desktop.kb.parse({ kbId: kb.id, docIds: ids })
      await load()
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : '上传失败')
    } finally {
      setBusy('')
    }
  }

  const parse = async (docId: string) => {
    setBusy(`parse:${docId}`)
    try {
      await window.desktop.kb.parse({ kbId: kb.id, docIds: [docId] })
      await load()
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : '触发解析失败')
    } finally {
      setBusy('')
    }
  }

  const stop = async (docId: string) => {
    setBusy(`stop:${docId}`)
    try {
      await window.desktop.kb.stopParse({ kbId: kb.id, docIds: [docId] })
      await load()
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : '停止解析失败')
    } finally {
      setBusy('')
    }
  }

  const remove = async (docId: string) => {
    setBusy(`del:${docId}`)
    try {
      await window.desktop.kb.deleteDocs({ kbId: kb.id, docIds: [docId] })
      setArmed('')
      await load()
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : '删除文件失败')
    } finally {
      setBusy('')
    }
  }

  const assign = async (docId: string, category: string) => {
    setBusy(`assign:${docId}`)
    try {
      await window.desktop.kb.assignDocs({ kbId: kb.id, docIds: [docId], category: category || null })
      await load()
    } catch (reason) {
      setFailure(reason instanceof Error ? reason.message : '移动分类失败')
    } finally {
      setBusy('')
    }
  }

  const allDocs = payload?.docs ?? []
  const categoryNodes: KbCategoryNode[] = payload?.categories ?? []
  const childrenOf = (parent: string | undefined) => categoryNodes.filter(node => (node.parent ?? '') === (parent ?? ''))
  // 按树序展平：供上传/移动下拉与管理对话框使用
  const flatCategories: FlatCat[] = []
  const walk = (parent: string | undefined, prefix: string, depth: number) => {
    for (const node of childrenOf(parent)) {
      const path = prefix ? `${prefix} / ${node.name}` : node.name
      flatCategories.push({ name: node.name, path, depth, hasChildren: childrenOf(node.name).length > 0 })
      walk(node.name, path, depth + 1)
    }
  }
  walk(undefined, '', 0)
  // 子树名集合：胶囊计数与下钻过滤都含后代
  const subtreeSet = (root: string): Set<string> => {
    const set = new Set([root])
    let changed = true
    while (changed) {
      changed = false
      for (const node of categoryNodes) {
        if (!set.has(node.name) && node.parent && set.has(node.parent)) { set.add(node.name); changed = true }
      }
    }
    return set
  }
  const countSubtree = (name: string) => {
    const set = subtreeSet(name)
    return allDocs.filter(doc => set.has(doc.category ?? '')).length
  }
  const noneCount = allDocs.filter(doc => !(doc.category ?? '')).length

  const current = drill[drill.length - 1]
  const levelCats = childrenOf(current)
  const visibleDocs = drill.length === 0 || !current
    ? (rootFilter === 'none' ? allDocs.filter(doc => !(doc.category ?? '')) : allDocs)
    : allDocs.filter(doc => subtreeSet(current).has(doc.category ?? ''))

  // 下钻中的分类被删除时自动退回上层
  useEffect(() => {
    if (!payload) return
    const names = new Set(payload.categories.map(node => node.name))
    setDrill(prev => {
      const valid: string[] = []
      for (const name of prev) {
        if (!names.has(name)) break
        valid.push(name)
      }
      return valid.length === prev.length ? prev : valid
    })
  }, [payload])

  // 上传归类默认跟随当前下钻的叶子分类
  useEffect(() => {
    if (!current) { setUploadCat(''); return }
    const isLeaf = (payload?.categories ?? []).every(node => node.parent !== current)
    setUploadCat(isLeaf ? current : '')
  }, [current, payload])

  return (
    <section className="kb-hub kb-files">
      <header className="kb-hub-header">
        <div className="kb-files-head">
          <button type="button" className="kb-btn" onClick={onBack}>← 返回</button>
          <div>
            <h1>{kb.name}{kb.category === 'agent' ? <em className="kb-badge agent">智能体</em> : <em className="kb-badge custom">自定义</em>}</h1>
            <p>{kb.documentCount} 文件 · {kb.chunkCount} 片段 · 更新 {formatDate(kb.updateDate)}</p>
          </div>
        </div>
        <div className="kb-hub-actions">
          <select className="kb-cat-select" title="上传归类到" value={uploadCat} onChange={event => setUploadCat(event.target.value)}>
            <option value="">上传到：未分类</option>
            {flatCategories.map(item => <option key={item.name} value={item.name}>上传到：{item.path}</option>)}
          </select>
          <input ref={fileRef} type="file" multiple hidden accept=".md,.mdx,.txt,.pdf,.docx,.pptx,.png,.jpg,.jpeg,.gif,.svg,.webp" onChange={event => void upload(event.target.files)} />
          <button type="button" className="kb-btn primary" disabled={busy === 'upload'} onClick={() => fileRef.current?.click()}>{busy === 'upload' ? '上传中…' : '↑ 上传文件'}</button>
        </div>
      </header>

      {failure && <div className="kb-hub-error"><span>{failure}</span><button type="button" onClick={() => void load()}>重试</button></div>}

      <div className="kb-cat-bar">
        {drill.length === 0 ? (
          <>
            <button type="button" className={rootFilter === 'all' ? 'active' : ''} onClick={() => setRootFilter('all')}>全部 {allDocs.length}</button>
            {levelCats.map(node => (
              <button key={node.name} type="button" onClick={() => { setDrill([node.name]); setRootFilter('all') }}>{node.name} {countSubtree(node.name)}</button>
            ))}
            <button type="button" className={rootFilter === 'none' ? 'active' : ''} onClick={() => setRootFilter('none')}>未分类 {noneCount}</button>
          </>
        ) : (
          <>
            <button type="button" className="kb-cat-crumb" onClick={() => setDrill([])}>← 全部</button>
            {drill.map((name, index) => (
              <button key={name} type="button" className={`kb-cat-crumb${index === drill.length - 1 ? ' current' : ''}`} onClick={() => setDrill(drill.slice(0, index + 1))}>/ {name}{index === drill.length - 1 ? ` ${countSubtree(name)}` : ''}</button>
            ))}
            {levelCats.map(node => (
              <button key={node.name} type="button" onClick={() => setDrill([...drill, node.name])}>{node.name} {countSubtree(node.name)}</button>
            ))}
          </>
        )}
        <span className="kb-cat-bar-actions">
          <button type="button" className="kb-btn ghost" onClick={() => setCatDialog('create')}>{current ? `＋ 在「${current}」下新建` : '＋ 新建分类'}</button>
          {categoryNodes.length > 0 && <button type="button" className="kb-btn ghost" onClick={() => setCatDialog('manage')}>管理</button>}
        </span>
      </div>

      <div className="kb-files-table">
        <div className="kb-files-row head"><span>文件名</span><span>分类</span><span>大小</span><span>片段</span><span>状态</span><span>更新时间</span><span>操作</span></div>
        {!payload && !failure && <div className="kb-hub-empty">加载中…</div>}
        {payload && allDocs.length === 0 && <div className="kb-hub-empty">暂无文件，点击「上传文件」添加第一篇文档。</div>}
        {payload && allDocs.length > 0 && visibleDocs.length === 0 && <div className="kb-hub-empty">当前分类下暂无文件。</div>}
        {visibleDocs.map(doc => {
          const meta = RUN_META[doc.run] ?? RUN_META.UNSTART
          return (
            <div className="kb-files-row" key={doc.id}>
              <span className="kb-files-name" title={doc.name}>{doc.name}</span>
              <span>
                <select className="kb-cat-select" title="移动到分类" value={doc.category ?? ''} disabled={busy === `assign:${doc.id}`} onChange={event => void assign(doc.id, event.target.value)}>
                  <option value="">未分类</option>
                  {flatCategories.map(item => <option key={item.name} value={item.name}>{item.path}</option>)}
                </select>
              </span>
              <span>{formatSize(doc.size)}</span>
              <span>{doc.chunkCount}</span>
              <span><em className={`kb-run ${meta.cls}`}>{meta.label}{doc.run === 'RUNNING' ? ` ${Math.round(doc.progress * 100)}%` : ''}</em></span>
              <span>{formatDate(doc.updateDate)}</span>
              <span className="kb-files-ops">
                {doc.run === 'RUNNING' ? (
                  <button type="button" className="kb-btn" disabled={busy === `stop:${doc.id}`} onClick={() => void stop(doc.id)}>停止</button>
                ) : (
                  <button type="button" className="kb-btn" disabled={busy === `parse:${doc.id}`} onClick={() => void parse(doc.id)}>{doc.run === 'DONE' ? '重新解析' : '解析'}</button>
                )}
                {armed === doc.id ? (
                  <>
                    <button type="button" className="kb-btn danger" disabled={busy === `del:${doc.id}`} onClick={() => void remove(doc.id)}>确认</button>
                    <button type="button" className="kb-btn" onClick={() => setArmed('')}>取消</button>
                  </>
                ) : (
                  <button type="button" className="kb-btn danger-ghost" onClick={() => setArmed(doc.id)}>删除</button>
                )}
              </span>
            </div>
          )
        })}
      </div>

      {catDialog === 'create' && (
        <CreateCategoryDialog
          parent={current}
          onClose={() => setCatDialog(null)}
          onCreated={async () => { setCatDialog(null); await load() }}
          create={name => window.desktop.kb.createCategory({ kbId: kb.id, name, parent: current })}
        />
      )}
      {catDialog === 'manage' && (
        <ManageCategoryDialog
          kbId={kb.id}
          categories={flatCategories}
          onClose={() => setCatDialog(null)}
          onChanged={async () => { await load() }}
        />
      )}
    </section>
  )
}

// ─── 新建分类对话框（支持指定父级） ───────────────────────────────────────────
function CreateCategoryDialog({ parent, onClose, onCreated, create }: { parent?: string; onClose: () => void; onCreated: () => void; create: (name: string) => Promise<void> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    if (!name.trim()) { setError('分类名称不能为空'); return }
    setBusy(true)
    setError('')
    try {
      await create(name)
      onCreated()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建失败')
      setBusy(false)
    }
  }
  return (
    <div className="kb-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="kb-dialog" role="dialog" aria-modal="true" aria-labelledby="kb-cat-create-title">
        <header><h3 id="kb-cat-create-title">{parent ? `在「${parent}」下新建子分类` : '新建分类'}</h3><button type="button" aria-label="关闭" disabled={busy} onClick={onClose}>×</button></header>
        <label><span>分类名称 *</span><input autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={40} placeholder={parent ? '例如：Amazon / 美国' : '例如：平台规则 / 国家法规'} onKeyDown={event => { if (event.key === 'Enter') void submit() }} /></label>
        {error && <p className="kb-dialog-error">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="primary" disabled={busy || !name.trim()} onClick={() => void submit()}>{busy ? '创建中…' : '创建'}</button>
        </footer>
      </div>
    </div>
  )
}

// ─── 分类管理对话框：树形缩进列表，重命名 / 删除（删除父级连子树一起删，文档回落未分类不删文件） ─────────
function ManageCategoryDialog({ kbId, categories, onClose, onChanged }: { kbId: string; categories: FlatCat[]; onClose: () => void; onChanged: () => Promise<void> }) {
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  const rename = async (oldName: string) => {
    const newName = (drafts[oldName] ?? oldName).trim()
    if (!newName || newName === oldName) return
    setBusy(`rename:${oldName}`)
    setError('')
    try {
      await window.desktop.kb.renameCategory({ kbId, oldName, newName })
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重命名失败')
    } finally {
      setBusy('')
    }
  }

  const remove = async (name: string) => {
    setBusy(`del:${name}`)
    setError('')
    try {
      await window.desktop.kb.deleteCategory({ kbId, name })
      setArmed('')
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="kb-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="kb-dialog" role="dialog" aria-modal="true" aria-labelledby="kb-cat-manage-title">
        <header><h3 id="kb-cat-manage-title">管理分类</h3><button type="button" aria-label="关闭" disabled={Boolean(busy)} onClick={onClose}>×</button></header>
        <div className="kb-cat-manage-list">
          {categories.map(item => (
            <div className="kb-cat-manage-row" key={item.name} style={{ paddingLeft: item.depth * 16 }}>
              <small className="kb-cat-manage-depth" title={item.path}>{item.hasChildren ? '▸' : '·'}</small>
              <input value={drafts[item.name] ?? item.name} onChange={event => setDrafts(state => ({ ...state, [item.name]: event.target.value }))} maxLength={40} />
              <button type="button" className="kb-btn" disabled={busy !== '' || !(drafts[item.name] ?? item.name).trim() || (drafts[item.name] ?? item.name).trim() === item.name} onClick={() => void rename(item.name)}>{busy === `rename:${item.name}` ? '保存中…' : '保存'}</button>
              {armed === item.name ? (
                <>
                  <button type="button" className="kb-btn danger" disabled={busy !== ''} onClick={() => void remove(item.name)}>{busy === `del:${item.name}` ? '删除中…' : '确认删除'}</button>
                  <button type="button" className="kb-btn" disabled={busy !== ''} onClick={() => setArmed('')}>取消</button>
                </>
              ) : (
                <button type="button" className="kb-btn danger-ghost" disabled={busy !== ''} onClick={() => setArmed(item.name)}>删除</button>
              )}
            </div>
          ))}
        </div>
        <p className="kb-cat-manage-tip">删除分类不会删除文件；删除父分类会连同其下所有子分类一起移除，相关文档回落到「未分类」。</p>
        {error && <p className="kb-dialog-error">{error}</p>}
        <footer>
          <button type="button" className="primary" disabled={Boolean(busy)} onClick={onClose}>完成</button>
        </footer>
      </div>
    </div>
  )
}

// ─── 知识库守卫：技能卡区（自动收集本地内容 · 增量更新目标知识库） ─────────────
const GUARDIAN_FREQ_LABEL: Record<GuardianFrequency, string> = { manual: '手动', daily: '每日 09:00', weekly: '每周一 09:00' }
const GUARDIAN_TRIGGER_LABEL: Record<GuardianRunLog['trigger'], string> = { manual: '手动', schedule: '定时', catchup: '补跑' }
const GUARDIAN_STATUS_LABEL: Record<GuardianRunStatus, string> = { ok: '成功', partial: '部分失败', failed: '失败' }
const GUARDIAN_EXT_OPTIONS = ['.md', '.txt', '.pdf', '.docx']

function GuardianSection({ state, onChanged }: { state: GuardianState | null; onChanged: () => void }) {
  const [edit, setEdit] = useState<{ skill?: GuardianSkill } | null>(null)
  const [logsFor, setLogsFor] = useState<GuardianSkill | null>(null)
  const [armed, setArmed] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  // J 阶段新增：运行进度条状态
  // - runStartedAt: 记录每个 skill 的 startedAt；用于 ticker 算 elapsed 不依赖主进程推送
  // - progress: 主进程推来的最近一次 progress 事件；携带 processed / total / sinceStartMs
  const [runStartedAt, setRunStartedAt] = useState<Record<string, number>>({})
  const [progress, setProgress] = useState<Record<string, { processed: number; total: number; sinceStartMs: number; added?: number; updated?: number; skipped?: number; fallbackToHard?: number }>>({})
  // J 阶段新增：ticker 每秒触发一次重渲染，让进度条“已运行 Xs”文本实时刷新
  const [, setTick] = useState(0)
  const skills = state?.skills ?? []
  const hasRunning = skills.some(skill => skill.running)
  useEffect(() => {
    if (!hasRunning) return
    const timer = setInterval(() => setTick(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [hasRunning])
  // J 阶段新增：订阅 run-event，维护 startedAt / progress 状态
  useEffect(() => {
    return window.desktop.kbGuardian.onRunEvent(event => {
      if (event.type === 'started') {
        setRunStartedAt(prev => ({ ...prev, [event.skillId]: Date.now() }))
        setProgress(prev => {
          const next = { ...prev }
          delete next[event.skillId]
          return next
        })
      } else if (event.type === 'progress') {
        setProgress(prev => ({ ...prev, [event.skillId]: event }))
      } else if (event.type === 'finished') {
        setRunStartedAt(prev => {
          const next = { ...prev }
          delete next[event.skillId]
          return next
        })
        setProgress(prev => {
          const next = { ...prev }
          delete next[event.skillId]
          return next
        })
      }
    })
  }, [])

  const run = async (id: string) => {
    setBusy(`run:${id}`)
    setError('')
    try {
      const result = await window.desktop.kbGuardian.runNow(id)
      if (!result.queued && result.reason) setError(result.reason)
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '触发运行失败')
    } finally {
      setBusy('')
    }
  }

  const toggle = async (skill: GuardianSkill) => {
    setBusy(`toggle:${skill.id}`)
    setError('')
    try {
      await window.desktop.kbGuardian.update(skill.id, { name: skill.name, sourcePath: skill.sourcePath, fileExts: skill.fileExts, targetKbId: skill.targetKbId, targetKbName: skill.targetKbName, frequency: skill.frequency, enabled: !skill.enabled })
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '更新技能失败')
    } finally {
      setBusy('')
    }
  }

  const remove = async (id: string) => {
    setBusy(`del:${id}`)
    try {
      await window.desktop.kbGuardian.remove(id)
      setArmed('')
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除技能失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <section className="kb-hub-section">
      <h2>守卫技能<small>自动收集本地内容 · 增量更新目标知识库</small><span className="kb-guardian-new"><button type="button" className="kb-btn primary" onClick={() => setEdit({})}>＋ 新建技能</button></span></h2>
      {error && <div className="kb-hub-error"><span>{error}</span></div>}
      {skills.length === 0 ? (
        <div className="kb-hub-empty">暂无守卫技能，点击「＋ 新建技能」配置第一条自动更新规则（源目录 → 目标知识库）。</div>
      ) : (
        <div className="kb-hub-grid">
          {skills.map(skill => {
            // J 阶段新增：进度条状态推导
            const startedAt = runStartedAt[skill.id]
            const prog = progress[skill.id]
            // elapsed 以「主进程 sinceStartMs 优先 + 本地 tick 补充」双保险
            // 进度条出现条件：running 且 elapsed > 30s
            const elapsed = prog?.sinceStartMs ?? (startedAt ? Date.now() - startedAt : 0)
            const showProgress = Boolean(skill.running && (prog || startedAt) && elapsed > 30_000)
            const percent = prog && prog.total > 0 ? Math.min(100, Math.round((prog.processed / prog.total) * 100)) : null
            return (
            <article className="kb-card" key={skill.id}>
              <header>
                <span className="kb-card-icon guardian">卫</span>
                <div className="kb-card-title">
                  <b>{skill.name}{skill.running && <em className="kb-badge guardian">运行中</em>}</b>
                  <small title={skill.sourcePath}>{skill.sourcePath} → {skill.targetKbName}</small>
                </div>
                <label className="kb-guardian-switch" title={skill.enabled ? '已启用' : '已停用'}>
                  <input type="checkbox" checked={skill.enabled} disabled={busy === `toggle:${skill.id}`} onChange={() => void toggle(skill)} />
                  <i />
                </label>
              </header>
              <div className="kb-card-stats">
                <span>{GUARDIAN_FREQ_LABEL[skill.frequency]}</span>
                <span>上次运行 {skill.lastRunAt ? new Date(skill.lastRunAt).toLocaleString('zh-CN', { hour12: false }) : '—'}</span>
                {skill.lastStats && <span>新增 <b>{skill.lastStats.added}</b> 更新 <b>{skill.lastStats.updated}</b> 跳过 <b>{skill.lastStats.skipped}</b>{skill.lastStats.failed > 0 && <> 失败 <b>{skill.lastStats.failed}</b></>}</span>}
              </div>
              {/* J 阶段新增：> 30s 长时运行进度条 */}
              {showProgress && (
                <div className="kb-guardian-progress" role="status" aria-live="polite">
                  <div className="kb-guardian-progress-text">
                    ⏳ 已运行 <b>{Math.floor(elapsed / 1000)}s</b>
                    {prog && <> · 已处理 <b>{prog.processed}</b>/<b>{prog.total || '?'}</b></>}
                    {prog?.added !== undefined && <> · 新增 <b>{prog.added}</b></>}
                    {prog?.updated !== undefined && <> · 更新 <b>{prog.updated}</b></>}
                    {prog?.skipped !== undefined && prog.skipped > 0 && <> · 跳过 <b>{prog.skipped}</b></>}
                    {prog?.fallbackToHard !== undefined && prog.fallbackToHard > 0 && <> · 软→硬 <b>{prog.fallbackToHard}</b></>}
                  </div>
                  <div className={`kb-guardian-progress-bar ${percent === null ? 'indeterminate' : ''}`}>
                    {percent !== null ? (
                      <div className="kb-guardian-progress-bar-fill" style={{ width: `${percent}%` }} />
                    ) : (
                      <div className="kb-guardian-progress-bar-indet" />
                    )}
                  </div>
                </div>
              )}
              <footer>
                <button type="button" className="kb-btn primary" disabled={skill.running || busy === `run:${skill.id}`} onClick={() => void run(skill.id)}>{skill.running ? '运行中…' : '立即执行'}</button>
                <button type="button" className="kb-btn" onClick={() => setLogsFor(skill)}>日志</button>
                <button type="button" className="kb-btn" onClick={() => setEdit({ skill })}>编辑</button>
                {armed === skill.id ? (
                  <>
                    <button type="button" className="kb-btn danger" disabled={busy === `del:${skill.id}`} onClick={() => void remove(skill.id)}>{busy === `del:${skill.id}` ? '删除中…' : '确认'}</button>
                    <button type="button" className="kb-btn" onClick={() => setArmed('')}>取消</button>
                  </>
                ) : (
                  <button type="button" className="kb-btn danger-ghost" onClick={() => setArmed(skill.id)}>删除</button>
                )}
              </footer>
            </article>
            )
          })}
        </div>
      )}
      {edit && <GuardianSkillDialog initial={edit.skill} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); onChanged() }} />}
      {logsFor && <GuardianLogsDialog skill={logsFor} onClose={() => setLogsFor(null)} />}
    </section>
  )
}

// ─── 守卫技能新建 / 编辑对话框 ───────────────────────────────────────
function GuardianSkillDialog({ initial, onClose, onSaved }: { initial?: GuardianSkill; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(initial?.name ?? '')
  const [sourcePath, setSourcePath] = useState(initial?.sourcePath ?? '')
  const [exts, setExts] = useState<string[]>(initial?.fileExts?.length ? initial.fileExts : ['.md', '.txt'])
  const [targetKbId, setTargetKbId] = useState(initial?.targetKbId ?? '')
  const [frequency, setFrequency] = useState<GuardianFrequency>(initial?.frequency ?? 'manual')
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [kbs, setKbs] = useState<KbView[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.desktop.kb.list().then(view => {
      const all = [...view.agents.map(slot => slot.kb).filter((kb): kb is KbView => kb !== null), ...view.customs]
      setKbs(all)
      setTargetKbId(prev => prev || (all[0]?.id ?? ''))
    }).catch(() => setError('知识库列表加载失败'))
  }, [])

  const pick = async () => {
    const dir = await window.desktop.kbGuardian.pickDir()
    if (dir) setSourcePath(dir)
  }

  const toggleExt = (ext: string) => {
    setExts(prev => prev.includes(ext) ? prev.filter(item => item !== ext) : [...prev, ext])
  }

  const submit = async () => {
    if (!name.trim()) { setError('技能名称不能为空'); return }
    if (!sourcePath.trim()) { setError('请选择源目录'); return }
    if (!exts.length) { setError('请至少选择一种文件类型'); return }
    const target = kbs.find(kb => kb.id === targetKbId)
    if (!target) { setError('请选择目标知识库'); return }
    setBusy(true)
    setError('')
    const input: GuardianSkillInput = { name, sourcePath, fileExts: exts, targetKbId, targetKbName: target.name, frequency, enabled }
    try {
      if (initial) await window.desktop.kbGuardian.update(initial.id, input)
      else await window.desktop.kbGuardian.create(input)
      onSaved()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
      setBusy(false)
    }
  }

  return (
    <div className="kb-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
      <div className="kb-dialog" role="dialog" aria-modal="true" aria-labelledby="kb-guardian-title">
        <header><h3 id="kb-guardian-title">{initial ? '编辑守卫技能' : '新建守卫技能'}</h3><button type="button" aria-label="关闭" disabled={busy} onClick={onClose}>×</button></header>
        <label><span>技能名称 *</span><input autoFocus value={name} onChange={event => setName(event.target.value)} maxLength={40} placeholder="例如：方法论文档同步" /></label>
        <label><span>源目录 *</span>
          <span className="kb-guardian-dir">
            <input value={sourcePath} onChange={event => setSourcePath(event.target.value)} placeholder="选择本地目录" />
            <button type="button" className="kb-btn" onClick={() => void pick()}>选择目录</button>
          </span>
        </label>
        <label><span>文件类型</span>
          <span className="kb-guardian-exts">
            {GUARDIAN_EXT_OPTIONS.map(ext => (
              <button key={ext} type="button" className={exts.includes(ext) ? 'active' : ''} onClick={() => toggleExt(ext)}>{ext}</button>
            ))}
          </span>
        </label>
        <label><span>目标知识库 *</span>
          <select value={targetKbId} onChange={event => setTargetKbId(event.target.value)}>
            {kbs.length === 0 && <option value="">暂无可选知识库</option>}
            {kbs.map(kb => <option key={kb.id} value={kb.id}>{kb.name}</option>)}
          </select>
        </label>
        <label><span>运行频率</span>
          <select value={frequency} onChange={event => setFrequency(event.target.value as GuardianFrequency)}>
            <option value="manual">仅手动</option>
            <option value="daily">每日 09:00</option>
            <option value="weekly">每周一 09:00</option>
          </select>
        </label>
        <label className="kb-guardian-enabled"><input type="checkbox" checked={enabled} onChange={event => setEnabled(event.target.checked)} /> 启用该技能（定时与启动补跑生效）</label>
        {error && <p className="kb-dialog-error">{error}</p>}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>取消</button>
          <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>{busy ? '保存中…' : '保存'}</button>
        </footer>
      </div>
    </div>
  )
}

// ─── 守卫运行日志抽屉 ────────────────────────────────────────────────
function GuardianLogsDialog({ skill, onClose }: { skill: GuardianSkill; onClose: () => void }) {
  const [logs, setLogs] = useState<GuardianRunLog[] | null>(null)
  // J 阶段新增：每条 log 独立展开状态与重试中状态
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [retrying, setRetrying] = useState<Record<string, boolean>>({})
  const [notice, setNotice] = useState<Record<string, { ok: boolean; msg: string }>>({})
  const reloadLogs = useCallback(() => {
    return window.desktop.kbGuardian.logs(skill.id).then(setLogs).catch(() => setLogs([]))
  }, [skill.id])
  useEffect(() => {
    void reloadLogs()
  }, [reloadLogs])
  // 技能正在运行时每 3s 拉一次（补上运行中日志）
  useEffect(() => {
    if (!skill.running) return
    const timer = setInterval(() => { void reloadLogs() }, 3000)
    return () => clearInterval(timer)
  }, [skill.running, reloadLogs])
  const toggleExpand = (logId: string) => {
    setExpanded(prev => ({ ...prev, [logId]: !prev[logId] }))
  }
  // J 阶段新增：按 logId 重试该次运行中所有失败的文件
  const retry = async (logId: string) => {
    if (retrying[logId]) return
    setRetrying(prev => ({ ...prev, [logId]: true }))
    setNotice(prev => {
      const next = { ...prev }
      delete next[logId]
      return next
    })
    try {
      const result = await window.desktop.kbGuardian.retryFailed({ skillId: skill.id, logId })
      const stillFailed = result.failed
      const okMsg = `重试完成：处理 ${result.retried} · 成功 ${result.succeeded} · 跳过 ${result.skipped} · 仍失败 ${result.failed}`
      setNotice(prev => ({ ...prev, [logId]: { ok: stillFailed === 0, msg: okMsg } }))
      await reloadLogs()
    } catch (reason) {
      setNotice(prev => ({ ...prev, [logId]: { ok: false, msg: reason instanceof Error ? reason.message : '重试失败' } }))
    } finally {
      setRetrying(prev => {
        const next = { ...prev }
        delete next[logId]
        return next
      })
    }
  }
  return (
    <div className="kb-dialog-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <div className="kb-dialog kb-guardian-logs" role="dialog" aria-modal="true" aria-labelledby="kb-guardian-logs-title">
        <header><h3 id="kb-guardian-logs-title">运行日志 · {skill.name}</h3><button type="button" aria-label="关闭" onClick={onClose}>×</button></header>
        {!logs && <div className="kb-hub-empty">加载中…</div>}
        {logs && logs.length === 0 && <div className="kb-hub-empty">暂无运行日志。</div>}
        {logs && logs.length > 0 && (
          <div className="kb-guardian-log-list">
            {logs.map(log => {
              const isOpen = Boolean(expanded[log.id])
              const isRetrying = Boolean(retrying[log.id])
              const logNotice = notice[log.id]
              const duration = log.finishedAt > 0 ? Math.max(0, log.finishedAt - log.startedAt) : 0
              return (
                <div className="kb-guardian-log" key={log.id}>
                  <div className="kb-guardian-log-head">
                    <b>{new Date(log.startedAt).toLocaleString('zh-CN', { hour12: false })}</b>
                    <span>{GUARDIAN_TRIGGER_LABEL[log.trigger]}</span>
                    <em className={`kb-run ${log.status === 'ok' ? 'done' : 'fail'}`}>{GUARDIAN_STATUS_LABEL[log.status]}</em>
                    <button
                      type="button"
                      className="kb-guardian-log-toggle"
                      onClick={() => toggleExpand(log.id)}
                      aria-expanded={isOpen}
                    >{isOpen ? '▲ 收起' : '▼ 详情'}</button>
                  </div>
                  <div className="kb-guardian-log-stats-row">
                    <span className="kb-guardian-stat-chip">新增 <b>{log.added}</b></span>
                    <span className="kb-guardian-stat-chip">更新 <b>{log.updated}</b></span>
                    <span className="kb-guardian-stat-chip">跳过 <b>{log.skipped}</b></span>
                    {log.failures.length > 0 && (
                      <span className="kb-guardian-stat-chip failed">失败 <b>{log.failures.length}</b></span>
                    )}
                    {log.orphansRemoved > 0 && (
                      <span className="kb-guardian-stat-chip" title="本次清理的孤儿文档数">🧹 孤儿 <b>{log.orphansRemoved}</b></span>
                    )}
                    {log.fallbackToHard > 0 && (
                      <span className="kb-guardian-stat-chip fallback" title="软同步失败自动回退硬同步的次数">🔁 软→硬 <b>{log.fallbackToHard}</b></span>
                    )}
                  </div>
                  {isOpen && (
                    <div className="kb-guardian-log-detail">
                      <div>
                        耗时：<b>{duration > 0 ? `${(duration / 1000).toFixed(1)}s` : '运行中…'}</b>
                        {' · '}触发：<b>{GUARDIAN_TRIGGER_LABEL[log.trigger]}</b>
                        {' · '}状态：<b>{GUARDIAN_STATUS_LABEL[log.status]}</b>
                      </div>
                      {log.orphansRemoved > 0 && (
                        <div>孤儿清理：<b>{log.orphansRemoved}</b> 个（源文件被删/重命名后 KB 中残留的旧 docId 已被自动清理）</div>
                      )}
                      {log.fallbackToHard > 0 && (
                        <div>软→硬回退：<b>{log.fallbackToHard}</b> 次（软同步 update_doc 失败，已自动 deleteDocs + uploadAndParse 恢复）</div>
                      )}
                      {log.failures.length > 0 && (
                        <>
                          <div>失败明细（{log.failures.length}）：</div>
                          <ul className="kb-guardian-log-failures">
                            {log.failures.map((failure, index) => <li key={index}>{failure.name}：{failure.reason}</li>)}
                          </ul>
                        </>
                      )}
                      <div className="kb-guardian-log-actions">
                        <button
                          type="button"
                          className="kb-guardian-log-retry"
                          disabled={log.failures.length === 0 || isRetrying}
                          onClick={() => void retry(log.id)}
                          title={log.failures.length === 0 ? '本条无失败项' : `重试本条运行中 ${log.failures.length} 个失败文件`}
                        >{isRetrying ? '⏳ 重试中…' : '🔁 重试失败项'}</button>
                        {logNotice && (
                          <span className={`kb-guardian-log-retry-notice ${logNotice.ok ? 'ok' : 'err'}`}>{logNotice.msg}</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <footer><button type="button" className="primary" onClick={onClose}>关闭</button></footer>
      </div>
    </div>
  )
}

