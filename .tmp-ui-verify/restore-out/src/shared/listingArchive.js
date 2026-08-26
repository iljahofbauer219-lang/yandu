"use strict";
/**
 * Listing 工作台归档契约：批次/任务记录、localStorage 归档纯逻辑、Listing 字段解析与 CSV 工具。
 * 纯函数不依赖 DOM，便于主进程导出与回归脚本复用。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LISTING_ARCHIVE_MAX = exports.LISTING_ARCHIVE_KEY = void 0;
exports.upsertBatch = upsertBatch;
exports.normalizeBatchForRestore = normalizeBatchForRestore;
exports.summarizeBatch = summarizeBatch;
exports.parseListingFields = parseListingFields;
exports.escapeCsvCell = escapeCsvCell;
exports.buildListingCsv = buildListingCsv;
exports.LISTING_ARCHIVE_KEY = 'yd.listingWorkbench.archive';
exports.LISTING_ARCHIVE_MAX = 20;
/** 归档写入：同批次按 id 覆盖置顶，超出上限裁掉最旧 */
function upsertBatch(archive, batch) {
    return [batch, ...archive.filter(item => item.id !== batch.id)].slice(0, exports.LISTING_ARCHIVE_MAX);
}
/** 恢复载入：未完成的在途状态一律转「已中断」，可单包重试 */
function normalizeBatchForRestore(batch) {
    return {
        ...batch,
        tasks: batch.tasks.map(task => task.status === 'pending' || task.status === 'running'
            ? { ...task, status: 'interrupted' }
            : task)
    };
}
function summarizeBatch(batch) {
    return {
        total: batch.tasks.length,
        done: batch.tasks.filter(task => task.status === 'done').length,
        failed: batch.tasks.filter(task => task.status === 'failed').length,
        interrupted: batch.tasks.filter(task => task.status === 'interrupted').length
    };
}
// ─── 行式段落抽取：智能体输出存在版式漂移（**粗体头** / ### 标题头、内容同行/换行、编号/emoji 要点），逐候选兜底 ───
function extractSection(lines, headerRe, stopRe) {
    for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(headerRe);
        if (!match)
            continue;
        // 头部本身可能占整行（### 标题），剥掉头部后同行剩余即为内容起始；纯括号注释（如（5条））不算内容
        let sameLine = lines[i].slice(match[0].length).replace(/^\s*[：:]?\s*/, '').trimEnd();
        if (/^[（(][^）)]*[）)]$/.test(sameLine))
            sameLine = '';
        const collected = sameLine ? [sameLine] : [];
        for (let j = i + 1; j < lines.length; j++) {
            if (stopRe.test(lines[j]))
                break;
            collected.push(lines[j]);
        }
        const text = collected.join('\n').trim();
        if (text)
            return text;
    }
    return '';
}
const TITLE_HEADERS = [
    /^\s*\*\*最终采用标题.*/,
    /^\s*(?:✅\s*)?\*\*A版（推荐）\*\*/,
    /^\s*\*\*标题 ?[AＡ] ?版\*\*/,
    /^\s*\*\*标题 ?[AＡ]\*\*/,
    /^\s*\*\*A版标题.*/,
    /^\s*\*\*A版\*\*/,
    /^\s*\*\*(?:Title|Titel)\b.*\*\*/,
    /^\s*\*\*标题\*\*/
];
// 排除「✅ **推荐 A版**：理由」「**推荐标题**：✅ **A版**」这类元说明行与 B 版；
// 「A版（推荐）」是实际标题头部，不在此列
const TITLE_SKIP = /[BＢ]版|推荐 ?[AＡ]版|推荐标题/;
const BULLET_HEADERS = [
    /^\s*\*\*Bullet Points?.*/,
    /^\s*\*\*要点.*/,
    /^\s*###?\s*Bullet Points?.*/
];
const DESCRIPTION_HEADERS = [
    /^\s*\*\*Product Description.*/,
    /^\s*\*\*描述.*/,
    /^\s*\*\*Beschreibung.*/,
    /^\s*###?\s*Produktbeschreibung/,
    /^\s*###?\s*(?:Product )?Description/
];
const SEARCH_TERM_HEADERS = [
    /^\s*\*\*后台搜索词.*/,
    /^\s*\*\*Backend Search Terms?.*/,
    /^\s*\*\*搜索词.*/,
    /^\s*###?\s*Backend-Suchbegriffe/,
    /^\s*\*\*Suchbegriffe.*/
];
// 段落终止：下一个粗体/标题头、分隔线、引用注释或中文大节
const SECTION_STOP = /^\s*(?:\*\*|###?\s|[一二三四五六]、|---|>\s|→)/;
// 标题为单行文案：空行即止
const TITLE_STOP = /^\s*(?:\*\*|###?\s|[一二三四五六]、|---|>\s|→)|^\s*$/;
function parseListingFields(content) {
    const lines = content.split('\n');
    let title = '';
    TITLE_HEADERS.forEach((header, headerIndex) => {
        for (let i = 0; i < lines.length && !title; i++) {
            const match = lines[i].match(header);
            if (!match)
                continue;
            // 首选候选即「A版（推荐）」头部本身，不能 skip；其余候选排除「✅ **推荐 A版**：理由」等元说明行与 B 版
            if (headerIndex > 0 && TITLE_SKIP.test(lines[i]))
                continue;
            let sameLine = lines[i].slice(match[0].length).replace(/^\s*[：:]?\s*/, '').trimEnd();
            if (/^[（(][^）)]*[）)]$/.test(sameLine))
                sameLine = '';
            const collected = sameLine ? [sameLine] : [];
            for (let j = i + 1; j < lines.length; j++) {
                if (TITLE_STOP.test(lines[j]))
                    break;
                collected.push(lines[j]);
            }
            const text = collected.join('\n').trim();
            // 「**最终采用标题**」同行内容可能带「（76字符）」尾巴，取正文部分
            const cleaned = text.split('\n')[0].replace(/\s*[（(]\d+字符[）)]\s*$/, '').trim();
            if (cleaned && (headerIndex === 1 || !TITLE_SKIP.test(cleaned)))
                title = cleaned;
        }
    });
    const bulletsBlock = (() => {
        for (const header of BULLET_HEADERS) {
            const block = extractSection(lines, header, SECTION_STOP);
            if (block)
                return block;
        }
        return '';
    })();
    const numbered = bulletsBlock
        .split('\n')
        .filter(line => /^\s*\d+[.、)]/.test(line))
        .map(line => line.replace(/^\s*\d+[.、)]\s*/, '').trim());
    // 编号缺失时（如 Shopee emoji 要点）退化为非空正文行
    const bulletsItems = numbered.length
        ? numbered
        : bulletsBlock.split('\n').map(line => line.trim()).filter(line => line && !/^\s*>/.test(line));
    const bullets = bulletsItems.join(' | ');
    const description = (() => {
        for (const header of DESCRIPTION_HEADERS) {
            const block = extractSection(lines, header, SECTION_STOP);
            if (block)
                return block;
        }
        return '';
    })();
    const searchTerms = (() => {
        for (const header of SEARCH_TERM_HEADERS) {
            const block = extractSection(lines, header, SECTION_STOP);
            if (block)
                return block;
        }
        return '';
    })();
    return { title: title.trim(), bullets, description: description.trim(), searchTerms: searchTerms.trim() };
}
/** CSV 单元格转义（RFC 4180） */
function escapeCsvCell(value) {
    if (/[",\n\r]/.test(value))
        return `"${value.replace(/"/g, '""')}"`;
    return value;
}
/** 生成 CSV 文本（带 UTF-8 BOM 头由调用方写入时附加） */
function buildListingCsv(rows) {
    const header = ['平台站点', '语言', '发布结论', '标题', '要点', '描述', '后台搜索词', '全文'];
    const lines = [header.map(escapeCsvCell).join(',')];
    for (const row of rows) {
        const fields = parseListingFields(row.content);
        lines.push([row.siteLabel, row.languageCode, row.conclusion, fields.title, fields.bullets, fields.description, fields.searchTerms, row.content].map(escapeCsvCell).join(','));
    }
    return lines.join('\r\n');
}
