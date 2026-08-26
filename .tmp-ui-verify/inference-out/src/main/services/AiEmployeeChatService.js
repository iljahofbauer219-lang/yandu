"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiEmployeeChatService = void 0;
/**
 * AI员工对话服务：附件上传（图片/文档）+ 大模型选择路由。
 * - ragflow-agent：沿用原 main.ts 的 RAGFlow 智能体链路（fetch 逻辑逐字保留）
 * - 直连模型（百炼 / DeepSeek）：OpenAI 兼容 chat/completions，失败或缺 key 时回退 ragflow
 * - 不支持视觉的目标模型：图片先经百炼视觉模型转成中文描述再并入文本
 */
const electron_1 = require("electron");
const iconv_lite_1 = __importDefault(require("iconv-lite"));
const node_fs_1 = require("node:fs");
const node_path_1 = __importDefault(require("node:path"));
const serverConfig_1 = require("../serverConfig");
const generatedReportArtifact_1 = require("./generatedReportArtifact");
const RAGFLOW_AGENT_DEFAULT_ID = '8563cdb690e611f1b36bf39ef484774d';
const RAGFLOW_LISTING_AGENT_ID = 'a80d0348932d11f1b36bf39ef484774d';
const MAXKB_AMAZON_SKILLS_APPLICATION_ID = '01a005f0-a471-7403-9d78-8702d5765816';
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const DOC_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md']);
const IMAGE_MAX_COUNT = 4;
const IMAGE_MAX_BYTES = 7 * 1024 * 1024;
const DOC_MAX_COUNT = 3;
const DOC_MAX_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_EDGE = 1280;
const DOC_CHAR_LIMIT = 12000;
const TOTAL_TEXT_BUDGET = 30000;
const CHAT_TIMEOUT_MS = 240000;
// Listing 包为六段长文（多语版本），生成耗时显著高于选品报告
const LISTING_TIMEOUT_MS = 360000;
const VISION_TIMEOUT_MS = 60000;
const MIME_BY_EXTENSION = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
function ragflowAgentBaseUrl() {
    try {
        const base = new URL((0, serverConfig_1.readServerUrl)());
        base.port = '8090';
        base.pathname = '/';
        return base.toString().replace(/\/+$/, '');
    }
    catch {
        return null;
    }
}
function maxkbBaseUrl() {
    const base = new URL((0, serverConfig_1.readServerUrl)());
    base.port = '8080';
    base.pathname = '/';
    return base.toString().replace(/\/+$/, '');
}
function bailianBaseUrl() {
    return (process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, '');
}
function deepseekBaseUrl() {
    return (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, '');
}
// ─── Amazon 差异化/合规证据提炼：阶段 4 接入，只拼 prompt + 调模型，状态由调用方写回 extracted。 ───
const INFERENCE_TIMEOUT_MS = 25000;
const INFERENCE_RESULT_MAX_CHARS = 800;
const INFERENCE_BULLET_LIMIT = 5;
const INFERENCE_BULLET_CHARS = 200;
const INFERENCE_REVIEW_LIMIT = 3;
const INFERENCE_REVIEW_BODY_CHARS = 300;
function trimChars(value, max) {
    if (value.length <= max)
        return value;
    return `${value.slice(0, Math.max(0, max - 1))}…`;
}
function buildInferencePayload(input) {
    const bullets = input.listingEvidence
        .flatMap(item => item.bulletPoints || [])
        .slice(0, INFERENCE_BULLET_LIMIT)
        .map(line => trimChars(line.replace(/\s+/g, ' ').trim(), INFERENCE_BULLET_CHARS))
        .filter(Boolean);
    const reviewSnippets = input.reviewEvidence
        .flatMap(item => (item.snippets || []).map(snippet => ({ rating: snippet.rating, body: trimChars((snippet.body || '').replace(/\s+/g, ' ').trim(), INFERENCE_REVIEW_BODY_CHARS) })))
        .filter(item => item.body)
        .slice(0, INFERENCE_REVIEW_LIMIT);
    return [
        '你是一名严谨的 Amazon 美国站品类顾问，需要从已抓取证据提炼两项中文结论，每项 1-3 句话，不超过 200 字。',
        '严禁：',
        '- 编造未在证据中出现的品牌、ASIN、检测机构、监管证书、专利号。',
        '- 输出"建议入场/不建议入场"或任何利润率/费用数字（这些字段由其他阶段负责）。',
        '- 使用 Markdown 围栏、分点符号、引号、换行以外的特殊格式。',
        '允许：',
        '- 引用证据中的产品形态、成分、买家反馈关键词。',
        '- 指出明确的合规风险（液体/喷雾/电池/食品接触/儿童使用）以及需要人工核验的项。',
        '',
        '## 本品身份',
        `- 名称：${input.intent.productName}`,
        `- 形态：${input.intent.productForm}`,
        `- 使用方式：${input.intent.useMethod}`,
        `- 适用对象：${input.intent.targetObject}`,
        '',
        '## 1688 页面证据',
        `- 标题：${input.sourceText.title}`,
        `- 形态（人工确认）：${input.sourceText.productForm}`,
        `- 使用方式：${input.sourceText.useMethod}`,
        `- 适用对象：${input.sourceText.targetObject}`,
        `- 属性（前 8 条）：${input.sourceText.attributes.slice(0, 8).join('；') || '无'}`,
        `- 详情文字：${trimChars(input.sourceText.detailText, 600)}`,
        '',
        '## Amazon 详情页 bullet points',
        bullets.length ? bullets.map((line, idx) => `${idx + 1}. ${line}`).join('\n') : '（未抓到 bullet points）',
        '',
        '## Amazon 详情页标题样本',
        input.listingEvidence.slice(0, 3).map(item => trimChars(item.title || '', 120)).filter(Boolean).join('\n') || '（未抓到详情页）',
        '',
        '## Amazon 评论页样本',
        reviewSnippets.length
            ? reviewSnippets.map((snippet, idx) => `${idx + 1}. ${snippet.rating ? `[${snippet.rating}★] ` : ''}${snippet.body}`).join('\n')
            : '（未抓到评论样本）',
        '',
        '## 输出格式（严格 JSON，无 Markdown 围栏）',
        '{"differentiation":"<差异化结论，中文>","compliance":"<合规/IP 核验结论，中文>"}'
    ].join('\n');
}
function parseInferenceJson(raw) {
    const cleaned = String(raw || '').replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    if (!cleaned)
        return null;
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match)
        return null;
    try {
        const parsed = JSON.parse(match[0]);
        const differentiation = String(parsed?.differentiation || '').trim();
        const compliance = String(parsed?.compliance || '').trim();
        if (!differentiation || !compliance)
            return null;
        if (differentiation.length < 8 || compliance.length < 8)
            return null;
        return { differentiation, compliance };
    }
    catch {
        return null;
    }
}
class AiEmployeeChatService {
    // ─── 模型目录（v1 静态注册表） ─────────────────────────────────────────────
    listModels() {
        const hasBailian = Boolean(process.env.BAILIAN_API_KEY);
        const hasDeepseek = Boolean(process.env.DEEPSEEK_API_KEY);
        return [
            { id: 'amazon-skills-agent', name: '选品分析师（Amazon-Skills）', hint: '默认智能体 · Amazon 运营 Skills', provider: 'ragflow', supportsVision: false, available: Boolean(process.env.MAXKB_AMAZON_SKILLS_TOKEN) },
            { id: 'ragflow-agent', name: '选品分析师（RAGFlow·含知识库）', hint: '备用智能体 · 含知识库检索', provider: 'ragflow', supportsVision: false, available: true },
            { id: 'listing-agent', name: 'Listing精造师（RAGFlow·含知识库）', hint: '多平台 Listing 文案 · 母语级多语翻译', provider: 'ragflow', supportsVision: false, available: true },
            { id: 'qwen3.6-flash', name: '通义千问 3.6 Flash', hint: '直连 · 支持图片理解', provider: 'bailian', supportsVision: true, available: hasBailian },
            { id: 'qwen-plus', name: '通义千问 Plus', hint: '直连 · 长文本', provider: 'bailian', supportsVision: false, available: hasBailian },
            { id: 'deepseek-chat', name: 'DeepSeek Chat', hint: '直连 · 推理强', provider: 'deepseek', supportsVision: false, available: hasDeepseek }
        ];
    }
    // ─── 附件选择与预处理 ─────────────────────────────────────────────────────
    async pickAttachments() {
        const result = await electron_1.dialog.showOpenDialog({
            properties: ['openFile', 'multiSelections'],
            filters: [
                { name: '产品图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] },
                { name: '文档', extensions: ['pdf', 'docx', 'txt', 'md'] }
            ]
        });
        if (result.canceled || !result.filePaths.length)
            return { ok: false, attachments: [] };
        const attachments = [];
        let imageCount = 0;
        let docCount = 0;
        let limitSkipped = 0;
        let readFailed = 0;
        const stamp = Date.now();
        let seq = 0;
        for (const filePath of result.filePaths) {
            const extension = node_path_1.default.extname(filePath).toLowerCase();
            const name = node_path_1.default.basename(filePath);
            const id = `att-${stamp}-${++seq}`;
            try {
                if (IMAGE_EXTENSIONS.has(extension)) {
                    if (imageCount >= IMAGE_MAX_COUNT) {
                        limitSkipped += 1;
                        continue;
                    }
                    const stats = await node_fs_1.promises.stat(filePath);
                    if (stats.size > IMAGE_MAX_BYTES) {
                        limitSkipped += 1;
                        continue;
                    }
                    const buffer = await node_fs_1.promises.readFile(filePath);
                    const image = electron_1.nativeImage.createFromBuffer(buffer);
                    if (image.isEmpty()) {
                        readFailed += 1;
                        continue;
                    }
                    imageCount += 1;
                    const { width, height } = image.getSize();
                    const longEdge = Math.max(width, height);
                    if (longEdge > IMAGE_MAX_EDGE) {
                        const scale = IMAGE_MAX_EDGE / longEdge;
                        const resized = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) });
                        const encoded = this.encodeJpegWhiteBackground(resized);
                        attachments.push({ id, name, kind: 'image', mimeType: 'image/jpeg', size: encoded.length, dataUrl: `data:image/jpeg;base64,${encoded.toString('base64')}` });
                    }
                    else {
                        const mimeType = MIME_BY_EXTENSION[extension] || 'image/jpeg';
                        attachments.push({ id, name, kind: 'image', mimeType, size: buffer.length, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` });
                    }
                }
                else if (DOC_EXTENSIONS.has(extension)) {
                    if (docCount >= DOC_MAX_COUNT) {
                        limitSkipped += 1;
                        continue;
                    }
                    const stats = await node_fs_1.promises.stat(filePath);
                    if (stats.size > DOC_MAX_BYTES) {
                        limitSkipped += 1;
                        continue;
                    }
                    docCount += 1;
                    const buffer = await node_fs_1.promises.readFile(filePath);
                    let text = '';
                    if (extension === '.txt' || extension === '.md') {
                        const utf8 = buffer.toString('utf8');
                        text = utf8.includes('\uFFFD') ? iconv_lite_1.default.decode(buffer, 'gbk') : utf8;
                    }
                    else if (extension === '.pdf') {
                        // 扫描版 PDF 提取为空 → text 留空字符串，不报错
                        try {
                            const mod = await Promise.resolve().then(() => __importStar(require('pdf-parse')));
                            const pdfParse = mod.default || mod;
                            const parsed = await pdfParse(buffer);
                            text = parsed.text;
                        }
                        catch {
                            text = '';
                        }
                    }
                    else if (extension === '.docx') {
                        try {
                            const mammoth = await Promise.resolve().then(() => __importStar(require('mammoth')));
                            const r = await mammoth.extractRawText({ buffer });
                            text = r.value;
                        }
                        catch {
                            text = '';
                        }
                    }
                    text = String(text || '').trim();
                    let truncated = false;
                    if (text.length > DOC_CHAR_LIMIT) {
                        text = text.slice(0, DOC_CHAR_LIMIT);
                        truncated = true;
                    }
                    attachments.push({ id, name, kind: 'doc', mimeType: extension === '.pdf' ? 'application/pdf' : extension === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/plain', size: stats.size, text, truncated });
                }
                else {
                    readFailed += 1;
                }
            }
            catch {
                readFailed += 1;
            }
        }
        // 附件文本总量预算：超出部分继续截断
        let budget = TOTAL_TEXT_BUDGET;
        for (const attachment of attachments) {
            if (attachment.kind !== 'doc')
                continue;
            const current = attachment.text || '';
            if (current.length > budget) {
                attachment.text = current.slice(0, budget);
                attachment.truncated = true;
            }
            budget = Math.max(0, budget - (attachment.text || '').length);
        }
        const skipReasons = [];
        if (limitSkipped > 0)
            skipReasons.push(`${limitSkipped} 个文件超出大小/数量限制`);
        if (readFailed > 0)
            skipReasons.push(`${readFailed} 个文件读取失败或格式不支持`);
        return {
            ok: true,
            attachments,
            message: skipReasons.length ? `已跳过 ${limitSkipped + readFailed} 个文件：${skipReasons.join('；')}` : undefined
        };
    }
    // 编码 JPEG；带透明通道的先逐像素合成白底（反预乘→白底合成→alpha=255），避免黑底
    encodeJpegWhiteBackground(image) {
        const bitmap = image.toBitmap();
        let hasAlpha = false;
        for (let i = 3; i < bitmap.length; i += 4) {
            if (bitmap[i] < 255) {
                hasAlpha = true;
                break;
            }
        }
        if (!hasAlpha)
            return image.toJPEG(80);
        const flat = Buffer.from(bitmap);
        for (let i = 0; i < flat.length; i += 4) {
            const alpha = flat[i + 3];
            if (alpha >= 255)
                continue;
            const a = alpha / 255;
            for (const offset of [0, 1, 2]) {
                const unpremul = alpha > 0 ? Math.min(255, Math.round((flat[i + offset] * 255) / alpha)) : 0;
                flat[i + offset] = Math.round(unpremul * a + 255 * (1 - a));
            }
            flat[i + 3] = 255;
        }
        const { width, height } = image.getSize();
        return electron_1.nativeImage.createFromBitmap(flat, { width, height }).toJPEG(80);
    }
    // ─── 对话路由 ──────────────────────────────────────────────────────────────
    async chat(request) {
        const attachments = request.attachments || [];
        const docs = attachments.filter(item => item.kind === 'doc');
        const images = attachments.filter(item => item.kind === 'image' && item.dataUrl);
        const docBlocks = docs.map(item => item.text
            ? `【附件《${item.name}》内容${item.truncated ? '（已截断）' : ''}】\n${item.text}`
            : `【附件《${item.name}》未提取到文本】`);
        const modelId = (request.modelId || '').trim();
        // 默认（空 / ragflow-agent）路径
        if (!modelId || modelId === 'amazon-skills-agent') {
            const descriptionBlocks = await this.describeImages(images);
            const content = [request.query, ...docBlocks, ...descriptionBlocks].join('\n\n');
            try {
                return await this.maxkbChat(request, content);
            }
            catch (error) {
                const fallback = await this.ragflowChat(request, content);
                return { ok: true, content: `⚠️ Amazon-Skills 暂不可用，已切换 RAGFlow 备用分析通道。\n\n${fallback.content}` };
            }
        }
        if (modelId === 'ragflow-agent') {
            const descriptionBlocks = await this.describeImages(images);
            const content = [request.query, ...docBlocks, ...descriptionBlocks].join('\n\n');
            return this.ragflowChat(request, content);
        }
        // Listing精造师：固定路由到 Listing 智能体，长文生成放宽超时
        if (modelId === 'listing-agent') {
            const descriptionBlocks = await this.describeImages(images);
            const content = [request.query, ...docBlocks, ...descriptionBlocks].join('\n\n');
            return this.ragflowChat({ ...request, agentId: RAGFLOW_LISTING_AGENT_ID }, content, LISTING_TIMEOUT_MS);
        }
        const profile = this.listModels().find(item => item.id === modelId);
        const fallback = async () => {
            const descriptionBlocks = await this.describeImages(images);
            const content = [request.query, ...docBlocks, ...descriptionBlocks].join('\n\n');
            const result = await this.ragflowChat(request, content);
            return { ok: true, content: `⚠️ 所选模型不可用，已切换默认模型。\n\n${result.content}` };
        };
        // 未知 modelId 或所选模型不可用 → 视同 available=false，走回退路径（不抛错、不尝试直连）
        if (!profile || profile.provider === 'ragflow' || !profile.available)
            return fallback();
        try {
            // 非视觉模型 + 图片：先经视觉模型转描述并入文本，避免图片被静默丢弃
            const descriptionBlocks = (!profile.supportsVision && images.length) ? await this.describeImages(images) : [];
            return await this.directChat(profile, request, docBlocks, images, descriptionBlocks);
        }
        catch (directError) {
            try {
                return await fallback();
            }
            catch {
                throw directError instanceof Error ? directError : new Error('分析请求失败');
            }
        }
    }
    async maxkbChat(request, content) {
        const accessToken = String(process.env.MAXKB_AMAZON_SKILLS_TOKEN || '').trim();
        if (!accessToken)
            throw new Error('Amazon-Skills 访问令牌未配置');
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
        try {
            const auth = await fetch(`${maxkbBaseUrl()}/chat/api/auth/anonymous`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ access_token: accessToken }), signal: controller.signal });
            const authBody = await auth.json().catch(() => ({}));
            const token = authBody?.data?.token || authBody?.data;
            if (!auth.ok || typeof token !== 'string')
                throw new Error(authBody?.message || 'Amazon-Skills 身份认证失败');
            const messages = [...(request.history || []).slice(-10), { role: 'user', content }];
            const response = await fetch(`${maxkbBaseUrl()}/chat/api/${MAXKB_AMAZON_SKILLS_APPLICATION_ID}/chat/completions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ messages, stream: false }), signal: controller.signal
            });
            const body = await response.json().catch(() => ({}));
            const reply = body?.choices?.[0]?.message?.content;
            if (!response.ok || !reply)
                throw new Error(body?.message || 'Amazon-Skills 未返回内容');
            return { ok: true, content: (await (0, generatedReportArtifact_1.materializeGeneratedMarkdownReply)(reply)).content };
        }
        finally {
            clearTimeout(timer);
        }
    }
    // ─── RAGFlow 智能体（fetch 逻辑与原 main.ts 逐字一致） ─────────────────────
    async ragflowChat(request, content, timeoutMs = CHAT_TIMEOUT_MS) {
        // RAGFlow API Key 外置到 .env.local（RAGFLOW_API_KEY）：不能在模块顶层读 process.env（import 早于 loadLocalEnvironment），只能在此方法内懒读取
        const base = ragflowAgentBaseUrl();
        if (!base)
            throw new Error('服务器地址无效，请检查配置');
        const apiKey = String(process.env.RAGFLOW_API_KEY || '').trim();
        if (!apiKey)
            throw new Error('未配置 RAGFLOW_API_KEY：请在「大模型API Key」页设置');
        const agentId = request.agentId || RAGFLOW_AGENT_DEFAULT_ID;
        const messages = [
            ...(request.history || []).filter(item => item.role === 'user' || item.role === 'assistant').slice(-10).map(item => ({ role: item.role, content: item.content })),
            { role: 'user', content }
        ];
        const controller = new AbortController();
        // 六部分选品报告包含多张竞品与利润表，完整生成可超过 120 秒。
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(`${base}/api/v1/agents/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({ agent_id: agentId, messages, 'openai-compatible': true, stream: false }),
                signal: controller.signal
            });
            const body = await response.json().catch(() => ({ message: '响应解析失败' }));
            if (!response.ok)
                throw new Error(body?.message || `分析请求失败（${response.status}）`);
            const reply = body?.choices?.[0]?.message?.content;
            if (!reply)
                throw new Error('智能体未返回内容');
            return { ok: true, content: (await (0, generatedReportArtifact_1.materializeGeneratedMarkdownReply)(reply)).content };
        }
        catch (error) {
            if (error instanceof Error && error.name === 'AbortError')
                throw new Error(`分析超时（${Math.round(timeoutMs / 1000)}秒），请稍后重试`);
            throw error instanceof Error ? error : new Error('分析请求失败');
        }
        finally {
            clearTimeout(timer);
        }
    }
    // ─── 直连模型（百炼 / DeepSeek，OpenAI 兼容 chat/completions） ─────────────
    async directChat(profile, request, docBlocks, images, descriptionBlocks) {
        let apiKey = '';
        let endpoint = '';
        if (profile.provider === 'bailian') {
            apiKey = process.env.BAILIAN_API_KEY || '';
            endpoint = `${bailianBaseUrl()}/chat/completions`;
        }
        else {
            apiKey = process.env.DEEPSEEK_API_KEY || '';
            endpoint = `${deepseekBaseUrl()}/chat/completions`;
        }
        if (!apiKey)
            throw new Error(`${profile.name} 未配置 API Key`);
        const text = [request.query, ...docBlocks, ...descriptionBlocks].join('\n\n');
        let content = text;
        if (profile.supportsVision && images.length) {
            content = [
                { type: 'text', text },
                ...images.map(item => ({ type: 'image_url', image_url: { url: item.dataUrl } }))
            ];
        }
        const messages = [
            ...(request.history || []).filter(item => item.role === 'user' || item.role === 'assistant').slice(-10).map(item => ({ role: item.role, content: item.content })),
            { role: 'user', content }
        ];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({ model: profile.id, messages }),
                signal: controller.signal
            });
            const body = await response.json().catch(() => ({ message: '响应解析失败' }));
            if (!response.ok)
                throw new Error(body?.error?.message || body?.message || `分析请求失败（${response.status}）`);
            const reply = body?.choices?.[0]?.message?.content;
            const replyText = typeof reply === 'string'
                ? reply
                : Array.isArray(reply)
                    ? reply.map((part) => (typeof part?.text === 'string' ? part.text : '')).join('\n')
                    : '';
            if (!replyText)
                throw new Error('模型未返回内容');
            return { ok: true, content: (await (0, generatedReportArtifact_1.materializeGeneratedMarkdownReply)(replyText)).content };
        }
        catch (error) {
            if (error instanceof Error && error.name === 'AbortError')
                throw new Error('分析超时（240秒），请稍后重试');
            throw error instanceof Error ? error : new Error('分析请求失败');
        }
        finally {
            clearTimeout(timer);
        }
    }
    // ─── 图片转描述（目标模型不支持视觉时） ────────────────────────────────────
    async describeImages(images) {
        if (!images.length)
            return [];
        const apiKey = process.env.BAILIAN_API_KEY || '';
        const model = process.env.BAILIAN_VISION_MODEL || 'qwen3.6-flash';
        const blocks = [];
        for (const item of images) {
            if (!apiKey || !item.dataUrl) {
                blocks.push(`【图片附件《${item.name}》描述失败】`);
                continue;
            }
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
            try {
                const response = await fetch(`${bailianBaseUrl()}/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify({
                        model,
                        messages: [{
                                role: 'user',
                                content: [
                                    { type: 'text', text: '请用中文简要描述这张产品图：外观、颜色、材质、形态、可见卖点' },
                                    { type: 'image_url', image_url: { url: item.dataUrl } }
                                ]
                            }]
                    }),
                    signal: controller.signal
                });
                const body = await response.json().catch(() => ({}));
                if (!response.ok)
                    throw new Error(body?.message || `HTTP ${response.status}`);
                const description = body?.choices?.[0]?.message?.content;
                if (!description)
                    throw new Error('视觉模型未返回描述');
                blocks.push(`【图片附件《${item.name}》描述】\n${description}`);
            }
            catch {
                blocks.push(`【图片附件《${item.name}》描述失败】`);
            }
            finally {
                clearTimeout(timer);
            }
        }
        return blocks;
    }
    // ─── Amazon 检索词推导：只读取已锁定的本品身份，输出三组买家意图词；调用方仍会执行禁用词清洗和确定性回退。 ───
    async deriveAmazonKeywords(intent) {
        const productName = String(intent?.productName || '').replace(/\s+/g, ' ').trim();
        if (!productName || !intent?.productForm)
            return [];
        const models = this.listModels();
        const profile = models.find(item => item.id === 'qwen3.6-flash' && item.available)
            || models.find(item => (item.provider === 'bailian' || item.provider === 'deepseek') && item.available);
        if (!profile)
            return [];
        const apiKey = profile.provider === 'bailian' ? process.env.BAILIAN_API_KEY || '' : process.env.DEEPSEEK_API_KEY || '';
        const endpoint = profile.provider === 'bailian' ? `${bailianBaseUrl()}/chat/completions` : `${deepseekBaseUrl()}/chat/completions`;
        if (!apiKey)
            return [];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                body: JSON.stringify({
                    model: profile.id,
                    messages: [{ role: 'user', content: [
                                '根据已确认的本品身份，生成 3 个 Amazon 美国站买家检索词。',
                                '每行一个英文检索词，每个 2-7 个单词；使用通用品类词，不含品牌、标点、营销词或解释。',
                                `产品名称：${productName}`,
                                `产品形态：${intent.productForm}`,
                                `使用方式：${intent.useMethod}`,
                                `适用对象：${intent.targetObject}`,
                                `禁止出现：${intent.excludedTerms.join('、') || '无'}`
                            ].join('\n') }]
                }),
                signal: controller.signal
            });
            const body = await response.json().catch(() => ({}));
            return String(body?.choices?.[0]?.message?.content || '')
                .split(/\n+/)
                .map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').replace(/["'`*#.,!。！]/g, ' ').replace(/\s+/g, ' ').trim())
                .filter((line) => Boolean(line) && !/[\u4e00-\u9fff]/.test(line))
                .slice(0, 6);
        }
        catch {
            return [];
        }
        finally {
            clearTimeout(timer);
        }
    }
    // ─── Amazon 差异化/合规证据提炼：deepseek-chat 优先、qwen3.6-flash 回退。失败/超时/JSON 坏值 → 返回 null，调用方保留 1688 原措辞。 ───
    async inferDifferentiationAndCompliance(input) {
        if (!input?.intent?.productName)
            return null;
        const models = this.listModels();
        // 优先 deepseek（推理强、输出干净），无 key 时回退 qwen3.6-flash（视觉兼描述）
        const profiles = [
            models.find(item => item.id === 'deepseek-chat' && item.available),
            models.find(item => item.id === 'qwen3.6-flash' && item.available)
        ].filter((item) => Boolean(item));
        if (!profiles.length)
            return null;
        const payload = buildInferencePayload(input);
        for (const profile of profiles) {
            const apiKey = profile.provider === 'bailian' ? process.env.BAILIAN_API_KEY || '' : process.env.DEEPSEEK_API_KEY || '';
            if (!apiKey)
                continue;
            const endpoint = profile.provider === 'bailian' ? `${bailianBaseUrl()}/chat/completions` : `${deepseekBaseUrl()}/chat/completions`;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), INFERENCE_TIMEOUT_MS);
            try {
                const response = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
                    body: JSON.stringify({
                        model: profile.id,
                        temperature: 0.2,
                        max_tokens: 600,
                        messages: [{ role: 'user', content: payload }]
                    }),
                    signal: controller.signal
                });
                if (!response.ok)
                    continue;
                const body = await response.json().catch(() => ({}));
                const raw = String(body?.choices?.[0]?.message?.content || '');
                const parsed = parseInferenceJson(raw);
                if (!parsed)
                    continue;
                return {
                    differentiation: trimChars(parsed.differentiation, INFERENCE_RESULT_MAX_CHARS),
                    compliance: trimChars(parsed.compliance, INFERENCE_RESULT_MAX_CHARS),
                    model: profile.id,
                    provider: profile.provider
                };
            }
            catch {
                // 超时/网络错误/JSON 坏值 → 继续尝试下一个 profile
                continue;
            }
            finally {
                clearTimeout(timer);
            }
        }
        return null;
    }
}
exports.AiEmployeeChatService = AiEmployeeChatService;
