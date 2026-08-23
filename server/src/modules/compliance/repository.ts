import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import { prisma } from '../../lib/prisma.js'
import { httpError } from '../../lib/errors.js'
import {
  complianceCheckFingerprint,
  complianceRecallMatches,
  complianceScopeMatches,
  fnv1aHex,
  requiredRecallSourceId
} from './engine.js'
import type {
  ComplianceAlert,
  ComplianceAlertStatus,
  ComplianceBatchRecheckResult,
  ComplianceCategoryTemplate,
  ComplianceCategoryTemplateDraft,
  ComplianceCheckRequest,
  ComplianceCheckResult,
  ComplianceDocumentDraft,
  ComplianceDocumentRecord,
  ComplianceEnforcementAction,
  ComplianceEnforcementCase,
  ComplianceEnforcementStatus,
  ComplianceFinding,
  ComplianceKnowledgeWorkspace,
  ComplianceProductProfile,
  ComplianceProductProfileDraft,
  ComplianceRecall,
  ComplianceReleasePermit,
  ComplianceReviewStatus,
  ComplianceRiskLevel,
  ComplianceRule,
  ComplianceRuleDraft,
  ComplianceSourceChangeDecision,
  ComplianceSourceChangeReviewResult,
  ComplianceTaskRecord,
  ComplianceTaskStatus
} from './types.js'

type Db = PrismaClient | Prisma.TransactionClient

const RISK_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

/**
 * 合规域仓储：从 AppDatabase.ts 合规段（原 2774-3370 行）忠实移植。
 * 差异：全部查询强制 orgId 过滤；JSON 列由 Prisma Json 原生承载（去掉 JSON.parse/stringify）；
 * BEGIN IMMEDIATE → prisma.$transaction；多语句写操作包裹事务保证多用户下的原子性。
 */
export class ComplianceRepository {
  constructor(
    private readonly orgId: string,
    private readonly db: Db = prisma
  ) {}

  /** 在事务中执行；若当前实例已处于事务则直接复用 */
  private inTx<T>(fn: (repo: ComplianceRepository) => Promise<T>): Promise<T> {
    if (this.db !== prisma) return fn(this)
    return prisma.$transaction(tx => fn(new ComplianceRepository(this.orgId, tx)))
  }

  // ---------------------------------------------------------------- 映射

  private mapRule(row: Prisma.ComplianceRuleGetPayload<{ include: { versions: true } }>): ComplianceRule {
    const versions = row.versions
      .map(version => ({
        id: version.id,
        ruleId: version.ruleId,
        version: version.version,
        title: version.title,
        summary: version.summary,
        condition: (version.conditionJson ?? {}) as { keywords?: string[]; requiredFields?: string[] },
        remediation: version.remediation,
        sourceUrl: version.sourceUrl,
        effectiveFrom: version.effectiveFrom,
        createdAt: version.createdAt
      }))
      .sort((left, right) => right.version - left.version)
    const current = versions.find(item => item.version === row.currentVersion) || versions[0]
    if (!current) throw new Error(`compliance rule ${row.id} has no versions`)
    return {
      id: row.id,
      code: row.code,
      platform: row.platform,
      marketplaceSite: row.marketplaceSite,
      country: row.country,
      category: row.category,
      ruleType: row.ruleType,
      riskLevel: row.riskLevel as ComplianceRiskLevel,
      reviewStatus: row.reviewStatus as ComplianceReviewStatus,
      currentVersion: row.currentVersion,
      updatedAt: row.updatedAt,
      version: current,
      versions
    }
  }

  private mapDocument(row: Prisma.ComplianceDocumentGetPayload<object>): ComplianceDocumentRecord {
    let status = row.status as ComplianceDocumentRecord['status']
    if (row.expiresAt && status === 'APPROVED') {
      const days = (Date.parse(row.expiresAt) - Date.now()) / 86_400_000
      if (days < 0) status = 'EXPIRED'
      else if (days <= 30) status = 'EXPIRING'
    }
    return {
      id: row.id,
      productId: row.productId,
      documentType: row.documentType,
      name: row.name,
      documentNumber: row.documentNumber,
      issuer: row.issuer,
      modelNumbers: row.modelNumbers,
      countries: row.countries,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      status,
      fileName: row.fileName,
      filePath: row.filePath,
      reviewNote: row.reviewNote,
      updatedAt: row.updatedAt
    }
  }

  private mapPermit(row: Prisma.ComplianceReleasePermitGetPayload<object>): ComplianceReleasePermit {
    return {
      id: row.id,
      productId: row.productId,
      platform: row.platform,
      marketplaceSite: row.marketplaceSite,
      checkId: row.checkId,
      ruleSetVersion: row.ruleSetVersion,
      inputFingerprint: row.inputFingerprint,
      gateStatus: row.gateStatus as ComplianceReleasePermit['gateStatus'],
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
      status: row.status as ComplianceReleasePermit['status'],
      revokedAt: row.revokedAt ?? undefined,
      revokeReason: row.revokeReason || undefined
    }
  }

  private mapEnforcementCase(row: Prisma.ComplianceEnforcementCaseGetPayload<object>): ComplianceEnforcementCase {
    return {
      id: row.id,
      productId: row.productId,
      platform: row.platform,
      marketplaceSite: row.marketplaceSite,
      listingId: row.listingId,
      storeId: row.storeId,
      title: row.title,
      viewUrl: row.viewUrl,
      riskLevel: row.riskLevel as ComplianceEnforcementCase['riskLevel'],
      reason: row.reason,
      recommendedAction: row.recommendedAction as ComplianceEnforcementCase['recommendedAction'],
      status: row.status as ComplianceEnforcementCase['status'],
      assignee: row.assignee,
      resolution: row.resolution,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      resolvedAt: row.resolvedAt ?? undefined
    }
  }

  // ---------------------------------------------------------------- 内部写操作

  private async createTask(productId: string, checkId: string | undefined, taskType: ComplianceTaskRecord['taskType'], riskLevel: ComplianceTaskRecord['riskLevel'], title: string, detail: string) {
    const existing = await this.db.complianceTask.findFirst({
      where: { orgId: this.orgId, productId, taskType, title, status: { in: ['OPEN', 'IN_REVIEW'] } },
      select: { id: true }
    })
    if (existing) return
    const now = new Date().toISOString()
    const dueDays = riskLevel === 'P0' ? 1 : riskLevel === 'P1' ? 3 : 7
    const dueAt = new Date(Date.now() + dueDays * 86_400_000).toISOString()
    await this.db.complianceTask.create({
      data: { id: randomUUID(), orgId: this.orgId, productId, checkId: checkId || null, taskType, riskLevel, title, detail, status: 'OPEN', assignee: '', dueAt, resolution: '', createdAt: now, updatedAt: now }
    })
  }

  private async recordAudit(action: string, entityType: string, entityId: string, detail: string) {
    await this.db.complianceAuditEvent.create({
      data: { id: randomUUID(), orgId: this.orgId, action, entityType, entityId, detail, createdAt: new Date().toISOString() }
    })
  }

  private async createAlert(alertType: ComplianceAlert['alertType'], riskLevel: ComplianceAlert['riskLevel'], entityId: string, title: string, detail: string) {
    const now = new Date().toISOString()
    const existing = await this.db.complianceAlert.findFirst({
      where: { orgId: this.orgId, alertType, entityId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
      select: { id: true }
    })
    if (existing) {
      await this.db.complianceAlert.update({ where: { id: existing.id }, data: { riskLevel, title, detail, updatedAt: now } })
    } else {
      await this.db.complianceAlert.create({
        data: { id: randomUUID(), orgId: this.orgId, alertType, riskLevel, entityId, title, detail, status: 'OPEN', note: '', createdAt: now, updatedAt: now }
      })
    }
  }

  private async createEnforcementCase(productId: string, riskLevel: ComplianceEnforcementCase['riskLevel'], reason: string, recommendedAction: ComplianceEnforcementAction) {
    const listing = await this.db.ebayListing.findFirst({
      where: { orgId: this.orgId, id: productId, status: 'ACTIVE' },
      select: { id: true, storeId: true, marketplaceId: true, listingId: true, title: true, viewUrl: true }
    })
    if (!listing) return
    const profile = await this.db.complianceProductProfile.findUnique({
      where: { orgId_productId: { orgId: this.orgId, productId } },
      select: { platform: true, marketplaceSite: true, title: true }
    })
    const existing = await this.db.complianceEnforcementCase.findFirst({
      where: { orgId: this.orgId, productId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      select: { id: true, riskLevel: true }
    })
    const now = new Date().toISOString()
    if (existing) {
      const nextRisk = (RISK_RANK[riskLevel] ?? 3) < (RISK_RANK[existing.riskLevel] ?? 3) ? riskLevel : (existing.riskLevel as ComplianceEnforcementCase['riskLevel'])
      await this.db.complianceEnforcementCase.update({ where: { id: existing.id }, data: { riskLevel: nextRisk, reason, recommendedAction, updatedAt: now } })
      await this.recordAudit('ENFORCEMENT_CASE_UPDATED', 'ENFORCEMENT_CASE', existing.id, `${nextRisk} · ${reason}`)
      return
    }
    const id = randomUUID()
    await this.db.complianceEnforcementCase.create({
      data: {
        id,
        orgId: this.orgId,
        productId,
        platform: profile?.platform || 'EBAY',
        marketplaceSite: profile?.marketplaceSite || listing.marketplaceId,
        listingId: listing.listingId,
        storeId: listing.storeId,
        title: profile?.title || listing.title,
        viewUrl: listing.viewUrl,
        riskLevel,
        reason,
        recommendedAction,
        status: 'OPEN',
        assignee: '',
        resolution: '',
        createdAt: now,
        updatedAt: now
      }
    })
    await this.recordAudit('ENFORCEMENT_CASE_CREATED', 'ENFORCEMENT_CASE', id, `${riskLevel} · ${reason}`)
  }

  /** 供 eBay 草稿验证等跨域流程复用：最新合规结论有效时自动关闭未结处置单 */
  async resolveEnforcementCases(productId: string, resolution: string) {
    const now = new Date().toISOString()
    const result = await this.db.complianceEnforcementCase.updateMany({
      where: { orgId: this.orgId, productId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
      data: { status: 'RESOLVED', resolution, resolvedAt: now, updatedAt: now }
    })
    if (result.count) await this.recordAudit('ENFORCEMENT_CASE_AUTO_RESOLVED', 'PRODUCT', productId, `${resolution} · ${result.count} 个处置单`)
  }

  private async expireReleasePermits() {
    const now = new Date().toISOString()
    const expired = await this.db.complianceReleasePermit.findMany({
      where: { orgId: this.orgId, status: 'VALID', expiresAt: { lte: now } },
      select: { id: true, productId: true }
    })
    for (const permit of expired) {
      await this.db.complianceReleasePermit.update({
        where: { id: permit.id },
        data: { status: 'EXPIRED', revokedAt: now, revokeReason: '发布许可已超过有效期' }
      })
      await this.recordAudit('RELEASE_PERMIT_EXPIRED', 'PRODUCT', permit.productId, '发布许可已超过有效期')
      await this.createEnforcementCase(permit.productId, 'P1', '在售商品发布许可已过期，需重新执行合规检查', 'PAUSE_AND_REVIEW')
    }
  }

  private async revokeReleasePermits(productId: string, reason: string, createEnforcement = true) {
    const now = new Date().toISOString()
    const result = await this.db.complianceReleasePermit.updateMany({
      where: { orgId: this.orgId, productId, status: 'VALID' },
      data: { status: 'REVOKED', revokedAt: now, revokeReason: reason }
    })
    if (result.count) await this.recordAudit('RELEASE_PERMIT_REVOKED', 'PRODUCT', productId, `${reason} · ${result.count} 张许可`)
    if (result.count && createEnforcement) await this.createEnforcementCase(productId, 'P1', `在售商品发布许可已吊销：${reason}`, 'PAUSE_AND_REVIEW')
  }

  // ---------------------------------------------------------------- 工作区

  async getKnowledgeWorkspace(): Promise<ComplianceKnowledgeWorkspace> {
    await this.expireReleasePermits()
    const orgId = this.orgId
    const [sourceRows, sourceChangeRows, ruleRows, recallRows, profileRows, documentRows, templateRows, taskRows, alertRows, auditRows, permitRows, enforcementRows] = await Promise.all([
      this.db.complianceSource.findMany({ where: { orgId }, orderBy: [{ sourceType: 'asc' }, { name: 'asc' }] }),
      this.db.complianceSourceChange.findMany({ where: { orgId }, orderBy: { detectedAt: 'desc' }, take: 100 }),
      this.db.complianceRule.findMany({ where: { orgId }, include: { versions: true }, orderBy: { updatedAt: 'desc' } }),
      this.db.complianceRecall.findMany({ where: { orgId }, orderBy: [{ recallDate: 'desc' }, { updatedAt: 'desc' }], take: 500 }),
      this.db.complianceProductProfile.findMany({ where: { orgId }, orderBy: { updatedAt: 'desc' } }),
      this.db.complianceDocument.findMany({ where: { orgId }, orderBy: { updatedAt: 'desc' } }),
      this.db.complianceCategoryTemplate.findMany({ where: { orgId }, orderBy: { updatedAt: 'desc' } }),
      this.db.complianceTask.findMany({ where: { orgId } }),
      this.db.complianceAlert.findMany({ where: { orgId }, take: 300 }),
      this.db.complianceAuditEvent.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 500 }),
      this.db.complianceReleasePermit.findMany({ where: { orgId }, take: 500 }),
      this.db.complianceEnforcementCase.findMany({ where: { orgId }, take: 500 })
    ])

    const sources = sourceRows.map(row => ({
      id: row.id,
      name: row.name,
      authority: row.authority,
      sourceType: row.sourceType as ComplianceKnowledgeWorkspace['sources'][number]['sourceType'],
      url: row.url,
      syncMode: row.syncMode as ComplianceKnowledgeWorkspace['sources'][number]['syncMode'],
      syncStatus: row.syncStatus as ComplianceKnowledgeWorkspace['sources'][number]['syncStatus'],
      lastSyncedAt: row.lastSyncedAt ?? undefined,
      lastCheckedAt: row.lastCheckedAt ?? undefined,
      lastChangedAt: row.lastChangedAt ?? undefined,
      contentHash: row.contentHash || undefined,
      changeCount: row.changeCount,
      lastError: row.lastError ?? undefined
    }))
    const sourceChanges = sourceChangeRows.map(row => ({
      id: row.id,
      sourceId: row.sourceId,
      oldHash: row.oldHash,
      newHash: row.newHash,
      summary: row.summary,
      affectedRuleIds: (row.affectedRuleIds ?? []) as string[],
      status: row.status as ComplianceKnowledgeWorkspace['sourceChanges'][number]['status'],
      detectedAt: row.detectedAt,
      reviewedAt: row.reviewedAt ?? undefined,
      reviewedBy: row.reviewedBy || undefined,
      reviewNote: row.reviewNote || undefined
    }))
    const rules = ruleRows.map(row => this.mapRule(row))
    const recalls: ComplianceRecall[] = recallRows.map(row => ({
      id: row.id,
      sourceId: row.sourceId,
      externalId: row.externalId,
      title: row.title,
      description: row.description,
      products: row.products,
      hazards: row.hazards,
      countries: row.countries,
      recallDate: row.recallDate,
      sourceUrl: row.sourceUrl,
      updatedAt: row.updatedAt
    }))
    const profiles: ComplianceProductProfile[] = profileRows.map(row => ({
      id: row.id,
      productId: row.productId,
      platform: row.platform,
      marketplaceSite: row.marketplaceSite,
      country: row.country,
      categoryId: row.categoryId,
      categoryName: row.categoryName,
      title: row.title,
      brand: row.brand,
      manufacturer: row.manufacturer,
      importer: row.importer,
      euResponsiblePerson: row.euResponsiblePerson,
      model: row.model,
      batchNumber: row.batchNumber,
      barcode: row.barcode,
      originCountry: row.originCountry,
      materials: row.materials,
      ageGrade: row.ageGrade,
      batteryType: row.batteryType,
      updatedAt: row.updatedAt
    }))
    const documents = documentRows.map(row => this.mapDocument(row))
    for (const item of documents.filter(doc => doc.status === 'EXPIRING' || doc.status === 'EXPIRED')) {
      await this.createTask(item.productId, undefined, 'DOCUMENT_EXPIRING', item.status === 'EXPIRED' ? 'P1' : 'P2', item.status === 'EXPIRED' ? '合规文件已过期' : '合规文件即将过期', `${item.name} · ${item.expiresAt}`)
    }
    const templates: ComplianceCategoryTemplate[] = templateRows.map(row => ({
      id: row.id,
      name: row.name,
      platform: row.platform,
      marketplaceSite: row.marketplaceSite,
      country: row.country,
      category: row.category,
      requiredFields: (row.requiredFieldsJson ?? []) as string[],
      requiredDocuments: (row.requiredDocumentsJson ?? []) as string[],
      requiredWarnings: (row.requiredWarningsJson ?? []) as string[],
      logisticsRequirements: (row.logisticsRequirementsJson ?? []) as string[],
      requiresManualReview: Boolean(row.requiresManualReview),
      active: Boolean(row.active),
      updatedAt: row.updatedAt
    }))
    const tasks: ComplianceTaskRecord[] = taskRows
      .map(row => ({
        id: row.id,
        productId: row.productId,
        checkId: row.checkId ?? undefined,
        taskType: row.taskType as ComplianceTaskRecord['taskType'],
        riskLevel: row.riskLevel as ComplianceTaskRecord['riskLevel'],
        title: row.title,
        detail: row.detail,
        status: row.status as ComplianceTaskRecord['status'],
        assignee: row.assignee,
        dueAt: row.dueAt,
        resolution: row.resolution,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
      .sort((left, right) => (RISK_RANK[left.riskLevel] ?? 3) - (RISK_RANK[right.riskLevel] ?? 3) || right.updatedAt.localeCompare(left.updatedAt))
    const alertStatusRank: Record<string, number> = { OPEN: 0, ACKNOWLEDGED: 1 }
    const alerts: ComplianceAlert[] = alertRows
      .map(row => ({
        id: row.id,
        alertType: row.alertType as ComplianceAlert['alertType'],
        riskLevel: row.riskLevel as ComplianceAlert['riskLevel'],
        entityId: row.entityId,
        title: row.title,
        detail: row.detail,
        status: row.status as ComplianceAlert['status'],
        note: row.note,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }))
      .sort((left, right) =>
        (alertStatusRank[left.status] ?? 2) - (alertStatusRank[right.status] ?? 2)
        || (RISK_RANK[left.riskLevel] ?? 3) - (RISK_RANK[right.riskLevel] ?? 3)
        || right.updatedAt.localeCompare(left.updatedAt))
    const auditEvents = auditRows.map(row => ({ id: row.id, action: row.action, entityType: row.entityType, entityId: row.entityId, detail: row.detail, createdAt: row.createdAt }))
    const permitStatusRank: Record<string, number> = { VALID: 0, REVOKED: 1 }
    const permits = permitRows
      .map(row => this.mapPermit(row))
      .sort((left, right) => (permitStatusRank[left.status] ?? 2) - (permitStatusRank[right.status] ?? 2) || right.issuedAt.localeCompare(left.issuedAt))
    const enforcementStatusRank: Record<string, number> = { OPEN: 0, IN_PROGRESS: 1 }
    const enforcementCases = enforcementRows
      .map(row => this.mapEnforcementCase(row))
      .sort((left, right) =>
        (enforcementStatusRank[left.status] ?? 2) - (enforcementStatusRank[right.status] ?? 2)
        || (RISK_RANK[left.riskLevel] ?? 3) - (RISK_RANK[right.riskLevel] ?? 3)
        || right.updatedAt.localeCompare(left.updatedAt))

    const blockedRows = await this.db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) AS count FROM (
        SELECT gate_status, ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY checked_at DESC) AS row_number
        FROM compliance_check_runs WHERE org_id = ${orgId}
      ) latest WHERE row_number = 1 AND gate_status = 'BLOCKED'`
    const blockedProducts = Number(blockedRows[0]?.count ?? 0)

    const staleLimit = Date.now() - 7 * 24 * 60 * 60_000
    return {
      sources,
      sourceChanges,
      rules,
      recalls,
      profiles,
      documents,
      templates,
      tasks,
      alerts,
      auditEvents,
      permits,
      enforcementCases,
      metrics: {
        activeRules: rules.filter(item => item.reviewStatus === 'ACTIVE').length,
        pendingReview: rules.filter(item => item.reviewStatus === 'PENDING_REVIEW').length,
        recalls: recalls.length,
        staleSources: sources.filter(item => !item.lastSyncedAt || Date.parse(item.lastSyncedAt) < staleLimit).length,
        profiles: profiles.length,
        openTasks: tasks.filter(item => item.status === 'OPEN' || item.status === 'IN_REVIEW').length,
        expiringDocuments: documents.filter(item => item.status === 'EXPIRING' || item.status === 'EXPIRED').length,
        blockedProducts,
        validPermits: permits.filter(item => item.status === 'VALID').length,
        openEnforcementCases: enforcementCases.filter(item => item.status !== 'RESOLVED').length
      }
    }
  }

  // ---------------------------------------------------------------- 规则与来源

  async saveRule(draft: ComplianceRuleDraft): Promise<ComplianceRule> {
    return this.inTx(async repo => {
      const now = new Date().toISOString()
      const existing = draft.id
        ? await repo.db.complianceRule.findFirst({ where: { orgId: repo.orgId, id: draft.id } })
        : null
      const id = existing?.id ?? randomUUID()
      const version = existing ? existing.currentVersion + 1 : 1
      const reviewStatus: ComplianceReviewStatus = existing ? 'PENDING_REVIEW' : draft.reviewStatus
      if (existing) {
        await repo.db.complianceRule.update({
          where: { id },
          data: { code: draft.code, platform: draft.platform, marketplaceSite: draft.marketplaceSite, country: draft.country, category: draft.category, ruleType: draft.ruleType, riskLevel: draft.riskLevel, reviewStatus, currentVersion: version, updatedAt: now }
        })
      } else {
        await repo.db.complianceRule.create({
          data: { id, orgId: repo.orgId, code: draft.code, platform: draft.platform, marketplaceSite: draft.marketplaceSite, country: draft.country, category: draft.category, ruleType: draft.ruleType, riskLevel: draft.riskLevel, reviewStatus, currentVersion: version, createdAt: now, updatedAt: now }
        })
      }
      await repo.db.complianceRuleVersion.create({
        data: {
          id: randomUUID(),
          orgId: repo.orgId,
          ruleId: id,
          version,
          title: draft.title,
          summary: draft.summary,
          conditionJson: { keywords: draft.keywords, requiredFields: draft.requiredFields },
          remediation: draft.remediation,
          sourceUrl: draft.sourceUrl,
          effectiveFrom: draft.effectiveFrom,
          createdAt: now
        }
      })
      await repo.recordAudit(existing ? 'RULE_VERSION_CREATED' : 'RULE_CREATED', 'RULE', id, `${draft.code} v${version} · ${reviewStatus}`)
      const workspace = await repo.getKnowledgeWorkspace()
      return workspace.rules.find(item => item.id === id)!
    })
  }

  async setRuleStatus(ruleId: string, status: ComplianceReviewStatus): Promise<ComplianceRule> {
    return this.inTx(async repo => {
      const now = new Date().toISOString()
      const result = await repo.db.complianceRule.updateMany({ where: { orgId: repo.orgId, id: ruleId }, data: { reviewStatus: status, updatedAt: now } })
      if (!result.count) throw httpError(404, 'RULE_NOT_FOUND', '合规规则不存在')
      if (status === 'ACTIVE') {
        const changes = await repo.db.complianceSourceChange.findMany({ where: { orgId: repo.orgId, status: 'PENDING_REVIEW' }, select: { id: true, affectedRuleIds: true } })
        for (const change of changes) {
          const ids = (change.affectedRuleIds ?? []) as string[]
          if (!ids.includes(ruleId) || !ids.length) continue
          const pending = await repo.db.complianceRule.count({ where: { orgId: repo.orgId, id: { in: ids }, reviewStatus: { not: 'ACTIVE' } } })
          if (!pending) {
            await repo.db.complianceSourceChange.update({
              where: { id: change.id },
              data: { status: 'REVIEWED', reviewedAt: now, reviewedBy: '逐条规则审核', reviewNote: '全部受影响规则已逐条启用' }
            })
          }
        }
      }
      const workspace = await repo.getKnowledgeWorkspace()
      const rule = workspace.rules.find(item => item.id === ruleId)!
      if (status === 'ACTIVE') {
        const matchedProfiles = workspace.profiles.filter(profile =>
          (rule.platform === 'ALL' || rule.platform === profile.platform)
          && (rule.marketplaceSite === 'ALL' || rule.marketplaceSite === profile.marketplaceSite)
          && (rule.country === 'ALL' || rule.country === profile.country || (rule.country === 'EU' && ['DE', 'FR', 'IT', 'ES', 'NL', 'BE', 'PL', 'SE', 'IE', 'AT'].includes(profile.country)))
          && (rule.category === 'ALL' || rule.category === profile.categoryId || rule.category === profile.categoryName))
        for (const profile of matchedProfiles) {
          await repo.createTask(profile.productId, undefined, 'RULE_UPDATE', rule.riskLevel, `规则更新后需重新检查：${rule.version.title}`, `${rule.code} v${rule.currentVersion}`)
        }
      }
      await repo.recordAudit('RULE_STATUS_UPDATED', 'RULE', ruleId, `${rule.code} v${rule.currentVersion} · ${status}`)
      return rule
    })
  }

  async reviewSourceChange(changeId: string, decision: ComplianceSourceChangeDecision, reviewedBy: string, note: string): Promise<ComplianceSourceChangeReviewResult> {
    const change = await this.db.complianceSourceChange.findFirst({ where: { orgId: this.orgId, id: changeId } })
    if (!change) throw httpError(404, 'SOURCE_CHANGE_NOT_FOUND', '政策变化记录不存在')
    if (change.status !== 'PENDING_REVIEW') throw httpError(400, 'SOURCE_CHANGE_REVIEWED', '该政策变化已经完成审批')
    if (!reviewedBy.trim()) throw httpError(400, 'REVIEWER_REQUIRED', '请输入审批人')
    if (!note.trim()) throw httpError(400, 'REVIEW_NOTE_REQUIRED', '请输入审批意见')
    const newer = await this.db.complianceSourceChange.count({
      where: { orgId: this.orgId, sourceId: change.sourceId, status: 'PENDING_REVIEW', detectedAt: { gt: change.detectedAt } }
    })
    if (newer) throw httpError(400, 'SOURCE_CHANGE_OUTDATED', '该来源存在更新的待审批变化，请先处理最新变化')
    const sourceId = change.sourceId
    const affectedRuleIds = (change.affectedRuleIds ?? []) as string[]
    const source = await this.db.complianceSource.findFirst({ where: { orgId: this.orgId, id: sourceId }, select: { name: true } })
    const platformBySource: Record<string, string> = { 'source-ebay': 'EBAY', 'source-ozon': 'OZON', 'source-aliexpress': 'ALIEXPRESS' }
    const platform = platformBySource[sourceId] || 'ALL'
    const now = new Date().toISOString()
    await this.inTx(async repo => {
      if (decision === 'APPROVED') {
        for (const ruleId of affectedRuleIds) {
          await repo.db.complianceRule.updateMany({ where: { orgId: repo.orgId, id: ruleId }, data: { reviewStatus: 'ACTIVE', updatedAt: now } })
        }
        await repo.db.complianceSourceChange.updateMany({
          where: { orgId: repo.orgId, sourceId, status: 'PENDING_REVIEW' },
          data: { status: 'REVIEWED', reviewedAt: now, reviewedBy: reviewedBy.trim(), reviewNote: note.trim() }
        })
      } else {
        for (const ruleId of affectedRuleIds) {
          const rule = await repo.db.complianceRule.findFirst({ where: { orgId: repo.orgId, id: ruleId }, select: { currentVersion: true } })
          if (!rule) continue
          const previousVersion = Math.max(1, rule.currentVersion - 1)
          await repo.db.complianceRule.update({ where: { id: ruleId }, data: { currentVersion: previousVersion, reviewStatus: 'ACTIVE', updatedAt: now } })
        }
        await repo.db.complianceSourceChange.update({
          where: { id: changeId },
          data: { status: 'REJECTED', reviewedAt: now, reviewedBy: reviewedBy.trim(), reviewNote: note.trim() }
        })
        const olderPending = await repo.db.complianceSourceChange.count({ where: { orgId: repo.orgId, sourceId, status: 'PENDING_REVIEW' } })
        if (olderPending && affectedRuleIds.length) {
          await repo.db.complianceRule.updateMany({ where: { orgId: repo.orgId, id: { in: affectedRuleIds } }, data: { reviewStatus: 'PENDING_REVIEW', updatedAt: now } })
        }
      }
      const remaining = await repo.db.complianceSourceChange.count({ where: { orgId: repo.orgId, sourceId, status: 'PENDING_REVIEW' } })
      if (!remaining) {
        await repo.db.complianceTask.updateMany({
          where: { orgId: repo.orgId, taskType: 'RULE_UPDATE', status: { in: ['OPEN', 'IN_REVIEW'] }, title: { startsWith: `${platform} 官方政策来源发生变化` } },
          data: { status: 'RESOLVED', resolution: `政策变化已${decision === 'APPROVED' ? '批准' : '驳回'}：${note.trim()}`, updatedAt: now }
        })
        await repo.db.complianceAlert.updateMany({
          where: { orgId: repo.orgId, alertType: 'SOURCE_CHANGE', entityId: sourceId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
          data: { status: 'RESOLVED', note: `${reviewedBy.trim()}：${note.trim()}`, updatedAt: now }
        })
      }
    })
    await this.recordAudit(decision === 'APPROVED' ? 'SOURCE_CHANGE_APPROVED' : 'SOURCE_CHANGE_REJECTED', 'SOURCE_CHANGE', changeId, `${source?.name || sourceId} · ${reviewedBy.trim()} · ${note.trim()}`)
    const recheck = await this.recheckProfiles(platform)
    const workspace = await this.getKnowledgeWorkspace()
    return { change: workspace.sourceChanges.find(item => item.id === changeId)!, recheck, workspace }
  }

  async importRecalls(sourceId: string, items: Array<Omit<ComplianceRecall, 'id' | 'sourceId' | 'updatedAt'>>): Promise<number> {
    return this.inTx(async repo => {
      const now = new Date().toISOString()
      const source = await repo.db.complianceSource.findFirst({ where: { orgId: repo.orgId, id: sourceId }, select: { id: true } })
      if (!source) throw httpError(404, 'SOURCE_NOT_FOUND', '合规来源不存在')
      for (const item of items) {
        await repo.db.complianceRecall.upsert({
          where: { orgId_sourceId_externalId: { orgId: repo.orgId, sourceId, externalId: item.externalId } },
          create: { id: randomUUID(), orgId: repo.orgId, sourceId, externalId: item.externalId, title: item.title, description: item.description, products: item.products, hazards: item.hazards, countries: item.countries, recallDate: item.recallDate, sourceUrl: item.sourceUrl, updatedAt: now },
          update: { title: item.title, description: item.description, products: item.products, hazards: item.hazards, countries: item.countries, recallDate: item.recallDate, sourceUrl: item.sourceUrl, updatedAt: now }
        })
      }
      await repo.db.complianceSource.update({
        where: { orgId_id: { orgId: repo.orgId, id: sourceId } },
        data: { syncStatus: 'READY', lastSyncedAt: now, lastCheckedAt: now, lastError: null }
      })
      const profiles = await repo.db.complianceProductProfile.findMany({
        where: { orgId: repo.orgId },
        select: { productId: true, title: true, model: true, country: true }
      })
      for (const item of items) {
        for (const profile of profiles) {
          if (requiredRecallSourceId(profile.country) !== sourceId) continue
          const text = `${profile.title} ${profile.model}`
          if (complianceRecallMatches(text, `${item.title} ${item.products}`)) {
            await repo.createTask(profile.productId, undefined, 'RECALL_MATCH', 'P0', `疑似命中新增官方召回：${item.title}`, `${item.hazards || item.description} · ${item.sourceUrl}`)
            await repo.createAlert('RECALL_MATCH', 'P0', profile.productId, `商品疑似命中官方召回：${item.title}`, `${item.hazards || item.description} · ${item.sourceUrl}`)
            await repo.revokeReleasePermits(profile.productId, '商品疑似命中新增官方召回')
          }
        }
      }
      await repo.recordAudit('RECALL_SOURCE_SYNCED', 'SOURCE', sourceId, `导入或更新 ${items.length} 条官方召回记录`)
      return items.length
    })
  }

  async recordPolicySnapshot(sourceId: string, contentHash: string, summary: string): Promise<{ changed: boolean; versionsCreated: number }> {
    const source = await this.db.complianceSource.findFirst({ where: { orgId: this.orgId, id: sourceId }, select: { contentHash: true } })
    if (!source) throw httpError(404, 'SOURCE_NOT_FOUND', '合规来源不存在')
    const now = new Date().toISOString()
    const oldHash = source.contentHash || ''
    if (!oldHash) {
      await this.db.complianceSource.update({
        where: { orgId_id: { orgId: this.orgId, id: sourceId } },
        data: { contentHash, syncStatus: 'READY', lastSyncedAt: now, lastCheckedAt: now, lastError: null }
      })
      return { changed: false, versionsCreated: 0 }
    }
    if (oldHash === contentHash) {
      await this.db.complianceSource.update({
        where: { orgId_id: { orgId: this.orgId, id: sourceId } },
        data: { syncStatus: 'READY', lastSyncedAt: now, lastCheckedAt: now, lastError: null }
      })
      return { changed: false, versionsCreated: 0 }
    }
    const platformBySource: Record<string, string> = { 'source-ebay': 'EBAY', 'source-ozon': 'OZON', 'source-aliexpress': 'ALIEXPRESS' }
    const platform = platformBySource[sourceId]
    if (!platform) throw httpError(400, 'SOURCE_NOT_MONITORABLE', '当前来源不支持政策变化检测')
    const affectedRuleIds: string[] = []
    await this.inTx(async repo => {
      const rules = await repo.db.complianceRule.findMany({
        where: { orgId: repo.orgId, platform, reviewStatus: { in: ['ACTIVE', 'PENDING_REVIEW'] } },
        include: { versions: true }
      })
      for (const rule of rules) {
        const current = rule.versions.find(item => item.version === rule.currentVersion)
        if (!current) continue
        const nextVersion = rule.currentVersion + 1
        await repo.db.complianceRuleVersion.create({
          data: {
            id: randomUUID(),
            orgId: repo.orgId,
            ruleId: rule.id,
            version: nextVersion,
            title: current.title,
            summary: `【官方来源发生变化，待人工核对】${current.summary}`,
            conditionJson: current.conditionJson ?? {},
            remediation: current.remediation,
            sourceUrl: current.sourceUrl,
            effectiveFrom: now.slice(0, 10),
            createdAt: now
          }
        })
        await repo.db.complianceRule.update({
          where: { id: rule.id },
          data: { currentVersion: nextVersion, reviewStatus: 'PENDING_REVIEW', updatedAt: now }
        })
        affectedRuleIds.push(rule.id)
      }
      await repo.db.complianceSourceChange.create({
        data: { id: randomUUID(), orgId: repo.orgId, sourceId, oldHash, newHash: contentHash, summary, affectedRuleIds, status: 'PENDING_REVIEW', detectedAt: now, reviewedBy: '', reviewNote: '' }
      })
      await repo.db.complianceSource.update({
        where: { orgId_id: { orgId: repo.orgId, id: sourceId } },
        data: { contentHash, syncStatus: 'READY', lastSyncedAt: now, lastCheckedAt: now, lastChangedAt: now, changeCount: { increment: 1 }, lastError: null }
      })
    })
    const profiles = await this.db.complianceProductProfile.findMany({ where: { orgId: this.orgId, platform }, select: { productId: true } })
    for (const profile of profiles) {
      await this.createTask(profile.productId, undefined, 'RULE_UPDATE', 'P1', `${platform} 官方政策来源发生变化`, `已生成 ${affectedRuleIds.length} 个待审核规则版本；审核生效后重新执行商品门禁。`)
      await this.revokeReleasePermits(profile.productId, '官方政策来源发生变化，需重新检查')
    }
    await this.createAlert('SOURCE_CHANGE', 'P1', sourceId, `${platform} 官方政策来源发生变化`, `${summary}；已生成 ${affectedRuleIds.length} 个待审核规则版本。`)
    await this.recordAudit('SOURCE_POLICY_CHANGED', 'SOURCE', sourceId, `${summary} · ${affectedRuleIds.length} 个待审核版本`)
    return { changed: true, versionsCreated: affectedRuleIds.length }
  }

  async markSourceError(sourceId: string, error: string) {
    await this.db.complianceSource.update({
      where: { orgId_id: { orgId: this.orgId, id: sourceId } },
      data: { syncStatus: 'ERROR', lastCheckedAt: new Date().toISOString(), lastError: error }
    })
    await this.createAlert('SOURCE_ERROR', 'P2', sourceId, '官方合规来源检测异常', error)
    await this.recordAudit('SOURCE_SYNC_FAILED', 'SOURCE', sourceId, error)
  }

  // ---------------------------------------------------------------- 档案 / 文件 / 模板 / 任务 / 告警 / 处置

  async saveProfile(draft: ComplianceProductProfileDraft): Promise<ComplianceProductProfile> {
    return this.inTx(async repo => {
      const current = await repo.db.complianceProductProfile.findUnique({ where: { orgId_productId: { orgId: repo.orgId, productId: draft.productId } } })
      const carryKeys = ['brand', 'manufacturer', 'importer', 'euResponsiblePerson', 'model', 'batchNumber', 'barcode', 'originCountry', 'materials', 'ageGrade', 'batteryType'] as const
      if (current) {
        for (const key of carryKeys) {
          if (!draft[key] && current[key]) draft[key] = current[key]
        }
      }
      const profileKeys = ['platform', 'marketplaceSite', 'country', 'categoryId', 'categoryName', 'title', ...carryKeys] as const
      const changed = Boolean(current && profileKeys.some(key => String(current[key] || '') !== String(draft[key] || '')))
      const now = new Date().toISOString()
      const id = draft.id || randomUUID()
      const data = {
        platform: draft.platform,
        marketplaceSite: draft.marketplaceSite,
        country: draft.country,
        categoryId: draft.categoryId,
        categoryName: draft.categoryName,
        title: draft.title,
        brand: draft.brand,
        manufacturer: draft.manufacturer,
        importer: draft.importer,
        euResponsiblePerson: draft.euResponsiblePerson,
        model: draft.model,
        batchNumber: draft.batchNumber,
        barcode: draft.barcode,
        originCountry: draft.originCountry,
        materials: draft.materials,
        ageGrade: draft.ageGrade,
        batteryType: draft.batteryType,
        updatedAt: now
      }
      await repo.db.complianceProductProfile.upsert({
        where: { orgId_productId: { orgId: repo.orgId, productId: draft.productId } },
        create: { id, orgId: repo.orgId, productId: draft.productId, ...data, createdAt: now },
        update: data
      })
      if (changed) await repo.revokeReleasePermits(draft.productId, '商品合规档案发生变化')
      const workspace = await repo.getKnowledgeWorkspace()
      return workspace.profiles.find(item => item.productId === draft.productId)!
    })
  }

  async saveDocument(draft: ComplianceDocumentDraft): Promise<ComplianceDocumentRecord> {
    return this.inTx(async repo => {
      if (!draft.name.trim() || !draft.documentType.trim() || !draft.filePath.trim()) throw httpError(400, 'DOCUMENT_FIELDS_REQUIRED', '文件类型、名称和上传文件不能为空')
      if (draft.status === 'APPROVED' && !draft.reviewNote.trim()) throw httpError(400, 'REVIEW_NOTE_REQUIRED', '核验通过时必须填写审核依据')
      const now = new Date().toISOString()
      const id = draft.id || randomUUID()
      // PG 端 documents 对 profiles 有复合外键；档案缺失时补建空档案（原 SQLite 未启用外键约束）
      await repo.db.complianceProductProfile.upsert({
        where: { orgId_productId: { orgId: repo.orgId, productId: draft.productId } },
        create: { id: randomUUID(), orgId: repo.orgId, productId: draft.productId, platform: '', marketplaceSite: '', country: '', createdAt: now, updatedAt: now },
        update: {}
      })
      const data = {
        productId: draft.productId,
        documentType: draft.documentType,
        name: draft.name,
        documentNumber: draft.documentNumber,
        issuer: draft.issuer,
        modelNumbers: draft.modelNumbers,
        countries: draft.countries,
        issuedAt: draft.issuedAt,
        expiresAt: draft.expiresAt,
        status: draft.status,
        fileName: draft.fileName,
        filePath: draft.filePath,
        reviewNote: draft.reviewNote,
        updatedAt: now
      }
      await repo.db.complianceDocument.upsert({
        where: { id },
        create: { id, orgId: repo.orgId, ...data, createdAt: now },
        update: data
      })
      const workspace = await repo.getKnowledgeWorkspace()
      const saved = workspace.documents.find(item => item.id === id)!
      if (saved.status === 'EXPIRING' || saved.status === 'EXPIRED') {
        await repo.createTask(saved.productId, undefined, 'DOCUMENT_EXPIRING', saved.status === 'EXPIRED' ? 'P1' : 'P2', saved.status === 'EXPIRED' ? '合规文件已过期' : '合规文件即将过期', `${saved.name} · ${saved.expiresAt}`)
      }
      await repo.createTask(saved.productId, undefined, 'RULE_UPDATE', 'P2', '合规资料变更后需重新检查', `${saved.name} · ${saved.status}`)
      await repo.revokeReleasePermits(saved.productId, '商品合规文件发生变化')
      return saved
    })
  }

  async saveTemplate(draft: ComplianceCategoryTemplateDraft): Promise<ComplianceCategoryTemplate> {
    return this.inTx(async repo => {
      const now = new Date().toISOString()
      const id = draft.id || randomUUID()
      const data = {
        name: draft.name,
        platform: draft.platform,
        marketplaceSite: draft.marketplaceSite,
        country: draft.country,
        category: draft.category,
        requiredFieldsJson: draft.requiredFields,
        requiredDocumentsJson: draft.requiredDocuments,
        requiredWarningsJson: draft.requiredWarnings,
        logisticsRequirementsJson: draft.logisticsRequirements,
        requiresManualReview: draft.requiresManualReview ? 1 : 0,
        active: draft.active ? 1 : 0,
        updatedAt: now
      }
      await repo.db.complianceCategoryTemplate.upsert({
        where: { id },
        create: { id, orgId: repo.orgId, ...data, createdAt: now },
        update: data
      })
      const workspace = await repo.getKnowledgeWorkspace()
      const saved = workspace.templates.find(item => item.id === id)!
      const matchedProfiles = workspace.profiles.filter(profile => complianceScopeMatches(saved, profile))
      for (const profile of matchedProfiles) {
        await repo.createTask(profile.productId, undefined, 'RULE_UPDATE', saved.requiresManualReview || saved.requiredDocuments.length ? 'P1' : 'P2', `类目合规模板更新后需重新检查：${saved.name}`, `${saved.marketplaceSite} · ${saved.country} · ${saved.category}`)
        await repo.revokeReleasePermits(profile.productId, '适用类目合规模板发生变化')
      }
      return saved
    })
  }

  async updateTask(taskId: string, status: ComplianceTaskStatus, assignee: string, resolution: string): Promise<ComplianceTaskRecord> {
    const current = await this.db.complianceTask.findFirst({ where: { orgId: this.orgId, id: taskId }, select: { assignee: true, resolution: true } })
    const now = new Date().toISOString()
    const result = await this.db.complianceTask.updateMany({
      where: { orgId: this.orgId, id: taskId },
      data: { status, assignee: assignee || current?.assignee || '', resolution: resolution || current?.resolution || '', updatedAt: now }
    })
    if (!result.count) throw httpError(404, 'TASK_NOT_FOUND', '合规任务不存在')
    await this.recordAudit('TASK_STATUS_UPDATED', 'TASK', taskId, `${status}${assignee ? ` · ${assignee}` : ''}${resolution ? ` · ${resolution}` : ''}`)
    const workspace = await this.getKnowledgeWorkspace()
    return workspace.tasks.find(item => item.id === taskId)!
  }

  async updateAlert(alertId: string, status: ComplianceAlertStatus, note: string): Promise<ComplianceAlert> {
    const now = new Date().toISOString()
    const result = await this.db.complianceAlert.updateMany({
      where: { orgId: this.orgId, id: alertId },
      data: { status, note: note.trim(), updatedAt: now }
    })
    if (!result.count) throw httpError(404, 'ALERT_NOT_FOUND', '合规告警不存在')
    await this.recordAudit('ALERT_STATUS_UPDATED', 'ALERT', alertId, `${status}${note.trim() ? ` · ${note.trim()}` : ''}`)
    const workspace = await this.getKnowledgeWorkspace()
    return workspace.alerts.find(item => item.id === alertId)!
  }

  async updateEnforcementCase(caseId: string, status: ComplianceEnforcementStatus, assignee: string, resolution: string): Promise<ComplianceEnforcementCase> {
    const current = await this.db.complianceEnforcementCase.findFirst({ where: { orgId: this.orgId, id: caseId }, select: { assignee: true } })
    if (!current) throw httpError(404, 'ENFORCEMENT_CASE_NOT_FOUND', '在售处置单不存在')
    if (status === 'IN_PROGRESS' && !assignee.trim()) throw httpError(400, 'ASSIGNEE_REQUIRED', '开始处置时必须填写负责人')
    if (status === 'RESOLVED' && !resolution.trim()) throw httpError(400, 'RESOLUTION_REQUIRED', '完成处置时必须填写处理结论')
    const now = new Date().toISOString()
    await this.db.complianceEnforcementCase.update({
      where: { id: caseId },
      data: { status, assignee: assignee.trim() || current.assignee, resolution: resolution.trim(), resolvedAt: status === 'RESOLVED' ? now : null, updatedAt: now }
    })
    await this.recordAudit(status === 'RESOLVED' ? 'ENFORCEMENT_CASE_RESOLVED' : 'ENFORCEMENT_CASE_ACCEPTED', 'ENFORCEMENT_CASE', caseId, `${assignee.trim() || current.assignee}${resolution.trim() ? ` · ${resolution.trim()}` : ''}`)
    const row = await this.db.complianceEnforcementCase.findFirst({ where: { orgId: this.orgId, id: caseId } })
    return this.mapEnforcementCase(row!)
  }

  // ---------------------------------------------------------------- 发布许可

  async issueReleasePermit(checkId: string, validDays = 7): Promise<ComplianceReleasePermit> {
    return this.inTx(async repo => {
      await repo.expireReleasePermits()
      const check = await repo.db.complianceCheckRun.findFirst({ where: { orgId: repo.orgId, id: checkId } })
      if (!check) throw httpError(404, 'CHECK_NOT_FOUND', '合规检查记录不存在')
      const latest = await repo.db.complianceCheckRun.findFirst({
        where: { orgId: repo.orgId, productId: check.productId },
        orderBy: { checkedAt: 'desc' },
        select: { id: true }
      })
      if (latest?.id !== checkId) throw httpError(400, 'CHECK_OUTDATED', '该检查已不是商品最新结论，不能签发发布许可')
      const gateStatus = check.gateStatus
      if (gateStatus !== 'PASSED' && !(gateStatus === 'REVIEW_REQUIRED' && check.reviewedAt)) {
        throw httpError(400, 'GATE_NOT_PASSED', '当前合规结论不允许签发发布许可')
      }
      const existing = await repo.db.complianceReleasePermit.findFirst({
        where: { orgId: repo.orgId, checkId, status: 'VALID', expiresAt: { gt: new Date().toISOString() } },
        orderBy: { issuedAt: 'desc' }
      })
      if (existing) return repo.mapPermit(existing)
      const productId = check.productId
      await repo.revokeReleasePermits(productId, '新的合规检查已签发替代许可', false)
      const issuedAt = new Date().toISOString()
      const expiresAt = new Date(Date.now() + Math.max(1, validDays) * 24 * 60 * 60_000).toISOString()
      const id = randomUUID()
      await repo.db.complianceReleasePermit.create({
        data: { id, orgId: repo.orgId, productId, platform: check.platform, marketplaceSite: check.marketplaceSite, checkId, ruleSetVersion: check.ruleSetVersion, inputFingerprint: check.inputFingerprint, gateStatus, issuedAt, expiresAt, status: 'VALID', revokeReason: '' }
      })
      await repo.recordAudit('RELEASE_PERMIT_ISSUED', 'PRODUCT', productId, `${check.marketplaceSite} · ${check.ruleSetVersion} · 有效至 ${expiresAt}`)
      const row = await repo.db.complianceReleasePermit.findUnique({ where: { id } })
      return repo.mapPermit(row!)
    })
  }

  async getReleasePermitReport(permitId: string) {
    await this.expireReleasePermits()
    const row = await this.db.complianceReleasePermit.findFirst({ where: { orgId: this.orgId, id: permitId } })
    if (!row) throw httpError(404, 'PERMIT_NOT_FOUND', '发布许可不存在')
    const permit = this.mapPermit(row)
    const check = await this.db.complianceCheckRun.findFirst({
      where: { orgId: this.orgId, id: permit.checkId },
      select: { requestJson: true, findingsJson: true, reviewedAt: true, reviewedBy: true, reviewNote: true, checkedAt: true }
    })
    const profileRow = await this.db.complianceProductProfile.findUnique({ where: { orgId_productId: { orgId: this.orgId, productId: permit.productId } } })
    const documentRows = await this.db.complianceDocument.findMany({
      where: { orgId: this.orgId, productId: permit.productId },
      orderBy: { updatedAt: 'desc' }
    })
    return {
      schemaVersion: 'COMPLIANCE-RELEASE-PERMIT-V1',
      generatedAt: new Date().toISOString(),
      permit,
      check: check
        ? {
            request: check.requestJson,
            findings: check.findingsJson,
            checkedAt: check.checkedAt,
            reviewedAt: check.reviewedAt ?? undefined,
            reviewedBy: check.reviewedBy ?? undefined,
            reviewNote: check.reviewNote ?? undefined
          }
        : undefined,
      // 与原实现差异：返回领域对象（camelCase）而非裸行
      profile: profileRow
        ? ({
            id: profileRow.id,
            productId: profileRow.productId,
            platform: profileRow.platform,
            marketplaceSite: profileRow.marketplaceSite,
            country: profileRow.country,
            categoryId: profileRow.categoryId,
            categoryName: profileRow.categoryName,
            title: profileRow.title,
            brand: profileRow.brand,
            manufacturer: profileRow.manufacturer,
            importer: profileRow.importer,
            euResponsiblePerson: profileRow.euResponsiblePerson,
            model: profileRow.model,
            batchNumber: profileRow.batchNumber,
            barcode: profileRow.barcode,
            originCountry: profileRow.originCountry,
            materials: profileRow.materials,
            ageGrade: profileRow.ageGrade,
            batteryType: profileRow.batteryType,
            updatedAt: profileRow.updatedAt
          } satisfies ComplianceProductProfile)
        : undefined,
      documents: documentRows.map(item => this.mapDocument(item))
    }
  }

  async getEvidenceReport() {
    const workspace = await this.getKnowledgeWorkspace()
    const latestChecks = await Promise.all(
      workspace.profiles.map(async profile => ({ productId: profile.productId, check: await this.getLatestCheck(profile.productId) }))
    )
    return {
      generatedAt: new Date().toISOString(),
      summary: { ...workspace.metrics, openAlerts: workspace.alerts.filter(item => item.status !== 'RESOLVED').length },
      sources: workspace.sources,
      sourceChanges: workspace.sourceChanges,
      alerts: workspace.alerts,
      tasks: workspace.tasks,
      permits: workspace.permits,
      enforcementCases: workspace.enforcementCases,
      auditEvents: workspace.auditEvents,
      latestChecks
    }
  }

  // ---------------------------------------------------------------- 合规检查引擎

  private ruleSetVersion(request: Pick<ComplianceCheckRequest, 'productId' | 'platform' | 'marketplaceSite' | 'country' | 'categoryId' | 'categoryName'>, workspace: ComplianceKnowledgeWorkspace) {
    const active = workspace.rules.filter(rule => rule.reviewStatus === 'ACTIVE' && complianceScopeMatches(rule, request))
    const templates = workspace.templates.filter(template => template.active && complianceScopeMatches(template, request))
    const documents = workspace.documents.filter(document => document.productId === request.productId)
    const recallSourceId = requiredRecallSourceId(request.country)
    const recallSource = workspace.sources.find(source => source.id === recallSourceId)
    const recallSignature = recallSourceId ? `${recallSourceId}@${recallSource?.syncStatus || 'NOT_CONFIGURED'}@${recallSource?.lastSyncedAt || 'NOT_READY'}` : 'NOT_APPLICABLE'
    const signature = [
      ...active.map(rule => `rule:${rule.code}@${rule.currentVersion}`),
      ...templates.map(template => `template:${template.id}@${template.updatedAt}`),
      ...documents.map(document => `document:${document.id}@${document.status}@${document.expiresAt}@${document.updatedAt}`),
      `recall:${recallSignature}`
    ].sort().join('|')
    return `${request.platform}:${active.length}:v1-${fnv1aHex(signature)}`
  }

  private async runEbayDetailPageCheck(request: ComplianceCheckRequest): Promise<ComplianceCheckResult> {
    return this.inTx(async repo => {
      const findings: ComplianceFinding[] = []
      const title = request.title.trim()
      const imageUrl = (request.imageUrl || '').trim()
      if (!title) {
        findings.push({ id: randomUUID(), ruleId: 'EBAY-DESCRIPTION-REQUIRED', ruleCode: 'EBAY-DESCRIPTION-REQUIRED', riskLevel: 'P0', title: '缺少商品标题', matchedContent: '标题为空', reason: 'eBay 商品详情需要准确、清晰的商品标题。', remediation: '补充准确描述当前商品的标题后重新检查。', sourceUrl: 'https://www.ebay.com/help/policies/listing-policies/item-description-policy?id=4372', ruleVersion: 1, effectiveFrom: '2026-07-21', requiresReview: false })
      } else if (title.length > 80) {
        findings.push({ id: randomUUID(), ruleId: 'EBAY-TITLE-LENGTH', ruleCode: 'EBAY-TITLE-LENGTH', riskLevel: 'P0', title: 'eBay 标题超过 80 字符', matchedContent: `当前 ${title.length} 字符`, reason: 'eBay 刊登标题最多使用 80 个字符。', remediation: '删除重复词和无关词，将标题控制在 80 字符以内。', sourceUrl: 'https://www.ebay.com/sellercenter/listings/create-listings', ruleVersion: 1, effectiveFrom: '2026-07-21', requiresReview: false })
      }
      if (!imageUrl) {
        findings.push({ id: randomUUID(), ruleId: 'EBAY-PICTURE-REQUIRED', ruleCode: 'EBAY-PICTURE-REQUIRED', riskLevel: 'P0', title: '缺少商品主图', matchedContent: '图片为空', reason: 'eBay 要求每个刊登至少包含一张真实反映商品的图片。', remediation: '补充一张真实、清晰且与商品一致的主图后重新检查。', sourceUrl: 'https://www.ebay.com/help/listing-policies/policies/picture-policy?id=4370', ruleVersion: 1, effectiveFrom: '2026-07-21', requiresReview: false })
      }
      const gateStatus: ComplianceCheckResult['gateStatus'] = findings.length ? 'BLOCKED' : 'PASSED'
      const checkedAt = new Date().toISOString()
      const id = randomUUID()
      const ruleSetVersion = 'EBAY-DETAIL-PAGE-2026.07.21'
      const inputFingerprint = complianceCheckFingerprint(request)
      const result: ComplianceCheckResult = { id, productId: request.productId, gateStatus, checkedAt, ruleSetVersion, inputFingerprint, findings }
      await repo.db.complianceCheckRun.create({
        data: { id, orgId: repo.orgId, productId: request.productId, platform: request.platform, marketplaceSite: request.marketplaceSite, country: request.country, gateStatus, ruleSetVersion, inputFingerprint, requestJson: request as unknown as Prisma.JsonObject, findingsJson: findings as unknown as Prisma.JsonArray, checkedAt }
      })
      await repo.revokeReleasePermits(request.productId, '商品产生了新的 eBay 详情页检查结论', false)
      if (gateStatus === 'PASSED') {
        await repo.db.complianceTask.updateMany({
          where: { orgId: repo.orgId, productId: request.productId, status: { in: ['OPEN', 'IN_REVIEW'] }, taskType: { not: 'RECALL_MATCH' } },
          data: { status: 'RESOLVED', resolution: '最新 eBay 详情页检查已通过', updatedAt: checkedAt }
        })
        await repo.db.complianceAlert.updateMany({
          where: { orgId: repo.orgId, entityId: request.productId, alertType: 'PUBLISH_BLOCK', status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
          data: { status: 'RESOLVED', note: '最新 eBay 详情页检查已通过', updatedAt: checkedAt }
        })
        await repo.issueReleasePermit(id)
        await repo.resolveEnforcementCases(request.productId, '最新 eBay 详情页检查已通过')
      } else {
        await repo.createTask(request.productId, id, 'MANUAL_REVIEW', 'P0', 'eBay 详情页资料需要修改', findings.map(item => item.title).join('；'))
        await repo.createAlert('PUBLISH_BLOCK', 'P0', request.productId, 'eBay 详情页资料需要修改', findings.map(item => item.title).join('；'))
      }
      await repo.recordAudit('PRODUCT_COMPLIANCE_CHECKED', 'PRODUCT', request.productId, `${gateStatus} · eBay 详情页检查 · ${findings.length} 个问题`)
      return result
    })
  }

  async runCheck(request: ComplianceCheckRequest): Promise<ComplianceCheckResult> {
    if (request.platform === 'EBAY') return this.runEbayDetailPageCheck(request)
    const specific = (...names: string[]) => request.itemSpecifics?.find(item => names.some(name => item.name.toLowerCase().includes(name)))?.value || ''
    await this.saveProfile({
      productId: request.productId,
      platform: request.platform,
      marketplaceSite: request.marketplaceSite,
      country: request.country,
      categoryId: request.categoryId || '',
      categoryName: request.categoryName || '',
      title: request.title,
      brand: specific('brand', '品牌'),
      manufacturer: specific('manufacturer', '制造商'),
      importer: specific('importer', '进口商'),
      euResponsiblePerson: specific('responsible', '负责人'),
      model: specific('model', '型号'),
      batchNumber: specific('batch', '批次'),
      barcode: specific('barcode', 'upc', 'ean', '条码'),
      originCountry: specific('country of origin', '原产地'),
      materials: specific('material', '材质'),
      ageGrade: specific('age', '年龄'),
      batteryType: specific('battery', '电池')
    })
    return this.inTx(async repo => {
      const workspace = await repo.getKnowledgeWorkspace()
      const scoped = workspace.rules.filter(rule => rule.reviewStatus === 'ACTIVE' && complianceScopeMatches(rule, request))
      const pending = workspace.rules.filter(rule => rule.reviewStatus === 'PENDING_REVIEW' && complianceScopeMatches(rule, request))
      const text = `${request.title}\n${request.description || ''}`.toLowerCase()
      const fields: Record<string, unknown> = {
        ...request,
        itemSpecifics: request.itemSpecifics?.length ? request.itemSpecifics : undefined,
        brand: specific('brand', '品牌'),
        manufacturer: specific('manufacturer', '制造商'),
        importer: specific('importer', '进口商'),
        euResponsiblePerson: specific('responsible', '负责人'),
        model: specific('model', '型号'),
        batchNumber: specific('batch', '批次'),
        barcode: specific('barcode', 'upc', 'ean', '条码'),
        originCountry: specific('country of origin', '原产地')
      }
      const findings: ComplianceFinding[] = []
      if (request.platform === 'EBAY' && request.title.trim().length > 80) {
        findings.push({ id: randomUUID(), ruleId: 'EBAY-TITLE-LENGTH', ruleCode: 'EBAY-TITLE-LENGTH', riskLevel: 'P0', title: 'eBay 标题超过 80 字符', matchedContent: `当前 ${request.title.trim().length} 字符`, reason: 'eBay 刊登标题有硬性长度限制，超长内容无法正常发布。', remediation: '缩短标题至 80 字符以内后重新检查。', sourceUrl: 'https://www.ebay.com/help/selling/listings/creating-managing-listings/listing-policies?id=4213', ruleVersion: 1, effectiveFrom: '2025-01-01', requiresReview: false })
      }
      if (pending.length) {
        findings.push({ id: randomUUID(), ruleId: 'KNOWLEDGE-REVIEW-PENDING', ruleCode: 'KNOWLEDGE-REVIEW-PENDING', riskLevel: 'P1', title: '适用规则存在待审核版本', matchedContent: pending.map(item => `${item.code} v${item.currentVersion}`).join('、'), reason: '规则变更尚未完成人工审核，检查引擎不会将未审核规则当作已生效依据。', remediation: '请在合规知识库完成规则审核并启用，然后重新执行商品合规检查。', sourceUrl: '', ruleVersion: Math.max(...pending.map(item => item.currentVersion)), effectiveFrom: new Date().toISOString().slice(0, 10), requiresReview: true })
      }
      const templates = workspace.templates.filter(template => template.active && complianceScopeMatches(template, request))
      const approvedDocumentTypes = new Set(workspace.documents.filter(item => item.productId === request.productId && (item.status === 'APPROVED' || item.status === 'EXPIRING')).map(item => item.documentType))
      for (const template of templates) {
        const missingDocuments = template.requiredDocuments.filter(type => !approvedDocumentTypes.has(type))
        if (missingDocuments.length) {
          findings.push({ id: randomUUID(), ruleId: `template:${template.id}`, ruleCode: 'CATEGORY-DOCUMENTS-REQUIRED', riskLevel: 'P1', title: `${template.name}：合规资料不完整`, matchedContent: `缺少：${missingDocuments.join('、')}`, reason: '当前平台、站点、国家和类目模板要求提供对应合规资料。', remediation: '在商品合规档案中补充文件，完成人工审核后重新检查。', sourceUrl: '', ruleVersion: 1, effectiveFrom: template.updatedAt.slice(0, 10), requiresReview: true })
        }
        if (template.requiresManualReview && !missingDocuments.length) {
          findings.push({ id: randomUUID(), ruleId: `template:${template.id}`, ruleCode: 'CATEGORY-MANUAL-REVIEW', riskLevel: 'P1', title: `${template.name}：需人工复核`, matchedContent: '资料已齐全，等待适用性核验', reason: '该类目模板设置了发布前人工复核。', remediation: '由合规负责人核对文件、型号、标签与销售市场的一致性。', sourceUrl: '', ruleVersion: 1, effectiveFrom: template.updatedAt.slice(0, 10), requiresReview: true })
        }
      }
      for (const rule of scoped) {
        const keywords = rule.version.condition.keywords || []
        const matchedKeywords = keywords.filter(keyword => text.includes(keyword.toLowerCase()))
        const missing = (rule.version.condition.requiredFields || []).filter(field => !fields[field] || (Array.isArray(fields[field]) && !(fields[field] as unknown[]).length))
        if (!matchedKeywords.length && !missing.length) continue
        findings.push({ id: randomUUID(), ruleId: rule.id, ruleCode: rule.code, riskLevel: rule.riskLevel, title: rule.version.title, matchedContent: matchedKeywords.length ? matchedKeywords.join('、') : `缺少字段：${missing.join('、')}`, reason: rule.version.summary, remediation: rule.version.remediation, sourceUrl: rule.version.sourceUrl, ruleVersion: rule.currentVersion, effectiveFrom: rule.version.effectiveFrom, requiresReview: rule.riskLevel === 'P1' })
      }
      const recallText = `${request.title} ${request.description || ''}`.toLowerCase()
      const recallSourceId = requiredRecallSourceId(request.country)
      for (const recall of workspace.recalls.filter(item => recallSourceId && item.sourceId === recallSourceId)) {
        if (complianceRecallMatches(recallText, `${recall.title} ${recall.products}`)) {
          findings.push({ id: randomUUID(), ruleId: `recall:${recall.id}`, ruleCode: 'OFFICIAL-RECALL-MATCH', riskLevel: 'P0', title: '疑似命中官方召回商品', matchedContent: recall.title, reason: recall.hazards || recall.description, remediation: '立即停止发布，核对型号、批次和召回范围，并提交人工复核。', sourceUrl: recall.sourceUrl, ruleVersion: 1, effectiveFrom: recall.recallDate, requiresReview: true })
        }
      }
      if (request.platform === 'EBAY' && recallSourceId) {
        const source = workspace.sources.find(item => item.id === recallSourceId)
        if (source?.syncStatus !== 'READY' || !workspace.recalls.some(item => item.sourceId === recallSourceId)) {
          const sourceName = recallSourceId === 'source-cpsc' ? 'CPSC' : recallSourceId === 'source-uk-opss' ? 'UK OPSS' : 'EU Safety Gate'
          findings.push({ id: randomUUID(), ruleId: `${recallSourceId}-STALE`, ruleCode: 'OFFICIAL-RECALL-SOURCE-STALE', riskLevel: 'P1', title: `${sourceName} 官方召回库未就绪`, matchedContent: source?.syncStatus || 'NOT_CONFIGURED', reason: `缺少可用的 ${sourceName} 官方召回数据时，系统不能将该市场商品误判为已排除召回风险。`, remediation: recallSourceId === 'source-eu-safety-gate' ? '打开 EU Safety Gate 官方页面人工核验并留存复核结论；在验证稳定官方接口前不会伪装自动同步。' : `在合规知识库同步 ${sourceName} 数据，或人工查证官方召回页并留存复核结论。`, sourceUrl: source?.url || '', ruleVersion: 1, effectiveFrom: new Date().toISOString().slice(0, 10), requiresReview: true })
        }
      }
      const gateStatus: ComplianceCheckResult['gateStatus'] = findings.some(item => item.riskLevel === 'P0') ? 'BLOCKED' : findings.some(item => item.riskLevel === 'P1') ? 'REVIEW_REQUIRED' : findings.some(item => item.riskLevel === 'P2') ? 'RECHECK_REQUIRED' : 'PASSED'
      const checkedAt = new Date().toISOString()
      const id = randomUUID()
      const version = repo.ruleSetVersion(request, workspace)
      const inputFingerprint = complianceCheckFingerprint(request)
      const result: ComplianceCheckResult = { id, productId: request.productId, gateStatus, checkedAt, ruleSetVersion: version, inputFingerprint, findings }
      await repo.db.complianceCheckRun.create({
        data: { id, orgId: repo.orgId, productId: request.productId, platform: request.platform, marketplaceSite: request.marketplaceSite, country: request.country, gateStatus, ruleSetVersion: version, inputFingerprint, requestJson: request as unknown as Prisma.JsonObject, findingsJson: findings as unknown as Prisma.JsonArray, checkedAt }
      })
      await repo.revokeReleasePermits(request.productId, '商品产生了新的合规检查结论', false)
      if (!findings.some(item => item.ruleCode === 'OFFICIAL-RECALL-MATCH')) {
        await repo.db.complianceTask.updateMany({
          where: { orgId: repo.orgId, productId: request.productId, taskType: 'RECALL_MATCH', status: { in: ['OPEN', 'IN_REVIEW'] } },
          data: { status: 'RESOLVED', resolution: '最新检查未再命中官方召回', updatedAt: checkedAt }
        })
      }
      if (gateStatus !== 'PASSED') {
        const risk: ComplianceRiskLevel = findings.some(item => item.riskLevel === 'P0') ? 'P0' : findings.some(item => item.riskLevel === 'P1') ? 'P1' : 'P2'
        const type: ComplianceTaskRecord['taskType'] = findings.some(item => item.ruleCode === 'OFFICIAL-RECALL-MATCH') ? 'RECALL_MATCH' : findings.some(item => item.ruleCode === 'CATEGORY-DOCUMENTS-REQUIRED') ? 'DOCUMENT_MISSING' : 'MANUAL_REVIEW'
        await repo.createTask(request.productId, id, type, risk, gateStatus === 'BLOCKED' ? '商品已被合规门禁阻断' : '商品需要合规复核', findings.map(item => item.title).join('；'))
        await repo.createAlert(findings.some(item => item.ruleCode === 'OFFICIAL-RECALL-MATCH') ? 'RECALL_MATCH' : 'PUBLISH_BLOCK', risk, request.productId, gateStatus === 'BLOCKED' ? '商品已被合规门禁阻断' : '商品需要合规复核', findings.map(item => item.title).join('；'))
        await repo.createEnforcementCase(request.productId, risk, findings.map(item => item.title).join('；'), risk === 'P0' ? 'REMOVE_LISTING' : risk === 'P1' ? 'PAUSE_AND_REVIEW' : 'CORRECT_AND_RECHECK')
      } else {
        await repo.db.complianceTask.updateMany({
          where: { orgId: repo.orgId, productId: request.productId, status: { in: ['OPEN', 'IN_REVIEW'] }, taskType: { not: 'RECALL_MATCH' } },
          data: { status: 'RESOLVED', resolution: '最新合规检查已通过', updatedAt: checkedAt }
        })
        await repo.db.complianceAlert.updateMany({
          where: { orgId: repo.orgId, entityId: request.productId, alertType: 'PUBLISH_BLOCK', status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
          data: { status: 'RESOLVED', note: '最新合规检查已通过', updatedAt: checkedAt }
        })
      }
      await repo.recordAudit('PRODUCT_COMPLIANCE_CHECKED', 'PRODUCT', request.productId, `${gateStatus} · ${findings.length} 个命中项 · ${version}`)
      if (gateStatus === 'PASSED') {
        await repo.issueReleasePermit(id)
        await repo.resolveEnforcementCases(request.productId, '最新合规检查已通过并签发新许可')
      }
      return result
    })
  }

  async recheckProfiles(platform = 'ALL', country = 'ALL'): Promise<ComplianceBatchRecheckResult> {
    const profiles = await this.db.complianceProductProfile.findMany({
      where: { orgId: this.orgId, ...(platform !== 'ALL' ? { platform } : {}), ...(country !== 'ALL' ? { country } : {}) },
      orderBy: { updatedAt: 'desc' },
      select: { productId: true, platform: true, country: true }
    })
    const result: ComplianceBatchRecheckResult = { total: profiles.length, checked: 0, skipped: 0, passed: 0, reviewRequired: 0, recheckRequired: 0, blocked: 0, checkedAt: new Date().toISOString() }
    for (const profile of profiles) {
      const row = await this.db.complianceCheckRun.findFirst({
        where: { orgId: this.orgId, productId: profile.productId, NOT: { requestJson: {} } },
        orderBy: { checkedAt: 'desc' },
        select: { requestJson: true }
      })
      if (!row) {
        result.skipped += 1
        continue
      }
      try {
        const request = row.requestJson as unknown as ComplianceCheckRequest
        if (!request.productId || !request.platform || !request.title) {
          result.skipped += 1
          continue
        }
        const checked = await this.runCheck(request)
        result.checked += 1
        if (checked.gateStatus === 'PASSED') result.passed += 1
        else if (checked.gateStatus === 'BLOCKED') result.blocked += 1
        else if (checked.gateStatus === 'REVIEW_REQUIRED') result.reviewRequired += 1
        else result.recheckRequired += 1
      } catch {
        result.skipped += 1
      }
    }
    result.checkedAt = new Date().toISOString()
    return result
  }

  async getLatestCheck(productId: string): Promise<ComplianceCheckResult | undefined> {
    const row = await this.db.complianceCheckRun.findFirst({
      where: { orgId: this.orgId, productId },
      orderBy: { checkedAt: 'desc' }
    })
    if (!row) return undefined
    const workspace = await this.getKnowledgeWorkspace()
    const profile = await this.db.complianceProductProfile.findUnique({
      where: { orgId_productId: { orgId: this.orgId, productId } },
      select: { categoryId: true, categoryName: true }
    })
    const scope = { productId, platform: row.platform, marketplaceSite: row.marketplaceSite, country: row.country, categoryId: profile?.categoryId || '', categoryName: profile?.categoryName || '' }
    const currentRuleSetVersion = this.ruleSetVersion(scope, workspace)
    const stale = row.ruleSetVersion !== currentRuleSetVersion
    const rules = workspace.rules.filter(item => item.reviewStatus === 'ACTIVE' && complianceScopeMatches(item, scope))
    const findings = (row.findingsJson ?? []) as unknown as ComplianceFinding[]
    if (stale) {
      findings.unshift({ id: `ruleset:${row.id}`, ruleId: 'RULESET-UPDATED', ruleCode: 'RULESET-UPDATED', riskLevel: 'P2', title: '合规规则库已更新', matchedContent: `${row.ruleSetVersion} → ${currentRuleSetVersion}`, reason: '该商品的上次检查使用了旧规则集，原结论不再作为发布依据。', remediation: '使用当前规则库重新执行合规检查。', sourceUrl: '', ruleVersion: Math.max(0, ...rules.map(item => item.currentVersion)), effectiveFrom: new Date().toISOString().slice(0, 10), requiresReview: false })
    }
    const gateStatus: ComplianceCheckResult['gateStatus'] = row.gateStatus === 'BLOCKED' ? 'BLOCKED' : stale ? 'RECHECK_REQUIRED' : (row.gateStatus as ComplianceCheckResult['gateStatus'])
    return {
      id: row.id,
      productId: row.productId,
      gateStatus,
      checkedAt: row.checkedAt,
      ruleSetVersion: row.ruleSetVersion,
      inputFingerprint: row.inputFingerprint || '',
      findings,
      reviewedAt: !stale && row.reviewedAt ? row.reviewedAt : undefined,
      reviewedBy: !stale && row.reviewedBy ? row.reviewedBy : undefined,
      reviewNote: !stale && row.reviewNote ? row.reviewNote : undefined
    }
  }

  async reviewCheck(checkId: string, reviewedBy: string, note: string): Promise<ComplianceCheckResult> {
    const current = await this.db.complianceCheckRun.findFirst({
      where: { orgId: this.orgId, id: checkId },
      select: { productId: true, gateStatus: true, findingsJson: true }
    })
    if (!current) throw httpError(404, 'CHECK_NOT_FOUND', '合规检查记录不存在')
    if (current.gateStatus !== 'REVIEW_REQUIRED') throw httpError(400, 'CHECK_NOT_REVIEWABLE', '仅“待人工复核”的检查记录可以提交复核留痕')
    const findings = (current.findingsJson ?? []) as unknown as ComplianceFinding[]
    if (findings.some(item => item.ruleCode === 'CATEGORY-DOCUMENTS-REQUIRED')) {
      throw httpError(400, 'DOCUMENTS_REQUIRED', '强制合规文件尚未齐全，不能通过人工复核绕过；请先补齐并审核文件后重新检查。')
    }
    const reviewedAt = new Date().toISOString()
    await this.inTx(async repo => {
      await repo.db.complianceCheckRun.update({
        where: { id: checkId },
        data: { reviewedAt, reviewedBy: reviewedBy.trim() || '本机用户', reviewNote: note.trim() }
      })
      await repo.db.complianceTask.updateMany({
        where: { orgId: repo.orgId, productId: current.productId, status: { in: ['OPEN', 'IN_REVIEW'] }, taskType: { in: ['MANUAL_REVIEW', 'DOCUMENT_MISSING', 'REMEDIATION', 'RULE_UPDATE'] } },
        data: { status: 'RESOLVED', assignee: reviewedBy.trim() || '本机用户', resolution: note.trim(), updatedAt: reviewedAt }
      })
      await repo.recordAudit('COMPLIANCE_REVIEW_APPROVED', 'PRODUCT', current.productId, `${reviewedBy.trim() || '本机用户'} · ${note.trim()}`)
      await repo.issueReleasePermit(checkId)
      await repo.resolveEnforcementCases(current.productId, '人工复核已通过并签发新许可')
    })
    return (await this.getLatestCheck(current.productId))!
  }
}
