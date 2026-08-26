import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { getTokens } from './serverApi'
import type { LinduoLoginStatus, LinduoModelPricing } from '../shared/contracts'

type LlmKeyStatus = { id: string; configured: boolean; maskedKey: string }
type LinduoPriceEntry = LinduoModelPricing
type LinduoPricingList = { items: LinduoPriceEntry[]; refreshedAt: string | null; allStale: boolean }

type LlmTestResult = { ok: boolean; latencyMs?: number; error?: string }

type LlmProviderMeta = { id: string; name: string; usage: string; color: string; icon: ReactNode }

// 前端内置提供商元数据；顺序与主进程 llm-keys:list 返回一致
const LLM_PROVIDERS: LlmProviderMeta[] = [
  {
    id: 'bailian',
    name: '阿里百炼（通义千问）',
    usage: '生图 / 视觉 / 翻译 / AI员工对话',
    color: '#2563eb',
    icon: <><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/></>
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    usage: '指令解析 / Listing 优化',
    color: '#0891b2',
    icon: <><path d="M12 2c1 3.5.5 6-1.5 8-2 1.9-2.5 4.5-1.5 7 .8 2 2.6 3 5 3-2.4 1.2-5.2.8-7.2-1.2-2.6-2.7-2.4-7 .5-9.8 2.1-2.1 3.4-4.2 4.7-7z"/></>
  },
  {
    id: 'ark',
    name: '火山方舟（豆包）',
    usage: '视频生成 / 生图',
    color: '#7c3aed',
    icon: <><path d="M3 20h18"/><path d="M5 20l3.5-7L12 20z"/><path d="M12 20l4-9.5L20 20"/></>
  },
  {
    id: 'openai',
    name: 'OpenAI（GPT-Image）',
    usage: '生图（经代理）',
    color: '#0f766e',
    icon: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></>
  },
  {
    id: 'linduo',
    name: '零度API（45 个大模型聚合）',
    usage: 'OpenAI / Anthropic / Google / Vidu 一把 Key',
    color: '#7e22ce',
    icon: <><path d="M12 2l2.39 6.96H22l-6.19 4.5 2.36 6.94L12 15.9l-6.17 4.5 2.36-6.94L2 8.96h7.61z"/></>
  }
]

/**
 * 零度API 价格抓取登录面板：LlmApiKeysPage 零度API 卡片底部内嵌。
 * 为避免面板撑高卡片，默认只露状态条 + 「编辑凭据」按钮；点开后弹出 Modal 填表。
 * 价格展示本身在 LinduoModelMallPage；这里只负责登录态 + 一键刷新入口。
 */
function LinduoLoginPanel({ configured }: { configured: boolean }) {
  const [status, setStatus] = useState<LinduoLoginStatus | null>(null)
  const [pricing, setPricing] = useState<LinduoPricingList | null>(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [autoReLogin, setAutoReLogin] = useState(true)
  const [hasSaved, setHasSaved] = useState(false)
  const [busy, setBusy] = useState<'status' | 'login' | 'logout' | 'refresh' | ''>('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const callWithToken = useCallback(async <T,>(fn: (token: string) => Promise<T>): Promise<T> => {
    const tokens = getTokens()
    if (!tokens?.accessToken) throw new Error('请先在顶部登录页完成砚都认证')
    return fn(tokens.accessToken)
  }, [])

  const refresh = useCallback(async () => {
    setError('')
    try {
      const [loginStatus, pricingList] = await Promise.all([
        callWithToken(token => window.desktop.linduoLogin.getStatus(token)),
        callWithToken(token => window.desktop.linduoLogin.listPricing(token))
      ])
      setStatus(loginStatus)
      setPricing(pricingList)
      // 服务端已存凭据的判定：登录中 / 曾登录过（lastUsedAt 非空）。本地不持久化密码，仅依赖服务端 AES 存储。
      setHasSaved(Boolean(loginStatus.loggedIn || loginStatus.lastUsedAt))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取零度API 登录态失败')
    }
  }, [callWithToken])

  useEffect(() => {
    if (!configured) {
      setStatus(null)
      setPricing(null)
      return
    }
    void refresh()
  }, [configured, refresh])

  // Modal 打开时锁住背景滚动 + 读入上次填过的 username（不读密码）
  useEffect(() => {
    if (!modalOpen) return
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setModalOpen(false) }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [modalOpen])

  const closeModal = () => {
    setModalOpen(false)
    setError('')
    setMessage('')
    setPassword('')
  }

  const submitLogin = async () => {
    if (!username.trim() || !password) {
      setError('请输入零度API 用户名和密码')
      return
    }
    setBusy('login')
    setError('')
    setMessage('')
    try {
      await callWithToken(token => window.desktop.linduoLogin.login(token, username.trim(), password))
      setPassword('')
      setHasSaved(true)
      setMessage('已登录零度API，凭据已使用 AES-256-GCM 安全保存')
      await refresh()
      // 登录成功后 800ms 自动关闭 Modal，让用户看到成功提示
      setTimeout(() => { if (message) closeModal() }, 800)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败')
    } finally {
      setBusy('')
    }
  }

  const submitLogout = async () => {
    setBusy('logout')
    setError('')
    setMessage('')
    try {
      await callWithToken(token => window.desktop.linduoLogin.logout(token))
      setStatus({ loggedIn: false, username: null, expiresAt: null, lastUsedAt: null, expiresInSeconds: null })
      setMessage('已清除零度API 登录态')
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登出失败')
    } finally {
      setBusy('')
    }
  }

  const triggerRefresh = async () => {
    setBusy('refresh')
    setError('')
    setMessage('')
    try {
      const credentials = status?.loggedIn || !password ? undefined : { username: username.trim(), password }
      const result = await callWithToken(token => window.desktop.linduoLogin.refreshPricing(token, credentials))
      if (!result.ok) setError(result.error || '抓取失败')
      else setMessage(`已抓取 ${result.count} 个模型价格，用时 ${(result.durationMs / 1000).toFixed(1)}s`)
      await refresh()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '抓取失败')
    } finally {
      setBusy('')
    }
  }

  if (!configured) {
    return <div className="linduo-credential-panel">
      <small className="credential-note">先在上方保存 LINDUO_API_KEY 即可解锁价格抓取登录态入口</small>
    </div>
  }

  const loggedIn = Boolean(status?.loggedIn)
  const expiresInHours = status?.expiresInSeconds != null ? Math.round(status.expiresInSeconds / 3600) : null
  const lastRefreshedAt = pricing?.refreshedAt
  const priceCount = pricing?.items.length ?? 0
  const allStale = Boolean(pricing?.allStale)

  // 卡片内状态条：圆点 + 主文字 + meta + 单按钮
  const dotClass = loggedIn ? 'is-ready' : hasSaved ? 'is-warning' : 'is-pending'
  const statusText = loggedIn
    ? `已登录${status?.username ? `（${status.username}）` : ''} · 过期 ${expiresInHours ?? '?'}h`
    : hasSaved
      ? '凭据已加密保存 · 当前未登录'
      : '未登录（价格抓取需用户名+密码）'

  return <>
    <div className="linduo-credential-panel">
      <div className="linduo-credential-status">
        <span className={`linduo-credential-dot ${dotClass}`} />
        <div className="linduo-credential-status-text">
          <b>{statusText}</b>
          {lastRefreshedAt && <small>
            {allStale ? '⚠️ 上次抓取失败，展示陈旧价 · ' : '最近抓取：'}
            {new Date(lastRefreshedAt).toLocaleString()} · {priceCount} 个模型
          </small>}
        </div>
      </div>
      <button type="button" className="linduo-credential-edit" onClick={() => setModalOpen(true)}>
        编辑凭据
      </button>
    </div>

    {modalOpen && createPortal(<div className="linduo-credential-modal" role="dialog" aria-modal="true" aria-labelledby="linduo-modal-title">
      <div className="linduo-credential-backdrop" onClick={closeModal} />
      <div className="linduo-credential-card">
        <header>
          <div>
            <small>LINDUO API · 登录凭据</small>
            <h3 id="linduo-modal-title">登录零度API</h3>
          </div>
          <button type="button" className="linduo-credential-close" onClick={closeModal} aria-label="关闭">×</button>
        </header>
        <div className="credential-body">
          <label>登录页地址<input value="https://api.linduo.cn/" readOnly /></label>
          <label>登录账号<input
            value={username}
            onChange={event => setUsername(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="零度API 用户名（手机 / 邮箱）"
            disabled={busy !== ''}
            autoFocus
          /></label>
          <label>登录密码<input
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={hasSaved ? '已加密保存，留空表示不修改' : '零度API 密码'}
            disabled={busy !== ''}
            onKeyDown={event => { if (event.key === 'Enter') void submitLogin() }}
          /></label>
          <label className="credential-check">
            <input
              type="checkbox"
              checked={autoReLogin}
              onChange={event => setAutoReLogin(event.target.checked)}
              disabled={busy !== ''}
            />
            <span>Cookie 失效时凭已保存凭据自动重登</span>
          </label>
          {hasSaved && <small className="linduo-credential-modal-hint">服务端已存凭据，修改密码请输入新值；留空则保持原状。</small>}
          {error && <p className="credential-error">{error}</p>}
          {message && !error && <p>{message}</p>}
        </div>
        <footer>
          <button type="button" className="linduo-credential-logout" disabled={busy !== '' || !loggedIn} onClick={() => void submitLogout()}>
            {busy === 'logout' ? '清除中…' : '清除登录态'}
          </button>
          <div className="linduo-credential-footer-right">
            <button type="button" onClick={closeModal} disabled={busy !== ''}>取消</button>
            <button type="button" onClick={() => void triggerRefresh()} disabled={busy !== ''}>
              {busy === 'refresh' ? '抓取中…' : '立即抓取价格'}
            </button>
            <button type="button" className="primary" onClick={() => void submitLogin()} disabled={busy !== '' || !username.trim()}>
              {busy === 'login' ? '登录中…' : '登录零度API'}
            </button>
          </div>
        </footer>
      </div>
    </div>, document.body)}
  </>
}

export function LlmApiKeysPage({ onBack, onOpenAmazonDataSource }: { onBack: () => void; onOpenAmazonDataSource: () => void }) {
  const [statuses, setStatuses] = useState<LlmKeyStatus[] | null>(null)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [revealValue, setRevealValue] = useState(false)
  const [savingId, setSavingId] = useState('')
  const [saveError, setSaveError] = useState('')
  const [testingId, setTestingId] = useState('')
  const [testResults, setTestResults] = useState<Record<string, LlmTestResult>>({})
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const load = useCallback(() => {
    setError('')
    setStatuses(null)
    window.desktop.llmKeys.list()
      .then(setStatuses)
      .catch(reason => setError(reason instanceof Error ? reason.message : '读取密钥配置失败'))
  }, [])

  useEffect(() => { load() }, [load])

  const startEdit = (id: string) => {
    setEditingId(id)
    setEditValue('')
    setRevealValue(false)
    setSaveError('')
  }

  const cancelEdit = () => {
    if (savingId) return
    setEditingId(null)
    setSaveError('')
  }

  const saveEdit = async () => {
    if (!editingId || savingId) return
    const targetId = editingId
    setSavingId(targetId)
    setSaveError('')
    try {
      const result = await window.desktop.llmKeys.save(targetId, editValue.trim())
      if (!result.ok) throw new Error(result.error || '保存失败')
      setEditingId(null)
      setRestartNeeded(true)
      load()
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setSavingId('')
    }
  }

  const runTest = async (id: string) => {
    if (testingId) return
    setTestingId(id)
    setTestResults(previous => {
      const next = { ...previous }
      delete next[id]
      return next
    })
    try {
      const result = await window.desktop.llmKeys.test(id)
      setTestResults(previous => ({ ...previous, [id]: result }))
    } catch (reason) {
      setTestResults(previous => ({ ...previous, [id]: { ok: false, error: reason instanceof Error ? reason.message : '连接测试失败' } }))
    } finally {
      setTestingId('')
    }
  }

  const restartApp = () => {
    if (restarting) return
    setRestarting(true)
    window.desktop.llmKeys.restart().catch(() => setRestarting(false))
  }

  return <section className="llm-keys-page">
    <div className="page-toolbar">
      <div><b>大模型API Key</b><small>集中管理本项目所用大模型服务的密钥：查看状态 / 编辑保存 / 连接测试</small></div>
      <button type="button" onClick={onBack}>返回 AI总部</button>
    </div>
    {restartNeeded && <div className="llm-keys-banner" role="status">
      <span>已保存。新 Key 需重启应用后生效</span>
      <button type="button" onClick={restartApp} disabled={restarting}>{restarting ? '正在重启…' : '一键重启'}</button>
    </div>}
    {statuses === null
      ? <div className="llm-keys-status">{error ? <>读取失败：{error}<button type="button" onClick={load}>重试</button></> : '正在读取密钥配置…'}</div>
      : <div className="ai-crossborder-entries llm-keys-entries">{LLM_PROVIDERS.map(provider => {
          const status = statuses.find(item => item.id === provider.id)
          const configured = Boolean(status?.configured)
          const editing = editingId === provider.id
          const testResult = testResults[provider.id]
          return <div className="ai-crossborder-card" key={provider.id}>
            <span className="ai-crossborder-logo" style={{ color: provider.color, background: `${provider.color}14`, borderColor: `${provider.color}30` }}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{provider.icon}</svg>
            </span>
            <b>{provider.name}</b>
            <small>{provider.usage}</small>
            {configured
              ? <em className="ready">已配置</em>
              : <em className="llm-pending">未配置</em>}
            {configured && status?.maskedKey && <code className="llm-keys-mask">{status.maskedKey}</code>}
            {editing
              ? <div className="llm-keys-edit">
                  <div className="llm-keys-edit-row">
                    <input
                      type={revealValue ? 'text' : 'password'}
                      value={editValue}
                      placeholder={status?.maskedKey || '输入 API Key'}
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                      disabled={Boolean(savingId)}
                      onChange={event => setEditValue(event.target.value)}
                      onKeyDown={event => { if (event.key === 'Enter') void saveEdit(); if (event.key === 'Escape') cancelEdit() }}
                    />
                    <button type="button" className="llm-keys-eye" onClick={() => setRevealValue(value => !value)} aria-label={revealValue ? '隐藏密钥' : '显示密钥'} title={revealValue ? '隐藏' : '显示'}>
                      {revealValue
                        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="m1 1 22 22"/></svg>
                        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>}
                    </button>
                  </div>
                  <div className="llm-keys-edit-actions">
                    <button type="button" onClick={() => void saveEdit()} disabled={Boolean(savingId)}>{savingId === provider.id ? '保存中…' : '保存'}</button>
                    <button type="button" onClick={cancelEdit} disabled={Boolean(savingId)}>取消</button>
                  </div>
                  {saveError && <span className="llm-keys-test llm-keys-test-fail">{saveError}</span>}
                  <span className="llm-keys-edit-hint">留空保存 = 清除该 Key</span>
                </div>
              : <div className="llm-keys-actions">
                  <button type="button" onClick={() => startEdit(provider.id)} disabled={Boolean(testingId)}>编辑</button>
                  <button type="button" onClick={() => void runTest(provider.id)} disabled={Boolean(testingId)}>{testingId === provider.id ? '测试中…' : '测试'}</button>
                </div>}
            {testingId === provider.id && <span className="llm-keys-test llm-keys-test-running">正在验证连接…</span>}
            {!editing && testResult && testingId !== provider.id && (testResult.ok
              ? <span className="llm-keys-test llm-keys-test-ok">✓ 连接成功 · {testResult.latencyMs ?? 0}ms</span>
              : <span className="llm-keys-test llm-keys-test-fail">连接失败：{testResult.error || '未知错误'}</span>)}
            {provider.id === 'linduo' && <LinduoLoginPanel configured={configured} />}
          </div>
        })}
        <div className="ai-crossborder-card clickable" onClick={onOpenAmazonDataSource}>
          <span className="ai-crossborder-logo" style={{ color: '#0f766e', background: '#0f766e14', borderColor: '#0f766e30' }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16v14H4z"/><path d="M8 9h8M8 13h5"/><path d="M17 17l3 3"/><circle cx="15" cy="15" r="3"/></svg>
          </span>
          <b>Amazon 数据源配置</b>
          <small>Amazon 市场数据抓取与接口配置</small>
          <em className="ready">进入</em>
        </div>
      </div>}
    <p className="llm-keys-note">密钥仅存于本机 .env.local，本页不展示完整 Key；保存后需重启应用生效。服务端密钥依架构不在此展示。</p>
  </section>
}

export default LlmApiKeysPage
