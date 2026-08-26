"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generatedMarkdownPathFromReply = generatedMarkdownPathFromReply;
/**
 * 智能体偶发把完整报告写入临时 Markdown 文件后，只在回复中给出路径。
 * 此处只识别该明确交付语句，避免把普通聊天中的任意路径当作可读取文件。
 */
const GENERATED_MARKDOWN_REPLY = /(?:完整(?:重写)?后的?\s*Markdown\s*报告已输出至|Markdown\s*报告已输出至)\s*[`'\"]?((?:\/tmp\/)[^\s`'\"]+?\.md)\b/i;
function generatedMarkdownPathFromReply(content) {
    const match = String(content || '').match(GENERATED_MARKDOWN_REPLY);
    return match?.[1] || null;
}
