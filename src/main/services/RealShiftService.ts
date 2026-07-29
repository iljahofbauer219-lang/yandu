import { app } from 'electron'
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
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
    const python = process.env.REALSHIFT_PYTHON || 'python3'
    const worker = path.join(process.cwd(), 'tools/realshift/worker.py')
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
