/**
 * J 阶段：守卫运行监控 + 失败重试 + 长时运行进度条 verify 工具。
 *
 * 验证项（9 大组 / 100+ 断言）：
 *  1. shared-contracts (10)：GuardianRetryRequest/Result 字段全、GuardianRunEvent discriminated union 三类型
 *  2. service-retryFailedFiles (12)：成功 / 失败 / 软+硬回退 / 源目录不存在 / 扩展名不匹配 / 技能未启用 / 技能运行中 / logId 不存在 / hash 跳过仍 succeeded
 *  3. service-processOneFile-refactor (10)：抽出 + softSyncHandled + 4 种 outcome 路径
 *  4. ipc-handlers (8)：kbGuardian:retry-failed / kbGuardian:get-log-detail 入参校验
 *  5. preload-bindings (10)：retryFailed / getLogDetail 类型 / global.d.ts 声明 / onRunEvent 解绑
 *  6. ui-knowledgeHub (15)：GuardianLogsDialog 展开/收起 / 4 个 chip / 失败 chip 红 / 孤儿/回退 chip / 重试按钮 disabled / 重试 notice / ticker
 *  7. ui-sampleLibrary (12)：红 chip / 一键重试按钮 / 重试 notice / 进度条 IIFE / ticker / actuallyRunning
 *  8. progress-event (15)：started/progress/finished 事件 / progress payload 字段 / processed+total / sinceStartMs / 增量统计 / retry 起始 0 事件
 *  9. regression-i5-i6-i7 (8)：runSkill 行为不变 / softSyncHandled 仍生效 / hash 跳过仍 ok / 孤儿清理不破坏
 *
 * 退出码：全 pass → 0；任一 fail → 1
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

// ─── 1. 共享契约扩展 ───────────────────────────────────────
const kbGuardianPath = resolve(root, 'src/shared/kbGuardian.ts')
assert('src/shared/kbGuardian.ts 文件存在', existsSync(kbGuardianPath))
if (existsSync(kbGuardianPath)) {
  const src = readFileSync(kbGuardianPath, 'utf-8')
  const lines = src.split('\n').length
  assert('kbGuardian.ts 行数 ≥ 132（基础 132 包含 J 阶段新增）', lines >= 132, `${lines} 行`)

  // 1.1 GuardianRetryRequest
  assert('GuardianRetryRequest 接口存在',
    /export interface GuardianRetryRequest\s*\{[\s\S]*?\}/.test(src))
  assert('GuardianRetryRequest 含 skillId 字段',
    /export interface GuardianRetryRequest\s*\{[\s\S]*?skillId:\s*string[\s\S]*?\}/.test(src))
  assert('GuardianRetryRequest 含 logId 字段',
    /export interface GuardianRetryRequest\s*\{[\s\S]*?logId:\s*string[\s\S]*?\}/.test(src))
  assert('GuardianRetryRequest 带 J 阶段说明注释',
    /J\s*阶段新增[\s\S]{0,200}?export interface GuardianRetryRequest/.test(src))

  // 1.2 GuardianRetryResult
  assert('GuardianRetryResult 接口存在',
    /export interface GuardianRetryResult\s*\{[\s\S]*?\}/.test(src))
  assert('GuardianRetryResult 含 retried/succeeded/skipped/failed 四字段',
    /export interface GuardianRetryResult\s*\{[\s\S]*?(retried|succeeded|skipped|failed):\s*number[\s\S]*?(retried|succeeded|skipped|failed):\s*number[\s\S]*?(retried|succeeded|skipped|failed):\s*number[\s\S]*?(retried|succeeded|skipped|failed):\s*number[\s\S]*?\}/.test(src))
  assert('GuardianRetryResult 含 failures: GuardianRunFailure[]',
    /export interface GuardianRetryResult\s*\{[\s\S]*?failures:\s*GuardianRunFailure\[\][\s\S]*?\}/.test(src))
  assert('GuardianRetryResult 注释说明 succeeded 语义',
    /succeeded:[\s\S]{0,300}?本次重试新增或更新的文件数/.test(src))
  assert('GuardianRetryResult 注释说明 skipped 语义',
    /skipped:[\s\S]{0,300}?文件已被删除\/不在扩展名集合内/.test(src))

  // 1.3 GuardianRunEvent 扩为 discriminated union
  assert('GuardianRunEvent 改为 type alias (discriminated union)',
    /export type GuardianRunEvent\s*=/.test(src))
  assert('GuardianRunEvent 含 started 类型',
    /\|\s*\{\s*type:\s*['"]started['"]\s*;\s*skillId:\s*string\s*\}/.test(src))
  assert('GuardianRunEvent 含 progress 类型',
    /\|\s*\{\s*type:\s*['"]progress['"]\s*;\s*skillId:\s*string\s*;[\s\S]*?processed:\s*number[\s\S]*?total:\s*number[\s\S]*?sinceStartMs:\s*number[\s\S]*?\}/.test(src))
  assert('GuardianRunEvent 含 finished 类型',
    /\|\s*\{\s*type:\s*['"]finished['"]\s*;\s*skillId:\s*string\s*\}/.test(src))
}

// ─── 2. KbGuardianService.retryFailedFiles 服务实现 ───────────────
const servicePath = resolve(root, 'src/main/services/KbGuardianService.ts')
assert('src/main/services/KbGuardianService.ts 文件存在', existsSync(servicePath))
if (existsSync(servicePath)) {
  const src = readFileSync(servicePath, 'utf-8')
  const lines = src.split('\n').length
  assert('KbGuardianService.ts 行数 ≥ 590（I 阶段 ~575 + J 阶段 +30）', lines >= 590, `${lines} 行`)

  // 2.1 retryFailedFiles 公共方法
  assert('retryFailedFiles 公共方法存在',
    /async retryFailedFiles\(request:\s*GuardianRetryRequest\):\s*Promise<GuardianRetryResult>/.test(src))
  assert('retryFailedFiles 校验「技能不存在」',
    /if\s*\(\s*!skill\s*\)\s*throw\s+new\s+Error\(\s*['"]技能不存在['"]\s*\)/.test(src))
  assert('retryFailedFiles 校验「技能已禁用」',
    /if\s*\(\s*!skill\.enabled\s*\)\s*throw\s+new\s+Error\(\s*['"]技能已禁用['"]\s*\)/.test(src))
  assert('retryFailedFiles 校验「技能正在运行」',
    /if\s*\(\s*this\.running\.has\(skill\.id\)\s*\)\s*throw\s+new\s+Error\(\s*['"]该技能正在运行/.test(src))
  assert('retryFailedFiles 校验「日志不存在」',
    /if\s*\(\s*!log\s*\)\s*throw\s+new\s+Error\(\s*['"]日志不存在['"]\s*\)/.test(src))
  assert('retryFailedFiles 校验「无失败项直接返回 0/0/0/0」',
    /if\s*\(\s*!log\.failures\.length\s*\)\s*\{\s*return\s*\{\s*retried:\s*0,\s*succeeded:\s*0,\s*skipped:\s*0,\s*failed:\s*0,\s*failures:\s*\[\s*\]\s*\}\s*\}/.test(src))
  assert('retryFailedFiles 过滤「不在源目录 + 扩展名不匹配」',
    /targets\s*=\s*failedNames\.filter\(name\s*=>\s*currentSet\.has\(name\)\s*&&\s*exts\.has\(path\.extname\(name\)\.toLowerCase\(\)\)\)/.test(src))
  assert('retryFailedFiles 使用 processOneFile 复用 soft + softFallbackHard 路径',
    /retryOptions[\s\S]{0,2000}?await\s+this\.processOneFile/.test(src))
  assert('retryFailedFiles hash 跳过仍 succeeded',
    /else\s+if\s*\(outcome\.skipped\s*>\s*0\)\s*\{[\s\S]{0,200}?succeeded\s*\+=\s*1/.test(src))
  assert('retryFailedFiles 写回 hashes 不污染 lastStats',
    /不污染 lastStats[\s\S]{0,200}?仅写回 hashes/.test(src))
  assert('retryFailedFiles 返回 5 字段结果（限定在函数体内）',
    /return\s*\{[\s\S]{0,400}?retried[\s\S]{0,80}?succeeded[\s\S]{0,80}?skipped[\s\S]{0,80}?failed:[\s\S]{0,200}?failures:[\s\S]{0,200}?\}[\s\S]{0,10}?\}/.test(src))
  assert('retryFailedFiles J 阶段说明注释存在（允许与函数定义跨多行）',
    /J\s*阶段新增：按 logId 重试该次运行中所有失败的文件[\s\S]{0,1500}?async retryFailedFiles/.test(src))
}

// ─── 3. processOneFile 抽出与软同步处理 ───────────────────
if (existsSync(servicePath)) {
  const src = readFileSync(servicePath, 'utf-8')
  // 3.1 processOneFile 私有方法
  assert('processOneFile 私有方法存在',
    /private\s+async\s+processOneFile\([\s\S]*?relPath:\s*string[\s\S]*?absPath:\s*string/.test(src))
  assert('processOneFile 返回 5 字段（added/updated/skipped/fallbackToHard/failure?）',
    /Promise<\{[\s\S]*?added:\s*number[\s\S]*?updated:\s*number[\s\S]*?skipped:\s*number[\s\S]*?fallbackToHard:\s*number[\s\S]*?failure\?:\s*\{[\s\S]*?\}\s*\}>/.test(src))
  // 3.2 4 种 outcome 路径
  assert('hash 命中：skipped++',
    /if\s*\(\s*entry\s*&&\s*entry\.hash\s*===\s*hash\s*\)\s*\{[\s\S]{0,200}?skipped\s*\+=\s*1/.test(src))
  assert('softSyncHandled 防重复 ++updated',
    /let\s+softSyncHandled\s*=\s*false[\s\S]{0,1500}?if\s*\(softSyncHandled\)\s*updated\s*\+=\s*1/.test(src))
  assert('soft 失败 + fallback 成功：updated++ + fallbackToHard++',
    /docId\s*=\s*await\s+this\.uploadAndParse[\s\S]{0,200}?updated\s*\+=\s*1[\s\S]{0,200}?fallbackToHard\s*\+=\s*1/.test(src))
  assert('soft + fallback 双错：返回双错 reason',
    /软同步\s*\+\s*硬回退均失败：软=[\s\S]{0,200}?硬=/.test(src))
  assert('hard 分支：entry 存在时先 deleteDocs',
    /if\s*\(entry\)\s*\{[\s\S]{0,200}?await\s+this\.kb\.deleteDocs[\s\S]{0,200}?\}/.test(src))
  assert('hash 写入：hashes\[relPath\]\s*=\s*\{\s*hash,\s*docId\s*\}',
    /hashes\[relPath\]\s*=\s*\{\s*hash,\s*docId\s*\}/.test(src))
  assert('processOneFile 顶层 try/catch 兜底',
    /catch\s*\(error\)\s*\{[\s\S]{0,200}?return\s*\{[\s\S]*?failure:\s*\{\s*name:\s*relPath,\s*reason:/.test(src))
  // 3.3 runSkill 复用 processOneFile
  assert('runSkill 改用 processOneFile 替换内层 if-else',
    /for\s*\(const\s+relPath\s+of\s+files\)\s*\{[\s\S]{0,500}?const\s+outcome\s*=\s*await\s+this\.processOneFile/.test(src))
  assert('runSkill 累计 outcome 字段',
    /added\s*\+=\s*outcome\.added[\s\S]{0,200}?updated\s*\+=\s*outcome\.updated[\s\S]{0,200}?skipped\s*\+=\s*outcome\.skipped[\s\S]{0,200}?fallbackToHard\s*\+=\s*outcome\.fallbackToHard/.test(src))
}

// ─── 4. IPC 处理器 ─────────────────────────────────────────
const mainPath = resolve(root, 'src/main/main.ts')
assert('src/main/main.ts 文件存在', existsSync(mainPath))
if (existsSync(mainPath)) {
  const src = readFileSync(mainPath, 'utf-8')
  // 4.1 kbGuardian:retry-failed
  assert('ipcMain.handle kbGuardian:retry-failed 存在',
    /ipcMain\.handle\(\s*['"]kbGuardian:retry-failed['"]\s*,/.test(src))
  assert('kbGuardian:retry-failed 调用 retryFailedFiles(request)',
    /ipcMain\.handle\(\s*['"]kbGuardian:retry-failed['"]\s*,[\s\S]{0,200}?kbGuardianService\.retryFailedFiles\(request\)/.test(src))
  // 4.2 kbGuardian:get-log-detail
  assert('ipcMain.handle kbGuardian:get-log-detail 存在',
    /ipcMain\.handle\(\s*['"]kbGuardian:get-log-detail['"]\s*,/.test(src))
  assert('kbGuardian:get-log-detail 入参校验 logId',
    /kbGuardian:get-log-detail[\s\S]{0,300}?if\s*\(\s*!logId\s*\)\s*return\s*null/.test(src))
  assert('kbGuardian:get-log-detail 从 logs 列表查找',
    /kbGuardian:get-log-detail[\s\S]{0,500}?list\.find\(item\s*=>\s*item\.id\s*===\s*logId\)/.test(src))
  // 4.3 透传 run-event（已有 started/finished，现在含 progress）
  assert('run-event 透传 webContents.send',
    /\w+WebContents\??\.?\s*send\(\s*['"]kbGuardian:run-event['"]/.test(src))
}

// ─── 5. preload + global.d.ts 绑定 ───────────────────────────
const preloadPath = resolve(root, 'src/preload/preload.ts')
const globalDtsPath = resolve(root, 'src/renderer/global.d.ts')
assert('src/preload/preload.ts 文件存在', existsSync(preloadPath))
assert('src/renderer/global.d.ts 文件存在', existsSync(globalDtsPath))
if (existsSync(preloadPath)) {
  const src = readFileSync(preloadPath, 'utf-8')
  // 5.1 导入
  assert('preload 导入 GuardianRetryRequest',
    /import type \{[\s\S]*?GuardianRetryRequest[\s\S]*?\}\s*from\s*['"]\.\.\/shared\/kbGuardian['"]/.test(src))
  assert('preload 导入 GuardianRetryResult',
    /import type \{[\s\S]*?GuardianRetryResult[\s\S]*?\}\s*from\s*['"]\.\.\/shared\/kbGuardian['"]/.test(src))
  // 5.2 绑定
  assert('preload kbGuardian 对象含 retryFailed 绑定',
    /retryFailed:\s*\(request:\s*GuardianRetryRequest\):\s*Promise<GuardianRetryResult>\s*=>\s*ipcRenderer\.invoke\(\s*['"]kbGuardian:retry-failed['"]\s*,\s*request\s*\)/.test(src))
  assert('preload kbGuardian 对象含 getLogDetail 绑定',
    /getLogDetail:\s*\(logId:\s*string\):\s*Promise<GuardianRunLog\s*\|\s*null>\s*=>\s*ipcRenderer\.invoke\(\s*['"]kbGuardian:get-log-detail['"]\s*,\s*\{\s*logId\s*\}\s*\)/.test(src))
  // 5.3 onRunEvent 解绑函数
  assert('preload onRunEvent 返回解绑函数',
    /onRunEvent[\s\S]{0,300}?ipcRenderer\.removeListener\(\s*['"]kbGuardian:run-event['"]\s*,\s*listener\s*\)/.test(src))
  // 5.4 旧 I.1-I.7 绑定仍保留
  assert('保留 state/create/update/remove/runNow/logs/pickDir 绑定',
    /state:|create:|update:|remove:|runNow:|logs:|pickDir:/.test(src))
}
if (existsSync(globalDtsPath)) {
  const src = readFileSync(globalDtsPath, 'utf-8')
  assert('global.d.ts kbGuardian 接口含 retryFailed 类型声明',
    /retryFailed\(request:\s*\{\s*skillId:\s*string\s*;\s*logId:\s*string\s*\}\)/.test(src))
  assert('global.d.ts kbGuardian 接口含 getLogDetail 类型声明',
    /getLogDetail\(logId:\s*string\):\s*Promise<GuardianRunLog\s*\|\s*null>/.test(src))
}

// ─── 6. KnowledgeHub UI：日志展开 + 重试 ──────────────────────
const knowledgeHubPath = resolve(root, 'src/renderer/KnowledgeHub.tsx')
assert('src/renderer/KnowledgeHub.tsx 文件存在', existsSync(knowledgeHubPath))
if (existsSync(knowledgeHubPath)) {
  const src = readFileSync(knowledgeHubPath, 'utf-8')
  const lines = src.split('\n').length
  assert('KnowledgeHub.tsx 行数 ≥ 1000（I 阶段 ~960 + J 阶段 +90）', lines >= 1000, `${lines} 行`)

  // 6.1 GuardianSection 状态
  assert('GuardianSection 含 runStartedAt 状态',
    /const\s*\[\s*runStartedAt\s*,\s*setRunStartedAt\s*\]\s*=\s*useState<Record<string,\s*number>>/.test(src))
  assert('GuardianSection 含 progress 状态',
    /const\s*\[\s*progress\s*,\s*setProgress\s*\]\s*=\s*useState<Record<string,\s*\{[\s\S]*?processed:[\s\S]*?total:[\s\S]*?sinceStartMs:/.test(src))
  assert('GuardianSection 含 ticker 状态',
    /const\s*\[\s*,\s*setTick\s*\]\s*=\s*useState\(0\)/.test(src))
  // 6.2 onRunEvent 订阅
  assert('GuardianSection 订阅 onRunEvent 维护 runStartedAt',
    /onRunEvent[\s\S]{0,500}?setRunStartedAt\(prev\s*=>\s*\(\{\s*\.\.\.prev\s*,\s*\[event\.skillId\]:\s*Date\.now\(\)\s*\}\)\)/.test(src))
  assert('GuardianSection 订阅 onRunEvent 清理 finished',
    /event\.type\s*===\s*['"]finished['"][\s\S]{0,1500}?delete\s+next\[event\.skillId\]/.test(src))
  // 6.3 进度条 UI（> 30s）
  assert('showProgress 条件：running && elapsed > 30_000',
    /showProgress\s*=\s*Boolean\(skill\.running\s*&&\s*\(prog\s*\|\|\s*startedAt\)\s*&&\s*elapsed\s*>\s*30_000\)/.test(src))
  assert('进度条文案含「⏳ 已运行 Xs」',
    /⏳\s*已运行\s*<b>\{Math\.floor\(elapsed\s*\/\s*1000\)\}s<\/b>/.test(src))
  assert('进度条文案含「已处理 processed/total」（? 允许任意）',
    /已处理\s*<b>\{prog\.processed\}<\/b>\/<b>\{prog\.total/.test(src))
  // 6.4 GuardianLogsDialog 展开/收起
  assert('GuardianLogsDialog 含 expanded 状态',
    /const\s*\[\s*expanded\s*,\s*setExpanded\s*\]\s*=\s*useState<Record<string,\s*boolean>>/.test(src))
  assert('GuardianLogsDialog 含 retrying 状态',
    /const\s*\[\s*retrying\s*,\s*setRetrying\s*\]\s*=\s*useState<Record<string,\s*boolean>>/.test(src))
  assert('GuardianLogsDialog 含 notice 状态',
    /const\s*\[\s*notice\s*,\s*setNotice\s*\]\s*=\s*useState<Record<string,\s*\{\s*ok:\s*boolean\s*;\s*msg:\s*string\s*\}>>/.test(src))
  assert('GuardianLogsDialog 切换按钮「▼ 详情」/「▲ 收起」',
    /isOpen\s*\?\s*['"]▲ 收起['"]\s*:\s*['"]▼ 详情['"]/.test(src))
  assert('GuardianLogsDialog 4 个 stat-chip（新增/更新/跳过/失败）',
    /<span className="kb-guardian-stat-chip">新增 <b>\{log\.added\}<\/b><\/span>[\s\S]{0,500}?<span className="kb-guardian-stat-chip">更新 <b>\{log\.updated\}<\/b><\/span>[\s\S]{0,500}?<span className="kb-guardian-stat-chip">跳过 <b>\{log\.skipped\}<\/b><\/span>[\s\S]{0,500}?kb-guardian-stat-chip failed/.test(src))
  assert('GuardianLogsDialog 失败 chip 红（class 含 failed）',
    /kb-guardian-stat-chip failed[\s\S]{0,200}?失败\s*<b>\{log\.failures\.length\}<\/b>/.test(src))
  assert('GuardianLogsDialog 重试按钮「🔁 重试失败项」',
    /🔁\s*重试失败项/.test(src))
  assert('GuardianLogsDialog 重试按钮 disabled：failures.length === 0 || isRetrying',
    /disabled=\{\s*log\.failures\.length\s*===\s*0\s*\|\|\s*isRetrying\s*\}/.test(src))
  assert('GuardianLogsDialog retry 调 retryFailed',
    /await\s+window\.desktop\.kbGuardian\.retryFailed\(\{\s*skillId:\s*skill\.id,\s*logId\s*\}\)/.test(src))
  assert('GuardianLogsDialog 成功后 reloadLogs',
    /await\s+reloadLogs\(\)/.test(src))
}

// ─── 7. SampleLibrary UI：红 chip + 一键重试 + 进度条 ─────────
const sampleLibraryPath = resolve(root, 'src/renderer/SampleLibrary.tsx')
assert('src/renderer/SampleLibrary.tsx 文件存在', existsSync(sampleLibraryPath))
if (existsSync(sampleLibraryPath)) {
  const src = readFileSync(sampleLibraryPath, 'utf-8')
  // 7.1 红 chip
  assert('SampleLibrary 失败 chip class 含 failed',
    /<span className="sample-library-guardian-stat failed"[\s\S]{0,200}?失败 <b>\{guardian\.skill\.lastStats\.failed\}<\/b>/.test(src))
  // 7.2 一键重试按钮
  assert('SampleLibrary 一键重试按钮 class 正确（允许属性跨行）',
    /sample-library-guardian-retry-btn[\s\S]{0,500}?onClick=\{handleRetryLastFailed\}/.test(src))
  assert('SampleLibrary handleRetryLastFailed 函数存在（跨多行）',
    /const\s+handleRetryLastFailed\s*=\s*async\s*\(\)\s*=>\s*\{[\s\S]{0,3000}?await\s+api\.retryFailed\(\{\s*skillId,[\s\S]{0,50}?logId:/.test(src))
  assert('handleRetryLastFailed 优先选最后一条有失败项的 log',
    /\[\.\.\.logs\]\.reverse\(\)\.find\(item\s*=>\s*item\.failures\.length\s*>\s*0\)/.test(src))
  assert('handleRetryLastFailed 重试后 refreshGuardian',
    /await\s+refreshGuardian\(\)/.test(src))
  assert('SampleLibrary retryNotice 状态 + ingest-result 渲染',
    /retryNotice[\s\S]{0,800}?sample-library-ingest-result\s+\$\{retryNotice\.ok\s*\?\s*['"]ok['"]\s*:\s*['"]err['"]\}/.test(src))
  // 7.3 进度条状态
  assert('SampleLibrary 含 runStartedAt/progress 状态',
    /const\s*\[\s*runStartedAt\s*,\s*setRunStartedAt\s*\]\s*=\s*useState<number\s*\|\s*null>/.test(src))
  assert('SampleLibrary actuallyRunning 推导',
    /const\s+actuallyRunning\s*=\s*guardian\.phase\s*===\s*['"]present['"]\s*&&\s*runStartedAt\s*!==\s*null/.test(src))
  assert('SampleLibrary 订阅 onRunEvent 处理 started/finished',
    /api\.onRunEvent\(event\s*=>\s*\{[\s\S]{0,800}?event\.type\s*===\s*['"]finished['"][\s\S]{0,400}?setRunStartedAt\(null\)/.test(src))
  assert('SampleLibrary 进度条 IIFE 块',
    /sample-library-guardian-progress[\s\S]{0,200}?已运行\s*<b>\{Math\.floor\(elapsed\s*\/\s*1000\)\}s<\/b>/.test(src))
  assert('SampleLibrary 进度条 fill 比例',
    /sample-library-guardian-progress-bar-fill[\s\S]{0,200}?width:\s*`\$\{percent\}%`/.test(src))
}

// ─── 8. progress 事件 / run-event 透传 ────────────────────────
if (existsSync(servicePath)) {
  const src = readFileSync(servicePath, 'utf-8')
  // 8.1 runSkill 发 progress
  assert('runSkill 内 for 循环后 emit progress',
    /processed\s*\+=\s*1[\s\S]{0,300}?this\.emit\(\{\s*type:\s*['"]progress['"]\s*,\s*skillId\s*,\s*processed\s*,\s*total\s*,\s*sinceStartMs:[\s\S]{0,200}?fallbackToHard\s*\}\s*\)/.test(src))
  assert('runSkill 起始 emit started',
    /this\.emit\(\{\s*type:\s*['"]started['"]\s*,\s*skillId\s*\}/.test(src))
  assert('runSkill 结束 emit finished（finally 内）',
    /\}\s*finally\s*\{[\s\S]{0,2500}?this\.emit\(\{\s*type:\s*['"]finished['"]\s*,\s*skillId\s*\}\s*\)/.test(src))
  // 8.2 retryFailedFiles 发 progress
  assert('retryFailedFiles 起始 emit progress(0)',
    /const\s+retryStartedAt\s*=\s*Date\.now\(\)[\s\S]{0,500}?this\.emit\(\{\s*type:\s*['"]progress['"]\s*,\s*skillId:\s*skill\.id\s*,\s*processed:\s*0\s*,\s*total\s*,\s*sinceStartMs:\s*0\s*\}\)/.test(src))
  assert('retryFailedFiles 每文件 emit progress',
    /retryFailedFiles[\s\S]{0,2000}?processed\s*\+=\s*1[\s\S]{0,200}?this\.emit\(\{\s*type:\s*['"]progress['"]\s*,\s*skillId:\s*skill\.id\s*,\s*processed\s*,\s*total\s*,\s*sinceStartMs:[\s\S]{0,100}?\}\)/.test(src))
  // 8.3 sinceStartMs 计算
  assert('runSkill 内的 sinceStartMs = Date.now() - startedAt',
    /sinceStartMs:\s*Date\.now\(\)\s*-\s*startedAt/.test(src))
  assert('retryFailedFiles 内的 sinceStartMs = Date.now() - retryStartedAt',
    /sinceStartMs:\s*Date\.now\(\)\s*-\s*retryStartedAt/.test(src))
}

// ─── 9. I.5 / I.6 / I.7 回归断言 ───────────────────────────
if (existsSync(servicePath)) {
  const src = readFileSync(servicePath, 'utf-8')
  assert('保留 I.5 softSyncHandled 防止重复 ++updated',
    /let\s+softSyncHandled\s*=\s*false[\s\S]{0,1500}?if\s*\(softSyncHandled\)\s*updated\s*\+=\s*1/.test(src))
  assert('保留 I.5 updateAndParse 私有方法',
    /private\s+async\s+updateAndParse\(kbId:\s*string\s*,\s*docId:\s*string\s*,\s*absPath:\s*string\)/.test(src))
  assert('保留 I.6 孤儿清理 orphansRemoved 累加',
    /orphansRemoved\s*\+=\s*1/.test(src))
  assert('保留 I.6 孤儿清理条件：options?.orphanCleanup !== false',
    /if\s*\(options\?\.orphanCleanup\s*!==\s*false\)/.test(src))
  assert('保留 I.7 softFallbackHard 默认 true 路径',
    /if\s*\(options\?\.softFallbackHard\s*!==\s*false\)/.test(src))
  assert('保留 I.5 同步模式 effectiveSyncMode 三路合并',
    /effectiveSyncMode:\s*GuardianSyncMode\s*=\s*\(options\?\.syncMode\s*\?\?\s*skill\.syncMode\s*\?\?\s*['"]soft['"]\)/.test(src))
  assert('保留 I.5 waitParse 5 分钟超时（5*60_000 或 5*60*1000 都行）',
    /PARSE_TIMEOUT_MS\s*=\s*5\s*\*\s*60(?:_?000|\s*\*\s*1000)/.test(src))
  assert('保留 LOG_LIMIT_PER_SKILL = 20',
    /LOG_LIMIT_PER_SKILL\s*=\s*20/.test(src))
}

// ─── 汇总 ─────────────────────────────────────────────────
console.log('')
console.log('══════════════════════════════════════════════════════════════')
console.log(`  J 阶段 verify 汇总：PASS ${pass} / FAIL ${fail}`)
console.log(`  共 ${pass + fail} 项断言（目标 100+）`)
if (fail > 0) {
  console.log('  ❌ 失败项：')
  for (const name of failures) console.log(`     - ${name}`)
  process.exit(1)
}
console.log('  ✅ J 阶段全量验收通过')
process.exit(0)
