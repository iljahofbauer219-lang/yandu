import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

type RpcId = number | string;

type RpcMessage = {
  id?: RpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

export type AppServerNotification = {
  method: string;
  params: Record<string, unknown>;
};

export type AppServerRequest = {
  id: RpcId;
  method: string;
  params: Record<string, unknown>;
};

const codexBinary = app.isPackaged
  ? path.join(process.resourcesPath, "codex")
  : "/Applications/ChatGPT.app/Contents/Resources/codex";
const codexHome = path.join(app.getPath("userData"), "advisor", "codex-home");

export class AppServerClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<RpcId, PendingRequest>();
  private startPromise: Promise<void> | null = null;

  async start(): Promise<void> {
    if (this.child) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startProcess();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async startProcess(): Promise<void> {
    ensureAdvisorCodexConfig();
    const child = spawn(
      codexBinary,
      [
        "app-server",
        "--listen",
        "stdio://",
        "--disable",
        "enable_request_compression"
      ],
      {
      env: {
        ...process.env,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY || process.env.OPENAI_IMAGE_API_KEY || "",
        HTTPS_PROXY: process.env.HTTPS_PROXY || process.env.IMAGE_PROXY_URL || "",
        HTTP_PROXY: process.env.HTTP_PROXY || process.env.IMAGE_PROXY_URL || "",
        CODEX_HOME: codexHome,
        NO_PROXY: "127.0.0.1,localhost",
        no_proxy: "127.0.0.1,localhost",
        PATH:
          "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
      },
      stdio: ["pipe", "pipe", "pipe"]
      }
    );
    this.child = child;

    readline.createInterface({ input: child.stdout }).on("line", (line) => {
      if (!line.trim()) return;
      try {
        this.handleMessage(JSON.parse(line) as RpcMessage);
      } catch (error) {
        this.emit("protocolError", new Error(`无法解析 app-server 消息：${String(error)}`));
      }
    });

    readline.createInterface({ input: child.stderr }).on("line", (line) => {
      this.emit("stderr", line);
    });

    child.once("exit", (code, signal) => {
      if (this.child !== child) return;
      const error = new Error(
        `Codex app-server 已退出（code=${code ?? "null"}, signal=${signal ?? "null"}）`
      );
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
      this.child = null;
      this.emit("exit", error);
    });

    child.once("error", (error) => {
      if (this.child !== child) return;
      this.child = null;
      this.emit("exit", error);
    });

    await this.request("initialize", {
      clientInfo: {
        name: "yandu-online-advisor",
        title: "在线参谋",
        version: "0.1.0"
      },
      capabilities: {
        experimentalApi: true
      }
    });
    this.notify("initialized");
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error("Codex app-server 尚未启动。"));
    }
    const id = this.nextId++;
    const payload = params === undefined ? { method, id } : { method, id, params };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.write(payload);
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown) {
    const payload = params === undefined ? { method } : { method, params };
    this.write(payload);
  }

  respond(id: RpcId, result: unknown) {
    this.write({ id, result });
  }

  respondError(id: RpcId, code: number, message: string) {
    this.write({ id, error: { code, message } });
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.child = null;
    child.kill("SIGTERM");
  }

  private write(payload: object) {
    if (!this.child?.stdin.writable) throw new Error("Codex app-server 连接不可用。");
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleMessage(message: RpcMessage) {
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(
            `${message.error.message}${
              message.error.data ? `：${JSON.stringify(message.error.data)}` : ""
            }`
          )
        );
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      this.emit("request", {
        id: message.id,
        method: message.method,
        params: (message.params ?? {}) as Record<string, unknown>
      } satisfies AppServerRequest);
      return;
    }

    if (message.method) {
      this.emit("notification", {
        method: message.method,
        params: (message.params ?? {}) as Record<string, unknown>
      } satisfies AppServerNotification);
    }
  }
}

function ensureAdvisorCodexConfig() {
  fs.mkdirSync(codexHome, { recursive: true });
  const configPath = path.join(codexHome, "config.toml");
  const openAiProvider = [
    '[model_providers.openai_api]',
    'name = "OpenAI API"',
    'base_url = "https://api.openai.com/v1"',
    'env_key = "OPENAI_API_KEY"',
    'wire_api = "responses"',
    'requires_openai_auth = false'
  ].join('\n');
  if (fs.existsSync(configPath)) {
    const current = fs.readFileSync(configPath, "utf8");
    if (!current.includes("[model_providers.openai_api]")) {
      fs.appendFileSync(configPath, `\n${openAiProvider}\n`, { mode: 0o600 });
    }
    return;
  }
  const modelCatalog = process.env.ADVISOR_MODEL_CATALOG || path.join(app.getPath("home"), ".codex-deepseek-client", "models.json");
  fs.writeFileSync(configPath, [
    'model = "deepseek/deepseek-v4-flash"',
    'model_provider = "deepseek_proxy"',
    `model_catalog_json = ${JSON.stringify(modelCatalog)}`,
    'model_reasoning_effort = "high"',
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    '',
    '[model_providers.deepseek_proxy]',
    'name = "Local Advisor Proxy"',
    'base_url = "http://127.0.0.1:10101/v1"',
    'wire_api = "responses"',
    'requires_openai_auth = false',
    '',
    openAiProvider,
    '',
    '[analytics]',
    'enabled = false',
    ''
  ].join('\n'), { mode: 0o600 });
}
