/**
 * 系统管理页：成员管理 + 组织信息。
 * 仅主帐号/拥有 member.manage 权限者可见（服务端亦有权限校验兜底）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import type { MemberView, RoleView } from './serverApi'
import { ApiError, approveMember, changePassword, createMember, deleteMember, fetchLinduoTiers, fetchMembers, fetchPendingMembers, fetchRoles, rejectMember, resetMemberPassword, setLinduoMemberTier, updateMember, updateMemberPermissions } from './serverApi'
import type { LinduoChatModelView, LinduoModelTierView } from '../shared/contracts'
import { LinduoExceptionModal } from './LinduoExceptionModal'
import { fetchAllLinduoChatModels, fetchLinduoMemberTier } from './serverApi'
import { useSession } from './SessionGate'
import { Button, EmptyState, LoadingState, Notice, StatusBadge } from './ui/primitives'
import { MENU_PERM_GROUPS, MENU_PERMISSION_TREE, checkedLevel1Codes, expandMenuSelection, menuCheckState } from '../shared/menuPermissionTree'
import type { MenuPermNode } from '../shared/menuPermissionTree'
import { mergePermissionsForSubmit } from './memberPermissionMerge'

type AdminTab = 'members' | 'review' | 'crawler' | 'org'

interface PermSummaryPart { label: string; cards: string[] }

/** 结构化权限摘要：供 chips 渲染（收起态取前 3 个一级，展开态全量） */
function permSummaryParts(selected: string[]): PermSummaryPart[] {
  const set = new Set(selected)
  const parts: PermSummaryPart[] = []
  for (const node of MENU_PERMISSION_TREE) {
    const state = menuCheckState(selected, node)
    if (state === 'none') continue
    if (state === 'all') { parts.push({ label: node.label, cards: [] }); continue }
    parts.push({ label: node.label, cards: node.cards.filter(c => set.has(c.code)).map(c => c.label) })
  }
  return parts
}

/**
 * 使用权限勾选：只暴露一级栏目勾选框（按侧边栏 / 栏目内入口两组分列）。
 * 二级不再单独勾选——勾选一级即连带授予该栏目全部二级入口，提交时由 expandMenuSelection 补齐码。
 */
function MenuPermTree(props: { selected: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const { selected, onChange, disabled } = props
  const renderNode = (node: MenuPermNode) => <label className="role-check menu-perm-level1" key={node.code}>
    <input type="checkbox" disabled={disabled} checked={selected.includes(node.code)}
      onChange={e => onChange(e.target.checked ? [...new Set([...selected, node.code])] : selected.filter(code => code !== node.code))} />
    <b>{node.label}</b>
  </label>
  return <div className="menu-perm-tree">
    {MENU_PERM_GROUPS.map(section => {
      const nodes = MENU_PERMISSION_TREE.filter(node => node.group === section.key)
      if (nodes.length === 0) return null
      return <div className="menu-perm-section" key={section.key}>
        <div className="menu-perm-section-head">
          <b>{section.label}</b>
          <span className="menu-perm-section-count">{nodes.length} 栏</span>
        </div>
        <div className="menu-perm-level1-list">{nodes.map(renderNode)}</div>
      </div>
    })}
  </div>
}

/** 「使用权限」列展示：收起态前 3 个一级 chip +「+N」；点击展开全量 chips */
function PermSummaryChips({ selected }: { selected: string[] }) {
  const [expanded, setExpanded] = useState(false)
  const parts = useMemo(() => permSummaryParts(selected), [selected])
  if (parts.length === 0) return <>—</>
  const visible = expanded ? parts : parts.slice(0, 3)
  const hiddenCount = parts.length - visible.length
  return <div className={`perm-summary${expanded ? ' expanded' : ''}`}>
    <span className="perm-summary-chips">
      {visible.map((part, i) => <span className="perm-summary-chip" key={i}>
        {part.label}
        {part.cards.length > 0 && <em>{part.cards.join('/')}</em>}
      </span>)}
      {hiddenCount > 0 && <button type="button" className="perm-summary-more" onClick={() => setExpanded(true)}>+{hiddenCount}</button>}
    </span>
    {expanded && parts.length > 3 && <button type="button" className="perm-summary-collapse" onClick={() => setExpanded(false)}>收起</button>}
  </div>
}

function errorText(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof TypeError) return '无法连接服务器'
  return fallback
}

// ---------------------------------------------------------------- 注册审核行

function PendingRow(props: {
  member: MemberView
  onChanged: () => void
}) {
  const { member, onChanged } = props
  const [perms, setPerms] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const doApprove = async () => {
    if (perms.length === 0) { setMessage('请勾选使用权限'); return }
    setBusy(true); setMessage('')
    try {
      await approveMember(member.id, expandMenuSelection(perms))
      onChanged()
    } catch (err) { setMessage(errorText(err, '操作失败')); setBusy(false) }
  }

  const doReject = async () => {
    if (!window.confirm(`确定拒绝「${member.name}」的注册申请？`)) return
    setBusy(true); setMessage('')
    try {
      await rejectMember(member.id)
      onChanged()
    } catch (err) { setMessage(errorText(err, '操作失败')); setBusy(false) }
  }

  return <tr className="sysadmin-member-row">
    <td><b>{member.name}</b></td>
    <td className="mono">{member.email}</td>
    <td className="muted">{new Date(member.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
    <td>
      <fieldset className="review-perms"><legend>使用权限</legend>
        <MenuPermTree selected={perms} onChange={setPerms} disabled={busy} />
      </fieldset>
    </td>
    <td className="sysadmin-actions">
      <Button variant="primary" disabled={busy} onClick={() => void doApprove()}>通过</Button>
      <Button variant="danger" disabled={busy} onClick={() => void doReject()}>拒绝</Button>
      {message && <Notice className="sysadmin-msg" tone="danger" role="alert">{message}</Notice>}
    </td>
  </tr>
}

// ---------------------------------------------------------------- 成员行

function MemberRow(props: {
  member: MemberView
  roles: RoleView[]
  onChanged: () => void
  /** 全部 tier 列表(主帐号在 useEffect 里拉,传进来给各成员行共享) */
  linduoTiers: LinduoModelTierView[]
  /** 该成员当前 tier;null=未分配 */
  currentMemberTier: LinduoModelTierView | null
  /** 设置该成员 tier(null=清除) */
  onChangeMemberTier: (tierId: string | null) => Promise<void>
  /** 点「Linduo 例外」按钮 → 弹 LinduoExceptionModal */
  onOpenLinduoException: () => void
}) {
  const { member, roles, onChanged, linduoTiers, currentMemberTier, onChangeMemberTier, onOpenLinduoException } = props
  const [editing, setEditing] = useState(false)
  const [changingPwd, setChangingPwd] = useState(false)
  const [name, setName] = useState(member.name)
  const [editPerms, setEditPerms] = useState<string[]>([])
  const [newPassword, setNewPassword] = useState('')
  const [oldPassword, setOldPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  // 成员当前全量权限 = 其所有已绑定角色权限点的并集（RoleView.permissions 来自 GET /api/roles，
  // 页面加载时已取回；服务端无单成员详情端点，故用角色并集等价还原）
  const allPerms = member.roles.flatMap(r => {
    const role = roles.find(rv => rv.id === r.id)
    return role ? role.permissions : []
  }).filter((v, i, a) => a.indexOf(v) === i)

  // UI 仅展示 menu.* 权限点（勾选树的可选集合）
  const modulePerms = allPerms.filter(p => p.startsWith('menu.'))

  const startEdit = () => {
    setEditing(true)
    setName(member.name)
    setEditPerms(checkedLevel1Codes(modulePerms))
    setNewPassword('')
    setMessage('')
  }

  const saveEdit = async () => {
    if (editPerms.length === 0) { setMessage('请至少勾选一个使用权限'); return }
    setBusy(true); setMessage('')
    try {
      // 一级勾选展开为「一级 + 其全部二级」后再与成员现有 menu 码比对：
      // 只持部分二级的老成员回显为已勾选，保存即补齐该栏目全部二级（有意粗粒度化）
      const submitted = expandMenuSelection(editPerms)
      const permsChanged = [...submitted].sort().join() !== [...modulePerms].sort().join()
      if (name.trim() && name.trim() !== member.name) {
        await updateMember(member.id, { name: name.trim() })
      }
      if (permsChanged) {
        // PUT /permissions 是全量替换契约：必须把 UI 未展示的非 menu 权限（erp.* 等）
        // 与编辑后的 menu 权限一并提交，否则保存菜单权限会静默清掉它们（plan #1）
        await updateMemberPermissions(member.id, mergePermissionsForSubmit(allPerms, submitted))
      }
      setEditing(false)
      setMessage('已保存')
      onChanged()
    } catch (err) { setMessage(errorText(err, '保存失败')) } finally { setBusy(false) }
  }

  const toggleStatus = async () => {
    const next = member.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'
    if (next === 'DISABLED' && !window.confirm(`确定禁用「${member.name}」？禁用后该帐号立即无法登录。`)) return
    setBusy(true); setMessage('')
    try {
      await updateMember(member.id, { status: next })
      setMessage(next === 'DISABLED' ? '已禁用' : '已启用')
      onChanged()
    } catch (err) { setMessage(errorText(err, '操作失败')) } finally { setBusy(false) }
  }

  const doResetPassword = async () => {
    if (!newPassword) { setMessage('请输入新密码'); return }
    setBusy(true); setMessage('')
    try {
      await resetMemberPassword(member.id, newPassword)
      setNewPassword('')
      setMessage('密码已重置，该成员下次登录需修改密码')
    } catch (err) { setMessage(errorText(err, '重置失败')) } finally { setBusy(false) }
  }

  const doDelete = async () => {
    if (!window.confirm(`确定删除成员「${member.name}」？删除后立即无法登录，此操作不可恢复（审计日志保留，手机号可重新注册）。`)) return
    setBusy(true); setMessage('')
    try {
      await deleteMember(member.id)
      onChanged()
    } catch (err) { setMessage(errorText(err, '删除失败')); setBusy(false) }
  }

  // 主帐号修改自己的密码（走 change-password，改密后所有登录态失效）
  const doChangeOwnPassword = async () => {
    if (!oldPassword || !newPassword) { setMessage('请输入原密码与新密码'); return }
    setBusy(true); setMessage('')
    try {
      await changePassword(oldPassword, newPassword)
      setChangingPwd(false)
      setOldPassword(''); setNewPassword('')
      setMessage('密码已修改，下次操作需重新登录')
    } catch (err) { setMessage(errorText(err, '修改失败')) } finally { setBusy(false) }
  }

  // Linduo tier 变更:受控 select,await 父级 onChangeMemberTier
  const [tierSaving, setTierSaving] = useState(false)
  const handleTierChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value
    const nextTierId = value === '' ? null : value
    if (tierSaving) return
    setTierSaving(true); setMessage('')
    try {
      await onChangeMemberTier(nextTierId)
    } catch (err) {
      setMessage(errorText(err, '更新 Linduo 等级失败'))
    } finally {
      setTierSaving(false)
    }
  }

  return <>
    <tr className={`sysadmin-member-row${member.status === 'DISABLED' ? ' disabled' : ''}`}>
      <td>
        <b>{member.name}</b>
        {member.isOwner && <StatusBadge className="owner-badge" tone="info">主帐号</StatusBadge>}
        {member.mustChangePassword && <StatusBadge className="pwd-badge" tone="warning">待改密</StatusBadge>}
      </td>
    <td className="mono">{member.email}</td>
    <td>{member.roles.map(r => r.name).join('、') || '—'}</td>
    <td><PermSummaryChips selected={modulePerms} /></td>
    <td><StatusBadge tone={member.status === 'ACTIVE' ? 'success' : 'warning'}>{member.status === 'ACTIVE' ? '✓ 正常' : '! 已禁用'}</StatusBadge></td>
    <td className="muted">{member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '从未登录'}</td>
    <td className="sysadmin-actions">
      <div className="member-actions-cell">
        {member.isOwner ? (
          changingPwd ? <div className="member-actions-row">
            <button disabled={busy} onClick={() => void doChangeOwnPassword()}>确认修改</button>
            <button disabled={busy} onClick={() => { setChangingPwd(false); setMessage('') }}>取消</button>
          </div> : <>
            <div className="member-actions-row">
              <button onClick={() => { setChangingPwd(true); setOldPassword(''); setNewPassword(''); setMessage('') }}>修改密码</button>
            </div>
            <div className="member-actions-row">
              <label className="linduo-tier-select" title="主帐号默认全开组，不可修改">
                <span className="linduo-tier-label">Linduo 等级</span>
                <select value={currentMemberTier?.id ?? ''} disabled>
                  {linduoTiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <span className="member-action-note">全开组(主帐号)</span>
            </div>
          </>
        ) : editing ? <div className="member-actions-row">
          <button disabled={busy} onClick={() => void saveEdit()}>保存</button>
          <button disabled={busy} onClick={() => setEditing(false)}>取消</button>
        </div> : <>
          <div className="member-actions-row">
            <label className="linduo-tier-select" title="选「无」后该成员只能依赖例外 (GRANT/REVOKE)">
              <span className="linduo-tier-label">Linduo 等级</span>
              <select
                value={currentMemberTier?.id ?? ''}
                onChange={e => void handleTierChange(e)}
                disabled={tierSaving || busy}
              >
                <option value="">无(仅依赖例外)</option>
                {linduoTiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <button disabled={busy || tierSaving} onClick={onOpenLinduoException}>Linduo 例外</button>
          </div>
          <div className="member-actions-row">
            <button className="primary" onClick={startEdit}>编辑</button>
            {member.status === 'ACTIVE'
              ? <button className="danger" disabled={busy} onClick={() => void toggleStatus()}>禁用</button>
              : <button disabled={busy} onClick={() => void toggleStatus()}>启用</button>}
            <button className="danger" disabled={busy} onClick={() => void doDelete()}>删除</button>
          </div>
        </>}
      </div>
    </td>
    </tr>
    {editing && !member.isOwner && <tr className="sysadmin-edit-row"><td colSpan={7} className="sysadmin-edit-panel">
      <div className="edit-panel-wrap">
        <div className="edit-panel-grid">
          <label>姓名<input value={name} onChange={e => setName(e.target.value)} maxLength={30} /></label>
          <label>重置密码<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少8位含字母数字" /><button disabled={busy} onClick={() => void doResetPassword()}>重置</button></label>
        </div>
        <fieldset className="edit-panel-perms"><legend>使用权限</legend>
          <div className="edit-panel-perms-scroll">
            <MenuPermTree selected={editPerms} onChange={setEditPerms} />
          </div>
        </fieldset>
        <div className="edit-panel-footer">
          <button className="primary" disabled={busy} onClick={() => void saveEdit()}>保存修改</button>
          <button disabled={busy} onClick={() => setEditing(false)}>取消</button>
          {message && <p className="sysadmin-msg">{message}</p>}
        </div>
      </div>
    </td></tr>}
    {changingPwd && member.isOwner && <tr className="sysadmin-edit-row"><td colSpan={7} className="sysadmin-edit-panel">
      <div className="edit-panel-grid">
        <label>原密码<input type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} /></label>
        <label>新密码<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少8位含字母数字" /></label>
      </div>
      {message && <p className="sysadmin-msg">{message}</p>}
    </td></tr>}
    {!editing && !changingPwd && message && <tr><td colSpan={7} className="sysadmin-msg-cell"><p className="sysadmin-msg">{message}</p></td></tr>}
  </>
}

// ---------------------------------------------------------------- 文章抓取配置

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

const CRAWLER_STATE_LABEL: Record<CrawlerServiceState, string> = {
  STOPPED: '未启动',
  STARTING: '启动中',
  RUNNING: '运行中',
  START_FAILED: '启动失败'
}

const CRAWLER_STATE_TONE: Record<CrawlerServiceState, 'muted' | 'warning' | 'success' | 'danger'> = {
  STOPPED: 'muted',
  STARTING: 'warning',
  RUNNING: 'success',
  START_FAILED: 'danger'
}

function CrawlerConfigTab() {
  const [status, setStatus] = useState<CrawlerStatus | null>(null)
  const [installPath, setInstallPath] = useState('')
  const [webUiUrl, setWebUiUrl] = useState('')
  const [autoStart, setAutoStart] = useState(false)
  const [busy, setBusy] = useState<'start' | 'stop' | 'save' | 'pick' | null>(null)
  const [message, setMessage] = useState<{ tone: 'info' | 'success' | 'danger'; text: string } | null>(null)

  const refresh = useCallback(async () => {
    try {
      const s = await window.desktop.articleCrawler.status()
      setStatus(s)
      setInstallPath(s.config.installPath)
      setWebUiUrl(s.config.webUiUrl)
      setAutoStart(s.config.autoStart)
    } catch (err) {
      setMessage({ tone: 'danger', text: err instanceof Error ? err.message : String(err) })
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const handleSave = async () => {
    setBusy('save'); setMessage(null)
    try {
      await window.desktop.articleCrawler.saveConfig({ installPath: installPath.trim(), webUiUrl: webUiUrl.trim(), autoStart })
      setMessage({ tone: 'success', text: '已保存配置' })
      await refresh()
    } catch (err) {
      setMessage({ tone: 'danger', text: `保存失败：${err instanceof Error ? err.message : String(err)}` })
    } finally { setBusy(null) }
  }

  const handlePickPath = async () => {
    setBusy('pick'); setMessage(null)
    try {
      const picked = await window.desktop.articleCrawler.pickInstallPath()
      if (picked) {
        setInstallPath(picked)
        await refresh()
        setMessage({ tone: 'success', text: `已选择安装目录：${picked}` })
      }
    } catch (err) {
      setMessage({ tone: 'danger', text: `选择失败：${err instanceof Error ? err.message : String(err)}` })
    } finally { setBusy(null) }
  }

  const handleStart = async () => {
    setBusy('start'); setMessage(null)
    try {
      const s = await window.desktop.articleCrawler.start()
      setStatus(s)
      setMessage({ tone: s.webUiReachable ? 'success' : 'info', text: s.message })
    } catch (err) {
      setMessage({ tone: 'danger', text: `启动失败：${err instanceof Error ? err.message : String(err)}` })
    } finally { setBusy(null) }
  }

  const handleStop = async () => {
    setBusy('stop'); setMessage(null)
    try {
      const s = await window.desktop.articleCrawler.stop()
      setStatus(s)
      setMessage({ tone: 'info', text: s.message })
    } catch (err) {
      setMessage({ tone: 'danger', text: `停止失败：${err instanceof Error ? err.message : String(err)}` })
    } finally { setBusy(null) }
  }

  const stateTone = status ? CRAWLER_STATE_TONE[status.state] : 'muted'
  const stateLabel = status ? CRAWLER_STATE_LABEL[status.state] : '检测中'
  const isRunning = status?.state === 'RUNNING'
  const canStart = !!status?.dockerAvailable && !!status?.dockerComposeAvailable && !!status?.installPathValid

  return <div className="crawler-config-tab">
    <div className="crawler-status-strip">
      <span className={`crawler-state-tag crawler-state-${stateTone}`}>
        <i className={isRunning ? 'pulse' : ''} />
        {stateLabel}
      </span>
      <span className="crawler-state-msg">{status?.message || '正在检测服务状态…'}</span>
      <button type="button" className="muted" onClick={() => void refresh()}>↻ 重新检测</button>
    </div>

    {message && <Notice tone={message.tone} role="status">{message.text}</Notice>}

    {!status?.dockerAvailable && <Notice tone="warning" role="alert">未检测到 docker 命令，请先安装 Docker Desktop</Notice>}
    {status?.dockerAvailable && !status?.dockerComposeAvailable && <Notice tone="warning" role="alert">未检测到 docker compose 子命令，请升级 Docker Desktop 4.x+</Notice>}

    <section className="crawler-config-card">
      <div className="config-card-title"><span>01</span><div><b>NewsCrawler 安装路径</b><small>包含 docker-compose.yml 的目录</small></div></div>
      <div className="config-card-body">
        <label>安装路径
          <div className="crawler-path-row">
            <input value={installPath} onChange={e => setInstallPath(e.target.value)} placeholder="例如 /Users/you/NewsCrawler" />
            <button type="button" onClick={() => void handlePickPath()} disabled={busy === 'pick'}>📁 选择目录</button>
          </div>
        </label>
        <label>Web UI 地址
          <input value={webUiUrl} onChange={e => setWebUiUrl(e.target.value)} placeholder="http://localhost:3021" />
        </label>
        <label className="crawler-checkbox">
          <input type="checkbox" checked={autoStart} onChange={e => setAutoStart(e.target.checked)} />
          <span>应用启动时自动拉起 NewsCrawler</span>
        </label>
        <div className="crawler-config-actions">
          <button type="button" className="primary" onClick={() => void handleSave()} disabled={busy === 'save' || !installPath.trim()}>
            {busy === 'save' ? '保存中…' : '保存配置'}
          </button>
        </div>
      </div>
    </section>

    <section className="crawler-config-card">
      <div className="config-card-title"><span>02</span><div><b>服务启停</b><small>基于 docker compose 控制 NewsCrawler 容器</small></div></div>
      <div className="config-card-body crawler-runtime-grid">
        <div>
          <small>Docker</small>
          <b className={status?.dockerAvailable ? 'ok' : 'fail'}>{status?.dockerAvailable ? '✓ 可用' : '✗ 不可用'}</b>
        </div>
        <div>
          <small>docker compose</small>
          <b className={status?.dockerComposeAvailable ? 'ok' : 'fail'}>{status?.dockerComposeAvailable ? '✓ 可用' : '✗ 不可用'}</b>
        </div>
        <div>
          <small>docker-compose.yml</small>
          <b className={status?.installPathValid ? 'ok' : 'fail'}>{status?.installPathValid ? '✓ 找到' : '✗ 未找到'}</b>
        </div>
        <div>
          <small>Web UI</small>
          <b className={status?.webUiReachable ? 'ok' : 'fail'}>{status?.webUiReachable ? '✓ 响应中' : '○ 离线'}</b>
        </div>
        <div className="crawler-runtime-actions">
          <button type="button" className="primary" onClick={() => void handleStart()} disabled={busy === 'start' || !canStart}>
            {busy === 'start' ? '启动中…' : '▶ 启动 NewsCrawler'}
          </button>
          <button type="button" onClick={() => void handleStop()} disabled={busy === 'stop' || !isRunning}>
            {busy === 'stop' ? '停止中…' : '■ 停止'}
          </button>
          <button type="button" onClick={() => void window.desktop.articleCrawler.openInstallDir().catch(err => setMessage({ tone: 'danger', text: err.message }))} disabled={!status?.installPathValid}>
            📁 打开安装目录
          </button>
          <button type="button" onClick={() => void window.desktop.articleCrawler.openDataDir().catch(err => setMessage({ tone: 'danger', text: err.message }))} disabled={!status?.dataDirValid}>
            📂 打开数据目录
          </button>
        </div>
      </div>
    </section>
  </div>
}

// ---------------------------------------------------------------- 主组件

export default function SystemAdmin() {
  const { profile } = useSession()
  const [tab, setTab] = useState<AdminTab>('members')
  const [members, setMembers] = useState<MemberView[]>([])
  const [pendingMembers, setPendingMembers] = useState<MemberView[]>([])
  const [roles, setRoles] = useState<RoleView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Linduo Tier 列表（成员行共享）
  const [linduoTiers, setLinduoTiers] = useState<LinduoModelTierView[]>([])
  // 各成员当前 tier: memberId → tier | null（null=未分配）
  const [memberTiers, setMemberTiers] = useState<Record<string, LinduoModelTierView | null>>({})
  // Linduo 例外 modal 状态
  const [linduoExceptionTarget, setLinduoExceptionTarget] = useState<{
    member: MemberView
    view: import('../shared/contracts').LinduoMemberTierView
  } | null>(null)
  const [linduoExceptionLoading, setLinduoExceptionLoading] = useState(false)
  const [linduoExceptionMsg, setLinduoExceptionMsg] = useState('')
  // 全 enabled 模型列表，LinduoExceptionModal 双栏要用（为避免全员重拉，load 一次在主组件缓存）
  const [allLinduoModels, setAllLinduoModels] = useState<LinduoChatModelView[]>([])

  // 新增成员表单
  const [showCreate, setShowCreate] = useState(false)
  const [cPhone, setCPhone] = useState('')
  const [cName, setCName] = useState('')
  const [cPassword, setCPassword] = useState('')
  const [cPermissions, setCPermissions] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [createMsg, setCreateMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [m, r, p, tiers, all] = await Promise.all([
        fetchMembers(),
        fetchRoles(),
        fetchPendingMembers(),
        fetchLinduoTiers(),
        fetchAllLinduoChatModels()
      ])
      const activeMembers = m.filter(u => u.status !== 'PENDING' && u.status !== 'REJECTED')
      setMembers(activeMembers); setRoles(r); setPendingMembers(p)
      setLinduoTiers(tiers)
      setAllLinduoModels(all.filter(am => am.enabled))
      // 每个成员的当前 tier 拉一次（不阻塞成员列表渲染，并行起请求）
      const tierResults = await Promise.all(activeMembers.map(async (mem) => {
        try {
          const view = await fetchLinduoMemberTier(mem.id)
          return [mem.id, view.tier] as const
        } catch {
          return [mem.id, null] as const
        }
      }))
      setMemberTiers(Object.fromEntries(tierResults))
    } catch (err) { setError(errorText(err, '加载失败')) } finally { setLoading(false) }
  }, [])

  useEffect(() => { void load() }, [load])

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (creating) return
    if (cPermissions.length === 0) { setCreateMsg('请为子帐号选择使用权限'); return }
    setCreating(true); setCreateMsg('')
    try {
      await createMember({ email: cPhone.trim(), name: cName.trim(), password: cPassword, permissions: expandMenuSelection(cPermissions) })
      setShowCreate(false); setCPhone(''); setCName(''); setCPassword(''); setCPermissions([])
      setCreateMsg('')
      await load()
    } catch (err) { setCreateMsg(errorText(err, '创建失败')) } finally { setCreating(false) }
  }

  const openLinduoException = async (member: MemberView) => {
    setLinduoExceptionMsg('')
    setLinduoExceptionLoading(true)
    try {
      const [view, models] = await Promise.all([
        fetchLinduoMemberTier(member.id),
        allLinduoModels.length > 0
          ? Promise.resolve(allLinduoModels)
          : fetchAllLinduoChatModels().then(list => {
              const enabled = list.filter(m => m.enabled)
              setAllLinduoModels(enabled)
              return enabled
            })
      ])
      setLinduoExceptionTarget({ member, view })
      // 顺手缓存 tier
      setMemberTiers(prev => ({ ...prev, [member.id]: view.tier }))
    } catch (err) {
      setLinduoExceptionMsg(errorText(err, '加载 Linduo 例外失败'))
    } finally {
      setLinduoExceptionLoading(false)
    }
  }
  
  const handleChangeMemberTier = async (member: MemberView, tierId: string | null) => {
    try {
      const view = await setLinduoMemberTier(member.id, tierId)
      setMemberTiers(prev => ({ ...prev, [member.id]: view.tier }))
    } catch (err) {
      throw err
    }
  }
  
  const assignableRoles = roles.filter(r => r.key !== 'OWNER')

  return <div className="sysadmin-page">
    <div className="sysadmin-header">
      <h2>系统管理</h2>
      <div className="sysadmin-tabs" role="tablist" aria-label="系统管理栏目">
        <button role="tab" aria-selected={tab === 'members'} className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>成员管理</button>
        <button role="tab" aria-selected={tab === 'review'} className={tab === 'review' ? 'active' : ''} onClick={() => setTab('review')}>
          注册审核{pendingMembers.length > 0 ? `（${pendingMembers.length}）` : ''}
        </button>
        <button role="tab" aria-selected={tab === 'crawler'} className={tab === 'crawler' ? 'active' : ''} onClick={() => setTab('crawler')}>文章抓取</button>
        <button role="tab" aria-selected={tab === 'org'} className={tab === 'org' ? 'active' : ''} onClick={() => setTab('org')}>组织信息</button>
      </div>
    </div>

    {error && <Notice className="sysadmin-error" tone="danger" role="alert">{error}</Notice>}

    {tab === 'members' && <>
      <div className="sysadmin-toolbar">
        <span className="muted">共 {members.length} 位成员</span>
        <Button variant="primary" onClick={() => { setShowCreate(v => !v); setCreateMsg('') }}>＋ 新增成员</Button>
      </div>

      {showCreate && <form className="sysadmin-create-form" onSubmit={e => void submitCreate(e)}>
        <div className="create-form-grid">
          <label>手机号<input type="tel" value={cPhone} onChange={e => setCPhone(e.target.value)} placeholder="11位手机号" maxLength={11} required /></label>
          <label>姓名<input value={cName} onChange={e => setCName(e.target.value)} placeholder="成员姓名" maxLength={30} required /></label>
          <label>初始密码<input type="password" value={cPassword} onChange={e => setCPassword(e.target.value)} placeholder="至少8位，含字母与数字" required /></label>
          <fieldset><legend>使用权限（可多选）</legend>
            <MenuPermTree selected={cPermissions} onChange={setCPermissions} />
          </fieldset>
        </div>
        {createMsg && <Notice className="sysadmin-msg" tone="danger" role="alert">{createMsg}</Notice>}
        <div className="create-form-actions">
          <Button type="submit" variant="primary" loading={creating}>创建子帐号</Button>
          <Button type="button" onClick={() => setShowCreate(false)}>取消</Button>
        </div>
      </form>}

      {loading ? <LoadingState className="sysadmin-loading" label="正在加载成员…" /> : members.length === 0 ? <EmptyState title="暂无成员" description="新增成员后，可在这里分配使用权限。" /> : <table className="sysadmin-table sysadmin-members-table">
        <thead><tr><th>姓名</th><th>手机号</th><th>角色</th><th>使用权限</th><th>状态</th><th>最近登录</th><th>操作</th></tr></thead>
        <tbody>
          {members.map(member => (
            <MemberRow
              key={member.id}
              member={member}
              roles={roles}
              onChanged={() => void load()}
              linduoTiers={linduoTiers}
              currentMemberTier={memberTiers[member.id] ?? null}
              onChangeMemberTier={tierId => handleChangeMemberTier(member, tierId)}
              onOpenLinduoException={() => void openLinduoException(member)}
            />
          ))}
        </tbody>
      </table>}
    </>}

    {tab === 'review' && <>
      <div className="sysadmin-toolbar">
        <span className="muted">共 {pendingMembers.length} 条待审核申请</span>
      </div>
      {loading ? <LoadingState className="sysadmin-loading" label="正在加载注册申请…" /> : pendingMembers.length === 0
        ? <EmptyState title="暂无待审核申请" description="新成员提交注册申请后会显示在这里。" />
        : <table className="sysadmin-table">
          <thead><tr><th>姓名</th><th>手机号</th><th>申请时间</th><th>分配权限</th><th>操作</th></tr></thead>
          <tbody>
            {pendingMembers.map(member => <PendingRow key={member.id} member={member} onChanged={() => void load()} />)}
          </tbody>
        </table>}
    </>}

    {tab === 'crawler' && <CrawlerConfigTab />}

    {tab === 'org' && <div className="sysadmin-org">
      <dl className="sysadmin-org-info">
        <div className="org-item"><dt>组织名称</dt><dd>{profile.org.name}</dd></div>
        <div className="org-item"><dt>当前登录</dt><dd>{profile.name}（{profile.email}）</dd></div>
        <div className="org-item"><dt>身份</dt><dd>{profile.isOwner ? '主帐号 · 拥有全部权限' : '子帐号'}</dd></div>
        <div className="org-item"><dt>角色列表</dt><dd>{roles.map(r => `${r.name}（${r.memberCount}人）`).join('、') || '—'}</dd></div>
      </dl>
    </div>}

    {linduoExceptionTarget && (
      <LinduoExceptionModal
        onClose={() => setLinduoExceptionTarget(null)}
        onSaved={() => void load()}
        member={linduoExceptionTarget.view}
        allModels={allLinduoModels}
        targetUserId={linduoExceptionTarget.member.id}
      />
    )}
    {linduoExceptionLoading && (
      <div className="linduo-picker-backdrop" role="status">
        <div className="linduo-picker-card">
          <div className="linduo-picker-body">正在加载 Linduo 例外…</div>
        </div>
      </div>
    )}
    {linduoExceptionMsg && !linduoExceptionTarget && (
      <Notice className="sysadmin-msg" tone="danger" role="alert">{linduoExceptionMsg}</Notice>
    )}
  </div>
}
