import { randomUUID } from 'node:crypto'
import { prisma } from '../../lib/prisma.js'
import type { ComplianceRuleDraft } from './types.js'

/**
 * 组织级合规知识种子：移植自 AppDatabase.seedComplianceKnowledge。
 * 差异：规则/模板不再使用全局固定 id（多组织共存），改为「按 (orgId, code|name) 幂等跳过 + cuid」；
 * 来源保留逻辑 id（source-ebay 等），主键为 (orgId, id) 复合主键。
 */
export async function seedComplianceKnowledge(orgId: string) {
  const sources = [
    { id: 'source-ebay', name: 'eBay 平台政策', authority: 'eBay', sourceType: 'PLATFORM', url: 'https://www.ebay.com/help/policies/default/ebays-rules-policies?id=4205', syncMode: 'WEB_MONITOR' },
    { id: 'source-ozon', name: 'Ozon 平台政策', authority: 'Ozon', sourceType: 'PLATFORM', url: 'https://docs.ozon.ru/global/', syncMode: 'WEB_MONITOR' },
    { id: 'source-aliexpress', name: 'AliExpress 平台政策', authority: 'AliExpress', sourceType: 'PLATFORM', url: 'https://service.aliexpress.com/page/home', syncMode: 'WEB_MONITOR' },
    { id: 'source-cpsc', name: 'CPSC 召回数据', authority: 'U.S. Consumer Product Safety Commission', sourceType: 'RECALL', url: 'https://www.cpsc.gov/Recalls', syncMode: 'API' },
    { id: 'source-eu-safety-gate', name: 'EU Safety Gate', authority: 'European Commission', sourceType: 'RECALL', url: 'https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en', syncMode: 'API' },
    { id: 'source-uk-opss', name: 'UK OPSS 产品安全', authority: 'Office for Product Safety and Standards', sourceType: 'RECALL', url: 'https://www.gov.uk/product-safety-alerts-reports-recalls.atom', syncMode: 'API' }
  ]
  for (const source of sources) {
    await prisma.complianceSource.upsert({
      where: { orgId_id: { orgId, id: source.id } },
      create: { ...source, orgId, syncStatus: 'NOT_CONFIGURED' },
      update: { url: source.url, syncMode: source.syncMode, sourceType: source.sourceType, name: source.name, authority: source.authority }
    })
  }

  const now = new Date().toISOString()
  const rules: ComplianceRuleDraft[] = [
    { code: 'EBAY-IP-COUNTERFEIT', platform: 'EBAY', marketplaceSite: 'ALL', country: 'ALL', category: 'ALL', ruleType: 'INTELLECTUAL_PROPERTY', riskLevel: 'P0', reviewStatus: 'ACTIVE', title: '禁止仿品、伪造品及未授权品牌刊登', summary: '标题或描述明确宣称商品为仿品、高仿或伪造品时阻止发布。', keywords: ['counterfeit', 'replica', 'fake brand', '高仿', '仿品', '伪造'], requiredFields: [], remediation: '下架该商品或补充可验证的授权与进货证明后提交人工复核。', sourceUrl: 'https://www.ebay.com/help/policies/listing-policies/intellectual-property-vero-program?id=4349', effectiveFrom: '2025-01-01' },
    { code: 'EBAY-TITLE-PROMISES', platform: 'EBAY', marketplaceSite: 'ALL', country: 'ALL', category: 'ALL', ruleType: 'LISTING_CONTENT', riskLevel: 'P2', reviewStatus: 'ACTIVE', title: '刊登文案不应包含无法证实的绝对承诺', summary: '识别标题和描述中的绝对化功效或虚假宣传用语。', keywords: ['100% guaranteed', 'best in the world', 'miracle cure', '绝对有效', '百分百治愈'], requiredFields: [], remediation: '删除无法提供证据的绝对化承诺，改为可验证的产品事实。', sourceUrl: 'https://www.ebay.com/help/policies/listing-policies/item-description-policy?id=4372', effectiveFrom: '2025-01-01' },
    { code: 'EBAY-LISTING-REQUIRED', platform: 'EBAY', marketplaceSite: 'ALL', country: 'ALL', category: 'ALL', ruleType: 'LISTING_REQUIREMENTS', riskLevel: 'P0', reviewStatus: 'ACTIVE', title: 'eBay 刊登基础资料必须完整', summary: '发布前必须包含有效类目、标题和主图。', keywords: [], requiredFields: ['categoryName', 'title', 'imageUrl'], remediation: '补充缺失的类目、标题或主图后重新执行合规检查。', sourceUrl: 'https://www.ebay.com/help/selling/listings/creating-managing-listings?id=4073', effectiveFrom: '2025-01-01' },
    { code: 'EBAY-RESTRICTED-SENSITIVE', platform: 'EBAY', marketplaceSite: 'ALL', country: 'ALL', category: 'ALL', ruleType: 'PROHIBITED_RESTRICTED', riskLevel: 'P1', reviewStatus: 'ACTIVE', title: '疑似禁售或受限制商品需人工核验', summary: '检测到药品、武器、烟草、象牙或其他受限制商品线索。', keywords: ['prescription drug', 'firearm', 'ammunition', 'tobacco', 'vape', 'ivory', '处方药', '枪支', '弹药', '烟草', '电子烟', '象牙'], requiredFields: [], remediation: '核对 eBay 禁售/限售政策、类目许可与目标国家法律，确认可售后留存证据。', sourceUrl: 'https://www.ebay.com/help/policies/prohibited-restricted-items/prohibited-restricted-items?id=4207', effectiveFrom: '2025-01-01' },
    { code: 'EBAY-EU-PRODUCT-SAFETY', platform: 'EBAY', marketplaceSite: 'ALL', country: 'EU', category: 'ALL', ruleType: 'PRODUCT_SAFETY', riskLevel: 'P1', reviewStatus: 'ACTIVE', title: '欧盟站点需核对产品安全与追溯信息', summary: '面向欧盟销售的商品需根据类目核对制造商、欧盟负责人、警告和合规文件。', keywords: [], requiredFields: ['manufacturer', 'euResponsiblePerson'], remediation: '在发布前补充适用的产品安全、追溯和欧盟负责人信息，并由人工确认。', sourceUrl: 'https://www.ebay.com/help/selling/selling/product-safety-disclosures?id=5407', effectiveFrom: '2024-12-13' },
    { code: 'US-CPSC-RECALL-GATE', platform: 'EBAY', marketplaceSite: 'EBAY_US', country: 'US', category: 'ALL', ruleType: 'OFFICIAL_RECALL', riskLevel: 'P0', reviewStatus: 'ACTIVE', title: '美国站发布前必须排除 CPSC 召回商品', summary: '检查引擎将商品标题、型号和描述与 CPSC 官方召回数据匹配；疑似命中时阻止发布。', keywords: [], requiredFields: [], remediation: '核对召回页中的品牌、型号、批次和图片；命中范围的商品不得发布。', sourceUrl: 'https://www.cpsc.gov/Recalls', effectiveFrom: '2025-01-01' },
    { code: 'EBAY-UK-PRODUCT-SAFETY', platform: 'EBAY', marketplaceSite: 'EBAY_GB', country: 'GB', category: 'ALL', ruleType: 'PRODUCT_SAFETY', riskLevel: 'P1', reviewStatus: 'ACTIVE', title: '英国站需核对产品安全、标签与追溯资料', summary: '面向英国销售的商品需根据类目核对制造商、进口商、型号、警告与适用合规资料。', keywords: [], requiredFields: ['itemSpecifics'], remediation: '补充英国市场适用的标识、追溯与安全资料，并由人工核验后重新检查。', sourceUrl: 'https://www.gov.uk/guidance/product-safety-advice-for-businesses', effectiveFrom: '2025-01-01' },
    { code: 'OZON-LISTING-REQUIRED', platform: 'OZON', marketplaceSite: 'ALL', country: 'ALL', category: 'ALL', ruleType: 'LISTING_REQUIREMENTS', riskLevel: 'P0', reviewStatus: 'ACTIVE', title: 'Ozon 刊登基础资料必须完整', summary: '发布前必须包含有效类目、标题和主图。', keywords: [], requiredFields: ['categoryName', 'title', 'imageUrl'], remediation: '补充缺失的类目、标题或主图后重新检查。', sourceUrl: 'https://docs.ozon.ru/global/', effectiveFrom: '2025-01-01' },
    { code: 'OZON-RESTRICTED-SENSITIVE', platform: 'OZON', marketplaceSite: 'ALL', country: 'ALL', category: 'ALL', ruleType: 'PROHIBITED_RESTRICTED', riskLevel: 'P1', reviewStatus: 'ACTIVE', title: 'Ozon 疑似禁限售商品需人工核验', summary: '检测到药品、武器、烟草或其他敏感商品线索，必须核对平台与目的国要求。', keywords: ['prescription drug', 'firearm', 'ammunition', 'tobacco', 'vape', '处方药', '枪支', '弹药', '烟草', '电子烟'], requiredFields: [], remediation: '核对 Ozon 最新禁限售政策、类目准入和目的国法规并留存证据。', sourceUrl: 'https://docs.ozon.ru/global/', effectiveFrom: '2025-01-01' },
    { code: 'ALIEXPRESS-LISTING-REQUIRED', platform: 'ALIEXPRESS', marketplaceSite: 'ALL', country: 'ALL', category: 'ALL', ruleType: 'LISTING_REQUIREMENTS', riskLevel: 'P0', reviewStatus: 'ACTIVE', title: 'AliExpress 刊登基础资料必须完整', summary: '发布前必须包含有效类目、标题和主图。', keywords: [], requiredFields: ['categoryName', 'title', 'imageUrl'], remediation: '补充缺失的类目、标题或主图后重新检查。', sourceUrl: 'https://service.aliexpress.com/page/home', effectiveFrom: '2025-01-01' },
    { code: 'ALIEXPRESS-RESTRICTED-SENSITIVE', platform: 'ALIEXPRESS', marketplaceSite: 'ALL', country: 'ALL', category: 'ALL', ruleType: 'PROHIBITED_RESTRICTED', riskLevel: 'P1', reviewStatus: 'ACTIVE', title: 'AliExpress 疑似禁限售商品需人工核验', summary: '检测到药品、武器、烟草或其他敏感商品线索，必须核对平台与目的国要求。', keywords: ['prescription drug', 'firearm', 'ammunition', 'tobacco', 'vape', '处方药', '枪支', '弹药', '烟草', '电子烟'], requiredFields: [], remediation: '核对 AliExpress 最新禁限售政策、类目准入和目的国法规并留存证据。', sourceUrl: 'https://service.aliexpress.com/page/home', effectiveFrom: '2025-01-01' }
  ]
  for (const draft of rules) {
    const existing = await prisma.complianceRule.findFirst({ where: { orgId, code: draft.code }, select: { id: true } })
    if (existing) continue
    const id = randomUUID()
    await prisma.complianceRule.create({
      data: {
        id,
        orgId,
        code: draft.code,
        platform: draft.platform,
        marketplaceSite: draft.marketplaceSite,
        country: draft.country,
        category: draft.category,
        ruleType: draft.ruleType,
        riskLevel: draft.riskLevel,
        reviewStatus: draft.reviewStatus,
        currentVersion: 1,
        createdAt: now,
        updatedAt: now,
        versions: {
          create: {
            id: randomUUID(),
            orgId,
            version: 1,
            title: draft.title,
            summary: draft.summary,
            conditionJson: { keywords: draft.keywords, requiredFields: draft.requiredFields },
            remediation: draft.remediation,
            sourceUrl: draft.sourceUrl,
            effectiveFrom: draft.effectiveFrom,
            createdAt: now
          }
        }
      }
    })
  }

  const templates = [
    { name: 'eBay 美国站通用发布要求', platform: 'EBAY', marketplaceSite: 'EBAY_US', country: 'US', category: 'ALL', requiredFields: ['categoryName', 'title', 'imageUrl'], requiredDocuments: [] as string[], requiredWarnings: [] as string[], logisticsRequirements: ['核对电池、液体、粉末及危险品运输限制'], requiresManualReview: 0 },
    { name: 'eBay 欧盟站产品安全要求', platform: 'EBAY', marketplaceSite: 'ALL', country: 'EU', category: 'ALL', requiredFields: ['categoryName', 'title', 'imageUrl', 'itemSpecifics'], requiredDocuments: ['EU_RESPONSIBLE_PERSON', 'SAFETY_DOCUMENT'], requiredWarnings: ['按产品类型提供当地语言安全警告'], logisticsRequirements: [] as string[], requiresManualReview: 1 },
    { name: 'eBay 英国站产品安全要求', platform: 'EBAY', marketplaceSite: 'EBAY_GB', country: 'GB', category: 'ALL', requiredFields: ['categoryName', 'title', 'imageUrl', 'itemSpecifics'], requiredDocuments: ['UK_IMPORTER_OR_RESPONSIBLE_PERSON', 'SAFETY_DOCUMENT'], requiredWarnings: ['核对英国市场适用的安全警告'], logisticsRequirements: [] as string[], requiresManualReview: 1 },
    { name: 'Ozon 通用发布要求', platform: 'OZON', marketplaceSite: 'ALL', country: 'ALL', category: 'ALL', requiredFields: ['categoryName', 'title', 'imageUrl'], requiredDocuments: [] as string[], requiredWarnings: ['按商品类目和销售国家核对俄文安全警告'], logisticsRequirements: ['核对电池、液体、粉末及危险品运输限制'], requiresManualReview: 1 },
    { name: 'AliExpress 通用发布要求', platform: 'ALIEXPRESS', marketplaceSite: 'ALL', country: 'ALL', category: 'ALL', requiredFields: ['categoryName', 'title', 'imageUrl'], requiredDocuments: [] as string[], requiredWarnings: ['按目标国家和商品类目核对安全警告'], logisticsRequirements: ['核对电池、液体、粉末及危险品运输限制'], requiresManualReview: 1 }
  ]
  for (const template of templates) {
    const existing = await prisma.complianceCategoryTemplate.findFirst({ where: { orgId, name: template.name }, select: { id: true } })
    if (existing) continue
    await prisma.complianceCategoryTemplate.create({
      data: {
        id: randomUUID(),
        orgId,
        name: template.name,
        platform: template.platform,
        marketplaceSite: template.marketplaceSite,
        country: template.country,
        category: template.category,
        requiredFieldsJson: template.requiredFields,
        requiredDocumentsJson: template.requiredDocuments,
        requiredWarningsJson: template.requiredWarnings,
        logisticsRequirementsJson: template.logisticsRequirements,
        requiresManualReview: template.requiresManualReview,
        active: 1,
        createdAt: now,
        updatedAt: now
      }
    })
  }
}
