/**
 * 系统管理页：成员管理 + 组织信息。
 * 仅主帐号/拥有 member.manage 权限者可见（服务端亦有权限校验兜底）。
 */
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { MemberView, RoleView } from './serverApi'
import { ApiError, approveMember, changePassword, createMember, deleteMember, fetchLinduoTiers, fetchMembers, fetchPendingMembers, fetchRoles, rejectMember, resetMemberPassword, setLinduoMemberTier, updateMember, updateMemberPermissions } from './serverApi'
import type { LinduoChatModelView, LinduoModelTierView } from '../shared/contracts'
import { LinduoExceptionModal } from './LinduoExceptionModal'
import { fetchAllLinduoChatModels, fetchLinduoMemberTier } from './serverApi'
import { useSession } from './SessionGate'
import { Button, EmptyState, LoadingState, Notice, StatusBadge } from './ui/primitives'
import { MENU_PERMISSION_TREE, menuCheckState, summarizeMenuPermissions, toggleMenu, toggleMenuCard } from '../shared/menuPermissionTree'

type AdminTab = 'members' | 'review' | 'org'

/** 两级使用权限勾选树：一级三态（未选/半选/全选），二级与一级联动 */
function MenuPermTree(props: { selected: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const { selected, onChange, disabled } = props
  return <div className="menu-perm-tree">
    {MENU_PERMISSION_TREE.map(node => {
      const state = menuCheckState(selected, node)
      return <div className="menu-perm-node" key={node.code}>
        <label className="role-check menu-perm-level1">
          <input type="checkbox" disabled={disabled} checked={state === 'all'}
            ref={el => { if (el) el.indeterminate = state === 'some' }}
            onChange={e => onChange(toggleMenu(selected, node, e.target.checked))} />
          <b>{node.label}</b>
        </label>
        {node.cards.length > 0 && <div className="menu-perm-cards">
          {node.cards.map(card => <label key={card.code} className="role-check">
            <input type="checkbox" disabled={disabled} checked={selected.includes(card.code)}
              onChange={e => onChange(toggleMenuCard(selected, node, card.code, e.target.checked))} />
            {card.label}
          </label>)}
        </div>}
      </div>
    })}
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
      await approveMember(member.id, perms)
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

  const modulePerms = member.roles.flatMap(r => {
    const role = roles.find(rv => rv.id === r.id)
    return role ? role.permissions.filter(p => p.startsWith('menu.')) : []
  }).filter((v, i, a) => a.indexOf(v) === i)

  const startEdit = () => {
    setEditing(true)
    setName(member.name)
    setEditPerms(modulePerms)
    setNewPassword('')
    setMessage('')
  }

  const saveEdit = async () => {
    if (editPerms.length === 0) { setMessage('请至少勾选一个使用权限'); return }
    setBusy(true); setMessage('')
    try {
      const permsChanged = [...editPerms].sort().join() !== [...modulePerms].sort().join()
      if (name.trim() && name.trim() !== member.name) {
        await updateMember(member.id, { name: name.trim() })
      }
      if (permsChanged) {
        await updateMemberPermissions(member.id, editPerms)
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

  return <tr className={`sysadmin-member-row${member.status === 'DISABLED' ? ' disabled' : ''}`}>
    <td>
      <b>{member.name}</b>
      {member.isOwner && <StatusBadge className="owner-badge" tone="info">主帐号</StatusBadge>}
      {member.mustChangePassword && <StatusBadge className="pwd-badge" tone="warning">待改密</StatusBadge>}
    </td>
    <td className="mono">{member.email}</td>
    <td>{member.roles.map(r => r.name).join('、') || '—'}</td>
    <td>{summarizeMenuPermissions(modulePerms) || '—'}</td>
    <td><StatusBadge tone={member.status === 'ACTIVE' ? 'success' : 'warning'}>{member.status === 'ACTIVE' ? '✓ 正常' : '! 已禁用'}</StatusBadge></td>
    <td className="muted">{member.lastLoginAt ? new Date(member.lastLoginAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '从未登录'}</td>
    <td className="sysadmin-actions">
      {member.isOwner ? (
        changingPwd ? <>
          <button disabled={busy} onClick={() => void doChangeOwnPassword()}>确认修改</button>
          <button disabled={busy} onClick={() => { setChangingPwd(false); setMessage('') }}>取消</button>
        </> : <>
          <button onClick={() => { setChangingPwd(true); setOldPassword(''); setNewPassword(''); setMessage('') }}>修改密码</button>
          <label className="linduo-tier-select" title="主帐号默认全开组，不可修改">
            <span className="linduo-tier-label">Linduo 等级</span>
            <select value={currentMemberTier?.id ?? ''} disabled>
              {linduoTiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <span className="member-action-note">全开组(主帐号)</span>
        </>
      ) : editing ? <>
        <button disabled={busy} onClick={() => void saveEdit()}>保存</button>
        <button disabled={busy} onClick={() => setEditing(false)}>取消</button>
      </> : <>
        <button onClick={startEdit}>编辑</button>
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
        {member.status === 'ACTIVE'
          ? <button className="danger" disabled={busy} onClick={() => void toggleStatus()}>禁用</button>
          : <button disabled={busy} onClick={() => void toggleStatus()}>启用</button>}
        <button className="danger" disabled={busy} onClick={() => void doDelete()}>删除</button>
      </>}
    </td>
    {editing && !member.isOwner && <td colSpan={7} className="sysadmin-edit-panel">
      <div className="edit-panel-grid">
        <label>姓名<input value={name} onChange={e => setName(e.target.value)} maxLength={30} /></label>
        <fieldset><legend>使用权限</legend>
          <MenuPermTree selected={editPerms} onChange={setEditPerms} />
        </fieldset>
        <label>重置密码<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少8位含字母数字" /><button disabled={busy} onClick={() => void doResetPassword()}>重置</button></label>
      </div>
      {message && <p className="sysadmin-msg">{message}</p>}
    </td>}
    {changingPwd && member.isOwner && <td colSpan={7} className="sysadmin-edit-panel">
      <div className="edit-panel-grid">
        <label>原密码<input type="password" value={oldPassword} onChange={e => setOldPassword(e.target.value)} /></label>
        <label>新密码<input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="至少8位含字母数字" /></label>
      </div>
      {message && <p className="sysadmin-msg">{message}</p>}
    </td>}
    {!editing && !changingPwd && message && <td colSpan={7} className="sysadmin-msg-cell"><p className="sysadmin-msg">{message}</p></td>}
  </tr>
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
      await createMember({ email: cPhone.trim(), name: cName.trim(), password: cPassword, permissions: cPermissions })
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
