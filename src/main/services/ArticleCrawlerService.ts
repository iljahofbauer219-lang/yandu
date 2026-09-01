/**
 * ArticleCrawlerService（NewsCrawler 集成）
 * --------------------------------------------------------------
 * 封装 https://github.com/NanmiCoder/NewsCrawler 的本地启停与抓取记录同步。
 *
 * 设计原则：
 * - 零侵入：仅作为桌面端的一个可选工具，不修改 NewsCrawler 自身代码
 * - 用户可配置安装路径（默认 ~/NewsCrawler）
 * - 状态通过 `~/.yandu/article-crawler-state.json` 持久化
 * - 上传至 MaxKB 知识库复用 MaxkbKnowledgeService.uploadDocs
 *
 * 关键边界：
 * - 不下载/克隆 NewsCrawler 仓库（避免 git/python/docker 误升级影响桌面端）
 * - 抓取结果仅在用户显式「同步到知识库」时上传，绝不静默
 */
import { app, dialog, shell } from 'electron'
import { execFile, spawn } from 'node:child_process'
import { promises as fsp, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type CrawlerServiceState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'START_FAILED'

export interface CrawlerConfig {
  installPath: string
  webUiUrl: string
  dataDir: string
  autoStart: boolean
}

export interface CrawlerStatus {
  state: CrawlerServiceState
  config: CrawlerConfig
  dockerAvailable: boolean
  dockerComposeAvailable: boolean
  installPathValid: boolean
  dataDirValid: boolean
  webUiReachable: boolean
  message: string
  lastCheckedAt: string
}

export interface CrawlerArticleSummary {
  fileName: string
  filePath: string
  platform: string
  title: string
  url: string
  author: string
  publishTime: string
  sizeBytes: number
  charCount: number
  content: string
  format: 'markdown' | 'json'
}

export interface CrawlerImportResult {
  kbId: string
  kbName: string
  uploaded: Array<{ fileName: string; docId: string }>
  failed: Array<{ fileName: string; error: string }>
}

interface StateFile {
  config: CrawlerConfig
}

const DEFAULT_WEB_UI_URL = 'http://localhost:3021'
const DEFAULT_WEB_API_URL = 'http://localhost:8000'
const DEFAULT_DOCKER_HEALTHCHECK_TIMEOUT_MS = 3000
const DOCKER_START_TIMEOUT_MS = 90_000
const STATE_FILE_NAME = 'article-crawler-state.json'

function stateFilePath(): string {
  return path.join(app.getPath('userData'), STATE_FILE_NAME)
}

function defaultInstallPath(): string {
  return path.join(os.homedir(), 'NewsCrawler')
}

function defaultDataDir(installPath: string): string {
  return path.join(installPath, 'data')
}

function defaultConfig(): CrawlerConfig {
  const installPath = defaultInstallPath()
  return {
    installPath,
    webUiUrl: DEFAULT_WEB_UI_URL,
    dataDir: defaultDataDir(installPath),
    autoStart: false
  }
}

async function readStateFile(): Promise<StateFile | null> {
  const file = stateFilePath()
  if (!existsSync(file)) return null
  try {
    const raw = await fsp.readFile(file, 'utf8')
    return JSON.parse(raw) as StateFile
  } catch {
    return null
  }
}

async function writeStateFile(payload: StateFile): Promise<void> {
  const file = stateFilePath()
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, JSON.stringify(payload, null, 2), 'utf8')
}

async function commandExists(cmd: string): Promise<boolean> {
  return (await resolveCommand(cmd)) !== null
}

/**
 * 在 PATH 之外再扫描若干「常见但 Electron 默认 PATH 不会包含」的位置。
 * 原因：macOS 上 .app 启动时注入的 PATH 只有 /usr/bin:/bin:/usr/sbin:/sbin，
 * 不含 OrbStack 暴露的 ~/.local/bin、Homebrew 的 /opt/homebrew/bin 等，
 * 因此仅靠 `which` 会漏报。
 */
function knownExtraBinDirs(): string[] {
  const home = os.homedir()
  return [
    path.join(home, '.local', 'bin'),                          // OrbStack / pip --user / 多数 CLI 工具
    path.join(home, '.orbstack', 'bin'),                       // OrbStack 真实二进制位置
    '/opt/homebrew/bin',                                      // Apple Silicon Homebrew
    '/usr/local/bin',                                         // Intel Homebrew
    '/Applications/Docker.app/Contents/Resources/bin',         // Docker Desktop
    '/Applications/OrbStack.app/Contents/Resources/bin'       // OrbStack.app
  ]
}

async function resolveCommand(cmd: string): Promise<string | null> {
  // 1) 绝对路径直接验证
  if (cmd.includes('/')) {
    return existsSync(cmd) ? cmd : null
  }
  // 2) 现有 PATH 兜底（which / where）
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('where', [cmd])
      const first = stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean)
      if (first) return first
    } else {
      const { stdout } = await execFileAsync('which', [cmd])
      const first = stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean)
      if (first) return first
    }
  } catch {
    // 继续走扩展路径扫描
  }
  // 3) 常见安装位置
  for (const dir of knownExtraBinDirs()) {
    const candidate = path.join(dir, cmd)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * 组装一个包含已知额外路径的 PATH，供 spawn / execFile 透传给 docker 子进程，
 * 保证 `docker compose up -d` 内部如果调用其他 CLI（如 curl、git）也能找到。
 */
function buildAugmentedPath(): string {
  const current = process.env.PATH || ''
  const extras = knownExtraBinDirs().filter(dir => !current.split(path.delimiter).includes(dir))
  if (extras.length === 0) return current
  return [...extras, current].join(path.delimiter)
}

async function isDockerInstalled(): Promise<boolean> {
  return (await resolveCommand('docker')) !== null
}

async function isDockerComposeInstalled(): Promise<{ available: boolean; dockerPath: string | null }> {
  // v2 风格 `docker compose`（推荐）；v1 风格 `docker-compose`（兼容老机器）
  const dockerPath = await resolveCommand('docker')
  if (dockerPath) {
    try {
      const { stdout } = await execFileAsync(dockerPath, ['compose', 'version'], { timeout: 5000 })
      if (/Docker Compose version/.test(stdout)) return { available: true, dockerPath }
    } catch {
      // 继续走 v1 兼容
    }
  }
  const legacyPath = await resolveCommand('docker-compose')
  return { available: legacyPath !== null, dockerPath: legacyPath ?? dockerPath }
}

async function checkWebUiReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEFAULT_DOCKER_HEALTHCHECK_TIMEOUT_MS)
    try {
      const resp = await fetch(url, { method: 'GET', signal: controller.signal })
      return resp.status < 500
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

interface MarkdownFrontMatter { [key: string]: string }

function parseFrontMatter(raw: string): { meta: MarkdownFrontMatter; body: string } {
  if (!raw.startsWith('---')) return { meta: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end < 0) return { meta: {}, body: raw }
  const head = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).replace(/^\r?\n/, '')
  const meta: MarkdownFrontMatter = {}
  for (const line of head.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_\-]+)\s*:\s*(.*)$/.exec(line)
    if (m) meta[m[1]] = m[2].replace(/^"(.*)"$/, '$1').trim()
  }
  return { meta, body }
}

function deriveTitle(meta: MarkdownFrontMatter, body: string, fallback: string): string {
  if (meta.title) return meta.title
  const firstLine = body.split(/\r?\n/).find(line => line.trim().startsWith('#'))
  if (firstLine) return firstLine.replace(/^#+\s*/, '').trim()
  return fallback
}

export class ArticleCrawlerService {
  private config: CrawlerConfig = defaultConfig()
  private loaded = false

  async load(): Promise<void> {
    const state = await readStateFile()
    if (state?.config) this.config = { ...defaultConfig(), ...state.config }
    this.loaded = true
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.load()
  }

  private async persist(): Promise<void> {
    await writeStateFile({ config: this.config })
  }

  async getConfig(): Promise<CrawlerConfig> {
    await this.ensureLoaded()
    return { ...this.config }
  }

  async saveConfig(input: Partial<CrawlerConfig>): Promise<CrawlerConfig> {
    await this.ensureLoaded()
    const next: CrawlerConfig = {
      installPath: input.installPath?.trim() || this.config.installPath,
      webUiUrl: input.webUiUrl?.trim() || this.config.webUiUrl,
      dataDir: input.dataDir?.trim() || (input.installPath ? defaultDataDir(input.installPath) : this.config.dataDir),
      autoStart: typeof input.autoStart === 'boolean' ? input.autoStart : this.config.autoStart
    }
    this.config = next
    await this.persist()
    return { ...this.config }
  }

  async pickInstallPath(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      title: '选择 NewsCrawler 安装目录',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: this.config.installPath
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const picked = result.filePaths[0]
    await this.saveConfig({ installPath: picked, dataDir: defaultDataDir(picked) })
    return picked
  }

  async status(): Promise<CrawlerStatus> {
    await this.ensureLoaded()
    const installPathValid = existsSync(path.join(this.config.installPath, 'docker-compose.yml'))
    const dataDirValid = existsSync(this.config.dataDir)
    const dockerAvailable = await isDockerInstalled()
    const { available: dockerComposeAvailable } = await isDockerComposeInstalled()
    const webUiReachable = await checkWebUiReachable(this.config.webUiUrl)
    const state: CrawlerServiceState = webUiReachable ? 'RUNNING' : 'STOPPED'
    const message = webUiReachable
      ? `NewsCrawler Web UI 已在 ${this.config.webUiUrl} 响应`
      : !dockerAvailable
        ? '未检测到 docker 命令，请先安装 Docker Desktop'
        : !installPathValid
          ? `未找到 ${path.join(this.config.installPath, 'docker-compose.yml')}；请在系统管理 → 文章抓取 中配置安装路径或克隆仓库`
          : 'NewsCrawler 尚未启动'
    return {
      state,
      config: { ...this.config },
      dockerAvailable,
      dockerComposeAvailable,
      installPathValid,
      dataDirValid,
      webUiReachable,
      message,
      lastCheckedAt: new Date().toISOString()
    }
  }

  async start(): Promise<CrawlerStatus> {
    await this.ensureLoaded()
    const installPathValid = existsSync(path.join(this.config.installPath, 'docker-compose.yml'))
    if (!installPathValid) throw new Error(`未找到 docker-compose.yml：${this.config.installPath}`)
    if (!(await isDockerInstalled())) throw new Error('未检测到 docker 命令，请先安装 Docker Desktop 或 OrbStack')
    const { available: composeAvailable, dockerPath } = await isDockerComposeInstalled()
    if (!composeAvailable) throw new Error('未检测到 docker compose 子命令')
    if (!dockerPath) throw new Error('无法定位 docker 可执行文件路径')
    const env = {
      ...process.env,
      COMPOSE_PROJECT_NAME: 'newscrawler',
      // 补齐 Electron 默认 PATH 缺失的目录，让 docker 子进程也能找到其他 CLI
      PATH: buildAugmentedPath()
    }
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(dockerPath, ['compose', 'up', '-d'], { cwd: this.config.installPath, env, stdio: 'pipe' })
      let stderr = ''
      const timer = setTimeout(() => {
        proc.kill('SIGKILL')
        reject(new Error(`NewsCrawler 启动超时（>${DOCKER_START_TIMEOUT_MS / 1000}s）`))
      }, DOCKER_START_TIMEOUT_MS)
      proc.stderr.on('data', chunk => { stderr += chunk.toString() })
      proc.on('error', err => { clearTimeout(timer); reject(err) })
      proc.on('close', code => {
        clearTimeout(timer)
        if (code === 0) resolve()
        else reject(new Error(`docker compose up -d 退出码 ${code}：${stderr.slice(-500)}`))
      })
    })
    // 等待 Web UI 就绪（最多 30s）
    for (let i = 0; i < 30; i++) {
      if (await checkWebUiReachable(this.config.webUiUrl)) return this.status()
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    return this.status()
  }

  async stop(): Promise<CrawlerStatus> {
    await this.ensureLoaded()
    const installPathValid = existsSync(path.join(this.config.installPath, 'docker-compose.yml'))
    if (!installPathValid) throw new Error(`未找到 docker-compose.yml：${this.config.installPath}`)
    const { dockerPath } = await isDockerComposeInstalled()
    if (!dockerPath) {
      console.warn('[article-crawler] stop 跳过：未找到 docker 可执行文件')
      return this.status()
    }
    const env = { ...process.env, COMPOSE_PROJECT_NAME: 'newscrawler', PATH: buildAugmentedPath() }
    try {
      await execFileAsync(dockerPath, ['compose', 'down'], { cwd: this.config.installPath, env, timeout: 30_000 })
    } catch (error) {
      // 即便 down 失败也允许 UI 重新检查
      console.warn('[article-crawler] docker compose down 失败：', (error as Error).message)
    }
    return this.status()
  }

  async openInstallDir(): Promise<void> {
    await this.ensureLoaded()
    if (existsSync(this.config.installPath)) shell.openPath(this.config.installPath)
    else throw new Error(`安装目录不存在：${this.config.installPath}`)
  }

  async openDataDir(): Promise<void> {
    await this.ensureLoaded()
    if (existsSync(this.config.dataDir)) shell.openPath(this.config.dataDir)
    else throw new Error(`数据目录不存在：${this.config.dataDir}`)
  }

  /**
   * 列出 data 目录下的抓取产物。NewsCrawler 抓取后写入 `data/<platform>/<slug>.md` 或 `data/<slug>.json`。
   * 这里做扁平化扫描，统一归并为 CrawlerArticleSummary。
   */
  async listArticles(): Promise<CrawlerArticleSummary[]> {
    await this.ensureLoaded()
    if (!existsSync(this.config.dataDir)) return []
    const articles: CrawlerArticleSummary[] = []
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 4) return
      let entries: import('node:fs').Dirent[]
      try { entries = await fsp.readdir(dir, { withFileTypes: true }) } catch { return }
      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) { await walk(full, depth + 1); continue }
        if (!entry.isFile()) continue
        if (entry.name.startsWith('.')) continue
        const ext = path.extname(entry.name).toLowerCase()
        try {
          if (ext === '.md') {
            const stat = await fsp.stat(full)
            const raw = await fsp.readFile(full, 'utf8')
            const { meta, body } = parseFrontMatter(raw)
            articles.push({
              fileName: entry.name,
              filePath: full,
              platform: meta.platform || meta.source || path.basename(path.dirname(full)) || 'unknown',
              title: deriveTitle(meta, body, entry.name.replace(/\.md$/, '')),
              url: meta.url || meta.source_url || '',
              author: meta.author || meta.author_name || '',
              publishTime: meta.publish_time || meta.published || '',
              sizeBytes: stat.size,
              charCount: body.length,
              content: body,
              format: 'markdown'
            })
          } else if (ext === '.json') {
            const stat = await fsp.stat(full)
            const raw = await fsp.readFile(full, 'utf8')
            const parsed = JSON.parse(raw) as Record<string, unknown>
            const meta = (parsed.meta_info && typeof parsed.meta_info === 'object' ? parsed.meta_info : {}) as Record<string, unknown>
            const texts = Array.isArray(parsed.texts) ? parsed.texts.filter((t): t is string => typeof t === 'string') : []
            const body = texts.join('\n\n')
            articles.push({
              fileName: entry.name,
              filePath: full,
              platform: typeof parsed.platform === 'string' ? parsed.platform : (typeof meta.platform === 'string' ? meta.platform : 'unknown'),
              title: typeof parsed.title === 'string' ? parsed.title : entry.name.replace(/\.json$/, ''),
              url: typeof parsed.news_url === 'string' ? parsed.news_url : '',
              author: typeof meta.author_name === 'string' ? meta.author_name : '',
              publishTime: typeof meta.publish_time === 'string' ? meta.publish_time : '',
              sizeBytes: stat.size,
              charCount: body.length,
              content: body,
              format: 'json'
            })
          }
        } catch (error) {
          console.warn(`[article-crawler] 解析文件 ${full} 失败：`, (error as Error).message)
        }
      }
    }
    await walk(this.config.dataDir, 0)
    articles.sort((a, b) => (b.publishTime || '').localeCompare(a.publishTime || ''))
    return articles
  }

  /**
   * 上传指定文章到 MaxKB 知识库。复用 MaxkbKnowledgeService.uploadDocs。
   * 知识库选择：优先 `kbId`（用户选择）；否则使用默认第一个 agent KB（运维/合规/选品/listing）。
   * 频率限制：每篇 2 秒间隔。
   */
  async importToKnowledge(input: { kbId?: string; filePaths: string[]; category?: string }): Promise<CrawlerImportResult> {
    await this.ensureLoaded()
    if (!input.filePaths?.length) throw new Error('请选择至少一篇文章')
    // ESM dynamic import：必须使用 .js 后缀（编译产物）；as typeof 让 TS 拿到完整类型
    const { MaxkbKnowledgeService } = await import('./MaxkbKnowledgeService.js') as typeof import('./MaxkbKnowledgeService.js')
    const maxkbKnowledgeService = new MaxkbKnowledgeService()
    const kbList = await maxkbKnowledgeService.list()
    let targetKb = input.kbId ? kbList.customs.find(kb => kb.id === input.kbId) || kbList.agents.find(a => a.kb?.id === input.kbId)?.kb : undefined
    if (!targetKb) {
      const ops = kbList.agents.find(a => a.key === 'ops')?.kb
        || kbList.agents.find(a => a.key === 'compliance')?.kb
        || kbList.agents.find(a => a.key === 'sourcing')?.kb
        || kbList.agents.find(a => a.kb)?.kb
        || kbList.customs[0]
      if (!ops) throw new Error('未找到可用的 MaxKB 知识库，请先在 MaxKB Web Console 创建或检查 .env.local MAXKB_KNOWLEDGE_DATASETS')
      targetKb = ops
    }
    const uploaded: CrawlerImportResult['uploaded'] = []
    const failed: CrawlerImportResult['failed'] = []
    for (const filePath of input.filePaths) {
      try {
        const ids = await maxkbKnowledgeService.uploadDocs(targetKb.id, [filePath], input.category)
        const fileName = path.basename(filePath)
        for (const id of ids) uploaded.push({ fileName, docId: id })
        await new Promise(resolve => setTimeout(resolve, 2000))
      } catch (error) {
        failed.push({ fileName: path.basename(filePath), error: (error as Error).message })
      }
    }
    return { kbId: targetKb.id, kbName: targetKb.name, uploaded, failed }
  }

  /** 直接通过 NewsCrawler 后端 API 触发抓取（FastAPI 8000 端口） */
  async extractByUrl(url: string): Promise<CrawlerArticleSummary> {
    await this.ensureLoaded()
    const apiUrl = this.config.webUiUrl.replace(':3021', ':8000').replace(/\/$/, '')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 60_000)
    try {
      const resp = await fetch(`${apiUrl}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, format: 'both' }),
        signal: controller.signal
      })
      if (!resp.ok) throw new Error(`NewsCrawler 后端响应异常（HTTP ${resp.status}）`)
      const payload = await resp.json() as { markdown?: string; json?: { title?: string; platform?: string; news_url?: string; meta_info?: { author_name?: string; publish_time?: string } } }
      const data = payload.json || {}
      const title = data.title || url
      const platform = data.platform || 'unknown'
      const meta = data.meta_info || {}
      const content = payload.markdown || JSON.stringify(data, null, 2)
      const safeSlug = title.replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || Date.now().toString()
      const dir = path.join(this.config.dataDir, platform)
      await fsp.mkdir(dir, { recursive: true })
      const fileName = `${safeSlug}.md`
      const filePath = path.join(dir, fileName)
      const frontMatter = [
        '---',
        `title: "${title.replace(/"/g, '\\"')}"`,
        `platform: "${platform}"`,
        `url: "${data.news_url || url}"`,
        meta.author_name ? `author: "${meta.author_name}"` : null,
        meta.publish_time ? `publish_time: "${meta.publish_time}"` : null,
        `fetched_at: "${new Date().toISOString()}"`,
        '---',
        '',
        content
      ].filter(Boolean).join('\n')
      await fsp.writeFile(filePath, frontMatter, 'utf8')
      const stat = await fsp.stat(filePath)
      return {
        fileName,
        filePath,
        platform,
        title,
        url: data.news_url || url,
        author: meta.author_name || '',
        publishTime: meta.publish_time || '',
        sizeBytes: stat.size,
        charCount: content.length,
        content,
        format: 'markdown'
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
