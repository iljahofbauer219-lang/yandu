/**
 * ERP 图片下载队列 worker（规格 §5 / 方案 M2 + §3 数据流 2）。
 *
 * 数据流：UI 触发 → ErpDownloadJob 入队 → worker GET source_url（并发上限 + 退避重试）
 *        → media storage.put 落盘 → local_path 回填 → 全部成功后 status: collected→downloaded。
 *
 * 安全红线（规格 §5「下载封禁/裂图」+ §6.1）：
 *   - local_path 切换后全系统禁引货盘外链：resolveImageUrl 在 localPath 存在时只返回本地签名 URL；
 *     assertDownloadedUsesLocalPath 在 DOWNLOADED 及以后状态断言无空 localPath 外链图。
 *   - 失败图片的**行 id** 记录进 ErpDownloadJob.failedUrls（不存外链原值：该列持久化且对
 *     任何持 erp.warehouse.view 的角色可读，存外链会旁路 §2.2 的 SQL 层剥离），
 *     重试耗尽不阻塞其余图片（并发池逐图独立）。
 */
import { prisma } from '../../lib/prisma.js'
import { Prisma } from '@prisma/client'
import { createMediaStorage, type MediaStorage } from '../../lib/media/storage.js'
import { writeAudit } from '../../lib/audit.js'
import { httpError } from '../../lib/errors.js'
import { config } from '../../config.js'
import type { CurrentUser } from '../../plugins/auth.js'
import { redactErrorText, redactFailedUrls } from './projection.js'

/** 下载任务状态合法值（P1-9：查询/写入统一走 enum 校验，任意状态串 400） */
export const DOWNLOAD_JOB_STATUSES = ['PENDING', 'RUNNING', 'DONE', 'PARTIAL', 'FAILED'] as const

export type DownloadJobStatus = (typeof DOWNLOAD_JOB_STATUSES)[number]

export interface DownloadJobView {
  id: string
  productId: string
  status: string
  total: number
  done: number
  failedUrls: string[]
  error: string
  createdAt: string
  updatedAt: string
}

/** 下载运行参数（可注入，便于单测模拟断网/快速重试） */
export interface DownloadOptions {
  /** 并发上限（规格 §5：队列并发上限防封禁） */
  concurrency?: number
  /** 首次失败后的重试次数（总尝试 = retries + 1） */
  retries?: number
  /** 每次重试前的退避延时（ms），按序取用，末位复用 */
  backoffMs?: number[]
  /** 单次请求超时（ms） */
  timeoutMs?: number
  /** 可注入 fetcher（单测模拟断网/HTTP 错误） */
  fetcher?: typeof fetch
  /** 可注入存储（单测用内存存储） */
  storage?: MediaStorage
}

function defaultOptions(): Required<Pick<DownloadOptions, 'concurrency' | 'retries' | 'timeoutMs'>> & { backoffMs: number[] } {
  return {
    concurrency: config.erpDownloadConcurrency || 4,
    retries: config.erpDownloadRetries || 0,
    backoffMs: config.erpDownloadBackoffMs.length ? config.erpDownloadBackoffMs : [500, 1500, 4000],
    timeoutMs: config.erpDownloadTimeoutMs || 20000
  }
}

const EXT_BY_CONTENT_TYPE: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
  'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif'
}

/** 由 content-type 推导扩展名（非法/未知回落 .jpg），用于媒体 key */
export function extFromContentType(contentType: string): string {
  const normalized = ((contentType || '').split(';')[0] ?? '').trim().toLowerCase()
  return EXT_BY_CONTENT_TYPE[normalized] ?? '.jpg'
}

/** 由 source_url 推导扩展名（路径后缀优先，回落 content-type） */
export function extFromUrl(url: string, contentType: string): string {
  try {
    const pathname = new URL(url).pathname
    const match = pathname.toLowerCase().match(/\.(jpe?g|png|webp|gif|avif)$/)
    if (match) return match[1] === 'jpeg' ? '.jpg' : `.${match[1]}`
  } catch {
    /* 非法 URL 回落 content-type */
  }
  return extFromContentType(contentType)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export interface FetchedImage {
  buffer: Buffer
  contentType: string
  /** 实际尝试次数（含首次），供单测断言重试发生 */
  attempts: number
}

/**
 * 纯下载逻辑（可注入 fetcher）：退避重试直至成功或耗尽次数。
 * 成功返回 buffer + content-type + 尝试次数；耗尽抛出聚合错误。
 */
export async function fetchImageWithRetry(url: string, options: DownloadOptions = {}): Promise<FetchedImage> {
  const defaults = defaultOptions()
  const fetcher = options.fetcher ?? fetch
  const retries = options.retries ?? defaults.retries
  const backoff = options.backoffMs ?? defaults.backoffMs
  const timeoutMs = options.timeoutMs ?? defaults.timeoutMs

  let lastError = '未知错误'
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(backoff[Math.min(attempt - 1, backoff.length - 1)] ?? 500)
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      const response = await fetcher(url, { signal: controller.signal })
      clearTimeout(timer)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const arrayBuffer = await response.arrayBuffer()
      const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || 'image/jpeg'
      return { buffer: Buffer.from(arrayBuffer), contentType, attempts: attempt + 1 }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(`下载失败（共尝试 ${retries + 1} 次）：${lastError}`)
}

/** 落盘：local 驱动直接 put；oss 驱动服务端下载后走预签名 PUT 直传。返回媒体 key（写入 localPath） */
export async function storeDownloadedImage(
  storage: MediaStorage,
  orgId: string,
  productId: string,
  imageId: string,
  buffer: Buffer,
  contentType: string,
  sourceUrl: string
): Promise<string> {
  const ext = extFromUrl(sourceUrl, contentType)
  const key = `org-${orgId}/erp/${productId}/${imageId}${ext}`
  if (storage.driver === 'local') {
    await storage.put(key, buffer, contentType)
    return key
  }
  const uploadUrl = storage.getUploadUrl(key, 600)
  if (!uploadUrl) throw new Error('OSS 存储未返回上传预签名 URL')
  const response = await fetch(uploadUrl, { method: 'PUT', body: buffer, headers: { 'content-type': contentType } })
  if (!response.ok) throw new Error(`OSS 上传失败：HTTP ${response.status}`)
  return key
}

/** 并发池：逐图独立处理，单图失败不影响其余（规格 §5 裂图隔离） */
async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  const limit = Math.max(1, Math.min(concurrency, items.length))
  let index = 0
  const runners = Array.from({ length: limit }, async () => {
    while (index < items.length) {
      const current = items[index] as T
      index += 1
      await worker(current)
    }
  })
  await Promise.all(runners)
}

function toJobView(job: {
  id: string; productId: string; status: string; total: number; done: number
  failedUrls: unknown; error: string; createdAt: string; updatedAt: string
}): DownloadJobView {
  // failed_urls 是持久化 Json 列且历史上存过货盘外链原值，读时统一红化（纵深防御，兜住存量毒数据）；
  // error 列同理：兜底路径可能写入含主机/URL 片段的异常 message。
  return {
    id: job.id, productId: job.productId, status: job.status, total: job.total,
    done: job.done, failedUrls: redactFailedUrls(job.failedUrls), error: redactErrorText(job.error),
    createdAt: job.createdAt, updatedAt: job.updatedAt
  }
}

/**
 * 执行下载任务：处理该产品所有 localPath 为空且有 sourceUrl 的图片。
 * 全部成功 → 产品 status: COLLECTED→DOWNLOADED（仅当仍为 COLLECTED，不覆盖已加工状态）。
 * 部分失败 → job.status=PARTIAL/FAILED，failedUrls 记录失败图片的行 id。
 */
export async function runDownloadJob(jobId: string, options: DownloadOptions = {}): Promise<DownloadJobView> {
  const storage = options.storage ?? createMediaStorage()
  const concurrency = options.concurrency ?? defaultOptions().concurrency
  const now = () => new Date().toISOString()

  const job = await prisma.erpDownloadJob.findUnique({ where: { id: jobId } })
  if (!job) throw httpError(404, 'ERP_DOWNLOAD_JOB_NOT_FOUND', `下载任务不存在：${jobId}`)

  await prisma.erpDownloadJob.update({ where: { id: jobId }, data: { status: 'RUNNING', updatedAt: now() } })

  const targets = await prisma.erpProductImage.findMany({
    where: { productId: job.productId, localPath: '' },
    orderBy: { sortOrder: 'asc' }
  })
  const pending = targets.filter(image => image.sourceUrl && image.sourceUrl.trim().length > 0)

  const failedUrls: string[] = []
  let done = job.done
  let doneSinceStart = 0

  await runPool(pending, concurrency, async image => {
    try {
      const fetched = await fetchImageWithRetry(image.sourceUrl, options)
      const key = await storeDownloadedImage(storage, job.orgId, job.productId, image.id, fetched.buffer, fetched.contentType, image.sourceUrl)
      await prisma.erpProductImage.update({ where: { id: image.id }, data: { localPath: key } })
      done += 1
      doneSinceStart += 1
    } catch {
      // 记图片行主键而非外链原值：failed_urls 持久化且对 erp.warehouse.view 可读，
      // 存外链会旁路 projection 的 SQL 层剥离。id 稳定（覆盖/重排 sortOrder 后仍可对上），
      // 排障时经产品详情 images[].id 对回；采集角色本有 erp.source.view 可见该图 sourceUrl。
      failedUrls.push(image.id)
    }
    // 逐图回写进度，前端可轮询 done/total
    await prisma.erpDownloadJob.update({
      where: { id: jobId },
      data: { done, failedUrls: failedUrls as Prisma.InputJsonValue, updatedAt: now() }
    }).catch(() => { /* 进度回写失败不中断下载 */ })
  })

  const remaining = await prisma.erpProductImage.count({ where: { productId: job.productId, localPath: '' } })
  const total = job.total || pending.length
  let status: DownloadJobStatus
  let error = ''
  if (remaining === 0 && failedUrls.length === 0) {
    status = 'DONE'
  } else if (doneSinceStart > 0) {
    status = 'PARTIAL'
    error = `${failedUrls.length} 张图片下载失败`
  } else {
    status = 'FAILED'
    error = failedUrls.length ? `${failedUrls.length} 张图片下载失败（无成功）` : '无可下载图片'
  }

  await prisma.erpDownloadJob.update({
    where: { id: jobId },
    data: { status, done, total, failedUrls: failedUrls as Prisma.InputJsonValue, error, updatedAt: now() }
  })

  // 全图落盘后推进产品状态：仅 COLLECTED→DOWNLOADED，绝不回退已加工状态
  if (status === 'DONE') {
    const product = await prisma.erpProduct.findUnique({ where: { id: job.productId }, select: { status: true } })
    if (product && product.status === 'COLLECTED') {
      await prisma.erpProduct.update({ where: { id: job.productId }, data: { status: 'DOWNLOADED', updatedAt: now() } })
      await writeAudit(prisma, {
        orgId: job.orgId,
        userId: null,
        action: 'ERP_DOWNLOAD_COMPLETE',
        targetType: 'ErpProduct',
        targetId: job.productId,
        detail: { jobId, images: done }
      }).catch(() => { /* 审计失败不阻塞状态推进 */ })
    }
  }

  const updated = await prisma.erpDownloadJob.findUnique({ where: { id: jobId } })
  return toJobView(updated!)
}

/** 入队：创建 ErpDownloadJob 并后台异步执行（非阻塞），立即返回任务视图供前端轮询 */
export async function enqueueProductImageDownload(
  user: CurrentUser,
  productId: string,
  options: DownloadOptions = {}
): Promise<DownloadJobView> {
  const product = await prisma.erpProduct.findFirst({
    where: { id: productId, orgId: user.orgId },
    select: { id: true, status: true, images: { where: { localPath: '' }, select: { id: true, sourceUrl: true } } }
  })
  if (!product) throw httpError(404, 'ERP_PRODUCT_NOT_FOUND', '产品不存在或无权访问')
  const targets = product.images.filter(image => image.sourceUrl && image.sourceUrl.trim().length > 0)
  if (targets.length === 0) throw httpError(400, 'ERP_NO_IMAGES_TO_DOWNLOAD', '该产品没有待下载的外链图片')

  const now = new Date().toISOString()
  const job = await prisma.erpDownloadJob.create({
    data: {
      orgId: user.orgId, productId, status: 'PENDING', total: targets.length,
      done: 0, failedUrls: [], error: '', createdAt: now, updatedAt: now
    }
  })
  await writeAudit(prisma, {
    orgId: user.orgId, userId: user.id, action: 'ERP_DOWNLOAD_ENQUEUE',
    targetType: 'ErpProduct', targetId: productId, detail: { jobId: job.id, total: targets.length }
  }).catch(() => { /* 审计失败不阻塞入队 */ })

  // fire-and-forget：后台执行，异常兜底写入 job.status=FAILED（保持接口非阻塞）
  void runDownloadJob(job.id, options).catch(async error => {
    await prisma.erpDownloadJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', error: redactErrorText(error instanceof Error ? error.message : String(error)), updatedAt: new Date().toISOString() }
    }).catch(() => { /* 兜底失败忽略 */ })
  })

  return toJobView(job)
}

/** 下载任务列表（队列进度/失败 URL）：按创建时间倒序 */
export async function listDownloadJobs(user: CurrentUser, query: { productId?: string; status?: string; pageSize?: number } = {}): Promise<DownloadJobView[]> {
  const where: Record<string, unknown> = { orgId: user.orgId }
  if (query.productId) where.productId = query.productId
  if (query.status) where.status = query.status
  const jobs = await prisma.erpDownloadJob.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: Math.min(100, Math.max(1, query.pageSize ?? 50))
  })
  return jobs.map(toJobView)
}

export async function getDownloadJob(user: CurrentUser, jobId: string): Promise<DownloadJobView> {
  const job = await prisma.erpDownloadJob.findFirst({ where: { id: jobId, orgId: user.orgId } })
  if (!job) throw httpError(404, 'ERP_DOWNLOAD_JOB_NOT_FOUND', '下载任务不存在或无权访问')
  return toJobView(job)
}

/**
 * P2-22 重启恢复：服务重启会中断在途下载，遗留的 PENDING/RUNNING job 永远不会再推进。
 * 启动时统一标 FAILED（error 说明服务重启），前端可经 POST /download-jobs/:id/retry 重新入队。
 * 幂等：无遗留行时零更新。
 */
export async function recoverStalledDownloadJobs(): Promise<number> {
  const result = await prisma.erpDownloadJob.updateMany({
    where: { status: { in: ['PENDING', 'RUNNING'] } },
    data: { status: 'FAILED', error: '服务重启导致任务中断，请重试', updatedAt: new Date().toISOString() }
  })
  return result.count
}

/**
 * 下载任务重试：对已终止（FAILED/PARTIAL/DONE）的任务重新入队。
 * 不重置 done 计数（已落盘图片不会重复下载，runDownloadJob 只处理 localPath='' 的行），
 * 清空失败清单与错误信息后 fire-and-forget 重跑，返回 PENDING 视图供前端继续轮询。
 */
export async function retryDownloadJob(user: CurrentUser, jobId: string, options: DownloadOptions = {}): Promise<DownloadJobView> {
  const job = await prisma.erpDownloadJob.findFirst({ where: { id: jobId, orgId: user.orgId } })
  if (!job) throw httpError(404, 'ERP_DOWNLOAD_JOB_NOT_FOUND', '下载任务不存在或无权访问')
  if (job.status === 'PENDING' || job.status === 'RUNNING') {
    throw httpError(409, 'ERP_DOWNLOAD_JOB_ACTIVE', '下载任务仍在排队/执行中，无需重试')
  }
  const reset = await prisma.erpDownloadJob.update({
    where: { id: jobId },
    data: { status: 'PENDING', failedUrls: [], error: '', updatedAt: new Date().toISOString() }
  })
  await writeAudit(prisma, {
    orgId: user.orgId, userId: user.id, action: 'ERP_DOWNLOAD_RETRY',
    targetType: 'ErpDownloadJob', targetId: jobId, detail: { productId: job.productId, previousStatus: job.status }
  }).catch(() => { /* 审计失败不阻塞重试 */ })

  // fire-and-forget：与 enqueue 相同的非阻塞语义，异常兜底写 FAILED
  void runDownloadJob(jobId, options).catch(async error => {
    await prisma.erpDownloadJob.update({
      where: { id: jobId },
      data: { status: 'FAILED', error: redactErrorText(error instanceof Error ? error.message : String(error)), updatedAt: new Date().toISOString() }
    }).catch(() => { /* 兜底失败忽略 */ })
  })

  return toJobView(reset)
}
