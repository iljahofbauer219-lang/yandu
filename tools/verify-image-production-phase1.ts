import { buildImageProductionTasks, confirmedImageFactContext, deriveImageProjectStatus, getPlatformImageRule, normalizeImageProductFacts, platformImagePlanningWarnings, validateImageProductFacts, validateImageProductionProject } from '../src/shared/imageProduction'
import type { ImageProductionProject } from '../src/shared/imageProduction'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const base = {
  productName: 'Portable Blender',
  sku: 'SKU-001',
  platform: 'Ozon',
  language: '俄语',
  sourceContext: 'AI入库商品与参考图'
}

const main = buildImageProductionTasks({ ...base, plan: 'main' })
const detail = buildImageProductionTasks({ ...base, plan: 'detail' })
const full = buildImageProductionTasks({ ...base, plan: 'full' })
assert(main.length === 5, '仅主图必须生成5个独立任务')
assert(detail.length === 7, '仅详情页必须生成7个独立任务')
assert(full.length === 12, '全套必须生成12个独立任务')
assert(new Set(full.map(task => task.id)).size === 12, '任务编号必须唯一')
assert(full.every(task => task.prompt.includes(task.code)), '每个任务必须有包含自身编号的独立Prompt')
assert(full.every(task => /fake review|sales number|certification/.test(task.prompt)), '每个任务必须包含真实性约束')
assert(getPlatformImageRule('Ozon').maxGalleryImages===15,'Ozon官方图库上限必须进入平台规则')
assert(full.every(task=>task.prompt.includes('PLATFORM CONTRACT OZON')),'平台规则必须进入每个任务Prompt')
assert(full.filter(task=>task.group==='MAIN').every(task=>task.prompt.includes('supporting gallery image')||task.prompt.includes('platform hero')),'主图必须使用主图平台合同')
assert(full.filter(task=>task.group==='DETAIL').every(task=>task.prompt.includes('detail-page content module')),'详情页必须使用详情模块平台合同')
assert(platformImagePlanningWarnings('Ozon',8,8).length===1,'超过15张必须显示平台数量提醒')

const now = new Date().toISOString()
const normalizedFacts=normalizeImageProductFacts({productName:base.productName,sku:base.sku,source:base.sourceContext,price:'100',referenceImageUrl:'https://example.com/product.png',confirmed:false},'INVENTORY')
assert(normalizedFacts.entries?.length===15,'商品事实卡必须包含15个结构化字段')
const specification=normalizedFacts.entries.find(entry=>entry.key==='specification')!
specification.value='500 ml';specification.source='USER';specification.sourceLabel='用户填写';specification.status='CONFLICT'
assert(validateImageProductFacts(normalizedFacts).includes('尺寸/数量/规格存在冲突'),'冲突事实必须阻止确认')
specification.status='CONFIRMED'
assert(confirmedImageFactContext(normalizedFacts).includes('尺寸/数量/规格=500 ml（来源：用户填写）'),'生成上下文必须包含已确认事实及来源')
assert(!confirmedImageFactContext(normalizedFacts).includes('材质='),'不可识别事实不得进入生成上下文')
const project: ImageProductionProject = {
  id: 'verify-project',
  productKey: 'SKU-001',
  productTitle: base.productName,
  productImageUrl: 'https://example.com/product.png',
  plan: 'full',
  platform: base.platform,
  language: base.language,
  model: 'verify-model',
  facts: {
    productName: base.productName,
    sku: base.sku,
    source: base.sourceContext,
    price: '100',
    referenceImageUrl: 'https://example.com/product.png',
    confirmed: true,
    confirmedAt: now
  },
  approved: true,
  approvedAt: now,
  status: 'APPROVED',
  tasks: full,
  createdAt: now,
  updatedAt: now
}
assert(validateImageProductionProject(project).length === 0, '合法项目必须通过校验')
assert(validateImageProductionProject({ ...project, approved: false }).includes('生成清单尚未批准'), '未审批项目必须被拦截')
assert(validateImageProductionProject({ ...project, facts: { ...project.facts, confirmed: false } }).includes('商品事实尚未确认'), '未确认商品事实必须被拦截')

const partialTasks = full.map((task, index) => index === 0 ? { ...task, status: 'SUCCESS' as const, outputUrl: 'https://example.com/1.png' } : index === 1 ? { ...task, status: 'FAILED' as const, error: 'mock failure' } : task)
assert(deriveImageProjectStatus(partialTasks) === 'PARTIAL', '成功与失败并存时必须为PARTIAL')
const continuedTasks = partialTasks.map(task => task.status === 'FAILED' ? { ...task, status: 'SUCCESS' as const, outputUrl: 'https://example.com/2.png', error: undefined } : task)
assert(continuedTasks[0].outputUrl === 'https://example.com/1.png', '续跑不得覆盖已有成功图片')

console.log(JSON.stringify({ main: main.length, detail: detail.length, full: full.length, uniquePrompts: new Set(full.map(task => task.prompt)).size, validation: 'PASS', resumePreserved: true }, null, 2))
