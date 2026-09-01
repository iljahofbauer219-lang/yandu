/**
 * send进行中UX护栏 — cancelChat / activeChats 行为验证（三件套护栏后端命中点）。
 * - cancelChat 未命中：返回 false，无副作用
 * - cancelChat 命中：abort 对应 AbortController 并返回 true
 * - listModels 岗位白名单：仅暴露岗位对应模型；未知岗位返回空
 */
import { describe, expect, it, vi } from 'vitest'

// AiEmployeeChatService 依赖链（serverConfig 等）引用 electron 主进程 API，测试环境统一打桩
vi.mock('electron', () => ({
  app: { getPath: () => '/tmp', isPackaged: false },
  dialog: {},
  nativeImage: {}
}))

import { AiEmployeeChatService } from '../AiEmployeeChatService'

type WithActiveChats = { activeChats: Map<string, AbortController> }

describe('AiEmployeeChatService.cancelChat', () => {
  it('未命中 requestId 时返回 false', () => {
    const svc = new AiEmployeeChatService()
    expect(svc.cancelChat('not-exists')).toBe(false)
  })

  it('命中 in-flight 请求时 abort 上游并返回 true', () => {
    const svc = new AiEmployeeChatService()
    const controller = new AbortController()
    ;(svc as unknown as WithActiveChats).activeChats.set('req-1', controller)

    expect(controller.signal.aborted).toBe(false)
    expect(svc.cancelChat('req-1', 'user-cancel')).toBe(true)
    expect(controller.signal.aborted).toBe(true)
    expect(controller.signal.reason).toBe('user-cancel')
  })

  it('重复取消同一 requestId 不抛异常（already aborted 静默）', () => {
    const svc = new AiEmployeeChatService()
    const controller = new AbortController()
    ;(svc as unknown as WithActiveChats).activeChats.set('req-2', controller)

    expect(svc.cancelChat('req-2')).toBe(true)
    expect(() => svc.cancelChat('req-2')).not.toThrow()
  })
})

describe('AiEmployeeChatService.listModels 岗位白名单', () => {
  it('不传岗位时返回完整目录', () => {
    const svc = new AiEmployeeChatService()
    const ids = svc.listModels().map(m => m.id)
    expect(ids).toContain('amazon-skills-agent')
    expect(ids.length).toBeGreaterThanOrEqual(9)
  })

  it('选品调研员仅暴露 amazon-skills-agent', () => {
    const svc = new AiEmployeeChatService()
    expect(svc.listModels('选品调研员').map(m => m.id)).toEqual(['amazon-skills-agent'])
  })

  it('未在白名单的岗位返回空列表', () => {
    const svc = new AiEmployeeChatService()
    expect(svc.listModels('竞品分析员')).toEqual([])
    expect(svc.listModels('不存在岗位')).toEqual([])
  })
})
