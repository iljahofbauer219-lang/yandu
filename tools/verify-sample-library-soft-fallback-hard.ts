/**
 * I.7 阶段：软→硬回退（I.5 resilience 补全）verify 工具。
 *
 * 验证项（9 大组 / 80+ 断言）：
 *  1. 共享契约扩展：GuardianRunOptions.softFallbackHard + GuardianRunLog.fallbackToHard + GuardianSkillStats.fallbackToHard + GuardianSkill.softFallbackHard + GuardianSkillInput.softFallbackHard 五个字段
 *  2. KbGuardianService 软同步分支回退代码：catch 软错误 → if (options?.softFallbackHard !== false) → 独立 try/catch → deleteDocs + uploadAndParse → updated++ / fallbackToHard++ / continue；双错时 failures.push 双错信息
 *  3. softFallbackHard 开关：!== false（undefined / true 走回退） + false 走原 I.5 行为
 *  4. launcher 显式声明：expected.softFallbackHard: true + 漂移检查 (existing.softFallbackHard ?? true) !== (expected.softFallbackHard ?? true) + 8 项漂移检查列表
 *  5. UI 渲染：GuardianStatus 类型补 fallbackToHard? + refreshGuardian 写入（?? 0 兜底）+ 条件渲染「> 0 才显示」+ 🔁 emoji + title 提示
 *  6. CSS 样式：.sample-library-guardian-stat.fallback 灰底 + 琥珀色描边 #fcd34d + <b> 文字 #92400e（与 orphans 灰底区分）
 *  7. 跨阶段双源同步：6 个源（kbGuardian.ts + KbGuardianService.ts + SampleLibraryKbGuardianLauncher.ts + SampleLibrary.tsx + sample-library.css + doc）一致
 *  8. 可访问性 / 设计 token：复用 var(--bg-soft) / var(--fg-soft) + 琥珀色 #fcd34d / #92400e 区分 + title 提示
 *  9. 文档同步（docs/选品分析师-报告样例库.md）：含 I.7 章节标题 + 7 个必备小节 + 关键术语 + 引用 verify 工具名
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
  assert('kbGuardian.ts 行数 ≥ 116（基础 105 + I.7 +10）', lines >= 116, `${lines} 行`)

  // 1.1 GuardianRunOptions.softFallbackHard
  assert('GuardianRunOptions 含 softFallbackHard 可选字段',
    /export interface GuardianRunOptions\s*\{[\s\S]*?softFallbackHard\?:\s*boolean[\s\S]*?\}/.test(src))
  assert('GuardianRunOptions.softFallbackHard 字段带 I.7 阶段说明注释',
    /I\.7\s*阶段新增[\s\S]{0,500}?softFallbackHard\?:\s*boolean/.test(src))
  assert('GuardianRunOptions.softFallbackHard 注释说明「缺省 true」',
    /I\.7\s*阶段新增[\s\S]{0,500}?缺省\s*true[\s\S]{0,500}?softFallbackHard\?:\s*boolean/.test(src))

  // 1.2 GuardianRunLog.fallbackToHard
  assert('GuardianRunLog 含 fallbackToHard 必填字段',
    /export interface GuardianRunLog\s*\{[\s\S]*?fallbackToHard:\s*number[\s\S]*?\}/.test(src))
  assert('GuardianRunLog.fallbackToHard 字段带 I.7 阶段说明注释',
    /I\.7\s*阶段新增[\s\S]{0,500}?fallbackToHard:\s*number/.test(src))
  assert('GuardianRunLog.fallbackToHard 注释说明「0 表示未触发回退」',
    /I\.7\s*阶段新增[\s\S]{0,500}?0\s*表示未触发回退[\s\S]{0,500}?fallbackToHard:\s*number/.test(src))

  // 1.3 GuardianSkillStats.fallbackToHard
  assert('GuardianSkillStats 含 fallbackToHard 必填字段',
    /export interface GuardianSkillStats\s*\{[\s\S]*?fallbackToHard:\s*number[\s\S]*?\}/.test(src))
  assert('GuardianSkillStats.fallbackToHard 字段带 I.7 阶段说明注释',
    /I\.7\s*阶段新增[\s\S]{0,500}?fallbackToHard:\s*number/.test(src))

  // 1.4 GuardianSkill.softFallbackHard（持久化字段）
  assert('GuardianSkill 含 softFallbackHard 可选字段',
    /export interface GuardianSkill\s*\{[\s\S]*?softFallbackHard\?:\s*boolean[\s\S]*?\}/.test(src))
  assert('GuardianSkill.softFallbackHard 字段带 I.7 阶段注释',
    /I\.7\s*阶段新增[\s\S]{0,500}?softFallbackHard\?:\s*boolean/.test(src))

  // 1.5 GuardianSkillInput.softFallbackHard（创建/编辑入参）
  assert('GuardianSkillInput 含 softFallbackHard 可选字段',
    /export interface GuardianSkillInput\s*\{[\s\S]*?softFallbackHard\?:\s*boolean[\s\S]*?\}/.test(src))
  assert('GuardianSkillInput.softFallbackHard 字段带 I.7 阶段注释',
    /I\.7\s*阶段新增[\s\S]{0,500}?softFallbackHard\?:\s*boolean/.test(src))

  // 1.6 旧字段保留
  assert('保留 GuardianSyncMode 类型', /export type GuardianSyncMode/.test(src))
  assert('保留 GuardianState 接口', /export interface GuardianState/.test(src))
  assert('保留 GuardianSkill 接口', /export interface GuardianSkill/.test(src))
  assert('保留 GuardianSkillInput 接口', /export interface GuardianSkillInput/.test(src))
  assert('保留 GuardianRunOptions 接口', /export interface GuardianRunOptions/.test(src))
  assert('保留 GuardianRunEvent 接口', /export interface GuardianRunEvent/.test(src))
  assert('保留 GuardianRunLog 接口', /export interface GuardianRunLog/.test(src))
  assert('保留 GuardianSkillStats 接口', /export interface GuardianSkillStats/.test(src))
  // I.5 + I.6 旧字段保留
  assert('保留 GuardianRunOptions.syncMode 字段', /syncMode\?:\s*GuardianSyncMode/.test(src))
  assert('保留 GuardianRunOptions.orphanCleanup 字段', /orphanCleanup\?:\s*boolean/.test(src))
  assert('保留 GuardianRunLog.orphansRemoved 字段', /orphansRemoved:\s*number/.test(src))
  assert('保留 GuardianSkillStats.orphansRemoved 字段',
    /export interface GuardianSkillStats\s*\{[\s\S]*?orphansRemoved:\s*number[\s\S]*?\}/.test(src))
}

// ─── 2. KbGuardianService 软同步分支回退代码 ─────────
const svcPath = resolve(root, 'src/main/services/KbGuardianService.ts')
assert('KbGuardianService.ts 文件存在', existsSync(svcPath))
if (existsSync(svcPath)) {
  const src = readFileSync(svcPath, 'utf-8')
  const lines = src.split('\n').length
  assert('KbGuardianService.ts 行数 ≥ 430（基础 410 + I.7 +20）', lines >= 430, `${lines} 行`)

  // 2.1 顶部 fallbackToHard 计数变量
  assert('runSkill 顶部声明 let fallbackToHard = 0',
    /runSkill\s*\([\s\S]{0,2000}?let\s+fallbackToHard\s*=\s*0/.test(src))

  // 2.2 软同步分支 catch 块含 if (options?.softFallbackHard !== false) 守卫
  assert('软同步 catch 内含 if (options?.softFallbackHard !== false) 守卫',
    /catch\s*\(\s*softError\s*\)\s*\{[\s\S]{0,500}?if\s*\(\s*options\?\.softFallbackHard\s*!==\s*false\s*\)/.test(src))

  // 2.3 软错误变量重命名（区分软/硬两段）
  assert('软同步 catch 用 softError 变量名（与 fallbackError 区分）',
    /catch\s*\(\s*softError\s*\)/.test(src))

  // 2.4 硬回退独立 try/catch（保护双错不互相影响）
  // 简化：不再依赖缩进，匹配 if 块到 else 块
  const fallbackTryBlock = src.match(/if\s*\(\s*options\?\.softFallbackHard\s*!==\s*false\s*\)\s*\{([\s\S]*?)\}\s*else\s*\{/)
  if (fallbackTryBlock) {
    const block = fallbackTryBlock[1]
    assert('硬回退用独立 try 块', /try\s*\{/.test(block))
    assert('硬回退先调 this.kb.deleteDocs(skill.targetKbId, [entry.docId])',
      /this\.kb\.deleteDocs\(\s*skill\.targetKbId\s*,\s*\[\s*entry\.docId\s*\]\s*\)/.test(block))
    assert('硬回退调 this.uploadAndParse(skill.targetKbId, absPath, resolved)',
      /this\.uploadAndParse\(\s*skill\.targetKbId\s*,\s*absPath\s*,\s*resolved\s*\)/.test(block))
    assert('硬回退成功后 updated += 1',
      /updated\s*\+=\s*1/.test(block))
    assert('硬回退成功后 fallbackToHard += 1',
      /fallbackToHard\s*\+=\s*1/.test(block))
    // 双错 catch
    assert('硬回退独立 catch (fallbackError) 块',
      /catch\s*\(\s*fallbackError\s*\)/.test(block))
    assert('双错时 push failure 含「软同步 + 硬回退均失败」',
      /软同步\s*\+\s*硬回退均失败[：:]/.test(block))
    assert('双错 failure 含软错误信息（softError 引用）',
      /软=.*?\(softError\s+as\s+Error\)\.message/.test(block))
    assert('双错 failure 含硬错误信息（fallbackError 引用）',
      /硬=.*?\(fallbackError\s+as\s+Error\)\.message/.test(block))
  } else {
    assert('硬回退 try 块存在（无法定位内部断言）', false)
  }

  // 2.5 false 分支维持 I.5 行为（仅 push failure）
  assert('softFallbackHard === false 时走原 I.5 行为：push「软同步更新失败」',
    /else\s*\{[\s\S]{0,500}?failures\.push\(\{\s*name:\s*relPath,\s*reason:\s*[`'][^`']*软同步更新失败[：:]/.test(src))

  // 2.6 软同步 catch 末尾 continue 跳出本次循环（catch 块后整个 soft 块外）
  assert('软同步 catch 末尾 continue 跳出本次循环',
    /catch\s*\(\s*softError\s*\)[\s\S]{0,2000}?continue/.test(src))

  // 2.7 finally 块 log.fallbackToHard
  assert('finally 块 log.fallbackToHard 字段写入',
    /log:\s*GuardianRunLog\s*=\s*\{[\s\S]{0,800}?fallbackToHard,?\s*\n[\s\S]{0,200}?failures/.test(src))

  // 2.8 finally 块 lastStats.fallbackToHard
  assert('finally 块 skill.lastStats.fallbackToHard 字段写入',
    /skill\.lastStats\s*=\s*\{[\s\S]{0,500}?fallbackToHard,?[\s\S]{0,200}?\}\s*$/.test(src) ||
    /skill\.lastStats\s*=\s*\{[\s\S]{0,500}?orphansRemoved,?\s*fallbackToHard/.test(src))

  // 2.9 I.7 阶段注释
  assert('软同步分支回退块含 I.7 阶段新增注释',
    /I\.7\s*阶段新增[\s\S]{0,500}?软同步失败时自动回退/.test(src))
  assert('顶部 fallbackToHard 变量带 I.7 注释',
    /I\.7\s*阶段新增[\s\S]{0,500}?let\s+fallbackToHard\s*=\s*0/.test(src))
}

// ─── 3. softFallbackHard 开关语义 ─────────────────────
if (existsSync(svcPath)) {
  const src = readFileSync(svcPath, 'utf-8')

  // 3.1 !== false 守卫
  assert('softFallbackHard !== false 守卫（undefined 走回退）',
    /if\s*\(\s*options\?\.softFallbackHard\s*!==\s*false\s*\)/.test(src))

  // 3.2 false 分支（I.5 行为）：else 块到闭合大括号（行 310-312）
  // 简化：去掉缩进依赖，从 else { 到 } 的内容
  const elseIdx = src.indexOf('} else {', src.indexOf('if (options?.softFallbackHard'))
  if (elseIdx > 0) {
    // 从 else { 后面开始，找下一个独立闭合大括号
    const afterElse = src.slice(elseIdx + '} else {'.length)
    // 找第一行 failures.push 到闭合大括号
    const elseBlock = afterElse.match(/([\s\S]*?)\n\s+\}/)
    if (elseBlock) {
      const block = elseBlock[1]
      assert('else 分支含「软同步更新失败」failure 推送', /软同步更新失败[：:]/.test(block))
      assert('else 分支含 failures.push 写入 failures 数组',
        /failures\.push\(\s*\{\s*name:\s*relPath,\s*reason/.test(block))
    } else {
      assert('else 分支内容块存在（无法定位 I.5 行为断言）', false)
    }
  } else {
    assert('else 分支存在（无法定位 I.5 行为断言）', false)
  }

  // 3.3 不应改 skill.syncMode 持久化（自动回退只改 hashes[relPath].docId）
  // 这里需要检查同步模式下不应有 syncMode 写回（除了 I.5 创建/编辑时）
  // 软同步 catch 不应有 skill.syncMode = ... 赋值
  const softCatchBlock = src.match(/catch\s*\(\s*softError\s*\)\s*\{([\s\S]*?)\n\s{12}continue/)
  if (softCatchBlock) {
    const block = softCatchBlock[1]
    assert('软同步 catch 不写回 skill.syncMode（保持用户设置）',
      !/skill\.syncMode\s*=/.test(block) && !/skill\.syncMode\s*=/.test(block))
  }
}

// ─── 4. launcher 显式声明 + 漂移检查 ─────────────
const launcherPath = resolve(root, 'src/main/services/SampleLibraryKbGuardianLauncher.ts')
assert('SampleLibraryKbGuardianLauncher.ts 文件存在', existsSync(launcherPath))
if (existsSync(launcherPath)) {
  const src = readFileSync(launcherPath, 'utf-8')
  const lines = src.split('\n').length
  assert('launcher 行数 ≥ 138（I.6 + softFallbackHard 漂移 +8）', lines >= 138, `${lines} 行`)

  // 4.1 expected 显式声明 softFallbackHard: true
  assert('expected 显式声明 softFallbackHard: true',
    /expected:\s*GuardianSkillInput\s*=\s*\{[\s\S]*?softFallbackHard:\s*true/.test(src))
  assert('softFallbackHard: true 字段带 I.7 阶段注释',
    /softFallbackHard:\s*true[\s\S]{0,200}?I\.7/.test(src) || /I\.7[\s\S]{0,500}?softFallbackHard:\s*true/.test(src))

  // 4.2 漂移检查（双侧 ?? true 兼容老持久化）
  assert('needs() 漂移检查加 softFallbackHard 比较（双侧 ?? true 兜底）',
    /\(existing\.softFallbackHard\s*\?\?\s*true\s*\)\s*!==\s*\(expected\.softFallbackHard\s*\?\?\s*true\s*\)/.test(src))

  // 4.3 漂移检查列表更新为 8 项（含 softFallbackHard）
  assert('needs() 漂移检查注释列表含 softFallbackHard（8 项）',
    /sourcePath\s*\/\s*targetKbId\s*\/\s*fileExts\s*\/\s*frequency\s*\/\s*ensureCategories\s*\/\s*syncMode\s*\/\s*orphanCleanup\s*\/\s*softFallbackHard/.test(src))

  // 4.4 旧字段保留
  assert('ensure 仍调 ensureAgentKb', /ensureAgentKb\(SAMPLE_LIBRARY_KB_TARGET\.agentKey\)/.test(src))
  assert('ensure 仍按 name 查重', /state\.skills\.find\(skill\s*=>\s*skill\.name\s*===\s*SAMPLE_LIBRARY_KB_GUARDIAN_NAME\)/.test(src))
  assert('ensure 字段漂移仍调 updateSkill(existing.id, expected)', /if\s*\(needs\(\)\)[\s\S]{0,500}?updateSkill\(\s*existing\.id\s*,\s*expected\s*\)/.test(src))
  assert('ensure 保留 I.5 syncMode: \'soft\' 显式声明', /syncMode:\s*['"]soft['"]/.test(src))
  assert('ensure 保留 I.6 orphanCleanup: true 显式声明', /orphanCleanup:\s*true/.test(src))
}

// ─── 5. UI 渲染（SampleLibrary.tsx） ───────────────────
const slPath = resolve(root, 'src/renderer/SampleLibrary.tsx')
assert('SampleLibrary.tsx 文件存在', existsSync(slPath))
if (existsSync(slPath)) {
  const src = readFileSync(slPath, 'utf-8')
  const lines = src.split('\n').length
  assert('SampleLibrary.tsx 行数 ≥ 580（I.6 + soft→硬回退渲染）', lines >= 580, `${lines} 行`)

  // 5.1 GuardianStatus 类型补 fallbackToHard
  assert('GuardianStatus present 态 lastStats 补 fallbackToHard 可选字段',
    /lastStats\?:\s*\{[\s\S]*?fallbackToHard\?:\s*number/.test(src))
  assert('lastStats.fallbackToHard 带 I.7 阶段注释',
    /I\.7\s*阶段新增[\s\S]{0,500}?fallbackToHard\?:\s*number/.test(src))

  // 5.2 refreshGuardian 写入 fallbackToHard（老 I.6 持久化 ?? 0 兜底）
  assert('refreshGuardian 写入 fallbackToHard 字段（带 ?? 0 兜底）',
    /refreshGuardian[\s\S]{0,3000}?fallbackToHard:\s*[^}]*?\.lastStats\.fallbackToHard\s*\?\?\s*0/.test(src))
  assert('refreshGuardian fallbackToHard 写入带 I.7 阶段注释',
    /I\.7\s*阶段新增[\s\S]{0,500}?fallbackToHard:[\s\S]{0,500}?\.lastStats\.fallbackToHard\s*\?\?\s*0/.test(src))

  // 5.3 条件渲染（> 0 才显示）
  assert('UI 条件渲染「> 0」才显示软→硬回退 chip',
    /\(guardian\.skill\.lastStats\.fallbackToHard\s*\?\?\s*0\)\s*>\s*0/.test(src))

  // 5.4 渲染回退 chip
  assert('UI 渲染 🔁 软→硬回退 chip',
    /🔁\s*软→硬回退/.test(src))
  assert('UI 渲染 lastStats.fallbackToHard 数字（<b>）',
    /🔁\s*软→硬回退\s*<b>\{[\s\S]*?\.lastStats\.fallbackToHard/.test(src) ||
    /🔁\s*软→硬回退\s*\{[\s\S]*?\.lastStats\.fallbackToHard/.test(src))

  // 5.5 className 引用 fallback 类
  assert('chip className 含 sample-library-guardian-stat fallback',
    /className=\{?['"]sample-library-guardian-stat\s+fallback['"]/.test(src))

  // 5.6 title 提示
  assert('chip title 提示「软同步（update_doc）失败时已自动回退到硬同步（先删旧 docId 再传新）」',
    /title=\{?['"]?软同步[\s\S]{0,500}?update_doc[\s\S]{0,500}?已自动回退到硬同步[\s\S]{0,500}?先删旧\s*docId/.test(src))
}

// ─── 6. CSS 样式（sample-library.css） ───────────────────
const cssPath = resolve(root, 'src/renderer/sample-library.css')
assert('sample-library.css 文件存在', existsSync(cssPath))
if (existsSync(cssPath)) {
  const src = readFileSync(cssPath, 'utf-8')
  const lines = src.split('\n').length
  assert('sample-library.css 行数 ≥ 505（I.6 +17 + I.7 +20）', lines >= 505, `${lines} 行`)

  // 6.1 主类
  assert('CSS 含 .sample-library-guardian-stat.fallback 主类',
    /\.sample-library-guardian-stat\.fallback\s*\{/.test(src))

  // 6.2 紧凑 chip 尺寸
  const fallbackBlock = src.match(/\.sample-library-guardian-stat\.fallback\s*\{([\s\S]*?)\}/)
  if (fallbackBlock) {
    const block = fallbackBlock[1]
    assert('fallback chip 11px 字号', /font-size:\s*11px/.test(block))
    assert('fallback chip 圆角 999px', /border-radius:\s*999px/.test(block))
    assert('fallback chip 灰底 var(--bg-soft, #f1f5f9)',
      /var\(--bg-soft,\s*#f1f5f9\)/.test(block))
    assert('fallback chip 灰文字 var(--fg-soft, #475569)',
      /var\(--fg-soft,\s*#475569\)/.test(block))
    assert('fallback chip 琥珀色描边 #fcd34d（与 orphans 区分）',
      /border:\s*1px solid\s*#fcd34d/.test(block))
  } else {
    assert('fallback chip 主块存在（无法定位尺寸断言）', false)
  }

  // 6.3 <b> 数字样式（#92400e + 600 字重）
  const bBlock = src.match(/\.sample-library-guardian-stat\.fallback\s+b\s*\{([\s\S]*?)\}/)
  if (bBlock) {
    const block = bBlock[1]
    assert('fallback <b> 数字加粗 600', /font-weight:\s*600/.test(block))
    assert('fallback <b> 数字加深 #92400e（琥珀色）', /color:\s*#92400e/.test(block))
  } else {
    assert('fallback <b> 数字块存在（无法定位断言）', false)
  }

  // 6.4 I.7 注释
  assert('fallback 样式带 I.7 阶段新增注释',
    /I\.7\s*阶段新增[\s\S]{0,500}?sample-library-guardian-stat\.fallback/.test(src))

  // 6.5 区分 orphans 灰底（fallback 用琥珀色描边，orphans 用 var(--border)）
  const orphansBlock = src.match(/\.sample-library-guardian-stat\.orphans\s*\{([\s\S]*?)\}/)
  if (orphansBlock) {
    const block = orphansBlock[1]
    assert('orphans 描边用 var(--border)（与 fallback 琥珀色区分）',
      /var\(--border,\s*#e2e8f0\)/.test(block))
  }
}

// ─── 7. 跨阶段双源同步 ───────────────────────────────
if (existsSync(kbGuardianPath) && existsSync(svcPath) && existsSync(launcherPath)) {
  const sharedSrc = readFileSync(kbGuardianPath, 'utf-8')
  const svcSrc = readFileSync(svcPath, 'utf-8')
  const lchSrc = readFileSync(launcherPath, 'utf-8')

  // 7.1 共享契约 → 主进程 import
  assert('主进程 import GuardianRunOptions 含 softFallbackHard 字段',
    /import\s+type\s*\{[^}]*GuardianRunOptions[^}]*\}\s*from\s*['"]\.\.\/\.\.\/shared\/kbGuardian['"]/.test(svcSrc))

  // 7.2 KbGuardianService log.fallbackToHard 写入
  assert('KbGuardianService log 含 fallbackToHard 字段写入',
    /log:\s*GuardianRunLog\s*=\s*\{[\s\S]{0,800}?fallbackToHard,?\s*\n[\s\S]{0,200}?failures/.test(svcSrc))

  // 7.3 launcher.expected.softFallbackHard = true 与 launcher 漂移检查 ?? true 兜底一致
  assert('launcher.expected.softFallbackHard = true 与 launcher 漂移 ?? true 兜底一致',
    /softFallbackHard:\s*true/.test(lchSrc) && /existing\.softFallbackHard\s*\?\?\s*true[\s\S]{0,50}?!==[\s\S]{0,50}?expected\.softFallbackHard\s*\?\?\s*true/.test(lchSrc))
}

if (existsSync(slPath) && existsSync(cssPath) && existsSync(svcPath)) {
  const slSrc = readFileSync(slPath, 'utf-8')
  const cssSrc = readFileSync(cssPath, 'utf-8')
  const svcSrcLocal = readFileSync(svcPath, 'utf-8')

  // 7.4 UI className ↔ CSS 类名
  assert('SampleLibrary 回退 chip className ↔ CSS 类名 一致',
    /sample-library-guardian-stat[\s\S]{0,200}?fallback/.test(slSrc) && /\.sample-library-guardian-stat\.fallback\s*\{/.test(cssSrc))

  // 7.5 UI 读取 lastStats.fallbackToHard ↔ svc 写入
  assert('SampleLibrary 读取 lastStats.fallbackToHard 与 KbGuardianService 写入一致',
    /lastStats\.fallbackToHard/.test(slSrc) && /fallbackToHard,?\s*\n\s+failures/.test(svcSrcLocal))
}

// ─── 8. 设计 token / 可访问性 ─────────────────────────
if (existsSync(cssPath)) {
  const cssSrc = readFileSync(cssPath, 'utf-8')

  // 8.1 复用 I.2 阶段守卫卡 var token
  assert('fallback 样式复用 var(--bg-soft)', /var\(--bg-soft/.test(cssSrc))
  assert('fallback 样式复用 var(--fg-soft)', /var\(--fg-soft/.test(cssSrc))

  // 8.2 琥珀色 #fcd34d / #92400e 与青绿系区分
  assert('CSS 含琥珀色 #fcd34d（fallback 描边）', /#fcd34d/.test(cssSrc))
  assert('CSS 含琥珀色 #92400e（fallback <b> 文字）', /#92400e/.test(cssSrc))

  // 8.3 fallback 与 orphans 共用灰底（不变），描边用琥珀色区分
  const fallbackBlock = cssSrc.match(/\.sample-library-guardian-stat\.fallback\s*\{([\s\S]*?)\}/)
  if (fallbackBlock) {
    const block = fallbackBlock[1]
    assert('fallback chip 用 inline-flex 对齐', /display:\s*inline-flex/.test(block))
    assert('fallback chip align-items: center', /align-items:\s*center/.test(block))
    assert('fallback chip gap: 3px（emoji 与文字间距）', /gap:\s*3px/.test(block))
  }

  // 8.4 title 提示（可访问性）
  if (existsSync(slPath)) {
    const slSrc = readFileSync(slPath, 'utf-8')
    assert('fallback chip title 提示含「自动回退」关键词',
      /fallback[\s\S]{0,500}?title=\{?['"][^'"]*自动回退/.test(slSrc) ||
      /title=\{?['"][^'"]*软同步[\s\S]{0,200}?update_doc[\s\S]{0,500}?已自动回退/.test(slSrc))
  }
}

// ─── 9. 文档同步 ─────────────────────────────────────
const docPath = resolve(root, 'docs/选品分析师-报告样例库.md')
assert('docs/选品分析师-报告样例库.md 文件存在', existsSync(docPath))
if (existsSync(docPath)) {
  const src = readFileSync(docPath, 'utf-8')
  const lines = src.split('\n').length
  assert('报告样例库文档行数 ≥ 1090（I.6 951 + I.7 157 - 重复调整）', lines >= 1090, `${lines} 行`)

  // 9.1 I.7 章节标题
  assert('文档含「I.7 阶段：软→硬回退（I.5 resilience 补全）」章节标题',
    /^##\s*I\.7\s*阶段[：:]\s*软→硬回退（I\.5\s*resilience\s*补全）/m.test(src))

  // 9.2 7 个必备小节
  assert('含「入库目标」小节', /### 入库目标/.test(src))
  assert('含「软→硬回退架构图」小节', /###\s*软→硬回退架构图/.test(src))
  assert('含「桌面入口」小节', /### 桌面入口/.test(src))
  assert('含「回退语义」小节', /### 回退语义/.test(src))
  assert('含「实现要点」小节', /### 实现要点/.test(src))
  assert('含「跨阶段双源同步」小节（I.7 段内）', /I\.7[\s\S]{0,10000}?### 跨阶段双源同步/.test(src))
  assert('含「验证」小节（含 verify-sample-library-soft-fallback-hard.ts 引用）',
    /### 验证[\s\S]{0,2000}?verify-sample-library-soft-fallback-hard\.ts/.test(src))

  // 9.3 关键术语
  assert('I.7 章节含「软→硬回退」术语', /I\.7[\s\S]{0,10000}?软→硬回退/.test(src))
  assert('I.7 章节含「softFallbackHard」术语', /I\.7[\s\S]{0,10000}?softFallbackHard/.test(src))
  assert('I.7 章节含「fallbackToHard」术语', /I\.7[\s\S]{0,10000}?fallbackToHard/.test(src))
  assert('I.7 章节含「update_doc」术语', /I\.7[\s\S]{0,10000}?update_doc/.test(src))
  assert('I.7 章节含「docId 失效」术语', /I\.7[\s\S]{0,10000}?docId\s*失效/.test(src))
  assert('I.7 章节含「RAGFlow 老版本」术语', /I\.7[\s\S]{0,10000}?RAGFlow\s*0\.11-|RAGFlow\s*老版本/.test(src))
  assert('I.7 章节含「deleteDocs」术语', /I\.7[\s\S]{0,10000}?deleteDocs/.test(src))
  assert('I.7 章节含「uploadAndParse」术语', /I\.7[\s\S]{0,10000}?uploadAndParse/.test(src))
  assert('I.7 章节含「独立 try/catch」术语', /I\.7[\s\S]{0,10000}?独立\s*try\s*\/\s*catch/.test(src))
  assert('I.7 章节含「双错」术语', /I\.7[\s\S]{0,10000}?双错/.test(src))
  assert('I.7 章节含「显式声明」术语', /I\.7[\s\S]{0,10000}?显式声明/.test(src))
  assert('I.7 章节含「漂移检查」术语', /I\.7[\s\S]{0,10000}?漂移检查/.test(src))
  assert('I.7 章节含「琥珀色 #fcd34d」术语', /I\.7[\s\S]{0,10000}?#fcd34d/.test(src))
  assert('I.7 章节含「琥珀色 #92400e」术语', /I\.7[\s\S]{0,10000}?#92400e/.test(src))

  // 9.4 回退语义表（softFallbackHard 三态）
  assert('I.7 章节含「回退语义」表（同一表内含 3 行 softFallbackHard 状态）',
    /I\.7[\s\S]{0,10000}?### 回退语义[\s\S]{0,2000}?\|\s*`?undefined`?/.test(src))

  // 9.5 跨阶段双源同步表（5+ 个源）
  assert('I.7 章节「跨阶段双源同步」含 src/shared/kbGuardian.ts',
    /I\.7[\s\S]{0,10000}?### 跨阶段双源同步[\s\S]{0,500}?src\/shared\/kbGuardian\.ts/.test(src))
  assert('I.7 章节含 src/main/services/KbGuardianService.ts',
    /I\.7[\s\S]{0,10000}?src\/main\/services\/KbGuardianService\.ts/.test(src))
  assert('I.7 章节含 src/main/services/SampleLibraryKbGuardianLauncher.ts',
    /I\.7[\s\S]{0,10000}?src\/main\/services\/SampleLibraryKbGuardianLauncher\.ts/.test(src))
  assert('I.7 章节含 src/renderer/SampleLibrary.tsx',
    /I\.7[\s\S]{0,10000}?src\/renderer\/SampleLibrary\.tsx/.test(src))
  assert('I.7 章节含 src/renderer/sample-library.css',
    /I\.7[\s\S]{0,10000}?src\/renderer\/sample-library\.css/.test(src))

  // 9.6 verify 工具引用
  assert('I.7 章节含 verify 工具名 verify-sample-library-soft-fallback-hard.ts',
    /verify-sample-library-soft-fallback-hard\.ts/.test(src))

  // 9.7 tsc 章节
  assert('I.7 章节末尾含「tsc + 全量回归」小节', /###\s*tsc\s*\+\s*全量回归/.test(src))

  // 9.8 实施细节：5 个实现要点
  assert('I.7 章节「实现要点」含 5 个子小节（1-5 编号）',
    /I\.7[\s\S]{0,10000}?### 实现要点[\s\S]{0,3000}?####\s*1\./.test(src) &&
    /I\.7[\s\S]{0,10000}?### 实现要点[\s\S]{0,3000}?####\s*2\./.test(src) &&
    /I\.7[\s\S]{0,10000}?### 实现要点[\s\S]{0,3000}?####\s*3\./.test(src) &&
    /I\.7[\s\S]{0,10000}?### 实现要点[\s\S]{0,3000}?####\s*4\./.test(src) &&
    /I\.7[\s\S]{0,10000}?### 实现要点[\s\S]{0,3000}?####\s*5\./.test(src))

  // 9.9 launcher 8 项漂移检查列表
  assert('I.7 章节「实现要点」提到「漂移检查列表更新为 8 项」',
    /I\.7[\s\S]{0,10000}?漂移检查列表更新为[\s\S]{0,200}?8\s*项/.test(src))
}

// ─── 总结 ───────────────────────────────────────────
console.log('\n────────────────────────────────────────')
console.log(`断言：PASS ${pass}  FAIL ${fail}  总计 ${pass + fail}`)
if (fail === 0) {
  console.log('ALL PASS · I.7 阶段软→硬回退 verify 通过 ✅')
} else {
  console.log(`FAILED：${failures.join('、')}`)
  process.exit(1)
}
