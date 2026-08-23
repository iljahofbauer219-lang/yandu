#!/usr/bin/env node
/**
 * AI员工输入栏布局回归：独立工作台（position 固定岗位、角色 chips 移除）+ 平台快捷选择。
 * 环境无 node 时用 Electron 代跑：
 *   export ELECTRON_RUN_AS_NODE=1
 *   "$ELECTRON" node_modules/typescript/bin/tsc tools/verify-composer-layout.ts --outDir .tmp-ui-verify/composer-out --module commonjs --target es2020 --esModuleInterop --skipLibCheck --moduleResolution node
 *   LISTING_REPO_ROOT=$PWD "$ELECTRON" .tmp-ui-verify/composer-out/tools/verify-composer-layout.js
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SELECTION_ANALYSIS_REQUEST, applyPlatformToRequest } from '../src/shared/selectionExtract'

let failures = 0
const assert = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures++
}

const root = process.env.LISTING_REPO_ROOT || join(__dirname, '..', '..')
const tsx = readFileSync(join(root, 'src/renderer/AIEmployee.tsx'), 'utf-8')
const css = readFileSync(join(root, 'src/renderer/ai-employee.css'), 'utf-8')
const app = readFileSync(join(root, 'src/renderer/App.tsx'), 'utf-8')

// ─── 1. 角色 chips 新阵容 ────────────────────────────────────────
assert('含竞品分析员', tsx.includes("name: '竞品分析员'"))
assert('含产品定价员', tsx.includes("name: '产品定价员'"))
assert('含类目优选员', tsx.includes("name: '类目优选员'"))
assert('旧占位角色已移除', !tsx.includes("name: 'AI合规顾问'") && !tsx.includes("name: 'AI运营助理'") && !tsx.includes("name: 'Listing精造师'"))
assert('选品分析师仍可用', /name: '选品调研员'[\s\S]{0,120}ready: true/.test(tsx))
assert('新角色为占位灰态', /name: '竞品分析员'[\s\S]{0,120}ready: false/.test(tsx))

// ─── 2. 独立工作台：position 固定岗位，角色 chips 行作跨工作台导航 ──
assert('角色 chips 行已恢复', tsx.includes('ai-employee-role-chips') && css.includes('.ai-employee-role-chip'))
assert('chips 当前岗位高亮', tsx.includes("agent.name === position ? ' active'"))
assert('chips 跳转独立工作台', tsx.includes('onNavigatePosition?.(agent.name)') && app.includes('onNavigatePosition={navigateEmployeePosition}'))
assert('占位员工灰态不可点', tsx.includes('disabled={!agent.ready}'))
assert('chips 可用员工不互列', tsx.includes('AGENTS.filter(agent => agent.name === position || !agent.ready)'))
assert('composer 无参渲染', tsx.includes('const renderComposer = () =>') && !tsx.includes('renderComposer(true)'))
assert('岗位由 position 固定', tsx.includes("position = '选品调研员'") && tsx.includes('const agentName = position'))
assert('位置徽章按 position 渲染', tsx.includes('当前岗位：${position}'))
assert('工作档案按岗位隔离', tsx.includes('item.roleName === position'))
assert('模型选择按岗位持久化', tsx.includes('`${CHAT_MODEL_KEY}:${position}`'))
assert('守卫首页示例提问定制', tsx.includes('POSITION_SUGGESTIONS'))
assert('Tab 栏按岗位裁剪', tsx.includes("const showWorkbenchTab = position === 'Listing精造师'") && tsx.includes("const showBrowserTab = position === '选品调研员'"))
assert('选品工具按岗位裁剪', tsx.includes('const showSelectionTools = position ===') && tsx.includes('{showSelectionTools && PLATFORMS.map'))

// ─── 3. 平台快捷选择 ─────────────────────────────────────────────
const platforms = ['Amazon', 'eBay', 'Ozon', 'Temu', 'TikTok', 'eMAG', 'Lazada']
assert('平台名单完整（7 个）', platforms.every(p => tsx.includes(`'${p}'`)))
assert('旧占位按钮已移除', !tsx.includes('PPT 生成') && !tsx.includes('帮我写作') && !tsx.includes('图像生成') && !tsx.includes('视频生成'))
assert('平台点击走 selectPlatform', tsx.includes('selectPlatform(item)'))
assert('平台名实时替换输入框句子', tsx.includes('applyPlatformToRequest(current, next)'))
assert('联动 亚马逊→eBay 站点保留', applyPlatformToRequest(SELECTION_ANALYSIS_REQUEST, 'eBay') === '请帮我分析这款产品在eBay美国站是否有机会，按方法论文档输出完整评估报告。')
assert('联动 eBay→亚马逊', applyPlatformToRequest('请帮我分析这款产品在eBay英国站是否有机会', 'Amazon') === '请帮我分析这款产品在亚马逊英国站是否有机会')
assert('联动 Ozon 直接替换', applyPlatformToRequest(SELECTION_ANALYSIS_REQUEST, 'Ozon').includes('在Ozon美国站'))
assert('联动 无匹配原样返回', applyPlatformToRequest('自由编辑的文本', 'eBay') === '自由编辑的文本')
assert('发送附加目标平台', tsx.includes('目标平台：${targetPlatform}'))
assert('发送后清空平台选择', tsx.includes("setPlatform('')"))
assert('CSS 平台选中高亮', css.includes('.ai-employee-platform-chip.active'))
assert('首页左智能体栏已移除', !tsx.includes('ai-employee-agent-rail') && !css.includes('.ai-employee-agent-rail'))
assert('员工大全按钮返回 AI员工卡片首页', tsx.includes('onClick={onBackToHub ?? openKnowledgeHome}'))
assert('顶部按钮为员工大全', tsx.includes('⌂ 员工大全'))
assert('员工大全按钮普通 Tab 样式', tsx.includes('className="ai-employee-tab" onClick={onBackToHub ?? openKnowledgeHome}'))
assert('home-button 样式已清理', !css.includes('.ai-employee-home-button'))
assert('空态去员工大全回卡片首页', tsx.includes('>去员工大全</button>'))
assert('无残留智库首页文案', !tsx.includes('智库首页') && !css.includes('智库首页'))
assert('知识库守卫角色在列且可用', /name: '知识库守卫'[\s\S]{0,160}ready: true/.test(tsx) && tsx.includes("modelId: 'qwen3.6-flash'"))
assert('App 工作区实例传 position', app.includes('<AIEmployee position="选品调研员" onBackToHub='))
assert('App Listing 实例传 position', app.includes('<AIEmployee position="Listing精造师" initialTab="workbench" onBackToHub='))
assert('App 守卫实例独立挂载', app.includes('<AIEmployee position="知识库守卫" onBackToHub='))
assert('守卫卡片独立入口', app.includes("target:'ai-employee-guardian'"))
assert('守卫页面权限映射', app.includes("'ai-employee-guardian': 'menu.employee'"))

console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`)
process.exit(failures === 0 ? 0 : 1)
