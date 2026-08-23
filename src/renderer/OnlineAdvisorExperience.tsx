import {
  type ClipboardEvent,
  type DragEvent,
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  AdvisorApprovalDecision as ApprovalDecision,
  AdvisorApprovalPrompt as ApprovalPrompt,
  AdvisorAttachment as AttachmentRecord,
  AdvisorConnectionStatus as ConnectionStatus,
  AdvisorPermissionMode as PermissionMode,
  AdvisorPersonalizationSettings as PersonalizationSettings,
  AdvisorPersonalizationState as PersonalizationState,
  AdvisorStoredTask as StoredTask,
  AdvisorTaskStatus as TaskStatus,
  AdvisorVisionAnalysis as VisionAnalysis
} from "../shared/advisor";

type ModelId = string;

type MessageTaskStatus = {
  status: TaskStatus;
  label: string;
  detail?: string;
  pendingApprovalCount: number;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  state?: "streaming" | "stopped" | "error";
  taskStatus?: MessageTaskStatus;
  activities?: Array<{
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
  }>;
  attachments?: AttachmentRecord[];
  createdAt?: string;
  turnId?: string;
  branchId?: string;
  replacesRequestId?: string;
  branchOptions?: Array<{ id: string; label: string }>;
  activeBranchIndex?: number;
};

type MessageEditState = {
  requestId: string;
  sourceRequestId: string;
  sourceBranchId: string;
  beforeTurnId: string;
  text: string;
  attachments: AttachmentRecord[];
};

type ImagePreviewState = {
  attachments: AttachmentRecord[];
  index: number;
  url?: string;
  error?: string;
  analysis?: VisionAnalysis;
  analysisLoading?: boolean;
  analysisError?: string;
  showAnnotations: boolean;
};

type ProjectGroup = {
  id: string;
  path: string;
  name: string;
  tasks: StoredTask[];
};

type RegisteredProject = {
  id: string;
  path: string;
  name: string;
  createdAt: number;
};

const expandedProjectsStorageKey = "deepseek-codex.expanded-projects";
const preferredModelStorageKey = "deepseek-codex.preferred-model";
const preferredPermissionStorageKey = "deepseek-codex.preferred-permission";
const projectAliasesStorageKey = "deepseek-codex.project-aliases";
const registeredProjectsStorageKey = "deepseek-codex.registered-projects";
const hiddenProjectsStorageKey = "deepseek-codex.hidden-projects";
const hiddenTasksStorageKey = "deepseek-codex.hidden-tasks";

const modelOptions: Array<{ id: ModelId; name: string; hint: string }> = [
  { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash", hint: "更快" },
  { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro", hint: "更强" },
  { id: "chat-latest", name: "OpenAI ChatGPT Latest", hint: "ChatGPT" }
];
const permissionOptions: Array<{
  id: PermissionMode;
  name: string;
  hint: string;
}> = [
  {
    id: "ask",
    name: "请求批准",
    hint: "访问项目外文件和执行风险操作时询问"
  },
  {
    id: "agent",
    name: "替我批准",
    hint: "仅对检测到的风险操作请求批准"
  },
  {
    id: "fullAccess",
    name: "完全访问权限",
    hint: "可不受限制地访问互联网和电脑上的文件"
  }
];

export default function OnlineAdvisorExperience() {
  const [workspacePath, setWorkspacePath] = useState("");
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const [model, setModel] = useState<ModelId>(() => readPreferredModel());
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(() =>
    readPreferredPermission()
  );
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionStatus>({
    connected: false,
    mode: "unknown",
    label: "检查中",
    detail: ""
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<ApprovalPrompt[]>([]);
  const [attachments, setAttachments] = useState<AttachmentRecord[]>([]);
  const [attachmentSessionId, setAttachmentSessionId] = useState<string | null>(
    null
  );
  const attachmentSessionRef = useRef<string | null>(null);
  const openTaskSequenceRef = useRef(0);
  const [imageError, setImageError] = useState("");
  const [imagePreview, setImagePreview] =
    useState<ImagePreviewState | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [history, setHistory] = useState<StoredTask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<string[]>(() =>
    readExpandedProjectIds()
  );
  const [projectAliases, setProjectAliases] = useState<Record<string, string>>(
    () => readStoredRecord(projectAliasesStorageKey)
  );
  const [registeredProjects, setRegisteredProjects] = useState<
    RegisteredProject[]
  >(() => readRegisteredProjects());
  const [hiddenProjectIds, setHiddenProjectIds] = useState<string[]>(() =>
    readStoredStringList(hiddenProjectsStorageKey)
  );
  const [hiddenTaskIds, setHiddenTaskIds] = useState<string[]>(() =>
    readStoredStringList(hiddenTasksStorageKey)
  );
  const [openManagementMenu, setOpenManagementMenu] = useState<string | null>(
    null
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [exportNotice, setExportNotice] = useState("");
  const [personalizationOpen, setPersonalizationOpen] = useState(false);
  const [personalization, setPersonalization] =
    useState<PersonalizationState | null>(null);
  const [personalizationDraft, setPersonalizationDraft] =
    useState<PersonalizationSettings | null>(null);
  const [personalizationNotice, setPersonalizationNotice] = useState("");
  const [messageEdit, setMessageEdit] = useState<MessageEditState | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const isBusy = activeRequestId !== null;
  const selectedProjectName = useMemo(
    () => {
      if (!workspacePath) return "";
      const projectId = projectIdForPath(workspacePath);
      return projectAliases[projectId] || projectNameForPath(workspacePath);
    },
    [projectAliases, workspacePath]
  );
  const selectedTaskTitle = useMemo(
    () => history.find((task) => task.id === selectedTaskId)?.title,
    [history, selectedTaskId]
  );
  const selectedTaskModel = useMemo(() => {
    const storedModel = history.find((task) => task.id === selectedTaskId)?.model;
    return modelOptions.find((option) => option.id === storedModel);
  }, [history, selectedTaskId]);
  const projectGroups = useMemo(
    () =>
      groupTasksByProject(history, registeredProjects)
        .filter((project) => !hiddenProjectIds.includes(project.id))
        .map((project) => ({
          ...project,
          name: projectAliases[project.id] || project.name,
          tasks: project.tasks.filter((task) => !hiddenTaskIds.includes(task.id))
        })),
    [
      history,
      hiddenProjectIds,
      hiddenTaskIds,
      projectAliases,
      registeredProjects
    ]
  );
  const filteredProjectGroups = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return projectGroups;
    return projectGroups
      .map((project) => {
        const projectMatches = `${project.name} ${project.path}`
          .toLocaleLowerCase()
          .includes(query);
        return {
          ...project,
          projectMatches,
          tasks: projectMatches
            ? project.tasks
            : project.tasks.filter((task) =>
                `${task.title} ${task.message}`
                  .toLocaleLowerCase()
                  .includes(query)
              )
        };
      })
      .filter((project) => project.projectMatches || project.tasks.length > 0);
  }, [projectGroups, searchQuery]);
  const selectedModel = useMemo(
    () => modelOptions.find((option) => option.id === model) ?? modelOptions[0],
    [model]
  );
  const selectedPermission = useMemo(
    () =>
      permissionOptions.find((option) => option.id === permissionMode) ??
      permissionOptions[1],
    [permissionMode]
  );

  useEffect(() => {
    if (workspacePath) expandProject(projectIdForPath(workspacePath));
  }, [workspacePath]);

  useEffect(() => {
    if (isBusy) {
      setModelMenuOpen(false);
      setPermissionMenuOpen(false);
    }
  }, [isBusy]);

  useEffect(() => {
    if (!messageEdit) return;
    const frame = window.requestAnimationFrame(() => {
      draftRef.current
        ?.closest(".app-shell")
        ?.querySelector(".message-editor")
        ?.scrollIntoView({ block: "end", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messageEdit?.requestId]);

  useEffect(() => {
    void window.desktop.advisor.getConnectionStatus().then(setConnection);
    void window.desktop.advisor.getPersonalization().then(setPersonalization);
    void refreshHistory(true);
    const dispose = window.desktop.advisor.onChatEvent((event) => {
      if (event.type === "approval") {
        setApprovals((current) => [...current, event.approval]);
      } else if (event.type === "approvalResolved") {
        setApprovals((current) =>
          current.filter((approval) => approval.id !== event.approvalId)
        );
      }
      setMessages((current) =>
        current.map((message) => {
          if (
            event.type === "turnStarted" &&
            message.id === `${event.requestId}:user`
          ) {
            return { ...message, turnId: event.turnId };
          }
          if (message.id !== event.requestId) return message;
          if (event.type === "delta") {
            return { ...message, text: message.text + event.text };
          }
          if (event.type === "activity") {
            return {
              ...message,
              activities: [...(message.activities ?? []), event.activity]
            };
          }
          if (event.type === "taskStatus") {
            return {
              ...message,
              taskStatus: {
                status: event.status,
                label: event.label,
                detail: event.detail,
                pendingApprovalCount: event.pendingApprovalCount
              }
            };
          }
          if (event.type === "stopped") {
            return {
              ...message,
              state: "stopped",
              text: message.text || "已停止生成。"
            };
          }
          if (event.type === "error") {
            return { ...message, state: "error", text: event.message };
          }
          if (
            event.type === "approval" ||
            event.type === "approvalResolved" ||
            event.type === "turnStarted"
          ) {
            return message;
          }
          return { ...message, state: undefined };
        })
      );
      if (
        event.type === "done" ||
        event.type === "stopped" ||
        event.type === "error"
      ) {
        setActiveRequestId(null);
        setApprovals((current) =>
          current.filter((approval) => approval.requestId !== event.requestId)
        );
        window.setTimeout(() => void refreshHistory(), 100);
      }
    });
    return dispose;
  }, []);

  async function refreshHistory(restoreLatest = false) {
    const tasks = await window.desktop.advisor.listSessions();
    setHistory(tasks);
    if (restoreLatest && tasks[0]) openStoredTask(tasks[0]);
  }

  function openStoredTask(task: StoredTask) {
    const openSequence = ++openTaskSequenceRef.current;
    setMessageEdit(null);
    const assistant: Message = {
      id: task.id,
      role: "assistant",
      text: "",
      state:
        task.status === "failed"
          ? "error"
          : task.status === "stopped"
            ? "stopped"
            : undefined,
      taskStatus: storedTaskStatus(task),
      activities: []
    };
    for (const event of task.events) {
      const payload = event.payload as Partial<{
        type: string;
        text: string;
        message: string;
        activity: NonNullable<Message["activities"]>[number];
        approval: ApprovalPrompt;
        decision: ApprovalDecision;
        status: TaskStatus;
        label: string;
        detail: string;
        turnId: string;
        pendingApprovalCount: number;
      }>;
      if (event.type === "delta" && typeof payload.text === "string") {
        assistant.text += payload.text;
      } else if (event.type === "activity" && payload.activity) {
        assistant.activities?.push(payload.activity);
      } else if (
        event.type === "taskStatus" &&
        payload.status &&
        payload.label
      ) {
        assistant.taskStatus = {
          status: payload.status,
          label: payload.label,
          detail: payload.detail,
          pendingApprovalCount: payload.pendingApprovalCount ?? 0
        };
      } else if (event.type === "approval" && payload.approval) {
        assistant.activities?.push({
          kind: payload.approval.kind,
          title: payload.approval.title,
          detail: payload.approval.diff || payload.approval.detail,
          state: "等待审批"
        });
      } else if (event.type === "approvalDecision") {
        assistant.activities?.push({
          kind: "status",
          title: "审批记录",
          detail: String(payload.decision ?? ""),
          state: "resolved"
        });
      } else if (event.type === "error" && typeof payload.message === "string") {
        assistant.text = payload.message;
      } else if (event.type === "turnStarted") {
        assistant.turnId = payload.turnId;
      }
    }
    if (!assistant.text) {
      assistant.text =
        task.status === "running" || task.status === "waitingApproval"
          ? task.status === "waitingApproval"
            ? "任务正在等待审批。"
            : "任务尚未完成。"
          : "该任务没有最终回复。";
    }
    setSelectedTaskId(task.id);
    setWorkspacePath(task.workspacePath);
    expandProject(projectIdForPath(task.workspacePath));
    if (allowedStoredModel(task.model)) setModel(task.model);
    setPermissionMode(task.permissionMode ?? "agent");
    setModelMenuOpen(false);
    setPermissionMenuOpen(false);
    const restoredMessages =
      restoreConversationMessages(task) ?? [
        { id: `${task.id}:user`, role: "user", text: task.message },
        assistant
      ];
    setMessages(restoredMessages);
    void hydrateConversationAttachments(restoredMessages).then((hydrated) => {
      if (openTaskSequenceRef.current === openSequence) setMessages(hydrated);
    });
    setSearchQuery("");
    setSearchOpen(false);
    setExportNotice("");
  }

  function expandProject(projectId: string) {
    setExpandedProjectIds((current) => {
      if (current.includes(projectId)) return current;
      const next = [...current, projectId];
      saveExpandedProjectIds(next);
      return next;
    });
  }

  function toggleProject(projectId: string) {
    setExpandedProjectIds((current) => {
      const next = current.includes(projectId)
        ? current.filter((id) => id !== projectId)
        : [...current, projectId];
      saveExpandedProjectIds(next);
      return next;
    });
  }

  function newTaskForProject(project: ProjectGroup) {
    resetTaskState();
    setWorkspacePath(project.path);
    registerProject(project.path);
    expandProject(project.id);
    setOpenManagementMenu(null);
    focusDraft();
  }

  function renameProject(project: ProjectGroup) {
    const title = window.prompt("项目显示名称", project.name)?.trim();
    if (!title) return;
    const next = { ...projectAliases, [project.id]: title.slice(0, 60) };
    setProjectAliases(next);
    saveStoredValue(projectAliasesStorageKey, next);
    setOpenManagementMenu(null);
  }

  function hideProject(project: ProjectGroup) {
    const next = [...new Set([...hiddenProjectIds, project.id])];
    setHiddenProjectIds(next);
    saveStoredValue(hiddenProjectsStorageKey, next);
    if (normalizedProjectPath(workspacePath) === project.path) resetTaskState();
    setOpenManagementMenu(null);
  }

  async function renameTask(task: StoredTask) {
    const title = window.prompt("对话名称", task.title)?.trim();
    if (!title) return;
    const updated = await window.desktop.advisor.renameSession(task.id, title);
    if (updated) {
      setHistory((current) =>
        current.map((item) => (item.id === updated.id ? updated : item))
      );
    }
    setOpenManagementMenu(null);
  }

  function hideTask(task: StoredTask) {
    const next = [...new Set([...hiddenTaskIds, task.id])];
    setHiddenTaskIds(next);
    saveStoredValue(hiddenTasksStorageKey, next);
    if (selectedTaskId === task.id) resetTaskState();
    setOpenManagementMenu(null);
  }

  async function deleteTask(task: StoredTask) {
    if (!window.confirm(`永久删除对话“${task.title}”？此操作无法撤销。`)) return;
    await window.desktop.advisor.deleteSession(task.id);
    if (selectedTaskId === task.id) resetTaskState();
    await refreshHistory();
    setOpenManagementMenu(null);
  }

  function restoreHiddenItems() {
    setHiddenProjectIds([]);
    setHiddenTaskIds([]);
    saveStoredValue(hiddenProjectsStorageKey, []);
    saveStoredValue(hiddenTasksStorageKey, []);
  }

  async function exportTask(taskId: string) {
    const exported = await window.desktop.advisor.exportSession(taskId);
    setExportNotice(exported ? `已导出：${exported}` : "");
  }

  async function chooseProject() {
    const selected = await window.desktop.advisor.selectProject();
    if (!selected) return;
    setWorkspacePath(selected);
    registerProject(selected);
    expandProject(projectIdForPath(selected));
    focusDraft();
  }

  async function createNewTask() {
    const selected = await window.desktop.advisor.selectProject();
    if (!selected) return;
    resetTaskState();
    setWorkspacePath(selected);
    registerProject(selected);
    expandProject(projectIdForPath(selected));
    focusDraft();
  }

  function resetTaskState() {
    openTaskSequenceRef.current += 1;
    setMessages([]);
    setSelectedTaskId(null);
    setModel(readPreferredModel());
    setPermissionMode(readPreferredPermission());
    setModelMenuOpen(false);
    setPermissionMenuOpen(false);
    setApprovals([]);
    setExportNotice("");
    setDraft("");
    setAttachments([]);
    setAttachmentSessionId(null);
    attachmentSessionRef.current = null;
    setImageError("");
    setMessageEdit(null);
    setSearchQuery("");
    setSearchOpen(false);
  }

  function registerProject(projectPath: string) {
    const normalizedPath = normalizedProjectPath(projectPath);
    const id = projectIdForPath(normalizedPath);
    setRegisteredProjects((current) => {
      if (current.some((project) => project.id === id)) return current;
      const next = [
        ...current,
        {
          id,
          path: normalizedPath,
          name: projectNameForPath(normalizedPath),
          createdAt: Date.now()
        }
      ];
      saveStoredValue(registeredProjectsStorageKey, next);
      return next;
    });
  }

  function focusDraft() {
    window.setTimeout(() => draftRef.current?.focus(), 0);
  }

  function selectPreferredModel(selected: ModelId) {
    setModel(selected);
    window.localStorage.setItem(preferredModelStorageKey, selected);
    setModelMenuOpen(false);
  }

  function selectPreferredPermission(selected: PermissionMode) {
    if (
      selected === "fullAccess" &&
      permissionMode !== "fullAccess" &&
      !window.confirm(
        "完全访问权限允许 DeepSeek 不经询问访问互联网和电脑上的任意文件。确定启用吗？"
      )
    ) {
      return;
    }
    setPermissionMode(selected);
    window.localStorage.setItem(preferredPermissionStorageKey, selected);
    setPermissionMenuOpen(false);
  }

  async function openPersonalization() {
    const state = await window.desktop.advisor.getPersonalization();
    setPersonalization(state);
    setPersonalizationDraft({ ...state.settings });
    setPersonalizationNotice("");
    setPersonalizationOpen(true);
  }

  /**
   * 主动连接 harness gateway。可用则 chip 进入 harness 模式,
   * 不可用则 chip 保持 unavailable 并把错误显示给用户。
   */
  async function connectHarness() {
    setConnection((current) => ({ ...current, label: "连接受限隔离执行器…", detail: "" }));
    try {
      await window.desktop.advisor.connect();
      const status = await window.desktop.advisor.getConnectionStatus();
      setConnection(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : "连接失败";
      setConnection({
        connected: false,
        mode: "unavailable",
        label: "受限隔离执行器不可用",
        detail: message
      });
    }
  }

  /**
   * 主动断开 harness gateway (保留本地 Codex app-server 路径)。
   */
  async function disconnectHarness() {
    try {
      await window.desktop.advisor.disconnect();
    } catch {
      // 断开失败不阻塞 UI 更新
    }
    const status = await window.desktop.advisor.getConnectionStatus();
    setConnection(status);
  }

  async function savePersonalization() {
    if (!personalizationDraft) return;
    const state = await window.desktop.advisor.savePersonalization(
      personalizationDraft
    );
    setPersonalization(state);
    setPersonalizationDraft({ ...state.settings });
    setPersonalizationNotice("");
    setPersonalizationOpen(false);
  }

  async function resetMemory() {
    if (!window.confirm("清除当前记忆基线？历史任务记录不会被删除。")) return;
    const state = await window.desktop.advisor.resetMemory();
    setPersonalization(state);
    setPersonalizationDraft({ ...state.settings });
    setPersonalizationNotice("记忆已重置，历史任务记录仍然保留。");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || !workspacePath) return;
    if (isBusy && activeRequestId) {
      try {
        await window.desktop.advisor.steerChat(activeRequestId, message);
        setDraft("");
        setImageError("");
      } catch (error) {
        setImageError(
          error instanceof Error ? error.message : "补充执行要求失败"
        );
      }
      return;
    }

    const requestId = attachmentSessionRef.current ?? crypto.randomUUID();
    const conversationId = selectedTaskId ?? requestId;
    const submittedAttachments = attachments;
    const turnMessages: Message[] = [
      {
        id: `${requestId}:user`,
        role: "user",
        text: message,
        attachments: submittedAttachments,
        createdAt: new Date().toISOString(),
        branchId:
          history.find((task) => task.id === selectedTaskId)?.activeBranchId ??
          "main"
      },
      {
        id: requestId,
        role: "assistant",
        text: "",
        state: "streaming",
        taskStatus: {
          status: "running",
          label: "正在启动任务",
          pendingApprovalCount: 0
        },
        activities: []
      }
    ];
    setMessages((current) =>
      selectedTaskId ? [...current, ...turnMessages] : turnMessages
    );
    setDraft("");
    setActiveRequestId(requestId);
    setModelMenuOpen(false);
    setPermissionMenuOpen(false);
    setSelectedTaskId(conversationId);
    setAttachments([]);
    setAttachmentSessionId(null);
    attachmentSessionRef.current = null;
    setImageError("");

    try {
      await window.desktop.advisor.sendChat({
        requestId,
        conversationId: selectedTaskId ?? undefined,
        model,
        permissionMode,
        message,
        workspacePath,
      });
    } catch (error) {
      const text = error instanceof Error ? error.message : "发送失败";
      setMessages((current) =>
        current.map((item) =>
          item.id === requestId ? { ...item, state: "error", text } : item
        )
      );
      setActiveRequestId(null);
    }
  }

  async function copyMessage(message: Message) {
    await navigator.clipboard.writeText(message.text);
    setCopiedMessageId(message.id);
    window.setTimeout(
      () => setCopiedMessageId((current) => (current === message.id ? null : current)),
      1500
    );
  }

  async function beginMessageEdit(message: Message) {
    if (isBusy || !message.turnId || !message.id.endsWith(":user")) return;
    const sourceRequestId = message.id.slice(0, -":user".length);
    const requestId = crypto.randomUUID();
    const cloned = await window.desktop.advisor.cloneImages(
      sourceRequestId,
      requestId
    );
    setMessageEdit({
      requestId,
      sourceRequestId,
      sourceBranchId: message.branchId ?? "main",
      beforeTurnId: message.turnId,
      text: message.text,
      attachments: cloned
    });
  }

  async function cancelMessageEdit() {
    if (!messageEdit) return;
    await window.desktop.advisor.discardImages(messageEdit.requestId);
    setMessageEdit(null);
  }

  async function addEditImageFiles(files: File[]) {
    if (!messageEdit) return;
    const images = await Promise.all(
      files
        .filter((file) => file.type.startsWith("image/"))
        .map(async (file) => ({
          name: file.name || `clipboard-${Date.now()}.png`,
          mimeType: file.type || "image/png",
          bytes: new Uint8Array(await file.arrayBuffer())
        }))
    );
    if (images.length === 0) return;
    const saved = await window.desktop.advisor.saveImages(
      messageEdit.requestId,
      images
    );
    setMessageEdit((current) =>
      current ? { ...current, attachments: saved } : current
    );
  }

  async function removeEditImage(id: string) {
    if (!messageEdit) return;
    if (await window.desktop.advisor.removeImage(messageEdit.requestId, id)) {
      setMessageEdit((current) =>
        current
          ? {
              ...current,
              attachments: current.attachments.filter((item) => item.id !== id)
            }
          : current
      );
    }
  }

  async function submitMessageEdit(event: FormEvent) {
    event.preventDefault();
    if (!messageEdit || !selectedTaskId || !workspacePath) return;
    const text = messageEdit.text.trim();
    if (!text) return;
    const replacesRequestId = messageEdit.sourceRequestId;
    const sourceIndex = messages.findIndex(
      (message) => message.id === `${replacesRequestId}:user`
    );
    const turnMessages: Message[] = [
      {
        id: `${messageEdit.requestId}:user`,
        role: "user",
        text,
        attachments: messageEdit.attachments,
        branchId: messageEdit.requestId,
        replacesRequestId,
        createdAt: new Date().toISOString(),
        branchOptions: [
          { id: messageEdit.sourceBranchId, label: "原版本" },
          { id: messageEdit.requestId, label: "编辑版本 1" }
        ],
        activeBranchIndex: 1
      },
      {
        id: messageEdit.requestId,
        role: "assistant",
        text: "",
        state: "streaming",
        taskStatus: {
          status: "running",
          label: "正在创建编辑分支",
          pendingApprovalCount: 0
        },
        activities: []
      }
    ];
    setMessages((current) => [
      ...current.slice(0, Math.max(0, sourceIndex)),
      ...turnMessages
    ]);
    setActiveRequestId(messageEdit.requestId);
    const request = messageEdit;
    setMessageEdit(null);
    await window.desktop.advisor.sendChat({
      requestId: request.requestId,
      conversationId: selectedTaskId,
      model,
      permissionMode,
      message: text,
      workspacePath,
      edit: {
        sourceBranchId: request.sourceBranchId,
        replacesRequestId,
        beforeTurnId: request.beforeTurnId
      }
    });
  }

  async function selectMessageBranch(branchId: string) {
    if (!selectedTaskId || isBusy) return;
    const task = await window.desktop.advisor.selectBranch(selectedTaskId, branchId);
    if (task) await openStoredTask(task);
  }

  async function stop() {
    if (activeRequestId) await window.desktop.advisor.stopChat(activeRequestId);
  }

  async function resolveApproval(
    approvalId: string,
    decision: ApprovalDecision
  ) {
    await window.desktop.advisor.resolveApproval(approvalId, decision);
  }

  function ensureAttachmentSession() {
    if (attachmentSessionRef.current) return attachmentSessionRef.current;
    const sessionId = `task_${crypto.randomUUID().replaceAll("-", "")}`;
    attachmentSessionRef.current = sessionId;
    setAttachmentSessionId(sessionId);
    return sessionId;
  }

  async function chooseImages() {
    if (isBusy) return;
    try {
      setImageError("");
      const records = await window.desktop.advisor.selectImages(
        ensureAttachmentSession()
      );
      setAttachments(records);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "图片上传失败");
    }
  }

  async function addImageFiles(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    try {
      setImageError("");
      const payload = await Promise.all(
        images.map(async (file) => ({
          name: file.name || `clipboard-${Date.now()}.png`,
          mimeType: file.type || "image/png",
          bytes: new Uint8Array(await file.arrayBuffer())
        }))
      );
      const records = await window.desktop.advisor.saveImages(
        ensureAttachmentSession(),
        payload
      );
      setAttachments(records);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : "图片上传失败");
    }
  }

  async function removeImage(id: string) {
    const sessionId = attachmentSessionRef.current;
    if (!sessionId) return;
    if (await window.desktop.advisor.removeImage(sessionId, id)) {
      setAttachments((current) => {
        const next = current.filter((item) => item.id !== id);
        if (next.length === 0) {
          setAttachmentSessionId(null);
          attachmentSessionRef.current = null;
        }
        return next;
      });
    }
  }

  async function openMessageImage(
    messageAttachments: AttachmentRecord[],
    index: number
  ) {
    const attachment = messageAttachments[index];
    if (!attachment) return;
    if (attachment.available === false) {
      setImagePreview({
        attachments: messageAttachments,
        index,
        error: "图片文件已不可用。",
        showAnnotations: false
      });
      return;
    }
    setImagePreview({
      attachments: messageAttachments,
      index,
      analysisLoading: true,
      showAnnotations: false
    });
    try {
      const [url, analyses] = await Promise.all([
        window.desktop.advisor.previewImage(attachment.sessionId, attachment.id),
        window.desktop.advisor.analyzeImages(attachment.sessionId)
      ]);
      setImagePreview({
        attachments: messageAttachments,
        index,
        url,
        analysis: analyses.find((analysis) => analysis.imageId === attachment.id),
        analysisLoading: false,
        showAnnotations: false
      });
    } catch (error) {
      setImagePreview({
        attachments: messageAttachments,
        index,
        analysisLoading: false,
        showAnnotations: false,
        error: error instanceof Error ? error.message : "图片加载失败"
      });
    }
  }

  function stepImagePreview(direction: -1 | 1) {
    if (!imagePreview) return;
    const index =
      (imagePreview.index + direction + imagePreview.attachments.length) %
      imagePreview.attachments.length;
    void openMessageImage(imagePreview.attachments, index);
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDragActive(false);
    void addImageFiles(Array.from(event.dataTransfer.files));
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.some((file) => file.type.startsWith("image/"))) {
      event.preventDefault();
      void addImageFiles(files);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">DS</div>
          <div>
            <h1>DeepSeek Codex</h1>
            <p>桌面智能开发助手</p>
          </div>
        </div>
        <section className="workspace-bar">
          <div className="workspace-copy">
            <span>当前项目</span>
            <strong title={workspacePath}>
              {workspacePath || "尚未选择项目目录"}
            </strong>
          </div>
          <button
            className="secondary-button project-button"
            onClick={chooseProject}
            title={
              workspacePath
                ? `当前项目：${workspacePath}；点击更换项目`
                : "选择项目目录"
            }
            aria-label={
              workspacePath
                ? `当前已选择项目 ${selectedProjectName}，点击更换项目`
                : "选择项目"
            }
          >
            {workspacePath ? `已选：${selectedProjectName}` : "选择项目"}
          </button>
        </section>
        <div className={`connection connection-${connection.mode} ${connection.connected ? "online" : "offline"}`}>
          <span className="status-dot" />
          <div>
            <strong>{connection.label}</strong>
            <small>{connection.detail}</small>
          </div>
          {connection.mode === "harness" ? (
            <button
              type="button"
              className="connection-action"
              onClick={() => void disconnectHarness()}
              title="断开受限隔离执行器,使用本地 Codex app-server"
            >
              断开
            </button>
          ) : (
            <button
              type="button"
              className="connection-action"
              onClick={() => void connectHarness()}
              title="尝试连接受限隔离执行器"
              disabled={connection.mode === "unknown"}
            >
              {connection.mode === "unknown" ? "检查中" : "连接"}
            </button>
          )}
        </div>
      </header>

      <section className="content">
        <aside className="sidebar">
          <div className="sidebar-primary">
            <div className="sidebar-primary-actions">
              <button
                className="new-task-button"
                onClick={() => void createNewTask()}
                disabled={isBusy}
              >
                <span aria-hidden="true">＋</span>
                新建任务
              </button>
              <button
                type="button"
                className={`search-toggle ${searchOpen ? "selected" : ""}`}
                aria-label="搜索项目和对话"
                title="搜索项目和对话"
                onClick={() => {
                  setSearchOpen((current) => !current);
                  if (searchOpen) setSearchQuery("");
                }}
              >
                ⌕
              </button>
            </div>
            {searchOpen && (
              <div className="sidebar-search">
                <span aria-hidden="true">⌕</span>
                <input
                  autoFocus
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setSearchQuery("");
                      setSearchOpen(false);
                    }
                  }}
                  placeholder="搜索项目或对话…"
                  aria-label="搜索项目或对话"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="清空搜索"
                    onClick={() => setSearchQuery("")}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="history-section project-history-section">
            <div className="project-section-heading">
              <span className="section-label">项目</span>
              {(hiddenProjectIds.length > 0 || hiddenTaskIds.length > 0) && (
                <button type="button" onClick={restoreHiddenItems}>
                  恢复隐藏项
                </button>
              )}
            </div>
            <div className="project-list">
              {filteredProjectGroups.length === 0 ? (
                <small>{searchQuery ? "没有匹配结果" : "暂无记录"}</small>
              ) : (
                filteredProjectGroups.map((project) => {
                  const expanded =
                    Boolean(searchQuery.trim()) ||
                    expandedProjectIds.includes(project.id);
                  const current =
                    normalizedProjectPath(workspacePath) === project.path;
                  return (
                    <section
                      className={`project-group ${current ? "current" : ""}`}
                      key={project.id}
                    >
                      <div className="project-group-header">
                        <button
                          type="button"
                          className="project-group-button"
                          onClick={() => toggleProject(project.id)}
                          title={project.path}
                          aria-expanded={expanded}
                        >
                          <span className="project-chevron" aria-hidden="true">
                            {expanded ? "⌄" : "›"}
                          </span>
                          <span className="project-folder" aria-hidden="true">
                            ▱
                          </span>
                          <span className="project-name">
                            <strong>{project.name}</strong>
                            <small>{project.path}</small>
                          </span>
                          <small>{project.tasks.length}</small>
                        </button>
                        <button
                          type="button"
                          className="management-trigger"
                          aria-label={`管理项目 ${project.name}`}
                          onClick={() =>
                            setOpenManagementMenu((currentMenu) =>
                              currentMenu === `project:${project.id}`
                                ? null
                                : `project:${project.id}`
                            )
                          }
                        >
                          ···
                        </button>
                        {openManagementMenu === `project:${project.id}` && (
                          <div className="management-menu project-menu">
                            <button onClick={() => newTaskForProject(project)}>
                              在此项目中新建任务
                            </button>
                            <button
                              onClick={() => {
                                void window.desktop.advisor.revealProject(
                                  project.path
                                );
                                setOpenManagementMenu(null);
                              }}
                            >
                              在访达中显示
                            </button>
                            <button onClick={() => renameProject(project)}>
                              修改显示名称
                            </button>
                            <button onClick={() => hideProject(project)}>
                              从侧边栏隐藏
                            </button>
                          </div>
                        )}
                      </div>
                      {expanded && (
                        <div className="project-task-list">
                          {project.tasks.map((task) => (
                            <div className="project-task-row" key={task.id}>
                              <button
                                className={`project-task-button ${
                                  selectedTaskId === task.id ? "selected" : ""
                                }`}
                                onClick={() => openStoredTask(task)}
                                disabled={isBusy}
                                title={task.title}
                              >
                                <span>{task.title}</span>
                                <small>
                                  {taskStatusLabel(
                                    task.status,
                                    task.pendingApprovalCount
                                  )}{" "}
                                  · {formatDuration(task.durationMs)}
                                </small>
                              </button>
                              <button
                                type="button"
                                className="management-trigger task-trigger"
                                aria-label={`管理对话 ${task.title}`}
                                onClick={() =>
                                  setOpenManagementMenu((currentMenu) =>
                                    currentMenu === `task:${task.id}`
                                      ? null
                                      : `task:${task.id}`
                                  )
                                }
                              >
                                ···
                              </button>
                              {openManagementMenu === `task:${task.id}` && (
                                <div className="management-menu task-menu">
                                  <button onClick={() => void renameTask(task)}>
                                    重命名
                                  </button>
                                  <button
                                    onClick={() => {
                                      void exportTask(task.id);
                                      setOpenManagementMenu(null);
                                    }}
                                  >
                                    导出报告
                                  </button>
                                  <button onClick={() => hideTask(task)}>
                                    从列表隐藏
                                  </button>
                                  <button
                                    className="danger"
                                    onClick={() => void deleteTask(task)}
                                  >
                                    删除记录
                                  </button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  );
                })
              )}
            </div>
            {selectedTaskId && (
              <button
                className="export-button"
                onClick={() => exportTask(selectedTaskId)}
                disabled={isBusy}
              >
                导出当前任务报告
              </button>
            )}
            {exportNotice && <small className="export-notice">{exportNotice}</small>}
          </div>
          <footer className="sidebar-footer">
            <button
              className="personalization-button"
              onClick={openPersonalization}
              disabled={isBusy}
            >
              <span className="personalization-avatar" aria-hidden="true">
                DS
              </span>
              <span>个性化</span>
              <small>
                {personalization?.settings.memoryEnabled
                  ? `记忆 ${personalization.memoryCount}`
                  : "记忆已关闭"}
              </small>
            </button>
          </footer>
        </aside>

        <section className="chat-panel">
          <div className="chat-heading">
            <div>
              <span className="eyebrow">
                {selectedTaskId ? "任务" : "新任务"}
              </span>
              <h2>{selectedTaskTitle || selectedProjectName || "开始新任务"}</h2>
            </div>
            {selectedTaskId && selectedTaskModel && (
              <span className="model-chip historical-model-chip">
                {selectedTaskModel.name} · {selectedTaskModel.hint}
              </span>
            )}
          </div>

          <div className="message-list">
            {messages.length === 0 ? (
              <div className="empty-state">
                <span>⌁</span>
                <h3>
                  {workspacePath
                    ? "描述任务，开始执行"
                    : "选择项目，然后开始任务"}
                </h3>
                <p>
                  {workspacePath
                    ? `当前项目：${selectedProjectName}`
                    : "API Key 不会进入渲染进程。"}
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <div className="message-label">
                    {message.role === "user" ? "你" : "DeepSeek"}
                  </div>
                  {message.role === "assistant" && message.taskStatus && (
                    <div
                      className={`task-state ${message.taskStatus.status}`}
                      role="status"
                    >
                      <span className="task-state-dot" />
                      <div>
                        <strong>{message.taskStatus.label}</strong>
                        {(message.taskStatus.detail ||
                          message.taskStatus.pendingApprovalCount > 0) && (
                          <small>
                            {message.taskStatus.detail ||
                              `${message.taskStatus.pendingApprovalCount} 项操作等待处理`}
                          </small>
                        )}
                      </div>
                    </div>
                  )}
                  {messageEdit &&
                  message.id === `${messageEdit.sourceRequestId}:user` ? (
                    <form className="message-editor" onSubmit={submitMessageEdit}>
                      {messageEdit.attachments.length > 0 && (
                        <div className="edit-image-list">
                          {messageEdit.attachments.map((attachment) => (
                            <figure key={attachment.id}>
                              <img
                                src={attachment.previewUrl}
                                alt={attachment.fileName}
                              />
                              <button
                                type="button"
                                aria-label={`删除图片 ${attachment.fileName}`}
                                onClick={() => void removeEditImage(attachment.id)}
                              >
                                ×
                              </button>
                            </figure>
                          ))}
                        </div>
                      )}
                      <textarea
                        aria-label="编辑消息内容"
                        value={messageEdit.text}
                        onChange={(event) =>
                          setMessageEdit((current) =>
                            current
                              ? { ...current, text: event.target.value }
                              : current
                          )
                        }
                        onPaste={(event) => {
                          const files = Array.from(event.clipboardData.files);
                          if (files.some((file) => file.type.startsWith("image/"))) {
                            event.preventDefault();
                            void addEditImageFiles(files);
                          }
                        }}
                      />
                      <div className="message-editor-footer">
                        <label className="edit-image-add">
                          ＋ 图片
                          <input
                            type="file"
                            accept="image/*"
                            multiple
                            onChange={(event) => {
                              void addEditImageFiles(
                                Array.from(event.target.files ?? [])
                              );
                              event.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <span />
                        <button
                          type="button"
                          onClick={() => void cancelMessageEdit()}
                        >
                          取消
                        </button>
                        <button type="submit" className="primary">
                          保存并重新执行
                        </button>
                      </div>
                    </form>
                  ) : (
                    <>
                  {message.attachments && message.attachments.length > 0 && (
                    <MessageImages
                      attachments={message.attachments}
                      onOpen={(index) =>
                        void openMessageImage(message.attachments!, index)
                      }
                    />
                  )}
                  {message.activities && message.activities.length > 0 && (
                    <ExecutionLog
                      messageId={message.id}
                      activities={message.activities}
                      taskStatus={message.taskStatus}
                    />
                  )}
                  <p className="answer-text">
                    {message.text ||
                      (message.role === "assistant" ? "正在处理…" : "")}
                  </p>
                    </>
                  )}
                  {message.state === "stopped" && <small>任务已停止</small>}
                  {message.state === "error" && <small>请求失败</small>}
                  {message.role === "user" && !messageEdit && (
                    <div className="message-actions">
                      <time dateTime={message.createdAt}>
                        {formatMessageTime(message.createdAt)}
                      </time>
                      <button
                        type="button"
                        aria-label="复制消息"
                        title="复制"
                        onClick={() => void copyMessage(message)}
                      >
                        {copiedMessageId === message.id ? "已复制" : "▢"}
                      </button>
                      <button
                        type="button"
                        aria-label="编辑消息"
                        title={
                          isBusy
                            ? "请先停止当前任务"
                            : message.turnId
                              ? "编辑并重新执行"
                              : "此历史消息暂不支持编辑"
                        }
                        disabled={isBusy || !message.turnId}
                        onClick={() => void beginMessageEdit(message)}
                      >
                        ✎
                      </button>
                      {message.branchOptions &&
                        message.branchOptions.length > 1 && (
                          <span className="message-branch-switcher">
                            <button
                              type="button"
                              aria-label="上一个消息版本"
                              disabled={isBusy}
                              onClick={() => {
                                const index = Math.max(
                                  0,
                                  (message.activeBranchIndex ?? 0) - 1
                                );
                                void selectMessageBranch(
                                  message.branchOptions![index].id
                                );
                              }}
                            >
                              ‹
                            </button>
                            <span>
                              {(message.activeBranchIndex ?? 0) + 1} /{" "}
                              {message.branchOptions.length}
                            </span>
                            <button
                              type="button"
                              aria-label="下一个消息版本"
                              disabled={isBusy}
                              onClick={() => {
                                const index = Math.min(
                                  message.branchOptions!.length - 1,
                                  (message.activeBranchIndex ?? 0) + 1
                                );
                                void selectMessageBranch(
                                  message.branchOptions![index].id
                                );
                              }}
                            >
                              ›
                            </button>
                          </span>
                        )}
                    </div>
                  )}
                </article>
              ))
            )}
          </div>

          <form
            className={`composer ${dragActive ? "drag-active" : ""}`}
            onSubmit={submit}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragActive(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (event.currentTarget === event.target) setDragActive(false);
            }}
            onDrop={handleDrop}
          >
            {connection.mode === "unavailable" && !connection.connected && (
              <p className="composer-harness-notice" role="status">
                受限隔离执行器不可用:当前将使用本地 Codex app-server
                {connection.detail ? `（${connection.detail}）` : ""}。{" "}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => void connectHarness()}
                >
                  重试连接
                </button>
              </p>
            )}
            {approvals.length > 0 && (
              <section className="approval-panel">
                <div className="approval-heading">
                  <span className="approval-icon" aria-hidden="true">
                    !
                  </span>
                  <div>
                    <h3>{approvals[0].title}</h3>
                    <p className="approval-preview" title={approvalPreview(approvals[0])}>
                      {approvalPreview(approvals[0])}
                    </p>
                  </div>
                  <span className="approval-count">
                    {approvals.length} 项待处理
                  </span>
                </div>
                <div className="approval-footer">
                  <details className="approval-details">
                    <summary>查看详情</summary>
                    <div>
                      {approvals[0].cwd && (
                        <p className="approval-meta">目录：{approvals[0].cwd}</p>
                      )}
                      {approvals[0].reason && (
                        <p className="approval-meta">原因：{approvals[0].reason}</p>
                      )}
                      {(approvals[0].diff || approvals[0].detail) && (
                        <pre className="approval-diff">
                          {approvals[0].diff || approvals[0].detail}
                        </pre>
                      )}
                    </div>
                  </details>
                  <div className="approval-actions">
                    <button
                      type="button"
                      className="approval-deny"
                      onClick={() => resolveApproval(approvals[0].id, "decline")}
                    >
                      拒绝
                    </button>
                    {approvals[0].allowRemember && (
                      <button
                        type="button"
                        className="approval-session"
                        onClick={() =>
                          resolveApproval(approvals[0].id, "acceptForSession")
                        }
                      >
                        本任务记住
                      </button>
                    )}
                    <button
                      type="button"
                      className="approval-accept"
                      onClick={() => resolveApproval(approvals[0].id, "accept")}
                    >
                      继续
                    </button>
                  </div>
                </div>
              </section>
            )}
            {attachments.length > 0 && (
              <div className="attachment-grid">
                {attachments.map((attachment) => (
                  <figure key={attachment.id}>
                    <img src={attachment.previewUrl} alt={attachment.fileName} />
                    <figcaption title={attachment.fileName}>
                      {attachment.fileName}
                    </figcaption>
                    <button
                      type="button"
                      aria-label={`删除 ${attachment.fileName}`}
                      onClick={() => removeImage(attachment.id)}
                    >
                      ×
                    </button>
                  </figure>
                ))}
              </div>
            )}
            {imageError && <p className="image-error">{imageError}</p>}
            <textarea
              ref={draftRef}
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={
                isBusy
                  ? "补充当前执行要求…"
                  : workspacePath
                  ? "描述你的任务…"
                  : "请先选择一个项目目录"
              }
              disabled={!workspacePath}
              onPaste={isBusy ? undefined : handlePaste}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <div className="composer-footer">
              <div className="composer-tools">
                <button
                  type="button"
                  className="image-button"
                  onClick={chooseImages}
                  disabled={isBusy}
                  title="添加图片，也可以拖放或粘贴"
                >
                  <span aria-hidden="true">＋</span>
                  图片
                </button>
                <small>
                  {attachmentSessionId
                    ? "附件已保存"
                    : "可拖放或粘贴图片"}
                </small>
              </div>
              <div className="composer-submit">
                <span>Enter 发送 · Shift + Enter 换行</span>
                <div
                  className={`composer-permission-picker ${
                    permissionMenuOpen ? "open" : ""
                  }`}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setPermissionMenuOpen(false);
                  }}
                >
                  {permissionMenuOpen && (
                    <div
                      className="permission-menu"
                      role="menu"
                      aria-label="选择访问权限"
                    >
                      <span>如何批准 DeepSeek 操作？</span>
                      {permissionOptions.map((option) => (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={permissionMode === option.id}
                          key={option.id}
                          onClick={() => selectPreferredPermission(option.id)}
                        >
                          <span className="permission-menu-check" aria-hidden="true">
                            {permissionMode === option.id ? "✓" : ""}
                          </span>
                          <span>
                            <strong>{option.name}</strong>
                            <small>{option.hint}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className={`composer-permission-button ${
                      permissionMode === "fullAccess" ? "danger" : ""
                    }`}
                    disabled={isBusy}
                    aria-haspopup="menu"
                    aria-expanded={permissionMenuOpen}
                    onClick={() => {
                      setModelMenuOpen(false);
                      setPermissionMenuOpen((current) => !current);
                    }}
                  >
                    <span aria-hidden="true">!</span>
                    <span>{selectedPermission.name}</span>
                    <span aria-hidden="true">⌄</span>
                  </button>
                </div>
                <div
                  className={`composer-model-picker ${
                    modelMenuOpen ? "open" : ""
                  }`}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") setModelMenuOpen(false);
                  }}
                >
                  {modelMenuOpen && (
                    <div
                      className="model-menu"
                      role="menu"
                      aria-label="选择推理模型"
                    >
                      <span>推理模型</span>
                      {modelOptions.map((option) => (
                        <button
                          type="button"
                          role="menuitemradio"
                          aria-checked={model === option.id}
                          key={option.id}
                          onClick={() => selectPreferredModel(option.id)}
                        >
                          <span
                            className="model-menu-check"
                            aria-hidden="true"
                          >
                            {model === option.id ? "✓" : ""}
                          </span>
                          <span>
                            <strong>{option.name}</strong>
                            <small>{option.hint}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    className="composer-model-button"
                    disabled={isBusy}
                    aria-haspopup="menu"
                    aria-expanded={modelMenuOpen}
                    onClick={() => {
                      setPermissionMenuOpen(false);
                      setModelMenuOpen((current) => !current);
                    }}
                  >
                    <span>{selectedModel.name}</span>
                    <small>{selectedModel.hint}</small>
                    <span aria-hidden="true">⌄</span>
                  </button>
                </div>
                {isBusy ? (
                  <>
                    <button
                      type="submit"
                      className="send-button steer-button"
                      disabled={!draft.trim()}
                      aria-label="补充执行要求"
                      title="补充到当前执行"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="stop-button"
                      onClick={stop}
                      aria-label="停止任务"
                      title="停止任务"
                    >
                      ■
                    </button>
                  </>
                ) : (
                  <button
                    type="submit"
                    className="send-button"
                    disabled={!workspacePath || !draft.trim()}
                    aria-label="发送"
                    title="发送"
                  >
                    ↑
                  </button>
                )}
              </div>
            </div>
          </form>
        </section>
      </section>
      {personalizationOpen && personalizationDraft && (
        <div
          className="settings-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) {
              setPersonalizationOpen(false);
            }
          }}
        >
          <section
            className="personalization-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="personalization-title"
          >
            <header>
              <div>
                <span className="eyebrow">DeepSeek Codex</span>
                <h2 id="personalization-title">个性化</h2>
              </div>
              <button
                type="button"
                className="dialog-close"
                onClick={() => setPersonalizationOpen(false)}
                aria-label="关闭个性化设置"
              >
                ×
              </button>
            </header>

            <label className="settings-field">
              <span>个性</span>
              <small>选择 DeepSeek 回复和协作时的默认风格</small>
              <select
                value={personalizationDraft.personality}
                onChange={(event) =>
                  setPersonalizationDraft({
                    ...personalizationDraft,
                    personality: event.target
                      .value as PersonalizationSettings["personality"]
                  })
                }
              >
                <option value="pragmatic">务实</option>
                <option value="concise">简洁</option>
                <option value="friendly">友好</option>
                <option value="professional">专业</option>
              </select>
            </label>

            <label className="settings-field custom-instructions">
              <span>自定义指令</span>
              <small>应用于此应用中的所有新任务</small>
              <textarea
                value={personalizationDraft.customInstructions}
                onChange={(event) =>
                  setPersonalizationDraft({
                    ...personalizationDraft,
                    customInstructions: event.target.value
                  })
                }
                placeholder="例如：先检查现有文件；只做与当前任务直接相关的修改。"
              />
            </label>

            <div className="memory-settings">
              <div className="memory-heading">
                <div>
                  <h3>记忆</h3>
                  <p>从同一项目的已完成任务中提取相关上下文。</p>
                </div>
                <span>{personalization?.memoryCount ?? 0} 条</span>
              </div>
              <label className="toggle-row">
                <div>
                  <strong>启用记忆</strong>
                  <small>把相关历史任务带入新的 DeepSeek 任务</small>
                </div>
                <input
                  type="checkbox"
                  checked={personalizationDraft.memoryEnabled}
                  onChange={(event) =>
                    setPersonalizationDraft({
                      ...personalizationDraft,
                      memoryEnabled: event.target.checked
                    })
                  }
                />
              </label>
              <label className="toggle-row">
                <div>
                  <strong>允许工具结果参与记忆</strong>
                  <small>保存命令、文件和验证步骤的摘要，不保存密钥</small>
                </div>
                <input
                  type="checkbox"
                  checked={personalizationDraft.toolMemoryEnabled}
                  disabled={!personalizationDraft.memoryEnabled}
                  onChange={(event) =>
                    setPersonalizationDraft({
                      ...personalizationDraft,
                      toolMemoryEnabled: event.target.checked
                    })
                  }
                />
              </label>
              <div className="reset-row">
                <div>
                  <strong>重置记忆</strong>
                  <small>清除记忆基线，但保留历史任务记录</small>
                </div>
                <button type="button" onClick={resetMemory}>
                  重置
                </button>
              </div>
            </div>

            <footer>
              <span>{personalizationNotice}</span>
              <div>
                <button
                  type="button"
                  className="dialog-cancel"
                  onClick={() => setPersonalizationOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="dialog-save"
                  onClick={savePersonalization}
                >
                  保存
                </button>
              </div>
            </footer>
          </section>
        </div>
      )}
      {imagePreview && (
        <div
          className="image-preview-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setImagePreview(null);
          }}
        >
          <section
            className="image-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="查看图片"
          >
            <header>
              <strong>
                {imagePreview.attachments[imagePreview.index]?.fileName}
              </strong>
              <div className="image-preview-header-actions">
                {imagePreview.analysisLoading ? (
                  <span className="image-analysis-status pending">图片分析中…</span>
                ) : imagePreview.analysis?.success ? (
                  <span className="image-analysis-status complete">
                    图片分析完成
                  </span>
                ) : (
                  <span className="image-analysis-status unavailable">
                    图片分析不可用
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setImagePreview(null)}
                  aria-label="关闭图片预览"
                >
                  ×
                </button>
              </div>
            </header>
            <div className="image-analysis-toolbar">
              <span>
                {imagePreview.analysis?.annotations.length
                  ? `检测到 ${imagePreview.analysis.annotations.length} 个红绿标注框`
                  : imagePreview.analysisLoading
                    ? "正在读取标注位置"
                    : "未检测到红绿标注框"}
              </span>
              <button
                type="button"
                disabled={
                  imagePreview.analysisLoading ||
                  !imagePreview.analysis?.annotations.length
                }
                aria-pressed={imagePreview.showAnnotations}
                onClick={() =>
                  setImagePreview((current) =>
                    current
                      ? {
                          ...current,
                          showAnnotations: !current.showAnnotations
                        }
                      : current
                  )
                }
              >
                {imagePreview.showAnnotations ? "隐藏识别框" : "显示识别框"}
              </button>
            </div>
            <div className="image-preview-stage">
              {imagePreview.url ? (
                <div className="image-preview-canvas">
                  <img
                    src={imagePreview.url}
                    alt={
                      imagePreview.attachments[imagePreview.index]?.fileName ??
                      "图片预览"
                    }
                  />
                  {imagePreview.showAnnotations &&
                    imagePreview.analysis?.annotations.map(
                      (annotation, annotationIndex) => (
                        <div
                          className={`image-annotation-box ${annotation.color}`}
                          key={`${annotation.color}-${annotationIndex}`}
                          style={{
                            left: `${annotation.x * 100}%`,
                            top: `${
                              (1 - annotation.y - annotation.height) * 100
                            }%`,
                            width: `${annotation.width * 100}%`,
                            height: `${annotation.height * 100}%`
                          }}
                        >
                          <span>
                            {annotation.color === "red" ? "红框" : "绿框"} ·{" "}
                            {Math.round(annotation.confidence * 100)}%
                            {annotation.enclosedText[0]
                              ? ` · ${annotation.enclosedText[0]}`
                              : ""}
                          </span>
                        </div>
                      )
                    )}
                </div>
              ) : imagePreview.error ? (
                <p>{imagePreview.error}</p>
              ) : (
                <p>正在加载图片…</p>
              )}
            </div>
            {imagePreview.attachments.length > 1 && (
              <footer>
                <button
                  type="button"
                  onClick={() => stepImagePreview(-1)}
                  aria-label="上一张图片"
                >
                  ‹
                </button>
                <span>
                  {imagePreview.index + 1} / {imagePreview.attachments.length}
                </span>
                <button
                  type="button"
                  onClick={() => stepImagePreview(1)}
                  aria-label="下一张图片"
                >
                  ›
                </button>
              </footer>
            )}
          </section>
        </div>
      )}
    </main>
  );
}


function MessageImages({
  attachments,
  onOpen
}: {
  attachments: AttachmentRecord[];
  onOpen: (index: number) => void;
}) {
  const visible = attachments.slice(0, 4);
  return (
    <div className="message-images">
      {visible.map((attachment, index) => {
        const overflow = index === 3 && attachments.length > 4;
        return (
          <button
            type="button"
            className={`message-image-button ${
              attachment.available === false ? "unavailable" : ""
            }`}
            key={attachment.id}
            onClick={() => onOpen(index)}
            title={
              attachment.available === false
                ? `${attachment.fileName}（图片已不可用）`
                : attachment.fileName
            }
          >
            {attachment.available === false ? (
              <span>图片已不可用</span>
            ) : (
              <img src={attachment.previewUrl} alt={attachment.fileName} />
            )}
            {overflow && (
              <strong aria-label={`还有 ${attachments.length - 3} 张图片`}>
                +{attachments.length - 3}
              </strong>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ExecutionLog({
  messageId,
  activities,
  taskStatus
}: {
  messageId: string;
  activities: NonNullable<Message["activities"]>;
  taskStatus?: MessageTaskStatus;
}) {
  const warnings = activities.filter(
    (activity) => activity.kind === "warning" || activity.kind === "error"
  ).length;
  const summary =
    taskStatus?.status === "running"
      ? "正在执行"
      : taskStatus?.status === "waitingApproval"
        ? "执行已暂停"
        : "执行过程";

  return (
    <details
      className={`execution-log ${warnings > 0 ? "has-warning" : ""}`}
      open={taskStatus?.status === "failed"}
    >
      <summary>
        <span className="execution-chevron" aria-hidden="true">
          ›
        </span>
        <span>{summary}</span>
        {warnings > 0 && <small>{warnings} 项需注意</small>}
      </summary>
      <div className="activity-list">
        {activities.map((activity, index) => (
          <details
            key={`${messageId}:activity:${index}`}
            className={`activity ${activity.kind}`}
            open={activity.kind === "error"}
          >
            <summary>
              <span>{activity.title}</span>
              {activity.state && <small>{activity.state}</small>}
            </summary>
            {activity.detail && <pre>{activity.detail}</pre>}
          </details>
        ))}
      </div>
    </details>
  );
}

function restoreConversationMessages(task: StoredTask): Message[] | null {
  const visibleEvents = visibleTaskEvents(task);
  if (!visibleEvents.some((event) => event.type === "userMessage")) return null;
  const messages: Message[] = [];
  const assistants = new Map<string, Message>();
  const users = new Map<string, Message>();
  for (const event of visibleEvents) {
    const payload = event.payload as Record<string, unknown>;
    const requestId =
      typeof payload.requestId === "string" ? payload.requestId : task.id;
    if (event.type === "userMessage") {
      messages.push({
        id: `${requestId}:user`,
        role: "user",
        text: typeof payload.text === "string" ? payload.text : "",
        createdAt: event.at,
        branchId:
          typeof payload.branchId === "string" ? payload.branchId : "main",
        replacesRequestId:
          typeof payload.replacesRequestId === "string"
            ? payload.replacesRequestId
            : undefined
      });
      users.set(requestId, messages[messages.length - 1]);
      const assistant: Message = {
        id: requestId,
        role: "assistant",
        text: "",
        activities: []
      };
      assistants.set(requestId, assistant);
      messages.push(assistant);
      continue;
    }
    const assistant = assistants.get(requestId);
    if (!assistant) continue;
    if (event.type === "turnStarted" && typeof payload.turnId === "string") {
      assistant.turnId = payload.turnId;
      const user = users.get(requestId);
      if (user) user.turnId = payload.turnId;
    } else if (event.type === "delta" && typeof payload.text === "string") {
      assistant.text += payload.text;
    } else if (event.type === "activity" && payload.activity) {
      const activity =
        payload.activity as NonNullable<Message["activities"]>[number];
      assistant.activities?.push(activity);
      if (
        activity.title === "Codex 回合已开始" &&
        typeof activity.detail === "string"
      ) {
        assistant.turnId = activity.detail;
        const user = users.get(requestId);
        if (user) user.turnId = activity.detail;
      }
    } else if (
      event.type === "taskStatus" &&
      typeof payload.status === "string" &&
      typeof payload.label === "string"
    ) {
      assistant.taskStatus = {
        status: payload.status as TaskStatus,
        label: payload.label,
        detail: typeof payload.detail === "string" ? payload.detail : undefined,
        pendingApprovalCount:
          typeof payload.pendingApprovalCount === "number"
            ? payload.pendingApprovalCount
            : 0
      };
    } else if (event.type === "error" && typeof payload.message === "string") {
      assistant.text = payload.message;
      assistant.state = "error";
    } else if (event.type === "stopped") {
      assistant.state = "stopped";
    }
  }
  for (const assistant of assistants.values()) {
    if (!assistant.text) assistant.text = "该回合没有最终回复。";
  }
  attachBranchOptions(messages, task);
  return messages;
}

function visibleTaskEvents(task: StoredTask) {
  const branches = task.branches ?? [
    {
      id: "main",
      threadId: task.codexThreadId,
      createdAt: task.createdAt
    }
  ];
  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  const eventsFor = (
    branchId: string,
    seen = new Set<string>()
  ): StoredTask["events"] => {
    if (seen.has(branchId)) return [];
    seen.add(branchId);
    const branch = byId.get(branchId);
    const own = task.events.filter((event) => {
      const payload = event.payload as Record<string, unknown>;
      return (typeof payload.branchId === "string" ? payload.branchId : "main") === branchId;
    });
    if (!branch?.parentBranchId || !branch.forkRequestId) return own;
    const parent = eventsFor(branch.parentBranchId, seen);
    const cutoff = parent.findIndex((event) => {
      const payload = event.payload as Record<string, unknown>;
      return (
        event.type === "userMessage" &&
        payload.requestId === branch.forkRequestId
      );
    });
    return [...(cutoff >= 0 ? parent.slice(0, cutoff) : parent), ...own];
  };
  return eventsFor(task.activeBranchId ?? "main");
}

function attachBranchOptions(messages: Message[], task: StoredTask) {
  const branches = task.branches ?? [];
  if (branches.length < 2) return;
  for (const message of messages) {
    if (message.role !== "user" || !message.id.endsWith(":user")) continue;
    const requestId = message.id.slice(0, -":user".length);
    const anchor = message.replacesRequestId ?? requestId;
    const derived = branches.filter((branch) => branch.forkRequestId === anchor);
    if (derived.length === 0) continue;
    const parentId = derived[0].parentBranchId ?? "main";
    const options = [
      { id: parentId, label: "原版本" },
      ...derived.map((branch, index) => ({
        id: branch.id,
        label: `编辑版本 ${index + 1}`
      }))
    ];
    message.branchOptions = options;
    message.activeBranchIndex = Math.max(
      0,
      options.findIndex((option) => option.id === (task.activeBranchId ?? "main"))
    );
  }
}

function formatMessageTime(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

async function hydrateConversationAttachments(messages: Message[]) {
  return Promise.all(
    messages.map(async (message) => {
      if (message.role !== "user" || !message.id.endsWith(":user")) {
        return message;
      }
      const requestId = message.id.slice(0, -":user".length);
      const attachments = await window.desktop.advisor.listImages(requestId);
      return attachments.length > 0 ? { ...message, attachments } : message;
    })
  );
}

function groupTasksByProject(
  tasks: StoredTask[],
  registeredProjects: RegisteredProject[]
): ProjectGroup[] {
  const projects = new Map<string, ProjectGroup>();
  for (const project of registeredProjects) {
    projects.set(project.id, {
      id: project.id,
      path: project.path,
      name: project.name,
      tasks: []
    });
  }
  for (const task of tasks) {
    const projectPath = normalizedProjectPath(task.workspacePath);
    const id = projectIdForPath(projectPath);
    const existing = projects.get(id);
    if (existing) {
      existing.tasks.push(task);
      continue;
    }
    projects.set(id, {
      id,
      path: projectPath,
      name: projectNameForPath(projectPath),
      tasks: [task]
    });
  }
  return [...projects.values()];
}

function projectNameForPath(projectPath: string) {
  return (
    normalizedProjectPath(projectPath)
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1) ?? projectPath
  );
}

function normalizedProjectPath(projectPath: string) {
  const normalized = projectPath.replace(/[\\/]+$/, "");
  return normalized || projectPath;
}

function projectIdForPath(projectPath: string) {
  const normalized = normalizedProjectPath(projectPath);
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `project-${(hash >>> 0).toString(36)}`;
}

function readExpandedProjectIds() {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(expandedProjectsStorageKey) ?? "[]"
    );
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function saveExpandedProjectIds(projectIds: string[]) {
  window.localStorage.setItem(
    expandedProjectsStorageKey,
    JSON.stringify(projectIds)
  );
}

function readStoredStringList(key: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function readStoredRecord(key: string) {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    );
  } catch {
    return {};
  }
}

function readRegisteredProjects(): RegisteredProject[] {
  try {
    const value = JSON.parse(
      window.localStorage.getItem(registeredProjectsStorageKey) ?? "[]"
    );
    if (!Array.isArray(value)) return [];
    return value.filter(
      (project): project is RegisteredProject =>
        Boolean(project) &&
        typeof project === "object" &&
        typeof project.id === "string" &&
        typeof project.path === "string" &&
        typeof project.name === "string" &&
        typeof project.createdAt === "number"
    );
  } catch {
    return [];
  }
}

function saveStoredValue(key: string, value: unknown) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function readPreferredModel(): ModelId {
  const saved = window.localStorage.getItem(preferredModelStorageKey);
  return saved === "deepseek/deepseek-v4-pro"
    ? saved
    : "deepseek/deepseek-v4-flash";
}

function readPreferredPermission(): PermissionMode {
  const saved = window.localStorage.getItem(preferredPermissionStorageKey);
  return saved === "ask" || saved === "fullAccess" ? saved : "agent";
}

function allowedStoredModel(model: string): model is ModelId {
  return model === "deepseek/deepseek-v4-flash" ||
    model === "deepseek/deepseek-v4-pro";
}

function approvalPreview(approval: ApprovalPrompt) {
  const detail = approval.diff || approval.detail;
  const firstMeaningfulLine = detail
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return firstMeaningfulLine || approval.reason || approval.cwd || "等待确认操作";
}

function formatDuration(durationMs?: number) {
  if (durationMs === undefined) return "未完成";
  if (durationMs < 1000) return `${durationMs} ms`;
  return `${(durationMs / 1000).toFixed(1)} s`;
}

function taskStatusLabel(status: TaskStatus, pendingApprovalCount = 0) {
  const labels: Record<TaskStatus, string> = {
    running: "处理中",
    waitingApproval:
      pendingApprovalCount > 0
        ? `等待审批 ${pendingApprovalCount}`
        : "等待审批",
    completed: "已完成",
    failed: "失败",
    stopped: "已停止"
  };
  return labels[status];
}

function storedTaskStatus(task: StoredTask): MessageTaskStatus {
  const labels: Record<TaskStatus, string> = {
    running: "正在处理",
    waitingApproval: "等待你的批准",
    completed: "任务已完成",
    failed: "任务失败",
    stopped: "任务已停止"
  };
  return {
    status: task.status,
    label: labels[task.status],
    detail:
      task.status === "failed"
        ? task.failureReason
        : task.status === "waitingApproval"
          ? `${task.pendingApprovalCount ?? 0} 项操作等待处理`
          : undefined,
    pendingApprovalCount: task.pendingApprovalCount ?? 0
  };
}
