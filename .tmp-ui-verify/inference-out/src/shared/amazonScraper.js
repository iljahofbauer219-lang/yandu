"use strict";
// Amazon 搜索页市场样本抓取契约：页面解析脚本在主进程隐藏视图 executeJavaScript 执行，
// 事实块由渲染层拼入提问，供智能体以「事实/系统抓取」证据等级填写大盘/竞品表；失败静默降级为待验证。
Object.defineProperty(exports, "__esModule", { value: true });
exports.AMAZON_REVIEW_EVIDENCE_SCRIPT = exports.AMAZON_LISTING_EVIDENCE_SCRIPT = exports.AMAZON_SAMPLES_SCRIPT = exports.AMAZON_RESEARCH_SAMPLE_BASELINE = void 0;
exports.meetsAmazonResearchSampleBaseline = meetsAmazonResearchSampleBaseline;
exports.buildAmazonSearchIntent = buildAmazonSearchIntent;
exports.fallbackAmazonKeywords = fallbackAmazonKeywords;
exports.normalizeAmazonKeywordPlan = normalizeAmazonKeywordPlan;
exports.classifyAmazonSamples = classifyAmazonSamples;
exports.extractAmazonSamples = extractAmazonSamples;
exports.parseAmazonItemWeightGrams = parseAmazonItemWeightGrams;
exports.parseAmazonPackageDimensionsCm = parseAmazonPackageDimensionsCm;
exports.determineAmazonSizeTier = determineAmazonSizeTier;
exports.estimateFbaFulfillmentFee = estimateFbaFulfillmentFee;
exports.amazonProfitDecisionEvidenceIssues = amazonProfitDecisionEvidenceIssues;
exports.buildAmazonQuickMarketProfitFactBlock = buildAmazonQuickMarketProfitFactBlock;
exports.buildAmazonFullCostProfitFactBlock = buildAmazonFullCostProfitFactBlock;
exports.evaluateAmazonEntryDecision = evaluateAmazonEntryDecision;
exports.buildAmazonEntryDecisionFactBlock = buildAmazonEntryDecisionFactBlock;
exports.validateAmazonEntryDecisionClaim = validateAmazonEntryDecisionClaim;
exports.buildMarketFactBlock = buildMarketFactBlock;
exports.buildComparableMarketFactBlock = buildComparableMarketFactBlock;
exports.validateAmazonMarketClaims = validateAmazonMarketClaims;
exports.sanitizeAmazonMarketClaims = sanitizeAmazonMarketClaims;
/** 达标仅表示可进入市场竞争力评估，不自动等同于“建议入场”。 */
exports.AMAZON_RESEARCH_SAMPLE_BASELINE = {
    keywordsRequested: 3,
    keywordsSucceeded: 3,
    directCount: 15,
    fieldCoveragePercent: 50,
    coveragePercent: 50
};
function meetsAmazonResearchSampleBaseline(audit) {
    return audit.keywordsRequested === exports.AMAZON_RESEARCH_SAMPLE_BASELINE.keywordsRequested
        && audit.keywordsSucceeded >= exports.AMAZON_RESEARCH_SAMPLE_BASELINE.keywordsSucceeded
        && audit.directCount >= exports.AMAZON_RESEARCH_SAMPLE_BASELINE.directCount
        && audit.fieldCoveragePercent >= exports.AMAZON_RESEARCH_SAMPLE_BASELINE.fieldCoveragePercent
        && audit.coveragePercent >= exports.AMAZON_RESEARCH_SAMPLE_BASELINE.coveragePercent;
}
function unitNumber(value) {
    return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
}
function retailUnitMultiplier(text, unitIndex) {
    const nearby = `${text.slice(Math.max(0, unitIndex - 32), unitIndex)} ${text.slice(unitIndex, unitIndex + 32)}`;
    const nearbyMatch = nearby.match(/\b(\d+)\s*(?:pack|ct|count|pcs?|pieces?|bottles?)\b|\b(?:pack)\s+of\s+(\d+)\b/i);
    const titleMatch = text.match(/\b(\d+)\s*(?:pack|ct|count|pcs?|pieces?|bottles?)\b|\b(?:pack)\s+of\s+(\d+)\b/i);
    const match = nearbyMatch || titleMatch;
    const value = Number(match?.[1] || match?.[2] || 1);
    return Number.isFinite(value) && value > 0 ? value : 1;
}
/** 仅从明确写出的容量或片数读取零售单位；不根据标题或图片猜测规格。 */
function retailUnitFromText(value) {
    const text = String(value || '');
    const multipliedVolume = text.match(/(\d+(?:\.\d+)?)\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*(ml|毫升|fl\.?\s*oz)\b/i);
    if (multipliedVolume) {
        const first = Number(multipliedVolume[1]);
        const second = Number(multipliedVolume[2]);
        const ml = /fl\.?\s*oz/i.test(multipliedVolume[3]) ? second * 29.5735 : second;
        const quantity = first * ml;
        if (Number.isFinite(quantity) && quantity > 0)
            return { kind: 'volume_ml', quantity, label: `${unitNumber(quantity)}ml` };
    }
    const volume = /(?:^|[^a-z0-9])(\d+(?:\.\d+)?)\s*(ml|毫升|fl\.?\s*oz)\b/i.exec(text);
    if (volume) {
        const amount = Number(volume[1]);
        const ml = /fl\.?\s*oz/i.test(volume[2]) ? amount * 29.5735 : amount;
        const quantity = ml * retailUnitMultiplier(text, volume.index);
        if (Number.isFinite(quantity) && quantity > 0)
            return { kind: 'volume_ml', quantity, label: `${unitNumber(quantity)}ml` };
    }
    const count = /(?:^|[^a-z0-9])(\d+)\s*(?:wipes?|ct|count|pcs?|pieces?|片|抽|张)\b/i.exec(text);
    if (count) {
        const quantity = Number(count[1]) * retailUnitMultiplier(text, count.index);
        if (Number.isFinite(quantity) && quantity > 0)
            return { kind: 'count', quantity, label: `${unitNumber(quantity)}件` };
    }
    return null;
}
function retailUnitFromIdentity(info) {
    const source = [info.title, ...(info.attributes || []), info.detailText].filter(Boolean).join('\n');
    return retailUnitFromText(source);
}
/** Amazon 检索只能读取本品身份锁；标题仅作为产品名称回退，不能覆盖人工裁决的形态。 */
function buildAmazonSearchIntent(info) {
    const productForm = String(info.confirmedProductForm || info.visualProductForm || '').trim();
    return {
        productName: String(info.confirmedProductName || info.title || '待命名产品').trim(),
        productForm: productForm || '待确认',
        useMethod: String(info.confirmedUseMethod || info.visualUseMethod || '待确认').trim(),
        targetObject: String(info.confirmedTargetObject || info.visualTargetObject || '宠物').trim(),
        retailUnit: retailUnitFromIdentity(info) || undefined,
        excludedTerms: productForm === '液体精华'
            ? ['pet wipes', 'grooming wipes', 'wet wipes', 'pre-moistened wipes']
            : []
    };
}
function normalizedKeyword(value) {
    return value.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}
/**
 * 可比性的核心用途只能由已锁定的本品身份推导；检索词和竞品分类共用本规则，
 * 避免把“防咬喷雾”错误套进“洗护喷雾”的固定词表。
 */
function coreUseOf(value) {
    const text = String(value || '').toLowerCase();
    if (/防咬|防啃|防舔|苦味|苦苹果|苦苹果|anti[ -]?bite|anti[ -]?chew|bitter(?:\s+apple)?|chew\s+deterrent|no[ -]?chew|stop\s+chewing|biting\s+deterrent/.test(text))
        return 'BITE_DETERRENT';
    if (/清洁|洗护|洗澡|免洗|除臭|clean|cleans|groom|bath|wash|deodor|shampoo|body\s+cleanser|no[ -]?rinse/.test(text))
        return 'CLEANSE';
    return null;
}
function intentCoreUse(intent) {
    return coreUseOf(`${intent.productName} ${intent.useMethod}`);
}
function coreUseMatches(intent, value) {
    const expected = intentCoreUse(intent);
    return expected != null && coreUseOf(value) === expected;
}
/** 无模型或模型输出漂移时仍可按锁定形态生成稳定的三组买家检索词。 */
function fallbackAmazonKeywords(intent) {
    const target = /猫(?!狗)|cat/i.test(intent.targetObject) && !/狗|dog/i.test(intent.targetObject)
        ? 'cat'
        : /狗(?!猫)|dog/i.test(intent.targetObject) && !/猫|cat/i.test(intent.targetObject)
            ? 'dog'
            : 'pet';
    if (intentCoreUse(intent) === 'BITE_DETERRENT') {
        const byDeterrentForm = {
            喷雾: [`${target} bitter apple spray`, `${target} chew deterrent spray`, `${target} anti bite spray`],
            膏体: [`${target} bitter anti chew balm`, `${target} chew deterrent cream`, `${target} anti bite balm`],
            液体精华: [`${target} bitter anti chew liquid`, `${target} chew deterrent liquid`, `${target} no chew deterrent`]
        };
        return byDeterrentForm[intent.productForm] || [`${target} bitter apple deterrent`, `${target} chew deterrent`, `${target} anti bite product`];
    }
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
        if (!coreUseMatches(intent, keyword))
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
        return /\b(?:cats?|kittens?|pets?)\b/i.test(title);
    if (/狗(?!猫)|dog/i.test(targetObject) && !/猫|cat/i.test(targetObject))
        return /\b(?:dogs?|pupp(?:y|ies)|pets?)\b/i.test(title);
    return /\b(?:pets?|dogs?|pupp(?:y|ies)|cats?|kittens?)\b/i.test(title);
}
function classifyAmazonSample(intent, sample) {
    const title = sample.title.toLowerCase();
    const sameTarget = targetMatches(title, intent.targetObject);
    const sameJob = coreUseMatches(intent, title);
    const unrelated = /\b(?:tooth|dental|ear cleaner|eye wipe|brush|comb|clipper|dispenser|empty bottle|refill bottle)\b/i.test(title);
    if (!sameTarget || !sameJob || unrelated) {
        return { comparisonClass: 'NON_COMPARABLE', comparisonReason: !sameTarget ? '适用对象不匹配' : !sameJob ? '核心用途不匹配或待确认' : '配件或局部护理品' };
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
/** Amazon 搜索页的 “10K+ bought in past month” 不是精确销量，解析为可核验的最低购买量信号。 */
function salesSignalLowerBound(value) {
    const match = String(value || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)\s*([KM])?\+?\s*(?:bought|purchased|orders?)/i);
    if (!match)
        return null;
    const multiplier = match[2]?.toUpperCase() === 'M' ? 1000000 : match[2]?.toUpperCase() === 'K' ? 1000 : 1;
    const amount = Number(match[1]) * multiplier;
    return Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : null;
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
    const salesSignals = direct.map(item => salesSignalLowerBound(item.salesVolume)).filter((value) => value != null);
    const fieldCells = direct.length * 3;
    const populatedCells = direct.reduce((sum, item) => sum + Number(item.price != null) + Number(item.rating != null) + Number(item.reviews != null), 0);
    const fieldCoveragePercent = fieldCells ? Math.round(populatedCells / fieldCells * 100) : 0;
    // 覆盖率公式：直接竞品数量达30占60%，三组词成功率占20%，核心字段覆盖占20%。
    const coveragePercent = Math.round(Math.min(directCount / 30, 1) * 60 + keywordCoveragePercent * 0.2 + fieldCoveragePercent * 0.2);
    const confidence = keywordsRequested === exports.AMAZON_RESEARCH_SAMPLE_BASELINE.keywordsRequested
        && keywordsSucceeded >= exports.AMAZON_RESEARCH_SAMPLE_BASELINE.keywordsSucceeded
        && directCount >= exports.AMAZON_RESEARCH_SAMPLE_BASELINE.directCount
        && fieldCoveragePercent >= exports.AMAZON_RESEARCH_SAMPLE_BASELINE.fieldCoveragePercent
        && coveragePercent >= exports.AMAZON_RESEARCH_SAMPLE_BASELINE.coveragePercent
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
            salesSignalCount: salesSignals.length,
            salesSignalLowerBound: salesSignals.reduce((sum, value) => sum + value, 0),
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
/** Amazon Product Details 表格中 “Item Weight / Shipping Weight” → 克。 */
function parseAmazonItemWeightGrams(value) {
    if (!value)
        return null;
    const match = value.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)\s*(oz|lb|g|kg|ounces|pounds|grams|kilograms)/i);
    if (!match)
        return null;
    const num = Number(match[1]);
    if (!Number.isFinite(num) || num <= 0)
        return null;
    const unit = match[2].toLowerCase();
    if (unit === 'oz' || unit === 'ounces')
        return Math.round(num * 28.3495);
    if (unit === 'lb' || unit === 'pounds')
        return Math.round(num * 453.592);
    if (unit === 'kg' || unit === 'kilograms')
        return Math.round(num * 1000);
    return Math.round(num);
}
/** Amazon Product Details 表格中 “Package Dimensions / Product Dimensions” → 厘米。 */
function parseAmazonPackageDimensionsCm(value) {
    if (!value)
        return null;
    const match = value.match(/([0-9]+(?:\.[0-9]+)?)\s*(in|cm|inch|inches)?\s*[xX×*]\s*([0-9]+(?:\.[0-9]+)?)\s*(in|cm|inch|inches)?\s*[xX×*]\s*([0-9]+(?:\.[0-9]+)?)\s*(in|cm|inch|inches)?/i);
    if (!match)
        return null;
    const units = [match[2] || '', match[4] || '', match[6] || ''];
    // 任一单位为 cm 表达则全列以 cm 计算，避免 “10 × 8 × 3 cm” 被误认为 10 in。
    const useCm = units.some(unit => /cm/i.test(unit));
    const toCm = (n) => (useCm ? n : n * 2.54);
    return {
        length: Number(toCm(Number(match[1])).toFixed(2)),
        width: Number(toCm(Number(match[3])).toFixed(2)),
        height: Number(toCm(Number(match[5])).toFixed(2))
    };
}
/** FBA Size Tier 推断。Amazon US 2024-09 生效版。 */
function determineAmazonSizeTier(weightGrams, dimensionsCm) {
    if (!Number.isFinite(weightGrams) || weightGrams <= 0)
        return null;
    const wG = weightGrams;
    const wOz = wG / 28.3495;
    const wLb = wG / 453.592;
    const sortedDims = dimensionsCm ? [dimensionsCm.length, dimensionsCm.width, dimensionsCm.height].sort((a, b) => b - a) : [];
    const [longest, median, shortest] = [sortedDims[0] || 0, sortedDims[1] || 0, sortedDims[2] || 0];
    const lengthIn = longest / 2.54;
    const widthIn = median / 2.54;
    const heightIn = shortest / 2.54;
    // 顺序：小标准 → 大标准 → 大件 → 超大件；未提供尺寸时按重量且 ≤20 lb 认作大标准。
    if (wOz <= 6 && lengthIn <= 4 && widthIn <= 6 && heightIn <= 0.5)
        return 'SmallStandard';
    // LargeStandard 上限 20 lb、25×18×14 in；超过则进 LargeBulky。
    const withinLargeStandardDims = !dimensionsCm || (lengthIn <= 25 && widthIn <= 18 && heightIn <= 14);
    if (wLb <= 20 && withinLargeStandardDims)
        return 'LargeStandard';
    if (wLb > 70 && wLb <= 150)
        return 'ExtraLarge';
    if (wLb > 1 && wLb <= 70 && lengthIn <= 108 && widthIn <= 75 && heightIn <= 63)
        return 'LargeBulky';
    if (wLb > 150)
        return 'ExtraLarge';
    return null;
}
/** 主进程隐藏视图 executeJavaScript 注入串：序列化自 extractAmazonSamples，单一事实源 */
exports.AMAZON_SAMPLES_SCRIPT = `(${extractAmazonSamples.toString()})(document)`;
/**
 * 详情页解析只读取 Amazon 当前可见 DOM，不推算销量、不补造卖点。
 * 在主进程隐藏视图中执行，因此返回的时间和 URL 是本次抓取的可追溯证据。
 */
function extractAmazonListingEvidence(doc) {
    if (/captcha|robot check/i.test(doc.title) || doc.querySelector('form[action*="validateCaptcha"]'))
        return null;
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const text = (...selectors) => {
        for (const selector of selectors) {
            const value = clean(doc.querySelector(selector)?.textContent);
            if (value)
                return value;
        }
        return '';
    };
    const number = (value) => {
        const match = value.replace(/,/g, '').match(/\$?\s*([0-9]+(?:\.[0-9]{1,2})?)/);
        return match ? Number(match[1]) : null;
    };
    const asin = clean(doc.querySelector('#ASIN')?.value)
        || clean(doc.querySelector('input[name="ASIN"]')?.getAttribute('value'))
        || clean(doc.documentElement.innerHTML.match(/"asin"\s*:\s*"([A-Z0-9]{10})"/i)?.[1]);
    const title = text('#productTitle');
    if (!asin || !title)
        return null;
    const brandRaw = text('#bylineInfo', '#brand');
    const brand = clean(brandRaw.replace(/^(visit the|brand:|store:|by)\s+/i, '').replace(/\s+store$/i, '')) || null;
    const price = number(text('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen', '#corePrice_feature_div .a-price .a-offscreen', '#apex_desktop .a-price .a-offscreen', '.a-price .a-offscreen'));
    const rating = number(text('[data-hook="rating-out-of-text"]', '#acrPopover .a-icon-alt'));
    const reviews = number(text('#acrCustomerReviewText', '[data-hook="total-review-count"]'));
    const details = clean(text('#productDetails_detailBullets_sections1', '#detailBullets_feature_div', '#productDetails_db_sections'));
    const bsr = clean(details.match(/Best Sellers Rank\s*[:#]?\s*([^|]{1,240})/i)?.[1]) || null;
    // 逐行取 Product Details 表中 “Item Weight / Package Dimensions” 对应值；标签变体多，正则同时覆盖多语言
    const detailRows = Array.from(doc.querySelectorAll('#productDetails_detailBullets_sections1 tr, #productDetails_db_sections tr, #detailBullets_feature_div tr, #productDetails_techSpec_section_1 tr, .a-keyvalue tr'))
        .map(row => {
        const th = clean(row.querySelector('th, .a-span3, .a-color-secondary')?.textContent);
        const td = clean(row.querySelector('td, .a-span9, .a-color-base')?.textContent);
        return { th, td };
    })
        .filter(row => row.th && row.td);
    const weightRow = detailRows.find(row => /Item\s*Weight|Shipping\s*Weight|产品重量|商品重量|毛重|单件重量|包装重量/i.test(row.th));
    const dimRow = detailRows.find(row => /Package\s*Dimensions|Product\s*Dimensions|Item\s*Dimensions|包装尺寸|产品尺寸|外箱尺寸|单件(?:包装)?尺寸/i.test(row.th));
    const itemWeightGrams = weightRow ? parseAmazonItemWeightGrams(weightRow.td) : null;
    const packageDimensionsCm = dimRow ? parseAmazonPackageDimensionsCm(dimRow.td) : null;
    const sizeTierGuess = (itemWeightGrams || packageDimensionsCm) ? determineAmazonSizeTier(itemWeightGrams, packageDimensionsCm) : null;
    const badges = Array.from(doc.querySelectorAll('#acBadge_feature_div, #acBadge_feature_div *, [data-feature-name="acBadge"], [data-feature-name="acBadge"] *'))
        .map(node => clean(node.textContent))
        .filter(value => /Amazon'?s Choice|Best Seller|Climate Pledge Friendly/i.test(value))
        .filter((value, index, all) => all.indexOf(value) === index)
        .slice(0, 4);
    const bulletPoints = Array.from(doc.querySelectorAll('#feature-bullets li span.a-list-item, #productFactsDesktopExpander li'))
        .map(node => clean(node.textContent))
        .filter(value => value.length >= 8 && !/^see more/i.test(value))
        .filter((value, index, all) => all.indexOf(value) === index)
        .slice(0, 5);
    const coupon = text('#couponTextpctch', '#couponBadge', '[data-csa-c-content-id="coupon"]') || null;
    const subscribeSave = text('#snsAccordionRow', '#sns-base-price', '[data-a-name="snsLink"]') || null;
    const variantSummary = Array.from(doc.querySelectorAll('#twister_feature_div .selection, #variation_color_name .selection, #variation_size_name .selection'))
        .map(node => clean(node.textContent))
        .filter(Boolean)
        .filter((value, index, all) => all.indexOf(value) === index)
        .slice(0, 4)
        .join('；') || null;
    const seller = text('#merchantInfo', '#sellerProfileTriggerId') || null;
    const operations = [
        coupon ? `优惠券：${coupon}` : '',
        subscribeSave ? `订阅省：${subscribeSave}` : '',
        variantSummary ? `变体：${variantSummary}` : '',
        ...badges.map(item => `徽标：${item}`)
    ].filter(Boolean);
    return {
        asin,
        url: location.href,
        capturedAt: new Date().toISOString(),
        source: 'browser',
        title,
        brand,
        price,
        rating,
        reviews,
        bsr,
        badges,
        bulletPoints,
        coupon,
        subscribeSave,
        variantSummary,
        seller,
        operations,
        itemWeightGrams,
        packageDimensionsCm,
        sizeTierGuess
    };
}
exports.AMAZON_LISTING_EVIDENCE_SCRIPT = `(${extractAmazonListingEvidence.toString()})(document)`;
const FBA_FEE_RATE_TABLE_VERSION = 'Amazon US FBA 2024-09 生效费率（Standard Size，默认 Non-Apparel/Non-Dangerous）';
/**
 * 按 Amazon US 2024-09 生效版 FBA Standard-Size 费率表推算单件履约费。
 * 阶段 4 用作 profitFieldMeta.source 填充，不作为最终成交成本。
 * 价格不参与金额计算，仅用于决定 LargeStandard 1.5–2 lb 是否启用体积重量附加。
 */
function estimateFbaFulfillmentFee(input) {
    const warnings = [];
    if (!Number.isFinite(input.weightGrams) || input.weightGrams <= 0) {
        return { feeUsd: null, sizeTier: null, source: '缺少毛重', warnings: ['未抓取到 Item Weight，无法推算 FBA 履约费'] };
    }
    const wG = input.weightGrams;
    const wOz = wG / 28.3495;
    const wLb = wG / 453.592;
    const sortedDims = input.dimensionsCm
        ? [input.dimensionsCm.length, input.dimensionsCm.width, input.dimensionsCm.height].sort((a, b) => b - a)
        : [];
    const [longest, median, shortest] = [sortedDims[0] || 0, sortedDims[1] || 0, sortedDims[2] || 0];
    const lengthIn = longest / 2.54;
    const widthIn = median / 2.54;
    const heightIn = shortest / 2.54;
    const tier = input.sizeTier || determineAmazonSizeTier(wG, input.dimensionsCm || null);
    if (!tier) {
        return {
            feeUsd: null,
            sizeTier: null,
            source: 'Size Tier 未命中',
            warnings: ['重量/尺寸未命中 Amazon FBA Standard Size 任一档位（SmallStandard/LargeStandard），需人工按 Large Bulky 或 Extra Large 报价']
        };
    }
    if (tier === 'SmallStandard') {
        if (wOz <= 4)
            return { feeUsd: 3.06, sizeTier: tier, source: `${FBA_FEE_RATE_TABLE_VERSION}｜SmallStandard ≤ 4 oz = $3.06`, warnings };
        if (wOz <= 6)
            return { feeUsd: 3.15, sizeTier: tier, source: `${FBA_FEE_RATE_TABLE_VERSION}｜SmallStandard 4–6 oz = $3.15`, warnings };
        return { feeUsd: 3.15, sizeTier: tier, source: `${FBA_FEE_RATE_TABLE_VERSION}｜SmallStandard 4–6 oz = $3.15（>6 oz 实际应转 LargeStandard，需人工复核）`, warnings: ['>6 oz 仍按 SmallStandard 6 oz 上限推算，建议按 LargeStandard 0.5 lb 重测'] };
    }
    if (tier === 'LargeStandard') {
        if (wLb <= 0.5)
            return { feeUsd: 3.43, sizeTier: tier, source: `${FBA_FEE_RATE_TABLE_VERSION}｜LargeStandard ≤ 0.5 lb = $3.43`, warnings };
        if (wLb <= 1)
            return { feeUsd: 3.78, sizeTier: tier, source: `${FBA_FEE_RATE_TABLE_VERSION}｜LargeStandard 0.5–1 lb = $3.78`, warnings };
        if (wLb <= 1.5)
            return { feeUsd: 4.39, sizeTier: tier, source: `${FBA_FEE_RATE_TABLE_VERSION}｜LargeStandard 1–1.5 lb = $4.39`, warnings };
        if (wLb <= 2) {
            const note = `LargeStandard 1.5–2 lb = $4.88${lengthIn > 12 || widthIn > 9 || heightIn > 4 ? '（已含体积重量附加）' : ''}`;
            return { feeUsd: 4.88, sizeTier: tier, source: `${FBA_FEE_RATE_TABLE_VERSION}｜${note}`, warnings: ['1.5–2 lb 价格带含体积重量附加，建议同步复核 listing 类目是否触发 Apparel 分级'] };
        }
        if (wLb <= 3)
            return { feeUsd: 5.40, sizeTier: tier, source: `${FBA_FEE_RATE_TABLE_VERSION}｜LargeStandard 2–3 lb = $5.40`, warnings };
        if (wLb <= 20)
            return { feeUsd: 5.40 + Math.ceil((wLb - 3) / 0.5) * 0.20, sizeTier: tier, source: `${FBA_FEE_RATE_TABLE_VERSION}｜LargeStandard 3–20 lb = $5.40 + 阶梯`, warnings: ['3+ lb 使用阶梯式附加费率，已按 0.5 lb 阶梯粗估，最终金额须用 Amazon Revenue Calculator 复核'] };
        return { feeUsd: null, sizeTier: null, source: 'LargeStandard 重量 > 20 lb', warnings: ['>20 lb 实际为 Large Bulky/Extra Large，需人工按报价补差'] };
    }
    if (tier === 'LargeBulky') {
        if (wLb <= 50)
            return { feeUsd: 9.61 + Math.ceil((wLb - 1) / 0.5) * 0.42, sizeTier: tier, source: `${FBA_FEE_RATE_TABLE_VERSION}｜LargeBulky 1–50 lb = $9.61 + 阶梯`, warnings: ['LargeBulky 按 0.5 lb 阶梯粗估，最终金额必须以 Amazon Revenue Calculator 输出为准'] };
        return { feeUsd: 26.33, sizeTier: tier, source: `${FBA_FEE_RATE_TABLE_VERSION}｜LargeBulky 50–70 lb 约 $26.33（仅做兜底报价）`, warnings: ['50+ lb 已使用兜底报价，须立即用 Amazon Revenue Calculator 复核'] };
    }
    return { feeUsd: null, sizeTier: 'ExtraLarge', source: 'Extra Large 需逐件报价', warnings: ['Extra Large（>70 lb）Amazon FBA 必须按件报价，无可用阶梯表'] };
}
function extractAmazonReviewEvidence(doc) {
    if (/captcha|robot check/i.test(doc.title) || doc.querySelector('form[action*="validateCaptcha"]'))
        return null;
    const clean = (value) => (value || '').replace(/\s+/g, ' ').trim();
    const asin = clean(doc.location.pathname.match(/product-reviews\/([A-Z0-9]{10})/i)?.[1]);
    if (!asin)
        return null;
    const snippets = Array.from(doc.querySelectorAll('[data-hook="review"]')).map(card => {
        const ratingText = clean(card.querySelector('[data-hook="review-star-rating"] .a-icon-alt, [data-hook="cmps-review-star-rating"] .a-icon-alt')?.textContent);
        const ratingMatch = ratingText.match(/([0-9]+(?:\.[0-9])?)/);
        return {
            rating: ratingMatch ? Number(ratingMatch[1]) : null,
            title: clean(card.querySelector('[data-hook="review-title"] span:not(.a-icon-alt), [data-hook="review-title"]')?.textContent),
            body: clean(card.querySelector('[data-hook="review-body"] span, [data-hook="review-body"]')?.textContent)
        };
    }).filter(item => item.title || item.body).slice(0, 3);
    if (!snippets.length)
        return null;
    return { asin: asin.toUpperCase(), url: doc.location.href, capturedAt: new Date().toISOString(), source: 'browser', snippets };
}
exports.AMAZON_REVIEW_EVIDENCE_SCRIPT = `(${extractAmazonReviewEvidence.toString()})(document)`;
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
const money = (value) => `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`;
function normalizedDirectPrices(intent, samples) {
    const targetUnit = intent.retailUnit;
    if (!targetUnit)
        return { prices: [], excluded: samples.filter(item => item.price != null && item.price > 0).length };
    const normalized = [];
    let excluded = 0;
    for (const item of samples) {
        if (item.price == null || item.price <= 0)
            continue;
        const sampleUnit = retailUnitFromText(item.title);
        if (!sampleUnit || sampleUnit.kind !== targetUnit.kind) {
            excluded += 1;
            continue;
        }
        normalized.push(item.price * targetUnit.quantity / sampleUnit.quantity);
    }
    return { prices: normalized, excluded };
}
function validQuickAmount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}
function validQuickRate(value) {
    return validQuickAmount(value) && value <= 100;
}
function quickProfitMissing(input) {
    return [
        !validQuickAmount(input.purchaseCostUsd) ? '采购价（USD）' : '',
        !validQuickRate(input.referralFeeRate) ? 'Amazon佣金率' : '',
        !validQuickAmount(input.fbaFulfillmentFeeUsd) ? 'FBA履约费（USD）' : '',
        !validQuickRate(input.returnLossRate) ? '退货损耗率' : '',
        !validQuickRate(input.advertisingRate) ? '广告费率' : '',
        !validQuickAmount(input.couponCostUsd) ? '优惠券成本（USD）' : ''
    ].filter(Boolean);
}
const DECISION_EVIDENCE_FIELDS = [
    ['purchaseCostUsd', '采购价（USD）'],
    ['referralFeeRate', 'Amazon佣金率'],
    ['fbaFulfillmentFeeUsd', 'FBA履约费（USD）'],
    ['returnLossRate', '退货损耗率'],
    ['advertisingRate', '广告费率'],
    ['couponCostUsd', '优惠券成本（USD）'],
    ['packagingQcUsd.low', '包装/质检（低）'], ['packagingQcUsd.base', '包装/质检（基准）'], ['packagingQcUsd.high', '包装/质检（高）'],
    ['domesticFreightUsd.low', '国内物流（低）'], ['domesticFreightUsd.base', '国内物流（基准）'], ['domesticFreightUsd.high', '国内物流（高）'],
    ['firstLegFreightUsd.low', '头程（低）'], ['firstLegFreightUsd.base', '头程（基准）'], ['firstLegFreightUsd.high', '头程（高）'],
    ['dutyUsd.low', '关税（低）'], ['dutyUsd.base', '关税（基准）'], ['dutyUsd.high', '关税（高）'],
    ['customsClearanceUsd.low', '清关（低）'], ['customsClearanceUsd.base', '清关（基准）'], ['customsClearanceUsd.high', '清关（高）'],
    ['inboundUsd.low', '入仓（低）'], ['inboundUsd.base', '入仓（基准）'], ['inboundUsd.high', '入仓（高）'],
    ['storageUsd.low', '仓储（低）'], ['storageUsd.base', '仓储（基准）'], ['storageUsd.high', '仓储（高）'],
    ['targetContributionMargin', '目标贡献利润率'], ['differentiationEvidence', '差异化核验依据'], ['complianceIpEvidence', '合规/IP核验依据']
];
/** 空元数据兼容阶段 1 前的历史手动录入；一旦有元数据，所有关键预设都须明确可决策。 */
function amazonProfitDecisionEvidenceIssues(evidence = {}) {
    if (!Object.keys(evidence).length)
        return [];
    return DECISION_EVIDENCE_FIELDS
        .filter(([key]) => evidence[key]?.decisionEligible !== true)
        .map(([key, label]) => `${label}${evidence[key]?.origin === '暂缺填零' ? '（暂缺填零）' : '（待核验）'}`);
}
/**
 * 快速市场利润率：用于以 DIRECT 标准化售价判断早期价格带可行性。
 * 不含国内物流、头程、关税、清关和入仓，不能替代后续全成本落地利润率。
 */
function buildAmazonQuickMarketProfitFactBlock(intent, samples, input = {}, evidence = {}) {
    const direct = samples.filter(item => item.comparisonClass === 'DIRECT');
    const priceSet = normalizedDirectPrices(intent, direct);
    const missing = quickProfitMissing(input);
    const evidenceIssues = amazonProfitDecisionEvidenceIssues(evidence).filter(issue => /采购价|佣金|FBA|退货|广告|优惠券/.test(issue));
    const lines = ['## 快速市场利润率（每件｜USD）'];
    lines.push('- 口径：标准化销售价－采购价－Amazon佣金－FBA履约费－退货损耗－广告费－优惠券；不含国内物流、头程、关税、清关、入仓、仓储及固定成本，不能视为全成本落地利润率。');
    if (!intent.retailUnit) {
        lines.push('- 快速市场利润率：待验证（缺少本品零售单位，无法取得标准化 DIRECT 销售价）。');
        return lines.join('\n');
    }
    if (!priceSet.prices.length) {
        lines.push(`- 快速市场利润率：待验证（缺少可按本品零售单位 ${intent.retailUnit.label} 标准化的 DIRECT 售价）。`);
        return lines.join('\n');
    }
    if (missing.length) {
        lines.push(`- 快速市场利润率：待验证（缺少 ${missing.join('、')}；不得按行业默认值或人民币采购价自动换算）。`);
        return lines.join('\n');
    }
    if (evidenceIssues.length) {
        lines.push(`- 快速市场利润率：待验证（${evidenceIssues.join('、')}尚未完成确认；暂缺填零或候选预设不得参与利润复算）。`);
        return lines.join('\n');
    }
    const prices = priceSet.prices;
    const scenarios = [
        ['P25', percentile(prices, 0.25)],
        ['中位价', median(prices)],
        ['P75', percentile(prices, 0.75)]
    ];
    const purchase = input.purchaseCostUsd;
    const referralRate = input.referralFeeRate;
    const fba = input.fbaFulfillmentFeeUsd;
    const returnRate = input.returnLossRate;
    const advertisingRate = input.advertisingRate;
    const coupon = input.couponCostUsd;
    lines.push(`- 参数与证据：采购价 ${money(purchase)}（事实｜用户录入）；Amazon佣金 ${referralRate}%、FBA履约费 ${money(fba)}、退货损耗 ${returnRate}%、广告 ${advertisingRate}%、优惠券 ${money(coupon)}（分析假设｜用户录入，需在全成本阶段以报价/官方计算器复核）。`);
    lines.push('| 售价情景 | 标准化销售价 | 采购价 | Amazon佣金 | FBA履约费 | 退货损耗 | 广告费 | 优惠券 | 快速市场利润 | 快速利润率 |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const [label, salePrice] of scenarios) {
        const referral = salePrice * referralRate / 100;
        const returns = salePrice * returnRate / 100;
        const advertising = salePrice * advertisingRate / 100;
        const profit = salePrice - purchase - referral - fba - returns - advertising - coupon;
        const margin = salePrice ? profit / salePrice * 100 : 0;
        lines.push(`| ${label}（${intent.retailUnit.label}） | ${money(salePrice)} | ${money(purchase)} | ${money(referral)} | ${money(fba)} | ${money(returns)} | ${money(advertising)} | ${money(coupon)} | ${money(profit)} | ${margin.toFixed(1)}% |`);
    }
    lines.push('- 结论限制：本表仅用于判断当前 DIRECT 价格带下的快速市场利润空间；全成本落地利润率、目标贡献利润门槛和最终“建议入场”必须在后续阶段另行验证。');
    return lines.join('\n');
}
const FULL_COST_FIELDS = [
    ['packagingQcUsd', '包装/质检'],
    ['domesticFreightUsd', '国内物流'],
    ['firstLegFreightUsd', '头程'],
    ['dutyUsd', '关税'],
    ['customsClearanceUsd', '清关'],
    ['inboundUsd', '入仓'],
    ['storageUsd', '仓储']
];
function fullCostMissing(input) {
    return FULL_COST_FIELDS.flatMap(([field, label]) => {
        const range = input[field];
        if (!validQuickAmount(range?.low) || !validQuickAmount(range?.base) || !validQuickAmount(range?.high))
            return [label];
        return range.low > range.base || range.base > range.high ? [`${label}（低/基准/高顺序）`] : [];
    });
}
/**
 * 全成本落地利润率：以低/基准/高的可追溯成本区间覆盖市场调研阶段难以直接取得的物流和清关费用。
 * 悲观情景使用 P25 售价与高成本，乐观情景使用 P75 售价与低成本。
 */
function buildAmazonFullCostProfitFactBlock(intent, samples, quick = {}, full = {}, evidence = {}) {
    const direct = samples.filter(item => item.comparisonClass === 'DIRECT');
    const priceSet = normalizedDirectPrices(intent, direct);
    const quickMissing = quickProfitMissing(quick);
    const fullMissing = fullCostMissing(full);
    const evidenceIssues = amazonProfitDecisionEvidenceIssues(evidence);
    const lines = ['## 全成本落地利润率（每件｜USD）'];
    lines.push('- 口径：标准化销售价－采购价－Amazon佣金－FBA履约费－退货损耗－广告费－优惠券－包装/质检－国内物流－头程－关税－清关－入仓－仓储。');
    if (!intent.retailUnit || !priceSet.prices.length) {
        lines.push('- 全成本落地利润率：待验证（缺少可标准化的 DIRECT 销售价或本品零售单位）。');
        return lines.join('\n');
    }
    if (quickMissing.length || fullMissing.length) {
        lines.push(`- 全成本落地利润率：待验证（缺少 ${[...quickMissing, ...fullMissing].join('、')}；物流、税费和清关不得以零成本代替）。`);
        return lines.join('\n');
    }
    if (evidenceIssues.length) {
        lines.push(`- 全成本落地利润率：待验证（${evidenceIssues.join('、')}尚未完成确认；暂缺填零、候选类目费率或自动提取线索不得当作真实经营成本/核验结论）。`);
        return lines.join('\n');
    }
    const scenarios = [
        ['悲观', percentile(priceSet.prices, 0.25), 'high'],
        ['基准', median(priceSet.prices), 'base'],
        ['乐观', percentile(priceSet.prices, 0.75), 'low']
    ];
    const purchase = quick.purchaseCostUsd;
    const referralRate = quick.referralFeeRate;
    const fba = quick.fbaFulfillmentFeeUsd;
    const returnRate = quick.returnLossRate;
    const advertisingRate = quick.advertisingRate;
    const coupon = quick.couponCostUsd;
    lines.push('- 区间证据：包装/物流/税费/清关/入仓/仓储均为分析假设｜用户录入；获得供应商、货代、报关行或 Amazon 报价后应改标为事实。');
    lines.push('| 情景 | 标准化销售价 | 快速成本 | 全成本附加项 | 全成本落地利润 | 全成本落地利润率 |');
    lines.push('|---|---:|---:|---:|---:|---:|');
    for (const [label, salePrice, rangeKey] of scenarios) {
        const referral = salePrice * referralRate / 100;
        const returns = salePrice * returnRate / 100;
        const advertising = salePrice * advertisingRate / 100;
        const quickCost = purchase + referral + fba + returns + advertising + coupon;
        const additional = FULL_COST_FIELDS.reduce((sum, [field]) => sum + full[field][rangeKey], 0);
        const profit = salePrice - quickCost - additional;
        const margin = salePrice ? profit / salePrice * 100 : 0;
        lines.push(`| ${label}（${rangeKey === 'high' ? '高成本' : rangeKey === 'base' ? '基准成本' : '低成本'}） | ${money(salePrice)} | ${money(quickCost)} | ${money(additional)} | ${money(profit)} | ${margin.toFixed(1)}% |`);
    }
    lines.push('- 成本区间明细（低/基准/高）：' + FULL_COST_FIELDS.map(([field, label]) => `${label} ${money(full[field].low)} / ${money(full[field].base)} / ${money(full[field].high)}`).join('；') + '。');
    lines.push('- 结论限制：本表已覆盖单位变动全成本，但最终“建议入场”仍需阶段 5 结合目标贡献利润门槛、合规/IP、差异化和购买信号判定。');
    return lines.join('\n');
}
function entryDecisionNumbers(intent, samples, quick, full, evidence) {
    const direct = samples.filter(item => item.comparisonClass === 'DIRECT');
    const priceSet = normalizedDirectPrices(intent, direct);
    if (!intent.retailUnit || !priceSet.prices.length || quickProfitMissing(quick).length || fullCostMissing(full).length || amazonProfitDecisionEvidenceIssues(evidence).length)
        return null;
    const calculate = (salePrice, rangeKey) => {
        const quickCost = quick.purchaseCostUsd + salePrice * quick.referralFeeRate / 100 + quick.fbaFulfillmentFeeUsd + salePrice * quick.returnLossRate / 100 + salePrice * quick.advertisingRate / 100 + quick.couponCostUsd;
        const additional = FULL_COST_FIELDS.reduce((sum, [field]) => sum + full[field][rangeKey], 0);
        const profit = salePrice - quickCost - additional;
        return { profit, margin: salePrice ? profit / salePrice * 100 : 0 };
    };
    return {
        downside: calculate(percentile(priceSet.prices, 0.25), 'high'),
        base: calculate(median(priceSet.prices), 'base')
    };
}
/**
 * “建议入场”是独立于样本数量的经营决策：必须同时通过全成本、购买信号、差异化和合规/IP门禁。
 * 未声明公司贡献利润目标时不替用户假设门槛，故不能输出正向结论。
 */
function evaluateAmazonEntryDecision(intent, samples, audit, quick = {}, full = {}, input = {}, evidence = {}) {
    const evidenceIssues = amazonProfitDecisionEvidenceIssues(evidence);
    const numbers = entryDecisionNumbers(intent, samples, quick, full, evidence);
    if (!numbers)
        return { decision: '❓ 数据不足，不能判定', reasons: evidenceIssues.length
                ? [`关键经营输入尚未核验：${evidenceIssues.join('、')}。暂缺填零、候选费率和自动提取线索均不得支持“建议入场”。`]
                : ['全成本利润尚不可复算：需具备标准化 DIRECT 售价，以及完整的快速成本和全成本区间。'] };
    if (!meetsAmazonResearchSampleBaseline(audit))
        return { decision: '❓ 数据不足，不能判定', reasons: ['研究样本基线未通过，不能据此判断市场竞争力。'], downsideProfit: numbers.downside.profit, baseMargin: numbers.base.margin };
    if (audit.coveragePercent < 80)
        return { decision: '❓ 数据不足，不能判定', reasons: ['证据覆盖率低于80%，不满足正式“建议入场”证据门槛。'], downsideProfit: numbers.downside.profit, baseMargin: numbers.base.margin };
    if (audit.salesSignalCount < 1)
        return { decision: '❓ 数据不足，不能判定', reasons: ['未取得 DIRECT 样本的可核验购买信号，无法证明正常动销基础。'], downsideProfit: numbers.downside.profit, baseMargin: numbers.base.margin };
    if (![10, 15, 20, 25].includes(input.targetContributionMargin || Number.NaN))
        return { decision: '❓ 数据不足，不能判定', reasons: ['尚未选择公司目标贡献利润率（10%/15%/20%/25%），系统不会自行假设门槛。'], downsideProfit: numbers.downside.profit, baseMargin: numbers.base.margin };
    if (numbers.downside.profit < 0)
        return { decision: '❌ 不建议入场', reasons: ['悲观情景全成本贡献利润为负，未满足下行现金流硬门禁。'], downsideProfit: numbers.downside.profit, baseMargin: numbers.base.margin };
    if (numbers.base.margin < input.targetContributionMargin)
        return { decision: '❌ 不建议入场', reasons: [`基准全成本贡献利润率 ${numbers.base.margin.toFixed(1)}% 低于公司目标 ${input.targetContributionMargin}%。`], downsideProfit: numbers.downside.profit, baseMargin: numbers.base.margin };
    const missing = [];
    if ((input.differentiationEvidence || '').trim().length < 8)
        missing.push('可核验差异化依据');
    if ((input.complianceIpEvidence || '').trim().length < 8)
        missing.push('合规/IP核验依据');
    if (missing.length)
        return { decision: '⚠️ 有条件谨慎入场', reasons: [`全成本与市场样本通过，但入库/下单前必须补齐：${missing.join('、')}。`], downsideProfit: numbers.downside.profit, baseMargin: numbers.base.margin };
    return { decision: '✅ 建议入场', reasons: ['研究样本、购买信号、全成本利润、差异化与合规/IP门禁均已通过。'], downsideProfit: numbers.downside.profit, baseMargin: numbers.base.margin };
}
function buildAmazonEntryDecisionFactBlock(intent, samples, audit, quick = {}, full = {}, input = {}, evidence = {}) {
    const result = evaluateAmazonEntryDecision(intent, samples, audit, quick, full, input, evidence);
    const lines = ['## 阶段5：Amazon 入场决策门禁'];
    lines.push(`- 系统入场结论：${result.decision}`);
    lines.push(`- 门禁依据：${result.reasons.join('；')}`);
    if (result.baseMargin != null && result.downsideProfit != null)
        lines.push(`- 已复算指标：基准全成本贡献利润率 ${result.baseMargin.toFixed(1)}%｜悲观全成本贡献利润 ${money(result.downsideProfit)}。`);
    lines.push('- 报告最终结论必须与系统入场结论完全一致；不得因样本数量、模型评分或销售话术自行上调结论。');
    return lines.join('\n');
}
/** 防止模型把系统门禁结论改写为更乐观的结论。 */
function validateAmazonEntryDecisionClaim(content, expected) {
    const decisions = ['✅ 建议入场', '⚠️ 有条件谨慎入场', '❌ 不建议入场', '❓ 数据不足，不能判定'];
    const found = decisions.filter(decision => content.includes(decision));
    if (!found.includes(expected) || found.some(decision => decision !== expected))
        return [`系统入场结论为“${expected}”，报告最终结论不得改写为其他等级`];
    return [];
}
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
    const apiCount = samples.filter(item => item.source === 'api').length;
    const browserCount = samples.filter(item => item.source === 'browser').length;
    const hybridCount = samples.filter(item => item.source === 'hybrid').length;
    const normalizedPriceSet = normalizedDirectPrices(intent, direct);
    const prices = normalizedPriceSet.prices;
    const ratings = direct.map(item => item.rating).filter((value) => value != null && value > 0);
    const reviews = direct.map(item => item.reviews).filter((value) => value != null);
    const lines = [
        `## 系统抓取 Amazon 美国站可比市场样本（抓取日期：${new Date().toLocaleDateString('en-CA')}）`,
        `- 本品身份：${intent.productName}｜形态：${intent.productForm}｜用途：${intent.useMethod}｜适用对象：${intent.targetObject}`,
        `- 检索词：${plan.keywords.join('；')}（${plan.source === 'model' ? '模型生成并经身份规则清洗' : '身份规则确定性生成'}）`,
        `- 样本审计：原始 ${audit.rawCount}｜自然位 ${audit.organicCount}｜赞助位排除 ${audit.sponsoredCount}｜ASIN去重 ${audit.uniqueCount}｜DIRECT直接竞品 ${audit.directCount}｜ADJACENT替代方案 ${audit.adjacentCount}｜NON_COMPARABLE排除 ${audit.excludedCount}`,
        `- 样本完整率：${audit.coveragePercent}%｜检索词成功 ${audit.keywordsSucceeded}/${audit.keywordsRequested}（${audit.keywordCoveragePercent}%）｜DIRECT核心字段覆盖 ${audit.fieldCoveragePercent}%｜结论置信度：${audit.confidence}`,
        `- 数据路径：OmkarCloud API 优先 ${apiCount}｜Amazon 页面补充 ${browserCount}｜双源同 ASIN 合并 ${hybridCount}；合并时 API 字段优先，页面仅补全 API 缺失字段。`,
        '- 证据等级：事实（OmkarCloud API 与 Amazon 美国站搜索页直接观察值）；样本统计仅代表上述检索词和抓取窗口，不等同完整市场。'
    ];
    const researchSampleReady = meetsAmazonResearchSampleBaseline(audit);
    if (!researchSampleReady)
        lines.push('- 研究样本基线未通过：必须同时满足3/3检索词成功、DIRECT不少于15个、DIRECT核心字段覆盖不少于50%、总完整率不少于50%；只能输出补数任务或“数据不足，不能判定”。');
    else
        lines.push('- 研究样本基线已通过：这只代表可评估市场竞争力，不自动等同于“建议入场”。');
    if (audit.confidence === '低')
        lines.push('- 样本限制：DIRECT 少于 15 个，只能作为方向性样本，不得写成 TOP50 或完整市场结论。');
    else if (audit.confidence === '中等')
        lines.push('- 样本限制：DIRECT 为 15–29 个，可作初步判断，但不足以代表完整 TOP50。');
    if (!intent.retailUnit) {
        lines.push('- DIRECT 价格基准：待验证（本品零售单位未从已提取规格中确认，原始标价不得用于 P25/中位/P75 定价结论）。');
    }
    else if (prices.length) {
        const sorted = [...prices].sort((a, b) => a - b);
        const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
        lines.push(`- DIRECT 标准化零售价（按本品零售单位 ${intent.retailUnit.label}）：P25 ${money(percentile(prices, 0.25))}｜中位价 ${money(median(prices))}｜P75 ${money(percentile(prices, 0.75))}｜区间 ${money(sorted[0])}–${money(sorted[sorted.length - 1])}｜均价 ${money(mean)}｜有效 ${prices.length}/${direct.length}${normalizedPriceSet.excluded ? `；${normalizedPriceSet.excluded} 个DIRECT因容量/套装信息缺失或单位不一致未纳入` : ''}`);
    }
    else {
        lines.push(`- DIRECT 价格基准：待验证（本品零售单位为 ${intent.retailUnit.label}，但没有可按同一单位标准化的 DIRECT 标价）。`);
    }
    if (ratings.length)
        lines.push(`- DIRECT 评分中位：${round1(median(ratings))}｜均值 ${round1(ratings.reduce((a, b) => a + b, 0) / ratings.length)}（${ratings.length} 个样本）`);
    if (reviews.length)
        lines.push(`- DIRECT 评论量：中位 ${Math.round(median(reviews)).toLocaleString('en-US')}｜P75 ${Math.round(percentile(reviews, 0.75)).toLocaleString('en-US')}｜均值 ${Math.round(reviews.reduce((a, b) => a + b, 0) / reviews.length).toLocaleString('en-US')}`);
    if (audit.salesSignalCount)
        lines.push(`- DIRECT 月购买信号：${audit.salesSignalCount}/${direct.length} 个样本在 Amazon 搜索页显示“过去一个月购买量”；可见下限合计 ${audit.salesSignalLowerBound.toLocaleString('en-US')}+。这是页面徽标下限，不是精确月销量，未显示徽标的样本不得按 0 计。`);
    const top = [...direct].sort((a, b) => (b.reviews || 0) - (a.reviews || 0)).slice(0, 8);
    if (top.length) {
        lines.push('- DIRECT 直接竞品（仅这些样本可进入核心价格与竞争统计）：');
        top.forEach((item, index) => lines.push(`  ${index + 1}. ${item.asin}｜原始标价 ${item.price != null ? money(item.price) : '价格缺失'}（不等同标准化售价）｜评分 ${item.rating ?? '-'}｜评论 ${item.reviews?.toLocaleString('en-US') ?? '-'}｜${item.title.slice(0, 80)}｜检索词 ${item.query || '-'}`));
    }
    if (adjacent.length) {
        lines.push('- ADJACENT 替代方案（只用于需求空白/替代方案观察，不得回填本品形态或 DIRECT 统计）：');
        adjacent.slice(0, 5).forEach((item, index) => lines.push(`  ${index + 1}. ${item.asin}｜${item.title.slice(0, 80)}｜${item.comparisonReason}`));
    }
    lines.push('- NON_COMPARABLE 与纯赞助位已从统计和竞品表中排除。若存在上述“月购买信号”，报告只能称为“Amazon 搜索页购买徽标下限”，不得改写为精确月销量；未抓取的销售额、BSR 和趋势证据等级为“待验证”，必须写“待验证”。');
    lines.push('- “✅ 建议入场”必须独立证明产品能正常动销且有竞争切入点：研究样本基线通过、至少一个DIRECT存在可核验购买信号、目标售价/评论门槛/竞争格局可承受、本品差异化可验证、FBA贡献利润可复算且合规/IP不存在未解决硬风险。样本数量达标本身不得输出“建议入场”。');
    return lines.join('\n');
}
const MARKET_OPERATIONAL_RULE = /(?:补货条件|停止投入|停止条件|继续条件|继续\/停止条件|止损|风险预警|立即复盘|复盘条件|测试目标|销量目标|目标值|门槛|阈值|假设|计划)/i;
function isMarketOperationalLine(line) {
    if (MARKET_OPERATIONAL_RULE.test(line))
        return true;
    return /^\|?\s*(?:短期|中期|长期)\s*[（(]/i.test(line);
}
/** 报告后置市场门禁：禁止把不足样本包装成 TOP50、精确销量或无条件 GO。 */
function validateAmazonMarketClaims(content, audit) {
    const issues = [];
    const lines = content.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const acceptableUnknown = /待验证|未知|数据不足|未达到|不足以|不能|不可|U\b/i;
    const numericPayload = (line) => line
        .replace(/TOP\s*50/ig, '')
        .replace(/近\s*6\s*月/ig, '')
        .replace(/\b20\d{2}[-/]\d{1,2}(?:[-/]\d{1,2})?\b/g, '');
    const isTableDivider = (line) => {
        if (!line.startsWith('|') || !line.endsWith('|'))
            return false;
        const cells = line.slice(1, -1).split('|').map(cell => cell.trim());
        return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
    };
    // 表头只描述字段名；例如“标准化价格（30ml）”不能被当作市场数据。
    const isTableHeader = (index) => lines[index].startsWith('|')
        && lines[index].endsWith('|')
        && isTableDivider(lines[index + 1] || '');
    const dataLines = lines.filter((line, index) => !isTableDivider(line) && !isTableHeader(index));
    const misleadingTop50 = dataLines.find(line => /TOP\s*50/i.test(line)
        && !/(?:非完整(?:类目)?|不是|并非|不等同|不足以代表|不得写成)\s*TOP\s*50/i.test(line)
        && /(?:均价|价格|售价|销量|销售额|市场规模|增长|趋势|中位|P25|P75|区间|总量|占比)/i.test(line)
        && /[$¥￥%\d]/.test(numericPayload(line))
        && !acceptableUnknown.test(line));
    if (misleadingTop50)
        issues.push(`当前系统抓取不是叶子类目完整 TOP50，但报告把 TOP50 写成已验证数值：${misleadingTop50.slice(0, 100)}`);
    const isVerifiedSalesSignal = (line) => audit.salesSignalCount > 0
        && /(?:购买徽标|购买信号|过去一个月购买量|bought in past month)/i.test(line)
        && /(?:下限|至少|\+)/.test(line)
        && !/精确月销量|完整市场销量/i.test(line);
    const tableMetricIssue = (() => {
        for (let index = 0; index < lines.length - 1; index += 1) {
            if (!isTableHeader(index))
                continue;
            const headers = lines[index].slice(1, -1).split('|').map(cell => cell.trim());
            const restrictedColumns = headers.flatMap((header, column) => /(?:月销量|月销售额|市场规模|增长趋势|近\s*6\s*月|BSR\/?类目排名)/i.test(header) ? [column] : []);
            for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
                const row = lines[rowIndex];
                if (!row.startsWith('|') || !row.endsWith('|') || isTableDivider(row))
                    break;
                const cells = row.slice(1, -1).split('|').map(cell => cell.trim());
                for (const column of restrictedColumns) {
                    const value = cells[column] || '';
                    const evidenceLine = `${headers[column]}：${value}`;
                    if (/[$¥￥%]|\d/.test(numericPayload(value)) && !acceptableUnknown.test(value) && !isMarketOperationalLine(evidenceLine) && !isVerifiedSalesSignal(evidenceLine)) {
                        return row;
                    }
                }
            }
        }
        return undefined;
    })();
    const unsupportedMarketMetric = tableMetricIssue || dataLines.find(line => /(?:月销量|月销售额|市场规模|增长趋势|近\s*6\s*月|BSR\/?类目排名)/i.test(line)
        && /[$¥￥%]|\d/.test(numericPayload(line))
        && !isMarketOperationalLine(line)
        && !isVerifiedSalesSignal(line));
    if (unsupportedMarketMetric)
        issues.push(`系统未抓取销量、销售额或趋势，但报告输出了无证据数值：${unsupportedMarketMetric.slice(0, 100)}`);
    if (!meetsAmazonResearchSampleBaseline(audit) && /✅\s*建议入场/.test(content)) {
        issues.push('研究样本基线未通过（需3/3检索词成功、DIRECT≥15、核心字段覆盖≥50%、完整率≥50%），不得输出“建议入场”');
    }
    if (/✅\s*建议入场/.test(content) && audit.salesSignalCount < 1) {
        issues.push('系统未获得任何DIRECT样本的可核验购买信号，不能证明产品具备正常动销基础，不得输出“建议入场”');
    }
    return issues;
}
/** 将系统未抓取的市场数值确定性降级为“待验证”，保留 ASIN、价格、评分与评论量等已抓取字段。 */
function sanitizeAmazonMarketClaims(content, audit) {
    const lines = content.split('\n');
    const unknown = /待验证|未知|数据不足|未抓取|U\b/i;
    const marketMetric = /(?:月销量|月销售额|市场规模|增长趋势|近\s*6\s*月|BSR\/?类目排名|上架时间|广告CPC)/i;
    let restrictedColumns = [];
    let inTable = false;
    const allowSalesSignal = Boolean(audit?.salesSignalCount);
    const salesSignalText = /(?:购买徽标|购买信号|过去一个月购买量|bought in past month)/i;
    const cellsOf = (line) => line.trim().slice(1, -1).split('|').map(cell => cell.trim());
    const rowOf = (cells) => `| ${cells.join(' | ')} |`;
    return lines.map(line => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) {
            inTable = false;
            restrictedColumns = [];
            const hasUnsupportedNumber = /[$¥￥%]|\d/.test(trimmed
                .replace(/TOP\s*50/ig, '')
                .replace(/近\s*6\s*月/ig, '')
                .replace(/\b20\d{2}[-/]\d{1,2}(?:[-/]\d{1,2})?\b/g, ''));
            if (!isMarketOperationalLine(trimmed) && hasUnsupportedNumber && marketMetric.test(trimmed)) {
                return '- 未抓取市场指标：月销量、销售额、BSR、上架时间及趋势均待验证。';
            }
            if (/TOP\s*50/i.test(trimmed) && !/(?:非完整(?:类目)?|不是|并非|不等同|不足以代表|不得写成)\s*TOP\s*50/i.test(trimmed) && hasUnsupportedNumber) {
                return '- 当前样本不是叶子类目完整 TOP50；仅可使用 DIRECT 搜索样本的价格、评分和评论量观察值。';
            }
            return line;
        }
        const cells = cellsOf(trimmed);
        if (/^:?-{3,}:?$/.test(cells[0] || ''))
            return line;
        if (!inTable) {
            inTable = true;
            restrictedColumns = cells.flatMap((cell, index) => marketMetric.test(cell) ? [index] : []);
            return line;
        }
        const next = [...cells];
        const salesSignalRow = allowSalesSignal && /(?:DIRECT样本月销量|月购买信号)/i.test(next[0] || '') && next.some(cell => salesSignalText.test(cell));
        if (salesSignalRow)
            return rowOf(next);
        restrictedColumns.forEach(index => {
            if (index < next.length && !unknown.test(next[index]))
                next[index] = '待验证';
        });
        const metricIndex = next.findIndex(cell => marketMetric.test(cell) || (/TOP\s*50/i.test(cell) && !/(?:非完整|不是|并非|不等同)/i.test(cell)));
        if (metricIndex >= 0 && !isMarketOperationalLine(trimmed)) {
            for (let index = metricIndex + 1; index < next.length; index += 1)
                next[index] = '待验证';
        }
        return rowOf(next);
    }).join('\n');
}
