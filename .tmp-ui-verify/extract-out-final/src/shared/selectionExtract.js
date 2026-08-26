"use strict";
// 选品提取共享契约：提取卡完整展示 + 发送组装。
// 注意：buildSelectionInfoText 的行顺序须与主进程 BrowserWorkspace.ts 注入脚本的
// toPromptText 信息行保持一致（标题/价格/供应商/起订量/发货地/成交/规格属性/图片）。
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_TEXT_RE = exports.SELECTION_ANALYSIS_REQUEST = void 0;
exports.assessExtractionEvidence = assessExtractionEvidence;
exports.applyPlatformToRequest = applyPlatformToRequest;
exports.buildSelectionInfoText = buildSelectionInfoText;
exports.buildProductIdentityLock = buildProductIdentityLock;
exports.validateSelectionReportIdentity = validateSelectionReportIdentity;
exports.selectionGenerationGate = selectionGenerationGate;
exports.reportProductName = reportProductName;
exports.reportPlatform = reportPlatform;
exports.normalizeSelectionReport = normalizeSelectionReport;
/** 提取后输入框预填的分析要求（完整版，用户可再编辑） */
exports.SELECTION_ANALYSIS_REQUEST = '请帮我分析这款产品在亚马逊美国站是否有机会，按方法论文档输出完整评估报告。';
const FORM_PATTERNS = [
    { form: '液体精华', pattern: /液体精华|擦浴精华|免洗精华|scrub essence|wash[- ]?free essence/i },
    { form: '湿巾', pattern: /预浸湿巾|宠物湿巾|清洁湿巾|pet wipes|grooming wipes/i },
    { form: '泡沫', pattern: /清洁泡沫|泡沫清洁|cleansing foam|cleaning foam/i },
    { form: '喷雾', pattern: /清洁喷雾|除臭喷雾|grooming spray|cleaning spray/i },
    { form: '膏体', pattern: /膏体|软膏|cream|ointment/i },
    { form: '粉末', pattern: /粉末|powder/i },
    { form: '固体', pattern: /固体|香皂|soap bar/i }
];
function canonicalProductForm(value) {
    const match = FORM_PATTERNS.find(item => item.pattern.test(value));
    return match?.form || (/湿巾|wipes/i.test(value) ? '湿巾' : value.trim());
}
function formsInText(value) {
    if (!value)
        return [];
    const withoutNegatedWipes = value.replace(/(?:不是|并非|非|不属于|区别于|替代)\s*(?:宠物)?(?:预浸)?湿巾/gi, '');
    return FORM_PATTERNS.filter(item => item.pattern.test(withoutNegatedWipes)).map(item => item.form);
}
/** 统一评估提取证据覆盖率；标题不能单独构成可靠商品身份。 */
function assessExtractionEvidence(info) {
    const hasTitle = Boolean(info.title?.trim());
    const hasDetail = Boolean(info.detailText?.trim());
    const imageCount = Array.isArray(info.images) ? info.images.filter(Boolean).length : 0;
    const hasOcr = Boolean(info.imageOcrText?.trim());
    const visualForm = canonicalProductForm(info.visualProductForm || '');
    const hasReliableVisual = Boolean(visualForm && visualForm !== '无法判断' && Number(info.visualConfidence || 0) >= 70);
    const warnings = [...new Set((info.imageOcrWarnings || []).map(item => String(item).trim()).filter(Boolean))];
    const sources = [
        { name: '标题', forms: formsInText(info.title || '') },
        { name: '详情页文字', forms: formsInText(info.detailText || '') },
        { name: '图片OCR', forms: formsInText(info.imageOcrText || '') }
    ].filter(source => source.forms.length);
    const anchor = hasReliableVisual ? visualForm : (sources.find(source => source.name === '图片OCR')?.forms[0] || sources[0]?.forms[0] || '');
    const conflicts = sources.flatMap(source => {
        if (!anchor || source.forms.includes(anchor))
            return [];
        return [`${source.name}指向“${source.forms.join('/')}”，与${hasReliableVisual ? `图片视觉“${visualForm}”` : `其他证据“${anchor}”`}冲突`];
    });
    const missing = [];
    if (!hasTitle)
        missing.push('商品标题');
    if (!hasDetail)
        missing.push('详情页文字');
    if (!imageCount)
        missing.push('商品图片');
    if (!hasOcr)
        missing.push('包装图片OCR');
    if (!hasReliableVisual)
        missing.push('可靠视觉形态');
    const level = !hasTitle || (!hasDetail && !hasOcr && !hasReliableVisual)
        ? 'INSUFFICIENT'
        : missing.length || warnings.length || conflicts.length
            ? 'NEEDS_REVIEW'
            : 'COMPLETE';
    return {
        level,
        label: level === 'COMPLETE' ? '证据完整' : level === 'NEEDS_REVIEW' ? '需人工核对' : '证据不足',
        hasTitle,
        hasDetail,
        imageCount,
        hasOcr,
        hasReliableVisual,
        missing,
        warnings,
        conflicts: [...new Set(conflicts)]
    };
}
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
    if (info.imageEvidence && info.imageEvidence.length) {
        lines.push('- 商品图片证据：\n' + info.imageEvidence.map((item, index) => `  * 图${index + 1}｜${item.role}｜${item.source}｜${item.url}`).join('\n'));
    }
    if (info.detailText)
        lines.push('- 详情页文字（页面DOM）：\n' + info.detailText);
    if (info.imageOcrText)
        lines.push('- 包装图片OCR文字（图片来源）：\n' + info.imageOcrText);
    if (info.imageOcrWarnings && info.imageOcrWarnings.length)
        lines.push('- 图片OCR核验提示：' + info.imageOcrWarnings.join('；'));
    if (info.visualProductForm || info.visualUseMethod || info.visualTargetObject)
        lines.push(`- 图片视觉识别（置信度${info.visualConfidence ?? 0}%）：形态=${info.visualProductForm || '无法判断'}；用途=${info.visualUseMethod || '无法判断'}；适用对象=${info.visualTargetObject || '无法判断'}`);
    if (info.confirmedProductForm)
        lines.push(`- 人工身份裁决：产品=${info.confirmedProductName || info.title || '待命名产品'}；形态=${info.confirmedProductForm}；用途=${info.confirmedUseMethod || '待确认'}；适用对象=${info.confirmedTargetObject || '待确认'}${info.identityResolutionNote ? `；说明=${info.identityResolutionNote}` : ''}`);
    if (lines.length > 1) {
        const evidence = assessExtractionEvidence(info);
        lines.push(`- 提取证据状态：${evidence.label}`);
        if (evidence.missing.length)
            lines.push('- 缺失证据：' + evidence.missing.join('、'));
        if (evidence.conflicts.length)
            lines.push('- 商品身份冲突：' + evidence.conflicts.join('；'));
    }
    return lines.join('\n');
}
/** 本品事实锁：市场样本只能作为竞品参照，不得改写本品形态和用途。 */
function buildProductIdentityLock(info) {
    const evidence = assessExtractionEvidence(info);
    const manuallyResolved = Boolean(info.confirmedProductForm?.trim());
    const productName = info.confirmedProductName || info.title || '待命名产品';
    const form = manuallyResolved ? String(info.confirmedProductForm) : evidence.hasReliableVisual ? (info.visualProductForm || '待确认') : '待人工确认';
    const useMethod = manuallyResolved ? (info.confirmedUseMethod || '待确认') : (info.visualUseMethod || '待确认');
    const target = manuallyResolved ? (info.confirmedTargetObject || '待确认') : (info.visualTargetObject || '待确认');
    const blocked = form === '液体精华'
        ? '宠物湿巾、预浸湿巾、pet wipes、grooming wipes、纸巾或擦拭巾'
        : '不得用任何竞品名称替换本品身份';
    return [
        '【本品身份锁｜最高优先级】',
        `本次唯一分析对象：${productName}`,
        `产品形态：${form}${manuallyResolved ? '（人工裁决已锁定）' : `（图片视觉识别置信度：${info.visualConfidence ?? 0}%）`}`,
        `使用方式：${useMethod}`,
        `适用对象：${target}`,
        `提取证据状态：${evidence.label}${evidence.missing.length ? `（缺失：${evidence.missing.join('、')}）` : ''}`,
        ...(evidence.conflicts.length ? [`身份冲突：${evidence.conflicts.join('；')}，必须人工确认后才能作为本品事实。`] : []),
        `禁止将本品改写、归类或替换为：${blocked}`,
        '以下 Amazon 市场样本只能用于竞品/替代竞品参照，不得回填到“本品数据”、本品标题或本品类目。',
        '若标题、详情、OCR与图片识别冲突，必须保留冲突并标记待人工确认，不得自行选择竞品形态。'
    ].join('\n');
}
function validateSelectionReportIdentity(content, info) {
    const issues = [];
    const firstPart = content.split(/\n##\s*第二部分/)[0];
    const expectedForm = info.confirmedProductForm || (Number(info.visualConfidence || 0) >= 70 ? (info.visualProductForm || '') : '');
    if (expectedForm === '液体精华' && /湿巾|预浸湿巾|pet wipes|grooming wipes/i.test(firstPart)) {
        issues.push(`本品${info.confirmedProductForm ? '人工确认锁定' : '视觉识别'}为液体精华，但报告第一部分出现宠物湿巾/预浸湿巾形态`);
    }
    const productName = reportProductName(firstPart);
    if (productName !== '待命名产品' && /湿巾|wipes/i.test(productName) && !/湿巾|wipes/i.test(info.title || '')) {
        issues.push(`报告本品名称“${productName}”与当前商品标题不一致`);
    }
    return issues;
}
/** 报告生成前门禁：证据未确认或冲突未裁决时，不得请求模型生成正式报告。 */
function selectionGenerationGate(info, confirmed) {
    if (!info)
        return '';
    if (!confirmed)
        return '生成报告前必须先确认并锁定本品身份。';
    const evidence = assessExtractionEvidence(info);
    if (evidence.level !== 'COMPLETE' && !info.confirmedProductForm?.trim()) {
        return '当前商品存在证据冲突或证据不足，请完成人工身份裁决后再生成报告。';
    }
    return '';
}
// ─── 选品报告标题归一：产品名优先取当前报告正文、回退触发本次报告的提问，禁止拼接整段会话历史（避免同会话旧产品名覆盖新报告标题） ───
function reportProductName(text) {
    const match = text.match(/(?:^|\n)\s*[-*]?\s*(?:\*\*)?(?:商品名称|产品名称|商品标题|标题)(?:\*\*)?\s*[：:]\s*([^\n]+)/i);
    if (!match)
        return '待命名产品';
    return match[1]
        .replace(/[*_`#]/g, '')
        .replace(/\s*[|｜].*$/, '')
        .trim()
        .slice(0, 36) || '待命名产品';
}
function reportPlatform(text) {
    const explicit = text.match(/(?:目标平台|分析平台|下游平台)\s*[：:]\s*([^\n|｜]+)/i)?.[1]?.trim();
    const source = explicit || text;
    if (/Amazon\s*美国站|亚马逊\s*美国站|Amazon\s*US/i.test(source))
        return 'Amazon美国站';
    if (/Amazon\s*英国站|亚马逊\s*英国站|Amazon\s*UK/i.test(source))
        return 'Amazon英国站';
    if (/Amazon\s*日本站|亚马逊\s*日本站/i.test(source))
        return 'Amazon日本站';
    if (/eBay/i.test(source))
        return /英国/i.test(source) ? 'eBay英国站' : 'eBay美国站';
    if (/Ozon/i.test(source))
        return 'Ozon俄罗斯站';
    if (/Amazon|亚马逊/i.test(source))
        return 'Amazon美国站';
    return explicit?.slice(0, 20) || '目标平台';
}
/** 报告标题归一：triggerText 为触发本次报告的 user 消息（而非整段会话），产品名正文优先 */
function normalizeSelectionReport(content, triggerText) {
    if (!/(?:标准分析报告|选品分析报告|第一部分[：:]\s*本品基础信息)/.test(content))
        return content;
    const fromContent = reportProductName(content);
    const name = fromContent !== '待命名产品' ? fromContent : reportProductName(triggerText);
    // 标题平台只取本次请求，不能让模型输出或历史会话中的旧平台反向污染标题。
    const title = `${name} · ${reportPlatform(triggerText)}选品分析报告`;
    return /^#\s+.+$/m.test(content)
        ? content.replace(/^#\s+.+$/m, `# ${title}`)
        : `# ${title}\n\n${content}`;
}
