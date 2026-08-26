#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * AI员工输入栏布局回归：角色 chips 新阵容 + 首页含角色行 + 平台快捷选择。
 * 环境无 node 时用 Electron 代跑：
 *   export ELECTRON_RUN_AS_NODE=1
 *   "$ELECTRON" node_modules/typescript/bin/tsc tools/verify-composer-layout.ts --outDir .tmp-ui-verify/composer-out --module commonjs --target es2020 --esModuleInterop --skipLibCheck --moduleResolution node
 *   LISTING_REPO_ROOT=$PWD "$ELECTRON" .tmp-ui-verify/composer-out/tools/verify-composer-layout.js
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
let failures = 0;
const assert = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`);
    if (!ok)
        failures++;
};
const root = process.env.LISTING_REPO_ROOT || (0, node_path_1.join)(__dirname, '..', '..');
const tsx = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/renderer/AIEmployee.tsx'), 'utf-8');
const css = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'src/renderer/ai-employee.css'), 'utf-8');
// ─── 1. 角色 chips 新阵容 ────────────────────────────────────────
assert('含竞品分析员', tsx.includes("name: '竞品分析员'"));
assert('含产品定价员', tsx.includes("name: '产品定价员'"));
assert('含类目优选员', tsx.includes("name: '类目优选员'"));
assert('旧占位角色已移除', !tsx.includes("name: 'AI合规顾问'") && !tsx.includes("name: 'AI运营助理'") && !tsx.includes("name: 'Listing精造师'"));
assert('选品分析师仍可用', /name: '选品分析师'[\s\S]{0,120}ready: true/.test(tsx));
assert('新角色为占位灰态', /name: '竞品分析员'[\s\S]{0,120}ready: false/.test(tsx));
// ─── 2. 首页输入栏含角色行 ───────────────────────────────────────
assert('首页 composer 显示角色行', tsx.includes('{renderComposer(true)}') && !tsx.includes('renderComposer(false)'));
// ─── 3. 平台快捷选择 ─────────────────────────────────────────────
const platforms = ['Amazon', 'eBay', 'Ozon', 'Temu', 'TikTok', 'eMAG', 'Lazada'];
assert('平台名单完整（7 个）', platforms.every(p => tsx.includes(`'${p}'`)));
assert('旧占位按钮已移除', !tsx.includes('PPT 生成') && !tsx.includes('帮我写作') && !tsx.includes('图像生成') && !tsx.includes('视频生成'));
assert('平台可点选切换', tsx.includes("setPlatform(platform === item ? '' : item)"));
assert('发送附加目标平台', tsx.includes('目标平台：${platform}'));
assert('发送后清空平台选择', tsx.includes("setPlatform('')"));
assert('CSS 平台选中高亮', css.includes('.ai-employee-platform-chip.active'));
console.log(failures === 0 ? 'ALL PASS' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
