import { app, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
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
import {
  analyzeSession,
  cloneAttachmentSession,
  listAttachments,
  readAttachmentPreview,
  removeAttachment,
  removeAttachmentSession,
  saveIncomingImages,
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
  recoverInterruptedTasks,
  readStoredTask,
  renameStoredTask,
  selectStoredBranch,
  setStoredThreadId,
  updateStoredTaskStatus,
  updateStoredUsage
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
  | { requestId: string; type: "error"; message: string };

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

const modelProfiles = [
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", providerId: "deepseek_proxy", supportsTools: true, supportsVision: false },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", providerId: "deepseek_proxy", supportsTools: true, supportsVision: false },
  { id: "chat-latest", name: "OpenAI ChatGPT Latest", providerId: "openai_api", supportsTools: true, supportsVision: true }
] as const;
const allowedModels = new Map<string, (typeof modelProfiles)[number]>(modelProfiles.map(model => [model.id, model]));
const allowedPermissionModes = new Set<PermissionMode>([
  "ask",
  "agent",
  "fullAccess"
]);
const appServer = new AppServerClient();
const activeRequests = new Map<string, RunContext>();
const contextsByThread = new Map<string, RunContext>();
const pendingApprovals = new Map<string, PendingApproval>();

/**
 * harness 网关客户端：当前阶段仅作为在线参谋执行器健康探针。
 * Codex 业务流仍走 AppServerClient (stdio RPC)。
 * - 连接成功：mode = 'harness'，供 UI 顶栏 chip 展示
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

let harnessLastSession: AdvisorRemoteSession | null = null;
const harnessListeners = new Set<(state: AdvisorConnectionStatus) => void>();

/**
 * 把当前状态推送给所有 UI 订阅者，同时确保 lastSession 与 mode 字段一致。
 * - 'harness'         : harness 通话已建立，业务流可选用 worker (本阶段仅探针)
 * - 'app-server'      : Codex app-server 直连模式 (stdio RPC)
 * - 'unavailable'     : harness 网关探测失败
 * - 'unknown'         : 启动后尚未探测
 */
function buildHarnessState(overrides: Partial<AdvisorConnectionStatus> = {}): AdvisorConnectionStatus {
  const base: AdvisorConnectionStatus = {
    connected: Boolean(harnessLastSession),
    mode: harnessLastSession ? "harness" : "unavailable",
    label: harnessLastSession ? "受限隔离执行器已就绪" : "本地执行器",
    detail: harnessLastSession ? harnessLastSession.message : "Codex app-server · 本机模型代理"
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
        threadId: executionThreadId
      });
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
    const threadResponse =
      preparedThreadResponse ??
      ((await appServer.request(
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
      )) as Record<string, unknown>);

    if (!isRecord(threadResponse.thread) || typeof threadResponse.thread.id !== "string") {
      throw new Error("Codex 未返回有效对话线程。");
    }
    await setStoredThreadId(taskId, threadResponse.thread.id);

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

    const textInput = { type: "text", text: request.message, text_elements: [] };
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
      effort: "high",
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

  ipcMain.handle("advisor:connection:status", async () => {
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
   * - 成功：emit harness 状态,返回会话
   * - 失败：emit unavailable,抛出 ADVISOR_HARNESS_UNAVAILABLE 错误供渲染层降级
   */
  ipcMain.handle("advisor:connect", async () => {
    try {
      const session = await harnessClient.connect();
      harnessLastSession = session;
      const state = buildHarnessState();
      emitHarnessState(state);
      return session;
    } catch (error) {
      harnessLastSession = null;
      const message = error instanceof Error ? error.message : String(error);
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
  await Promise.all([appServer.stop(), stopManagedProxy(), harnessClient.disconnect()]);
  harnessLastSession = null;
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
