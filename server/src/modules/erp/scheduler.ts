/**
 * ERP 巡盘调度器（规格 §9 / 方案 M6 / 数据流 4 / P5 验收标准）。
 *
 * 职责：
 *   - 定时（每 erpPatrolIntervalMs）对每个组织跑一次 runPatrolBatch（服务端 SERVER 通道直连，
 *     CLIENT 通道通过 clientDispatcher 下发；调度器默认只处理 SERVER 通道，CLIENT 由主进程桥接）；
 *   - 每天早 erpPatrolSummaryHour 点（默认 8 点）对每个组织跑 buildMorningSummary，落一条汇总通知。
 *
 * 防风控：分批/并发/间隔全部取自 config（erpPatrolBatchSize/Concurrency/DelayMs），
 * runPatrolBatch 内部用 runPool 强制并发上限 + 每请求前 sleep(delayMs)。
 *
 * 停止：调用 stopErpPatrolScheduler() 即可（index.ts SIGINT/SIGTERM）。
 */
import { prisma } from '../../lib/prisma.js'
import { config } from '../../config.js'
import { runPatrolBatch, type PatrolRunOptions } from './patrol.js'
import { buildMorningSummary } from './notify.js'

let patrolTimer: NodeJS.Timeout | null = null
let summaryTimer: NodeJS.Timeout | null = null
let running = false
let started = false
// P2-21：未注册钩子的空转跳过只告警一次，避免每 6h 刷同一条日志
let idleSkipLogged = false

// 生产环境由主进程/服务引导注入真实抓取器（SERVER 通道）与客户端下发器（CLIENT 通道）；
// 未注入时 patrolTick 直接跳过（P2-21：不再每 6h 全量扫库空转）
let registeredFetcher: PatrolRunOptions['fetcher'] | undefined
let registeredDispatcher: PatrolRunOptions['clientDispatcher'] | undefined

/** 注入 SERVER 通道真实抓取器（按 sourceUrl/货盘规则拉取最新价/库存等字段） */
export function registerPatrolFetcher(fetcher: PatrolRunOptions['fetcher']): void {
  registeredFetcher = fetcher
  idleSkipLogged = false
}

/** 注入 CLIENT 通道下发器（把巡盘任务下发到客户端内嵌浏览器，规避云 IP 风控） */
export function registerPatrolDispatcher(dispatcher: PatrolRunOptions['clientDispatcher']): void {
  registeredDispatcher = dispatcher
  idleSkipLogged = false
}

/** 读取已注入的巡盘钩子（供 POST /patrol/run 手动触发复用真实抓取器/下发器） */
export function getRegisteredPatrolHooks(): Pick<PatrolRunOptions, 'fetcher' | 'clientDispatcher'> {
  return { fetcher: registeredFetcher, clientDispatcher: registeredDispatcher }
}

/** 遍历所有组织 ID（调度器逐个组织巡盘，隔离数据） */
async function listOrgIds(): Promise<string[]> {
  const rows = await prisma.organization.findMany({ select: { id: true } })
  return rows.map(r => r.id)
}

async function patrolTick(): Promise<void> {
  // P2-21：SERVER 抓取器与 CLIENT 下发器都未注册时直接跳过——旧实现每 6h 全量扫库后
  // 因 fetcher/dispatcher 为 undefined 什么都不做，纯空转烧库
  if (!registeredFetcher && !registeredDispatcher) {
    if (!idleSkipLogged) {
      idleSkipLogged = true
      console.log('[erp-patrol] 未注册巡盘抓取器/下发器，跳过定时巡盘（注册后自动恢复；本提示只打一次）')
    }
    return
  }
  if (running) return
  running = true
  try {
    const orgIds = await listOrgIds()
    let scanned = 0
    let changed = 0
    let urgent = 0
    for (const orgId of orgIds) {
      // SERVER 通道用注入的 fetcher 直连抓取；CLIENT 通道用注入的 dispatcher 下发客户端。
      const result = await runPatrolBatch(orgId, {
        fetcher: registeredFetcher,
        clientDispatcher: registeredDispatcher
      })
      scanned += result.scanned
      changed += result.changed
      urgent += result.urgent
    }
    console.log(`[erp-patrol] 巡盘完成：${orgIds.length} 个组织，扫描 ${scanned}，变更 ${changed}，紧急 ${urgent}`)
  } catch (err) {
    console.error('[erp-patrol] 巡盘失败：', err instanceof Error ? err.message : err)
  } finally {
    running = false
  }
}

// P2-22：汇总重入锁——上一轮未完成时跳过本轮，避免长事务组织叠加并发汇总
let summaryRunning = false

async function summaryTick(): Promise<void> {
  if (summaryRunning) return
  summaryRunning = true
  try {
    const orgIds = await listOrgIds()
    for (const orgId of orgIds) {
      await buildMorningSummary(orgId)
    }
    console.log(`[erp-patrol] 早间汇总完成：${orgIds.length} 个组织`)
  } catch (err) {
    console.error('[erp-patrol] 早间汇总失败：', err instanceof Error ? err.message : err)
  } finally {
    summaryRunning = false
    // P2-22：stop 之后不得再重装定时器——旧实现 finally 无条件 scheduleSummary()，
    // 关停时在途的汇总结束又把定时器装回去，进程永远退不干净
    if (started) scheduleSummary()
  }
}

function nextRunAt(hour: number): Date {
  const now = new Date()
  const next = new Date(now)
  next.setHours(hour, 0, 0, 0)
  if (next.getTime() <= now.getTime() + 60_000) {
    next.setDate(next.getDate() + 1)
  }
  return next
}

function schedulePatrol(): void {
  if (patrolTimer) {
    clearInterval(patrolTimer)
    patrolTimer = null
  }
  const interval = Math.max(60_000, config.erpPatrolIntervalMs)
  patrolTimer = setInterval(() => { void patrolTick() }, interval)
  console.log(`[erp-patrol] 巡盘间隔：${Math.round(interval / 1000)}s`)
}

function scheduleSummary(): void {
  if (summaryTimer) {
    clearTimeout(summaryTimer)
    summaryTimer = null
  }
  const next = nextRunAt(config.erpPatrolSummaryHour)
  const delay = Math.max(next.getTime() - Date.now(), 60_000)
  summaryTimer = setTimeout(() => { void summaryTick() }, delay)
  console.log(`[erp-patrol] 下次早间汇总：${next.toISOString()}（${Math.round(delay / 1000)}s 后）`)
}

export function startErpPatrolScheduler(): void {
  if (started) return
  if (!config.erpPatrolEnabled) {
    console.log('[erp-patrol] 调度器已禁用（ERP_PATROL_ENABLED=false）')
    return
  }
  started = true
  schedulePatrol()
  scheduleSummary()
}

export function stopErpPatrolScheduler(): void {
  started = false
  if (patrolTimer) {
    clearInterval(patrolTimer)
    patrolTimer = null
  }
  if (summaryTimer) {
    clearTimeout(summaryTimer)
    summaryTimer = null
  }
}
