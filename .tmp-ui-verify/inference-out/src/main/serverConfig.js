"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_SERVER_URL = void 0;
exports.readServerUrl = readServerUrl;
exports.writeServerUrl = writeServerUrl;
exports.isLocalServerUrl = isLocalServerUrl;
/**
 * 服务端地址配置（S2 客户端远程模式）。
 * - 配置持久化于 userData/server-config.json，主进程启动时据此决定是否拉起本地服务栈
 * - 渲染层在登录页保存服务器地址时经 IPC 同步到这里
 */
const electron_1 = require("electron");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
exports.DEFAULT_SERVER_URL = 'https://114.55.149.192';
const CONFIG_FILE = 'server-config.json';
function configFile() {
    return node_path_1.default.join(electron_1.app.getPath('userData'), CONFIG_FILE);
}
function normalize(url) {
    return url.trim().replace(/\/+$/, '');
}
/** 读取已持久化的服务器地址；未配置时返回默认中央服务器 */
function readServerUrl() {
    try {
        const raw = node_fs_1.default.readFileSync(configFile(), 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.serverUrl === 'string' && parsed.serverUrl.trim())
            return normalize(parsed.serverUrl);
    }
    catch { /* 未配置或损坏：走默认 */ }
    return exports.DEFAULT_SERVER_URL;
}
function writeServerUrl(url) {
    try {
        node_fs_1.default.writeFileSync(configFile(), JSON.stringify({ serverUrl: normalize(url) }, null, 2), 'utf8');
    }
    catch (error) {
        console.error('[server-config] 持久化失败：', error);
    }
}
/** 是否指向本机（决定要不要拉起本地服务栈） */
function isLocalServerUrl(url) {
    try {
        const hostname = new URL(url).hostname;
        return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
    }
    catch {
        return false;
    }
}
