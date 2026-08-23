/**
 * I.6 阶段：守卫孤儿文档清理 verify 工具。
 *
 * 验证项（9 大组 / 80+ 断言）：
 *  1. 共享契约扩展：GuardianRunOptions.orphanCleanup 可选字段 + GuardianRunLog.orphansRemoved + GuardianSkillStats.orphansRemoved 必填字段
 *  2. KbGuardianService 孤儿扫描代码：if (options?.orphanCleanup !== false) 守卫 + Object.keys(hashes) diff + new Set(files) + filter + deleteDocs + delete hashes[relPath] + 统计
 *  3. orphanCleanup 开关语义：!== false（undefined / true 走清理） + false 整段跳过
 *  4. launcher 显式声明：expected.orphanCleanup: true + 漂移检查 (existing.orphanCleanup ?? true) !== (expected.orphanCleanup ?? true)
 *  5. UI 渲染：GuardianStatus 类型补 orphansRemoved? + refreshGuardian 写入 + 条件渲染「> 0 才显示」+ emoji + title
 *  6. CSS 样式：.sample-library-guardian-stat.orphans 灰底 chip + 复用 var(--bg-soft) / var(--fg-soft) / var(--border) + 圆角 999px + 11px
 *  7. 跨阶段双源同步：6 个源（kbGuardian.ts + KbGuardianService.ts + SampleLibraryKbGuardianLauncher.ts + SampleLibrary.tsx + sample-library.css + doc）一致
 *  8. 设计 token / 可访问性：title 提示 + 复用 I.2 守卫卡 var token + 灰底不抢眼
 *  9. 文档同步（docs/选品分析师-报告样例库.md）：含 I.6 章节标题 + 7 个必备小节 + 关键术语 + 引用 verify 工具名
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
  assert('kbGuardian.ts 行数 ≥ 105（基础 90 + I.5 +5 + I.6 +10）', lines >= 105, `${lines} 行`)

  // 1.1 GuardianRunOptions.orphanCleanup
  assert('GuardianRunOptions 含 orphanCleanup 可选字段',
    /export interface GuardianRunOptions\s*\{[\s\S]*?orphanCleanup\?:\s*boolean[\s\S]*?\}/.test(src))
  assert('GuardianRunOptions.orphanCleanup 字段带 I.6 阶段说明注释',
    /I\.6\s*阶段新增[\s\S]{0,500}?orphanCleanup\?:\s*boolean/.test(src))
  assert('GuardianRunOptions.orphanCleanup 注释说明「缺省 true」（注释在字段上方）',
    /I\.6\s*阶段新增[\s\S]{0,500}?缺省\s*true[\s\S]{0,500}?orphanCleanup\?:\s*boolean/.test(src))

  // 1.2 GuardianRunLog.orphansRemoved
  assert('GuardianRunLog 含 orphansRemoved 必填字段',
    /export interface GuardianRunLog\s*\{[\s\S]*?orphansRemoved:\s*number[\s\S]*?\}/.test(src))
  assert('GuardianRunLog.orphansRemoved 字段带 I.6 阶段说明注释',
    /I\.6\s*阶段新增[\s\S]{0,500}?orphansRemoved:\s*number/.test(src))
  assert('GuardianRunLog.orphansRemoved 注释说明「0 表示无孤儿」（注释在字段上方）',
    /I\.6\s*阶段新增[\s\S]{0,500}?0\s*表示无孤儿[\s\S]{0,500}?orphansRemoved:\s*number/.test(src))

  // 1.3 GuardianSkillStats.orphansRemoved
  assert('GuardianSkillStats 含 orphansRemoved 必填字段',
    /export interface GuardianSkillStats\s*\{[\s\S]*?orphansRemoved:\s*number[\s\S]*?\}/.test(src))
  assert('GuardianSkillStats.orphansRemoved 字段带 I.6 阶段说明注释',
    /I\.6\s*阶段新增[\s\S]{0,500}?orphansRemoved:\s*number/.test(src))

  // 1.4 必填字段顺序：orphansRemoved 与 added/updated/skipped/failed 并列
  const statsBlock = src.match(/export interface GuardianSkillStats\s*\{([\s\S]*?)\}/)
  if (statsBlock) {
    const block = statsBlock[1]
    assert('GuardianSkillStats 含 added 字段', /added:\s*number/.test(block))
    assert('GuardianSkillStats 含 updated 字段', /updated:\s*number/.test(block))
    assert('GuardianSkillStats 含 skipped 字段', /skipped:\s*number/.test(block))
    assert('GuardianSkillStats 含 failed 字段', /failed:\s*number/.test(block))
  }

  // 1.5 旧字段保留
  assert('保留 GuardianSyncMode 类型', /export type GuardianSyncMode/.test(src))
  assert('保留 GuardianState 接口', /export interface GuardianState/.test(src))
  assert('保留 GuardianSkill 接口', /export interface GuardianSkill/.test(src))
  assert('保留 GuardianSkillInput 接口', /export interface GuardianSkillInput/.test(src))
  assert('保留 GuardianRunOptions 接口', /export interface GuardianRunOptions/.test(src))
  assert('保留 GuardianRunEvent 接口', /export interface GuardianRunEvent/.test(src))
  assert('保留 GuardianRunLog 接口', /export interface GuardianRunLog/.test(src))
  assert('保留 GuardianSkillStats 接口', /export interface GuardianSkillStats/.test(src))
}

// ─── 2. KbGuardianService 孤儿扫描代码 ───────────────────
const svcPath = resolve(root, 'src/main/services/KbGuardianService.ts')
assert('KbGuardianService.ts 文件存在', existsSync(svcPath))
if (existsSync(svcPath)) {
  const src = readFileSync(svcPath, 'utf-8')
  const lines = src.split('\n').length
  assert('KbGuardianService.ts 行数 ≥ 410（基础 360 + I.5 +20 + I.6 +30）', lines >= 410, `${lines} 行`)

  // 2.1 顶部 orphansRemoved 计数变量
  assert('runSkill 顶部声明 let orphansRemoved = 0',
    /runSkill\s*\([\s\S]{0,2000}?let\s+orphansRemoved\s*=\s*0/.test(src))

  // 2.2 孤儿扫描守卫条件
  assert('runSkill 含 if (options?.orphanCleanup !== false) 守卫',
    /if\s*\(\s*options\?\.orphanCleanup\s*!==\s*false\s*\)/.test(src))

  // 2.3 定位孤儿扫描块（if 守卫到对应闭合大括号，约 25 行）
  const orphanBlock = src.match(/if\s*\(\s*options\?\.orphanCleanup\s*!==\s*false\s*\)\s*\{([\s\S]*?)\n\s{2}\}/)
  if (orphanBlock) {
    const block = orphanBlock[1]

    // 2.4 diff 算法
    assert('orphan 块含 Object.keys(hashes)',
      /Object\.keys\(\s*hashes\s*\)/.test(block))
    assert('orphan 块含 new Set(files)',
      /new\s+Set\(\s*files\s*\)/.test(block))
    assert('orphan 块含 filter(rel => !fileSet.has(rel))',
      /\.filter\(\s*rel\s*=>\s*!fileSet\.has\(\s*rel\s*\)\s*\)/.test(block))

    // 2.5 循环 + 跳过无 docId 的 entry
    assert('orphan 块含 for (const relPath of orphanPaths)',
      /for\s*\(\s*const\s+relPath\s+of\s+orphanPaths\s*\)/.test(block))
    assert('orphan 块检查 orphan?.docId 缺失时只删 hashes 跳过 deleteDocs',
      /if\s*\(\s*!orphan\?\.docId\s*\)\s*\{[\s\S]{0,100}?delete\s+hashes\[relPath\][\s\S]{0,50}?continue/.test(block))

    // 2.6 deleteDocs + 删 entry + 统计
    assert('orphan 块调 this.kb.deleteDocs(skill.targetKbId, [orphan.docId])',
      /this\.kb\.deleteDocs\(\s*skill\.targetKbId\s*,\s*\[\s*orphan\.docId\s*\]\s*\)/.test(block))
    assert('orphan 块 delete hashes[relPath] 后计入 orphansRemoved',
      /delete\s+hashes\[relPath\][\s\S]{0,200}?orphansRemoved\s*\+=\s*1/.test(block) ||
      /orphansRemoved\s*\+=\s*1[\s\S]{0,200}?delete\s+hashes\[relPath\]/.test(block))

    // 2.7 单孤儿失败 catch
    assert('orphan 块含 try/catch 不阻塞其他孤儿',
      /try\s*\{[\s\S]{0,300}?this\.kb\.deleteDocs[\s\S]{0,300}?\}\s*catch\s*\(\s*error\s*\)/.test(block))
    assert('orphan catch failures.push 「清理孤儿失败」',
      /清理孤儿失败[：:]/.test(block))
  } else {
    assert('orphan 扫描块存在（无法定位内部断言）', false)
  }

  // 2.8 finally 块写入 log.orphansRemoved
  assert('finally 块 log.orphansRemoved = orphansRemoved',
    /finally\s*\{[\s\S]{0,2000}?log:\s*GuardianRunLog\s*=\s*\{[\s\S]{0,500}?orphansRemoved,?[\s\S]{0,500}?\}[\s\S]{0,200}?save/.test(src) ||
    /finally\s*\{[\s\S]{0,2000}?orphansRemoved,?[\s\S]{0,500}?\}\s*\}/.test(src))
  assert('finally 块 log.orphansRemoved 含字段',
    /finally\s*\{[\s\S]{0,2000}?orphansRemoved:?\s*orphansRemoved/.test(src) ||
    /log:\s*GuardianRunLog\s*=\s*\{[\s\S]{0,800}?orphansRemoved,?[\s\S]{0,200}?failures\s*\}/.test(src))

  // 2.9 finally 块写入 skill.lastStats.orphansRemoved
  assert('finally 块 skill.lastStats.orphansRemoved = orphansRemoved',
    /skill\.lastStats\s*=\s*\{[\s\S]{0,500}?orphansRemoved,?[\s\S]{0,200}?failed:?\s*failures\.length/.test(src) ||
    /skill\.lastStats\s*=\s*\{[\s\S]{0,500}?failed:?\s*failures\.length[\s\S]{0,200}?orphansRemoved,?/.test(src))

  // 2.10 位置：孤儿扫描在文件 for 循环之后、finally 之前
  const orphanIdx = src.search(/if\s*\(\s*options\?\.orphanCleanup\s*!==\s*false\s*\)/)
  const fileLoopIdx = src.search(/for\s*\(\s*const\s+relPath\s+of\s+files\s*\)\s*\{/)
  const finallyIdx = src.search(/finally\s*\{/)
  assert('orphan 扫描块位于文件 for 循环之后', orphanIdx > 0 && orphanIdx > fileLoopIdx, `orphan @${orphanIdx} > loop @${fileLoopIdx}`)
  assert('orphan 扫描块位于 finally 块之前', orphanIdx > 0 && orphanIdx < finallyIdx, `orphan @${orphanIdx} < finally @${finallyIdx}`)

  // 2.11 I.5 / I.6 阶段注释
  assert('orphan 块含 I.6 阶段新增注释',
    /I\.6\s*阶段新增[\s\S]{0,500}?orphan/.test(src))
}

// ─── 3. orphanCleanup 开关语义 ─────────────────────────
if (existsSync(svcPath)) {
  const src = readFileSync(svcPath, 'utf-8')

  // 3.1 !== false 守卫（undefined / true 都走清理）
  assert('orphanCleanup !== false 守卫（undefined 走清理）',
    /if\s*\(\s*options\?\.orphanCleanup\s*!==\s*false\s*\)/.test(src))

  // 3.2 没有显式 === true 分支（避免与 !== false 守卫冲突）
  const explicitTrueBranch = /orphanCleanup\s*===\s*['"]?true['"]?\s*\{[\s\S]{0,100}?清理/.test(src)
  assert('无 orphanCleanup === true 显式分支（避免双守卫冲突）', !explicitTrueBranch)

  // 3.3 false 时整段跳过（无需额外代码，if 守卫天然处理）
  assert('orphanCleanup === false 由 !== false 守卫天然跳过',
    /if\s*\(\s*options\?\.orphanCleanup\s*!==\s*false\s*\)/.test(src))
}

// ─── 4. launcher 显式声明 + 漂移检查 ─────────────
const launcherPath = resolve(root, 'src/main/services/SampleLibraryKbGuardianLauncher.ts')
assert('SampleLibraryKbGuardianLauncher.ts 文件存在', existsSync(launcherPath))
if (existsSync(launcherPath)) {
  const src = readFileSync(launcherPath, 'utf-8')
  const lines = src.split('\n').length
  assert('launcher 行数 ≥ 130（I.5 加 syncMode 漂移 + I.6 加 orphanCleanup 漂移）', lines >= 130, `${lines} 行`)

  // 4.1 expected 显式声明 orphanCleanup: true
  assert('expected 显式声明 orphanCleanup: true',
    /expected:\s*GuardianSkillInput\s*=\s*\{[\s\S]*?orphanCleanup:\s*true/.test(src))
  assert('orphanCleanup: true 字段带 I.6 阶段注释',
    /orphanCleanup:\s*true[\s\S]{0,200}?I\.6/.test(src) || /I\.6[\s\S]{0,500}?orphanCleanup:\s*true/.test(src))

  // 4.2 漂移检查（双侧 ?? true 兼容老持久化）
  assert('needs() 漂移检查加 orphanCleanup 比较（双侧 ?? true 兜底）',
    /\(existing\.orphanCleanup\s*\?\?\s*true\s*\)\s*!==\s*\(expected\.orphanCleanup\s*\?\?\s*true\s*\)/.test(src))

  // 4.3 漂移检查列表更新为 7 项
  assert('needs() 漂移检查注释列表含 orphanCleanup',
    /\/\/ 5\)\s*存在则字段漂移检查[\s\S]{0,500}?orphanCleanup/.test(src) ||
    /孤儿/.test(src))

  // 4.4 旧字段保留
  assert('ensure 仍调 ensureAgentKb', /ensureAgentKb\(SAMPLE_LIBRARY_KB_TARGET\.agentKey\)/.test(src))
  assert('ensure 仍按 name 查重', /state\.skills\.find\(skill\s*=>\s*skill\.name\s*===\s*SAMPLE_LIBRARY_KB_GUARDIAN_NAME\)/.test(src))
  assert('ensure 字段漂移仍调 updateSkill(existing.id, expected)', /if\s*\(needs\(\)\)[\s\S]{0,500}?updateSkill\(\s*existing\.id\s*,\s*expected\s*\)/.test(src))
  assert('ensure 保留 I.5 syncMode: \'soft\' 显式声明', /syncMode:\s*['"]soft['"]/.test(src))
}

// ─── 5. UI 渲染（SampleLibrary.tsx） ───────────────────
const slPath = resolve(root, 'src/renderer/SampleLibrary.tsx')
assert('SampleLibrary.tsx 文件存在', existsSync(slPath))
if (existsSync(slPath)) {
  const src = readFileSync(slPath, 'utf-8')
  const lines = src.split('\n').length
  assert('SampleLibrary.tsx 行数 ≥ 540（基础 510 + I.5 +30）', lines >= 540, `${lines} 行`)

  // 5.1 GuardianStatus 类型补 orphansRemoved
  assert('GuardianStatus present 态 lastStats 补 orphansRemoved 可选字段',
    /lastStats\?:\s*\{[\s\S]*?orphansRemoved\?:\s*number/.test(src))
  assert('lastStats.orphansRemoved 带 I.6 阶段注释',
    /I\.6\s*阶段新增[\s\S]{0,500}?orphansRemoved\?:\s*number/.test(src))

  // 5.2 refreshGuardian 写入 orphansRemoved（老 I.5 持久化 ?? 0 兜底）
  assert('refreshGuardian 写入 orphansRemoved 字段（带 ?? 0 兜底）',
    /refreshGuardian[\s\S]{0,3000}?orphansRemoved:\s*[^}]*?\.lastStats\.orphansRemoved\s*\?\?\s*0/.test(src))
  assert('refreshGuardian orphansRemoved 写入带 I.6 阶段注释',
    /I\.6\s*阶段新增[\s\S]{0,500}?orphansRemoved:[\s\S]{0,500}?\.lastStats\.orphansRemoved\s*\?\?\s*0/.test(src))

  // 5.3 条件渲染（> 0 才显示）
  assert('UI 条件渲染「> 0」才显示孤儿清理 chip',
    /\(guardian\.skill\.lastStats\.orphansRemoved\s*\?\?\s*0\)\s*>\s*0/.test(src))

  // 5.4 渲染孤儿清理 chip
  assert('UI 渲染 🧹 孤儿清理 chip',
    /🧹\s*孤儿清理/.test(src))
  assert('UI 渲染 lastStats.orphansRemoved 数字（<b>）',
    /🧹\s*孤儿清理\s*<b>\{[\s\S]*?\.lastStats\.orphansRemoved/.test(src) ||
    /🧹\s*孤儿清理\s*\{[\s\S]*?\.lastStats\.orphansRemoved/.test(src))

  // 5.5 className 引用 orphans 类（实际写法：className="sample-library-guardian-stat orphans"）
  assert('chip className 含 sample-library-guardian-stat orphans',
    /className=\{?['"]sample-library-guardian-stat\s+orphans['"]/.test(src))

  // 5.6 title 提示
  assert('chip title 提示「源文件被删/重命名后，KB 中残留的旧 docId 已被自动清理」',
    /title=\{?['"]?源文件被删\/重命名后[\s\S]{0,200}?已被自动清理/.test(src) ||
    /title=\{?['"]源文件被删\/重命名后[\s\S]{0,200}?已被自动清理['"]\}/.test(src))
}

// ─── 6. CSS 样式（sample-library.css） ───────────────────
const cssPath = resolve(root, 'src/renderer/sample-library.css')
assert('sample-library.css 文件存在', existsSync(cssPath))
if (existsSync(cssPath)) {
  const src = readFileSync(cssPath, 'utf-8')
  const lines = src.split('\n').length
  assert('sample-library.css 行数 ≥ 470（基础 440 + I.5 +20 + I.6 +15）', lines >= 470, `${lines} 行`)

  // 6.1 主类
  assert('CSS 含 .sample-library-guardian-stat.orphans 主类',
    /\.sample-library-guardian-stat\.orphans\s*\{/.test(src))

  // 6.2 紧凑 chip 尺寸
  const orphansBlock = src.match(/\.sample-library-guardian-stat\.orphans\s*\{([\s\S]*?)\}/)
  if (orphansBlock) {
    const block = orphansBlock[1]
    assert('orphans chip 11px 字号', /font-size:\s*11px/.test(block))
    assert('orphans chip 圆角 999px', /border-radius:\s*999px/.test(block))
    assert('orphans chip 灰底 var(--bg-soft, #f1f5f9)',
      /var\(--bg-soft,\s*#f1f5f9\)/.test(block))
    assert('orphans chip 灰文字 var(--fg-soft, #475569)',
      /var\(--fg-soft,\s*#475569\)/.test(block))
    assert('orphans chip 描边 var(--border, #e2e8f0)',
      /var\(--border,\s*#e2e8f0\)/.test(block))
  } else {
    assert('orphans chip 主块存在（无法定位尺寸断言）', false)
  }

  // 6.3 <b> 数字样式
  const bBlock = src.match(/\.sample-library-guardian-stat\.orphans\s+b\s*\{([\s\S]*?)\}/)
  if (bBlock) {
    const block = bBlock[1]
    assert('orphans <b> 数字加粗 600', /font-weight:\s*600/.test(block))
    assert('orphans <b> 数字加深 #334155', /color:\s*#334155/.test(block))
  } else {
    assert('orphans <b> 数字块存在（无法定位断言）', false)
  }

  // 6.4 I.6 注释
  assert('orphans 样式带 I.6 阶段新增注释',
    /I\.6\s*阶段新增[\s\S]{0,500}?sample-library-guardian-stat\.orphans/.test(src))

  // 6.5 灰底不抢眼（不与守卫卡 ok 态青绿系争色）
  assert('orphans 样式不引用青绿系 #0d9488 / #14b8a6 / #99f6e4',
    !/var\(--bg-soft[\s\S]{0,500}?#0d9488|#14b8a6|#99f6e4/.test(
      readFileSync(cssPath, 'utf-8').match(/\.sample-library-guardian-stat\.orphans\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    ))
}

// ─── 7. 跨阶段双源同步 ───────────────────────────────
if (existsSync(kbGuardianPath) && existsSync(svcPath) && existsSync(launcherPath)) {
  const sharedSrc = readFileSync(kbGuardianPath, 'utf-8')
  const svcSrc = readFileSync(svcPath, 'utf-8')
  const lchSrc = readFileSync(launcherPath, 'utf-8')

  // 7.1 共享契约 → 主进程 import
  assert('主进程 import GuardianRunOptions 含 orphanCleanup 字段',
    /import\s+type\s*\{[^}]*GuardianRunOptions[^}]*\}\s*from\s*['"]\.\.\/\.\.\/shared\/kbGuardian['"]/.test(svcSrc))

  // 7.2 KbGuardianService log.orphansRemoved 写入（容忍简写 orphansRemoved,）
  assert('KbGuardianService log 含 orphansRemoved 字段写入（简写）',
    /log:\s*GuardianRunLog\s*=\s*\{[\s\S]{0,800}?orphansRemoved,?\s*\n[\s\S]{0,200}?failures/.test(svcSrc))

  // 7.3 launcher.expected.orphanCleanup = true 与 launcher 漂移检查 ?? true 兜底一致（svc 运行时只用 !== false，launcher 持久化用 ?? true）
  assert('launcher.expected.orphanCleanup = true 与 launcher 漂移 ?? true 兜底一致',
    /orphanCleanup:\s*true/.test(lchSrc) && /existing\.orphanCleanup\s*\?\?\s*true[\s\S]{0,50}?!==[\s\S]{0,50}?expected\.orphanCleanup\s*\?\?\s*true/.test(lchSrc))

  // 7.4 launcher 漂移检查 vs svc 默认值
  assert('launcher 漂移检查双侧 ?? true 与 svc default ?? true 兜底一致',
    /existing\.orphanCleanup\s*\?\?\s*true/.test(lchSrc) &&
    /existing\.orphanCleanup\s*\?\?\s*true[\s\S]{0,50}?!==[\s\S]{0,50}?expected\.orphanCleanup\s*\?\?\s*true/.test(lchSrc))
}

if (existsSync(slPath) && existsSync(cssPath) && existsSync(svcPath)) {
  const slSrc = readFileSync(slPath, 'utf-8')
  const cssSrc = readFileSync(cssPath, 'utf-8')
  const svcSrcLocal = readFileSync(svcPath, 'utf-8')

  // 7.5 UI className ↔ CSS 类名
  assert('SampleLibrary 孤儿 chip className ↔ CSS 类名 一致',
    /sample-library-guardian-stat[\s\S]{0,200}?orphans/.test(slSrc) && /\.sample-library-guardian-stat\.orphans\s*\{/.test(cssSrc))

  // 7.6 UI 读取 lastStats.orphansRemoved ↔ svc 写入
  // 容忕 I.7 fallbackToHard 字段的 插入：orphansRemoved 后面可能同 行 fallbackToHard 或下 一行 failures
  assert('SampleLibrary 读取 lastStats.orphansRemoved 与 KbGuardianService 写入一致',
    /lastStats\.orphansRemoved/.test(slSrc) && /orphansRemoved,?\s+(fallbackToHard,?\s*\}|failures)/.test(svcSrcLocal))
}

// ─── 8. 设计 token / 可访问性 ─────────────────────────
if (existsSync(cssPath)) {
  const cssSrc = readFileSync(cssPath, 'utf-8')

  // 8.1 复用 I.2 阶段守卫卡 var token（var(--bg-soft) / var(--fg-soft) / var(--border)）
  assert('orphans 样式复用 var(--bg-soft)', /var\(--bg-soft/.test(cssSrc))
  assert('orphans 样式复用 var(--fg-soft)', /var\(--fg-soft/.test(cssSrc))
  assert('orphans 样式复用 var(--border)', /var\(--border/.test(cssSrc))

  // 8.2 灰底不抢眼（与 I.2 守卫卡 ok 态 #f0fdfa 青绿系区分）
  const cardOkBlock = cssSrc.match(/\.sample-library-guardian-card\.ok\s*\{([\s\S]*?)\}/)
  if (cardOkBlock) {
    const block = cardOkBlock[1]
    assert('守卫卡 ok 态底色 #f0fdfa（青绿系，与 orphans 灰底区分）',
      /background:\s*#f0fdfa/.test(block))
  }

  // 8.3 display: inline-flex 保证 chip 与文字基线对齐
  const orphansBlock = cssSrc.match(/\.sample-library-guardian-stat\.orphans\s*\{([\s\S]*?)\}/)
  if (orphansBlock) {
    const block = orphansBlock[1]
    assert('orphans chip 用 inline-flex 对齐（chip 风格）', /display:\s*inline-flex/.test(block))
    assert('orphans chip align-items: center（垂直居中）', /align-items:\s*center/.test(block))
    assert('orphans chip gap: 3px（emoji 与文字间距）', /gap:\s*3px/.test(block))
  }

  // 8.4 title 提示（可访问性）
  if (existsSync(slPath)) {
    const slSrc = readFileSync(slPath, 'utf-8')
    assert('orphan chip title 提示含「自动清理」关键词',
      /orphans[\s\S]{0,500}?title=\{?['"][^'"]*自动清理/.test(slSrc) ||
      /title=\{?['"][^'"]*源文件被删\/重命名后[\s\S]{0,200}?自动清理/.test(slSrc))
  }
}

// ─── 9. 文档同步 ─────────────────────────────────────
const docPath = resolve(root, 'docs/选品分析师-报告样例库.md')
assert('docs/选品分析师-报告样例库.md 文件存在', existsSync(docPath))
if (existsSync(docPath)) {
  const src = readFileSync(docPath, 'utf-8')
  const lines = src.split('\n').length
  assert('报告样例库文档行数 ≥ 940（I.5 +152 后 + I.6 +151）', lines >= 940, `${lines} 行`)

  // 9.1 I.6 章节标题
  assert('文档含「I.6 阶段：守卫孤儿文档清理」章节标题',
    /^##\s*I\.6\s*阶段[：:]\s*守卫孤儿文档清理/m.test(src))

  // 9.2 7 个必备小节
  assert('含「入库目标」小节', /### 入库目标/.test(src))
  assert('含「孤儿检测架构图」小节', /###\s*孤儿检测架构图/.test(src))
  assert('含「桌面入口」小节', /### 桌面入口/.test(src))
  assert('含「清理语义」小节', /### 清理语义/.test(src))
  assert('含「实现要点」小节', /### 实现要点/.test(src))
  assert('含「跨阶段双源同步」小节（I.6 段内）', /I\.6[\s\S]{0,10000}?### 跨阶段双源同步/.test(src))
  assert('含「验证」小节（含 verify-sample-library-orphan-cleanup.ts 引用）',
    /### 验证[\s\S]{0,2000}?verify-sample-library-orphan-cleanup\.ts/.test(src))

  // 9.3 关键术语
  assert('I.6 章节含「孤儿清理」术语', /I\.6[\s\S]{0,10000}?孤儿清理/.test(src))
  assert('I.6 章节含「orphanCleanup」术语', /I\.6[\s\S]{0,10000}?orphanCleanup/.test(src))
  assert('I.6 章节含「orphansRemoved」术语', /I\.6[\s\S]{0,10000}?orphansRemoved/.test(src))
  assert('I.6 章节含「Object.keys(hashes)」术语', /I\.6[\s\S]{0,10000}?Object\.keys\(hashes\)/.test(src))
  assert('I.6 章节含「diff」术语', /I\.6[\s\S]{0,10000}?diff/.test(src))
  assert('I.6 章节含「deleteDocs」术语', /I\.6[\s\S]{0,10000}?deleteDocs/.test(src))
  assert('I.6 章节含「单孤儿失败不阻塞」术语',
    /I\.6[\s\S]{0,10000}?单孤儿失败[\s\S]{0,200}?不阻塞/.test(src) ||
    /I\.6[\s\S]{0,10000}?单个孤儿[\s\S]{0,200}?不阻塞/.test(src) ||
    /I\.6[\s\S]{0,10000}?单文件\s*catch\s*不阻塞/.test(src))
  assert('I.6 章节含「显式声明」术语', /I\.6[\s\S]{0,10000}?显式声明/.test(src))
  assert('I.6 章节含「漂移检查」术语', /I\.6[\s\S]{0,10000}?漂移检查/.test(src))
  assert('I.6 章节含「var(--bg-soft)」术语', /I\.6[\s\S]{0,10000}?var\(--bg-soft\)/.test(src))

  // 9.4 清理语义表（orphanCleanup 三态）
  assert('I.6 章节含「清理语义」表（同一表内含 3 行 orphanCleanup 状态）',
    /I\.6[\s\S]{0,10000}?### 清理语义[\s\S]{0,2000}?\|\s*`?undefined`?/.test(src))

  // 9.5 跨阶段双源同步表（5+ 个源）
  assert('I.6 章节「跨阶段双源同步」含 src/shared/kbGuardian.ts',
    /I\.6[\s\S]{0,10000}?### 跨阶段双源同步[\s\S]{0,500}?src\/shared\/kbGuardian\.ts/.test(src))
  assert('I.6 章节含 src/main/services/KbGuardianService.ts',
    /I\.6[\s\S]{0,10000}?src\/main\/services\/KbGuardianService\.ts/.test(src))
  assert('I.6 章节含 src/main/services/SampleLibraryKbGuardianLauncher.ts',
    /I\.6[\s\S]{0,10000}?src\/main\/services\/SampleLibraryKbGuardianLauncher\.ts/.test(src))
  assert('I.6 章节含 src/renderer/SampleLibrary.tsx',
    /I\.6[\s\S]{0,10000}?src\/renderer\/SampleLibrary\.tsx/.test(src))
  assert('I.6 章节含 src/renderer/sample-library.css',
    /I\.6[\s\S]{0,10000}?src\/renderer\/sample-library\.css/.test(src))

  // 9.6 verify 工具引用
  assert('I.6 章节含 verify 工具名 verify-sample-library-orphan-cleanup.ts',
    /verify-sample-library-orphan-cleanup\.ts/.test(src))

  // 9.7 tsc 章节
  assert('I.6 章节末尾含「tsc + 全量回归」小节', /###\s*tsc\s*\+\s*全量回归/.test(src))

  // 9.8 实施细节：5 个实现要点
  assert('I.6 章节「实现要点」含 5 个子小节（1-5 编号）',
    /I\.6[\s\S]{0,10000}?### 实现要点[\s\S]{0,3000}?####\s*1\./.test(src) &&
    /I\.6[\s\S]{0,10000}?### 实现要点[\s\S]{0,3000}?####\s*2\./.test(src) &&
    /I\.6[\s\S]{0,10000}?### 实现要点[\s\S]{0,3000}?####\s*3\./.test(src) &&
    /I\.6[\s\S]{0,10000}?### 实现要点[\s\S]{0,3000}?####\s*4\./.test(src) &&
    /I\.6[\s\S]{0,10000}?### 实现要点[\s\S]{0,3000}?####\s*5\./.test(src))

  // 9.9 launcher 7 项漂移检查列表
  assert('I.6 章节「实现要点」提到「漂移检查列表更新为 7 项」',
    /I\.6[\s\S]{0,10000}?漂移检查列表更新为[\s\S]{0,200}?7\s*项/.test(src))
}

// ─── 总结 ───────────────────────────────────────────
console.log('\n────────────────────────────────────────')
console.log(`断言：PASS ${pass}  FAIL ${fail}  总计 ${pass + fail}`)
if (fail === 0) {
  console.log('ALL PASS · I.6 阶段守卫孤儿清理 verify 通过 ✅')
} else {
  console.log(`FAILED：${failures.join('、')}`)
  process.exit(1)
}
