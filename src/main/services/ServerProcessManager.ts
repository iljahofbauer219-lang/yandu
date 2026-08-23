import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SERVER_PORT = 8787
const DB_PORT = 5433
const PORT_WAIT_TIMEOUT_MS = 30_000
const PORT_POLL_INTERVAL_MS = 300
const KILL_GRACE_MS = 3_000
const MAX_SERVER_RESTARTS = 2

/** 探测某端口是否已有监听（127.0.0.1） */
function isPortListening(port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (result: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function waitForPort(port: number, label: string, timeoutMs = PORT_WAIT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await isPortListening(port)) return
    await new Promise(resolve => setTimeout(resolve, PORT_POLL_INTERVAL_MS))
  }
  throw new Error(`等待 ${label}（127.0.0.1:${port}）就绪超时（${timeoutMs}ms）`)
}

/** 极简 .env 解析：KEY=VALUE，支持 # 注释与首尾引号，不支持多行/变量展开（够用即可，不引入 dotenv） */
function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {}
  if (!fs.existsSync(filePath)) return result
  for (const rawLine of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1)
    result[key] = value
  }
  return result
}

/**
 * 应用启动时自动拉起本地服务端（Fastify @ 8787）与开发数据库（PGlite @ 5433），退出时自动关闭。
 * 关键约束：用户机器 PATH 中可能没有 node，因此子进程一律用 process.execPath（Electron 自身）
 * 加 ELECTRON_RUN_AS_NODE=1 以 node 模式运行，并通过 --import 指向 server 包内 tsx 的 ESM loader 绝对路径。
 */
export class ServerProcessManager {
  private readonly serverDir: string
  private dbProcess: ChildProcess | null = null
  private serverProcess: ChildProcess | null = null
  private serverRestartCount = 0
  private stopping = false
  private started = false

  constructor(projectRoot: string) {
    this.serverDir = path.join(projectRoot, 'server')
  }

  /** 幂等：8787 已有监听则直接复用；否则按 数据库 → server 顺序拉起。每个 await 后都检查 stopping，防止退出阶段继续 spawn 孤儿进程 */
  async start(): Promise<void> {
    if (this.started || this.stopping) return
    this.started = true
    if (!fs.existsSync(path.join(this.serverDir, 'package.json'))) {
      console.warn(`[server-manager] 未找到 server 目录（${this.serverDir}），跳过自动拉起`)
      return
    }
    if (await isPortListening(SERVER_PORT)) {
      console.log(`[server-manager] 检测到 127.0.0.1:${SERVER_PORT} 已有服务监听，直接复用`)
      return
    }
    if (this.stopping) return
    if (await isPortListening(DB_PORT)) {
      console.log(`[server-manager] 检测到 127.0.0.1:${DB_PORT} 已有数据库监听，跳过 PGlite 启动`)
    } else {
      if (this.stopping) return
      this.dbProcess = this.spawnNodeScript('db', path.join(this.serverDir, 'scripts', 'dev-db.ts'))
      await waitForPort(DB_PORT, 'PGlite 数据库')
      console.log(`[server-manager] PGlite 数据库已就绪（127.0.0.1:${DB_PORT}）`)
    }
    if (this.stopping) return
    await this.startServer()
  }

  private async startServer(): Promise<void> {
    // 自动重启路径也经过这里，退出阶段一律不再拉起
    if (this.stopping) return
    this.serverProcess = this.spawnNodeScript('server', path.join(this.serverDir, 'src', 'index.ts'))
    this.serverProcess.once('exit', (code, signal) => this.handleServerExit(code, signal))
    await waitForPort(SERVER_PORT, '本地服务端')
    console.log(`[server-manager] 本地服务端已就绪（127.0.0.1:${SERVER_PORT}）`)
  }

  private handleServerExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.serverProcess = null
    if (this.stopping) return
    console.error(`[server-manager] 服务端意外退出（code=${code} signal=${signal}）`)
    if (this.serverRestartCount >= MAX_SERVER_RESTARTS) {
      console.error(`[server-manager] 已达最大自动重启次数（${MAX_SERVER_RESTARTS}），不再重启`)
      return
    }
    this.serverRestartCount += 1
    console.error(`[server-manager] 尝试第 ${this.serverRestartCount} 次自动重启服务端…`)
    this.startServer().catch(error => console.error('[server-manager] 服务端自动重启失败：', error))
  }

  /** 以 node 模式 spawn 一个 TS 脚本：Electron 自身 + ELECTRON_RUN_AS_NODE + tsx ESM loader（绝对路径） */
  private spawnNodeScript(label: string, scriptPath: string): ChildProcess {
    const tsxLoaderPath = path.join(this.serverDir, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')
    // pnpm 下 tsx 装在 server 包内；若路径变化则退回裸标识符（node 会从 cwd 解析）
    const tsxLoader = fs.existsSync(tsxLoaderPath) ? pathToFileURL(tsxLoaderPath).href : 'tsx/esm'
    const child = spawn(process.execPath, ['--import', tsxLoader, scriptPath], {
      cwd: this.serverDir,
      env: { ...process.env, ...parseEnvFile(path.join(this.serverDir, '.env')), ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    console.log(`[server-manager] 已启动 [${label}] 子进程 pid=${child.pid}`)
    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[${label}] ${chunk.toString()}`))
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[${label}] ${chunk.toString()}`))
    child.once('error', error => console.error(`[${label}] 子进程启动失败：`, error))
    return child
  }

  /** 退出时清理：先 SIGTERM，超时补 SIGKILL；先停 server 再停数据库 */
  async stop(): Promise<void> {
    if (this.stopping) return
    this.stopping = true
    await this.killProcess('server', this.serverProcess)
    await this.killProcess('db', this.dbProcess)
    this.serverProcess = null
    this.dbProcess = null
  }

  private killProcess(label: string, child: ChildProcess | null): Promise<void> {
    if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        console.warn(`[server-manager] [${label}] SIGTERM 超时，改用 SIGKILL`)
        try { child.kill('SIGKILL') } catch { /* 已退出 */ }
      }, KILL_GRACE_MS)
      child.once('exit', () => {
        clearTimeout(timer)
        console.log(`[server-manager] [${label}] 子进程已退出`)
        resolve()
      })
      try { child.kill('SIGTERM') } catch { clearTimeout(timer); resolve() }
    })
  }
}
