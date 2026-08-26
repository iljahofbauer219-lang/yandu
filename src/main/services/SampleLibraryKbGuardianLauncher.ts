/**
 * 报告样例库 → 知识库守卫启动器（I.2 阶段新增）。
 *
 * 目的：把 I.1 阶段的「一键入库」升级为「自动同步」：
 *   - 启动时检测是否已存在预置守卫技能
 *   - 不存在则按 sampleLibraryKbIngest 计划创建（带 categoryResolver + ensureCategories）
 *   - 存在则参数漂移自动修正
 *   - 提供 launchNow() 立即跑一次的能力（用户点桌面入口按钮时调用）
 *
 * 设计原则：
 *   - 文件名 → 分类 的映射：复用 I.1 阶段的 SAMPLE_LIBRARY_KB_DOCS（双源同步）
 *   - 守卫命名：SAMPLE_LIBRARY_KB_GUARDIAN_NAME（预置技能唯一名，避免重复创建）
 *   - 幂等：检测到同名预置技能就跳过创建；支持用户手动删除后再次点按钮
 *   - 启动器自身不持久化状态；全部状态走 KbGuardianService 的 userData
 */
import { resolveSampleLibraryArtifactDir, SAMPLE_LIBRARY_KB_TARGET, SAMPLE_LIBRARY_KB_DOCS, type SampleLibraryKbLeafCategory } from '../../shared/sampleLibraryKbIngest'
import type { GuardianSkill, GuardianSkillInput, GuardianState } from '../../shared/kbGuardian'
import type { MaxkbKnowledgeService } from './MaxkbKnowledgeService'
import type { KbGuardianService, GuardianCategoryResolver } from './KbGuardianService'

// 预置守卫技能唯一名（KnowledgeHub 上展示）
export const SAMPLE_LIBRARY_KB_GUARDIAN_NAME = '报告样例库自动同步'

// categoryResolver：把文件名映射到叶子分类
// I.1 计划即权威；按 fileName 查表
export function buildSampleLibraryCategoryResolver(): GuardianCategoryResolver {
  const map = new Map<string, SampleLibraryKbLeafCategory>()
  for (const spec of SAMPLE_LIBRARY_KB_DOCS) map.set(spec.fileName, spec.category)
  return (fileName: string) => map.get(fileName)
}

export interface SampleLibraryGuardianStatus {
  present: boolean
  skill: GuardianSkill | null
  state: GuardianState
  ranNow: boolean
  runNowReason?: string
}

export class SampleLibraryKbGuardianLauncher {
  /**
   * 检测 / 创建 / 修正 预置守卫技能（幂等）。
   * 如未存在则创建；存在则按当前期望参数修正（仅当字段漂移时写回）。
   * 不会主动 runNow；如需立即跑请另调 launchNow()。
   */
  static async ensure(maxkbKb: MaxkbKnowledgeService, kbGuardian: KbGuardianService): Promise<GuardianSkill | null> {
    // 1) 保证目标 KB 存在
    const kb = await maxkbKb.ensureAgentKb(SAMPLE_LIBRARY_KB_TARGET.agentKey)
    // 2) 读取当前注册表
    const state = await kbGuardian.state()
    const existing = state.skills.find(skill => skill.name === SAMPLE_LIBRARY_KB_GUARDIAN_NAME) ?? null
    // 3) 准备期望参数
    const sourcePath = resolveSampleLibraryArtifactDir()
    const expected: GuardianSkillInput = {
      name: SAMPLE_LIBRARY_KB_GUARDIAN_NAME,
      sourcePath,
      fileExts: ['.md'],
      targetKbId: kb.id,
      targetKbName: kb.name,
      frequency: 'daily',
      enabled: true,
      category: '',
      ensureCategories: [
        { name: SAMPLE_LIBRARY_KB_TARGET.categoryRoot },
        ...Array.from(new Set(SAMPLE_LIBRARY_KB_DOCS.map(spec => spec.category.split('/')[1]))).map(sub => ({ name: sub!, parent: SAMPLE_LIBRARY_KB_TARGET.categoryRoot }))
      ],
      // I.5 阶段新增：预置技能默认走软同步（保留旧 docId + MaxKB 替换文件）
      syncMode: 'soft',
      // I.6 阶段新增：预置技能默认走孤儿文档清理（源文件被删/重命名后 KB 中旧 docId 会被删掉）
      orphanCleanup: true,
      // I.7 阶段新增：预置技能默认走软→硬回退（docId 失效/MaxKB 老版本时自动 deleteDocs + uploadAndParse 恢复）
      softFallbackHard: true
    }
    // 4) 不存在则创建
    if (!existing) {
      return await kbGuardian.createSkill(expected)
    }
    // 5) 存在则字段漂移检查（sourcePath / targetKbId / fileExts / frequency / ensureCategories / syncMode / orphanCleanup / softFallbackHard）
    const needs = (): boolean => {
      if (existing.sourcePath !== expected.sourcePath) return true
      if (existing.targetKbId !== expected.targetKbId) return true
      if (existing.frequency !== expected.frequency) return true
      if (!existing.enabled) return true
      // I.5 阶段新增：syncMode 漂移检查（预置技能声明为 soft，老 I.2 持久化可能为 undefined）
      if ((existing.syncMode ?? 'soft') !== (expected.syncMode ?? 'soft')) return true
      // I.6 阶段新增：orphanCleanup 漂移检查（预置技能声明为 true，老 I.5 持久化可能为 undefined）
      if ((existing.orphanCleanup ?? true) !== (expected.orphanCleanup ?? true)) return true
      // I.7 阶段新增：softFallbackHard 漂移检查（预置技能声明为 true，老 I.6 持久化可能为 undefined）
      if ((existing.softFallbackHard ?? true) !== (expected.softFallbackHard ?? true)) return true
      const a = (existing.fileExts ?? []).map(ext => ext.toLowerCase()).sort().join(',')
      const b = expected.fileExts.map(ext => ext.toLowerCase()).sort().join(',')
      if (a !== b) return true
      const existingCats = existing.ensureCategories ?? []
      if (existingCats.length !== expected.ensureCategories?.length) return true
      const same = (x: { name: string; parent?: string }, y: { name: string; parent?: string }) =>
        x.name === y.name && (x.parent ?? '') === (y.parent ?? '')
      for (let i = 0; i < existingCats.length; i++) {
        if (!same(existingCats[i], expected.ensureCategories![i])) return true
      }
      return false
    }
    if (needs()) {
      return await kbGuardian.updateSkill(existing.id, expected)
    }
    return existing
  }

  /**
   * 立即跑一次预置技能（用户点「启用守卫」或「立即同步」按钮时调用）。
   * 检测到未注册时自动 ensure；存在则只 runNow。
   */
  static async launchNow(maxkbKb: MaxkbKnowledgeService, kbGuardian: KbGuardianService): Promise<SampleLibraryGuardianStatus> {
    const skill = await this.ensure(maxkbKb, kbGuardian)
    if (!skill) {
      const state = await kbGuardian.state()
      return { present: false, skill: null, state, ranNow: false, runNowReason: '预置技能创建失败' }
    }
    const result = await kbGuardian.runNow(skill.id)
    const state = await kbGuardian.state()
    return {
      present: true,
      skill: state.skills.find(item => item.id === skill.id) ?? skill,
      state,
      ranNow: result.queued,
      runNowReason: result.reason
    }
  }

  /**
   * 仅查询预置技能状态（UI 展示用，不创建）。
   */
  static async status(kbGuardian: KbGuardianService): Promise<{ present: boolean; skill: GuardianSkill | null; state: GuardianState }> {
    const state = await kbGuardian.state()
    const skill = state.skills.find(item => item.name === SAMPLE_LIBRARY_KB_GUARDIAN_NAME) ?? null
    return { present: Boolean(skill), skill, state }
  }
}
