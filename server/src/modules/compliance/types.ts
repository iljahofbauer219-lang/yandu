// 合规域类型：与客户端 src/shared/contracts.ts 保持一致（字段名不变，payload 原样往返）

export type ComplianceRiskLevel = 'P0' | 'P1' | 'P2' | 'P3'
export type ComplianceReviewStatus = 'DRAFT' | 'PENDING_REVIEW' | 'ACTIVE' | 'INACTIVE'
export type ComplianceGateStatus = 'BLOCKED' | 'REVIEW_REQUIRED' | 'RECHECK_REQUIRED' | 'PASSED'
export type ComplianceDocumentStatus = 'MISSING' | 'PENDING_REVIEW' | 'APPROVED' | 'EXPIRING' | 'EXPIRED' | 'REJECTED'
export type ComplianceTaskStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED' | 'DISMISSED'
export type ComplianceAlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
export type ComplianceReleasePermitStatus = 'VALID' | 'REVOKED' | 'EXPIRED'
export type ComplianceEnforcementStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED'
export type ComplianceEnforcementAction = 'REMOVE_LISTING' | 'PAUSE_AND_REVIEW' | 'CORRECT_AND_RECHECK'
export type ComplianceSourceChangeDecision = 'APPROVED' | 'REJECTED'

export interface ComplianceSource {
  id: string
  name: string
  authority: string
  sourceType: 'PLATFORM' | 'REGULATOR' | 'RECALL'
  url: string
  syncMode: 'API' | 'MANUAL' | 'CREDENTIALS_REQUIRED' | 'WEB_MONITOR'
  syncStatus: 'READY' | 'NOT_CONFIGURED' | 'ERROR'
  lastSyncedAt?: string
  lastCheckedAt?: string
  lastChangedAt?: string
  contentHash?: string
  changeCount: number
  lastError?: string
}

export interface ComplianceSourceChange {
  id: string
  sourceId: string
  oldHash: string
  newHash: string
  summary: string
  affectedRuleIds: string[]
  status: 'PENDING_REVIEW' | 'REVIEWED' | 'APPROVED' | 'REJECTED'
  detectedAt: string
  reviewedAt?: string
  reviewedBy?: string
  reviewNote?: string
}

export interface ComplianceRuleVersion {
  id: string
  ruleId: string
  version: number
  title: string
  summary: string
  condition: { keywords?: string[]; requiredFields?: string[] }
  remediation: string
  sourceUrl: string
  effectiveFrom: string
  createdAt: string
}

export interface ComplianceRule {
  id: string
  code: string
  platform: string
  marketplaceSite: string
  country: string
  category: string
  ruleType: string
  riskLevel: ComplianceRiskLevel
  reviewStatus: ComplianceReviewStatus
  currentVersion: number
  updatedAt: string
  version: ComplianceRuleVersion
  versions: ComplianceRuleVersion[]
}

export interface ComplianceRuleDraft {
  id?: string
  code: string
  platform: string
  marketplaceSite: string
  country: string
  category: string
  ruleType: string
  riskLevel: ComplianceRiskLevel
  reviewStatus: ComplianceReviewStatus
  title: string
  summary: string
  keywords: string[]
  requiredFields: string[]
  remediation: string
  sourceUrl: string
  effectiveFrom: string
}

export interface ComplianceRecall {
  id: string
  sourceId: string
  externalId: string
  title: string
  description: string
  products: string
  hazards: string
  countries: string
  recallDate: string
  sourceUrl: string
  updatedAt: string
}

export interface ComplianceProductProfile {
  id: string
  productId: string
  platform: string
  marketplaceSite: string
  country: string
  categoryId: string
  categoryName: string
  title: string
  brand: string
  manufacturer: string
  importer: string
  euResponsiblePerson: string
  model: string
  batchNumber: string
  barcode: string
  originCountry: string
  materials: string
  ageGrade: string
  batteryType: string
  updatedAt: string
}

export interface ComplianceProductProfileDraft extends Omit<ComplianceProductProfile, 'id' | 'updatedAt'> { id?: string }

export interface ComplianceDocumentRecord {
  id: string
  productId: string
  documentType: string
  name: string
  documentNumber: string
  issuer: string
  modelNumbers: string
  countries: string
  issuedAt: string
  expiresAt: string
  status: ComplianceDocumentStatus
  fileName: string
  filePath: string
  reviewNote: string
  updatedAt: string
}

export interface ComplianceDocumentDraft extends Omit<ComplianceDocumentRecord, 'id' | 'updatedAt'> { id?: string }

export interface ComplianceCategoryTemplate {
  id: string
  name: string
  platform: string
  marketplaceSite: string
  country: string
  category: string
  requiredFields: string[]
  requiredDocuments: string[]
  requiredWarnings: string[]
  logisticsRequirements: string[]
  requiresManualReview: boolean
  active: boolean
  updatedAt: string
}

export interface ComplianceCategoryTemplateDraft extends Omit<ComplianceCategoryTemplate, 'id' | 'updatedAt'> { id?: string }

export interface ComplianceTaskRecord {
  id: string
  productId: string
  checkId?: string
  taskType: 'RULE_UPDATE' | 'DOCUMENT_MISSING' | 'DOCUMENT_EXPIRING' | 'RECALL_MATCH' | 'MANUAL_REVIEW' | 'REMEDIATION'
  riskLevel: ComplianceRiskLevel
  title: string
  detail: string
  status: ComplianceTaskStatus
  assignee: string
  dueAt: string
  resolution: string
  createdAt: string
  updatedAt: string
}

export interface ComplianceAlert {
  id: string
  alertType: 'SOURCE_ERROR' | 'SOURCE_CHANGE' | 'RECALL_MATCH' | 'PUBLISH_BLOCK'
  riskLevel: ComplianceRiskLevel
  entityId: string
  title: string
  detail: string
  status: ComplianceAlertStatus
  note: string
  createdAt: string
  updatedAt: string
}

export interface ComplianceAuditEvent {
  id: string
  action: string
  entityType: string
  entityId: string
  detail: string
  createdAt: string
}

export interface ComplianceReleasePermit {
  id: string
  productId: string
  platform: string
  marketplaceSite: string
  checkId: string
  ruleSetVersion: string
  inputFingerprint: string
  gateStatus: ComplianceGateStatus
  issuedAt: string
  expiresAt: string
  status: ComplianceReleasePermitStatus
  revokedAt?: string
  revokeReason?: string
}

export interface ComplianceEnforcementCase {
  id: string
  productId: string
  platform: string
  marketplaceSite: string
  listingId: string
  storeId: string
  title: string
  viewUrl: string
  riskLevel: ComplianceRiskLevel
  reason: string
  recommendedAction: ComplianceEnforcementAction
  status: ComplianceEnforcementStatus
  assignee: string
  resolution: string
  createdAt: string
  updatedAt: string
  resolvedAt?: string
}

export interface ComplianceKnowledgeWorkspace {
  sources: ComplianceSource[]
  sourceChanges: ComplianceSourceChange[]
  rules: ComplianceRule[]
  recalls: ComplianceRecall[]
  profiles: ComplianceProductProfile[]
  documents: ComplianceDocumentRecord[]
  templates: ComplianceCategoryTemplate[]
  tasks: ComplianceTaskRecord[]
  alerts: ComplianceAlert[]
  auditEvents: ComplianceAuditEvent[]
  permits: ComplianceReleasePermit[]
  enforcementCases: ComplianceEnforcementCase[]
  metrics: {
    activeRules: number
    pendingReview: number
    recalls: number
    staleSources: number
    profiles: number
    openTasks: number
    expiringDocuments: number
    blockedProducts: number
    validPermits: number
    openEnforcementCases: number
  }
}

export interface ComplianceBatchRecheckResult {
  total: number
  checked: number
  skipped: number
  passed: number
  reviewRequired: number
  recheckRequired: number
  blocked: number
  checkedAt: string
}

export interface ComplianceSourceChangeReviewResult {
  change: ComplianceSourceChange
  recheck: ComplianceBatchRecheckResult
  workspace: ComplianceKnowledgeWorkspace
}

export interface ComplianceCheckRequest {
  productId: string
  platform: string
  marketplaceSite: string
  country: string
  categoryId?: string
  categoryName?: string
  title: string
  description?: string
  imageUrl?: string
  itemSpecifics?: Array<{ name: string; value: string }>
}

export interface ComplianceFinding {
  id: string
  ruleId: string
  ruleCode: string
  riskLevel: ComplianceRiskLevel
  title: string
  matchedContent: string
  reason: string
  remediation: string
  sourceUrl: string
  ruleVersion: number
  effectiveFrom: string
  requiresReview: boolean
}

export interface ComplianceCheckResult {
  id: string
  productId: string
  gateStatus: ComplianceGateStatus
  checkedAt: string
  ruleSetVersion: string
  inputFingerprint: string
  findings: ComplianceFinding[]
  reviewedAt?: string
  reviewedBy?: string
  reviewNote?: string
}
