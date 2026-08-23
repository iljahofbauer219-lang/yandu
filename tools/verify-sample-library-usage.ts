/**
 * I.4 阶段：报告样例库 KB 引用提示闭环 verify 工具。
 *
 * 验证项（9 大组 / 80+ 断言）：
 *  1. 共享契约扩展：SAMPLE_LIBRARY_KB_REFERENCE_PROMPT 常量 + 4 样例 / 决策门禁 / 可追溯约束关键词 + AiEmployeeAskRequest.useSampleLibrary 字段
 *  2. 主进程提示词注入：import 常量 + withKbReference helper + 4 处 content 构造（maxkbChat / ragflow-agent / listing-agent / fallback）+ directChat 不注入
 *  3. 渲染层 state + 持久化：SAMPLE_LIB_DEFAULT_BY_POSITION 6 岗位映射 + SAMPLE_LIB_STORAGE_KEY + useState 初始值 + localStorage.setItem 写回
 *  4. 3 处 send 调用差异化：enrichment + 主调用 传 useSampleLibrary；repair 不传
 *  5. UI 渲染：placeholder 切换 + 📚 引用报告样例库 label + on 类切换
 *  6. CSS 样式：iOS switch（28×16 圆角 + on 状态 #14b8a6 + translateX(12px)）+ hover + label 样式
 *  7. 设计 token 复用：var(--bg-soft) / var(--border-soft) / var(--text-secondary) 等
 *  8. 可访问性：aria-label="引用报告样例库" + title 提示 + input checkbox 视觉隐藏但可聚焦
 *  9. 文档同步：报告样例库文档 I.4 章节存在 + 7 个必备小节
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

// ─── 1. 共享契约扩展 ──────────────────────────────────────
const ingestPath = resolve(root, 'src/shared/sampleLibraryKbIngest.ts')
assert('src/shared/sampleLibraryKbIngest.ts 文件存在', existsSync(ingestPath))
if (existsSync(ingestPath)) {
  const src = readFileSync(ingestPath, 'utf-8')
  const lines = src.split('\n').length
  assert('sampleLibraryKbIngest.ts 行数 ≥ 200（I.4 加 KB 引用提示词常量）', lines >= 200, `${lines} 行`)

  // 1.1 SAMPLE_LIBRARY_KB_REFERENCE_PROMPT 常量
  assert('导出 SAMPLE_LIBRARY_KB_REFERENCE_PROMPT 常量', /export const SAMPLE_LIBRARY_KB_REFERENCE_PROMPT\s*=\s*\[/.test(src))

  // 1.2 提示词内容含 4 样例 / 决策门禁 / 可追溯约束关键词
  const promptMatch = src.match(/SAMPLE_LIBRARY_KB_REFERENCE_PROMPT\s*=\s*\[([\s\S]*?)\]\.join/)
  const promptBody = promptMatch ? promptMatch[1] : ''
  assert('KB 引用提示词含「报告样例库」关键词', /报告样例库/.test(promptBody), `body 长度=${promptBody.length} 字符`)
  assert('KB 引用提示词含「A、B、C、D」4 样例', /A[、，,]\s*B[、，,]\s*C[、，,]\s*D/.test(promptBody))
  assert('KB 引用提示词含「决策门禁」', /决策门禁/.test(promptBody))
  assert('KB 引用提示词含「可追溯约束」', /可追溯约束/.test(promptBody))
  assert('KB 引用提示词含「RAGFlow 知识库」或「知识库」', /知识库/.test(promptBody))
  assert('KB 引用提示词含「6 段结构」', /6\s*段结构/.test(promptBody))
  assert('KB 引用提示词含「参考样例 X」期望行为', /参考样例/.test(promptBody))
  assert('KB 引用提示词含「系统提示」前缀', /\[系统提示\]/.test(promptBody))
}

const aiEmployeeSharedPath = resolve(root, 'src/shared/aiEmployee.ts')
assert('src/shared/aiEmployee.ts 文件存在', existsSync(aiEmployeeSharedPath))
if (existsSync(aiEmployeeSharedPath)) {
  const src = readFileSync(aiEmployeeSharedPath, 'utf-8')
  // 1.3 AiEmployeeAskRequest.useSampleLibrary 字段
  assert('AiEmployeeAskRequest 含 useSampleLibrary 可选字段',
    /export interface AiEmployeeAskRequest\s*\{[\s\S]*?useSampleLibrary\?:\s*boolean[\s\S]*?\}/.test(src))
  // 注释说明（在 useSampleLibrary 字段之前）
  assert('useSampleLibrary 字段带 I.4 阶段说明注释（仅对 RAGFlow 智能体链路生效）',
    /useSampleLibrary\?:\s*boolean/.test(src) &&
    /I\.4\s*阶段新增[\s\S]{0,200}?报告样例库[\s\S]{0,500}?RAGFlow[\s\S]{0,200}?useSampleLibrary\?:\s*boolean/.test(src))
}

// ─── 2. 主进程提示词注入 ──────────────────────────────────
const chatSvcPath = resolve(root, 'src/main/services/AiEmployeeChatService.ts')
assert('AiEmployeeChatService.ts 文件存在', existsSync(chatSvcPath))
if (existsSync(chatSvcPath)) {
  const src = readFileSync(chatSvcPath, 'utf-8')
  const lines = src.split('\n').length
  assert('AiEmployeeChatService.ts 行数 ≥ 600', lines >= 600, `${lines} 行`)

  // 2.1 import 常量
  assert('import SAMPLE_LIBRARY_KB_REFERENCE_PROMPT from sampleLibraryKbIngest',
    /import\s*\{[^}]*SAMPLE_LIBRARY_KB_REFERENCE_PROMPT[^}]*\}\s*from\s*['"]\.\.\/\.\.\/shared\/sampleLibraryKbIngest['"]/.test(src))

  // 2.2 withKbReference helper
  assert('含 withKbReference helper 闭包定义',
    /const\s+withKbReference\s*=\s*\(content:\s*string\)\s*=>\s*request\.useSampleLibrary/.test(src))
  assert('withKbReference 在 useSampleLibrary=true 时追加提示词',
    /withKbReference[\s\S]{0,300}?request\.useSampleLibrary\s*\?[\s\S]{0,300}?SAMPLE_LIBRARY_KB_REFERENCE_PROMPT/.test(src))
  assert('withKbReference 在 useSampleLibrary=false 时原样透传',
    /withKbReference\s*=\s*\(content:\s*string\)\s*=>\s*request\.useSampleLibrary\s*\?\s*`\$\{content\}[\s\S]{0,200}?:\s*content/.test(src))
  // 注释「I.4 阶段新增」
  assert('withKbReference 附近带 I.4 阶段注释',
    /I\.4\s*阶段新增[\s\S]{0,200}?withKbReference/.test(src))

  // 2.3 4 处 content 构造调用 helper
  const withKbRefCalls = src.match(/withKbReference\(\[request\.query/g) || []
  assert('4 处 content 构造调用 withKbReference（maxkbChat / ragflow-agent / listing-agent / fallback）',
    withKbRefCalls.length === 4, `实际 ${withKbRefCalls.length} 处`)

  // 2.4 directChat 不注入
  const directChatBlock = src.match(/private\s+async\s+directChat[\s\S]{0,3000}?return\s+await\s+this\.callOpenAiCompatible/) ||
    src.match(/private\s+async\s+directChat[\s\S]{0,3000}?return\s+await\s+this\.openai/) ||
    src.match(/private\s+async\s+directChat[\s\S]{0,5000}?}/)
  if (directChatBlock) {
    const directBlock = directChatBlock[0]
    assert('directChat 不调用 withKbReference（直连模型不注入）',
      !/withKbReference/.test(directBlock))
  } else {
    assert('directChat 函数存在（无法定位跳过 not-injected 断言）', false)
  }
}

// ─── 3. 渲染层 state + 持久化 ─────────────────────────────
const aiEmployeePagePath = resolve(root, 'src/renderer/AIEmployee.tsx')
assert('src/renderer/AIEmployee.tsx 文件存在', existsSync(aiEmployeePagePath))
if (existsSync(aiEmployeePagePath)) {
  const src = readFileSync(aiEmployeePagePath, 'utf-8')
  const lines = src.split('\n').length
  assert('AIEmployee.tsx 行数 ≥ 1750（I.4 加 state + UI）', lines >= 1750, `${lines} 行`)

  // 3.1 SAMPLE_LIB_DEFAULT_BY_POSITION 6 岗位
  assert('SAMPLE_LIB_DEFAULT_BY_POSITION 常量定义',
    /const\s+SAMPLE_LIB_DEFAULT_BY_POSITION:\s*Record<string,\s*boolean>\s*=/.test(src))
  assert('SAMPLE_LIB_DEFAULT_BY_POSITION 含「选品调研员: true」', /选品调研员:\s*true/.test(src))
  assert('SAMPLE_LIB_DEFAULT_BY_POSITION 含「Listing精造师: true」', /['"]Listing精造师['"]:\s*true/.test(src))
  assert('SAMPLE_LIB_DEFAULT_BY_POSITION 含「知识库守卫: false」', /知识库守卫:\s*false/.test(src))
  assert('SAMPLE_LIB_DEFAULT_BY_POSITION 含「竞品分析员: false」', /竞品分析员:\s*false/.test(src))
  assert('SAMPLE_LIB_DEFAULT_BY_POSITION 含「产品定价员: false」', /产品定价员:\s*false/.test(src))
  assert('SAMPLE_LIB_DEFAULT_BY_POSITION 含「类目优选员: false」', /类目优选员:\s*false/.test(src))

  // 3.2 SAMPLE_LIB_STORAGE_KEY
  assert('SAMPLE_LIB_STORAGE_KEY 按岗位隔离（key 模板含 position）',
    /const\s+SAMPLE_LIB_STORAGE_KEY\s*=\s*`aiEmployee:useSampleLibrary:\$\{position\}`/.test(src))

  // 3.3 useState 初始值读取逻辑
  assert('useState 初始值闭包用 useState<boolean>(() => ...)',
    /const\s+\[useSampleLibrary,\s*setUseSampleLibrary\]\s*=\s*useState<boolean>\(\(\)\s*=>/.test(src))
  assert('useState 初始值读 localStorage.getItem(SAMPLE_LIB_STORAGE_KEY)',
    /useState<boolean>\([\s\S]{0,300}?localStorage\.getItem\(SAMPLE_LIB_STORAGE_KEY\)/.test(src))
  assert('useState 初始值识别 stored === "1" → true',
    /stored\s*===\s*['"]1['"]\s*\) return true/.test(src))
  assert('useState 初始值识别 stored === "0" → false',
    /stored\s*===\s*['"]0['"]\s*\) return false/.test(src))
  assert('useState 初始值 fallback 岗位默认值 SAMPLE_LIB_DEFAULT_BY_POSITION[position] ?? false',
    /return\s+SAMPLE_LIB_DEFAULT_BY_POSITION\[position\]\s*\?\?\s*false/.test(src))
  assert('useState 初始值 try/catch 吞 storage 错误',
    /useState<boolean>\([\s\S]{0,500}?try\s*\{[\s\S]{0,200}?\}\s*catch\s*\{\s*\/\*\s*ignore storage errors\s*\*\/\s*\}/.test(src))

  // 3.4 handleToggleUseSampleLibrary 写回
  assert('handleToggleUseSampleLibrary 调 setUseSampleLibrary(next)',
    /const\s+handleToggleUseSampleLibrary\s*=\s*\(next:\s*boolean\)\s*=>\s*\{[\s\S]{0,200}?setUseSampleLibrary\(next\)/.test(src))
  assert('handleToggleUseSampleLibrary 调 localStorage.setItem 写回',
    /handleToggleUseSampleLibrary[\s\S]{0,500}?localStorage\.setItem\(SAMPLE_LIB_STORAGE_KEY,\s*next\s*\?\s*['"]1['"]\s*:\s*['"]0['"]\)/.test(src))
  assert('handleToggleUseSampleLibrary 写回包 try/catch 吞 quota',
    /handleToggleUseSampleLibrary[\s\S]{0,500}?localStorage\.setItem[\s\S]{0,300}?\}\s*catch\s*\{\s*\/\*\s*ignore quota errors\s*\*\/\s*\}/.test(src))
}

// ─── 4. 3 处 send 调用差异化 ──────────────────────────────
if (existsSync(aiEmployeePagePath)) {
  const src = readFileSync(aiEmployeePagePath, 'utf-8')

  // 4.1 enrichment 传 useSampleLibrary（L1196 附近）
  // 查找 window.desktop.aiEmployee.ask 调用，统计传 useSampleLibrary 的次数
  const askCalls = src.match(/window\.desktop\.aiEmployee\.ask\s*\(\s*\{[\s\S]*?\}\s*\)/g) || []
  let askWithUseSample = 0
  let askWithoutUseSample = 0
  for (const call of askCalls) {
    if (/\buseSampleLibrary\b/.test(call)) askWithUseSample += 1
    else askWithoutUseSample += 1
  }
  assert('window.desktop.aiEmployee.ask 调用总数 = 3（enrichment + 主调用 + repair）',
    askCalls.length === 3, `实际 ${askCalls.length} 处`)
  assert('2 处 aiEmployee.ask 传 useSampleLibrary（enrichment + 主调用）',
    askWithUseSample === 2, `实际 ${askWithUseSample} 处`)
  assert('1 处 aiEmployee.ask 不传 useSampleLibrary（repair）',
    askWithoutUseSample === 1, `实际 ${askWithoutUseSample} 处`)

  // 4.2 enrichment 调用带 I.4 注释（在 useSampleLibrary 之前）
  assert('enrichment 调用带 I.4 阶段注释（说明报告增强也参考 KB）',
    /I\.4\s*阶段新增[\s\S]{0,200}?报告增强[\s\S]{0,200}?useSampleLibrary[\s\S]{0,500}?\}\s*\)/.test(src))
}

// ─── 5. UI 渲染 ──────────────────────────────────────────
if (existsSync(aiEmployeePagePath)) {
  const src = readFileSync(aiEmployeePagePath, 'utf-8')

  // 5.1 placeholder 切换
  assert('textarea placeholder 根据 useSampleLibrary 切换文案',
    /placeholder=\{useSampleLibrary[\s\S]{0,200}?已启用报告样例库参考[\s\S]{0,500}?\}\s*\}/.test(src))
  assert('placeholder 包含「已启用报告样例库参考」前/后缀',
    /已启用报告样例库参考/.test(src))

  // 5.2 label 文字
  assert('label 含「📚 引用报告样例库」标题',
    /<b>📚 引用报告样例库<\/b>/.test(src))
  assert('label 含「参考 4 样例 + 决策门禁 + 可追溯约束」副标题',
    /参考 4 样例 \+ 决策门禁 \+ 可追溯约束/.test(src))

  // 5.3 on 类切换
  assert('label className 含 on 类切换（useSampleLibrary ? " on" : ""）',
    /className=\{`ai-employee-sample-lib-toggle\$\{useSampleLibrary\s*\?\s*['"]\s*on['"]\s*:\s*['"]['"]\}`\}/.test(src))
}

// ─── 6. CSS 样式 ─────────────────────────────────────────
const cssPath = resolve(root, 'src/renderer/ai-employee.css')
assert('src/renderer/ai-employee.css 文件存在', existsSync(cssPath))
if (existsSync(cssPath)) {
  const src = readFileSync(cssPath, 'utf-8')

  // 6.1 主类名
  assert('含 .ai-employee-sample-lib-toggle 主类',
    /\.ai-employee-sample-lib-toggle\s*\{/.test(src))

  // 6.2 iOS switch 尺寸
  assert('switch 尺寸 28×16 圆角（width:28px / height:16px / border-radius:999px）',
    /\.ai-employee-sample-lib-toggle\s+\.ai-employee-sample-lib-switch\s*\{[\s\S]{0,500}?width:\s*28px[\s\S]{0,200}?height:\s*16px[\s\S]{0,200}?border-radius:\s*999px/.test(src))

  // 6.3 on 状态 #14b8a6 背景
  assert('on 状态 switch 背景 #14b8a6',
    /\.ai-employee-sample-lib-toggle\.on\s+\.ai-employee-sample-lib-switch\s*\{[\s\S]{0,200}?background:\s*#14b8a6/.test(src))

  // 6.4 handle 圆形 + translateX(12px) 切换
  assert('handle 圆形 12×12',
    /\.ai-employee-sample-lib-switch::after\s*\{[\s\S]{0,500}?width:\s*12px[\s\S]{0,200}?height:\s*12px[\s\S]{0,200}?border-radius:\s*50%/.test(src))
  assert('on 状态 handle translateX(12px) 切换',
    /\.ai-employee-sample-lib-toggle\.on\s+\.ai-employee-sample-lib-switch::after\s*\{[\s\S]{0,200}?transform:\s*translateX\(12px\)/.test(src))

  // 6.5 hover
  assert('label hover 状态 border-color: var(--accent)',
    /\.ai-employee-sample-lib-toggle:hover\s*\{[\s\S]{0,200}?border-color:\s*var\(--accent\)/.test(src))

  // 6.6 label 文字样式
  assert('label b 字号 10px + 粗体 + 主色',
    /\.ai-employee-sample-lib-toggle\s+\.ai-employee-sample-lib-label\s+b\s*\{[\s\S]{0,500}?font-size:\s*10px[\s\S]{0,200}?font-weight:\s*700/.test(src))
  assert('label small 字号 9px + 副色',
    /\.ai-employee-sample-lib-toggle\s+\.ai-employee-sample-lib-label\s+small\s*\{[\s\S]{0,500}?font-size:\s*9px[\s\S]{0,200}?color:\s*var\(--text-secondary\)/.test(src))
  assert('on 状态 label b 颜色 #0d9488',
    /\.ai-employee-sample-lib-toggle\.on\s+\.ai-employee-sample-lib-label\s+b\s*\{[\s\S]{0,200}?color:\s*#0d9488/.test(src))

  // 6.7 on 状态容器（青绿描边 + 淡青绿底）
  assert('on 状态容器 border-color: #14b8a6 + 淡青绿底',
    /\.ai-employee-sample-lib-toggle\.on\s*\{[\s\S]{0,200}?border-color:\s*#14b8a6[\s\S]{0,200}?background:\s*rgba\(20,\s*184,\s*166,\s*0\.10\)/.test(src))
}

// ─── 7. 设计 token 复用 ─────────────────────────────────
if (existsSync(cssPath)) {
  const src = readFileSync(cssPath, 'utf-8')

  // 7.1 主类复用 var(--border-soft) / var(--bg-soft)
  assert('label 复用 var(--border-soft) 描边',
    /\.ai-employee-sample-lib-toggle\s*\{[\s\S]{0,500}?border:\s*1px solid var\(--border-soft\)/.test(src))
  assert('label 复用 var(--bg-soft) 底色',
    /\.ai-employee-sample-lib-toggle\s*\{[\s\S]{0,500}?background:\s*var\(--bg-soft\)/.test(src))
  assert('label 复用 var(--text-secondary) 副色',
    /\.ai-employee-sample-lib-toggle\s+\.ai-employee-sample-lib-label\s*\{[\s\S]{0,500}?color:\s*var\(--text-secondary\)/.test(src))
  assert('label 复用 var(--text-primary) 主色',
    /\.ai-employee-sample-lib-toggle\s+\.ai-employee-sample-lib-label\s+b\s*\{[\s\S]{0,500}?color:\s*var\(--text-primary\)/.test(src))
}

// ─── 8. 可访问性 ─────────────────────────────────────────
if (existsSync(aiEmployeePagePath)) {
  const src = readFileSync(aiEmployeePagePath, 'utf-8')

  // 8.1 aria-label
  assert('input 含 aria-label="引用报告样例库"',
    /aria-label="引用报告样例库"/.test(src))

  // 8.2 title 提示（双态：已启用 / 未启用）
  assert('label 含 title 提示（双态：已启用 / 未启用）',
    /title=\{useSampleLibrary[\s\S]{0,200}?已启用[\s\S]{0,500}?未启用/.test(src))

  // 8.3 input checkbox 视觉隐藏但可聚焦（CSS 规则，在 cssPath 里查）
  if (existsSync(cssPath)) {
    const cssSrc = readFileSync(cssPath, 'utf-8')
    const inputCheckboxBlock = cssSrc.match(/\.ai-employee-sample-lib-toggle\s+input\[type="checkbox"\][^{]*\{([\s\S]*?)\}/)
    assert('input[type="checkbox"] 块存在', inputCheckboxBlock !== null)
    if (inputCheckboxBlock) {
      const blockBody = inputCheckboxBlock[1]
      assert('input checkbox 视觉隐藏（opacity: 0 + width/height: 0）',
        /opacity:\s*0/.test(blockBody) && /width:\s*0/.test(blockBody) && /height:\s*0/.test(blockBody))
      assert('input checkbox pointer-events: none（视觉隐藏后切走鼠标事件）',
        /pointer-events:\s*none/.test(blockBody))
    }
  } else {
    assert('input[type="checkbox"] 块存在（cssPath 不可用）', false)
  }

  // 8.4 switch 用 aria-hidden（避免重复读屏）
  assert('switch 用 span + aria-hidden="true"（避免读屏重复）',
    /aria-hidden="true"\s*\/>\s*[\s\S]{0,200}?ai-employee-sample-lib-label/.test(src))
}

// ─── 9. 文档同步 ─────────────────────────────────────────
const docPath = resolve(root, 'docs/选品分析师-报告样例库.md')
assert('docs/选品分析师-报告样例库.md 文件存在', existsSync(docPath))
if (existsSync(docPath)) {
  const src = readFileSync(docPath, 'utf-8')
  const lines = src.split('\n').length
  assert('报告样例库文档行数 ≥ 600（I.4 +123 行）', lines >= 600, `${lines} 行`)

  // 9.1 I.4 章节存在
  assert('文档含「I.4 阶段」章节标题', /## I\.4\s*阶段[：:]\s*报告样例库 KB 引用提示闭环/.test(src))

  // 9.2 7 个必备小节
  assert('含「入库目标」小节', /### 入库目标/.test(src))
  assert('含「KB 引用闭环架构」小节（含架构图）', /### KB 引用闭环架构/.test(src))
  assert('含「桌面入口」小节', /### 桌面入口/.test(src))
  assert('含「持久化策略」小节', /### 持久化策略/.test(src))
  assert('含「提示词模板」小节', /### 提示词模板/.test(src))
  assert('含「跨阶段双源同步」小节', /### 跨阶段双源同步/.test(src))
  assert('含「验证」小节（含 verify-sample-library-usage.ts 引用）', /### 验证[\s\S]{0,500}?verify-sample-library-usage\.ts/.test(src))

  // 9.3 架构图含 RAGFlow / 选品分析师 / 4 样例关键词
  assert('I.4 章节含 RAGFlow 智能体关键词', /I\.4 阶段[\s\S]{0,5000}?RAGFlow/.test(src))
  assert('I.4 章节含「选品分析师」知识库关键词', /I\.4 阶段[\s\S]{0,5000}?选品分析师/.test(src))
  assert('I.4 章节含 4 样例 A/B/C/D', /I\.4 阶段[\s\S]{0,5000}?A[、，,]\s*B[、，,]\s*C[、，,]\s*D/.test(src))

  // 9.4 双源同步
  assert('I.4 章节含「src/shared/sampleLibraryKbIngest.ts」双源同步引用',
    /I\.4 阶段[\s\S]{0,5000}?src\/shared\/sampleLibraryKbIngest\.ts/.test(src))
  assert('I.4 章节含「src/shared/aiEmployee.ts」双源同步引用',
    /I\.4 阶段[\s\S]{0,5000}?src\/shared\/aiEmployee\.ts/.test(src))
  assert('I.4 章节含「src/renderer/AIEmployee.tsx」双源同步引用',
    /I\.4 阶段[\s\S]{0,5000}?src\/renderer\/AIEmployee\.tsx/.test(src))
  assert('I.4 章节含「src/renderer/ai-employee.css」双源同步引用',
    /I\.4 阶段[\s\S]{0,5000}?src\/renderer\/ai-employee\.css/.test(src))
}

// ─── 总结 ────────────────────────────────────────────────
console.log('\n────────────────────────────────────────')
console.log(`总计：${pass + fail} 断言  PASS=${pass}  FAIL=${fail}`)
if (fail > 0) {
  console.log('失败项：')
  for (const name of failures) console.log(`  - ${name}`)
  process.exit(1)
}
process.exit(0)
