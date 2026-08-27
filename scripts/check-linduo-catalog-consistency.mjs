#!/usr/bin/env node
/**
 * Linduo 模型目录「双源对账」守卫。
 *
 * 背景：commit ed1e4fd 将 LINDUO_MODELS 抽离到 src/shared/linduoCatalog.ts 时漏搬 8 个
 * OpenAI 模型（gpt-5.4 / 5.4-mini / 5.5 / 5.6-luna / 5.6-sol / 5.6-terra /
 * gpt-image-2 / gpt-image-2-all），导致 pricing-fallback 与 MultimodalVision 引用的
 * 模型在目录中消失。本脚本把「目录真值」与「消费方真值」做强对账，杜绝同类回归。
 *
 * 源 A（目录真值）：
 *   - src/shared/linduoCatalog.ts（渲染层 + 主进程共用）
 *   - server/src/modules/linduo/linduoCatalog.ts（服务端镜像）
 * 源 B（消费方真值）：
 *   - server/src/modules/linduo/pricing-fallback.ts（价格兜底表，modelId 必须全部在目录中）
 *   - src/main/advisor/MultimodalVision.ts（视觉调用硬编码的 gpt-* id 必须在目录中）
 *
 * 规则：
 *   1. 双目录 id 集合完全一致（含顺序一致，防止镜像 drift）；
 *   2. pricing-fallback 的每个 modelId ⊆ 目录 id；
 *   3. MultimodalVision 引用的 gpt-* id ⊆ 目录 id；
 *   4. 头注「N 个模型目录 / OpenAI M」== 实际长度 / 实际 openai 数。
 *
 * 用法：pnpm lint:catalog（任一规则失败退出码 1，可挂 pre-commit / CI）。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

const SHARED = 'src/shared/linduoCatalog.ts'
const SERVER = 'server/src/modules/linduo/linduoCatalog.ts'
const PRICING = 'server/src/modules/linduo/pricing-fallback.ts'
const VISION = 'src/main/advisor/MultimodalVision.ts'

const extractIds = (src) => [...src.matchAll(/\{\s*id:\s*'([^']+)'/g)].map((m) => m[1])

const sharedSrc = read(SHARED)
const serverSrc = read(SERVER)
const sharedIds = extractIds(sharedSrc)
const serverIds = extractIds(serverSrc)
const sharedSet = new Set(sharedIds)

const pricingIds = [...read(PRICING).matchAll(/\bmodelId:\s*'([^']+)'/g)].map((m) => m[1])
const visionIds = [...new Set([...read(VISION).matchAll(/["'](gpt-[\w.-]+)["']/g)].map((m) => m[1]))]

const errors = []

// 规则 1：双目录镜像一致（集合 + 顺序）
const onlyShared = sharedIds.filter((id) => !serverIds.includes(id))
const onlyServer = serverIds.filter((id) => !sharedIds.includes(id))
if (onlyShared.length) errors.push(`仅 shared 目录存在：${onlyShared.join(', ')}`)
if (onlyServer.length) errors.push(`仅 server 目录存在：${onlyServer.join(', ')}`)
if (!onlyShared.length && !onlyServer.length && sharedIds.join('|') !== serverIds.join('|'))
  errors.push('双目录 id 集合相同但顺序不一致（镜像 drift）')

// 规则 2：价格源 ⊆ 目录
const missingInPricing = [...new Set(pricingIds)].filter((id) => !sharedSet.has(id))
if (missingInPricing.length)
  errors.push(`pricing-fallback 有价格但目录缺失（调用会 404）：${missingInPricing.join(', ')}`)

// 规则 3：视觉引用 ⊆ 目录
const missingInVision = visionIds.filter((id) => !sharedSet.has(id))
if (missingInVision.length)
  errors.push(`MultimodalVision 硬编码引用但目录缺失：${missingInVision.join(', ')}`)

// 规则 4：头注数量 == 实际
const headTotal = (sharedSrc.match(/(\d+)\s*个模型目录/) || [])[1]
if (headTotal && Number(headTotal) !== sharedIds.length)
  errors.push(`shared 头注总数 ${headTotal} != 实际 ${sharedIds.length}`)
const headOpenai = (sharedSrc.match(/OpenAI\s*(\d+)/) || [])[1]
const openaiCount = (sharedSrc.match(/vendor:\s*'openai'/g) || []).length
if (headOpenai && Number(headOpenai) !== openaiCount)
  errors.push(`shared 头注 OpenAI ${headOpenai} != 实际 ${openaiCount}`)
const serverHeadTotal = (serverSrc.match(/(\d+)\s*个模型目录/) || [])[1]
if (serverHeadTotal && Number(serverHeadTotal) !== serverIds.length)
  errors.push(`server 头注总数 ${serverHeadTotal} != 实际 ${serverIds.length}`)

if (errors.length) {
  console.error('[linduo-catalog] 双源对账失败：')
  for (const e of errors) console.error('  ✗ ' + e)
  process.exit(1)
}

console.log(
  `[linduo-catalog] 双源对账通过：目录 ${sharedIds.length} 个（OpenAI ${openaiCount}），` +
    `价格 ${pricingIds.length} 条，视觉引用 ${visionIds.length} 个，双目录镜像一致。`
)
