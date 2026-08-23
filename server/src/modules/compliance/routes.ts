import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { writeAudit } from '../../lib/audit.js'
import { prisma } from '../../lib/prisma.js'
import { ComplianceRepository } from './repository.js'

const riskLevelSchema = z.enum(['P0', 'P1', 'P2', 'P3'])
const reviewStatusSchema = z.enum(['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'INACTIVE'])

const ruleDraftSchema = z.object({
  id: z.string().optional(),
  code: z.string().trim().min(1),
  platform: z.string().trim().min(1),
  marketplaceSite: z.string().trim().default('ALL'),
  country: z.string().trim().default('ALL'),
  category: z.string().trim().default('ALL'),
  ruleType: z.string().trim().min(1),
  riskLevel: riskLevelSchema,
  reviewStatus: reviewStatusSchema,
  title: z.string().trim().min(1),
  summary: z.string().default(''),
  keywords: z.array(z.string()).default([]),
  requiredFields: z.array(z.string()).default([]),
  remediation: z.string().default(''),
  sourceUrl: z.string().default(''),
  effectiveFrom: z.string().default('')
})

const reviewSourceChangeSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  reviewedBy: z.string().trim().min(1, '请输入审批人'),
  note: z.string().trim().min(1, '请输入审批意见')
})

const recallItemSchema = z.object({
  externalId: z.string(),
  title: z.string(),
  description: z.string().default(''),
  products: z.string().default(''),
  hazards: z.string().default(''),
  countries: z.string().default(''),
  recallDate: z.string().default(''),
  sourceUrl: z.string().default('')
})

const policySnapshotSchema = z.object({
  contentHash: z.string().trim().min(1),
  summary: z.string().default('')
})

const sourceErrorSchema = z.object({ error: z.string().trim().min(1) })

const profileDraftSchema = z.object({
  id: z.string().optional(),
  productId: z.string().trim().min(1),
  platform: z.string().trim().min(1),
  marketplaceSite: z.string().trim().default(''),
  country: z.string().trim().default(''),
  categoryId: z.string().default(''),
  categoryName: z.string().default(''),
  title: z.string().default(''),
  brand: z.string().default(''),
  manufacturer: z.string().default(''),
  importer: z.string().default(''),
  euResponsiblePerson: z.string().default(''),
  model: z.string().default(''),
  batchNumber: z.string().default(''),
  barcode: z.string().default(''),
  originCountry: z.string().default(''),
  materials: z.string().default(''),
  ageGrade: z.string().default(''),
  batteryType: z.string().default('')
})

const documentDraftSchema = z.object({
  id: z.string().optional(),
  productId: z.string().trim().min(1),
  documentType: z.string().trim().min(1, '文件类型不能为空'),
  name: z.string().trim().min(1, '文件名称不能为空'),
  documentNumber: z.string().default(''),
  issuer: z.string().default(''),
  modelNumbers: z.string().default(''),
  countries: z.string().default(''),
  issuedAt: z.string().default(''),
  expiresAt: z.string().default(''),
  status: z.enum(['MISSING', 'PENDING_REVIEW', 'APPROVED', 'EXPIRING', 'EXPIRED', 'REJECTED']),
  fileName: z.string().default(''),
  filePath: z.string().trim().min(1, '上传文件不能为空'),
  reviewNote: z.string().default('')
})

const templateDraftSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1),
  platform: z.string().trim().min(1),
  marketplaceSite: z.string().trim().default('ALL'),
  country: z.string().trim().default('ALL'),
  category: z.string().trim().default('ALL'),
  requiredFields: z.array(z.string()).default([]),
  requiredDocuments: z.array(z.string()).default([]),
  requiredWarnings: z.array(z.string()).default([]),
  logisticsRequirements: z.array(z.string()).default([]),
  requiresManualReview: z.boolean().default(false),
  active: z.boolean().default(true)
})

const updateTaskSchema = z.object({
  status: z.enum(['OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED']),
  assignee: z.string().default(''),
  resolution: z.string().default('')
})

const updateAlertSchema = z.object({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']),
  note: z.string().default('')
})

const updateEnforcementCaseSchema = z.object({
  status: z.enum(['OPEN', 'IN_PROGRESS', 'RESOLVED']),
  assignee: z.string().default(''),
  resolution: z.string().default('')
})

const checkRequestSchema = z.object({
  productId: z.string().trim().min(1),
  platform: z.string().trim().min(1),
  marketplaceSite: z.string().trim().min(1),
  country: z.string().trim().min(1),
  categoryId: z.string().optional(),
  categoryName: z.string().optional(),
  title: z.string(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
  itemSpecifics: z.array(z.object({ name: z.string(), value: z.string() })).optional()
})

const recheckSchema = z.object({
  platform: z.string().trim().default('ALL'),
  country: z.string().trim().default('ALL')
})

const reviewCheckSchema = z.object({
  reviewedBy: z.string().trim().default(''),
  note: z.string().trim().default('')
})

const issuePermitSchema = z.object({
  checkId: z.string().trim().min(1),
  validDays: z.number().int().min(1).max(365).default(7)
})

export async function complianceRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate)

  const repoOf = (orgId: string) => new ComplianceRepository(orgId)

  // 知识工作区（全量聚合视图）
  app.get('/workspace', async request => repoOf(request.currentUser.orgId).getKnowledgeWorkspace())

  // 证据报表
  app.get('/evidence-report', { preHandler: [app.requirePermission('compliance.manage')] }, async request =>
    repoOf(request.currentUser.orgId).getEvidenceReport())

  // ---------------- 规则 ----------------
  app.post('/rules', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const body = ruleDraftSchema.parse(request.body)
    const rule = await repoOf(request.currentUser.orgId).saveRule(body)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id, action: 'compliance.rule.save',
      targetType: 'compliance_rule', targetId: rule.id, detail: { code: rule.code, version: rule.currentVersion }, ip: request.ip
    })
    return rule
  })

  app.patch('/rules/:id/status', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const { id } = request.params as { id: string }
    const { status } = z.object({ status: reviewStatusSchema }).parse(request.body)
    const rule = await repoOf(request.currentUser.orgId).setRuleStatus(id, status)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id, action: 'compliance.rule.status',
      targetType: 'compliance_rule', targetId: id, detail: { status }, ip: request.ip
    })
    return rule
  })

  // ---------------- 来源与召回 ----------------
  app.post('/source-changes/:id/review', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const { id } = request.params as { id: string }
    const body = reviewSourceChangeSchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).reviewSourceChange(id, body.decision, body.reviewedBy, body.note)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id, action: 'compliance.source-change.review',
      targetType: 'compliance_source_change', targetId: id, detail: { decision: body.decision }, ip: request.ip
    })
    return result
  })

  app.post('/sources/:id/recalls', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const { id } = request.params as { id: string }
    const { items } = z.object({ items: z.array(recallItemSchema) }).parse(request.body)
    const imported = await repoOf(request.currentUser.orgId).importRecalls(id, items)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id, action: 'compliance.recalls.import',
      targetType: 'compliance_source', targetId: id, detail: { imported }, ip: request.ip
    })
    return { imported }
  })

  app.post('/sources/:id/policy-snapshot', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const { id } = request.params as { id: string }
    const body = policySnapshotSchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).recordPolicySnapshot(id, body.contentHash, body.summary)
    if (result.changed) {
      await writeAudit(prisma, {
        orgId: request.currentUser.orgId, userId: request.currentUser.id, action: 'compliance.source.policy-changed',
        targetType: 'compliance_source', targetId: id, detail: result, ip: request.ip
      })
    }
    return result
  })

  app.post('/sources/:id/error', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const { id } = request.params as { id: string }
    const body = sourceErrorSchema.parse(request.body)
    await repoOf(request.currentUser.orgId).markSourceError(id, body.error)
    return { ok: true }
  })

  // ---------------- 商品档案 / 文件 / 模板 ----------------
  app.post('/profiles', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const body = profileDraftSchema.parse(request.body)
    const profile = await repoOf(request.currentUser.orgId).saveProfile(body)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id, action: 'compliance.profile.save',
      targetType: 'compliance_profile', targetId: profile.id, detail: { productId: profile.productId }, ip: request.ip
    })
    return profile
  })

  app.post('/documents', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const body = documentDraftSchema.parse(request.body)
    const document = await repoOf(request.currentUser.orgId).saveDocument(body)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id, action: 'compliance.document.save',
      targetType: 'compliance_document', targetId: document.id, detail: { productId: document.productId, status: document.status }, ip: request.ip
    })
    return document
  })

  app.post('/templates', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const body = templateDraftSchema.parse(request.body)
    const template = await repoOf(request.currentUser.orgId).saveTemplate(body)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id, action: 'compliance.template.save',
      targetType: 'compliance_template', targetId: template.id, detail: { name: template.name }, ip: request.ip
    })
    return template
  })

  // ---------------- 任务 / 告警 / 处置 ----------------
  app.patch('/tasks/:id', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const { id } = request.params as { id: string }
    const body = updateTaskSchema.parse(request.body)
    const task = await repoOf(request.currentUser.orgId).updateTask(id, body.status, body.assignee, body.resolution)
    return task
  })

  app.patch('/alerts/:id', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const { id } = request.params as { id: string }
    const body = updateAlertSchema.parse(request.body)
    const alert = await repoOf(request.currentUser.orgId).updateAlert(id, body.status, body.note)
    return alert
  })

  app.patch('/enforcement-cases/:id', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const { id } = request.params as { id: string }
    const body = updateEnforcementCaseSchema.parse(request.body)
    const enforcementCase = await repoOf(request.currentUser.orgId).updateEnforcementCase(id, body.status, body.assignee, body.resolution)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id, action: 'compliance.enforcement.update',
      targetType: 'compliance_enforcement_case', targetId: id, detail: { status: body.status }, ip: request.ip
    })
    return enforcementCase
  })

  // ---------------- 合规检查 ----------------
  app.post('/checks', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const body = checkRequestSchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).runCheck(body)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id, action: 'compliance.check.run',
      targetType: 'product', targetId: body.productId, detail: { gateStatus: result.gateStatus, findings: result.findings.length }, ip: request.ip
    })
    return result
  })

  app.post('/checks/recheck', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const body = recheckSchema.parse(request.body)
    return repoOf(request.currentUser.orgId).recheckProfiles(body.platform, body.country)
  })

  app.get('/checks/latest/:productId', async request => {
    const { productId } = request.params as { productId: string }
    const check = await repoOf(request.currentUser.orgId).getLatestCheck(productId)
    return check ?? null
  })

  app.post('/checks/:id/review', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const { id } = request.params as { id: string }
    const body = reviewCheckSchema.parse(request.body)
    const result = await repoOf(request.currentUser.orgId).reviewCheck(id, body.reviewedBy || request.currentUser.name, body.note)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id, action: 'compliance.check.review',
      targetType: 'compliance_check_run', targetId: id, detail: { gateStatus: result.gateStatus }, ip: request.ip
    })
    return result
  })

  // ---------------- 发布许可 ----------------
  app.post('/permits', { preHandler: [app.requirePermission('compliance.manage')] }, async request => {
    const body = issuePermitSchema.parse(request.body)
    const permit = await repoOf(request.currentUser.orgId).issueReleasePermit(body.checkId, body.validDays)
    await writeAudit(prisma, {
      orgId: request.currentUser.orgId, userId: request.currentUser.id, action: 'compliance.permit.issue',
      targetType: 'compliance_release_permit', targetId: permit.id, detail: { productId: permit.productId, expiresAt: permit.expiresAt }, ip: request.ip
    })
    return permit
  })

  app.get('/permits/:id/report', async request => {
    const { id } = request.params as { id: string }
    return repoOf(request.currentUser.orgId).getReleasePermitReport(id)
  })
}
