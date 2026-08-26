"use strict";
// 选品提取共享契约：提取卡完整展示 + 发送组装。
// 注意：buildSelectionInfoText 的行顺序须与主进程 BrowserWorkspace.ts 注入脚本的
// toPromptText 信息行保持一致（标题/价格/供应商/起订量/发货地/成交/规格属性/图片）。
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_TEXT_RE = exports.SELECTION_ANALYSIS_REQUEST = void 0;
exports.applyPlatformToRequest = applyPlatformToRequest;
exports.buildSelectionInfoText = buildSelectionInfoText;
/** 提取后输入框预填的分析要求（完整版，用户可再编辑） */
exports.SELECTION_ANALYSIS_REQUEST = '请帮我分析这款产品在亚马逊美国站是否有机会，按方法论文档输出完整评估报告。';
/** 平台名实时联动：替换要求文本「在 XX」处的平台名（含中文「亚马逊」），站点部分不动由用户人工编辑；无匹配时原样返回 */
exports.PLATFORM_TEXT_RE = /(在\s*)(亚马逊|Amazon|eBay|Ozon|Temu|TikTok|eMAG|Lazada)/;
function applyPlatformToRequest(text, platform) {
    const target = !platform || platform === 'Amazon' ? '亚马逊' : platform;
    return exports.PLATFORM_TEXT_RE.test(text) ? text.replace(exports.PLATFORM_TEXT_RE, (_m, prefix) => prefix + target) : text;
}
/** 组装「完整商品信息」文本块（不含分析要求；要求由渲染层发送时追加） */
function buildSelectionInfoText(info) {
    const lines = ['我在1688看到一款商品，商品信息如下：'];
    if (info.url)
        lines.push('- 1688商品URL：' + info.url);
    if (info.analysisDate)
        lines.push('- 分析日期：' + info.analysisDate);
    if (info.title)
        lines.push('- 标题：' + info.title);
    if (info.price)
        lines.push('- 价格：' + info.price);
    if (info.seller)
        lines.push('- 供应商/店铺：' + info.seller);
    if (info.moq)
        lines.push('- 起订量：' + info.moq);
    if (info.shipFrom)
        lines.push('- 发货地：' + info.shipFrom);
    if (info.deals)
        lines.push('- 成交：' + info.deals + ' 件');
    if (info.attributes && info.attributes.length) {
        lines.push('- 规格属性：\n' + info.attributes.map(item => '  * ' + item).join('\n'));
    }
    if (info.images && info.images.length)
        lines.push('- 图片：' + info.images.length + ' 张');
    return lines.join('\n');
}
