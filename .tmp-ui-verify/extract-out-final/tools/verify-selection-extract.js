#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 选品提取卡回归：信息整全展示 + 输入框仅预填分析要求 + 发送组装。
 * 环境无 node 时用 Electron 代跑：
 *   export ELECTRON_RUN_AS_NODE=1
 *   "$ELECTRON" node_modules/typescript/bin/tsc tools/verify-selection-extract.ts --outDir .tmp-ui-verify/extract-out --module commonjs --target es2020 --esModuleInterop --skipLibCheck --moduleResolution node
 *   "$ELECTRON" .tmp-ui-verify/extract-out/tools/verify-selection-extract.js
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const selectionExtract_1 = require("../src/shared/selectionExtract");
let failures = 0;
const assert = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`);
    if (!ok)
        failures++;
};
// ─── 1. 分析要求文案 ─────────────────────────────────────────────
assert('要求含亚马逊美国站', selectionExtract_1.SELECTION_ANALYSIS_REQUEST.includes('亚马逊美国站'));
assert('要求含完整评估报告', selectionExtract_1.SELECTION_ANALYSIS_REQUEST.includes('完整评估报告'));
assert('要求不含商品信息字段', !/URL|标题|价格/.test(selectionExtract_1.SELECTION_ANALYSIS_REQUEST));
// ─── 2. 信息块组装（与红框旧文案字段对齐） ───────────────────────
const info = {
    url: 'https://detail.1688.com/offer/1013322595972.html',
    analysisDate: '2026-08-09',
    title: '狗狗宠物牙齿清洁手指湿巾',
    price: '¥6.50',
    seller: '广州宠本生物科技有限公司',
    moq: '1',
    shipFrom: '广东广州',
    deals: '200',
    attributes: ['品牌：其他', '货号：1', '是否进口：否', '是否专利货源：否', '规格：50片', '是否跨境出口专供货源：是', '材质：无纺布'],
    images: ['https://img.1688.com/a.jpg', 'https://img.1688.com/b.jpg'],
    imageEvidence: [
        { url: 'https://img.1688.com/a.jpg', role: '主图', source: '页面主图Meta' },
        { url: 'https://img.1688.com/b.jpg', role: '详情图', source: '商品详情区域' }
    ],
    detailText: '宠物液体免洗擦浴精华，挤出后擦浴清洁。',
    detailSource: '详情模块DOM',
    imageOcrText: 'PET WASH FREE SCRUB ESSENCE 30ml',
    visualProductForm: '液体精华',
    visualUseMethod: '挤出液体后擦浴',
    visualTargetObject: '猫狗',
    visualConfidence: 95
};
const text = (0, selectionExtract_1.buildSelectionInfoText)(info);
assert('信息块含 URL 行', text.includes('- 1688商品URL：' + info.url));
assert('信息块含分析日期行', text.includes('- 分析日期：2026-08-09'));
assert('信息块含标题/价格/供应商行', text.includes('- 标题：' + info.title) && text.includes('- 价格：¥6.50') && text.includes('- 供应商/店铺：' + info.seller));
assert('信息块含起订量/发货地/成交行', text.includes('- 起订量：1') && text.includes('- 发货地：广东广州') && text.includes('- 成交：200 件'));
assert('信息块含全部属性（7 条不截断）', info.attributes.every(attr => text.includes('  * ' + attr)));
assert('信息块含图片数行', text.includes('- 图片：2 张'));
assert('信息块含图片角色和来源', text.includes('图1｜主图｜页面主图Meta｜https://img.1688.com/a.jpg') && text.includes('图2｜详情图｜商品详情区域｜https://img.1688.com/b.jpg'));
assert('信息块含详情/OCR/视觉证据', text.includes('详情页文字（页面DOM）') && text.includes('包装图片OCR文字') && text.includes('形态=液体精华'));
assert('完整证据状态进入信息块', text.includes('- 提取证据状态：证据完整'));
assert('信息块不含分析要求', !text.includes(selectionExtract_1.SELECTION_ANALYSIS_REQUEST));
assert('空信息仅首行', (0, selectionExtract_1.buildSelectionInfoText)({}) === '我在1688看到一款商品，商品信息如下：');
// ─── 3. 证据覆盖与身份冲突 ─────────────────────────────────────
const complete = (0, selectionExtract_1.assessExtractionEvidence)(info);
assert('标题+详情+图片+OCR+高置信视觉为证据完整', complete.level === 'COMPLETE' && complete.missing.length === 0);
const conflictInfo = { ...info, visualProductForm: '湿巾', visualConfidence: 96 };
const conflict = (0, selectionExtract_1.assessExtractionEvidence)(conflictInfo);
assert('视觉与详情/OCR形态冲突须人工核对', conflict.level === 'NEEDS_REVIEW' && conflict.conflicts.length > 0);
assert('冲突随完整信息进入请求', (0, selectionExtract_1.buildSelectionInfoText)(conflictInfo).includes('商品身份冲突'));
const lowConfidence = { ...info, visualConfidence: 45, imageOcrText: '' };
const lowEvidence = (0, selectionExtract_1.assessExtractionEvidence)(lowConfidence);
assert('低置信视觉不能作为可靠形态', !lowEvidence.hasReliableVisual && lowEvidence.level === 'NEEDS_REVIEW');
assert('低置信视觉身份锁标为待人工确认', (0, selectionExtract_1.buildProductIdentityLock)(lowConfidence).includes('产品形态：待人工确认'));
const wipesReport = '# 测试报告\n## 第一部分：本品基础信息解析\n- 产品名称：宠物湿巾\n## 第二部分：市场分析';
assert('低置信视觉不得触发强制形态校验', (0, selectionExtract_1.validateSelectionReportIdentity)(wipesReport, lowConfidence).every(issue => !issue.includes('视觉识别为液体精华')));
assert('高置信液体视觉继续阻止湿巾形态', (0, selectionExtract_1.validateSelectionReportIdentity)(wipesReport, info).some(issue => issue.includes('视觉识别为液体精华')));
// ─── 4. 报告生成前身份门禁与人工裁决 ───────────────────────────
assert('未确认商品禁止生成报告', (0, selectionExtract_1.selectionGenerationGate)(info, false).includes('确认并锁定'));
assert('证据完整且已确认允许生成报告', (0, selectionExtract_1.selectionGenerationGate)(info, true) === '');
assert('冲突商品即使旧状态已确认仍禁止生成', (0, selectionExtract_1.selectionGenerationGate)(conflictInfo, true).includes('人工身份裁决'));
const resolvedConflict = {
    ...conflictInfo,
    confirmedProductName: '宠物免洗擦浴精华',
    confirmedProductForm: '液体精华',
    confirmedUseMethod: '挤出液体后擦浴',
    confirmedTargetObject: '猫狗',
    identityResolutionNote: '以包装出液口和详情说明为准'
};
assert('冲突经人工裁决后允许生成报告', (0, selectionExtract_1.selectionGenerationGate)(resolvedConflict, true) === '');
assert('人工裁决优先进入身份锁', (0, selectionExtract_1.buildProductIdentityLock)(resolvedConflict).includes('产品形态：液体精华（人工裁决已锁定）'));
assert('人工裁决保留在完整请求', (0, selectionExtract_1.buildSelectionInfoText)(resolvedConflict).includes('人工身份裁决：产品=宠物免洗擦浴精华'));
assert('人工裁决形态用于报告后置校验', (0, selectionExtract_1.validateSelectionReportIdentity)(wipesReport, resolvedConflict).some(issue => issue.includes('人工确认锁定为液体精华')));
// ─── 5. 主进程与渲染层源码契约 ──────────────────────────────────
const root = process.env.LISTING_REPO_ROOT || (0, node_path_1.join)(__dirname, '..', '..');
const tsx = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/renderer/AIEmployee.tsx'), 'utf-8');
const css = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/renderer/ai-employee.css'), 'utf-8');
const browserWorkspace = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/main/browser/BrowserWorkspace.ts'), 'utf-8');
assert('提取后输入框预填要求文案', tsx.includes('setDraft(SELECTION_ANALYSIS_REQUEST)'));
assert('发送时组装 信息+要求', tsx.includes('buildSelectionInfoText(extracted)'));
assert('发送后仅收起提取卡', tsx.includes('setExtractedCollapsed(true)') && !tsx.includes('setExtracted(null)\n    setPlatform'));
assert('属性不再截断 6 条', !/attributes[^\n]{0,80}slice\(0,\s*6\)/.test(tsx));
assert('卡片含 URL/分析日期/图片 字段', tsx.includes('1688商品URL') && tsx.includes('分析日期') && tsx.includes('图片'));
assert('卡片显示证据覆盖/图片证据/身份冲突', tsx.includes('证据覆盖') && tsx.includes('商品图片证据') && tsx.includes('身份冲突'));
assert('卡片显示OCR警告与视觉待确认', tsx.includes('OCR提示') && tsx.includes('必须人工确认'));
assert('未确认发送由前置门禁拦截', tsx.includes('selectionGenerationGate(extracted, extractedConfirmed)'));
assert('冲突商品提供人工身份裁决表单', tsx.includes('人工确认本品身份') && tsx.includes('保存并锁定身份'));
assert('人工裁决不覆盖原始视觉证据', tsx.includes('confirmedProductForm: productForm') && !tsx.includes('visualProductForm: productForm'));
assert('主进程提取详情来源', browserWorkspace.includes('detailSource') && browserWorkspace.includes('结构化商品描述'));
assert('主进程按来源筛选商品图', browserWorkspace.includes('imageEvidence') && browserWorkspace.includes('商品主图区域') && browserWorkspace.includes('商品详情区域'));
assert('主进程排除非商品图片', browserWorkspace.includes('logo|avatar|icon|sprite|qrcode'));
assert('CSS 去 160px 高度上限', !css.includes('max-height: 160px'));
assert('CSS 去单行省略号', !/ai-employee-extracted dd \{[^}]*text-overflow: ellipsis/.test(css));
assert('CSS 宽行跨两列', css.includes('.ai-employee-extracted dl div.wide'));
assert('CSS 含证据和图片预览布局', css.includes('.ai-employee-extracted-evidence') && css.includes('.ai-employee-extracted-images'));
assert('CSS 含人工身份裁决布局', css.includes('.ai-employee-identity-editor') && css.includes('.ai-employee-identity-fields'));
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
