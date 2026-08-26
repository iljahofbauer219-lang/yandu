/**
 * M1 Linduo HTTP 客户端。
 *
 * 主进程没有 prisma 客户端（主进程用 node:sqlite DatabaseSync），
 * LinduoChatService 也在另一个 server 进程里。
 * 所以主进程必须经由 server HTTP 拉取模型列表 + 发起流式 chat。
 *
 * 与 src/shared/contracts.ts 的 LinduoChatRequestBody / LinduoChatSseEvent 契约一致。
 * 路由契约见 Task 8（/api/linduo/chat-models 与 /api/linduo/chat）。
 *
 * 错误码约定：
 * - ADVISOR_SIGNED_OUT   未配置 YANDU_USER_JWT / 401 / 403
 * - LINDUO_UPSTREAM_ERROR  5xx / 网络异常 / 解析失败
 * - LINDUO_MODEL_NOT_FOUND 404（透传）
 * - LINDUO_RATE_LIMITED   429（透传）
 */
import type {
  LinduoChatModelView,
  LinduoChatRequestBody
} from "../../shared/contracts";

const DEFAULT_SERVER_BASE_URL = "http://127.0.0.1:8787";

/**
 * 解析 LINDUO_SERVER_BASE_URL，强制限定为本机回环。
 * M1 信任模型：Linduo 服务永远跑在用户本机，任意 host 配置会随 Authorization header
 * 把用户 JWT 泄漏到外部 host。M2+ 如需远程 Linduo，应改用 IPC / mTLS。
 */
function resolveServerBaseUrl(): string {
  const raw = process.env.LINDUO_SERVER_BASE_URL?.trim() || DEFAULT_SERVER_BASE_URL;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `LINDUO_UPSTREAM_ERROR: LINDUO_SERVER_BASE_URL 非法 (${raw})`
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `LINDUO_UPSTREAM_ERROR: LINDUO_SERVER_BASE_URL 协议必须 http(s),实际 ${url.protocol}`
    );
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") {
    throw new Error(
      `LINDUO_UPSTREAM_ERROR: LINDUO_SERVER_BASE_URL 仅允许本机回环,实际 ${url.hostname}`
    );
  }
  return url.toString().replace(/\/+$/, "");
}

const SERVER_BASE_URL = resolveServerBaseUrl();

const CHAT_MODELS_TIMEOUT_MS = 10_000;
const CHAT_STREAM_TIMEOUT_MS = 120_000;

/**
 * redact 错误消息里的敏感片段（sk-... / Bearer ... / 长 base64）。
 * 与 server 端 chat-service.ts 的 redact 规则保持一致，避免被外部 caller 看到明文。
 */
function redactErrorBody(body: string): string {
  return body
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, "sk-***REDACTED***")
    .replace(/\bBearer\s+[A-Za-z0-9_.-]{16,}\b/gi, "Bearer ***REDACTED***")
    .slice(0, 80);
}

function authHeaderOrThrow(): Record<string, string> {
  const token = process.env.YANDU_USER_JWT?.trim();
  if (!token) {
    throw new Error(
      "ADVISOR_SIGNED_OUT: 未配置 YANDU_USER_JWT,无法调用 Linduo 服务端"
    );
  }
  return { Authorization: `Bearer ${token}` };
}

function classifyHttpError(
  status: number,
  body: string
): { code: "ADVISOR_SIGNED_OUT" | "LINDUO_UPSTREAM_ERROR" | "LINDUO_MODEL_NOT_FOUND" | "LINDUO_RATE_LIMITED"; message: string } {
  const redacted = redactErrorBody(body);
  if (status === 401 || status === 403) {
    return {
      code: "ADVISOR_SIGNED_OUT",
      message: `ADVISOR_SIGNED_OUT: server 拒绝授权 (HTTP ${status})`
    };
  }
  if (status === 404) {
    return {
      code: "LINDUO_MODEL_NOT_FOUND",
      message: `LINDUO_MODEL_NOT_FOUND: ${redacted}`
    };
  }
  if (status === 429) {
    return {
      code: "LINDUO_RATE_LIMITED",
      message: `LINDUO_RATE_LIMITED: ${redacted}`
    };
  }
  // 4xx 业务错误（除上面三类）与 5xx 兜底
  return {
    code: "LINDUO_UPSTREAM_ERROR",
    message: `LINDUO_UPSTREAM_ERROR: HTTP ${status} ${redacted}`
  };
}

/**
 * 拉取当前用户可用的 enabled LinduoChatModel 列表。
 * 失败时抛错：未登录 → ADVISOR_SIGNED_OUT,其它 → LINDUO_UPSTREAM_ERROR。
 */
export async function getLinduoChatModelsFromServer(): Promise<
  LinduoChatModelView[]
> {
  const auth = authHeaderOrThrow();
  let response: Response;
  try {
    response = await fetch(`${SERVER_BASE_URL}/api/linduo/chat-models`, {
      method: "GET",
      headers: { ...auth, Accept: "application/json" },
      signal: AbortSignal.timeout(CHAT_MODELS_TIMEOUT_MS)
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "网络异常";
    throw new Error(`LINDUO_UPSTREAM_ERROR: ${detail}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const { message } = classifyHttpError(response.status, body);
    throw new Error(message);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch (err) {
    const detail = err instanceof Error ? err.message : "JSON 解析失败";
    throw new Error(`LINDUO_UPSTREAM_ERROR: ${detail}`);
  }

  // contract（LinduoChatModelView[]）规定数组形式；遇到 { items: [] } 视为旧版本兜底
  if (Array.isArray(payload)) return payload as LinduoChatModelView[];
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { items?: unknown }).items)
  ) {
    return (payload as { items: LinduoChatModelView[] }).items;
  }
  throw new Error(
    "LINDUO_UPSTREAM_ERROR: /api/linduo/chat-models 返回结构异常"
  );
}

/**
 * 发起流式 chat 调用,返回未消费的 Response（caller 负责 read SSE 流）。
 * 401/403/5xx/网络异常时抛错；
 * 200 但 Content-Type 非 text/event-stream 时抛错。
 *
 * 同时尊重 caller signal 与 120s internal timeout（AbortSignal.any 合并）。
 * 用 AbortSignal.any 而非 ??：caller 传了 AbortSignal 仍保有 120s 上限，
 * 避免上游 hung up + 用户没点 stop 时 IPC 永久 hang。
 */
export async function streamLinduoChat(
  req: LinduoChatRequestBody,
  signal: AbortSignal
): Promise<Response> {
  const auth = authHeaderOrThrow();
  // 快速失败：caller signal 已 aborted 时不必发请求
  if (signal.aborted) {
    throw new DOMException("Linduo chat request aborted before send", "AbortError");
  }
  const timeoutSignal = AbortSignal.timeout(CHAT_STREAM_TIMEOUT_MS);
  const combinedSignal = AbortSignal.any([signal, timeoutSignal]);

  let response: Response;
  try {
    response = await fetch(`${SERVER_BASE_URL}/api/linduo/chat`, {
      method: "POST",
      headers: {
        ...auth,
        "Content-Type": "application/json",
        Accept: "text/event-stream"
      },
      body: JSON.stringify(req),
      signal: combinedSignal
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "网络异常";
    throw new Error(`LINDUO_UPSTREAM_ERROR: ${detail}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const { message } = classifyHttpError(response.status, body);
    throw new Error(message);
  }

  if (!response.body) {
    throw new Error("LINDUO_UPSTREAM_ERROR: empty body");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    throw new Error(
      `LINDUO_UPSTREAM_ERROR: 期望 text/event-stream,实际 ${contentType}`
    );
  }

  return response;
}
