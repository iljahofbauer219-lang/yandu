import { app, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AppServerClient,
  type AppServerNotification,
  type AppServerRequest
} from "./AppServerClient";
import {
  HarnessGatewayClient
} from "./HarnessGatewayClient";
import type {
  AdvisorConnectionStatus,
  AdvisorConnectionMode,
  AdvisorRemoteSession
} from "../../shared/advisor";
import type { LinduoChatSseEvent } from "../../shared/contracts";
import { getLinduoChatModelsFromServer, streamLinduoChat } from "./linduoServerClient";
import {
  analyzeSession,
  cloneAttachmentSession,
  extractDocumentText,
  isImagePath,
  listAttachments,
  readAttachmentPreview,
  removeAttachment,
  removeAttachmentSession,
  saveIncomingDocuments,
  saveIncomingImages,
  type AttachmentRecord,
  type IncomingDocument,
  type IncomingImage
} from "./AttachmentService";
import { ensureProxyRunning, stopManagedProxy } from "./ProxyManager";
import { describeAttachments } from "./MultimodalVision";
import {
  appendStoredEvent,
  beginStoredTurn,
  createStoredBranch,
  createStoredTask,
  deleteStoredTask,
  exportStoredTask,
  finishStoredTask,
  listStoredTasks,
  readStoredTask,
  recoverInterruptedTasks,
  renameStoredTask,
  selectStoredBranch,
  setStoredThreadId,
  clearStoredThreadId,
  updateStoredTaskStatus,
  updateStoredUsage,
  type StoredTask
} from "./SessionStore";
import {
  classifyCommand,
  findOutsideWorkspacePaths,
  isApprovedOutsideRead,
  isDestructiveFileDiff,
  isPathWithin
} from "./ApprovalPolicy";
import {
  buildLocalMemoryContext,
  getPersonalizationState,
  personalizationInstructions,
  readPersonalizationSettings,
  resetPersonalizationMemory,
  savePersonalizationSettings,
  type PersonalizationSettings
} from "./PersonalizationStore";

type ModelId = string;

type PermissionMode = "ask" | "agent" | "fullAccess";

/**
 * 模型档位表。
 * - `effort`: 该模型推荐的推理深度,不能硬编码为单一值
 *   (例如 chat-latest 只支持 medium,硬编码 high 会随每次 turn 报
 *   "Unsupported value: 'high' is not supported with the 'chat-latest' model.")。
 * - `providerId`: Codex app-server 的 model_provider,thread 创建后不可在
 *   turn 级别覆盖。如果 UI 切到不同 provider 的模型,必须 thread/fork
 *   重新绑 provider。
 */
type ModelProfile = {
  id: ModelId;
  name: string;
  providerId: string;
  supportsTools: boolean;
  supportsVision: boolean;
  effort: "low" | "medium" | "high" | "max";
};

type ChatRequest = {
  requestId: string;
  conversationId?: string;
  model: ModelId;
  permissionMode: PermissionMode;
  message: string;
  workspacePath: string;
  edit?: {
    sourceBranchId: string;
    replacesRequestId: string;
    beforeTurnId: string;
  };
};

type Activity = {
  kind:
    | "plan"
    | "command"
    | "file"
    | "vision"
    | "status"
    | "warning"
    | "error";
  title: string;
  detail?: string;
  state?: string;
};

type TaskStatus =
  | "running"
  | "waitingApproval"
  | "completed"
  | "failed"
  | "stopped";

type ChatEvent =
  | { requestId: string; type: "delta"; text: string }
  | { requestId: string; type: "turnStarted"; turnId: string }
  | {
      requestId: string;
      type: "taskStatus";
      status: TaskStatus;
      label: string;
      detail?: string;
      pendingApprovalCount: number;
    }
  | { requestId: string; type: "activity"; activity: Activity }
  | {
      requestId: string;
      type: "approval";
      approval: {
        id: string;
        requestId: string;
        kind: "command" | "file";
        title: string;
        detail?: string;
        diff?: string;
        cwd?: string;
        reason?: string;
        allowRemember?: boolean;
      };
    }
  | {
      requestId: string;
      type: "approvalResolved";
      approvalId: string;
      decision: ApprovalDecision;
    }
  | { requestId: string; type: "done" | "stopped" }
  | { requestId: string; type: "error"; message: string }
  /**
   * 原 thread 上下文已丢失（Codex app-server 找不到 rollout），业务层已自动回退到
   * thread/start。reason 包含原始错误信息，供调试。UI 收到后展示一次性提示。
   */
  | { requestId: string; type: "threadReset"; reason: string }
  // M1 Linduo 聊天模型：走 server HTTP/SSE，不进 Codex app-server
  | { requestId: string; type: "linduo_delta"; text: string }
  | {
      requestId: string;
      type: "linduo_done";
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    }
  | { requestId: string; type: "linduo_error"; message: string };

type ApprovalDecision = "accept" | "decline" | "acceptForSession";

type RunContext = {
  requestId: string;
  taskId: string;
  workspacePath: string;
  permissionMode: PermissionMode;
  sender: Electron.WebContents;
  threadId: string;
  branchId: string;
  turnId: string | null;
  stopped: boolean;
  proposedDiffs: Map<string, string>;
  approvedOutsideReadRoots: Set<string>;
  warnedOutsidePaths: Set<string>;
};

type PendingApproval = {
  rpcId?: number | string;
  approvalId: string;
  context: RunContext;
  kind: "command" | "file";
  allowRemember: boolean;
  outsideReadRoots: string[];
  resolvePreflight?: (approved: boolean) => void;
};

// 静态 Codex 档位表（不可变）。M1 Linduo 模型由 reloadLinduoChatModels 动态合并到 modelProfiles。
// - `effort`: 该模型推荐的推理深度,不能硬编码为单一值
//   (例如 chat-latest 只支持 medium,硬编码 high 会随每次 turn 报
//   "Unsupported value: 'high' is not supported with the 'chat-latest' model.")。
// - `providerId`: Codex app-server 的 model_provider,thread 创建后不可在
//   turn 级别覆盖。如果 UI 切到不同 provider 的模型,必须 thread/fork
//   重新绑 provider。
const STATIC_CODEX_PROFILES: ModelProfile[] = [
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", providerId: "deepseek_proxy", supportsTools: true, supportsVision: false, effort: "high" },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", providerId: "deepseek_proxy", supportsTools: true, supportsVision: false, effort: "high" },
  { id: "chat-latest", name: "OpenAI ChatGPT Latest", providerId: "openai_api", supportsTools: true, supportsVision: true, effort: "medium" }
];
let modelProfiles: ModelProfile[] = [...STATIC_CODEX_PROFILES];
let allowedModels: Map<string, ModelProfile> = new Map(
  modelProfiles.map((model) => [model.id, model])
);
const LINDUO_MODEL_PREFIX = "linduo:";
const LINDUO_PROVIDER_ID = "linduo_proxy";
const allowedPermissionModes = new Set<PermissionMode>([
  "ask",
  "agent",
  "fullAccess"
]);
const appServer = new AppServerClient();
const activeRequests = new Map<string, RunContext>();
const contextsByThread = new Map<string, RunContext>();
const pendingApprovals = new Map<string, PendingApproval>();
/** Linduo 流式 turn 的 AbortController，按 requestId 索引。advisor:chat:stop 会触发对应 abort。 */
const linduoAbortControllers = new Map<string, AbortController>();

/**
 * harness 网关客户端：当前阶段仅作为在线参谋执行器健康探针。
 * Codex 业务流仍走 AppServerClient (stdio RPC)。
 * - 连接成功：mode = 'harness'，供 UI 顶栏 chip 展示
 * - 未配置 JWT：mode = 'signed-out'，属用户态而非故障，不展示错误横幅
 * - 连接失败/断开：mode = 'unavailable'，UI 可选择禁用 composer
 * - 未尝试：mode = 'unknown'
 *
 * 通过 .env 注入：APP_SERVER_BASE_URL / HARNESS_GATEWAY_BASE_URL
 * 实际未来如需把业务流迁到 worker HTTP 容器，可扩展为可切换的 transport。
 */
const harnessClient = new HarnessGatewayClient({
  appServerBaseUrl: process.env.APP_SERVER_BASE_URL ?? "http://127.0.0.1:8787",
  gatewayBaseUrl: process.env.HARNESS_GATEWAY_BASE_URL ?? "http://127.0.0.1:8788",
  getAccessToken: async () => {
    const accessToken = process.env.YANDU_USER_JWT ?? "";
    if (!accessToken) throw new Error("ADVISOR_UNAUTHORIZED: 当前未登录");
    return accessToken;
  }
});

/**
 * 当前是否已为受限隔离执行器配置访问令牌。
 * - true  : YANDU_USER_JWT 已设置，可尝试连接 harness
 * - false : 未设置 JWT,连接必然以 ADVISOR_UNAUTHORIZED 失败;
 *           上层应返回 signed-out 状态(用户态),而不是 unavailable(故障态)
 */
function isHarnessSignedIn(): boolean {
  return Boolean(process.env.YANDU_USER_JWT);
}

let harnessLastSession: AdvisorRemoteSession | null = null;
const harnessListeners = new Set<(state: AdvisorConnectionStatus) => void>();

/**
 * 把当前状态推送给所有 UI 订阅者，同时确保 lastSession 与 mode 字段一致。
 * - 'harness'         : harness 通话已建立，业务流可选用 worker (本阶段仅探针)
 * - 'app-server'      : Codex app-server 直连模式 (stdio RPC)
 * - 'signed-out'      : 未配置 YANDU_USER_JWT,受限隔离执行器未启用(用户态,非故障)
 * - 'unavailable'     : harness 网关探测失败(故障态)
 * - 'unknown'         : 启动后尚未探测
 */
function buildHarnessState(overrides: Partial<AdvisorConnectionStatus> = {}): AdvisorConnectionStatus {
  const hasSession = Boolean(harnessLastSession);
  const signedIn = isHarnessSignedIn();
  const base: AdvisorConnectionStatus = {
    connected: hasSession,
    mode: hasSession
      ? "harness"
      : signedIn
        ? "unavailable"
        : "signed-out",
    label: hasSession
      ? "受限隔离执行器已就绪"
      : signedIn
        ? "受限隔离执行器不可用"
        : "受限隔离执行器未启用",
    detail: hasSession
      ? harnessLastSession!.message
      : signedIn
        ? "Codex app-server · 本机模型代理"
        : "未配置 YANDU_USER_JWT · 业务流使用本地 Codex app-server"
  };
  return { ...base, ...overrides };
}

function emitHarnessState(state: AdvisorConnectionStatus) {
  for (const listener of harnessListeners) {
    try { listener(state) } catch { /* 监听器异常不向上传播 */ }
  }
}


function emitChatEvent(sender: Electron.WebContents, payload: ChatEvent) {
  if (!sender.isDestroyed()) sender.send("advisor:chat:event", payload);
  const context = activeRequests.get(payload.requestId);
  const taskId = context?.taskId ?? payload.requestId;
  void appendStoredEvent(taskId, payload.type, {
    ...payload,
    branchId: context?.branchId ?? "main"
  }).catch(() => undefined);
}

function emitActivity(context: RunContext, activity: Activity) {
  emitChatEvent(context.sender, {
    requestId: context.requestId,
    type: "activity",
    activity
  });
}

function emitTaskStatus(
  context: RunContext,
  status: TaskStatus,
  detail?: string
) {
  const pendingApprovalCount = countPendingApprovals(context);
  const labels: Record<TaskStatus, string> = {
    running: "正在处理",
    waitingApproval: "等待你的批准",
    completed: "任务已完成",
    failed: "任务失败",
    stopped: "任务已停止"
  };
  emitChatEvent(context.sender, {
    requestId: context.requestId,
    type: "taskStatus",
    status,
    label: labels[status],
    detail,
    pendingApprovalCount
  });
  void updateStoredTaskStatus(
    context.taskId,
    status,
    pendingApprovalCount
  );
}

function countPendingApprovals(context: RunContext) {
  let count = 0;
  for (const pending of pendingApprovals.values()) {
    if (pending.context === context) count += 1;
  }
  return count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finishContext(context: RunContext) {
  cancelPendingApprovals(context);
  activeRequests.delete(context.requestId);
  contextsByThread.delete(context.threadId);
}

function cancelPendingApprovals(context: RunContext) {
  for (const [approvalId, pending] of pendingApprovals) {
    if (pending.context !== context) continue;
    if (pending.rpcId !== undefined) {
      appServer.respond(pending.rpcId, { decision: "cancel" });
    } else {
      pending.resolvePreflight?.(false);
    }
    pendingApprovals.delete(approvalId);
  }
}

function handleNotification({ method, params }: AppServerNotification) {
  const threadId = typeof params.threadId === "string" ? params.threadId : null;
  if (!threadId) return;
  const context = contextsByThread.get(threadId);
  if (!context) return;
  if (typeof params.turnId === "string") context.turnId = params.turnId;
  if (params.usage !== undefined || params.tokenUsage !== undefined) {
    void updateStoredUsage(
      context.taskId,
      params.usage ?? params.tokenUsage
    );
  }

  if (method === "turn/started" && isRecord(params.turn)) {
    context.turnId = typeof params.turn.id === "string" ? params.turn.id : null;
    if (context.turnId) {
      emitChatEvent(context.sender, {
        requestId: context.requestId,
        type: "turnStarted",
        turnId: context.turnId
      });
    }
    emitActivity(context, {
      kind: "status",
      title: "Codex 回合已开始",
      detail: context.turnId ?? undefined,
      state: "running"
    });
    return;
  }

  if (method === "item/agentMessage/delta" && typeof params.delta === "string") {
    emitChatEvent(context.sender, {
      requestId: context.requestId,
      type: "delta",
      text: params.delta
    });
    return;
  }

  if (method === "turn/plan/updated" && Array.isArray(params.plan)) {
    const plan = params.plan
      .filter(isRecord)
      .map((step) => {
        const label =
          typeof step.step === "string"
            ? step.step
            : typeof step.description === "string"
              ? step.description
              : JSON.stringify(step);
        const prefix =
          step.status === "completed" ? "✓" : step.status === "in_progress" ? "→" : "·";
        return `${prefix} ${label}`;
      })
      .join("\n");
    emitActivity(context, { kind: "plan", title: "执行计划", detail: plan });
    return;
  }

  if (method === "item/commandExecution/outputDelta" && typeof params.delta === "string") {
    emitActivity(context, {
      kind: "command",
      title: "终端输出",
      detail: params.delta,
      state: "running"
    });
    return;
  }

  if (method === "item/fileChange/patchUpdated" && Array.isArray(params.changes)) {
    const itemId = typeof params.itemId === "string" ? params.itemId : "";
    const diff = formatChanges(params.changes);
    if (itemId) context.proposedDiffs.set(itemId, diff);
    emitActivity(context, {
      kind: "file",
      title: "文件变更",
      detail: diff,
      state: "running"
    });
    return;
  }

  if (method === "turn/diff/updated" && typeof params.diff === "string") {
    emitActivity(context, {
      kind: "file",
      title: "Git 差异",
      detail: params.diff,
      state: "updated"
    });
    return;
  }

  if (method === "item/started" || method === "item/completed") {
    if (!isRecord(params.item)) return;
    const item = params.item;
    const itemType = typeof item.type === "string" ? item.type : "";
    const completed = method === "item/completed";
    if (itemType === "commandExecution") {
      const command = typeof item.command === "string" ? item.command : "命令";
      const output = typeof item.aggregatedOutput === "string" ? item.aggregatedOutput : "";
      const exitCode = typeof item.exitCode === "number" ? `退出码 ${item.exitCode}` : "";
      const failed =
        completed && typeof item.exitCode === "number" && item.exitCode !== 0;
      emitActivity(context, {
        kind: failed ? "warning" : "command",
        title: failed ? "一个执行步骤失败，正在调整方案" : command,
        detail: completed ? [output, exitCode].filter(Boolean).join("\n") : undefined,
        state:
          typeof item.status === "string"
            ? item.status
            : completed
              ? "completed"
              : "running"
      });
    } else if (itemType === "fileChange") {
      const itemId = typeof item.id === "string" ? item.id : "";
      const diff = Array.isArray(item.changes) ? formatChanges(item.changes) : "";
      if (itemId && diff) context.proposedDiffs.set(itemId, diff);
      emitActivity(context, {
        kind: "file",
        title: "修改文件",
        detail: diff,
        state:
          typeof item.status === "string"
            ? item.status
            : completed
              ? "completed"
              : "running"
      });
    } else if (itemType === "plan" && typeof item.text === "string") {
      emitActivity(context, { kind: "plan", title: "计划", detail: item.text });
    }
    return;
  }

  if (method === "turn/completed" && isRecord(params.turn)) {
    cancelPendingApprovals(context);
    const status = typeof params.turn.status === "string" ? params.turn.status : "failed";
    const error = isRecord(params.turn.error)
      ? String(params.turn.error.message ?? JSON.stringify(params.turn.error))
      : "";
    if (status === "completed") {
      emitTaskStatus(context, "completed");
      emitChatEvent(context.sender, { requestId: context.requestId, type: "done" });
      void finishStoredTask(context.taskId, "completed", {
        usage: params.turn.usage
      });
    } else if (status === "interrupted" || context.stopped) {
      emitTaskStatus(context, "stopped");
      emitChatEvent(context.sender, { requestId: context.requestId, type: "stopped" });
      void finishStoredTask(context.taskId, "stopped", {
        usage: params.turn.usage
      });
      void cleanupContextProcesses(context);
    } else {
      emitTaskStatus(
        context,
        "failed",
        error || `Codex 回合失败：${status}`
      );
      emitChatEvent(context.sender, {
        requestId: context.requestId,
        type: "error",
        message: error || `Codex 回合失败：${status}`
      });
      void finishStoredTask(context.taskId, "failed", {
        failureReason: error || `Codex 回合失败：${status}`,
        usage: params.turn.usage
      });
    }
    finishContext(context);
  }
}

function formatChanges(changes: unknown[]) {
  return changes
    .filter(isRecord)
    .map((change) => {
      const filePath = typeof change.path === "string" ? change.path : "未知文件";
      const diff = typeof change.diff === "string" ? change.diff : "";
      return `${filePath}\n${diff}`;
    })
    .join("\n");
}

function handleServerRequest(request: AppServerRequest) {
  const threadId =
    typeof request.params.threadId === "string" ? request.params.threadId : null;
  const context = threadId ? contextsByThread.get(threadId) : undefined;
  if (context && typeof request.params.turnId === "string") {
    context.turnId = request.params.turnId;
  }

  if (request.method === "item/commandExecution/requestApproval") {
    const cwd = typeof request.params.cwd === "string" ? request.params.cwd : "";
    if (!context || !cwd) {
      appServer.respond(request.id, { decision: "decline" });
      return;
    }
    const command =
      typeof request.params.command === "string" ? request.params.command : "";
    if (context.permissionMode === "fullAccess") {
      appServer.respond(request.id, { decision: "accept" });
      emitActivity(context, {
        kind: "command",
        title: "已按完全访问权限执行命令",
        detail: command || undefined,
        state: "full-access"
      });
      return;
    }
    const policy = classifyCommand(command, context.workspacePath);
    if (policy.action === "auto") {
      appServer.respond(request.id, { decision: "accept" });
      emitActivity(context, {
        kind: "command",
        title: "已自动执行项目内安全操作",
        detail: command || undefined,
        state: "auto-approved"
      });
      return;
    }
    if (
      policy.allowRemember &&
      isApprovedOutsideRead(
        context.approvedOutsideReadRoots,
        policy.outsideReadRoots
      )
    ) {
      appServer.respond(request.id, { decision: "accept" });
      emitActivity(context, {
        kind: "command",
        title: "已按本任务授权读取项目外目录",
        detail: command || undefined,
        state: "auto-approved"
      });
      return;
    }
    queueApproval(request, context, "command", {
      reason: policy.reason,
      allowRemember: policy.allowRemember,
      outsideReadRoots: policy.outsideReadRoots
    });
    return;
  }

  if (request.method === "item/fileChange/requestApproval") {
    if (!context) {
      appServer.respond(request.id, { decision: "decline" });
      return;
    }
    if (context.permissionMode === "fullAccess") {
      appServer.respond(request.id, { decision: "accept" });
      emitActivity(context, {
        kind: "file",
        title: "已按完全访问权限修改文件",
        state: "full-access"
      });
      return;
    }
    const itemId =
      typeof request.params.itemId === "string" ? request.params.itemId : "";
    const diff = itemId ? context.proposedDiffs.get(itemId) ?? "" : "";
    if (!isDestructiveFileDiff(diff)) {
      appServer.respond(request.id, { decision: "accept" });
      emitActivity(context, {
        kind: "file",
        title: "已自动允许项目内文件修改",
        detail: diff || undefined,
        state: "auto-approved"
      });
      return;
    }
    queueApproval(request, context, "file", {
      reason: "删除文件需要每次确认",
      allowRemember: false,
      outsideReadRoots: []
    });
    return;
  }

  appServer.respondError(request.id, -32601, `阶段 3 不支持服务端请求：${request.method}`);
}

async function cleanupContextProcesses(context: RunContext) {
  try {
    await appServer.request("thread/backgroundTerminals/clean", {
      threadId: context.threadId
    });
  } catch (error) {
    emitActivity(context, {
      kind: "warning",
      title: "后台进程清理失败",
      detail: error instanceof Error ? error.message : String(error)
    });
  }
}

function queueApproval(
  request: AppServerRequest,
  context: RunContext,
  kind: "command" | "file",
  policy: {
    reason: string;
    allowRemember: boolean;
    outsideReadRoots: string[];
  }
) {
  const approvalId = `${request.id}`;
  const itemId =
    typeof request.params.itemId === "string" ? request.params.itemId : "";
  const command =
    typeof request.params.command === "string" ? request.params.command : "";
  pendingApprovals.set(approvalId, {
    rpcId: request.id,
    approvalId,
    context,
    kind,
    allowRemember: policy.allowRemember,
    outsideReadRoots: policy.outsideReadRoots
  });
  const outsideTargets =
    kind === "command"
      ? findOutsideWorkspacePaths(command, context.workspacePath)
      : [];
  const outsideReason =
    outsideTargets.length > 0
      ? `目标位于当前工作区外：${outsideTargets.join("、")}`
      : "";
  for (const target of outsideTargets) {
    if (context.warnedOutsidePaths.has(target)) continue;
    context.warnedOutsidePaths.add(target);
    emitActivity(context, {
      kind: "warning",
      title: "检测到工作区外目标",
      detail: `${target}\n当前项目：${context.workspacePath}`,
      state: "needs-attention"
    });
  }
  emitTaskStatus(
    context,
    "waitingApproval",
    `${countPendingApprovals(context)} 项操作等待处理`
  );
  emitChatEvent(context.sender, {
    requestId: context.requestId,
    type: "approval",
    approval: {
      id: approvalId,
      requestId: context.requestId,
      kind,
      title: kind === "command" ? "命令执行审批" : "文件修改审批",
      detail: command || undefined,
      diff: itemId ? context.proposedDiffs.get(itemId) : undefined,
      cwd:
        typeof request.params.cwd === "string" ? request.params.cwd : undefined,
      reason:
        [
          outsideReason,
          policy.reason,
          typeof request.params.reason === "string"
            ? request.params.reason
            : ""
        ]
          .filter(Boolean)
          .join("\n") || undefined,
      allowRemember: policy.allowRemember
    }
  });
}

function requestOutsidePathApproval(
  context: RunContext,
  outsideTargets: string[]
) {
  const approvalId = `preflight:${context.requestId}`;
  return new Promise<boolean>((resolve) => {
    pendingApprovals.set(approvalId, {
      approvalId,
      context,
      kind: "command",
      allowRemember: true,
      outsideReadRoots: outsideTargets,
      resolvePreflight: resolve
    });
    for (const target of outsideTargets) context.warnedOutsidePaths.add(target);
    emitTaskStatus(context, "waitingApproval", "任务需要访问当前工作区外的路径");
    emitChatEvent(context.sender, {
      requestId: context.requestId,
      type: "approval",
      approval: {
        id: approvalId,
        requestId: context.requestId,
        kind: "command",
        title: "工作区外访问审批",
        detail: outsideTargets.join("\n"),
        reason: `任务明确引用了当前工作区外的路径。当前工作区：${context.workspacePath}`,
        allowRemember: true
      }
    });
  });
}

appServer.on("notification", handleNotification);
appServer.on("request", handleServerRequest);
appServer.on("protocolError", (error: Error) => {
  for (const context of [...activeRequests.values()]) {
    emitTaskStatus(context, "failed", error.message);
    emitChatEvent(context.sender, {
      requestId: context.requestId,
      type: "error",
      message: error.message
    });
    void finishStoredTask(context.taskId, "failed", {
      failureReason: error.message
    });
    finishContext(context);
  }
});
appServer.on("exit", (error: Error) => {
  for (const context of [...activeRequests.values()]) {
    emitTaskStatus(context, "failed", error.message);
    emitChatEvent(context.sender, {
      requestId: context.requestId,
      type: "error",
      message: error.message
    });
    void finishStoredTask(context.taskId, "failed", {
      failureReason: error.message
    });
    finishContext(context);
  }
});

async function runCodexTurn(sender: Electron.WebContents, request: ChatRequest) {
  const modelProfile = allowedModels.get(request.model);
  if (!modelProfile) throw new Error("不支持的模型。");
  if (!allowedPermissionModes.has(request.permissionMode)) {
    throw new Error("不支持的权限模式。");
  }
  if (!request.message.trim()) throw new Error("消息不能为空。");
  if (!path.isAbsolute(request.workspacePath)) throw new Error("项目目录无效。");
  if (activeRequests.has(request.requestId)) throw new Error("请求编号重复。");

  // M1: Linduo 模型直接走 server HTTP/SSE,跳过整个 Codex app-server 链路(thread/start, turn/start, approval 等)。
  // 早期切出避免污染 Codex 路径的状态(stop、activeRequests、cleanupContextProcesses 等)。
  if (modelProfile.providerId === LINDUO_PROVIDER_ID) {
    await executeLinduoTurn(sender, request, modelProfile);
    return;
  }

  let taskId = request.requestId;
  try {
    const existingTask = request.conversationId
      ? await readStoredTask(request.conversationId)
      : null;
    if (request.conversationId && !existingTask) {
      throw new Error("要继续的对话不存在。");
    }
    if (existingTask && existingTask.workspacePath !== request.workspacePath) {
      throw new Error("对话所属项目与当前项目不一致。");
    }
    taskId = existingTask?.id ?? request.requestId;
    if (modelProfile.providerId === "deepseek_proxy") await ensureProxyRunning();
    await appServer.start();
    let executionThreadId = existingTask?.codexThreadId;
    let preparedThreadResponse: Record<string, unknown> | null = null;
    let branchId = existingTask?.activeBranchId ?? "main";
    /**
     * 自动 fork 原因。当前仅在“当前分支绑定的 provider 与新 model 的 provider 不一致”时设为 true：
     * Codex app-server 的 thread 创建后 model_provider 就被锁住，turn 级别
     * 只能覆盖 model 不能改 provider（从 TurnStartParams.json schema 验证），
     * 如果不自动 fork，turn 会用旧 provider 去找新 model → model_not_found。
     */
    let autoForkedReason: string | null = null;
    if (existingTask && request.edit) {
      const sourceBranch = (existingTask.branches ?? []).find(
        (item) => item.id === request.edit?.sourceBranchId
      );
      const sourceThreadId = sourceBranch?.threadId ?? existingTask.codexThreadId;
      if (!sourceThreadId) throw new Error("被编辑消息没有可分叉的执行线程。");
      const forkResponse = (await appServer.request("thread/fork", {
        threadId: sourceThreadId,
        beforeTurnId: request.edit.beforeTurnId,
        model: request.model,
        modelProvider: modelProfile.providerId,
        cwd: request.workspacePath,
        runtimeWorkspaceRoots: [request.workspacePath],
        approvalPolicy: approvalPolicyFor(request.permissionMode),
        sandbox: sandboxFor(request.permissionMode),
        ephemeral: false
      })) as Record<string, unknown>;
      if (
        !isRecord(forkResponse.thread) ||
        typeof forkResponse.thread.id !== "string"
      ) {
        throw new Error("Codex 未返回有效的分支线程。");
      }
      branchId = request.requestId;
      executionThreadId = forkResponse.thread.id;
      preparedThreadResponse = forkResponse;
      await createStoredBranch(taskId, {
        id: branchId,
        parentBranchId: request.edit.sourceBranchId,
        forkRequestId: request.edit.replacesRequestId,
        replacesRequestId: request.edit.replacesRequestId,
        threadId: executionThreadId,
        model: request.model,
        providerId: modelProfile.providerId
      });
    } else if (
      existingTask &&
      executionThreadId
    ) {
      // 自动 fork：未走“编辑重发”路径，但 model 所属 provider 与当前分支不一致。
      // 例：用户先在 chat-latest（openai_api）上发了几条，后来切到
      //     deepseek/deepseek-v4-flash（deepseek_proxy）继续发，
      //     如果继续 thread/resume，Codex 会用旧 openai_api provider 找新 model
      //     → 404 model_not_found。
      // 处理：跳过 resume，用 thread/start 重建，并在新分支上绑定新 provider。
      const activeBranch = (existingTask.branches ?? []).find(
        (item) => item.id === (existingTask.activeBranchId ?? "main")
      );
      const currentProviderId = activeBranch?.providerId;
      if (currentProviderId && currentProviderId !== modelProfile.providerId) {
        autoForkedReason = `${currentProviderId} → ${modelProfile.providerId}`;
        console.log(
          `[advisor] 检测到 provider 切换 (${autoForkedReason})，自动 fork 新分支以避开 thread provider 锁定`
        );
        executionThreadId = undefined;
        branchId = request.requestId;
      }
    }
    if (existingTask) {
      await beginStoredTurn(taskId, {
        requestId: request.requestId,
        message: request.message,
        model: request.model,
        permissionMode: request.permissionMode,
        branchId,
        replacesRequestId: request.edit?.replacesRequestId
      });
    } else {
      await createStoredTask({
        id: taskId,
        message: request.message,
        model: request.model,
        permissionMode: request.permissionMode,
        workspacePath: request.workspacePath
      });
    }
    const personalization = await readPersonalizationSettings();
    const localMemory = await buildLocalMemoryContext(
      request.workspacePath,
      personalization,
      taskId,
      request.message
    );
    const developerInstructions = [
      "You are 在线参谋, a model-neutral agent focused on cross-border e-commerce consultation and execution. Answer questions directly, research when current evidence is needed, analyze user attachments, and use structured tools when the user asks you to inspect or change local files, run commands, or produce artifacts. Distinguish verified facts from inference, never invent market data, prices, policies, product facts, or tool results. Continue after tool results, including failures and declined approvals, until the task is verified or a concrete blocker is found. Use the apply_patch file-change tool for auditable source edits and respect every approval decision.",
      personalizationInstructions(personalization)
    ].join("\n\n");
    // thread/resume 失败回退：当 stored codexThreadId 指向的线程在 Codex app-server
    // 端已找不到 rollout（进程重启/被清理）时，自动用 thread/start 创建新线程，
    // 并向 UI 发送 threadReset 事件以提示上下文已断开。历史消息仍可读。
    let threadResponse: Record<string, unknown> | null = preparedThreadResponse;
    if (!threadResponse) {
      try {
        threadResponse = (await appServer.request(
          executionThreadId ? "thread/resume" : "thread/start",
          executionThreadId
            ? {
                threadId: executionThreadId,
                model: request.model,
                modelProvider: modelProfile.providerId,
                cwd: request.workspacePath,
                approvalPolicy: approvalPolicyFor(request.permissionMode),
                sandbox: sandboxFor(request.permissionMode),
                developerInstructions
              }
            : {
                model: request.model,
                modelProvider: modelProfile.providerId,
                cwd: request.workspacePath,
                runtimeWorkspaceRoots: [request.workspacePath],
                approvalPolicy: approvalPolicyFor(request.permissionMode),
                sandbox: sandboxFor(request.permissionMode),
                ephemeral: false,
                developerInstructions
              }
        )) as Record<string, unknown>;
      } catch (resumeError) {
        if (!executionThreadId) throw resumeError;
        // 只在“原 thread 存在但 Codex 端丢失”时才回退。其它错误（如 workspace 权限）继续报错。
        const reason =
          resumeError instanceof Error ? resumeError.message : String(resumeError);
        console.warn(
          `[advisor] thread/resume 失败，自动回退到 thread/start：${reason}`
        );
        await clearStoredThreadId(taskId);
        executionThreadId = undefined;
        threadResponse = (await appServer.request("thread/start", {
          model: request.model,
          modelProvider: modelProfile.providerId,
          cwd: request.workspacePath,
          runtimeWorkspaceRoots: [request.workspacePath],
          approvalPolicy: approvalPolicyFor(request.permissionMode),
          sandbox: sandboxFor(request.permissionMode),
          ephemeral: false,
          developerInstructions
        })) as Record<string, unknown>;
        // 通知 UI 上下文已断开（仅在“真正回退”时发）
        emitChatEvent(sender, {
          requestId: request.requestId,
          type: "threadReset",
          reason
        });
      }
    }

    if (!isRecord(threadResponse.thread) || typeof threadResponse.thread.id !== "string") {
      throw new Error("Codex 未返回有效对话线程。");
    }
    if (autoForkedReason) {
      // 自动 fork 路径：上面的 setStoredThreadId 找不到新 branch（branch 尚未创建），
      // 这里创建新 branch 并同时绑定 model/provider，作为后续检测的权威来源。
      await createStoredBranch(taskId, {
        id: branchId,
        parentBranchId: existingTask?.activeBranchId ?? "main",
        forkRequestId: request.requestId,
        replacesRequestId: request.requestId,
        threadId: threadResponse.thread.id,
        model: request.model,
        providerId: modelProfile.providerId
      });
      emitChatEvent(sender, {
        requestId: request.requestId,
        type: "threadReset",
        reason: `模型供应商已切换（${autoForkedReason}），已在新分支上从 ${request.model} 继续；旧分支仍可访问。`
      });
    } else {
      await setStoredThreadId(taskId, threadResponse.thread.id, {
        model: request.model,
        providerId: modelProfile.providerId
      });
    }

    const context: RunContext = {
      requestId: request.requestId,
      taskId,
      workspacePath: request.workspacePath,
      permissionMode: request.permissionMode,
      sender,
      threadId: threadResponse.thread.id,
      branchId,
      turnId: null,
      stopped: false,
      proposedDiffs: new Map(),
      approvedOutsideReadRoots: new Set(),
      warnedOutsidePaths: new Set()
    };
    activeRequests.set(request.requestId, context);
    contextsByThread.set(context.threadId, context);
    emitTaskStatus(context, "running");
    emitActivity(context, {
      kind: "status",
      title: "Codex app-server 已连接",
      detail: `${request.model} · ${permissionLabel(request.permissionMode)} · ${request.workspacePath}`,
      state: "connected"
    });
    const requestedOutsideTargets = findOutsideWorkspacePaths(
      request.message,
      context.workspacePath
    );
    for (const target of requestedOutsideTargets) {
      context.warnedOutsidePaths.add(target);
      emitActivity(context, {
        kind: "warning",
        title: "任务引用了当前工作区外的目标",
        detail: `${target}\n当前项目：${context.workspacePath}`,
        state: "needs-attention"
      });
    }
    if (
      requestedOutsideTargets.length > 0 &&
      request.permissionMode !== "fullAccess"
    ) {
      const approved = await requestOutsidePathApproval(
        context,
        requestedOutsideTargets
      );
      if (!approved) {
        emitChatEvent(context.sender, {
          requestId: context.requestId,
          type: "delta",
          text: "已按你的选择取消工作区外访问，本次任务未执行。"
        });
        emitTaskStatus(context, "stopped", "工作区外访问未获批准");
        emitChatEvent(context.sender, {
          requestId: context.requestId,
          type: "stopped"
        });
        await finishStoredTask(context.taskId, "stopped");
        finishContext(context);
        return;
      }
      emitActivity(context, {
        kind: "status",
        title: "已批准本次工作区外访问",
        detail: requestedOutsideTargets.join("\n"),
        state: "approved"
      });
    }

    const attachments = await listAttachments(request.requestId);
    const visionResults = await analyzeSession(request.requestId);
    const multimodalResults = await describeAttachments(
      attachments,
      request.message
    );
    const documentContext = await buildDocumentContext(attachments);
    if (visionResults.length > 0) {
      const succeeded = visionResults.filter((result) => result.success).length;
      const failed = visionResults.length - succeeded;
      emitActivity(context, {
        kind: failed > 0 ? "warning" : "vision",
        title:
          failed > 0
            ? `图片分析完成，${failed} 张失败`
            : `已分析 ${succeeded} 张图片`,
        detail: JSON.stringify(visionResults, null, 2),
        state: failed > 0 ? "partial" : "completed"
      });
    }
    if (documentContext.blocks.length > 0) {
      emitActivity(context, {
        kind: documentContext.partial ? "warning" : "status",
        title: documentContext.partial
          ? `已抽取 ${documentContext.blocks.length} 份文档（部分超长被截断）`
          : `已抽取 ${documentContext.blocks.length} 份文档`,
        detail: documentContext.blocks
          .map((block) => `${block.fileName} · ${block.chars} 字`)
          .join("\n"),
        state: "completed"
      });
    }

    const additionalContext: Record<
      string,
      { value: string; kind: "application" }
    > = {};
    if (existingTask && !existingTask.codexThreadId) {
      additionalContext["deepseek-codex-legacy-conversation"] = {
        value: JSON.stringify({
          instruction:
            "This is the existing local conversation being upgraded to a persistent Codex thread. Treat it as the immediately preceding conversation history.",
          userRequest: existingTask.message,
          assistantResult: existingTask.events
            .filter((event) => event.type === "delta")
            .map((event) => {
              const payload = event.payload as { text?: unknown };
              return typeof payload.text === "string" ? payload.text : "";
            })
            .join("")
            .slice(0, 12000)
        }),
        kind: "application"
      };
      emitActivity(context, {
        kind: "status",
        title: "已恢复旧版对话上下文",
        detail: existingTask.title,
        state: "upgraded"
      });
    }
    if (visionResults.length > 0) {
      additionalContext["deepseek-codex-vision-analysis"] = {
        value: JSON.stringify({
          instruction:
            "The application has already inspected every attached image. Use the structured OCR and annotations as direct image evidence, including annotation color, position, enclosedText, nearbyText, and regionText. Never claim that view_image is unavailable or ask the user to describe a detected colored frame. If annotations is empty, say only that no supported red or green rectangular annotation was detected. Clearly distinguish OCR evidence from inferred recommendations.",
          delivery: {
            mode: "independent-vision-sidecar-with-structured-fallback",
            rawImageCount: attachments.filter((attachment) => attachment.available).length,
            fallbackAvailable: true,
            deepSeekAcceptsRawImages: false
          },
          images: visionResults,
          multimodalDescriptions: multimodalResults
        }),
        kind: "application"
      };
    }
    if (documentContext.blocks.length > 0) {
      additionalContext["deepseek-codex-document-attachments"] = {
        value: JSON.stringify({
          instruction:
            "The user attached one or more documents. Their extracted plain text is appended at the end of the user message under a fenced 📎 block. Treat that text as direct, authoritative document content. When the user asks a question about the document, quote and cite the corresponding part. If a file failed to extract, the block will say so explicitly and you should ask the user to summarize the missing part instead of guessing.",
          files: documentContext.blocks.map((block) => ({
            fileName: block.fileName,
            chars: block.chars,
            truncated: block.truncated
          }))
        }),
        kind: "application"
      };
    }
    if (multimodalResults.length > 0) {
      const succeeded = multimodalResults.filter((result) => result.success).length;
      emitActivity(context, {
        kind: succeeded > 0 ? "vision" : "warning",
        title:
          succeeded > 0
            ? `视觉模型已理解 ${succeeded} 张原图`
            : "视觉模型暂不可用，已使用本地视觉分析",
        detail: JSON.stringify(multimodalResults, null, 2),
        state: succeeded > 0 ? "completed" : "partial"
      });
    }
    if (localMemory) {
      additionalContext["deepseek-codex-local-memory"] = {
        value: JSON.stringify(localMemory),
        kind: "application"
      };
      emitActivity(context, {
        kind: "status",
        title: "已载入本地项目记忆",
        detail: `${localMemory.entries.length} 条相关任务：${localMemory.entries.map((entry) => entry.title).join("；")}`,
        state: "loaded"
      });
    }

    const textInput = {
      type: "text",
      text: appendDocumentContextToMessage(request.message, documentContext),
      text_elements: []
    };
    // The configured DeepSeek V4 models are text-only. Raw pixels have already
    // been sent to the independent vision sidecar above; the main turn receives
    // its description plus the deterministic local analysis.
    const imageInputs: Array<{
      type: "localImage";
      path: string;
      detail: "high";
    }> = [];
    const turnParams = {
      threadId: context.threadId,
      input: [textInput, ...imageInputs],
      cwd: request.workspacePath,
      runtimeWorkspaceRoots: [request.workspacePath],
      approvalPolicy: approvalPolicyFor(request.permissionMode),
      sandboxPolicy: turnSandboxPolicyFor(request.permissionMode),
      model: request.model,
      // 之前硬编码 "high"，与 chat-latest（仅支持 medium）冲突导致
      //   "Unsupported value: 'high' is not supported with the 'chat-latest' model."
      // 改为按模型档位表逐个取正确 effort。
      effort: effortFor(modelProfile),
      additionalContext:
        Object.keys(additionalContext).length > 0
          ? additionalContext
          : undefined
    };
    let turnResponse: Record<string, unknown>;
    try {
      turnResponse = (await appServer.request("turn/start", turnParams)) as Record<
        string,
        unknown
      >;
    } catch (error) {
      if (imageInputs.length === 0) throw error;
      emitActivity(context, {
        kind: "warning",
        title: "当前执行引擎拒绝原图输入，已启用本地视觉降级",
        detail: error instanceof Error ? error.message : String(error),
        state: "partial"
      });
      turnResponse = (await appServer.request("turn/start", {
        ...turnParams,
        input: [textInput]
      })) as Record<string, unknown>;
    }
    if (isRecord(turnResponse.turn) && typeof turnResponse.turn.id === "string") {
      context.turnId = turnResponse.turn.id;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知请求错误";
    emitChatEvent(sender, { requestId: request.requestId, type: "error", message });
    await finishStoredTask(taskId, "failed", { failureReason: message });
    const context = activeRequests.get(request.requestId);
    if (context) finishContext(context);
  }
}

function approvalPolicyFor(mode: PermissionMode) {
  if (mode === "ask") return "untrusted";
  if (mode === "fullAccess") return "never";
  return "on-request";
}

function sandboxFor(mode: PermissionMode) {
  return mode === "fullAccess" ? "danger-full-access" : "workspace-write";
}

function turnSandboxPolicyFor(mode: PermissionMode) {
  if (mode === "fullAccess") return { type: "dangerFullAccess" };
  return {
    type: "workspaceWrite",
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}

function permissionLabel(mode: PermissionMode) {
  if (mode === "ask") return "请求批准";
  if (mode === "fullAccess") return "完全访问权限";
  return "替我批准";
}

/**
 * 返回该模型在 turn/start 中应使用的 reasoning effort。
 * 改 hardcoded "high" 之前,chat-latest 会随每次 turn 报
 *   "Unsupported value: 'high' is not supported with the 'chat-latest' model. Supported values are: 'medium'."
 * 修正后按档位表走:chat-latest→medium,deepseek→high,避免任何模型档位不匹配。
 */
function effortFor(model: ModelProfile): "low" | "medium" | "high" | "max" {
  return model.effort;
}

app.whenReady().then(() => {
  void recoverInterruptedTasks();
  ipcMain.handle("advisor:models", () => modelProfiles.map(model => ({ ...model })));
  ipcMain.handle("advisor:sessions:list", () => listStoredTasks());
  ipcMain.handle("advisor:personalization:get", () => getPersonalizationState());
  ipcMain.handle(
    "advisor:personalization:save",
    (_event, settings: Partial<PersonalizationSettings>) =>
      savePersonalizationSettings(settings)
  );
  ipcMain.handle("advisor:personalization:reset-memory", () =>
    resetPersonalizationMemory()
  );
  ipcMain.handle("advisor:sessions:get", (_event, taskId: string) =>
    readStoredTask(taskId)
  );
  ipcMain.handle(
    "advisor:sessions:select-branch",
    (_event, taskId: string, branchId: string) =>
      selectStoredBranch(taskId, branchId)
  );
  ipcMain.handle(
    "advisor:sessions:rename",
    (_event, taskId: string, title: string) => renameStoredTask(taskId, title)
  );
  ipcMain.handle("advisor:sessions:delete", async (_event, taskId: string) => {
    const task = await readStoredTask(taskId);
    const deleted = await deleteStoredTask(taskId);
    if (deleted && task) {
      const sessionIds = new Set<string>();
      for (const event of task.events) {
        if (event.type !== "userMessage" || !isRecord(event.payload)) continue;
        if (typeof event.payload.requestId === "string") {
          sessionIds.add(event.payload.requestId);
        }
      }
      await Promise.all(
        [...sessionIds].map((sessionId) =>
          removeAttachmentSession(sessionId).catch(() => undefined)
        )
      );
    }
    return deleted;
  });
  ipcMain.handle("advisor:sessions:export", async (_event, taskId: string) => {
    const task = await readStoredTask(taskId);
    if (!task) throw new Error("任务记录不存在。");
    const result = await dialog.showSaveDialog({
      title: "导出任务报告",
      defaultPath: `${task.title.replace(/[/:]/g, "-")}.md`,
      filters: [{ name: "Markdown 报告", extensions: ["md"] }]
    });
    if (result.canceled || !result.filePath) return null;
    await exportStoredTask(taskId, result.filePath);
    return result.filePath;
  });
  ipcMain.handle("advisor:project:default", () => app.getAppPath());
  // 孤儿对话专用 scratch 路径：临时目录下、永远存在、不可能等于任何已注册项目，
  // 侧边栏 groupTasksByProject 找不到匹配 group → 任务归入「最近对话」。
  ipcMain.handle("advisor:project:orphan-scratch", async () => {
    const scratch = path.join(os.tmpdir(), "yandu-orphan-scratch");
    // 兜底创建(codex 需要以该路径为 cwd)
    await fs.mkdir(scratch, { recursive: true });
    return scratch;
  });
  ipcMain.handle("advisor:project:select", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择或新建项目文件夹",
      properties: ["openDirectory", "createDirectory"]
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle("advisor:project:reveal", async (_event, projectPath: string) => {
    if (!path.isAbsolute(projectPath)) throw new Error("项目目录无效。");
    const stat = await fs.stat(projectPath);
    if (!stat.isDirectory()) throw new Error("项目目录不存在。");
    shell.showItemInFolder(projectPath);
    return true;
  });
  // AI 输出文件下载：弹原生保存对话框把临时目录下的文件复制到用户指定位置
  // 越权保护：只允许 os.tmpdir() 之下的路径(AI 输出 / 附件临时目录)
  ipcMain.handle("advisor:download-output-file", async (_event, request: { filePath: string } | string) => {
    const filePath = typeof request === "string" ? request : request?.filePath;
    if (!filePath) return { ok: false, error: "文件路径为空" };
    const tmpRoot = os.tmpdir();
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(tmpRoot + path.sep)) {
      return { ok: false, error: "只能下载系统临时目录下的文件" };
    }
    try {
      await fs.access(resolved);
    } catch {
      return { ok: false, error: "文件不存在或已被清理(可能重启过)" };
    }
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return { ok: false, error: "目标不是文件" };
    const fileName = path.basename(resolved);
    const ext = path.extname(fileName).replace(/^\./, "") || "*";
    const selected = await dialog.showSaveDialog({
      title: "下载 AI 输出文件",
      defaultPath: fileName,
      filters: [{ name: "原文件", extensions: [ext] }]
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    await fs.copyFile(resolved, selected.filePath);
    const saved = await fs.stat(selected.filePath);
    return { ok: true, filePath: selected.filePath, byteSize: saved.size, fileName };
  });

  ipcMain.handle("advisor:images:select", async (_event, sessionId: string) => {
    const result = await dialog.showOpenDialog({
      title: "选择图片",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "图片",
          extensions: ["png", "jpg", "jpeg", "webp", "gif", "heic", "tif", "tiff", "bmp"]
        }
      ]
    });
    if (result.canceled) return [];
    const images: IncomingImage[] = await Promise.all(
      result.filePaths.map(async (filePath) => ({
        name: path.basename(filePath),
        mimeType: mimeTypeForPath(filePath),
        bytes: await fs.readFile(filePath)
      }))
    );
    return saveIncomingImages(sessionId, images);
  });

  ipcMain.handle(
    "advisor:images:list",
    (_event, sessionId: string) => listAttachments(sessionId)
  );
  ipcMain.handle(
    "advisor:images:clone",
    (
      _event,
      payload: { sourceSessionId: string; targetSessionId: string }
    ) => cloneAttachmentSession(payload.sourceSessionId, payload.targetSessionId)
  );
  ipcMain.handle("advisor:images:discard-session", (_event, sessionId: string) =>
    removeAttachmentSession(sessionId)
  );

  ipcMain.handle(
    "advisor:images:preview",
    (_event, payload: { sessionId: string; id: string }) =>
      readAttachmentPreview(payload.sessionId, payload.id)
  );

  ipcMain.handle(
    "advisor:images:analysis",
    (_event, sessionId: string) => analyzeSession(sessionId)
  );

  ipcMain.handle(
    "advisor:images:save",
    (_event, payload: { sessionId: string; images: IncomingImage[] }) =>
      saveIncomingImages(payload.sessionId, payload.images)
  );

  ipcMain.handle(
    "advisor:images:remove",
    (_event, payload: { sessionId: string; id: string }) =>
      removeAttachment(payload.sessionId, payload.id)
  );

  ipcMain.handle("advisor:documents:select", async (_event, sessionId: string) => {
    const result = await dialog.showOpenDialog({
      title: "选择文档",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "文档",
          extensions: ["pdf", "docx", "doc", "rtf", "txt", "md"]
        }
      ]
    });
    if (result.canceled) return [];
    const documents: IncomingDocument[] = await Promise.all(
      result.filePaths.map(async (filePath) => ({
        name: path.basename(filePath),
        mimeType: "application/octet-stream",
        bytes: await fs.readFile(filePath)
      }))
    );
    return saveIncomingDocuments(sessionId, documents);
  });

  ipcMain.handle(
    "advisor:documents:save",
    (
      _event,
      payload: { sessionId: string; documents: IncomingDocument[] }
    ) => saveIncomingDocuments(payload.sessionId, payload.documents)
  );

  ipcMain.handle(
    "advisor:documents:list",
    (_event, sessionId: string) => listAttachments(sessionId)
  );

  ipcMain.handle(
    "advisor:documents:remove",
    (_event, payload: { sessionId: string; id: string }) =>
      removeAttachment(payload.sessionId, payload.id)
  );

  // 统一附件选择入口：对话框一次性支持图片 + 文档多选混选，
  // 内部按扩展名分桶走 saveIncomingImages / saveIncomingDocuments。
  // 与 advisor:images:select / advisor:documents:select 共存，不破坏旧调用方。
  ipcMain.handle("advisor:attachments:select", async (_event, sessionId: string) => {
    const result = await dialog.showOpenDialog({
      title: "上传附件",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "图片与文档",
          extensions: [
            "png", "jpg", "jpeg", "webp", "gif", "heic", "tif", "tiff", "bmp",
            "pdf", "docx", "doc", "rtf", "txt", "md"
          ]
        }
      ]
    });
    if (result.canceled || result.filePaths.length === 0) return [];
    const images: IncomingImage[] = [];
    const documents: IncomingDocument[] = [];
    for (const filePath of result.filePaths) {
      const name = path.basename(filePath);
      const bytes = await fs.readFile(filePath);
      if (isImagePath(filePath)) {
        images.push({ name, mimeType: mimeTypeForPath(filePath), bytes });
      } else {
        documents.push({ name, mimeType: "application/octet-stream", bytes });
      }
    }
    const imageRecords = images.length
      ? await saveIncomingImages(sessionId, images)
      : [];
    const docRecords = documents.length
      ? await saveIncomingDocuments(sessionId, documents)
      : [];
    return [...imageRecords, ...docRecords];
  });

  ipcMain.handle("advisor:connection:status", async () => {
    // 未配置 JWT 时直接返回 signed-out 状态,避免后面启动 app-server 时附带误导错误。
    if (!harnessLastSession && !isHarnessSignedIn()) {
      return {
        connected: false,
        mode: "signed-out" as AdvisorConnectionMode,
        label: "受限隔离执行器未启用",
        detail: "未配置 YANDU_USER_JWT · 业务流使用本地 Codex app-server"
      };
    }
    const mode: AdvisorConnectionMode = harnessLastSession
      ? "harness"
      : "unavailable";
    try {
      await ensureProxyRunning();
      await appServer.start();
      const state: AdvisorConnectionStatus = {
        connected: true,
        mode,
        label: harnessLastSession ? "受限隔离执行器已就绪" : "本地执行器",
        detail: harnessLastSession
          ? harnessLastSession.message
          : "Codex app-server · 本机模型代理"
      };
      return state;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "连接失败";
      return {
        connected: false,
        mode: harnessLastSession ? "harness" : "app-server",
        label: harnessLastSession ? "受限隔离执行器已就绪" : "执行引擎未就绪",
        detail
      };
    }
  });

  /**
   * 主动建立 harness 网关会话。
   * - 未配置 JWT :emit signed-out 状态,抛出 ADVISOR_SIGNED_OUT 供渲染层降级
   * - 连接失败   :emit unavailable 状态,抛出 ADVISOR_HARNESS_UNAVAILABLE 供渲染层降级
   */
  ipcMain.handle("advisor:connect", async () => {
    if (!isHarnessSignedIn()) {
      const state = buildHarnessState({ connected: false });
      emitHarnessState(state);
      throw new Error("ADVISOR_SIGNED_OUT: 受限隔离执行器未启用,请先在 .env 中配置 YANDU_USER_JWT");
    }
    try {
      const session = await harnessClient.connect();
      harnessLastSession = session;
      const state = buildHarnessState();
      emitHarnessState(state);
      return session;
    } catch (error) {
      harnessLastSession = null;
      const message = error instanceof Error ? error.message : String(error);
      // 底层 getAccessToken 抛出 ADVISOR_UNAUTHORIZED 同样表示“未配置或已过期”,
      // 这里将其转成 ADVISOR_SIGNED_OUT 以供 UI 与 getConnectionStatus 保持一致。
      if (message.startsWith("ADVISOR_UNAUTHORIZED")) {
        emitHarnessState(buildHarnessState({ connected: false }));
        throw new Error(`ADVISOR_SIGNED_OUT: ${message.replace(/^ADVISOR_UNAUTHORIZED:\s*/, "")}`);
      }
      emitHarnessState(buildHarnessState({ connected: false }));
      throw new Error(`ADVISOR_HARNESS_UNAVAILABLE: ${message}`);
    }
  });

  /**
   * 主动断开 harness 网关会话 (保留本地 Codex app-server)。
   */
  ipcMain.handle("advisor:disconnect", async () => {
    await harnessClient.disconnect();
    harnessLastSession = null;
    emitHarnessState(buildHarnessState({ connected: false }));
  });

  ipcMain.handle("advisor:chat:send", (event, request: ChatRequest) => {
    void runCodexTurn(event.sender, request);
  });

  ipcMain.handle(
    "advisor:chat:steer",
    async (
      _event,
      payload: { requestId: string; message: string }
    ) => {
      const context = activeRequests.get(payload.requestId);
      const message = payload.message.trim();
      if (!context) throw new Error("当前没有正在执行的回合。");
      if (!context.turnId) throw new Error("当前回合尚未开始，请稍后重试。");
      if (!message) throw new Error("补充要求不能为空。");
      await appServer.request("turn/steer", {
        threadId: context.threadId,
        expectedTurnId: context.turnId,
        clientUserMessageId: crypto.randomUUID(),
        input: [{ type: "text", text: message, text_elements: [] }]
      });
      await appendStoredEvent(context.taskId, "steerMessage", {
        requestId: context.requestId,
        text: message
      });
      emitActivity(context, {
        kind: "status",
        title: "已补充执行要求",
        detail: message,
        state: "steered"
      });
      return true;
    }
  );

  ipcMain.handle("advisor:chat:stop", async (_event, requestId: string) => {
    const context = activeRequests.get(requestId);
    // M1 Linduo: 通过 AbortController 终止 server fetch。
    // 不能靠 context.turnId 判断（Linduo 无 turnId），必须查 linduoAbortControllers。
    const linduoController = linduoAbortControllers.get(requestId);
    if (linduoController) {
      if (context) {
        context.stopped = true;
        cancelPendingApprovals(context);
      }
      try {
        linduoController.abort();
      } catch {
        /* abort 失败不向上传播 */
      }
      return true;
    }
    if (!context?.turnId) return false;
    context.stopped = true;
    cancelPendingApprovals(context);
    try {
      await appServer.request("turn/interrupt", {
        threadId: context.threadId,
        turnId: context.turnId
      });
    } finally {
      await cleanupContextProcesses(context);
    }
    return true;
  });

  ipcMain.handle(
    "advisor:approval:resolve",
    (
      _event,
      payload: { approvalId: string; decision: ApprovalDecision }
    ) => {
      const pending = pendingApprovals.get(payload.approvalId);
      if (!pending) return false;
      if (!["accept", "decline", "acceptForSession"].includes(payload.decision)) {
        return false;
      }
      pendingApprovals.delete(payload.approvalId);
      const effectiveDecision =
        payload.decision === "acceptForSession" && !pending.allowRemember
          ? "accept"
          : payload.decision;
      if (effectiveDecision === "acceptForSession") {
        for (const root of pending.outsideReadRoots) {
          pending.context.approvedOutsideReadRoots.add(root);
        }
      }
      if (pending.rpcId !== undefined) {
        appServer.respond(pending.rpcId, { decision: effectiveDecision });
      } else {
        pending.resolvePreflight?.(effectiveDecision !== "decline");
      }
      void appendStoredEvent(pending.context.taskId, "approvalDecision", {
        requestId: pending.context.requestId,
        approvalId: pending.approvalId,
        kind: pending.kind,
        decision: effectiveDecision
      });
      emitChatEvent(pending.context.sender, {
        requestId: pending.context.requestId,
        type: "approvalResolved",
        approvalId: pending.approvalId,
        decision: effectiveDecision
      });
      const remaining = countPendingApprovals(pending.context);
      if (pending.rpcId !== undefined || effectiveDecision !== "decline") {
        emitTaskStatus(
          pending.context,
          remaining > 0 ? "waitingApproval" : "running",
          remaining > 0 ? `${remaining} 项操作等待处理` : undefined
        );
      }
      return true;
    }
  );

});

export async function shutdownAdvisorRuntime() {
  for (const context of [...activeRequests.values()]) {
    context.stopped = true;
    cancelPendingApprovals(context);
    await cleanupContextProcesses(context).catch(() => undefined);
  }
  // Linduo 流式 turn：主动 abort 任何未结束的 fetch,避免 shutdown 时悬挂 promise。
  for (const controller of linduoAbortControllers.values()) {
    try {
      controller.abort();
    } catch {
      /* abort 失败不阻塞 shutdown */
    }
  }
  linduoAbortControllers.clear();
  await Promise.all([appServer.stop(), stopManagedProxy(), harnessClient.disconnect()]);
  harnessLastSession = null;
}

/**
 * M1 Linduo turn 执行入口。
 *
 * 跳过整个 Codex app-server 链路（thread/start、turn/start、approval、background terminals），
 * 走 server HTTP/SSE。原因：Linduo 模型不在 Codex app-server 范畴,无须 thread 概念。
 *
 * 关键点：
 * - 用合成 threadId = `linduo:<serverModelId>` 满足 RunContext 类型;contextsByThread 中不注册,
 *   finishContext 不会污染 app-server 路由。
 * - AbortController 按 requestId 索引,advisor:chat:stop 触发 abort → server fetch 自动中断。
 * - 错误码前缀约定:
 *   - ADVISOR_SIGNED_OUT   未登录 / 401/403
 *   - LINDUO_MODEL_NOT_FOUND / LINDUO_RATE_LIMITED / LINDUO_UPSTREAM_ERROR 业务错误
 */
async function executeLinduoTurn(
  sender: Electron.WebContents,
  request: ChatRequest,
  modelProfile: ModelProfile
): Promise<void> {
  const requestId = request.requestId;
  const serverModelId = request.model.slice(LINDUO_MODEL_PREFIX.length);
  console.log(
    `[advisor] linduo turn start requestId=${requestId} modelId=${serverModelId} workspace=${request.workspacePath}`
  );
  if (!serverModelId) {
    emitChatEvent(sender, {
      requestId,
      type: "linduo_error",
      message: "Linduo 模型 id 格式异常,缺少服务端 modelId"
    });
    return;
  }

  // 1. 读取/创建存储任务（与 Codex 路径一致,但不触碰 codexThreadId）。
  let taskId = request.requestId;
  const existingTask: StoredTask | null = request.conversationId
    ? await readStoredTask(request.conversationId)
    : null;
  if (request.conversationId && !existingTask) {
    emitChatEvent(sender, {
      requestId,
      type: "linduo_error",
      message: "要继续的对话不存在。"
    });
    return;
  }
  if (existingTask && existingTask.workspacePath !== request.workspacePath) {
    emitChatEvent(sender, {
      requestId,
      type: "linduo_error",
      message: "对话所属项目与当前项目不一致。"
    });
    return;
  }
  taskId = existingTask?.id ?? request.requestId;
  try {
    if (existingTask) {
      await beginStoredTurn(taskId, {
        requestId,
        message: request.message,
        model: request.model,
        permissionMode: request.permissionMode,
        branchId: existingTask.activeBranchId,
        replacesRequestId: request.edit?.replacesRequestId
      });
    } else {
      await createStoredTask({
        id: taskId,
        message: request.message,
        model: request.model,
        permissionMode: request.permissionMode,
        workspacePath: request.workspacePath
      });
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : "存储任务初始化失败";
    emitChatEvent(sender, {
      requestId,
      type: "linduo_error",
      message: detail
    });
    return;
  }

  // 2. 构造最小 RunContext（不入 contextsByThread,因 Linduo 无 thread 概念）。
  const context: RunContext = {
    requestId,
    taskId,
    workspacePath: request.workspacePath,
    permissionMode: request.permissionMode,
    sender,
    threadId: `${LINDUO_MODEL_PREFIX}${serverModelId}`,
    branchId: existingTask?.activeBranchId ?? "main",
    turnId: null,
    stopped: false,
    proposedDiffs: new Map(),
    approvedOutsideReadRoots: new Set(),
    warnedOutsidePaths: new Set()
  };
  activeRequests.set(requestId, context);

  const abortController = new AbortController();
  linduoAbortControllers.set(requestId, abortController);

  try {
    emitTaskStatus(context, "running");
    emitActivity(context, {
      kind: "status",
      title: "Linduo 模型已连接",
      detail: `${modelProfile.name} · ${serverModelId} · ${request.workspacePath}`,
      state: "connected"
    });

    // 3. 构造 system prompt + messages。
    // M1 兜底：不传 tools、不传 vision 描述、不做附件分析,
    //         仅 system + user(text),与 chat-models-sync 的 M1 范围对齐。
    const personalization = await readPersonalizationSettings();
    const systemPrompt = [
      "You are 在线参谋, a model-neutral agent focused on cross-border e-commerce consultation and execution. Answer questions directly, research when current evidence is needed, analyze user attachments, and use structured tools when the user asks you to inspect or change local files, run commands, or produce artifacts. Distinguish verified facts from inference, never invent market data, prices, policies, product facts, or tool results. Continue after tool results, including failures and declined approvals, until the task is verified or a concrete blocker is found.",
      personalizationInstructions(personalization)
    ].join("\n\n");
    const messages: Array<{
      role: "system" | "user" | "assistant";
      content: string;
    }> = [
      { role: "system", content: systemPrompt },
      { role: "user", content: request.message }
    ];

    // 4. 发起流式 chat。
    const response = await streamLinduoChat(
      { modelId: serverModelId, messages },
      abortController.signal
    );
    if (!response.body) {
      throw new Error("LINDUO_UPSTREAM_ERROR: empty body");
    }

    // 5. 读 SSE 事件流,逐个 yield 内部 ChatEvent。
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalUsage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    } | null = null;
    let streamError: string | null = null;

    try {
      while (true) {
        if (context.stopped) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const line = raw.split("\n").find((l) => l.startsWith("data:"));
          if (!line) continue;
          // trim() 会同时去 \r 头尾，避免 server 未来升级为 \r\n 换行时 JSON.parse 失败
          const data = line.slice(5).trim();
          if (!data) continue;
          let parsed: LinduoChatSseEvent;
          try {
            parsed = JSON.parse(data) as LinduoChatSseEvent;
          } catch {
            continue;
          }
          if (parsed.type === "delta") {
            emitChatEvent(sender, {
              requestId,
              type: "linduo_delta",
              text: parsed.text
            });
          } else if (parsed.type === "done") {
            finalUsage = parsed.usage;
            emitChatEvent(sender, {
              requestId,
              type: "linduo_done",
              usage: parsed.usage
            });
          } else if (parsed.type === "error") {
            streamError = parsed.message;
            emitChatEvent(sender, {
              requestId,
              type: "linduo_error",
              message: parsed.message
            });
            break;
          }
        }
        if (streamError) break;
      }
      // flush decoder 兜底多字节字符被切断
      buffer += decoder.decode();
      // 兜底：上游关闭前可能只发到最后一个 data 行（未跟 \n\n），这里是最后一帧 SSE 机会。
      // 静默跳过非 JSON，错误语义交给后续“未收到 done”兜底分支。
      const trailing = buffer.trim();
      if (trailing.startsWith("data:")) {
        const data = trailing.slice(5).trim();
        if (data && data !== "[DONE]") {
          try {
            const parsed = JSON.parse(data) as LinduoChatSseEvent;
            if (parsed.type === "delta") {
              emitChatEvent(sender, {
                requestId,
                type: "linduo_delta",
                text: parsed.text
              });
            } else if (parsed.type === "done") {
              finalUsage = parsed.usage;
              emitChatEvent(sender, {
                requestId,
                type: "linduo_done",
                usage: parsed.usage
              });
            } else if (parsed.type === "error") {
              streamError = parsed.message;
              emitChatEvent(sender, {
                requestId,
                type: "linduo_error",
                message: parsed.message
              });
            }
          } catch {
            /* 非 JSON 兜底静默 */
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        /* 释放锁失败不影响 */
      }
    }

    // 6. 收尾:根据状态写存储 + emit taskStatus。
    if (streamError) {
      emitTaskStatus(context, "failed", streamError);
      void finishStoredTask(taskId, "failed", {
        failureReason: streamError,
        usage: finalUsage ?? undefined
      });
    } else if (context.stopped) {
      emitTaskStatus(context, "stopped");
      void finishStoredTask(taskId, "stopped", {
        usage: finalUsage ?? undefined
      });
    } else if (finalUsage) {
      // 业务路径：finishStoredTask 接受 usage 字段,这里调一次足够。
      emitTaskStatus(context, "completed");
      void finishStoredTask(taskId, "completed", { usage: finalUsage });
    } else {
      // 未收到 done:上游截断 SSE。按失败处理。
      const detail = "LINDUO_UPSTREAM_ERROR: SSE 流未发出 done 事件";
      emitChatEvent(sender, {
        requestId,
        type: "linduo_error",
        message: detail
      });
      emitTaskStatus(context, "failed", detail);
      void finishStoredTask(taskId, "failed", { failureReason: detail });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Linduo 请求失败";
    // 过滤 abort:是用户主动停止,不算错误。
    if (abortController.signal.aborted) {
      emitTaskStatus(context, "stopped");
      void finishStoredTask(taskId, "stopped");
    } else {
      emitChatEvent(sender, {
        requestId,
        type: "linduo_error",
        message
      });
      emitTaskStatus(context, "failed", message);
      void finishStoredTask(taskId, "failed", { failureReason: message });
    }
  } finally {
    linduoAbortControllers.delete(requestId);
    activeRequests.delete(requestId);
    // Linduo 不调 cleanupContextProcesses(thread/backgroundTerminals/clean 是 Codex 专属)
    console.log(`[advisor] linduo turn end requestId=${requestId}`);
  }
}

/**
 * 把 server 返回的 effort 字符串显式收窄到 ModelProfile["effort"]。
 * 未知值 / null / undefined 一律兜底 "medium"，不抛错。
 */
function parseEffort(raw: unknown): ModelProfile["effort"] {
  if (raw === "low" || raw === "medium" || raw === "high" || raw === "max") {
    return raw;
  }
  return "medium";
}

/**
 * M1: 从 server 拉取 enabled LinduoChatModel,合并到 modelProfiles 与 allowedModels。
 * - 命名空间: linduo:<modelId>,隔离 Codex 命名空间。
 * - supportsTools / supportsVision 固定 false（M1 兜底,后续可从 LinduoChatModelView.capabilities 推导）。
 * - 失败时保持上次的 modelProfiles,不抛错（启动路径上不希望拦住 main）。
 */
export async function reloadLinduoChatModels(): Promise<{
  added: number;
  total: number;
}> {
  try {
    const rows = await getLinduoChatModelsFromServer();
    const linduoProfiles: ModelProfile[] = rows.map((r) => ({
      id: `${LINDUO_MODEL_PREFIX}${r.modelId}`,
      name: r.displayName || r.modelId,
      providerId: LINDUO_PROVIDER_ID,
      supportsTools: false,
      supportsVision: false,
      effort: parseEffort(r.effort)
    }));
    modelProfiles = [...STATIC_CODEX_PROFILES, ...linduoProfiles];
    allowedModels = new Map(modelProfiles.map((m) => [m.id, m]));
    return { added: linduoProfiles.length, total: modelProfiles.length };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[advisor] reloadLinduoChatModels 失败,保持现有模型表：${detail}`);
    return { added: 0, total: modelProfiles.length };
  }
}


function mimeTypeForPath(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".heic": "image/heic",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".bmp": "image/bmp"
  };
  return types[extension] ?? "application/octet-stream";
}

/**
 * 文档上下文：抽取附件里的文档为纯文本。
 * 每份文档独立抽取，每份超过 32K 字符的截断为前 32K；总预算 32K 字符避免拼到 message 后超长。
 */
type DocumentContextBlock = {
  fileName: string;
  chars: number;
  text: string;
  truncated: boolean;
  failed: boolean;
};

type DocumentContext = {
  blocks: DocumentContextBlock[];
  partial: boolean;
};

const DOCUMENT_PER_FILE_CHAR_LIMIT = 32_000;
const DOCUMENT_TOTAL_CHAR_BUDGET = 32_000;

async function buildDocumentContext(
  attachments: AttachmentRecord[]
): Promise<DocumentContext> {
  const blocks: DocumentContextBlock[] = [];
  let remaining = DOCUMENT_TOTAL_CHAR_BUDGET;
  let partial = false;
  for (const attachment of attachments) {
    if ((attachment.kind ?? "image") !== "document") continue;
    if (attachment.available === false) {
      blocks.push({
        fileName: attachment.fileName,
        chars: 0,
        text: "",
        truncated: false,
        failed: true
      });
      partial = true;
      continue;
    }
    const extension = path.extname(attachment.fileName).toLowerCase();
    let text = "";
    try {
      const bytes = await fs.readFile(attachment.filePath);
      text = await extractDocumentText(bytes, extension, attachment.fileName);
    } catch (error) {
      console.warn(
        `[advisor] failed to read document ${attachment.fileName}:`,
        error
      );
      text = "";
    }
    const truncated = text.length > DOCUMENT_PER_FILE_CHAR_LIMIT;
    if (truncated) {
      text = text.slice(0, DOCUMENT_PER_FILE_CHAR_LIMIT);
    }
    const sliceBudget = Math.max(0, Math.min(remaining, text.length));
    const sliceText = text.slice(0, sliceBudget);
    remaining = Math.max(0, remaining - sliceText.length);
    if (truncated || sliceText.length < text.length) partial = true;
    blocks.push({
      fileName: attachment.fileName,
      chars: sliceText.length,
      text: sliceText,
      truncated,
      failed: sliceText.length === 0
    });
    if (remaining === 0) break;
  }
  return { blocks, partial };
}

function appendDocumentContextToMessage(
  message: string,
  documentContext: DocumentContext
): string {
  if (documentContext.blocks.length === 0) return message;
  const parts: string[] = [message.trimEnd(), "", "📎 附件文档摘录："];
  for (const block of documentContext.blocks) {
    if (block.failed) {
      parts.push(
        `- ${block.fileName}：未能提取文本，请描述要点。`
      );
      continue;
    }
    const truncatedTag = block.truncated ? "（已截断）" : "";
    parts.push(
      `【${block.fileName}】${truncatedTag} 共 ${block.chars} 字：`
    );
    parts.push("```");
    parts.push(block.text);
    parts.push("```");
  }
  return parts.join("\n");
}
