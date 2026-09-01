/**
 * AIEmployeeHub — AI 运营助手主页
 *
 * 架构 v2.0:
 * - 顶部欢迎语 + 对话输入区
 * - 场景入口（SceneEntry）+ 最佳实践（BestPractice）
 * - 模态层：技能 / 商品库
 * - 一二级员工选择入口已从主页移除,改在工作台 chips / 技能弹窗中维护
 *
 * Props 行为:
 * - onEnterAgent(name, prefillQuery?): 跳转到对应员工工作台，可选预填任务
 */

import { useState, type FormEvent } from 'react'
import SceneEntryGrid from './SceneEntry'
import BestPracticeGrid from './BestPractice'
import CrossborderAgentGrid from './CrossborderAgentGrid'
import SkillSelector from './SkillSelector'
import ProductLibrary from './ProductLibrary'
import {
  BEST_PRACTICES,
  SCENE_ENTRIES,
  type BestPractice,
  type SceneEntry
} from '../shared/agentCategories'
import type { ProductLibraryItem } from '../shared/productLibrary'

type Props = {
  /** 进入某个员工工作台 */
  onEnterAgent: (agentName: string, prefillQuery?: string) => void
}

export default function AIEmployeeHub({ onEnterAgent }: Props) {
  const [query, setQuery] = useState('')
  // 模态状态：技能选择器（已实现），商品库占位
  const [showSkillModal, setShowSkillModal] = useState(false)
  const [showProductModal, setShowProductModal] = useState(false)

  // 点击"进入"按钮或发送按钮
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const text = query.trim()
    if (!text) {
      alert('请输入任务描述，或从下方场景入口 / 最佳实践 / 商品库中选择一项开始')
      return
    }
    // Hub 输入框发送：直接交给 App.tsx 路由决定目标员工（默认走选品调研员）
    onEnterAgent('选品调研员', text)
  }

  // 场景入口 → 跳到对应员工
  const handleSceneSelect = (scene: SceneEntry) => {
    onEnterAgent(scene.targetAgent, scene.prefillQuery)
  }

  // 最佳实践 → 跳到对应员工
  const handleBestPracticeSelect = (item: BestPractice) => {
    onEnterAgent(item.targetAgent, item.prefillQuery)
  }

  // 商品库选中 → 跳到选品调研员并预填分析请求
  const handleProductSelect = (item: ProductLibraryItem) => {
    setShowProductModal(false)
    onEnterAgent('选品调研员', `请基于已选商品「${item.title}」分析跨境市场机会…`)
  }

  return (
    <section className="ai-employee-hub" aria-label="AI 运营助手">
      {/* 顶部欢迎 + 对话区 */}
      <header className="ai-employee-hub-hero">
        <div className="ai-employee-hub-hero-inner">
          <h1>跨境电商AI员工</h1>

          <form className="ai-employee-hub-composer" onSubmit={handleSubmit}>
            <div className="ai-employee-hub-input-wrap">
              <textarea
                className="ai-employee-hub-input"
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="💬 输入你的任务或选择下面的员工开始…"
                rows={3}
                aria-label="任务输入"
                onKeyDown={event => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault()
                    handleSubmit(event as unknown as FormEvent)
                  }
                }}
              />
            </div>
            <div className="ai-employee-hub-composer-toolbar">
              <div className="ai-employee-hub-toolbar-left">
                <button
                  type="button"
                  className="ai-employee-hub-toolbar-btn"
                  title="附件"
                  aria-label="附件"
                  disabled
                >
                  📎
                </button>
                <button
                  type="button"
                  className="ai-employee-hub-toolbar-btn"
                  onClick={() => setShowProductModal(true)}
                  title="商品库"
                  aria-label="商品库"
                >
                  📦 商品库
                </button>
              </div>
              <div className="ai-employee-hub-toolbar-right">
                <button
                  type="button"
                  className="ai-employee-hub-toolbar-btn ai-employee-hub-skill-btn"
                  onClick={() => setShowSkillModal(true)}
                  title="AI智能体"
                  aria-label="AI智能体"
                >
                  🤖 AI智能体
                </button>
                <button
                  type="submit"
                  className="ai-employee-hub-send-btn primary"
                  disabled={!query.trim()}
                >
                  发送
                </button>
              </div>
            </div>
          </form>
        </div>
      </header>

      {/* 跨境智能体（部门分组卡片，位于「场景入口」之前） */}
      <section className="ai-employee-hub-agents" aria-label="跨境智能体">
        <h2 className="ai-employee-hub-section-title">跨境智能体</h2>
        <CrossborderAgentGrid onSelect={agent => onEnterAgent(agent.name)} />
      </section>

      {/* 场景入口 */}
      <section className="ai-employee-hub-scenes" aria-label="场景入口">
        <h2 className="ai-employee-hub-section-title">场景入口</h2>
        <SceneEntryGrid scenes={SCENE_ENTRIES} onSelect={handleSceneSelect} />
      </section>

      {/* 最佳实践 */}
      <section className="ai-employee-hub-best" aria-label="最佳实践">
        <h2 className="ai-employee-hub-section-title">最佳实践</h2>
        <BestPracticeGrid items={BEST_PRACTICES} onSelect={handleBestPracticeSelect} />
      </section>

      {/* 技能选择器弹窗（P1-A 阶段实现） */}
      {showSkillModal && (
        <SkillSelector
          employeeName="选品调研员"
          onClose={() => setShowSkillModal(false)}
        />
      )}

      {/* 商品库弹窗（P1-B 阶段） */}
      {showProductModal && (
        <div
          className="ai-employee-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="商品库"
          onClick={() => setShowProductModal(false)}
        >
          <div
            className="ai-employee-modal ai-employee-modal-wide"
            onClick={event => event.stopPropagation()}
          >
            <ProductLibrary
              onSelect={handleProductSelect}
              onClose={() => setShowProductModal(false)}
            />
          </div>
        </div>
      )}
    </section>
  )
}
