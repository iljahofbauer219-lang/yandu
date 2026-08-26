"use strict";
// Amazon 搜索页市场样本抓取契约：页面解析脚本在主进程隐藏视图 executeJavaScript 执行，
// 事实块由渲染层拼入提问，供智能体以「事实/系统抓取」证据等级填写大盘/竞品表；失败静默降级为待验证。
Object.defineProperty(exports, "__esModule", { value: true });
exports.AMAZON_SAMPLES_SCRIPT = void 0;
exports.buildAmazonSearchIntent = buildAmazonSearchIntent;
exports.fallbackAmazonKeywords = fallbackAmazonKeywords;
exports.normalizeAmazonKeywordPlan = normalizeAmazonKeywordPlan;
exports.classifyAmazonSamples = classifyAmazonSamples;
exports.extractAmazonSamples = extractAmazonSamples;
exports.buildMarketFactBlock = buildMarketFactBlock;
exports.buildComparableMarketFactBlock = buildComparableMarketFactBlock;
exports.validateAmazonMarketClaims = validateAmazonMarketClaims;
/** Amazon 检索只能读取本品身份锁；标题仅作为产品名称回退，不能覆盖人工裁决的形态。 */
function buildAmazonSearchIntent(info) {
    const productForm = String(info.confirmedProductForm || info.visualProductForm || '').trim();
    return {
        productName: String(info.confirmedProductName || info.title || '待命名产品').trim(),
        productForm: productForm || '待确认',
        useMethod: String(info.confirmedUseMethod || info.visualUseMethod || '待确认').trim(),
        targetObject: String(info.confirmedTargetObject || info.visualTargetObject || '宠物').trim(),
        excludedTerms: productForm === '液体精华'
            ? ['pet wipes', 'grooming wipes', 'wet wipes', 'pre-moistened wipes']
            : []
    };
}
function normalizedKeyword(value) {
    return value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}
/** 无模型或模型输出漂移时仍可按锁定形态生成稳定的三组买家检索词。 */
function fallbackAmazonKeywords(intent) {
    const target = /猫(?!狗)|cat/i.test(intent.targetObject) && !/狗|dog/i.test(intent.targetObject)
        ? 'cat'
        : /狗(?!猫)|dog/i.test(intent.targetObject) && !/猫|cat/i.test(intent.targetObject)
            ? 'dog'
            : 'pet';
    const byForm = {
        液体精华: [`waterless ${target} shampoo`, `no rinse ${target} cleanser`, `waterless ${target} body wash`],
        湿巾: [`${target} grooming wipes`, `${target} cleaning wipes`, `deodorizing ${target} wipes`],
        泡沫: [`waterless ${target} cleansing foam`, `no rinse ${target} shampoo foam`, `${target} grooming mousse`],
        喷雾: [`${target} grooming spray`, `waterless ${target} cleaning spray`, `${target} deodorizing spray`],
        膏体: [`${target} cleansing cream`, `${target} grooming cream`, `${target} skin cleaning cream`],
        粉末: [`waterless ${target} shampoo powder`, `${target} grooming powder`, `no rinse ${target} cleaning powder`],
        固体: [`${target} shampoo bar`, `${target} grooming soap`, `${target} cleansing bar`]
    };
    return byForm[intent.productForm] || [`${target} grooming cleanser`, `waterless ${target} cleaner`, `${target} body cleaning product`];
}
/** 清洗模型检索词：去除禁用形态、重复词和过长营销句，并用确定性词补足三组。 */
function normalizeAmazonKeywordPlan(intent, modelKeywords) {
    const excluded = intent.excludedTerms.map(normalizedKeyword);
    const accepted = [];
    for (const raw of [...modelKeywords, ...fallbackAmazonKeywords(intent)]) {
        const keyword = normalizedKeyword(String(raw || ''));
        if (!keyword || keyword.split(' ').length < 2 || keyword.split(' ').length > 7)
            continue;
        if (excluded.some(term => keyword.includes(term)))
            continue;
        if (!accepted.includes(keyword))
            accepted.push(keyword);
        if (accepted.length === 3)
            break;
    }
    return { keywords: accepted, source: modelKeywords.some(item => accepted.includes(normalizedKeyword(item))) ? 'model' : 'deterministic' };
}
function targetMatches(title, targetObject) {
    if (/猫(?!狗)|cat/i.test(targetObject) && !/狗|dog/i.test(targetObject))
        return /\b(?:cat|kitten|pet)\b/i.test(title);
    if (/狗(?!猫)|dog/i.test(targetObject) && !/猫|cat/i.test(targetObject))
        return /\b(?:dog|puppy|pet)\b/i.test(title);
    return /\b(?:pet|dog|puppy|cat|kitten)\b/i.test(title);
}
function classifyAmazonSample(intent, sample) {
    const title = sample.title.toLowerCase();
    const sameTarget = targetMatches(title, intent.targetObject);
    const sameJob = /clean|cleans|groom|bath|wash|deodor|shampoo/i.test(title);
    const unrelated = /\b(?:tooth|dental|ear cleaner|eye wipe|brush|comb|clipper|dispenser|empty bottle|refill bottle)\b/i.test(title);
    if (!sameTarget || !sameJob || unrelated) {
        return { comparisonClass: 'NON_COMPARABLE', comparisonReason: !sameTarget ? '适用对象不匹配' : !sameJob ? '核心清洁任务不匹配' : '配件或局部护理品' };
    }
    const patterns = {
        液体精华: /(?:waterless|no[ -]?rinse|rinse[ -]?free).*(?:shampoo|cleanser|wash|bath)|(?:shampoo|cleanser|wash|bath).*(?:waterless|no[ -]?rinse|rinse[ -]?free)/i,
        湿巾: /\b(?:wipes?|pre[ -]?moistened)\b/i,
        泡沫: /\b(?:foam|mousse)\b/i,
        喷雾: /\b(?:spray|mist)\b/i,
        膏体: /\b(?:cream|ointment|balm)\b/i,
        粉末: /\bpowder\b/i,
        固体: /\b(?:bar|soap)\b/i
    };
    const directPattern = patterns[intent.productForm];
    if (directPattern?.test(title))
        return { comparisonClass: 'DIRECT', comparisonReason: '对象、任务与产品形态一致' };
    if (/\b(?:wipes?|foam|mousse|spray|mist|powder|bar|soap|shampoo|cleanser|wash)\b/i.test(title)) {
        return { comparisonClass: 'ADJACENT', comparisonReason: '解决同一任务，但产品形态不同' };
    }
    return { comparisonClass: 'NON_COMPARABLE', comparisonReason: '标题不足以证明形态可比' };
}
/** 跨检索词按 ASIN 去重，并依据身份锁分为直接竞品、替代方案和不可比样本。 */
function classifyAmazonSamples(intent, samples, input = {}) {
    const unique = new Map();
    for (const sample of samples) {
        const key = sample.asin.trim().toUpperCase();
        if (!key)
            continue;
        const previous = unique.get(key);
        // 同一 ASIN 同时出现在赞助位和自然位时保留自然位；纯赞助位不进入竞品统计。
        if (!sample.sponsored && (!previous || previous.sponsored))
            unique.set(key, { ...sample, asin: key });
        else if (!previous)
            unique.set(key, { ...sample, asin: key });
    }
    const classified = [...unique.values()].filter(sample => !sample.sponsored).map(sample => ({ ...sample, ...classifyAmazonSample(intent, sample) }));
    const directCount = classified.filter(item => item.comparisonClass === 'DIRECT').length;
    const adjacentCount = classified.filter(item => item.comparisonClass === 'ADJACENT').length;
    const keywords = new Set(samples.map(item => item.query).filter(Boolean));
    const succeededKeywords = new Set(samples.filter(item => item.asin).map(item => item.query).filter(Boolean));
    const keywordsRequested = Math.max(0, input.keywordsRequested ?? keywords.size);
    const keywordsSucceeded = Math.min(keywordsRequested, Math.max(0, input.keywordsSucceeded ?? succeededKeywords.size));
    const keywordCoveragePercent = keywordsRequested ? Math.round(keywordsSucceeded / keywordsRequested * 100) : 0;
    const direct = classified.filter(item => item.comparisonClass === 'DIRECT');
    const fieldCells = direct.length * 3;
    const populatedCells = direct.reduce((sum, item) => sum + Number(item.price != null) + Number(item.rating != null) + Number(item.reviews != null), 0);
    const fieldCoveragePercent = fieldCells ? Math.round(populatedCells / fieldCells * 100) : 0;
    // 覆盖率公式：直接竞品数量达30占60%，三组词成功率占20%，核心字段覆盖占20%。
    const coveragePercent = Math.round(Math.min(directCount / 30, 1) * 60 + keywordCoveragePercent * 0.2 + fieldCoveragePercent * 0.2);
    const confidence = directCount >= 30 && keywordCoveragePercent === 100 && fieldCoveragePercent >= 80
        ? '可决策'
        : directCount >= 15 && keywordCoveragePercent >= 67
            ? '中等'
            : '低';
    return {
        samples: classified,
        audit: {
            rawCount: samples.length,
            organicCount: samples.filter(item => !item.sponsored).length,
            sponsoredCount: samples.filter(item => item.sponsored).length,
            uniqueCount: classified.length,
            directCount,
            adjacentCount,
            excludedCount: classified.length - directCount - adjacentCount,
            keywordsRequested,
            keywordsSucceeded,
            keywordCoveragePercent,
            fieldCoveragePercent,
            coveragePercent,
            confidence
        }
    };
}
/** Amazon 搜索结果页样本提取（页面上下文执行；captcha/机器人校验时返回 null）。
 *  函数必须自包含（不引用模块级变量）：主进程经 toString 序列化注入隐藏视图执行，测试侧直接调用 */
function extractAmazonSamples(doc) {
    if (/captcha|robot check/i.test(doc.title) || doc.querySelector('form[action*="validateCaptcha"]'))
        return null;
    const samples = [];
    for (const card of Array.from(doc.querySelectorAll('div[data-component-type="s-search-result"]'))) {
        const asin = (card.getAttribute('data-asin') || '').trim();
        if (!asin)
            continue;
        const title = (card.querySelector('h2') || {}).textContent?.replace(/\s+/g, ' ').trim() || '';
        const priceText = ((card.querySelector('.a-price .a-offscreen') || {}).textContent || '').replace(/[^0-9.]/g, '');
        const ratingText = ((card.querySelector('i.a-icon-star span.a-icon-alt') || card.querySelector('i.a-icon-star') || {}).textContent || '');
        const ratingMatch = ratingText.match(/([\d.]+)/);
        const reviewEl = card.querySelector('a[href*="customerReviews"] span, a[href*="product-reviews"] span');
        const reviewsText = (reviewEl || {}).textContent?.replace(/[^0-9]/g, '') || '';
        samples.push({
            asin,
            title,
            price: priceText ? parseFloat(priceText) : null,
            rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
            reviews: reviewsText ? parseInt(reviewsText, 10) : null,
            sponsored: /sponsored/i.test((card.querySelector('[aria-label*="Sponsored"], .s-sponsored-label-info-icon') || {}).textContent || '') || Boolean(card.querySelector('[aria-label*="Sponsored"], .s-sponsored-label-info-icon')),
            source: 'browser'
        });
        if (samples.length >= 48)
            break;
    }
    return samples;
}
/** 主进程隐藏视图 executeJavaScript 注入串：序列化自 extractAmazonSamples，单一事实源 */
exports.AMAZON_SAMPLES_SCRIPT = `(${extractAmazonSamples.toString()})(document)`;
function median(values) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
function percentile(values, ratio) {
    if (!values.length)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * ratio;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return lower === upper ? sorted[lower] : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}
const round1 = (value) => Math.round(value * 10) / 10;
const money = (value) => `$${value.toFixed(2)}`;
/** 组装「系统抓取事实块」追加到提问文本：智能体据此填写第二部分大盘与第三部分竞品表（证据等级 事实/系统抓取） */
function buildMarketFactBlock(keyword, samples) {
    const prices = samples.map(item => item.price).filter((value) => value != null && value > 0);
    const ratings = samples.map(item => item.rating).filter((value) => value != null && value > 0);
    const reviews = samples.map(item => item.reviews).filter((value) => value != null);
    const lines = [];
    lines.push(`## 系统抓取 Amazon 美国站市场样本（抓取日期：${new Date().toLocaleDateString('en-CA')}｜检索词：${keyword}｜样本数：${samples.length}）`);
    if (prices.length) {
        const sorted = [...prices].sort((a, b) => a - b);
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        lines.push(`- 零售价格区间：${money(sorted[0])}–${money(sorted[sorted.length - 1])}｜中位价 ${money(median(prices))}｜均价 ${money(mean)}`);
    }
    if (ratings.length)
        lines.push(`- 评分均值：${round1(ratings.reduce((a, b) => a + b, 0) / ratings.length)}（${ratings.length} 个样本）`);
    if (reviews.length) {
        const reviewMean = reviews.reduce((a, b) => a + b, 0) / reviews.length;
        lines.push(`- 评论量中位 ${Math.round(median(reviews)).toLocaleString('en-US')}｜均值 ${Math.round(reviewMean).toLocaleString('en-US')}`);
    }
    const top = [...samples].sort((a, b) => (b.reviews || 0) - (a.reviews || 0)).slice(0, 8);
    if (top.length) {
        lines.push('- 高评论样本（ASIN 为系统抓取、来源可信，可按规则15输出 dp 链接）：');
        top.forEach((item, index) => {
            const price = item.price != null ? money(item.price) : '价格缺失';
            const review = item.reviews != null ? item.reviews.toLocaleString('en-US') : '-';
            lines.push(`  ${index + 1}. ${item.asin}｜${price}｜评分 ${item.rating ?? '-'}｜评论 ${review}｜${item.title.slice(0, 60)}`);
        });
    }
    lines.push('以上为系统抓取真实数据，请优先用于第二部分大盘与第三部分竞品表，证据等级标「事实」，来源注明「系统抓取Amazon搜索页+抓取日期」；样本不足的指标仍写「待验证」。');
    return lines.join('\n');
}
/** 仅直接可比样本进入价格、评分和评论统计；替代方案单列，不可比样本明确排除。 */
function buildComparableMarketFactBlock(intent, plan, samples, audit) {
    const direct = samples.filter(item => item.comparisonClass === 'DIRECT');
    const adjacent = samples.filter(item => item.comparisonClass === 'ADJACENT');
    const prices = direct.map(item => item.price).filter((value) => value != null && value > 0);
    const ratings = direct.map(item => item.rating).filter((value) => value != null && value > 0);
    const reviews = direct.map(item => item.reviews).filter((value) => value != null);
    const lines = [
        `## 系统抓取 Amazon 美国站可比市场样本（抓取日期：${new Date().toLocaleDateString('en-CA')}）`,
        `- 本品身份：${intent.productName}｜形态：${intent.productForm}｜用途：${intent.useMethod}｜适用对象：${intent.targetObject}`,
        `- 检索词：${plan.keywords.join('；')}（${plan.source === 'model' ? '模型生成并经身份规则清洗' : '身份规则确定性生成'}）`,
        `- 样本审计：原始 ${audit.rawCount}｜自然位 ${audit.organicCount}｜赞助位排除 ${audit.sponsoredCount}｜ASIN去重 ${audit.uniqueCount}｜DIRECT直接竞品 ${audit.directCount}｜ADJACENT替代方案 ${audit.adjacentCount}｜NON_COMPARABLE排除 ${audit.excludedCount}`,
        `- 样本完整率：${audit.coveragePercent}%｜检索词成功 ${audit.keywordsSucceeded}/${audit.keywordsRequested}（${audit.keywordCoveragePercent}%）｜DIRECT核心字段覆盖 ${audit.fieldCoveragePercent}%｜结论置信度：${audit.confidence}`,
        '- 证据等级：F（系统抓取的 Amazon 美国站搜索页直接观察值）；样本统计仅代表上述检索词和抓取窗口，不等同完整市场。'
    ];
    if (audit.confidence === '低')
        lines.push('- 样本限制：DIRECT 少于 15 个，只能作为方向性样本，不得写成 TOP50 或完整市场结论。');
    else if (audit.confidence === '中等')
        lines.push('- 样本限制：DIRECT 为 15–29 个，可作初步判断，但不足以代表完整 TOP50。');
    if (prices.length) {
        const sorted = [...prices].sort((a, b) => a - b);
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        lines.push(`- DIRECT 零售价格：P25 ${money(percentile(prices, 0.25))}｜中位价 ${money(median(prices))}｜P75 ${money(percentile(prices, 0.75))}｜区间 ${money(sorted[0])}–${money(sorted[sorted.length - 1])}｜均价 ${money(mean)}`);
    }
    if (ratings.length)
        lines.push(`- DIRECT 评分中位：${round1(median(ratings))}｜均值 ${round1(ratings.reduce((a, b) => a + b, 0) / ratings.length)}（${ratings.length} 个样本）`);
    if (reviews.length)
        lines.push(`- DIRECT 评论量：中位 ${Math.round(median(reviews)).toLocaleString('en-US')}｜P75 ${Math.round(percentile(reviews, 0.75)).toLocaleString('en-US')}｜均值 ${Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length).toLocaleString('en-US')}`);
    const top = [...direct].sort((a, b) => (b.reviews || 0) - (a.reviews || 0)).slice(0, 8);
    if (top.length) {
        lines.push('- DIRECT 直接竞品（仅这些样本可进入核心价格与竞争统计）：');
        top.forEach((item, index) => lines.push(`  ${index + 1}. ${item.asin}｜${item.price != null ? money(item.price) : '价格缺失'}｜评分 ${item.rating ?? '-'}｜评论 ${item.reviews?.toLocaleString('en-US') ?? '-'}｜${item.title.slice(0, 80)}｜检索词 ${item.query || '-'}`));
    }
    if (adjacent.length) {
        lines.push('- ADJACENT 替代方案（只用于需求空白/替代方案观察，不得回填本品形态或 DIRECT 统计）：');
        adjacent.slice(0, 5).forEach((item, index) => lines.push(`  ${index + 1}. ${item.asin}｜${item.title.slice(0, 80)}｜${item.comparisonReason}`));
    }
    lines.push('- NON_COMPARABLE 与纯赞助位已从统计和竞品表中排除。所有数值均为系统抓取的搜索页观察值；未抓取的销量、销售额和趋势证据等级为 U，必须写“待验证”。');
    if (audit.coveragePercent < 80)
        lines.push('- 决策门禁：样本完整率低于 80%，不得输出“✅ 建议入场”；只能输出“⚠️ 有条件谨慎入场”或“❓ 数据不足，不能判定”，并列出补数任务。');
    return lines.join('\n');
}
/** 报告后置市场门禁：禁止把不足样本包装成 TOP50、精确销量或无条件 GO。 */
function validateAmazonMarketClaims(content, audit) {
    const issues = [];
    const lines = content.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const acceptableUnknown = /待验证|未知|数据不足|未达到|不足以|不能|不可|仅作|假设|估算|U\b/i;
    const misleadingTop50 = lines.find(line => /TOP\s*50/i.test(line) && /[$¥￥\d]/.test(line) && !acceptableUnknown.test(line));
    if (audit.confidence !== '可决策' && misleadingTop50)
        issues.push(`样本置信度为${audit.confidence}，但报告把 TOP50 写成已验证数值：${misleadingTop50.slice(0, 100)}`);
    const unsupportedMarketMetric = lines.find(line => /(?:月销量|月销售额|市场规模|增长趋势|近\s*6\s*月)/i.test(line) && /[$¥￥%]|\d/.test(line) && !acceptableUnknown.test(line));
    if (unsupportedMarketMetric)
        issues.push(`系统未抓取销量、销售额或趋势，但报告输出了无证据数值：${unsupportedMarketMetric.slice(0, 100)}`);
    if (audit.coveragePercent < 80 && /✅\s*建议入场/.test(content))
        issues.push(`样本完整率仅${audit.coveragePercent}%，不得输出无条件“建议入场”`);
    return issues;
}
