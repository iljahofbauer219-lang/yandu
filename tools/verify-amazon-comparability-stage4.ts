#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildAmazonSearchIntent,
  buildComparableMarketFactBlock,
  classifyAmazonSamples,
  fallbackAmazonKeywords,
  normalizeAmazonKeywordPlan,
  type AmazonMarketSample
} from '../src/shared/amazonScraper'

let checks = 0
let failures = 0
const assert = (label: string, ok: boolean, detail = '') => {
  checks += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`)
  if (!ok) failures += 1
}

const extracted = {
  title: '跨境猫狗通用宠物免洗擦拭精华清洁套装',
  visualProductForm: '湿巾',
  visualUseMethod: '擦拭',
  visualTargetObject: '猫狗',
  confirmedProductName: '宠物免洗擦浴精华',
  confirmedProductForm: '液体精华',
  confirmedUseMethod: '挤出液体后免洗擦浴',
  confirmedTargetObject: '猫狗',
  attributes: ['净含量：30ml']
}
const intent = buildAmazonSearchIntent(extracted)
assert('人工身份锁覆盖标题和旧视觉形态', intent.productName === '宠物免洗擦浴精华' && intent.productForm === '液体精华')
assert('用途和对象来自人工裁决', intent.useMethod.includes('挤出液体') && intent.targetObject === '猫狗')
assert('液体精华自动禁用湿巾检索词', intent.excludedTerms.includes('pet wipes') && intent.excludedTerms.includes('grooming wipes'))

const fallback = fallbackAmazonKeywords(intent)
assert('无模型时生成三组确定性检索词', fallback.length === 3)
assert('确定性词不含湿巾形态', fallback.every(keyword => !/wipes?/i.test(keyword)), fallback.join(' | '))
const plan = normalizeAmazonKeywordPlan(intent, [
  'pet grooming wipes',
  'Waterless Pet Shampoo',
  'No Rinse Pet Cleanser',
  'Waterless Pet Body Wash'
])
assert('模型返回的湿巾词被清除', !plan.keywords.some(keyword => /wipes?/i.test(keyword)), plan.keywords.join(' | '))
assert('清洗后保留三组唯一检索词', plan.keywords.length === 3 && new Set(plan.keywords).size === 3)
assert('有效模型检索词标记为模型来源', plan.source === 'model')

const samples: AmazonMarketSample[] = [
  { asin: 'DIRECT001', title: 'Waterless Pet Shampoo No Rinse Body Cleanser 30ml for Dogs and Cats', price: 20, rating: 4.5, reviews: 100, query: plan.keywords[0] },
  { asin: 'WIPE00001', title: 'Pet Grooming Wipes for Dog and Cat Body Cleaning', price: 9, rating: 4.8, reviews: 9000, query: plan.keywords[0] },
  { asin: 'BRUSH0001', title: 'Pet Grooming Cleaning Brush for Dogs', price: 7, rating: 4.7, reviews: 8000, query: plan.keywords[0] },
  { asin: 'DIRECT001', title: 'Waterless Pet Shampoo No Rinse Body Cleanser 30ml for Dogs and Cats', price: 20, rating: 4.5, reviews: 100, query: plan.keywords[1] },
  { asin: 'DIRECT002', title: 'No Rinse Dog Cleanser Waterless Bath Wash 30ml', price: 30, rating: 4.2, reviews: 200, query: plan.keywords[1] },
  { asin: 'WIPE00002', title: 'Deodorizing Pet Wipes for Dog Cleaning and Grooming', price: 13, rating: 4.6, reviews: 7000, query: plan.keywords[1] },
  { asin: 'DIRECT003', title: 'Cat and Dog Body Wash Waterless Shampoo 30ml', price: 40, rating: 4.4, reviews: 300, query: plan.keywords[2] },
  { asin: 'DENTAL001', title: 'Dog Dental Tooth Cleaning Kit', price: 8, rating: 4.3, reviews: 6000, query: plan.keywords[2] }
]
const classified = classifyAmazonSamples(intent, samples)
assert('跨检索词按 ASIN 去重', classified.audit.rawCount === 8 && classified.audit.uniqueCount === 7)
assert('直接竞品分类准确', classified.audit.directCount === 3)
assert('湿巾作为替代方案而非直接竞品', classified.audit.adjacentCount === 2 && classified.samples.filter(item => item.asin.startsWith('WIPE')).every(item => item.comparisonClass === 'ADJACENT'))
assert('刷具和牙齿护理被排除', classified.audit.excludedCount === 2 && classified.samples.filter(item => /BRUSH|DENTAL/.test(item.asin)).every(item => item.comparisonClass === 'NON_COMPARABLE'))
assert('DIRECT 少于15时置信度为低', classified.audit.confidence === '低')

const deterrentIntent = buildAmazonSearchIntent({
  confirmedProductName: '宠物苦苹果防咬喷雾',
  confirmedProductForm: '喷雾',
  confirmedUseMethod: '喷洒在宠物易啃咬物品表面以防咬防啃',
  confirmedTargetObject: '猫狗'
})
const deterrentFallback = fallbackAmazonKeywords(deterrentIntent)
assert('防咬喷雾按锁定核心用途生成三组检索词', deterrentFallback.join(' | ') === 'pet bitter apple spray | pet chew deterrent spray | pet anti bite spray', deterrentFallback.join(' | '))
const deterrentPlan = normalizeAmazonKeywordPlan(deterrentIntent, [
  'pet grooming spray',
  'pet bitter apple spray',
  'pet chew deterrent spray',
  'pet anti bite spray'
])
assert('防咬喷雾剔除洗护漂移词并保留三组用途一致词', deterrentPlan.keywords.length === 3 && deterrentPlan.keywords.every(keyword => /bitter|chew deterrent|anti bite/.test(keyword)) && !deterrentPlan.keywords.some(keyword => /grooming/.test(keyword)), deterrentPlan.keywords.join(' | '))
const deterrentSamples: AmazonMarketSample[] = [
  { asin: 'BITTER001', title: 'Bitter Apple Spray for Dogs and Cats No Chew Deterrent', price: 12, rating: 4.2, reviews: 120, query: deterrentPlan.keywords[0] },
  { asin: 'BITTER002', title: 'Pet Anti Bite Spray Chew Deterrent for Dog Cat Training', price: 16, rating: 4.3, reviews: 220, query: deterrentPlan.keywords[1] },
  { asin: 'BITTERWIP', title: 'Bitter Apple Pet Wipes for Dogs and Cats Chew Deterrent', price: 9, rating: 4.1, reviews: 80, query: deterrentPlan.keywords[2] },
  { asin: 'GROOMSPR', title: 'Pet Grooming Deodorizing Spray for Dogs and Cats', price: 11, rating: 4.6, reviews: 900, query: deterrentPlan.keywords[0] },
  { asin: 'FURNIT01', title: 'Bitter Anti Bite Spray for Furniture Surface', price: 10, rating: 4.4, reviews: 60, query: deterrentPlan.keywords[1] }
]
const deterrentClassified = classifyAmazonSamples(deterrentIntent, deterrentSamples, { keywordsRequested: 3, keywordsSucceeded: 3 })
assert('防咬喷雾保留同用途同形态同对象的DIRECT', deterrentClassified.audit.directCount === 2 && deterrentClassified.samples.filter(item => item.asin.startsWith('BITTER00')).every(item => item.comparisonClass === 'DIRECT'))
assert('防咬湿巾仅作ADJACENT替代方案', deterrentClassified.samples.find(item => item.asin === 'BITTERWIP')?.comparisonClass === 'ADJACENT')
assert('洗护喷雾和非宠物对象不进入防咬竞品样本', deterrentClassified.samples.filter(item => /GROOMSPR|FURNIT01/.test(item.asin)).every(item => item.comparisonClass === 'NON_COMPARABLE'))

const fact = buildComparableMarketFactBlock(intent, plan, classified.samples, classified.audit)
assert('事实块记录三组检索词', plan.keywords.every(keyword => fact.includes(keyword)))
assert('事实块记录完整样本审计', fact.includes('原始 8') && fact.includes('ASIN去重 7') && fact.includes('DIRECT直接竞品 3') && fact.includes('ADJACENT替代方案 2') && fact.includes('NON_COMPARABLE排除 2'))
assert('价格统计只使用 DIRECT 且按本品零售单位标准化', fact.includes('DIRECT 标准化零售价（按本品零售单位 30ml）') && fact.includes('中位价 $30.00') && fact.includes('均价 $30.00'), fact.match(/DIRECT 标准化零售价[^\n]*/)?.[0] || '')
assert('低样本不得包装成TOP50', fact.includes('不得写成 TOP50'))
assert('替代方案单列且禁止回填本品形态', fact.includes('ADJACENT 替代方案') && fact.includes('不得回填本品形态'))
assert('不可比样本明确排除', fact.includes('NON_COMPARABLE 与纯赞助位已从统计和竞品表中排除'))
assert('未抓取市场指标仍标待验证', fact.includes('未抓取的销售额、BSR 和趋势证据等级为“待验证”') && fact.includes('必须写“待验证”'))

const root = process.env.LISTING_REPO_ROOT || join(__dirname, '..')
const renderer = readFileSync(join(root, 'src/renderer/AIEmployee.tsx'), 'utf8')
const service = readFileSync(join(root, 'src/main/services/AiEmployeeChatService.ts'), 'utf8')
const main = readFileSync(join(root, 'src/main/main.ts'), 'utf8')
const preload = readFileSync(join(root, 'src/preload/preload.ts'), 'utf8')
const globals = readFileSync(join(root, 'src/renderer/global.d.ts'), 'utf8')
const css = readFileSync(join(root, 'src/renderer/ai-employee.css'), 'utf8')
assert('渲染层检索读取身份锁而非原始标题', renderer.includes('buildAmazonSearchIntent(extracted)') && !renderer.includes('deriveAmazonKeyword(String(extracted.title))'))
assert('渲染层逐一抓取三组检索词', renderer.includes('for (let index = 0; index < plan.keywords.length; index += 1)'))
assert('渲染层先分类再构建事实块', renderer.indexOf('classifyAmazonSamples(intent, collected') < renderer.indexOf('buildComparableMarketFactBlock(intent, plan'))
assert('主进程提示含锁定形态和禁用词', service.includes('产品形态：${intent.productForm}') && service.includes('禁止出现：${intent.excludedTerms'))
assert('IPC、preload 和前端类型均升级为多检索词', main.includes("ai-employee:derive-amazon-keywords") && preload.includes('deriveAmazonKeywords') && globals.includes('deriveAmazonKeywords'))
assert('界面显示 DIRECT/ADJACENT/排除计数', renderer.includes('Amazon 样本可比性') && renderer.includes('DIRECT') && renderer.includes('ADJACENT') && renderer.includes('已排除'))
assert('界面显示检索词与低置信度限制', renderer.includes('marketAudit.keywords.map') && renderer.includes('不得写成 TOP50'))
assert('样本审计有独立可见样式', css.includes('.ai-employee-market-audit') && css.includes('.ai-employee-market-audit-counts'))

console.log(`RESULT  ${checks - failures}/${checks} passed`)
process.exit(failures === 0 ? 0 : 1)
