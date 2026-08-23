/**
 * 会话门禁：多人化改造阶段 4 的应用入口。
 * - 未登录 → 登录/注册组织页；已登录 → 恢复会话并渲染业务 App
 * - mustChangePassword → 强制改密页（改密后服务端吊销全部令牌，回登录页）
 * - 监听 SESSION_EXPIRED_EVENT（apiFetch 刷新失败广播）自动退回登录页
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { App } from './App'
import { Button, Field, LoadingState, Notice } from './ui/primitives'
import type { UserProfile } from './serverApi'
import {
  ApiError,
  SESSION_EXPIRED_EVENT,
  changePassword,
  fetchProfile,
  getCachedProfile,
  getServerBaseUrl,
  getStoredServerUrl,
  getTokens,
  login,
  logout,
  registerOrg,
  setServerBaseUrl
} from './serverApi'
import './login.css'
import WindowTitleControls from './WindowTitleControls'

export interface SessionValue {
  profile: UserProfile
  /** 重新拉取本人信息（权限/店铺授权变更后调用） */
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const SessionContext = createContext<SessionValue | null>(null)

export function useSession(): SessionValue {
  const value = useContext(SessionContext)
  if (!value) throw new Error('useSession 必须在 SessionGate 内使用')
  return value
}

function errorMessageOf(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof TypeError) return '无法连接服务器，请检查服务端是否已启动'
  return fallback
}

// ---------------------------------------------------------------- 登录 / 注册组织

// 本地记忆上次成功登录的手机号（仅记账号不记密码，方便快捷登录）
const LAST_LOGIN_PHONE_KEY = 'yd.lastLoginPhone'

function getLastLoginPhone(): string {
  try { return localStorage.getItem(LAST_LOGIN_PHONE_KEY) ?? '' } catch { return '' }
}

function saveLastLoginPhone(phone: string) {
  try { localStorage.setItem(LAST_LOGIN_PHONE_KEY, phone) } catch { /* 存储不可用时静默忽略 */ }
}

// 服务器地址下拉选项：中央服务器（默认）与本地服务，免记忆 IP 手动填写
const SERVER_PRESETS = [
  { value: 'http://114.55.149.192', label: '中央服务器（114.55.149.192）' },
  { value: 'http://127.0.0.1:8787', label: '本地服务（127.0.0.1:8787）' }
]

function LoginPage(props: { onLoggedIn: (profile: UserProfile) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState(getLastLoginPhone())
  const [password, setPassword] = useState('')
  const [showServer, setShowServer] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [serverUrl, setServerUrl] = useState(getServerBaseUrl())
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  // 版本信息：登录页底部展示当前版本与更新状态（checking → ok / outdated / error）
  const [versionInfo, setVersionInfo] = useState<{ status: 'checking' } | { status: 'ok'; current: string } | { status: 'outdated'; current: string; latest: string } | { status: 'error'; current: string }>({ status: 'checking' })
  // 自动更新实时状态（主进程 app:update-status 推送）：版本过旧门禁展示下载进度/安装入口
  const [updateStatus, setUpdateStatus] = useState<{ phase: 'downloading' | 'downloaded' | 'error'; version: string; percent?: number; message?: string } | null>(null)

  useEffect(() => window.desktop.appInfo.onUpdateStatus(setUpdateStatus), [])

  useEffect(() => {
    let cancelled = false
    void window.desktop.appInfo.checkUpdate()
      .then(result => {
        if (cancelled) return
        if (result.error) {
          setVersionInfo({ status: 'error', current: result.current })
        } else {
          setVersionInfo(result.isLatest ? { status: 'ok', current: result.current } : { status: 'outdated', current: result.current, latest: result.latest })
        }
      })
      .catch(() => { if (!cancelled) setVersionInfo({ status: 'error', current: '' }) })
    return () => { cancelled = true }
  }, [])

  const passwordRef = useRef<HTMLInputElement>(null)

  // 浏览器自动填充密码不会触发 React 的 onChange，监听原生 input 事件将 DOM 真实值同步进 state
  useEffect(() => {
    const el = passwordRef.current
    if (!el) return
    const sync = () => setPassword(el.value)
    el.addEventListener('input', sync)
    return () => el.removeEventListener('input', sync)
  }, [])

  // 强制升级门禁：版本落后时拦截登录，引导等待自动更新完成或手动下载安装；
  // 版本检查失败（网络异常）不拦截，避免断网时无法登录
  if (versionInfo.status === 'outdated') {
    const downloaded = updateStatus?.phase === 'downloaded'
    const percent = updateStatus?.phase === 'downloading' ? (updateStatus.percent ?? 0) : null
    return <div className="auth-screen">
      <div className="auth-drag-strip" /><WindowTitleControls className="auth-win-controls" />
      <div className="auth-card" role="alert">
        <div className="auth-brand"><span className="brand-mark">砚</span><div><strong>砚都跨境</strong><small>需要升级到新版本后继续使用</small></div></div>
        <p className="auth-update-title">当前版本 v{versionInfo.current} 已过旧</p>
        <p className="auth-update-desc">最新版本为 v{versionInfo.latest}，新版本正在后台自动下载（支持断点续传）。下载完成后点击下方按钮重启安装；直接退出应用时也会自动安装。</p>
        {percent !== null && <div className="auth-update-progress" aria-live="polite">
          <div className="auth-update-progress-bar" style={{ width: `${percent}%` }} />
          <span>正在下载新版本… {percent}%</span>
        </div>}
        {updateStatus?.phase === 'error' && <p className="auth-update-error">自动下载失败：{updateStatus.message || '未知错误'}，请手动下载安装。</p>}
        <Button className="auth-submit" variant="primary" type="button" disabled={!downloaded} onClick={() => void window.desktop.appInfo.installUpdate()}>
          {downloaded ? '立即重启安装' : percent !== null ? '新版本下载中…' : '等待新版本下载…'}
        </Button>
        <button type="button" className="auth-update-manual" onClick={() => void window.desktop.appInfo.openDownload()}>手动下载安装（浏览器打开下载页）</button>
      </div>
    </div>
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    setError('')
    setNotice('')
    setServerBaseUrl(serverUrl)
    // 同步到主进程配置（决定下次启动是否拉起本地服务栈）
    void window.desktop.serverConfig.set(serverUrl).catch(() => undefined)
    setSubmitting(true)
    // 密码以 DOM 实际值为准（兼容浏览器自动填充导致的状态滞后）
    const actualPassword = passwordRef.current?.value ?? password
    try {
      if (mode === 'login') {
        const profile = await login(email.trim(), actualPassword)
        saveLastLoginPhone(email.trim())
        props.onLoggedIn(profile)
      } else {
        const result = await registerOrg({ name: name.trim(), email: email.trim(), password: actualPassword })
        if (result.pending) {
          // 注册申请已提交，等待管理员审核
          setNotice(result.message || '注册申请已提交，请等待管理员审核')
          setPassword('')
        } else if (result.profile) {
          saveLastLoginPhone(email.trim())
          props.onLoggedIn(result.profile)
        }
      }
    } catch (err) {
      setError(errorMessageOf(err, mode === 'login' ? '登录失败，请稍后重试' : '注册失败，请稍后重试'))
    } finally {
      setSubmitting(false)
    }
  }

  return <div className="auth-screen">
    <div className="auth-drag-strip" /><WindowTitleControls className="auth-win-controls" />
    <form className="auth-card" onSubmit={event => void submit(event)}>
      <div className="auth-brand"><button type="button" className="brand-mark brand-mark--link" title="获取 APP 安装包（浏览器打开，地址可复制分享）" aria-label="获取 APP 安装包" onClick={() => void window.desktop.appInfo.openDownload()}>砚</button><div><strong>砚都跨境</strong><small>跨境电商选品与素材工作台 · 团队版</small></div></div>
      <div className="auth-tabs" role="tablist" aria-label="账号入口">
        <button type="button" role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setEmail(getLastLoginPhone()); setError(''); setNotice('') }}>登录</button>
        <button type="button" role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setEmail(''); setError(''); setNotice('') }}>注册</button>
      </div>
      {mode === 'register' && <>
        <Field label="你的姓名" value={name} onChange={event => setName(event.target.value)} placeholder="姓名" maxLength={30} required />
      </>}
      <Field label="手机号" type="tel" value={email} onChange={event => setEmail(event.target.value)} placeholder="13426964913" maxLength={11} required autoFocus autoComplete="username" />
      <Field className="auth-password-field" label="密码" ref={passwordRef} type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'register' ? '至少 8 位，含字母与数字' : '登录密码'} hint={mode === 'register' ? '至少 8 位，同时包含字母与数字' : undefined} required autoComplete={mode === 'register' ? 'new-password' : 'current-password'} trailing={
        <button type="button" className="auth-password-toggle" aria-label={showPassword ? '隐藏密码' : '显示密码'} title={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword(value => !value)}>
          {showPassword
            ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.53 13.53 0 0 0 2 12s3.5 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></svg>
            : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>}
        </button>
      } />
      {error && <Notice className="auth-error" tone="danger" role="alert">{error}</Notice>}
      {notice && <Notice className="auth-notice" tone="success" role="status" aria-live="polite">{notice}</Notice>}
      <Button className="auth-submit" variant="primary" type="submit" loading={submitting}>
        {mode === 'login' ? '登 录' : '提交注册申请'}
      </Button>
      {mode === 'register' && <p className="auth-hint">注册提交后需管理员审核通过方可登录。</p>}
      <button type="button" className="auth-server-toggle" onClick={() => setShowServer(value => !value)}>
        服务器：{serverUrl} {showServer ? '▴' : '▾'}
      </button>
      {showServer && <label className="auth-server-select">
        <span>服务器地址</span>
        <select value={serverUrl} onChange={event => setServerUrl(event.target.value)}>
          {!SERVER_PRESETS.some(preset => preset.value === serverUrl) && <option value={serverUrl}>自定义（{serverUrl}）</option>}
          {SERVER_PRESETS.map(preset => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
        </select>
      </label>}
      {versionInfo.status === 'checking' && <p className="auth-version">正在检查版本…</p>}
      {versionInfo.status === 'ok' && <p className="auth-version auth-version--latest">当前版本 v{versionInfo.current} · 已是最新版本 ✓</p>}
      {versionInfo.status === 'error' && versionInfo.current && <p className="auth-version">当前版本 v{versionInfo.current} · 版本检查失败</p>}
      <button type="button" className="auth-get-app" title="浏览器打开下载页，复制地址即可分享给同事" onClick={() => void window.desktop.appInfo.openDownload()}>获取 APP ↗</button>
    </form>
  </div>
}

// ---------------------------------------------------------------- 强制改密（子帐号首次登录）

function ForceChangePassword(props: { profile: UserProfile; onDone: () => void }) {
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting) return
    if (newPassword !== confirm) {
      setError('两次输入的新密码不一致')
      return
    }
    setError('')
    setSubmitting(true)
    try {
      await changePassword(oldPassword, newPassword)
      props.onDone()
    } catch (err) {
      setError(errorMessageOf(err, '修改失败，请稍后重试'))
      setSubmitting(false)
    }
  }

  return <div className="auth-screen">
    <div className="auth-drag-strip" /><WindowTitleControls className="auth-win-controls" />
    <form className="auth-card" onSubmit={event => void submit(event)}>
      <div className="auth-brand"><span className="brand-mark">砚</span><div><strong>首次登录请修改密码</strong><small>{props.profile.email}</small></div></div>
      <Field label="原密码" type="password" value={oldPassword} onChange={event => setOldPassword(event.target.value)} required autoFocus autoComplete="current-password" />
      <Field label="新密码" type="password" value={newPassword} onChange={event => setNewPassword(event.target.value)} placeholder="至少 8 位，含字母与数字" hint="修改后其他登录状态将失效" required autoComplete="new-password" />
      <Field label="确认新密码" type="password" value={confirm} onChange={event => setConfirm(event.target.value)} error={error === '两次输入的新密码不一致' ? error : undefined} required autoComplete="new-password" />
      {error && error !== '两次输入的新密码不一致' && <Notice className="auth-error" tone="danger" role="alert">{error}</Notice>}
      <Button className="auth-submit" variant="primary" type="submit" loading={submitting}>修改密码并重新登录</Button>
    </form>
  </div>
}

// ---------------------------------------------------------------- 门禁主体

type GateState =
  | { kind: 'booting' }
  | { kind: 'guest' }
  | { kind: 'authed'; profile: UserProfile }

export function SessionGate() {
  const [state, setState] = useState<GateState>(() => (getTokens() && getCachedProfile() ? { kind: 'booting' } : { kind: 'guest' }))

  // 启动时同步服务器地址：渲染层有显式保存值 → 写回主进程；否则用主进程持久化值回填
  useEffect(() => {
    void window.desktop.serverConfig.get()
      .then(persisted => {
        const stored = getStoredServerUrl()
        if (stored) {
          if (stored.replace(/\/+$/, '') !== persisted) void window.desktop.serverConfig.set(stored).catch(() => undefined)
        } else if (persisted) {
          setServerBaseUrl(persisted)
        }
      })
      .catch(() => undefined)
  }, [])

  // 启动时校验并刷新会话（子帐号权限/店铺授权可能已被主帐号调整）
  useEffect(() => {
    if (state.kind !== 'booting') return
    let cancelled = false
    void fetchProfile()
      .then(profile => { if (!cancelled) setState({ kind: 'authed', profile }) })
      .catch(() => { if (!cancelled) setState({ kind: 'guest' }) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 服务端判定会话失效（刷新令牌被吊销/改密）→ 回登录页
  useEffect(() => {
    const onExpired = () => setState({ kind: 'guest' })
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  const sessionValue = useMemo<SessionValue | null>(() => {
    if (state.kind !== 'authed') return null
    return {
      profile: state.profile,
      refreshProfile: async () => {
        const profile = await fetchProfile()
        setState(current => (current.kind === 'authed' ? { kind: 'authed', profile } : current))
      },
      signOut: async () => {
        await logout()
        setState({ kind: 'guest' })
      }
    }
  }, [state])

  if (state.kind === 'booting') {
    return <div className="auth-screen"><div className="auth-drag-strip" /><WindowTitleControls className="auth-win-controls" /><LoadingState className="auth-boot" label="正在恢复会话…" /></div>
  }
  if (state.kind === 'guest') {
    return <LoginPage onLoggedIn={profile => setState({ kind: 'authed', profile })} />
  }
  if (state.profile.mustChangePassword) {
    return <ForceChangePassword profile={state.profile} onDone={() => setState({ kind: 'guest' })} />
  }
  return <SessionContext.Provider value={sessionValue as SessionValue}>
    <App />
  </SessionContext.Provider>
}
