import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";

export type StoredTaskEvent = {
  at: string;
  type: string;
  payload: unknown;
};

export type StoredTask = {
  id: string;
  title: string;
  message: string;
  model: string;
  permissionMode?: "ask" | "agent" | "fullAccess";
  codexThreadId?: string;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: "running" | "waitingApproval" | "completed" | "stopped" | "failed";
  pendingApprovalCount?: number;
  failureReason?: string;
  usage?: unknown;
  activeBranchId?: string;
  branches?: StoredTaskBranch[];
  events: StoredTaskEvent[];
};

export type StoredTaskBranch = {
  id: string;
  parentBranchId?: string;
  forkRequestId?: string;
  replacesRequestId?: string;
  threadId?: string;
  /**
   * 分支创建/最近一次写入时绑定的 model。turn/start 实际生效的 model 不一定等于
   * 这里(turn 可临时覆盖),但 provider 由 thread 决定,所以 model/providerId 主要
   * 用于回答“当前分支用的是什么 provider”以决定是否需要自动 fork。
   */
  model?: string;
  providerId?: string;
  createdAt: string;
};

const dataRoot = path.join(app.getPath("userData"), "advisor");
const sessionsRoot = path.join(dataRoot, "sessions");
const mutationQueues = new Map<string, Promise<void>>();

export async function createStoredTask(input: {
  id: string;
  message: string;
  model: string;
  permissionMode: "ask" | "agent" | "fullAccess";
  workspacePath: string;
}) {
  const now = new Date().toISOString();
  const task: StoredTask = {
    id: input.id,
    title: input.message.replace(/\s+/g, " ").trim().slice(0, 60) || "未命名任务",
    message: input.message,
    model: input.model,
    permissionMode: input.permissionMode,
    workspacePath: input.workspacePath,
    createdAt: now,
    updatedAt: now,
    status: "running",
    activeBranchId: "main",
    branches: [{ id: "main", createdAt: now }],
    events: [
      {
        at: now,
        type: "userMessage",
        payload: {
          requestId: input.id,
          text: input.message,
          branchId: "main"
        }
      }
    ]
  };
  await writeTask(task);
  return task;
}

export async function beginStoredTurn(
  taskId: string,
  input: {
    requestId: string;
    message: string;
    model: string;
    permissionMode: "ask" | "agent" | "fullAccess";
    branchId?: string;
    replacesRequestId?: string;
  }
) {
  await mutateTask(taskId, (task) => {
    task.status = "running";
    task.pendingApprovalCount = 0;
    task.failureReason = undefined;
    task.completedAt = undefined;
    task.model = input.model;
    task.permissionMode = input.permissionMode;
    task.updatedAt = new Date().toISOString();
    task.events.push({
      at: task.updatedAt,
      type: "userMessage",
      payload: {
        requestId: input.requestId,
        text: input.message,
        branchId: input.branchId ?? task.activeBranchId ?? "main",
        replacesRequestId: input.replacesRequestId
      }
    });
  });
}

export async function setStoredThreadId(
  taskId: string,
  threadId: string,
  binding?: { model?: string; providerId?: string }
) {
  await mutateTask(taskId, (task) => {
    task.codexThreadId = threadId;
    const branchId = task.activeBranchId ?? "main";
    const branches = ensureBranches(task);
    const branch = branches.find((item) => item.id === branchId);
    if (branch) {
      branch.threadId = threadId;
      // 只在调用方明确提供时才覆盖,避免用空值污染已有绑定。
      if (binding?.model) branch.model = binding.model;
      if (binding?.providerId) branch.providerId = binding.providerId;
    }
    task.updatedAt = new Date().toISOString();
  });
}

/**
 * 清除 task 上的 codexThreadId 及当前活跃分支的 threadId。
 * 场景：Codex app-server 重启/被清理后，thread/resume 失败，需要在干净状态下重新 thread/start。
 * 历史消息仍保留在 events 中，但后续对话将从新线程开始（上下文已断开）。
 */
export async function clearStoredThreadId(taskId: string) {
  await mutateTask(taskId, (task) => {
    task.codexThreadId = undefined;
    const branchId = task.activeBranchId ?? "main";
    const branches = ensureBranches(task);
    const branch = branches.find((item) => item.id === branchId);
    if (branch) branch.threadId = undefined;
    task.updatedAt = new Date().toISOString();
  });
}

export async function createStoredBranch(
  taskId: string,
  input: {
    id: string;
    parentBranchId: string;
    forkRequestId: string;
    replacesRequestId: string;
    threadId: string;
    model?: string;
    providerId?: string;
  }
) {
  await mutateTask(taskId, (task) => {
    const branches = ensureBranches(task);
    if (branches.some((branch) => branch.id === input.id)) {
      throw new Error("分支编号重复。");
    }
    branches.push({
      ...input,
      createdAt: new Date().toISOString()
    });
    task.activeBranchId = input.id;
    task.codexThreadId = input.threadId;
    task.updatedAt = new Date().toISOString();
  });
}

export async function selectStoredBranch(taskId: string, branchId: string) {
  let selected: StoredTask | null = null;
  await mutateTask(taskId, (task) => {
    const branch = ensureBranches(task).find((item) => item.id === branchId);
    if (!branch) throw new Error("对话分支不存在。");
    if (!branch.threadId) throw new Error("对话分支尚未建立执行线程。");
    task.activeBranchId = branch.id;
    task.codexThreadId = branch.threadId;
    task.updatedAt = new Date().toISOString();
    selected = task;
  });
  return selected;
}

export async function appendStoredEvent(
  taskId: string,
  type: string,
  payload: unknown
) {
  await mutateTask(taskId, (task) => {
    task.events.push({
      at: new Date().toISOString(),
      type,
      payload: redactSensitive(payload)
    });
    task.updatedAt = new Date().toISOString();
  });
}

function ensureBranches(task: StoredTask) {
  if (!task.branches?.length) {
    task.branches = [
      {
        id: "main",
        threadId: task.codexThreadId,
        createdAt: task.createdAt
      }
    ];
  }
  task.activeBranchId ??= "main";
  return task.branches;
}

export async function finishStoredTask(
  taskId: string,
  status: StoredTask["status"],
  details?: { failureReason?: string; usage?: unknown }
) {
  await mutateTask(taskId, (task) => {
    const completedAt = new Date();
    task.status = status;
    task.completedAt = completedAt.toISOString();
    task.updatedAt = task.completedAt;
    task.durationMs = Math.max(
      0,
      completedAt.getTime() - new Date(task.createdAt).getTime()
    );
    task.failureReason = details?.failureReason
      ? redactText(details.failureReason)
      : undefined;
    if (details?.usage) task.usage = redactSensitive(details.usage);
  });
}

export async function updateStoredUsage(taskId: string, usage: unknown) {
  await mutateTask(taskId, (task) => {
    task.usage = redactSensitive(usage);
    task.updatedAt = new Date().toISOString();
  });
}

export async function updateStoredTaskStatus(
  taskId: string,
  status: StoredTask["status"],
  pendingApprovalCount = 0
) {
  await mutateTask(taskId, (task) => {
    task.status = status;
    task.pendingApprovalCount = pendingApprovalCount;
    task.updatedAt = new Date().toISOString();
  });
}

export async function recoverInterruptedTasks() {
  const tasks = await listStoredTasks();
  await Promise.all(
    tasks
      .filter(
        (task) =>
          task.status === "running" || task.status === "waitingApproval"
      )
      .map((task) =>
        finishStoredTask(task.id, "stopped", {
          failureReason: "应用退出时任务尚未完成。"
        })
      )
  );
}

export async function listStoredTasks() {
  await fs.mkdir(sessionsRoot, { recursive: true, mode: 0o700 });
  const entries = await fs.readdir(sessionsRoot, { withFileTypes: true });
  const tasks = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => readStoredTask(entry.name.slice(0, -5)))
  );
  return tasks
    .filter((task): task is StoredTask => Boolean(task))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function readStoredTask(taskId: string) {
  validateTaskId(taskId);
  try {
    return JSON.parse(
      await fs.readFile(taskPath(taskId), "utf8")
    ) as StoredTask;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function exportStoredTask(taskId: string, destination: string) {
  const task = await readStoredTask(taskId);
  if (!task) throw new Error("任务记录不存在。");
  const report = [
    `# ${task.title}`,
    "",
    `- 任务编号：${task.id}`,
    `- 状态：${task.status}`,
    `- 模型：${task.model}`,
    `- 权限：${permissionLabel(task.permissionMode)}`,
    `- 项目：${task.workspacePath}`,
    `- 开始：${task.createdAt}`,
    `- 结束：${task.completedAt ?? "未结束"}`,
    `- 执行时间：${task.durationMs ?? 0} ms`,
    `- 用量：${task.usage ? JSON.stringify(task.usage) : "未返回"}`,
    `- 失败原因：${task.failureReason ?? "无"}`,
    "",
    "## 用户任务",
    "",
    task.message,
    "",
    "## 运行记录",
    "",
    ...task.events.flatMap((event) => [
      `### ${event.at} · ${event.type}`,
      "",
      "```json",
      JSON.stringify(event.payload, null, 2),
      "```",
      ""
    ])
  ].join("\n");
  await fs.writeFile(destination, redactText(report), { mode: 0o600 });
}

function permissionLabel(mode: StoredTask["permissionMode"]) {
  if (mode === "ask") return "请求批准";
  if (mode === "fullAccess") return "完全访问权限";
  return "替我批准";
}

export async function renameStoredTask(taskId: string, title: string) {
  const normalized = title.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!normalized) throw new Error("任务名称不能为空。");
  await mutateTask(taskId, (task) => {
    task.title = normalized;
    task.updatedAt = new Date().toISOString();
  });
  return readStoredTask(taskId);
}

export async function deleteStoredTask(taskId: string) {
  const task = await readStoredTask(taskId);
  if (!task) return false;
  if (task.status === "running" || task.status === "waitingApproval") {
    throw new Error("进行中的任务不能删除。");
  }
  await fs.unlink(taskPath(taskId));
  return true;
}

function taskPath(taskId: string) {
  validateTaskId(taskId);
  return path.join(sessionsRoot, `${taskId}.json`);
}

async function writeTask(task: StoredTask) {
  await fs.mkdir(sessionsRoot, { recursive: true, mode: 0o700 });
  const target = taskPath(task.id);
  const temporary = `${target}.tmp`;
  await fs.writeFile(
    temporary,
    JSON.stringify(redactSensitive(task), null, 2),
    { mode: 0o600 }
  );
  await fs.rename(temporary, target);
}

async function mutateTask(
  taskId: string,
  mutate: (task: StoredTask) => void
) {
  const previous = mutationQueues.get(taskId) ?? Promise.resolve();
  const next = previous.then(async () => {
    const task = await readStoredTask(taskId);
    if (!task) return;
    mutate(task);
    await writeTask(task);
  });
  mutationQueues.set(taskId, next);
  try {
    await next;
  } finally {
    if (mutationQueues.get(taskId) === next) mutationQueues.delete(taskId);
  }
}

function validateTaskId(taskId: string) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(taskId)) {
    throw new Error("任务编号无效。");
  }
}

function redactSensitive(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        /^(?:api[-_]?key|authorization|token|access[-_]?token|refresh[-_]?token|secret|password)$/i.test(
          key
        )
          ? "[REDACTED]"
          : redactSensitive(child)
      ])
    );
  }
  return value;
}

function redactText(value: string) {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[REDACTED_API_KEY]")
    .replace(
      /(authorization\s*[:=]\s*bearer\s+)[^\s"'`]+/gi,
      "$1[REDACTED]"
    )
    .replace(
      /((?:api[-_]?key|token|secret|password)\s*[:=]\s*)[^\s,;"'`]+/gi,
      "$1[REDACTED]"
    );
}
