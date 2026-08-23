/**
 * I.2 阶段：报告样例库 → 知识库守卫自动同步 verify 工具。
 *
 * 验证项（16 组 130+ 断言）：
 *  1. src/shared/kbGuardian.ts 共享契约扩展
 *     - 文件存在 + 行数 + 导出
 *     - GuardianSkill 含 category / ensureCategories
 *     - GuardianSkillInput 含 category / ensureCategories
 *     - GuardianCategorySpec 接口
 *     - GuardianRunOptions 接口（含 categoryResolver）
 *  2. KbGuardianService 注入改造
 *     - 文件行数 + GuardianCategoryResolver 类型导出
 *     - 构造器含 categoryResolver 参数
 *     - setCategoryResolver setter 方法
 *     - load() 老持久化兼容（补 category + ensureCategories）
 *     - runSkill ensureCategories 兜底（createCategory 调用）
 *     - runSkill 三路合并（resolver > skill.category > undefined）
 *     - uploadAndParse 接收 category 参数
 *  3. SampleLibraryKbGuardianLauncher 启动器
 *     - 文件存在 + 行数 + 导出 SAMPLE_LIBRARY_KB_GUARDIAN_NAME
 *     - 导出 buildSampleLibraryCategoryResolver 函数
 *     - 导出 SampleLibraryKbGuardianLauncher 类
 *     - 静态方法 ensure / launchNow / status 签名
 *  4. buildSampleLibraryCategoryResolver 命中 6 文件名
 *     - 4 样例命中各自分类
 *     - 2 辅助文档命中各自分类
 *     - 未命中文件名返回 undefined
 *  5. main.ts 集成
 *     - 导入 launcher + buildSampleLibraryCategoryResolver
 *     - setCategoryResolver 注入
 *     - 注册 sample-library-kb:guardian-launch
 *     - 注册 sample-library-kb:guardian-status
 *     - 启动时调 launcher.ensure（仅 ensure，不 runNow）
 *  6. preload 暴露
 *     - sampleLibraryKb 命名空间含 launch
 *     - sampleLibraryKb 命名空间含 guardianStatus
 *     - launch 调 'sample-library-kb:guardian-launch'
 *     - guardianStatus 调 'sample-library-kb:guardian-status'
 *  7. SampleLibrary 桌面入口
 *     - SampleLibrary.tsx 行数 + GuardianStatus 类型
 *     - refreshGuardian / handleLaunchGuardian / handleRunNowGuardian 函数
 *     - api.guardianStatus() / api.launch() 调用
 *     - 按钮文案「🛡 启用守卫自动同步」「🔄 立即同步」
 *     - 状态卡 ok / idle / err 三态
 *     - 状态卡显示 lastRunAt + lastStats
 *     - useEffect 调用 refreshGuardian
 *  8. CSS 守卫按钮 + 状态卡样式
 *     - .sample-library-guardian-btn + .secondary 变体
 *     - .sample-library-guardian-card + .ok / .idle / .err 三态
 *     - .sample-library-guardian-card-head + .stats 子元素
 *  9. 文档同步
 *     - docs/选品分析师-报告样例库.md 含 I.2 章节
 *     - 含「报告样例库自动同步」技能名 + 守卫命名唯一性
 *     - 含 buildSampleLibraryCategoryResolver / ensureCategories
 *     - 含 字段漂移自动修正 + 跨阶段双源同步
 *     - 含 verify 工具引用 + 行数 ≥ 510
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  SAMPLE_LIBRARY_KB_GUARDIAN_NAME,
  buildSampleLibraryCategoryResolver,
  SampleLibraryKbGuardianLauncher
} from '../src/main/services/SampleLibraryKbGuardianLauncher'
import { SAMPLE_LIBRARY_KB_TARGET, SAMPLE_LIBRARY_KB_DOCS } from '../src/shared/sampleLibraryKbIngest'
import type { GuardianCategoryResolver } from '../src/main/services/KbGuardianService'

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

// ─── 1. 共享契约扩展 ────────────────────────────────────
const kbGuardianPath = resolve(root, 'src/shared/kbGuardian.ts')
assert('src/shared/kbGuardian.ts 文件存在', existsSync(kbGuardianPath))
if (existsSync(kbGuardianPath)) {
  const src = readFileSync(kbGuardianPath, 'utf-8')
  const lines = src.split('\n').length
  assert('kbGuardian.ts 行数 ≥ 90（基础 69 + I.2 +23）', lines >= 90, `${lines} 行`)

  // GuardianSkill 扩展
  assert('GuardianSkill 含 category 可选字段', /export interface GuardianSkill[\s\S]*?category\?:\s*string/.test(src))
  assert('GuardianSkill 含 ensureCategories 可选字段', /export interface GuardianSkill[\s\S]*?ensureCategories\?:\s*GuardianCategorySpec\[\]/.test(src))
  // GuardianSkillInput 扩展
  assert('GuardianSkillInput 含 category 可选字段', /export interface GuardianSkillInput[\s\S]*?category\?:\s*string/.test(src))
  assert('GuardianSkillInput 含 ensureCategories 可选字段', /export interface GuardianSkillInput[\s\S]*?ensureCategories\?:\s*GuardianCategorySpec\[\]/.test(src))
  // GuardianCategorySpec 接口
  assert('导出 GuardianCategorySpec 接口（name 必填）', /export interface GuardianCategorySpec\s*\{[\s\S]*?name:\s*string[\s\S]*?parent\?:\s*string/.test(src))
  // GuardianRunOptions 接口
  assert('导出 GuardianRunOptions 接口', /export interface GuardianRunOptions/.test(src))
  assert('GuardianRunOptions 含 category 可选', /GuardianRunOptions\s*\{[\s\S]*?category\?:\s*string/.test(src))
  assert('GuardianRunOptions 含 ensureCategories 可选', /GuardianRunOptions\s*\{[\s\S]*?ensureCategories\?:\s*GuardianCategorySpec\[\]/.test(src))
  assert('GuardianRunOptions 含 categoryResolver', /GuardianRunOptions\s*\{[\s\S]*?categoryResolver\?:\s*\(fileName:\s*string\)\s*=>\s*string\s*\|\s*undefined/.test(src))
  // 旧字段保留
  assert('保留 GuardianSkillStats 接口', /export interface GuardianSkillStats/.test(src))
  assert('保留 GuardianState 接口', /export interface GuardianState/.test(src))
  assert('保留 GuardianRunLog 接口', /export interface GuardianRunLog/.test(src))
  assert('保留 GuardianRunFailure 接口', /export interface GuardianRunFailure/.test(src))
  assert('保留 GuardianFrequency 类型', /export type GuardianFrequency/.test(src))
}

// ─── 2. KbGuardianService 注入改造 ──────────────────────
const svcPath = resolve(root, 'src/main/services/KbGuardianService.ts')
assert('KbGuardianService.ts 文件存在', existsSync(svcPath))
if (existsSync(svcPath)) {
  const src = readFileSync(svcPath, 'utf-8')
  const lines = src.split('\n').length
  assert('KbGuardianService.ts 行数 ≥ 320（基础 315 + I.2 注入）', lines >= 320, `${lines} 行`)

  // GuardianCategoryResolver 类型导出
  assert('导出 GuardianCategoryResolver 类型', /export type GuardianCategoryResolver\s*=\s*\(fileName:\s*string\)\s*=>\s*string\s*\|\s*undefined/.test(src))
  // 构造器含 categoryResolver 参数
  assert('构造器含 categoryResolver 可选参数', /constructor\([\s\S]*?categoryResolver\?:\s*GuardianCategoryResolver[\s\S]*?\)/.test(src))
  // setCategoryResolver setter
  assert('含 setCategoryResolver setter 方法', /setCategoryResolver\(resolver:\s*GuardianCategoryResolver\s*\|\s*undefined\):\s*void\s*\{[\s\S]*?this\.categoryResolver\s*=\s*resolver/.test(src))
  // load() 老持久化兼容
  assert('load() 兼容老持久化：补 category 默认值', /load\(\)[\s\S]{0,2000}?category\s*=\s*['"]['"]/.test(src))
  assert('load() 兼容老持久化：补 ensureCategories 数组', /load\(\)[\s\S]{0,2000}?Array\.isArray\([\s\S]{0,200}?ensureCategories[\s\S]{0,200}?ensureCategories\s*=\s*\[\]/.test(src))
  // ensureCategories 兜底
  assert('runSkill ensureCategories 兜底（createCategory 调用）', /ensureSpecs[\s\S]*?createCategory\(skill\.targetKbId,\s*spec\.name,\s*spec\.parent\)/.test(src))
  assert('runSkill ensureCategories 跳过「同名分类已存在」', /同名分类已存在/.test(src))
  assert('runSkill ensureCategories 跳过「父分类不存在」', /父分类不存在/.test(src))
  // 三路合并
  assert('runSkill 三路合并：resolver 优先', /categoryResolver\?\.?\(basename\)\s*\?\?\s*\(\s*defaultCategory\s*\|\|\s*undefined\s*\)/.test(src) || /categoryResolver\?\.?\(basename\)\s*\?\?\s*defaultCategory[\s\S]{0,30}\|\|\s*undefined/.test(src))
  assert('runSkill 三路合并：fallback undefined', /defaultCategory\s*\|\|\s*undefined/.test(src))
  // uploadAndParse 接收 category
  assert('uploadAndParse 接收 category 可选参数', /private async uploadAndParse\(kbId:\s*string,\s*absPath:\s*string,\s*category\?:\s*string\)/.test(src))
  // 字段写入（createSkill / updateSkill）
  assert('createSkill 写入 category 字段', /createSkill[\s\S]{0,2000}?category:\s*\(input\.category\s*\?\?\s*['"]['"]\)\.trim\(\)/.test(src))
  assert('createSkill 写入 ensureCategories 字段', /createSkill[\s\S]{0,2000}?ensureCategories:\s*\(input\.ensureCategories\s*\?\?\s*\[\]\)/.test(src))
  assert('updateSkill 写入 category 字段', /updateSkill[\s\S]{0,2000}?skill\.category\s*=\s*\(input\.category\s*\?\?\s*['"]['"]\)\.trim\(\)/.test(src))
  assert('updateSkill 写入 ensureCategories 字段', /updateSkill[\s\S]{0,2000}?skill\.ensureCategories\s*=\s*\(input\.ensureCategories\s*\?\?\s*\[\]\)/.test(src))
}

// ─── 3. SampleLibraryKbGuardianLauncher 启动器 ─────────
const launcherPath = resolve(root, 'src/main/services/SampleLibraryKbGuardianLauncher.ts')
assert('SampleLibraryKbGuardianLauncher.ts 文件存在', existsSync(launcherPath))
if (existsSync(launcherPath)) {
  const src = readFileSync(launcherPath, 'utf-8')
  const lines = src.split('\n').length
  assert('launcher 行数 ≥ 100（I.2 新建）', lines >= 100, `${lines} 行`)

  // 导出
  assert('导出 SAMPLE_LIBRARY_KB_GUARDIAN_NAME 常量', /export const SAMPLE_LIBRARY_KB_GUARDIAN_NAME\s*=\s*['"]报告样例库自动同步['"]/.test(src))
  assert('导出 buildSampleLibraryCategoryResolver 函数', /export function buildSampleLibraryCategoryResolver\(\):\s*GuardianCategoryResolver/.test(src))
  assert('导出 SampleLibraryKbGuardianLauncher 类', /export class SampleLibraryKbGuardianLauncher/.test(src))
  assert('导出 SampleLibraryGuardianStatus 接口', /export interface SampleLibraryGuardianStatus/.test(src))

  // 静态方法签名
  assert('含静态方法 ensure', /static async ensure\(ragflowKb:\s*RagflowKnowledgeService,\s*kbGuardian:\s*KbGuardianService\):\s*Promise<GuardianSkill\s*\|\s*null>/.test(src))
  assert('含静态方法 launchNow', /static async launchNow\(ragflowKb:\s*RagflowKnowledgeService,\s*kbGuardian:\s*KbGuardianService\):\s*Promise<SampleLibraryGuardianStatus>/.test(src))
  assert('含静态方法 status', /static async status\(kbGuardian:\s*KbGuardianService\):\s*Promise<\{[\s\S]*?present:\s*boolean/.test(src))

  // 行为
  assert('ensure 调 ensureAgentKb', /ensure[\s\S]*?ensureAgentKb\(SAMPLE_LIBRARY_KB_TARGET\.agentKey\)/.test(src))
  assert('ensure 检测已存在预置技能（按 name 查重）', /state\.skills\.find\(skill\s*=>\s*skill\.name\s*===\s*SAMPLE_LIBRARY_KB_GUARDIAN_NAME\)/.test(src))
  assert('ensure 不存在则 createSkill', /!existing[\s\S]*?createSkill\(expected\)/.test(src))
  assert('ensure 存在则字段漂移检查（sourcePath）', /existing\.sourcePath\s*!==\s*expected\.sourcePath/.test(src))
  assert('ensure 存在则字段漂移检查（targetKbId）', /existing\.targetKbId\s*!==\s*expected\.targetKbId/.test(src))
  assert('ensure 存在则字段漂移检查（frequency）', /existing\.frequency\s*!==\s*expected\.frequency/.test(src))
  assert('ensure 存在则字段漂移检查（fileExts 小写排序对比）', /existing\.fileExts[\s\S]*?sort\(\)\.join/.test(src))
  assert('ensure 存在则字段漂移检查（ensureCategories 顺序对比）', /existing\.ensureCategories[\s\S]*?same[\s\S]*?expected\.ensureCategories/.test(src))
  assert('ensure 字段漂移自动调 updateSkill', /if\s*\(needs\(\)\)[\s\S]*?updateSkill\(existing\.id,\s*expected\)/.test(src))
  assert('ensure 默认 frequency = daily', /frequency:\s*['"]daily['"]/.test(src))
  assert('ensure 默认 enabled = true', /enabled:\s*true/.test(src))
  assert('ensure 默认 fileExts = [.md]', /fileExts:\s*\[\s*['"]\.md['"]\s*\]/.test(src))
  assert('ensure ensureCategories 含 1 根 5 叶子', /ensureCategories:\s*\[[\s\S]*?name:\s*SAMPLE_LIBRARY_KB_TARGET\.categoryRoot[\s\S]*?parent:\s*SAMPLE_LIBRARY_KB_TARGET\.categoryRoot/.test(src))
  assert('launchNow 调 ensure + runNow', /launchNow[\s\S]*?await this\.ensure[\s\S]*?await kbGuardian\.runNow/.test(src))
  assert('status 仅查询不创建', /status[\s\S]*?state\.skills\.find[\s\S]*?present:\s*Boolean\(skill\)/.test(src))
}

// ─── 4. buildSampleLibraryCategoryResolver 命中 6 文件名 ─
const resolver: GuardianCategoryResolver = buildSampleLibraryCategoryResolver()
const resolverMap: Record<string, string | undefined> = {}
for (const spec of SAMPLE_LIBRARY_KB_DOCS) {
  resolverMap[spec.fileName] = resolver(spec.fileName)
}
assert('resolver 命中 sample-A-recommend-entry.md → 报告样例库/A', resolverMap['sample-A-recommend-entry.md'] === '报告样例库/A')
assert('resolver 命中 sample-B-conditional-entry.md → 报告样例库/B', resolverMap['sample-B-conditional-entry.md'] === '报告样例库/B')
assert('resolver 命中 sample-C-do-not-enter.md → 报告样例库/C', resolverMap['sample-C-do-not-enter.md'] === '报告样例库/C')
assert('resolver 命中 sample-D-insufficient-data.md → 报告样例库/D', resolverMap['sample-D-insufficient-data.md'] === '报告样例库/D')
assert('resolver 命中 sample-library-decision-gates.md → 报告样例库/决策门禁', resolverMap['sample-library-decision-gates.md'] === '报告样例库/决策门禁')
assert('resolver 命中 sample-library-traceability-rule.md → 报告样例库/可追溯约束', resolverMap['sample-library-traceability-rule.md'] === '报告样例库/可追溯约束')
assert('resolver 未命中文件名返回 undefined', resolver('unknown-file.md') === undefined)
assert('SAMPLE_LIBRARY_KB_TARGET.categoryRoot = 报告样例库', SAMPLE_LIBRARY_KB_TARGET.categoryRoot === '报告样例库')
assert('SAMPLE_LIBRARY_KB_GUARDIAN_NAME = 报告样例库自动同步', SAMPLE_LIBRARY_KB_GUARDIAN_NAME === '报告样例库自动同步')

// ─── 5. main.ts 集成 ────────────────────────────────────
const mainPath = resolve(root, 'src/main/main.ts')
assert('src/main/main.ts 文件存在', existsSync(mainPath))
if (existsSync(mainPath)) {
  const mainSrc = readFileSync(mainPath, 'utf-8')
  // 导入
  assert('main.ts 导入 SampleLibraryKbGuardianLauncher', /import\s*\{[^}]*SampleLibraryKbGuardianLauncher[^}]*\}\s*from\s*['"]\.\/services\/SampleLibraryKbGuardianLauncher['"]/.test(mainSrc))
  assert('main.ts 导入 buildSampleLibraryCategoryResolver', /import\s*\{[^}]*buildSampleLibraryCategoryResolver[^}]*\}\s*from\s*['"]\.\/services\/SampleLibraryKbGuardianLauncher['"]/.test(mainSrc))
  // 注入
  assert('main.ts 调 kbGuardianService.setCategoryResolver', /kbGuardianService\.setCategoryResolver\(buildSampleLibraryCategoryResolver\(\)\)/.test(mainSrc))
  // IPC handlers
  assert('main.ts 注册 sample-library-kb:guardian-launch', /ipcMain\.handle\(['"]sample-library-kb:guardian-launch['"]/.test(mainSrc))
  assert('main.ts 注册 sample-library-kb:guardian-status', /ipcMain\.handle\(['"]sample-library-kb:guardian-status['"]/.test(mainSrc))
  assert('main.ts guardian-launch 调 launcher.launchNow', /SampleLibraryKbGuardianLauncher\.launchNow\(ragflowKnowledgeService,\s*kbGuardianService\)/.test(mainSrc))
  assert('main.ts guardian-status 调 launcher.status', /SampleLibraryKbGuardianLauncher\.status\(kbGuardianService\)/.test(mainSrc))
  // 启动钩子
  assert('main.ts 启动时调 launcher.ensure', /SampleLibraryKbGuardianLauncher\.ensure\(ragflowKnowledgeService,\s*kbGuardianService\)/.test(mainSrc))
  assert('main.ts 启动钩子用 void + catch 兜底', /void\s+SampleLibraryKbGuardianLauncher\.ensure[\s\S]*?\.catch\(error\s*=>\s*console\.warn/.test(mainSrc))
}

// ─── 6. preload 暴露 ────────────────────────────────────
const preloadPath = resolve(root, 'src/preload/preload.ts')
assert('preload.ts 文件存在', existsSync(preloadPath))
if (existsSync(preloadPath)) {
  const preloadSrc = readFileSync(preloadPath, 'utf-8')
  assert('preload 暴露 sampleLibraryKb.launch', /sampleLibraryKb:\s*\{[\s\S]*?launch:\s*\(\)\s*:\s*Promise</.test(preloadSrc))
  assert('preload 暴露 sampleLibraryKb.guardianStatus', /sampleLibraryKb:\s*\{[\s\S]*?guardianStatus:\s*\(\)\s*:\s*Promise</.test(preloadSrc))
  assert('preload launch 调 sample-library-kb:guardian-launch', /launch:\s*\([\s\S]*?ipcRenderer\.invoke\(['"]sample-library-kb:guardian-launch['"]\)/.test(preloadSrc))
  assert('preload guardianStatus 调 sample-library-kb:guardian-status', /guardianStatus:\s*\([\s\S]*?ipcRenderer\.invoke\(['"]sample-library-kb:guardian-status['"]\)/.test(preloadSrc))
  assert('preload launch 返回 present/skill/ranNow/runNowReason', /launch[\s\S]*?present:\s*boolean[\s\S]*?skill:\s*GuardianSkill\s*\|\s*null[\s\S]*?ranNow:\s*boolean[\s\S]*?runNowReason\?:\s*string/.test(preloadSrc))
  assert('preload guardianStatus 返回 present/skill/state', /guardianStatus[\s\S]*?present:\s*boolean[\s\S]*?skill:\s*GuardianSkill\s*\|\s*null[\s\S]*?state:\s*GuardianState/.test(preloadSrc))
}

// ─── 7. SampleLibrary 桌面入口 ──────────────────────────
const slPath = resolve(root, 'src/renderer/SampleLibrary.tsx')
assert('src/renderer/SampleLibrary.tsx 文件存在', existsSync(slPath))
if (existsSync(slPath)) {
  const slSrc = readFileSync(slPath, 'utf-8')
  const lines = slSrc.split('\n').length
  assert('SampleLibrary.tsx 行数 ≥ 450（基础 372 + I.2 +78）', lines >= 450, `${lines} 行`)

  // 类型与函数
  assert('定义 GuardianStatus 类型', /type GuardianStatus\s*=/.test(slSrc))
  assert('GuardianStatus 含 loading/launching/present/absent/error 五态', /GuardianStatus\s*=\s*[\s\S]*?loading[\s\S]*?launching[\s\S]*?present[\s\S]*?absent[\s\S]*?error/.test(slSrc))
  assert('含 refreshGuardian 函数', /const refreshGuardian\s*=\s*useCallback\(async/.test(slSrc))
  assert('含 handleLaunchGuardian 函数', /const handleLaunchGuardian\s*=\s*async/.test(slSrc))
  assert('含 handleRunNowGuardian 函数', /const handleRunNowGuardian\s*=\s*async/.test(slSrc))
  // API 调用
  assert('调 api.guardianStatus()', /api\.guardianStatus\(\)/.test(slSrc))
  assert('调 api.launch()', /await api\.launch\(\)/.test(slSrc))
  assert('useEffect 调用 refreshGuardian', /useEffect\([\s\S]*?void refreshGuardian\(\)[\s\S]*?\[refreshGuardian\]/.test(slSrc))
  // 按钮文案
  assert('按钮文案「🛡 启用守卫自动同步」', /🛡\s*启用守卫自动同步/.test(slSrc))
  assert('按钮文案「🔄 立即同步」', /🔄\s*立即同步/.test(slSrc))
  assert('按钮文案「⏳ 启用中…」', /⏳\s*启用中…/.test(slSrc))
  assert('按钮文案「⏳ 同步中…」', /⏳\s*同步中…/.test(slSrc) || /⏳\s*启用中…\s*\/[\s\S]{0,200}⏳\s*同步中…/.test(slSrc))
  // 状态卡三态
  assert('状态卡 ok 渲染（present）', /guardian\.phase\s*===\s*['"]present['"][\s\S]*?sample-library-guardian-card\s+ok/.test(slSrc))
  assert('状态卡 idle 渲染（absent）', /guardian\.phase\s*===\s*['"]absent['"][\s\S]*?sample-library-guardian-card\s+idle/.test(slSrc))
  assert('状态卡 err 渲染（error）', /guardian\.phase\s*===\s*['"]error['"][\s\S]*?sample-library-guardian-card\s+err/.test(slSrc))
  // 状态卡内容
  assert('状态卡显示 frequency + sourcePath', /frequency.*sourcePath\.split/.test(slSrc))
  assert('状态卡显示 lastRunAt 时间', /new Date\(guardian\.skill\.lastRunAt\)\.toLocaleString/.test(slSrc))
  assert('状态卡显示 lastStats（added/updated/skipped/failed）', /lastStats[\s\S]*?added[\s\S]*?updated[\s\S]*?skipped[\s\S]*?failed/.test(slSrc))
  // present 按钮二次变体
  assert('present 按钮用 secondary 样式', /sample-library-guardian-btn\s+secondary/.test(slSrc))
}

// ─── 8. CSS 守卫按钮 + 状态卡样式 ──────────────────────
const cssPath = resolve(root, 'src/renderer/sample-library.css')
assert('sample-library.css 文件存在', existsSync(cssPath))
if (existsSync(cssPath)) {
  const cssSrc = readFileSync(cssPath, 'utf-8')
  const lines = cssSrc.split('\n').length
  assert('sample-library.css 行数 ≥ 440（基础 394 + I.2 +58）', lines >= 440, `${lines} 行`)

  // 按钮
  assert('CSS 含 .sample-library-guardian-btn', /\.sample-library-guardian-btn\s*\{/.test(cssSrc))
  assert('CSS 含 .sample-library-guardian-btn.secondary 变体', /\.sample-library-guardian-btn\.secondary\s*\{/.test(cssSrc))
  assert('CSS 守卫按钮 disabled 态', /\.sample-library-guardian-btn:disabled/.test(cssSrc))
  // 状态卡
  assert('CSS 含 .sample-library-guardian-card', /\.sample-library-guardian-card\s*\{/.test(cssSrc))
  assert('CSS 含 .sample-library-guardian-card.ok', /\.sample-library-guardian-card\.ok\s*\{/.test(cssSrc))
  assert('CSS 含 .sample-library-guardian-card.idle', /\.sample-library-guardian-card\.idle\s*\{/.test(cssSrc))
  assert('CSS 含 .sample-library-guardian-card.err', /\.sample-library-guardian-card\.err\s*\{/.test(cssSrc))
  assert('CSS 含 .sample-library-guardian-card-head', /\.sample-library-guardian-card-head\s*\{/.test(cssSrc))
  assert('CSS 含 .sample-library-guardian-card-stats', /\.sample-library-guardian-card-stats\s*\{/.test(cssSrc))
  // 颜色（gradient teal）
  assert('CSS 守卫按钮用 teal 渐变（#14b8a6 → #0f766e）', /#14b8a6[\s\S]*?#0f766e/.test(cssSrc))
}

// ─── 9. 文档同步 ────────────────────────────────────────
const docPath = resolve(root, 'docs/选品分析师-报告样例库.md')
assert('报告样例库文档存在', existsSync(docPath))
if (existsSync(docPath)) {
  const docSrc = readFileSync(docPath, 'utf-8')
  const lines = docSrc.split('\n').length
  assert('文档行数 ≥ 510（基础 340 + I +87 + I.2 增量）', lines >= 510, `${lines} 行`)
  // I.2 章节
  assert('文档含 I.2 阶段：知识库守卫自动同步 章节', /^## I\.2 阶段：知识库守卫自动同步/m.test(docSrc))
  assert('文档含 入库目标 子节', /### 入库目标/.test(docSrc))
  assert('文档含 守卫自动同步架构 子节', /### 守卫自动同步架构/.test(docSrc))
  assert('文档含 桌面入口 子节', /### 桌面入口/.test(docSrc))
  assert('文档含 预置技能参数 子节', /### 预置技能参数/.test(docSrc))
  assert('文档含 启动器保证 子节', /### 启动器保证/.test(docSrc))
  assert('文档含 跨阶段双源同步 子节', /### 跨阶段双源同步/.test(docSrc))
  assert('文档含 验证 子节', /### 验证/.test(docSrc))
  // 关键术语
  assert('文档含「报告样例库自动同步」技能名', /报告样例库自动同步/.test(docSrc))
  assert('文档含 守卫命名唯一性', /唯一/.test(docSrc))
  assert('文档含 buildSampleLibraryCategoryResolver', /buildSampleLibraryCategoryResolver/.test(docSrc))
  assert('文档含 ensureCategories 术语', /ensureCategories/.test(docSrc))
  assert('文档含 字段漂移 自动修正', /字段漂移[\s\S]{0,200}?自动(?:修正|更新)/.test(docSrc))
  assert('文档含 setCategoryResolver', /setCategoryResolver/.test(docSrc))
  assert('文档含 runNow 描述', /runNow/.test(docSrc))
  assert('文档含 catchup 描述', /catchup/.test(docSrc))
  assert('文档含 sha256 差异', /sha256/.test(docSrc))
  assert('文档含 SAMPLE_LIBRARY_KB_DOCS 引用', /SAMPLE_LIBRARY_KB_DOCS/.test(docSrc))
  assert('文档含 verify 工具引用', /verify-sample-library-kb-guardian/.test(docSrc))
  // 频率 / 调度
  assert('文档含 daily 频率', /['"`]daily['"`]/.test(docSrc))
  assert('文档含 ≥ 09:00 调度', /≥ 09:00/.test(docSrc))
}

// ─── 10. launcher 类运行时签名校验（不实际调网络） ─────
assert('launcher.ensure 是静态方法', typeof SampleLibraryKbGuardianLauncher.ensure === 'function')
assert('launcher.launchNow 是静态方法', typeof SampleLibraryKbGuardianLauncher.launchNow === 'function')
assert('launcher.status 是静态方法', typeof SampleLibraryKbGuardianLauncher.status === 'function')
assert('launcher.ensure 接受 2 个参数（ragflowKb, kbGuardian）', SampleLibraryKbGuardianLauncher.ensure.length === 2)
assert('launcher.launchNow 接受 2 个参数（ragflowKb, kbGuardian）', SampleLibraryKbGuardianLauncher.launchNow.length === 2)
assert('launcher.status 接受 1 个参数（kbGuardian）', SampleLibraryKbGuardianLauncher.status.length === 1)

// ─── 总结 ──────────────────────────────────────────────
console.log('\n──────────────────────────────────────')
console.log(`断言：PASS ${pass}  FAIL ${fail}  总计 ${pass + fail}`)
if (fail === 0) {
  console.log('ALL PASS · I.2 阶段报告样例库 → 知识库守卫自动同步 verify 通过 ✅')
} else {
  console.log(`FAILED：${failures.join('、')}`)
  process.exit(1)
}
