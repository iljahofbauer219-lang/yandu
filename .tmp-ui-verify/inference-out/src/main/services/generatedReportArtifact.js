"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.materializeGeneratedMarkdownReply = materializeGeneratedMarkdownReply;
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const reportArtifact_1 = require("../../shared/reportArtifact");
const TEMP_ROOT = node_path_1.default.resolve('/tmp');
const MAX_REPORT_BYTES = 512 * 1024;
const MIN_REPORT_CHARS = 200;
/**
 * 仅恢复智能体明确声明的 /tmp Markdown 报告。路径、文件类型、软链接及大小均受限，
 * 不能借由聊天内容读取任意本地文件。
 */
async function materializeGeneratedMarkdownReply(reply) {
    const original = String(reply || '');
    const declaredPath = (0, reportArtifact_1.generatedMarkdownPathFromReply)(original);
    if (!declaredPath)
        return { content: original, materialized: false };
    const filePath = node_path_1.default.resolve(declaredPath);
    if (!filePath.startsWith(`${TEMP_ROOT}${node_path_1.default.sep}`) || node_path_1.default.extname(filePath).toLowerCase() !== '.md') {
        return { content: original, materialized: false };
    }
    try {
        const stat = await node_fs_1.promises.lstat(filePath);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_REPORT_BYTES) {
            return { content: original, materialized: false };
        }
        const markdown = (await node_fs_1.promises.readFile(filePath, 'utf8')).trim();
        const looksLikeReport = markdown.length >= MIN_REPORT_CHARS && /(^#{1,6}\s+|\n\|[^\n]+\|)/m.test(markdown);
        return looksLikeReport
            ? { content: markdown, materialized: true }
            : { content: original, materialized: false };
    }
    catch {
        return { content: original, materialized: false };
    }
}
