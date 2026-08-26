#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const amazonScraper_1 = require("../src/shared/amazonScraper");
let checks = 0;
let failures = 0;
const assert = (label, ok, detail = '') => {
    checks += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`);
    if (!ok)
        failures += 1;
};
const extracted = {
    title: '跨境猫狗通用宠物免洗擦拭精华清洁套装',
    visualProductForm: '湿巾',
    visualUseMethod: '擦拭',
    visualTargetObject: '猫狗',
    confirmedProductName: '宠物免洗擦浴精华',
    confirmedProductForm: '液体精华',
    confirmedUseMethod: '挤出液体后免洗擦浴',
    confirmedTargetObject: '猫狗'
};
const intent = (0, amazonScraper_1.buildAmazonSearchIntent)(extracted);
assert('人工身份锁覆盖标题和旧视觉形态', intent.productName === '宠物免洗擦浴精华' && intent.productForm === '液体精华');
assert('用途和对象来自人工裁决', intent.useMethod.includes('挤出液体') && intent.targetObject === '猫狗');
assert('液体精华自动禁用湿巾检索词', intent.excludedTerms.includes('pet wipes') && intent.excludedTerms.includes('grooming wipes'));
const fallback = (0, amazonScraper_1.fallbackAmazonKeywords)(intent);
assert('无模型时生成三组确定性检索词', fallback.length === 3);
assert('确定性词不含湿巾形态', fallback.every(keyword => !/wipes?/i.test(keyword)), fallback.join(' | '));
const plan = (0, amazonScraper_1.normalizeAmazonKeywordPlan)(intent, [
    'pet grooming wipes',
    'Waterless Pet Shampoo',
    'No Rinse Pet Cleanser',
    'Waterless Pet Body Wash'
]);
assert('模型返回的湿巾词被清除', !plan.keywords.some(keyword => /wipes?/i.test(keyword)), plan.keywords.join(' | '));
assert('清洗后保留三组唯一检索词', plan.keywords.length === 3 && new Set(plan.keywords).size === 3);
assert('有效模型检索词标记为模型来源', plan.source === 'model');
const samples = [
    { asin: 'DIRECT001', title: 'Waterless Pet Shampoo No Rinse Body Cleanser for Dogs and Cats', price: 20, rating: 4.5, reviews: 100, query: plan.keywords[0] },
    { asin: 'WIPE00001', title: 'Pet Grooming Wipes for Dog and Cat Body Cleaning', price: 9, rating: 4.8, reviews: 9000, query: plan.keywords[0] },
    { asin: 'BRUSH0001', title: 'Pet Grooming Cleaning Brush for Dogs', price: 7, rating: 4.7, reviews: 8000, query: plan.keywords[0] },
    { asin: 'DIRECT001', title: 'Waterless Pet Shampoo No Rinse Body Cleanser for Dogs and Cats', price: 20, rating: 4.5, reviews: 100, query: plan.keywords[1] },
    { asin: 'DIRECT002', title: 'No Rinse Dog Cleanser Waterless Bath Wash', price: 30, rating: 4.2, reviews: 200, query: plan.keywords[1] },
    { asin: 'WIPE00002', title: 'Deodorizing Pet Wipes for Dog Cleaning and Grooming', price: 13, rating: 4.6, reviews: 7000, query: plan.keywords[1] },
    { asin: 'DIRECT003', title: 'Cat and Dog Body Wash Waterless Shampoo', price: 40, rating: 4.4, reviews: 300, query: plan.keywords[2] },
    { asin: 'DENTAL001', title: 'Dog Dental Tooth Cleaning Kit', price: 8, rating: 4.3, reviews: 6000, query: plan.keywords[2] }
];
const classified = (0, amazonScraper_1.classifyAmazonSamples)(intent, samples);
assert('跨检索词按 ASIN 去重', classified.audit.rawCount === 8 && classified.audit.uniqueCount === 7);
assert('直接竞品分类准确', classified.audit.directCount === 3);
assert('湿巾作为替代方案而非直接竞品', classified.audit.adjacentCount === 2 && classified.samples.filter(item => item.asin.startsWith('WIPE')).every(item => item.comparisonClass === 'ADJACENT'));
assert('刷具和牙齿护理被排除', classified.audit.excludedCount === 2 && classified.samples.filter(item => /BRUSH|DENTAL/.test(item.asin)).every(item => item.comparisonClass === 'NON_COMPARABLE'));
assert('DIRECT 少于15时置信度为低', classified.audit.confidence === '低');
const fact = (0, amazonScraper_1.buildComparableMarketFactBlock)(intent, plan, classified.samples, classified.audit);
assert('事实块记录三组检索词', plan.keywords.every(keyword => fact.includes(keyword)));
assert('事实块记录完整样本审计', fact.includes('原始 8') && fact.includes('ASIN去重 7') && fact.includes('DIRECT直接竞品 3') && fact.includes('ADJACENT替代方案 2') && fact.includes('NON_COMPARABLE排除 2'));
assert('价格统计只使用 DIRECT', fact.includes('中位价 $30.00') && fact.includes('均价 $30.00'), fact.match(/DIRECT 零售价格区间[^\n]*/)?.[0] || '');
assert('低样本不得包装成TOP50', fact.includes('不得写成 TOP50'));
assert('替代方案单列且禁止回填本品形态', fact.includes('ADJACENT 替代方案') && fact.includes('不得回填本品形态'));
assert('不可比样本明确排除', fact.includes('NON_COMPARABLE 已从统计和竞品表中排除'));
assert('未抓取市场指标仍标待验证', fact.includes('销量、销售额和趋势仍必须写“待验证”'));
const root = process.env.LISTING_REPO_ROOT || (0, node_path_1.join)(__dirname, '..', '..');
const renderer = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/renderer/AIEmployee.tsx'), 'utf8');
const service = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/main/services/AiEmployeeChatService.ts'), 'utf8');
const main = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/main/main.ts'), 'utf8');
const preload = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/preload/preload.ts'), 'utf8');
const globals = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/renderer/global.d.ts'), 'utf8');
const css = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/renderer/ai-employee.css'), 'utf8');
assert('渲染层检索读取身份锁而非原始标题', renderer.includes('buildAmazonSearchIntent(extracted)') && !renderer.includes('deriveAmazonKeyword(String(extracted.title))'));
assert('渲染层逐一抓取三组检索词', renderer.includes('for (let index = 0; index < plan.keywords.length; index += 1)'));
assert('渲染层先分类再构建事实块', renderer.indexOf('classifyAmazonSamples(intent, collected)') < renderer.indexOf('buildComparableMarketFactBlock(intent, plan'));
assert('主进程提示含锁定形态和禁用词', service.includes('产品形态：${intent.productForm}') && service.includes('禁止出现：${intent.excludedTerms'));
assert('IPC、preload 和前端类型均升级为多检索词', main.includes("ai-employee:derive-amazon-keywords") && preload.includes('deriveAmazonKeywords') && globals.includes('deriveAmazonKeywords'));
assert('界面显示 DIRECT/ADJACENT/排除计数', renderer.includes('Amazon 样本可比性') && renderer.includes('DIRECT') && renderer.includes('ADJACENT') && renderer.includes('已排除'));
assert('界面显示检索词与低置信度限制', renderer.includes('marketAudit.keywords.map') && renderer.includes('不得写成 TOP50'));
assert('样本审计有独立可见样式', css.includes('.ai-employee-market-audit') && css.includes('.ai-employee-market-audit-counts'));
console.log(`RESULT  ${checks - failures}/${checks} passed`);
process.exit(failures === 0 ? 0 : 1);
