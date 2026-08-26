"use strict";
/**
 * Listing精造师共享契约：平台×站点×语言矩阵 + 术语库。
 * 渲染端（Listing 工作台）与主进程（翻译引擎术语注入）共用同一份数据，
 * 与知识库文档《Listing精造师-平台规则库》《Listing精造师-术语库》保持一致。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LISTING_MATERIAL_TERMS = exports.LISTING_SITES = exports.LISTING_LANGUAGES = void 0;
exports.baseLanguageCode = baseLanguageCode;
exports.findListingLanguage = findListingLanguage;
exports.buildListingGlossaryDirective = buildListingGlossaryDirective;
exports.buildListingQuery = buildListingQuery;
exports.LISTING_LANGUAGES = [
    { code: 'en-US', label: '英语·美国', mtName: 'English' },
    { code: 'en-GB', label: '英语·英国', mtName: 'English' },
    { code: 'de', label: '德语', mtName: 'German' },
    { code: 'fr', label: '法语', mtName: 'French' },
    { code: 'es', label: '西班牙语', mtName: 'Spanish' },
    { code: 'it', label: '意大利语', mtName: 'Italian' },
    { code: 'ja', label: '日语', mtName: 'Japanese' },
    { code: 'th', label: '泰语', mtName: 'Thai' },
    { code: 'vi', label: '越南语', mtName: 'Vietnamese' },
    { code: 'ms', label: '马来语', mtName: 'Malay' },
    { code: 'id', label: '印尼语', mtName: 'Indonesian' }
];
exports.LISTING_SITES = [
    { id: 'amazon-us', platform: 'Amazon', site: '美国站', defaultLanguages: ['en-US'] },
    { id: 'amazon-uk', platform: 'Amazon', site: '英国站', defaultLanguages: ['en-GB'] },
    { id: 'amazon-de', platform: 'Amazon', site: '德国站', defaultLanguages: ['de'] },
    { id: 'amazon-jp', platform: 'Amazon', site: '日本站', defaultLanguages: ['ja'] },
    { id: 'ebay-us', platform: 'eBay', site: '美国站', defaultLanguages: ['en-US'] },
    { id: 'ebay-de', platform: 'eBay', site: '德国站', defaultLanguages: ['de'] },
    { id: 'shopee-my', platform: 'Shopee', site: '马来西亚站', defaultLanguages: ['ms'] },
    { id: 'shopee-th', platform: 'Shopee', site: '泰国站', defaultLanguages: ['th'] },
    { id: 'tiktok-us', platform: 'TikTok Shop', site: '美国站', defaultLanguages: ['en-US'] },
    { id: 'temu-us', platform: 'Temu', site: '美国站', defaultLanguages: ['en-US'] },
    { id: 'aliexpress-en', platform: 'AliExpress', site: '全球站', defaultLanguages: ['en-US'] }
];
/** 材质/规格术语多语映射（术语库摘录，翻译硬门禁）；键为基础语言代码 */
exports.LISTING_MATERIAL_TERMS = [
    { zh: '不锈钢', map: { en: 'stainless steel', de: 'Edelstahl', fr: 'acier inoxydable', es: 'acero inoxidable', it: 'acciaio inossidabile', ja: 'ステンレス鋼' } },
    { zh: '铝合金', map: { en: 'aluminum alloy', de: 'Aluminiumlegierung', fr: "alliage d'aluminium", es: 'aleación de aluminio', it: 'lega di alluminio', ja: 'アルミ合金' } },
    { zh: '食品级硅胶', map: { en: 'food-grade silicone', de: 'lebensmittelechter Silikon', fr: 'silicone de qualité alimentaire', es: 'silicona de grado alimentario', it: 'silicone per uso alimentare', ja: '食品級シリコーン' } },
    { zh: '记忆棉', map: { en: 'memory foam', de: 'Memory-Schaum', fr: 'mousse à mémoire de forme', es: 'espuma viscoelástica', it: 'memory foam', ja: '低反発ウレタン' } },
    { zh: '竹纤维', map: { en: 'bamboo fiber', de: 'Bambusfaser', fr: 'fibre de bambou', es: 'fibra de bambú', it: 'fibra di bambù', ja: '竹繊維' } },
    { zh: 'ABS', map: { en: 'ABS plastic', de: 'ABS-Kunststoff', fr: 'plastique ABS', es: 'plástico ABS', it: 'plastica ABS', ja: 'ABS樹脂' } },
    { zh: '碳钢', map: { en: 'carbon steel', de: 'Kohlenstoffstahl', fr: 'acier au carbone', es: 'acero al carbono', it: 'acciaio al carbonio', ja: '炭素鋼' } }
];
function baseLanguageCode(code) {
    return code.split('-')[0];
}
function findListingLanguage(code) {
    return exports.LISTING_LANGUAGES.find(item => item.code === code);
}
/** 翻译引擎术语注入指令：命中素材中出现的术语时，强制按术语表翻译 */
function buildListingGlossaryDirective(languageCode) {
    const base = baseLanguageCode(languageCode);
    const pairs = exports.LISTING_MATERIAL_TERMS
        .filter(term => term.map[base])
        .map(term => `${term.zh}→${term.map[base]}`);
    if (!pairs.length)
        return '';
    return `术语强制命中（素材出现以下中文词时按映射翻译，不得意译）：${pairs.join('；')}。`;
}
/** 工作台生成查询词（与验收脚本口径一致） */
function buildListingQuery(platform, site, languageCode, material) {
    return `以下是中文商品素材，请生成 ${platform} ${site}（${languageCode}）Listing 包：\n${material}`;
}
