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
const intent = (0, amazonScraper_1.buildAmazonSearchIntent)({ confirmedProductName: '宠物免洗擦浴精华', confirmedProductForm: '液体精华', confirmedUseMethod: '免洗擦浴', confirmedTargetObject: '猫狗' });
const plan = (0, amazonScraper_1.normalizeAmazonKeywordPlan)(intent, ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash']);
const queries = plan.keywords;
const samples = [];
for (let index = 0; index < 36; index += 1) {
    samples.push({ asin: `DIRECT${String(index).padStart(3, '0')}`, title: `Waterless Pet Shampoo No Rinse Body Cleanser for Dogs and Cats ${index}`, price: 10 + index, rating: 4 + index % 6 / 10, reviews: 100 + index * 10, query: queries[index % 3], page: index % 2 + 1, sponsored: false, source: 'api' });
}
for (let index = 0; index < 6; index += 1) {
    samples.push({ asin: `SPONSORED${index}`, title: `Waterless Pet Shampoo Sponsored Result ${index}`, price: 12, rating: 4.5, reviews: 9999, query: queries[index % 3], page: index % 2 + 1, sponsored: true, source: 'api' });
}
for (let index = 0; index < 3; index += 1) {
    samples.push({ asin: `WIPE${index}`, title: `Pet Grooming Wipes for Dog and Cat Body Cleaning ${index}`, price: 8, rating: 4.8, reviews: 8000, query: queries[index], page: 1, sponsored: false, source: 'api' });
    samples.push({ asin: `BRUSH${index}`, title: `Pet Grooming Cleaning Brush for Dogs ${index}`, price: 6, rating: 4.7, reviews: 7000, query: queries[index], page: 1, sponsored: false, source: 'api' });
}
const complete = (0, amazonScraper_1.classifyAmazonSamples)(intent, samples, { keywordsRequested: 3, keywordsSucceeded: 3 });
assert('完整样本记录自然位与赞助位', complete.audit.rawCount === 48 && complete.audit.organicCount === 42 && complete.audit.sponsoredCount === 6);
assert('纯赞助位不进入ASIN去重和竞品统计', complete.audit.uniqueCount === 42 && complete.samples.every(item => !item.sponsored));
assert('三组检索词全部成功', complete.audit.keywordsRequested === 3 && complete.audit.keywordsSucceeded === 3 && complete.audit.keywordCoveragePercent === 100);
assert('36个DIRECT达到决策样本线', complete.audit.directCount === 36 && complete.audit.confidence === '可决策');
assert('DIRECT核心字段完整率100%', complete.audit.fieldCoveragePercent === 100);
assert('综合样本完整率100%', complete.audit.coveragePercent === 100);
const fact = (0, amazonScraper_1.buildComparableMarketFactBlock)(intent, plan, complete.samples, complete.audit);
assert('事实块显示自然位与赞助位排除', fact.includes('自然位 42') && fact.includes('赞助位排除 6'));
assert('事实块显示样本完整率与检索词成功率', fact.includes('样本完整率：100%') && fact.includes('检索词成功 3/3'));
assert('价格输出P25/中位/P75', fact.includes('P25 $18.75') && fact.includes('中位价 $27.50') && fact.includes('P75 $36.25'), fact.match(/DIRECT 零售价格[^\n]*/)?.[0] || '');
assert('评分输出中位数', fact.includes('DIRECT 评分中位'));
assert('评论输出中位和P75', fact.includes('DIRECT 评论量：中位') && fact.includes('P75'));
assert('证据等级和抓取窗口限制进入事实块', fact.includes('证据等级：F') && fact.includes('不等同完整市场'));
const incompleteSamples = samples.slice(0, 15).map((sample, index) => ({ ...sample, query: queries[index % 2], rating: null, reviews: null }));
const incomplete = (0, amazonScraper_1.classifyAmazonSamples)(intent, incompleteSamples, { keywordsRequested: 3, keywordsSucceeded: 2 });
assert('15个DIRECT且仅2组词成功为中等置信度', incomplete.audit.directCount === 15 && incomplete.audit.confidence === '中等');
assert('字段缺失降低字段覆盖率', incomplete.audit.fieldCoveragePercent === 33);
assert('综合完整率按数量60%+词20%+字段20%加权', incomplete.audit.coveragePercent === 50, String(incomplete.audit.coveragePercent));
const low = (0, amazonScraper_1.classifyAmazonSamples)(intent, samples.slice(0, 3), { keywordsRequested: 3, keywordsSucceeded: 1 });
const badReport = [
    '# 测试报告',
    '- TOP50均价：$19.99',
    '- 月销量：12,000件',
    '## 最终结论',
    '✅ 建议入场'
].join('\n');
const issues = (0, amazonScraper_1.validateAmazonMarketClaims)(badReport, low.audit);
assert('低置信度阻止伪TOP50数值', issues.some(issue => issue.includes('TOP50')));
assert('未抓取销量阻止精确销量数值', issues.some(issue => issue.includes('无证据数值')));
assert('完整率不足阻止无条件建议入场', issues.some(issue => issue.includes('不得输出无条件')));
const compliantReport = '- TOP50均价：待验证\n- 月销量：U，待验证\n❓ 数据不足，不能判定';
assert('明确待验证和数据不足结论允许通过', (0, amazonScraper_1.validateAmazonMarketClaims)(compliantReport, low.audit).length === 0);
const root = process.env.LISTING_REPO_ROOT || (0, node_path_1.join)(__dirname, '..', '..');
const main = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/main/main.ts'), 'utf8');
const browser = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/main/browser/BrowserWorkspace.ts'), 'utf8');
const renderer = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/renderer/AIEmployee.tsx'), 'utf8');
const css = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/renderer/ai-employee.css'), 'utf8');
assert('API按配置页数循环抓取', main.includes('page <= settings.pages') && main.includes("url.searchParams.set('page', String(page))"));
assert('API跨页按ASIN去重并受最大样本数限制', main.includes('known.has(asin)') && main.includes('all.length >= settings.maxSamples'));
assert('API缓存读取配置的缓存时长', main.includes('settings.cacheHours * 3600 * 1000') && main.includes('cacheHit: true'));
assert('保存或清除配置会清空旧缓存', (main.match(/amazonDataSourceCache\.clear\(\)/g) || []).length >= 2);
assert('浏览器备用抓取使用相同页数/样本数/缓存时长', browser.includes('options: { pages?: number; maxSamples?: number; cacheHours?: number }') && browser.includes('page <= pages') && browser.includes('all.length < maxSamples'));
assert('渲染层把成功检索词数送入完整率计算', renderer.includes('keywordsSucceeded += 1') && renderer.includes('keywordsRequested: plan.keywords.length'));
assert('界面显示自然位、赞助位和三项覆盖率', renderer.includes('自然位') && renderer.includes('赞助位') && renderer.includes('样本完整率') && renderer.includes('核心字段覆盖'));
assert('报告返回后执行市场质量门禁', renderer.includes('validateAmazonMarketClaims(result.content'));
assert('样本完整率有独立可见样式', css.includes('.ai-employee-market-audit-coverage'));
console.log(`RESULT  ${checks - failures}/${checks} passed`);
process.exit(failures === 0 ? 0 : 1);
