#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * 选品报告增强回归：列角色 / ASIN / 术语 / 证据等级纯逻辑 + v1.2 双源完整性。
 * 环境无 node 时用 Electron 代跑：
 *   export ELECTRON_RUN_AS_NODE=1
 *   "$ELECTRON" node_modules/typescript/bin/tsc tools/verify-report-enhance.ts --outDir .tmp-ui-verify/enhance-out --module commonjs --target es2020 --esModuleInterop --skipLibCheck --moduleResolution node
 *   LISTING_REPO_ROOT=$PWD "$ELECTRON" .tmp-ui-verify/enhance-out/tools/verify-report-enhance.js
 */
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const reportEnhance_1 = require("../src/shared/reportEnhance");
let failures = 0;
const assert = (label, ok, detail = '') => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` · ${detail}` : ''}`);
    if (!ok)
        failures++;
};
// ─── 1. 列角色识别 ────────────────────────────────────────────────
assert('3.2 品牌/店铺 → brand', (0, reportEnhance_1.columnRole)('品牌/店铺') === 'brand');
assert('3.2 Listing/ASIN → asin', (0, reportEnhance_1.columnRole)('Listing/ASIN') === 'asin');
assert('证据等级及来源 → evidence', (0, reportEnhance_1.columnRole)('证据等级及来源') === 'evidence');
assert('证据等级及依据 → evidence', (0, reportEnhance_1.columnRole)('证据等级及依据') === 'evidence');
assert('5.2 证据 → evidence', (0, reportEnhance_1.columnRole)('证据') === 'evidence');
assert('第四部分 竞店/品牌及链接 → brand', (0, reportEnhance_1.columnRole)('竞店/品牌及链接') === 'brand');
assert('3.3 分析维度 → null', (0, reportEnhance_1.columnRole)('分析维度') === null);
assert('3.3 核心竞品1 (TropiClean) → null', (0, reportEnhance_1.columnRole)('核心竞品1 (TropiClean)') === null);
assert('3.3 行维度 品牌、店铺与目标用户 不参与（表头角色）', (0, reportEnhance_1.columnRole)('本品') === null);
// ─── 2. ASIN 提取与链接 ───────────────────────────────────────────
assert('ASIN 标准提取', (0, reportEnhance_1.extractAsin)('B00N5QZK5W') === 'B00N5QZK5W');
assert('ASIN 带空白提取', (0, reportEnhance_1.extractAsin)('  B001GZVY8I ') === 'B001GZVY8I');
assert('ASIN 小写拒绝', (0, reportEnhance_1.extractAsin)('b00n5qzk5w') === null);
assert('ASIN 长度不足拒绝', (0, reportEnhance_1.extractAsin)('B00N5QZK5') === null);
assert('ASIN 含小写拒绝', (0, reportEnhance_1.extractAsin)('B00N5QZK5w') === null);
assert('dp 链接格式', (0, reportEnhance_1.amazonAsinUrl)('B00N5QZK5W') === 'https://www.amazon.com/dp/B00N5QZK5W');
assert('品牌搜索链接编码', (0, reportEnhance_1.amazonBrandUrl)('Arm & Hammer') === 'https://www.amazon.com/s?k=Arm%20%26%20Hammer', (0, reportEnhance_1.amazonBrandUrl)('Arm & Hammer'));
// ─── 3. 可补链文本判定 ────────────────────────────────────────────
assert('占位符 — 不补链', !(0, reportEnhance_1.isLinkableText)('—'));
assert('待验证 不补链', !(0, reportEnhance_1.isLinkableText)('待验证'));
assert('未知 不补链', !(0, reportEnhance_1.isLinkableText)('未知'));
assert('空串 不补链', !(0, reportEnhance_1.isLinkableText)('  '));
assert('真实品牌 可补链', (0, reportEnhance_1.isLinkableText)('TropiClean'));
// ─── 4. 术语注解 ─────────────────────────────────────────────────
assert('BSR/类目排名 命中 BSR', (0, reportEnhance_1.findGlossaryToken)('BSR/类目排名')?.token === 'BSR');
assert('TOP50均价区间 命中 TOP50', (0, reportEnhance_1.findGlossaryToken)('TOP50均价区间')?.token === 'TOP50');
assert('FBA入仓+仓储 命中 FBA', (0, reportEnhance_1.findGlossaryToken)('FBA入仓+仓储+履约')?.token === 'FBA');
assert('A+与转化内容 命中 A+', (0, reportEnhance_1.findGlossaryToken)('主图、视频、A+与转化内容')?.token === 'A+');
assert('CR10≈45% 命中 CR10', (0, reportEnhance_1.findGlossaryToken)('CR10≈45%，品牌集中度中高')?.token === 'CR10');
assert('ACOS 20–25% 命中 ACOS', (0, reportEnhance_1.findGlossaryToken)('A（ACOS 20–25%）')?.token === 'ACOS');
assert('USPTO 命中', (0, reportEnhance_1.findGlossaryToken)('USPTO')?.token === 'USPTO');
assert('OEM 命中', (0, reportEnhance_1.findGlossaryToken)('无品牌（OEM）')?.token === 'OEM');
assert('词内误匹配拒绝 ABSR', (0, reportEnhance_1.findGlossaryToken)('ABSR') === null);
assert('词内误匹配拒绝 BSRX', (0, reportEnhance_1.findGlossaryToken)('BSRX') === null);
assert('FBAF 不命中 FBA（边界）', (0, reportEnhance_1.findGlossaryToken)('FBAF') === null);
assert('术语表按长度降序', reportEnhance_1.GLOSSARY.every(([t], i) => i === 0 || reportEnhance_1.GLOSSARY[i - 1][0].length >= t.length));
assert('术语表含 16 条', reportEnhance_1.GLOSSARY.length === 16, `实际 ${reportEnhance_1.GLOSSARY.length}`);
// ─── 5. 证据等级字母 ─────────────────────────────────────────────
assert('单字母 F 命中', (0, reportEnhance_1.findEvidenceLetter)('F')?.letter === 'F');
assert('A/U 首字母 A 命中', (0, reportEnhance_1.findEvidenceLetter)('A/U')?.letter === 'A');
assert('/U 续段 U 命中', (0, reportEnhance_1.findEvidenceLetter)('/U')?.letter === 'U');
assert('E（Jungle Scout…） 命中 E', (0, reportEnhance_1.findEvidenceLetter)('E（Jungle Scout/Helium 10 行业均值）')?.letter === 'E');
assert('FBA入仓 不误命中 F', (0, reportEnhance_1.findEvidenceLetter)('FBA入仓+仓储+履约') === null);
assert('中文文本 不误命中', (0, reportEnhance_1.findEvidenceLetter)('低（若备案）') === null);
assert('四等级释义齐全', ['F', 'E', 'A', 'U'].every(k => reportEnhance_1.EVIDENCE_LEVELS[k]?.startsWith(`${k} = `)));
assert('字母转中文 F→事实', (0, reportEnhance_1.convertEvidenceToChinese)('F') === '事实');
assert('字母转中文 A/U→分析假设/未知', (0, reportEnhance_1.convertEvidenceToChinese)('A/U') === '分析假设/未知');
assert('字母转中文 E带括号', (0, reportEnhance_1.convertEvidenceToChinese)('E（Jungle Scout）') === '外部估算（Jungle Scout）');
assert('字母转中文 FBA 不误转', (0, reportEnhance_1.convertEvidenceToChinese)('FBA入仓') === 'FBA入仓');
assert('字母转中文 纯中文原样', (0, reportEnhance_1.convertEvidenceToChinese)('未知') === '未知');
// ─── 6. v1.4 双源完整性 ──────────────────────────────────────────
const root = process.env.LISTING_REPO_ROOT || process.cwd();
const tpl = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'docs/选品分析师-报告模板-v1.2.md'), 'utf-8');
const prompt = (0, node_fs_1.readFileSync)((0, node_path_1.join)(root, 'docs/选品分析师-智能体提示词.md'), 'utf-8');
assert('模板 3.2 品牌搜索链接规则', tpl.includes('「品牌/店铺」列必须输出 Markdown 搜索链接'));
assert('模板 3.2 dp 链接信任规则', tpl.includes('仅当 ASIN 为用户提供的或系统抓取的才可输出'));
assert('模板含 3.3 🔗 商品/品牌链接 行', tpl.includes('| 🔗 商品/品牌链接 | — |'));
assert('模板第四部分代表商品信任规则', tpl.includes('「代表商品」列仅当 ASIN 为用户提供的或系统抓取的才附'));
assert('模板已删附录', !tpl.includes('附录：术语与证据等级速览') && !tpl.includes('术语表：'));
assert('模板无 F/E/A/U 占位', !tpl.includes('| F/E/A/U |'));
assert('模板证据等级中文占位', tpl.includes('事实/外部估算/分析假设/未知'));
assert('模板六部分齐全', ['第一部分', '第二部分', '第三部分', '第四部分', '第五部分', '第六部分'].every(p => tpl.includes(`## ${p}`)));
assert('提示词规则6 中文证据等级', prompt.includes('关键数据标记中文证据等级') && !prompt.includes('关键数据标记F（事实）'));
assert('提示词含规则15 链接可核验', prompt.includes('15. 链接可核验'));
assert('提示词含规则16 无附录', prompt.includes('16. 无附录'));
assert('提示词含规则17 标题平台一致', prompt.includes('17. 主标题'));
assert('提示词嵌入 v1.4 模板', prompt.includes('| 🔗 商品/品牌链接 | — |') && !prompt.includes('附录：术语与证据等级速览'));
assert('提示词保留尾部规则13/14', prompt.includes('13. 采购成本') && prompt.includes('14. 若用户已明确提供'));
assert('提示词保留规则1-12', prompt.includes('12. 即使没有任何真实竞品') && prompt.includes('1. 严格按照知识库文件'));
assert('提示词自检含中文证据/无附录/错链', prompt.includes('无F/E/A/U字母') && prompt.includes('是否未输出附录') && prompt.includes('不可信 ASIN'));
// ─── 7. 附录剩除（旧报告兼容） ───────────────────────────────
const withAppendix = '# 报告正文\n\n## 数据来源、假设与待验证清单\n\n| 1 | x |\n\n## 附录：术语与证据等级速览\n\n| F | 事实 |\n';
const stripped = (0, reportEnhance_1.stripAppendix)(withAppendix);
assert('旧报告附录被剩除', !stripped.includes('附录') && stripped.includes('数据来源、假设与待验证清单'));
assert('无附录报告原样', (0, reportEnhance_1.stripAppendix)('# 报告正文') === '# 报告正文');
console.log(failures === 0 ? '\nENHANCE REGRESSION PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
