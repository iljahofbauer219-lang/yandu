import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'

const PORT = 3080

export type DeepSeekHarnessStatus = {
  running: boolean
  url: string
  message: string
}

function canConnect(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port })
    const done = (value: boolean) => { socket.removeAllListeners(); socket.destroy(); resolve(value) }
    socket.setTimeout(500)
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.once('timeout', () => done(false))
  })
}

export class DeepSeekHarnessProcessManager {
  private process: ChildProcess | null = null
  private readonly sourceDir: string

  constructor(sourceDir: string, private readonly dataDir: string) {
    this.sourceDir = sourceDir
  }

  async status(): Promise<DeepSeekHarnessStatus> {
    const running = await canConnect(PORT)
    return { running, url: `http://127.0.0.1:${PORT}`, message: running ? '本地 Harness 已就绪' : '本地 Harness 尚未启动' }
  }

  async start(): Promise<DeepSeekHarnessStatus> {
    const existing = await this.status()
    if (existing.running) return existing
    const entry = path.join(this.sourceDir, 'apps', 'cli', 'lib', 'bin.js')
    if (!fs.existsSync(entry) || !fs.existsSync(path.join(this.sourceDir, 'node_modules', '@deepseek-ai'))) {
      return { running: false, url: `http://127.0.0.1:${PORT}`, message: 'Harness 源码或依赖未就绪，请先执行 scripts/build-deepseek-harness.sh。' }
    }
    this.process = spawn(process.execPath, [entry, 'web', '--host', '127.0.0.1', '--port', String(PORT)], {
      cwd: this.sourceDir,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: path.join(this.dataDir, 'deepseek-harness') },
      stdio: 'ignore'
    })
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (await canConnect(PORT)) return this.status()
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    return { running: false, url: `http://127.0.0.1:${PORT}`, message: 'Harness 启动超时，请查看应用主进程日志。' }
  }

  async stop(): Promise<void> {
    if (this.process && this.process.exitCode === null && this.process.signalCode === null) this.process.kill('SIGTERM')
    this.process = null
  }
}
