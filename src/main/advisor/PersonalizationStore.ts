import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { listStoredTasks, type StoredTask } from "./SessionStore";

export type Personality =
  | "pragmatic"
  | "concise"
  | "friendly"
  | "professional";

export type PersonalizationSettings = {
  personality: Personality;
  customInstructions: string;
  memoryEnabled: boolean;
  toolMemoryEnabled: boolean;
  memoryResetAt?: string;
};

export type PersonalizationState = {
  settings: PersonalizationSettings;
  memoryCount: number;
};

const dataRoot = path.join(app.getPath("userData"), "advisor");
const settingsPath = path.join(dataRoot, "personalization.json");
const defaultSettings: PersonalizationSettings = {
  personality: "pragmatic",
  customInstructions: `处理任务时遵循以下原则：
1.不擅自假设。先检查现有文件、配置和上下文；只有关键歧义会影响改变结果时才询问我。
2.简洁优先。只实现我要求的内容，不添加未经要求的功能、抽象、配置或扩展。
3.精准修改。只修改与当前任务直接相关的内容，不随手重构、格式化或删除无关代码。
4.目标驱动。开始前明确成功标准，完成后实际测试或检查结果，不要只说“应该可用”。
5.简单任务直接完成；发现更简单、更安全的方法时，说明理由和取舍。
6.保留现有风格、目录结构和业务约束，明确说明尚未验证的风险。`,
  memoryEnabled: true,
  toolMemoryEnabled: true
};

const personalityInstructions: Record<Personality, string> = {
  pragmatic: "Use a pragmatic, direct tone. Lead with the outcome and concrete next action.",
  concise: "Be concise and avoid unnecessary background unless it affects the result.",
  friendly: "Use a warm, collaborative tone while remaining technically precise.",
  professional: "Use a structured, professional tone with clear risks and verification results."
};

export async function getPersonalizationState(): Promise<PersonalizationState> {
  const settings = await readPersonalizationSettings();
  const memoryCount = settings.memoryEnabled
    ? (await eligibleTasks(settings)).length
    : 0;
  return { settings, memoryCount };
}

export async function readPersonalizationSettings() {
  try {
    const stored = JSON.parse(
      await fs.readFile(settingsPath, "utf8")
    ) as Partial<PersonalizationSettings>;
    return normalizeSettings(stored);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { ...defaultSettings };
  }
}

export async function savePersonalizationSettings(
  input: Partial<PersonalizationSettings>
) {
  const current = await readPersonalizationSettings();
  const settings = normalizeSettings({ ...current, ...input });
  await writeSettings(settings);
  return getPersonalizationState();
}

export async function resetPersonalizationMemory() {
  const current = await readPersonalizationSettings();
  await writeSettings({
    ...current,
    memoryResetAt: new Date().toISOString()
  });
  return getPersonalizationState();
}

export function personalizationInstructions(
  settings: PersonalizationSettings
) {
  return [
    personalityInstructions[settings.personality],
    settings.customInstructions.trim()
      ? `User custom instructions:\n${settings.customInstructions.trim()}`
      : "",
    settings.memoryEnabled
      ? "Application-provided local memory may be included. Use it when relevant, but prefer the current request and current workspace evidence when they conflict."
      : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function buildLocalMemoryContext(
  workspacePath: string,
  settings: PersonalizationSettings,
  excludeTaskId?: string,
  currentMessage = ""
) {
  if (!settings.memoryEnabled) return null;
  const tasks = (await eligibleTasks(settings))
    .filter(
      (task) =>
        task.workspacePath === workspacePath && task.id !== excludeTaskId
    )
    .sort(
      (left, right) =>
        relevanceScore(right, currentMessage) -
        relevanceScore(left, currentMessage)
    )
    .slice(0, 4);
  if (tasks.length === 0) return null;

  const entries = tasks.map((task) => {
    const answer = boundedMemoryText(extractAssistantText(task));
    const evidence = settings.toolMemoryEnabled
      ? extractToolEvidence(task).slice(0, 12)
      : [];
    return {
      completedAt: task.completedAt ?? task.updatedAt,
      title: task.title,
      userRequest: task.message.slice(0, 1600),
      assistantResult: answer || "No final assistant text was recorded.",
      evidence
    };
  });

  return {
    instruction:
      "These are recent completed tasks from the same local project. Use them only as relevant continuity context. Do not claim a remembered fact if it is absent here.",
    entries
  };
}

function boundedMemoryText(text: string) {
  if (text.length <= 5000) return text;
  return `${text.slice(0, 2500)}\n\n[中间内容因记忆预算省略]\n\n${text.slice(-2500)}`;
}

function relevanceScore(task: StoredTask, message: string) {
  const terms = [...new Set(message.match(/[\p{L}\p{N}]{2,}/gu) ?? [])];
  const haystack = `${task.title}\n${task.message}\n${extractAssistantText(task)}`;
  return terms.reduce(
    (score, term) => score + (haystack.includes(term) ? 1 : 0),
    0
  );
}

async function eligibleTasks(settings: PersonalizationSettings) {
  const resetAt = settings.memoryResetAt ?? "";
  return (await listStoredTasks()).filter(
    (task) =>
      task.status === "completed" &&
      (!resetAt || (task.completedAt ?? task.updatedAt) > resetAt)
  );
}

function extractAssistantText(task: StoredTask) {
  return task.events
    .filter((event) => event.type === "delta")
    .map((event) => {
      const payload = event.payload as { text?: unknown };
      return typeof payload?.text === "string" ? payload.text : "";
    })
    .join("");
}

function extractToolEvidence(task: StoredTask) {
  return task.events
    .filter((event) => event.type === "activity")
    .map((event) => {
      const payload = event.payload as {
        activity?: { kind?: unknown; title?: unknown; state?: unknown };
      };
      const activity = payload?.activity;
      if (!activity || typeof activity.title !== "string") return null;
      return {
        kind: typeof activity.kind === "string" ? activity.kind : "status",
        title: activity.title,
        state: typeof activity.state === "string" ? activity.state : undefined
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function normalizeSettings(
  input: Partial<PersonalizationSettings>
): PersonalizationSettings {
  const personality: Personality =
    input.personality === "concise" ||
    input.personality === "friendly" ||
    input.personality === "professional"
      ? input.personality
      : "pragmatic";
  return {
    personality,
    customInstructions:
      typeof input.customInstructions === "string"
        ? input.customInstructions.slice(0, 8000)
        : "",
    memoryEnabled: input.memoryEnabled !== false,
    toolMemoryEnabled: input.toolMemoryEnabled !== false,
    memoryResetAt:
      typeof input.memoryResetAt === "string"
        ? input.memoryResetAt
        : undefined
  };
}

async function writeSettings(settings: PersonalizationSettings) {
  await fs.mkdir(dataRoot, { recursive: true, mode: 0o700 });
  const temporary = `${settingsPath}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(settings, null, 2), {
    mode: 0o600
  });
  await fs.rename(temporary, settingsPath);
}
