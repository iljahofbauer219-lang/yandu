import { execFile, spawn, type ChildProcess } from "node:child_process";
import { app } from "electron";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const healthUrl = process.env.ADVISOR_PROXY_HEALTH_URL || "http://127.0.0.1:10101/healthz";
const proxyBinary = process.env.ADVISOR_PROXY_BINARY || "/Users/zyc/Documents/Codex/opencodex-runtime/bin/ocx";
const proxyHome = process.env.ADVISOR_PROXY_HOME || path.join(app.getPath("home"), ".opencodex-deepseek");
const proxyCodexHome = process.env.ADVISOR_PROXY_CODEX_HOME || path.join(app.getPath("home"), ".codex-deepseek-runtime");
const guardianScript = app.isPackaged
  ? path.join(process.resourcesPath, "proxy-guardian.sh")
  : path.join(app.getAppPath(), "scripts", "advisor-proxy-guardian.sh");

let proxyProcess: ChildProcess | null = null;
let startPromise: Promise<void> | null = null;
let ownsProxy = false;

export async function ensureProxyRunning() {
  if (ownsProxy && (await isHealthy())) return;
  if (await isHealthy()) {
    return;
  }
  if (startPromise) return startPromise;
  startPromise = startProxy();
  try {
    await startPromise;
  } finally {
    startPromise = null;
  }
}

export async function stopManagedProxy() {
  if (!ownsProxy) return;
  const child = proxyProcess;
  proxyProcess = null;
  ownsProxy = false;
  if (child && !child.killed) child.kill("SIGTERM");
  await execFileAsync(proxyBinary, ["stop"], {
    env: proxyEnvironment()
  }).catch(() => undefined);
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!(await isHealthy())) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function startProxy() {
  const { stdout } = await execFileAsync("/usr/bin/security", [
    "find-generic-password",
    "-a",
    process.env.USER ?? "zyc",
    "-s",
    process.env.ADVISOR_PROXY_KEYCHAIN_SERVICE || "codex-deepseek-api-key",
    "-w"
  ]);
  const apiKey = stdout.trim();
  if (!apiKey) throw new Error("macOS 钥匙串中没有 DeepSeek API Key。");

  const child = spawn(
    "/bin/zsh",
    [guardianScript, String(process.pid), proxyBinary],
    {
      env: proxyEnvironment(apiKey),
      stdio: "ignore"
    }
  );
  proxyProcess = child;
  child.once("exit", () => {
    if (proxyProcess === child) proxyProcess = null;
  });

  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await isHealthy()) {
      ownsProxy = true;
      return;
    }
    if (child.exitCode !== null) {
      throw new Error(`OpenCodex 代理启动失败，退出码 ${child.exitCode}。`);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  child.kill("SIGTERM");
  proxyProcess = null;
  throw new Error("OpenCodex 代理启动超时。");
}

function proxyEnvironment(apiKey?: string) {
  return {
    ...process.env,
    OPENCODEX_HOME: proxyHome,
    CODEX_HOME: proxyCodexHome,
    ...(apiKey ? { DEEPSEEK_API_KEY: apiKey } : {}),
    PATH:
      "/Applications/ChatGPT.app/Contents/Resources/cua_node/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  };
}

async function isHealthy() {
  try {
    const response = await fetch(healthUrl, {
      signal: AbortSignal.timeout(1200)
    });
    return response.ok;
  } catch {
    return false;
  }
}
