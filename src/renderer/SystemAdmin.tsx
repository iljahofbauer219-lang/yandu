/**
 * 系统管理页：成员管理 + 组织信息。
 * 仅主帐号/拥有 member.manage 权限者可见（服务端亦有权限校验兜底）。
 */
import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { MemberView, RoleView } from './serverApi'
import { ApiError, approveMember, changePassword, createMember, deleteMember, fetchAllLinduoChatModels, fetchLinduoGrants, fetchMembers, fetchPendingMembers, fetchRoles, rejectMember, resetMemberPassword, revokeLinduoGrant, setLinduoGrant, updateMember, updateMemberPermissions } from './serverApi'
import type { LinduoChatModelView } from '../shared/contracts'
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
  onAssignLinduo?: (member: MemberView) => void
}) {
  const { member, roles, onChanged, onAssignLinduo } = props
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
          <span className="member-action-note">OWNER 全开</span>
        </>
      ) : editing ? <>
        <button disabled={busy} onClick={() => void saveEdit()}>保存</button>
        <button disabled={busy} onClick={() => setEditing(false)}>取消</button>
      </> : <>
        <button onClick={startEdit}>编辑</button>
        <button disabled={busy} onClick={() => onAssignLinduo?.(member)}>Linduo 选用</button>
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

  // Linduo 模型分配 Modal（M1）
  const [linduoAssignTarget, setLinduoAssignTarget] = useState<MemberView | null>(null)
  const [linduoAllModels, setLinduoAllModels] = useState<LinduoChatModelView[]>([])
  const [linduoUserGrants, setLinduoUserGrants] = useState<Set<string>>(new Set())
  const [linduoLoading, setLinduoLoading] = useState(false)
  const [linduoMsg, setLinduoMsg] = useState('')

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
      const [m, r, p] = await Promise.all([fetchMembers(), fetchRoles(), fetchPendingMembers()])
      setMembers(m.filter(u => u.status !== 'PENDING' && u.status !== 'REJECTED')); setRoles(r); setPendingMembers(p)
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

  const openLinduoAssign = async (member: MemberView) => {
    setLinduoAssignTarget(member)
    setLinduoAllModels([])
    setLinduoUserGrants(new Set())
    setLinduoMsg('')
    setLinduoLoading(true)
    try {
      // grant 的 modelId 语义 = LinduoChatModel.id（DB cuid，见 UserLinduoGrant 外键），故勾选态用 model.id 对齐
      const [all, grants] = await Promise.all([fetchAllLinduoChatModels(), fetchLinduoGrants()])
      setLinduoAllModels(all.filter(m => m.enabled))
      setLinduoUserGrants(new Set(grants.filter(g => g.userId === member.id).map(g => g.modelId)))
    } catch (err) {
      setLinduoMsg(errorText(err, '加载 Linduo 模型失败'))
    } finally {
      setLinduoLoading(false)
    }
  }

  const toggleLinduoGrant = async (modelId: string, checked: boolean) => {
    const target = linduoAssignTarget
    if (!target) return
    setLinduoMsg('')
    try {
      if (checked) {
        await setLinduoGrant(target.id, modelId)
      } else {
        await revokeLinduoGrant(target.id, modelId)
      }
      // 请求成功后才更新 Set；失败时 checkbox 因受控自动回弹
      setLinduoUserGrants(prev => {
        const next = new Set(prev)
        if (checked) next.add(modelId); else next.delete(modelId)
        return next
      })
    } catch (err) {
      setLinduoMsg(errorText(err, '分配失败'))
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
          {members.map(member => <MemberRow key={member.id} member={member} roles={roles} onChanged={() => void load()} onAssignLinduo={m => void openLinduoAssign(m)} />)}
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

    {linduoAssignTarget && (
      <div className="linduo-assign-backdrop" role="dialog" aria-modal="true" onClick={e => { if (e.target === e.currentTarget) setLinduoAssignTarget(null) }}>
        <div className="linduo-assign-card">
          <header>
            <h2>为 {linduoAssignTarget.name} 分配 Linduo 聊天模型</h2>
            <button type="button" className="linduo-assign-close" onClick={() => setLinduoAssignTarget(null)} aria-label="关闭">✕</button>
          </header>
          <div className="linduo-assign-body">
            {linduoMsg && <Notice className="sysadmin-msg" tone="danger" role="alert">{linduoMsg}</Notice>}
            {linduoLoading && <LoadingState label="正在加载模型列表…" />}
            {!linduoLoading && linduoAllModels.length === 0 && (
              <div className="linduo-assign-empty">暂无可用 Linduo 模型（enabled 列表为空）。</div>
            )}
            {!linduoLoading && linduoAllModels.map(model => {
              const checked = linduoUserGrants.has(model.id)
              return (
                <label key={model.id} className="linduo-assign-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={e => void toggleLinduoGrant(model.id, e.target.checked)}
                  />
                  <span>
                    <strong>{model.displayName}</strong>
                    <small>{model.vendor} · {model.contextLabel || '—'}</small>
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      </div>
    )}
  </div>
}
