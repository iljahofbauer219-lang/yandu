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
  LinduoChatRequestBody,
  LinduoChatSseEvent
} from "../../shared/contracts";

const DEFAULT_SERVER_BASE_URL = "http://127.0.0.1:8787";
const SERVER_BASE_URL =
  process.env.LINDUO_SERVER_BASE_URL?.trim() || DEFAULT_SERVER_BASE_URL;

const CHAT_MODELS_TIMEOUT_MS = 10_000;

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
  if (status === 401 || status === 403) {
    return {
      code: "ADVISOR_SIGNED_OUT",
      message: `ADVISOR_SIGNED_OUT: server 拒绝授权 (HTTP ${status})`
    };
  }
  if (status === 404) {
    return {
      code: "LINDUO_MODEL_NOT_FOUND",
      message: `LINDUO_MODEL_NOT_FOUND: ${body.slice(0, 120)}`
    };
  }
  if (status === 429) {
    return {
      code: "LINDUO_RATE_LIMITED",
      message: `LINDUO_RATE_LIMITED: ${body.slice(0, 120)}`
    };
  }
  // 4xx 业务错误（除上面三类）与 5xx 兜底
  return {
    code: "LINDUO_UPSTREAM_ERROR",
    message: `LINDUO_UPSTREAM_ERROR: HTTP ${status} ${body.slice(0, 120)}`
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

  // 响应可能直接是数组，也可能是 { items: [...] }
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
 */
export async function streamLinduoChat(
  req: LinduoChatRequestBody,
  signal: AbortSignal
): Promise<Response> {
  const auth = authHeaderOrThrow();
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
      signal
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

/**
 * 解析 SSE 流为事件数组。仅在 caller 想一次拿完结果（调试/测试）时使用；
 * 业务上应直接消费 response.body 以支持流式 yield。
 */
export async function consumeLinduoChatSse(
  response: Response
): Promise<LinduoChatSseEvent[]> {
  if (!response.body) return [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events: LinduoChatSseEvent[] = [];
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = raw.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data) as LinduoChatSseEvent;
          events.push(parsed);
        } catch {
          // 跳过非 JSON 事件,不动主流程
        }
      }
    }
    buffer += decoder.decode();
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* 释放失败不影响 */
    }
  }
  return events;
}
