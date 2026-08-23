import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import type { RealShiftRequest, RealShiftResult } from '../../shared/contracts'

interface WorkerReport {
  profile: 'light' | 'balanced'
  original_score: RealShiftResult['originalScore']
  processed_score: RealShiftResult['processedScore']
  chosen_iteration: number
}

export class RealShiftService {
  private readonly assetRoot = path.join(app.getPath('userData'), 'ai-image-assets')

  async process(request: RealShiftRequest): Promise<RealShiftResult> {
    if (!request.localPath && !request.imageUrl) throw new Error('请选择需要处理的图片')
    if (request.imageUrl && !/^(https?:\/\/|data:image\/)/.test(request.imageUrl)) throw new Error('无效的图片地址')
    const safeProductId = request.productId.replace(/[^a-zA-Z0-9_-]/g, '_') || 'product'
    const runId = `${Date.now()}-${crypto.randomUUID().slice(0,8)}`
    const runDir = path.join(this.assetRoot, safeProductId, 'realshift', runId)
    const sourceDir = path.join(this.assetRoot, safeProductId, 'source')
    await fs.mkdir(runDir, { recursive:true })
    await fs.mkdir(sourceDir, { recursive:true })
    const originalPath = path.join(sourceDir, `${runId}.png`)
    const processedPath = path.join(runDir, `${request.profile}.jpg`)
    const reportPath = path.join(runDir, 'report.json')
    if (request.localPath) {
      await fs.copyFile(path.resolve(request.localPath), originalPath)
    } else if (request.imageUrl?.startsWith('data:image/')) {
      const encoded=request.imageUrl.split(',',2)[1]
      if (!encoded) throw new Error('图片数据不完整')
      await fs.writeFile(originalPath, Buffer.from(encoded, 'base64'))
    } else {
      const response = await fetch(request.imageUrl!)
      if (!response.ok) throw new Error(`生成图片下载失败（HTTP ${response.status}）`)
      await fs.writeFile(originalPath, Buffer.from(await response.arrayBuffer()))
    }
    const toolRoot = this.resolveToolRoot()
    const python = this.resolvePython(toolRoot)
    const worker = path.join(toolRoot, 'tools/realshift/worker.py')
    await this.runWorker(python, worker, ['--input',originalPath,'--output',processedPath,'--report',reportPath,'--profile',request.profile,'--iterations',request.profile==='light'?'3':'5','--seed',String(request.seed ?? Date.now()%2147483647)])
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8')) as WorkerReport
    return {
      originalDataUrl:`data:image/png;base64,${(await fs.readFile(originalPath)).toString('base64')}`,
      processedDataUrl:`data:image/jpeg;base64,${(await fs.readFile(processedPath)).toString('base64')}`,
      originalPath, processedPath, reportPath, profile:report.profile,
      originalScore:report.original_score, processedScore:report.processed_score, chosenIteration:report.chosen_iteration
    }
  }

  async saveSelection(reportPath: string, choice: 'original' | 'processed') {
    const resolved = path.resolve(reportPath)
    if (!resolved.startsWith(path.resolve(this.assetRoot) + path.sep)) throw new Error('无效的RealShift报告路径')
    const selectionPath = path.join(path.dirname(resolved), 'selection.json')
    await fs.writeFile(selectionPath, JSON.stringify({ choice, selectedAt:new Date().toISOString() }, null, 2), 'utf8')
    return { selectionPath }
  }

  /** 工具根目录：优先取含 tools/realshift/worker.py 的 app.getAppPath()，回退 process.cwd()（打包/快捷方式启动时不依赖启动 cwd） */
  private resolveToolRoot(): string {
    for (const root of [app.getAppPath(), process.cwd()]) {
      if (existsSync(path.join(root, 'tools/realshift/worker.py'))) return root
    }
    return app.getAppPath()
  }

  /** Python 解释器寻址顺序：REALSHIFT_PYTHON 环境变量 → 项目内置 venv（tools/realshift/.venv）→ 系统 python3 */
  private resolvePython(toolRoot: string): string {
    if (process.env.REALSHIFT_PYTHON) return process.env.REALSHIFT_PYTHON
    const venvPython = path.join(toolRoot, 'tools/realshift/.venv/bin/python')
    if (existsSync(venvPython)) return venvPython
    return 'python3'
  }

  /** 依赖预检：批量自然化前一次性校验工作器脚本与 Pillow/numpy 依赖，缺失时立即返回可操作错误 */
  async preflight(): Promise<{ ok: boolean; message: string }> {
    const toolRoot = this.resolveToolRoot()
    const worker = path.join(toolRoot, 'tools/realshift/worker.py')
    if (!existsSync(worker)) return { ok: false, message: `未找到自然化处理脚本：${worker}。请从项目根目录启动应用。` }
    const python = this.resolvePython(toolRoot)
    try {
      await this.runCommand(python, ['-c', 'import PIL, numpy'])
      return { ok: true, message: '' }
    } catch (reason) {
      const detail = (reason instanceof Error ? reason.message : String(reason)).split('\n').slice(-2).join(' ').slice(0, 200)
      const hint = /ENOENT/.test(detail)
        ? `未找到 Python 解释器（${python}）。请安装 Python 3 或设置 REALSHIFT_PYTHON 环境变量指向 python 可执行文件。`
        : `Python（${python}）缺少 Pillow/numpy 依赖。请在终端执行：${python} -m pip install pillow numpy`
      return { ok: false, message: `自然化处理不可用：${hint}（${detail}）` }
    }
  }

  private runCommand(command: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { env: { ...process.env, PYTHONUNBUFFERED: '1' } })
      let stderr = ''
      child.stderr.on('data', chunk => { stderr += String(chunk) })
      child.on('error', reject)
      child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `命令执行失败（退出码 ${code}）`)))
    })
  }

  private runWorker(python: string, worker: string, args: string[]) {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(python, [worker, ...args], { cwd:path.dirname(worker), env:{...process.env, PYTHONUNBUFFERED:'1'} })
      let stderr = ''
      child.stderr.on('data', chunk => { stderr += String(chunk) })
      child.on('error', reject)
      child.on('close', code => code===0 ? resolve() : reject(new Error(stderr.trim() || `RealShift处理失败（退出码 ${code}）`)))
    })
  }
}
