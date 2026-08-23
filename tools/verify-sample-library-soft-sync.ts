/**
 * I.5 阶段：守卫软同步（保留 docId + RAGFlow update_doc）verify 工具。
 *
 * 验证项（9 大组 / 80+ 断言）：
 *  1. 共享契约扩展：GuardianSyncMode = 'soft' | 'hard' 类型导出 + GuardianSkill/Input/RunOptions.syncMode 可选字段
 *  2. RagflowKnowledgeService.updateDoc：async 方法 + PUT 动词 + /datasets/{kbId}/documents/{docId} 路径 + multipart（FormData + Blob + path.basename）
 *  3. KbGuardianService 三路分支：load() 老持久化补 syncMode + createSkill/updateSkill 写 syncMode 缺省 + runNow/enqueueRun/runSkill 透传 options + effectiveSyncMode 解析 + soft/hard/新增三分支 + updateAndParse helper
 *  4. SampleLibraryKbGuardianLauncher 漂移检查：expected.syncMode: 'soft' 显式声明 + existing.syncMode 漂移比较
 *  5. UI 渲染（SampleLibrary.tsx）：GuardianStatus 类型加 syncMode 字段 + refreshGuardian 写入 + handleToggleSyncMode 调 kbGuardian.update + state() 拿全字段 + 状态卡渲染 chip + 切换按钮 + title 提示双态
 *  6. CSS 样式（sample-library.css）：.sample-library-guardian-sync-mode-btn 类（紧凑 chip + 圆角 999px + 11px + 青绿系 + hover/active）
 *  7. 跨阶段双源同步：7 个源（kbGuardian.ts + RagflowKnowledgeService.ts + KbGuardianService.ts + Launcher + SampleLibrary.tsx + sample-library.css + doc）一致
 *  8. 文档同步（docs/选品分析师-报告样例库.md）：含 I.5 章节标题 + 7 个必备小节 + 关键术语 + 引用 verify 工具名
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = process.cwd()
let pass = 0
let fail = 0
const failures: string[] = []

function assert(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    pass += 1
    console.log(`PASS  ${name}${detail ? `（${detail}）` : ''}`)
  } else {
    fail += 1
    failures.push(name)
    console.log(`FAIL  ${name}${detail ? `（${detail}）` : ''}`)
  }
}

// ─── 1. 共享契约扩展 ──────────────────────────────────
const kbGuardianPath = resolve(root, 'src/shared/kbGuardian.ts')
assert('src/shared/kbGuardian.ts 文件存在', existsSync(kbGuardianPath))
if (existsSync(kbGuardianPath)) {
  const src = readFileSync(kbGuardianPath, 'utf-8')
  const lines = src.split('\n').length
  assert('kbGuardian.ts 行数 ≥ 95（基础 90 + I.5 +5）', lines >= 95, `${lines} 行`)

  // 1.1 GuardianSyncMode 类型导出
  assert('导出 GuardianSyncMode 类型别名',
    /export type GuardianSyncMode\s*=\s*['"]soft['"]\s*\|\s*['"]hard['"]/.test(src))
  assert('GuardianSyncMode 含 soft 注释（保留旧 docId）',
    /I\.5\s*阶段新增：同步模式[\s\S]{0,500}?保留旧 docId[\s\S]{0,500}?RAGFlow\s*update_?doc[\s\S]{0,200}?export type GuardianSyncMode/.test(src))
  assert('GuardianSyncMode 含 hard 注释（先删旧再传新）',
    /I\.5\s*阶段新增：同步模式[\s\S]{0,500}?先删旧 docId[\s\S]{0,500}?再上传新文件[\s\S]{0,200}?export type GuardianSyncMode/.test(src))

  // 1.2 GuardianSkill.syncMode 字段
  assert('GuardianSkill 含 syncMode 可选字段',
    /export interface GuardianSkill\s*\{[\s\S]*?syncMode\?:\s*GuardianSyncMode[\s\S]*?\}/.test(src))
  assert('GuardianSkill.syncMode 字段带 I.5 阶段说明注释',
    /I\.5\s*阶段新增[\s\S]{0,500}?syncMode\?:\s*GuardianSyncMode/.test(src))

  // 1.3 GuardianSkillInput.syncMode 字段
  assert('GuardianSkillInput 含 syncMode 可选字段',
    /export interface GuardianSkillInput\s*\{[\s\S]*?syncMode\?:\s*GuardianSyncMode[\s\S]*?\}/.test(src))

  // 1.4 GuardianRunOptions.syncMode 字段
  assert('GuardianRunOptions 含 syncMode 可选字段',
    /export interface GuardianRunOptions\s*\{[\s\S]*?syncMode\?:\s*GuardianSyncMode[\s\S]*?\}/.test(src))
  assert('GuardianRunOptions.syncMode 注释说明：运行时覆盖不改持久化',
    /运行时覆盖\s*syncMode[\s\S]{0,100}?不改持久化[\s\S]{0,300}?syncMode\?:\s*GuardianSyncMode/.test(src))

  // 1.5 旧字段保留
  assert('保留 GuardianSkillStats 接口', /export interface GuardianSkillStats/.test(src))
  assert('保留 GuardianState 接口', /export interface GuardianState/.test(src))
  assert('保留 GuardianSkill 接口', /export interface GuardianSkill/.test(src))
  assert('保留 GuardianSkillInput 接口', /export interface GuardianSkillInput/.test(src))
  assert('保留 GuardianRunOptions 接口', /export interface GuardianRunOptions/.test(src))
  assert('保留 GuardianRunEvent 接口', /export interface GuardianRunEvent/.test(src))
}

// ─── 2. RagflowKnowledgeService.updateDoc ─────────────────
const ragflowPath = resolve(root, 'src/main/services/RagflowKnowledgeService.ts')
assert('src/main/services/RagflowKnowledgeService.ts 文件存在', existsSync(ragflowPath))
if (existsSync(ragflowPath)) {
  const src = readFileSync(ragflowPath, 'utf-8')
  const lines = src.split('\n').length
  assert('RagflowKnowledgeService.ts 行数 ≥ 350（基础 340 + I.5 +10）', lines >= 350, `${lines} 行`)

  // 2.1 updateDoc 方法签名
  assert('RagflowKnowledgeService 含 async updateDoc 方法',
    /async\s+updateDoc\s*\(\s*kbId:\s*string,\s*docId:\s*string,\s*filePath:\s*string\s*\)\s*:\s*Promise<void>/.test(src))

  // 2.2 PUT 动词 + /datasets/{kbId}/documents/{docId} 路径
  // \b 防与 updateDocMeta 冲突（用单词边界）
  const updateDocBlock = src.match(/async\s+updateDoc\b[\s\S]{0,500}?request<unknown>\s*\(\s*['"]PUT['"]\s*,\s*`\/datasets\/\$\{kbId\}\/documents\/\$\{docId\}`/)
  assert('updateDoc 调 request(\'PUT\', \'/datasets/${kbId}/documents/${docId}\')', updateDocBlock !== null)
  if (updateDocBlock) {
    const block = updateDocBlock[0]
    assert('updateDoc PUT 路径含 /datasets/${kbId}/documents/${docId}', /\/datasets\/\$\{kbId\}\/documents\/\$\{docId\}/.test(block))
  }

  // 2.3 multipart 形式（FormData + Blob + path.basename）
  // \b 防与 updateDocMeta 冲突
  const updateDocBody = src.match(/async\s+updateDoc\b[\s\S]{0,1500}?\}/)
  if (updateDocBody) {
    const body = updateDocBody[0]
    assert('updateDoc 用 FormData 构造 multipart body', /new\s+FormData\(\)/.test(body))
    assert('updateDoc 调 form.append(\'file\', new Blob([new Uint8Array(buffer)]), path.basename(filePath))',
      /form\.append\(\s*['"]file['"]\s*,\s*new\s+Blob\(\s*\[\s*new\s+Uint8Array\(\s*buffer\s*\)\s*\]\s*\)\s*,\s*path\.basename\(\s*filePath\s*\)/.test(body))
  } else {
    assert('updateDoc 函数体存在（无法定位跳过 multipart 断言）', false)
  }

  // 2.4 注释说明语义（注释用 update_doc 单词下划线形式）
  assert('updateDoc 注释说明 RAGFlow 0.11+ 标准',
    /I\.5[\s\S]{0,500}?update_?doc[\s\S]{0,500}?RAGFlow\s*0\.11\+/.test(src))
  assert('updateDoc 注释说明保留原 docId',
    /I\.5[\s\S]{0,500}?update_?doc[\s\S]{0,500}?保留\s*docId[\s\S]{0,500}?替换文件/.test(src) || /保留\s*docId[\s\S]{0,200}?替换文件[\s\S]{0,500}?update_?doc/.test(src))

  // 2.5 与 uploadDocs 风格一致（同样用 FormData + Blob + path.basename）
  const uploadDocsBlock = src.match(/async\s+uploadDocs[\s\S]{0,500}?\}/)
  if (uploadDocsBlock) {
    const ub = uploadDocsBlock[0]
    assert('uploadDocs 同样用 FormData + Blob + path.basename（与 updateDoc 风格一致）',
      /new\s+FormData\(\)/.test(ub) && /new\s+Blob/.test(ub) && /path\.basename/.test(ub))
  }

  // 2.6 updateDoc 之前不能有其他同名方法（保持唯一性）
  const updateDocCount = (src.match(/async\s+updateDoc\s*\(/g) || []).length
  assert('RagflowKnowledgeService.updateDoc 方法唯一（不与私有 updateDocMeta 冲突）', updateDocCount === 1, `实际 ${updateDocCount} 处 async updateDoc`)
}

// ─── 3. KbGuardianService 三路分支 + updateAndParse ──────
const svcPath = resolve(root, 'src/main/services/KbGuardianService.ts')
assert('KbGuardianService.ts 文件存在', existsSync(svcPath))
if (existsSync(svcPath)) {
  const src = readFileSync(svcPath, 'utf-8')
  const lines = src.split('\n').length
  assert('KbGuardianService.ts 行数 ≥ 380（基础 360 + I.5 +20）', lines >= 380, `${lines} 行`)

  // 3.1 import 含 GuardianRunOptions + GuardianSyncMode
  assert('import GuardianRunOptions + GuardianSyncMode from kbGuardian',
    /import\s+type\s*\{[^}]*GuardianRunOptions[^}]*GuardianSyncMode[^}]*\}\s*from\s*['"]\.\.\/\.\.\/shared\/kbGuardian['"]/.test(src))

  // 3.2 load() 老持久化补 syncMode
  assert('load() 老持久化补 syncMode 字段',
    /load\(\)[\s\S]{0,3000}?syncMode[\s\S]{0,300}?['"]soft['"]/.test(src))
  assert('load() 老持久化校验：mode !== \'soft\' && mode !== \'hard\' 时补 soft',
    /mode\s*!==\s*['"]soft['"]\s*&&\s*mode\s*!==\s*['"]hard['"]/.test(src))

  // 3.3 createSkill 写 syncMode 缺省
  assert('createSkill 写 syncMode: input.syncMode ?? \'soft\'',
    /createSkill[\s\S]{0,2000}?syncMode:\s*input\.syncMode\s*\?\?\s*['"]soft['"]/.test(src))

  // 3.4 updateSkill 写 syncMode 缺省
  assert('updateSkill 写 skill.syncMode = input.syncMode ?? \'soft\'',
    /updateSkill[\s\S]{0,2000}?skill\.syncMode\s*=\s*input\.syncMode\s*\?\?\s*['"]soft['"]/.test(src))

  // 3.5 runNow 接收 options
  assert('runNow(id: string, options?: GuardianRunOptions) 接收可选 options',
    /async\s+runNow\s*\(\s*id:\s*string,\s*options\?:\s*GuardianRunOptions\s*\)/.test(src))
  assert('runNow 调 enqueueRun(id, \'manual\', options)',
    /runNow[\s\S]{0,1000}?enqueueRun\(\s*id\s*,\s*['"]manual['"]\s*,\s*options\s*\)/.test(src))

  // 3.6 enqueueRun 透传 options
  assert('enqueueRun(skillId, trigger, options?: GuardianRunOptions) 接收 options',
    /enqueueRun\s*\(\s*skillId:\s*string,\s*trigger:\s*GuardianRunTrigger,\s*options\?:\s*GuardianRunOptions\s*\)/.test(src))
  assert('enqueueRun 调 runSkill(skillId, trigger, options)',
    /enqueueRun[\s\S]{0,500}?runSkill\(\s*skillId\s*,\s*trigger\s*,\s*options\s*\)/.test(src))

  // 3.7 runSkill 接收 options
  assert('runSkill(skillId, trigger, options?: GuardianRunOptions) 接收 options',
    /private\s+async\s+runSkill\s*\(\s*skillId:\s*string,\s*trigger:\s*GuardianRunTrigger,\s*options\?:\s*GuardianRunOptions\s*\)/.test(src))

  // 3.8 effectiveSyncMode 解析（运行时 options 优先 → 技能本身 → 缺省 soft）
  assert('runSkill 解析 effectiveSyncMode = options?.syncMode ?? skill.syncMode ?? \'soft\'',
    /effectiveSyncMode\s*:\s*GuardianSyncMode\s*=\s*\(\s*options\?\.syncMode\s*\?\?\s*skill\.syncMode\s*\?\?\s*['"]soft['"]\s*\)/.test(src))

  // 3.9 soft 分支：调 updateAndParse（保留 docId）
  assert('runSkill soft 分支：调 updateAndParse(skill.targetKbId, entry.docId, absPath)',
    /effectiveSyncMode\s*===\s*['"]soft['"][\s\S]{0,500}?updateAndParse\(\s*skill\.targetKbId\s*,\s*entry\.docId\s*,\s*absPath\s*\)/.test(src))
  assert('soft 分支失败标记「软同步更新失败：xxx」',
    /软同步更新失败[：:]/.test(src))

  // 3.10 hard 分支：先 deleteDocs 失败标记 + uploadAndParse
  // 软分支含 try/catch + 调用 updateAndParse 体，200 字符不够，扩到 1200
  assert('hard 分支（else）含 entry 时调 deleteDocs(skill.targetKbId, [entry.docId])',
    /effectiveSyncMode\s*===\s*['"]soft['"][\s\S]{0,1200}?else\s*\{[\s\S]{0,500}?deleteDocs\(\s*skill\.targetKbId\s*,\s*\[\s*entry\.docId\s*\]\s*\)/.test(src))
  assert('hard 分支失败标记「删除旧文档失败：xxx」',
    /删除旧文档失败[：:]/.test(src))
  assert('hard 分支调 uploadAndParse(skill.targetKbId, absPath, resolved)',
    /uploadAndParse\(\s*skill\.targetKbId\s*,\s*absPath\s*,\s*resolved\s*\)/.test(src))

  // 3.11 updateAndParse helper
  assert('KbGuardianService 含 private async updateAndParse helper',
    /private\s+async\s+updateAndParse\s*\(\s*kbId:\s*string,\s*docId:\s*string,\s*absPath:\s*string\s*\)/.test(src))
  const updateAndParseBlock = src.match(/private\s+async\s+updateAndParse[\s\S]{0,500}?\}/)
  if (updateAndParseBlock) {
    const block = updateAndParseBlock[0]
    assert('updateAndParse 调 this.kb.updateDoc(kbId, docId, absPath)',
      /this\.kb\.updateDoc\(\s*kbId\s*,\s*docId\s*,\s*absPath\s*\)/.test(block))
    assert('updateAndParse 调 this.kb.parseDocs(kbId, [docId])',
      /this\.kb\.parseDocs\(\s*kbId\s*,\s*\[\s*docId\s*\]\s*\)/.test(block))
    assert('updateAndParse 调 this.waitParse(kbId, docId)',
      /this\.waitParse\(\s*kbId\s*,\s*docId\s*\)/.test(block))
    assert('updateAndParse 返回 docId', /return\s+docId/.test(block))
  } else {
    assert('updateAndParse 函数体存在（无法定位三步断言）', false)
  }

  // 3.12 uploadAndParse 保留（与 updateAndParse 对照）
  assert('uploadAndParse 保留（基础 hard 路径）',
    /private\s+async\s+uploadAndParse\s*\(\s*kbId:\s*string,\s*absPath:\s*string,\s*category\?:\s*string\s*\)/.test(src))
  assert('uploadAndParse 调 this.kb.uploadDocs + this.kb.parseDocs + this.waitParse',
    /this\.kb\.uploadDocs\(\s*kbId\s*,\s*\[\s*absPath\s*\][\s\S]{0,200}?category\s*\)[\s\S]{0,200}?this\.kb\.parseDocs[\s\S]{0,200}?this\.waitParse/.test(src))
}

// ─── 4. SampleLibraryKbGuardianLauncher 漂移检查 ─────────
const launcherPath = resolve(root, 'src/main/services/SampleLibraryKbGuardianLauncher.ts')
assert('SampleLibraryKbGuardianLauncher.ts 文件存在', existsSync(launcherPath))
if (existsSync(launcherPath)) {
  const src = readFileSync(launcherPath, 'utf-8')
  const lines = src.split('\n').length
  assert('launcher 行数 ≥ 120（I.5 加 syncMode 漂移检查）', lines >= 120, `${lines} 行`)

  // 4.1 expected 显式声明 syncMode: 'soft'
  assert('expected 显式声明 syncMode: \'soft\'',
    /expected:\s*GuardianSkillInput\s*=\s*\{[\s\S]*?syncMode:\s*['"]soft['"]/.test(src))
  assert('syncMode: \'soft\' 字段带 I.5 阶段注释',
    /syncMode:\s*['"]soft['"][\s\S]{0,200}?I\.5/.test(src) || /I\.5[\s\S]{0,500}?syncMode:\s*['"]soft['"]/.test(src))

  // 4.2 字段漂移检查（直接在文件查同步模式比较表达式，不依赖 needs() 函数定义距离）
  assert('needs() 漂移检查加 syncMode 比较',
    /\(existing\.syncMode\s*\?\?\s*['"]soft['"]\)\s*!==\s*\(expected\.syncMode\s*\?\?\s*['"]soft['"]\)/.test(src))

  // 4.3 旧字段保留
  assert('ensure 仍调 ensureAgentKb', /ensureAgentKb\(SAMPLE_LIBRARY_KB_TARGET\.agentKey\)/.test(src))
  assert('ensure 仍按 name 查重', /state\.skills\.find\(skill\s*=>\s*skill\.name\s*===\s*SAMPLE_LIBRARY_KB_GUARDIAN_NAME\)/.test(src))
  assert('ensure 仍包含 sourcePath / targetKbId / frequency / fileExts 漂移检查', /existing\.sourcePath/.test(src) && /existing\.targetKbId/.test(src) && /existing\.frequency/.test(src))
  assert('ensure 字段漂移仍调 updateSkill(existing.id, expected)', /if\s*\(needs\(\)\)[\s\S]{0,500}?updateSkill\(\s*existing\.id\s*,\s*expected\s*\)/.test(src))
}

// ─── 5. UI 渲染（SampleLibrary.tsx） ─────────────────────
const slPath = resolve(root, 'src/renderer/SampleLibrary.tsx')
assert('SampleLibrary.tsx 文件存在', existsSync(slPath))
if (existsSync(slPath)) {
  const src = readFileSync(slPath, 'utf-8')
  const lines = src.split('\n').length
  assert('SampleLibrary.tsx 行数 ≥ 540（基础 510 + I.5 +30）', lines >= 540, `${lines} 行`)

  // 5.1 GuardianStatus 类型加 syncMode
  assert('GuardianStatus present 态加 syncMode 字段',
    /phase:\s*['"]present['"][\s\S]*?skill:\s*\{[\s\S]*?syncMode\?:\s*['"]soft['"]\s*\|\s*['"]hard['"]/.test(src))

  // 5.2 refreshGuardian 写入 syncMode
  assert('refreshGuardian 写入 syncMode 字段（带 ?? soft 兜底）',
    /refreshGuardian[\s\S]{0,2000}?syncMode:\s*\(?[^}]*?\.skill\.syncMode\s*\?\?\s*['"]soft['"]\s*\)?\s*as\s*['"]soft['"]\s*\|\s*['"]hard['"]/.test(src))

  // 5.3 handleToggleSyncMode 回调
  assert('handleToggleSyncMode 回调存在',
    /const\s+handleToggleSyncMode\s*=\s*async/.test(src))
  assert('handleToggleSyncMode 注释带 I.5 阶段说明',
    /handleToggleSyncMode[\s\S]{0,500}?I\.5/.test(src) || /I\.5[\s\S]{0,500}?handleToggleSyncMode/.test(src))

  // 5.4 nextMode 计算
  assert('nextMode = (syncMode ?? soft) === soft ? hard : soft',
    /nextMode:\s*['"]soft['"]\s*\|\s*['"]hard['"]\s*=\s*\(\s*guardian\.skill\.syncMode\s*\?\?\s*['"]soft['"]\s*\)\s*===\s*['"]soft['"]\s*\?\s*['"]hard['"]\s*:\s*['"]soft['"]/.test(src))

  // 5.5 调 window.desktop?.kbGuardian.update（? 为可选链占位符）
  assert('handleToggleSyncMode 调 window.desktop.kbGuardian.update',
    /handleToggleSyncMode[\s\S]{0,2000}?window\.desktop\??\.kbGuardian[\s\S]{0,500}?\.update\(/.test(src))
  assert('handleToggleSyncMode 检查 api?.update 存在',
    /handleToggleSyncMode[\s\S]{0,2000}?api\?\.update/.test(src))

  // 5.6 调 state() 拿全字段
  assert('handleToggleSyncMode 调 state() 拿全字段',
    /handleToggleSyncMode[\s\S]{0,2000}?api\.state\(\)/.test(src))
  assert('handleToggleSyncMode 用 state.skills.find(s => s.id === ...) 取当前',
    /handleToggleSyncMode[\s\S]{0,2000}?state\.skills\.find\(\s*s\s*=>\s*s\.id\s*===\s*guardian\.skill!\.id\s*\)/.test(src))

  // 5.7 update 传 syncMode 字段
  assert('handleToggleSyncMode update 入参含 syncMode: nextMode',
    /handleToggleSyncMode[\s\S]{0,2000}?\.update\([\s\S]{0,1500}?syncMode:\s*nextMode[\s\S]{0,500}?\}\s*\)/.test(src))

  // 5.8 update 入参含 9 个 GuardianSkillInput 字段（name / sourcePath / fileExts / targetKbId / targetKbName / frequency / enabled / category / ensureCategories）
  const updateInputBlock = src.match(/await\s+api\.update\([\s\S]{0,1000}?syncMode:\s*nextMode[\s\S]{0,200}?\}\s*\)/)
  if (updateInputBlock) {
    const block = updateInputBlock[0]
    assert('update 入参含 name 字段', /name:\s*current\.name/.test(block))
    assert('update 入参含 sourcePath 字段', /sourcePath:\s*current\.sourcePath/.test(block))
    assert('update 入参含 fileExts 字段', /fileExts:\s*current\.fileExts/.test(block))
    assert('update 入参含 targetKbId 字段', /targetKbId:\s*current\.targetKbId/.test(block))
    assert('update 入参含 targetKbName 字段', /targetKbName:\s*current\.targetKbName/.test(block))
    assert('update 入参含 frequency 字段', /frequency:\s*current\.frequency/.test(block))
    assert('update 入参含 enabled 字段', /enabled:\s*current\.enabled/.test(block))
    assert('update 入参含 category 字段', /category:\s*current\.category/.test(block))
    assert('update 入参含 ensureCategories 字段', /ensureCategories:\s*current\.ensureCategories/.test(block))
  } else {
    assert('update 入参块存在（无法定位 9 字段断言）', false)
  }

  // 5.9 refreshGuardian 重拉
  assert('handleToggleSyncMode 末尾调 refreshGuardian()',
    /handleToggleSyncMode[\s\S]{0,2000}?syncMode:\s*nextMode[\s\S]{0,500}?await\s+refreshGuardian\(\)/.test(src))

  // 5.10 失败时设 phase: 'error'
  assert('handleToggleSyncMode 失败时设 phase: \'error\' + message',
    /handleToggleSyncMode[\s\S]{0,2000}?catch[\s\S]{0,500}?phase:\s*['"]error['"][\s\S]{0,200}?message:\s*\(err\s+as\s+Error\)\.message/.test(src))

  // 5.11 状态卡渲染 syncMode chip（双态）
  assert('状态卡渲染「🟢 软同步」chip',
    /🟢\s*软同步（保留旧 docId）/.test(src))
  assert('状态卡渲染「🟠 硬同步」chip',
    /🟠\s*硬同步（先删旧再传新）/.test(src))
  assert('状态卡 soft 态用青色 #0d9488',
    /\(\s*guardian\.skill\.syncMode\s*\?\?\s*['"]soft['"]\s*\)\s*===\s*['"]soft['"]\s*\?\s*['"]#0d9488['"]\s*:\s*['"]#b45309['"]/.test(src))
  assert('状态卡 hard 态用橙色 #b45309',
    /['"]#b45309['"]/.test(src))

  // 5.12 状态卡切换按钮
  assert('状态卡渲染 sample-library-guardian-sync-mode-btn 切换按钮',
    /className=\{?[\s\S]*?['"]sample-library-guardian-sync-mode-btn['"]/.test(src))
  assert('切换按钮文案「切到 硬同步」',
    /切到\s*\{\s*\(guardian\.skill\.syncMode\s*\?\?\s*['"]soft['"]\s*\)\s*===\s*['"]soft['"]\s*\?\s*['"]硬同步['"]\s*:\s*['"]软同步['"]\s*\}/.test(src) ||
    /切到\s*硬同步/.test(src))
  assert('切换按钮 title 提示 soft 态（点击切换为硬同步）',
    /title=\{[\s\S]*?点击切换为硬同步[\s\S]{0,500}?点击切换为软同步/.test(src))
  assert('切换按钮 title 提示 hard 态（点击切换为软同步）',
    /点击切换为软同步[\s\S]{0,500}?推荐[\s\S]{0,500}?保留旧 docId[\s\S]{0,500}?RAGFlow\s*update_doc/.test(src))
}

// ─── 6. CSS 样式（sample-library.css） ───────────────────
const cssPath = resolve(root, 'src/renderer/sample-library.css')
assert('sample-library.css 文件存在', existsSync(cssPath))
if (existsSync(cssPath)) {
  const src = readFileSync(cssPath, 'utf-8')
  const lines = src.split('\n').length
  assert('sample-library.css 行数 ≥ 460（基础 440 + I.5 +20）', lines >= 460, `${lines} 行`)

  // 6.1 主类
  assert('CSS 含 .sample-library-guardian-sync-mode-btn 主类',
    /\.sample-library-guardian-sync-mode-btn\s*\{/.test(src))

  // 6.2 紧凑 chip 尺寸（11px + 圆角 999px）
  const btnBlock = src.match(/\.sample-library-guardian-sync-mode-btn\s*\{([\s\S]*?)\}/)
  if (btnBlock) {
    const block = btnBlock[1]
    assert('按钮 11px 字号', /font-size:\s*11px/.test(block))
    assert('按钮 圆角 999px（chip 风格）', /border-radius:\s*999px/.test(block))
    assert('按钮 padding: 2px 8px（紧凑）', /padding:\s*2px\s+8px/.test(block))
  } else {
    assert('同步模式切换按钮主块存在（无法定位尺寸断言）', false)
  }

  // 6.3 青绿系（#0d9488 文字 + #99f6e4 描边）
  assert('按钮文字色 #0d9488', /color:\s*#0d9488/.test(src))
  assert('按钮描边 #99f6e4', /border:\s*1px solid #99f6e4/.test(src))
  assert('按钮底色 rgba(13, 148, 136, 0.08)',
    /background:\s*rgba\(\s*13\s*,\s*148\s*,\s*136\s*,\s*0\.08\s*\)/.test(src))

  // 6.4 hover 反馈
  assert('按钮 hover 反馈（背景 rgba 0.18 + 描边 #14b8a6）',
    /\.sample-library-guardian-sync-mode-btn:hover[\s\S]{0,200}?background:\s*rgba\(\s*13\s*,\s*148\s*,\s*136\s*,\s*0\.18\s*\)[\s\S]{0,200}?border-color:\s*#14b8a6/.test(src))

  // 6.5 active 反馈
  assert('按钮 active 反馈（背景 rgba 0.24）',
    /\.sample-library-guardian-sync-mode-btn:active\s*\{[\s\S]{0,200}?background:\s*rgba\(\s*13\s*,\s*148\s*,\s*136\s*,\s*0\.24\s*\)/.test(src))

  // 6.6 I.5 注释标记
  assert('切换按钮带 I.5 阶段新增注释',
    /I\.5\s*阶段新增[\s\S]{0,200}?sample-library-guardian-sync-mode-btn/.test(src))
}

// ─── 7. 跨阶段双源同步 ────────────────────────────────
{
  // 7.1 共享契约 → 渲染层（kbGuardian 类型从 global.d.ts 间接导入，SampleLibrary.tsx 不直接 import shared/kbGuardian）
  if (existsSync(kbGuardianPath) && existsSync(slPath)) {
    const sharedSrc = readFileSync(kbGuardianPath, 'utf-8')
    const slSrc = readFileSync(slPath, 'utf-8')
    assert('共享契约 GuardianSyncMode 在渲染层有引用（as 转换）',
      /syncMode\s*\?\?\s*['"]soft['"]\s*\)\s*as\s*['"]soft['"]\s*\|\s*['"]hard['"]/.test(slSrc) || /syncMode:\s*\(\s*result\.skill\.syncMode\s*\?\?\s*['"]soft['"]\s*\)\s*as\s*['"]soft['"]\s*\|\s*['"]hard['"]/.test(slSrc))
  }

  // 7.2 共享契约 → 主进程
  if (existsSync(kbGuardianPath) && existsSync(svcPath)) {
    const sharedSrc = readFileSync(kbGuardianPath, 'utf-8')
    const svcSrc = readFileSync(svcPath, 'utf-8')
    assert('主进程 import GuardianSyncMode',
      /import\s+type\s*\{[^}]*GuardianSyncMode[^}]*\}\s*from\s*['"]\.\.\/\.\.\/shared\/kbGuardian['"]/.test(svcSrc))
  }

  // 7.3 RagflowKnowledgeService.updateDoc → KbGuardianService.updateAndParse
  if (existsSync(ragflowPath) && existsSync(svcPath)) {
    const ragSrc = readFileSync(ragflowPath, 'utf-8')
    const svcSrc = readFileSync(svcPath, 'utf-8')
    assert('RagflowKnowledgeService 导出 updateDoc 公共方法', /async\s+updateDoc\s*\(/.test(ragSrc))
    assert('KbGuardianService.updateAndParse 调 this.kb.updateDoc（保持一致）',
      /updateAndParse[\s\S]{0,300}?this\.kb\.updateDoc/.test(svcSrc))
  }

  // 7.4 launcher.expected.syncMode → KbGuardianService 缺省 soft
  if (existsSync(launcherPath) && existsSync(svcPath)) {
    const lchSrc = readFileSync(launcherPath, 'utf-8')
    const svcSrc = readFileSync(svcPath, 'utf-8')
    assert('launcher.expected.syncMode = soft 与 KbGuardianService 缺省值 soft 一致',
      /syncMode:\s*['"]soft['"]/.test(lchSrc) && /syncMode\s*\?\?\s*['"]soft['"]/.test(svcSrc))
  }

  // 7.5 SampleLibrary 切换按钮 ↔ sample-library.css
  if (existsSync(slPath) && existsSync(cssPath)) {
    const slSrc = readFileSync(slPath, 'utf-8')
    const cssSrc = readFileSync(cssPath, 'utf-8')
    assert('SampleLibrary 切换按钮 className ↔ CSS 类名 一致',
      /['"]sample-library-guardian-sync-mode-btn['"]/.test(slSrc) && /\.sample-library-guardian-sync-mode-btn\s*\{/.test(cssSrc))
  }

  // 7.6 global.d.ts kbGuardian.update 类型契约
  const globalDtsPath = resolve(root, 'src/renderer/global.d.ts')
  if (existsSync(globalDtsPath)) {
    const gdSrc = readFileSync(globalDtsPath, 'utf-8')
    assert('global.d.ts kbGuardian.update 接受 GuardianSkillInput（已含 syncMode 字段）',
      /kbGuardian:\s*\{[\s\S]*?update\(\s*id:\s*string,\s*input:\s*GuardianSkillInput\s*\)/.test(gdSrc))
    assert('global.d.ts import GuardianSkillInput from shared/kbGuardian',
      /import\s+type\s*\{[\s\S]*?GuardianSkillInput[\s\S]*?\}\s+from\s*['"]\.\.\/shared\/kbGuardian['"]/.test(gdSrc))
  }
}

// ─── 8. 设计 token / 色彩系统 ─────────────────────────
if (existsSync(cssPath) && existsSync(slPath)) {
  const cssSrc = readFileSync(cssPath, 'utf-8')
  const slSrc = readFileSync(slPath, 'utf-8')

  // 8.1 青绿系三色一致：#0d9488 / #14b8a6 / #99f6e4
  assert('CSS 含青绿系 #0d9488（soft 文字）', /#0d9488/.test(cssSrc))
  assert('CSS 含青绿系 #14b8a6（hover 描边）', /#14b8a6/.test(cssSrc))
  assert('CSS 含青绿系 #99f6e4（描边默认）', /#99f6e4/.test(cssSrc))

  // 8.2 复用 I.2 阶段守卫卡 ok 态色彩（与 .sample-library-guardian-card.ok 同色系）
  const cardOkBlock = cssSrc.match(/\.sample-library-guardian-card\.ok\s*\{([\s\S]*?)\}/)
  if (cardOkBlock) {
    const block = cardOkBlock[1]
    assert('守卫卡 ok 态底色 #f0fdfa + 描边 #99f6e4（与切换按钮描边同色）',
      /background:\s*#f0fdfa/.test(block) && /border:\s*1px solid #99f6e4/.test(block))
  }

  // 8.3 title 提示双态（soft 态 / hard 态）
  assert('title 提示 soft 态包含「I.2 默认行为：先删旧 docId」',
    /点击切换为硬同步[\s\S]{0,500}?I\.2\s*默认行为[\s\S]{0,200}?先删旧\s*docId/.test(slSrc))
  assert('title 提示 hard 态包含「RAGFlow update_doc」+「重解析期间旧 chunk 仍可检索」',
    /点击切换为软同步[\s\S]{0,500}?RAGFlow\s*update_doc[\s\S]{0,200}?重解析期间旧\s*chunk/.test(slSrc))
}

// ─── 9. 文档同步 ──────────────────────────────────────
const docPath = resolve(root, 'docs/选品分析师-报告样例库.md')
assert('docs/选品分析师-报告样例库.md 文件存在', existsSync(docPath))
if (existsSync(docPath)) {
  const src = readFileSync(docPath, 'utf-8')
  const lines = src.split('\n').length
  assert('报告样例库文档行数 ≥ 760（基础 648 + I.5 +152 -40 重复）', lines >= 760, `${lines} 行`)

  // 9.1 I.5 章节标题
  assert('文档含「I.5 阶段：守卫软同步（保留 docId + RAGFlow update_doc）」章节标题',
    /^##\s*I\.5\s*阶段[：:]\s*守卫软同步（保留 docId \+ RAGFlow update_doc）/m.test(src))

  // 9.2 7 个必备小节
  assert('含「入库目标」小节', /### 入库目标/.test(src))
  assert('含「软/硬同步架构图」小节', /###\s*软\/硬同步架构图/.test(src))
  assert('含「桌面入口」小节', /### 桌面入口/.test(src))
  assert('含「同步模式语义」小节', /### 同步模式语义/.test(src))
  assert('含「实现要点」小节', /### 实现要点/.test(src))
  assert('含「跨阶段双源同步」小节（I.5 段内）', /I\.5[\s\S]{0,10000}?### 跨阶段双源同步/.test(src))
  assert('含「验证」小节（含 verify-sample-library-soft-sync.ts 引用）',
    /### 验证[\s\S]{0,1000}?verify-sample-library-soft-sync\.ts/.test(src))

  // 9.3 关键术语
  assert('I.5 章节含「RAGFlow 0.11+」术语', /I\.5[\s\S]{0,10000}?RAGFlow\s*0\.11\+/.test(src))
  assert('I.5 章节含「update_doc」术语', /I\.5[\s\S]{0,10000}?update_doc/.test(src))
  assert('I.5 章节含「保留 docId」术语', /I\.5[\s\S]{0,10000}?保留 docId/.test(src))
  assert('I.5 章节含「updateAndParse」术语', /I\.5[\s\S]{0,10000}?updateAndParse/.test(src))
  assert('I.5 章节含「effectiveSyncMode」术语', /I\.5[\s\S]{0,10000}?effectiveSyncMode/.test(src))
  assert('I.5 章节含「软同步更新失败」术语', /I\.5[\s\S]{0,10000}?软同步更新失败/.test(src))
  assert('I.5 章节含「重解析期间旧 chunk 仍可检索」术语',
    /I\.5[\s\S]{0,10000}?重解析期间旧\s*chunk\s*仍可检索/.test(src))

  // 9.4 软/硬同步对比表（表格里用 `soft` / `hard` 加反引号代表代码标识符）
  assert('I.5 章节含「soft」与「hard」对比表（同一表内含 5 列）',
    /I\.5[\s\S]{0,10000}?\|\s*`?soft`?\s*\|[\s\S]{0,500}?\|\s*`?hard`?\s*\|/.test(src))

  // 9.5 三路分支
  assert('I.5 章节含「soft → updateAndParse」分支描述',
    /I\.5[\s\S]{0,10000}?soft\s*→\s*updateAndParse/.test(src))
  assert('I.5 章节含「hard → deleteDocs + uploadAndParse」分支描述',
    /I\.5[\s\S]{0,10000}?hard\s*→\s*deleteDocs/.test(src))

  // 9.6 7 个源的引用（双源同步表）
  assert('I.5 章节「跨阶段双源同步」含 src/shared/kbGuardian.ts',
    /I\.5[\s\S]{0,10000}?### 跨阶段双源同步[\s\S]{0,500}?src\/shared\/kbGuardian\.ts/.test(src))
  assert('I.5 章节含 src/main/services/RagflowKnowledgeService.ts',
    /I\.5[\s\S]{0,10000}?src\/main\/services\/RagflowKnowledgeService\.ts/.test(src))
  assert('I.5 章节含 src/main/services/KbGuardianService.ts',
    /I\.5[\s\S]{0,10000}?src\/main\/services\/KbGuardianService\.ts/.test(src))
  assert('I.5 章节含 src/main/services/SampleLibraryKbGuardianLauncher.ts',
    /I\.5[\s\S]{0,10000}?src\/main\/services\/SampleLibraryKbGuardianLauncher\.ts/.test(src))
  assert('I.5 章节含 src/renderer/SampleLibrary.tsx',
    /I\.5[\s\S]{0,10000}?src\/renderer\/SampleLibrary\.tsx/.test(src))
  assert('I.5 章节含 src/renderer/sample-library.css',
    /I\.5[\s\S]{0,10000}?src\/renderer\/sample-library\.css/.test(src))

  // 9.7 verify 工具引用
  assert('I.5 章节含 verify 工具名 verify-sample-library-soft-sync.ts',
    /verify-sample-library-soft-sync\.ts/.test(src))

  // 9.8 tsc 章节
  assert('I.5 章节末尾含「tsc + 全量回归」小节', /###\s*tsc\s*\+\s*全量回归/.test(src))
}

// ─── 总结 ────────────────────────────────────────────
console.log('\n────────────────────────────────────────')
console.log(`断言：PASS ${pass}  FAIL ${fail}  总计 ${pass + fail}`)
if (fail === 0) {
  console.log('ALL PASS · I.5 阶段守卫软同步 verify 通过 ✅')
} else {
  console.log(`FAILED：${failures.join('、')}`)
  process.exit(1)
}
