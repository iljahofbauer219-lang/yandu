import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'

type LlmKeyStatus = { id: string; configured: boolean; maskedKey: string }

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
    id: 'ragflow',
    name: 'RAGFlow 知识库',
    usage: 'AI员工 / 知识库智能体',
    color: '#d97706',
    icon: <><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/><path d="M9 7h7M9 11h5"/></>
  }
]

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
