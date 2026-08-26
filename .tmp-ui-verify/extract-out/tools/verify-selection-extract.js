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
    images: ['https://img.1688.com/a.jpg', 'https://img.1688.com/b.jpg']
};
const text = (0, selectionExtract_1.buildSelectionInfoText)(info);
assert('信息块含 URL 行', text.includes('- 1688商品URL：' + info.url));
assert('信息块含分析日期行', text.includes('- 分析日期：2026-08-09'));
assert('信息块含标题/价格/供应商行', text.includes('- 标题：' + info.title) && text.includes('- 价格：¥6.50') && text.includes('- 供应商/店铺：' + info.seller));
assert('信息块含起订量/发货地/成交行', text.includes('- 起订量：1') && text.includes('- 发货地：广东广州') && text.includes('- 成交：200 件'));
assert('信息块含全部属性（7 条不截断）', info.attributes.every(attr => text.includes('  * ' + attr)));
assert('信息块含图片数行', text.includes('- 图片：2 张'));
assert('信息块不含分析要求', !text.includes(selectionExtract_1.SELECTION_ANALYSIS_REQUEST));
assert('空信息仅首行', (0, selectionExtract_1.buildSelectionInfoText)({}) === '我在1688看到一款商品，商品信息如下：');
// ─── 3. 渲染层源码契约 ───────────────────────────────────────────
const root = process.env.LISTING_REPO_ROOT || (0, node_path_1.join)(__dirname, '..', '..');
const tsx = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/renderer/AIEmployee.tsx'), 'utf-8');
const css = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/renderer/ai-employee.css'), 'utf-8');
assert('提取后输入框预填要求文案', tsx.includes('setDraft(SELECTION_ANALYSIS_REQUEST)'));
assert('发送时组装 信息+要求', tsx.includes('buildSelectionInfoText(extracted)'));
assert('发送后收起提取卡', tsx.includes('setExtracted(null)'));
assert('属性不再截断 6 条', !tsx.includes('slice(0, 6)'));
assert('卡片含 URL/分析日期/图片 字段', tsx.includes('1688商品URL') && tsx.includes('分析日期') && tsx.includes('图片'));
assert('CSS 去 160px 高度上限', !css.includes('max-height: 160px'));
assert('CSS 去单行省略号', !/ai-employee-extracted dd \{[^}]*text-overflow: ellipsis/.test(css));
assert('CSS 宽行跨两列', css.includes('.ai-employee-extracted dl div.wide'));
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
