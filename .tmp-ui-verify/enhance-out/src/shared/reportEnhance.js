"use strict";
// 选品报告渲染增强共享契约：证据等级 / 术语表 / 链接规则
// 与 docs/选品分析师-报告模板-v1.2.md 附录保持同步（改一处必须同步另一处）
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVIDENCE_CN = exports.APPENDIX_HEADING = exports.GLOSSARY = exports.ASIN_RE = exports.EVIDENCE_LEVELS = void 0;
exports.isLinkableText = isLinkableText;
exports.amazonAsinUrl = amazonAsinUrl;
exports.amazonBrandUrl = amazonBrandUrl;
exports.extractAsin = extractAsin;
exports.isBrandColumnHeader = isBrandColumnHeader;
exports.columnRole = columnRole;
exports.findGlossaryToken = findGlossaryToken;
exports.findEvidenceLetter = findEvidenceLetter;
exports.stripAppendix = stripAppendix;
exports.convertEvidenceToChinese = convertEvidenceToChinese;
/** 证据等级（选品分析师提示词规则6：F事实 / E外部估算 / A分析假设 / U未知） */
exports.EVIDENCE_LEVELS = {
    F: 'F = 事实（实测 / 平台抓取 / 用户提供的真实报价）',
    E: 'E = 外部估算（Jungle Scout / Helium 10 等第三方工具、行业均值）',
    A: 'A = 分析假设（已明示口径的假设）',
    U: 'U = 未知（待验证、数据缺失）'
};
exports.ASIN_RE = /^B[0-9A-Z]{9}$/;
const ASIN_TOKEN_RE = /B[0-9A-Z]{9}/;
/** 单元格文本是否允许自动补链（排除占位/未知值，避免假链接） */
const NON_LINKABLE = ['—', '–', '-', '—', '待验证', '未知', '待专业核验', '无'];
function isLinkableText(text) {
    const t = text.trim();
    return t.length > 0 && !NON_LINKABLE.includes(t);
}
function amazonAsinUrl(asin) {
    return `https://www.amazon.com/dp/${asin}`;
}
function amazonBrandUrl(brand) {
    return `https://www.amazon.com/s?k=${encodeURIComponent(brand)}`;
}
function extractAsin(text) {
    const m = text.trim().match(ASIN_TOKEN_RE);
    return m && exports.ASIN_RE.test(m[0]) ? m[0] : null;
}
/** 品牌/竞店列判定：仅限「含链接字样」或「纯品牌/店铺名」表头，避免「店铺定位」「品牌与内容能力」等描述列被误加链 */
function isBrandColumnHeader(header) {
    const h = header.trim();
    if (/链接/.test(h) && /品牌|店铺|竞店/.test(h))
        return true;
    return /^(品牌|店铺|品牌名|店铺名|竞店|品牌\/店铺)$/.test(h);
}
function columnRole(header) {
    const h = header.trim();
    if (/ASIN|Listing/i.test(h))
        return 'asin';
    if (isBrandColumnHeader(h))
        return 'brand';
    if (/证据/.test(h))
        return 'evidence';
    return null;
}
/** 术语表（与模板 v1.2 附录一致；长 token 优先匹配避免截断） */
const GLOSSARY_ENTRIES = [
    ['TOP50', '类目销量前50样本'],
    ['USITC', '美国国际贸易委员会'],
    ['USPTO', '美国专利商标局'],
    ['ACOS', '广告销售成本比（广告花费÷广告销售额）'],
    ['ASIN', '亚马逊标准商品编号'],
    ['BSR', '畅销排名（Best Sellers Rank，类目销量排名）'],
    ['CPC', '单次点击成本（广告平均每次点击花费）'],
    ['CR10', '前十名集中度（头部10款市占合计）'],
    ['EPA', '美国环保署'],
    ['FBA', '亚马逊物流（Fulfillment by Amazon）'],
    ['FDA', '美国食品药品监督管理局'],
    ['HTS', '美国协调关税表编码'],
    ['OEM', '原始设备制造商（代工）'],
    ['SKU', '库存量单位（Stock Keeping Unit）'],
    ['SD', '展示型广告（Sponsored Display）'],
    ['A+', '亚马逊A+品牌增强内容']
];
exports.GLOSSARY = [...GLOSSARY_ENTRIES].sort((a, b) => b[0].length - a[0].length);
function isWordChar(ch) {
    return !!ch && /[A-Za-z0-9]/.test(ch);
}
/** 在纯文本中查找首个可注解术语，返回位置与 token；无则 null */
function findGlossaryToken(text) {
    let best = null;
    for (const [token] of exports.GLOSSARY) {
        let from = 0;
        while (from <= text.length - token.length) {
            const at = text.indexOf(token, from);
            if (at < 0)
                break;
            const prev = text[at - 1];
            const next = text[at + token.length];
            const prevOk = !isWordChar(prev);
            const nextOk = token.endsWith('+') ? next !== '+' && !isWordChar(next) : !isWordChar(next);
            if (prevOk && nextOk) {
                if (!best || at < best.index)
                    best = { index: at, token };
                break;
            }
            from = at + 1;
        }
    }
    return best;
}
/** 提取文本中独立成词的证据等级字母（F/E/A/U，含 A/U 这类斜杠组合） */
function findEvidenceLetter(text) {
    const m = /(?<![A-Za-z])([FEAU])(?![A-Za-z])/.exec(text);
    return m ? { index: m.index, letter: m[1] } : null;
}
// ─── v1.4：附录不再展示（省版面）+ 证据等级中文化 ─────────────
exports.APPENDIX_HEADING = '附录：术语与证据等级速览';
/** 证据等级字母 → 中文（旧报告回溯转换用） */
exports.EVIDENCE_CN = { F: '事实', E: '外部估算', A: '分析假设', U: '未知' };
/** 旧报告可能带附录；v1.4 起附录不再展示，渲染时将从附录标题起的内容剩除 */
function stripAppendix(content) {
    const at = content.indexOf(exports.APPENDIX_HEADING);
    if (at < 0)
        return content;
    return `${content.slice(0, at).trimEnd()}\n`;
}
/** 将文本中独立成词的证据等级字母替换为中文（A/U → 分析假设/未知），其余内容原样 */
function convertEvidenceToChinese(text) {
    return text.replace(/(?<![A-Za-z])([FEAU])(?![A-Za-z])/g, letter => exports.EVIDENCE_CN[letter]);
}
