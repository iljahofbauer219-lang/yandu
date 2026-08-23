import { prisma } from './prisma.js'
import { seedComplianceKnowledge } from '../modules/compliance/seed.js'

/**
 * 组织级参考数据种子：移植自 AppDatabase 构造器内的建表种子（78-138 行）。
 * 语义对齐：
 * - supply_platforms / marketplace_platforms：INSERT OR IGNORE（已存在不覆盖，保留组织内后续修改）
 * - product_warehouses：ON CONFLICT DO UPDATE（每次执行都刷新名称/规则画像/启用态）
 * - 合规知识（来源/规则/模板）：见 compliance/seed.ts
 * 在注册建组织成功后调用；重复执行幂等。
 */
export async function seedOrgReferenceData(orgId: string) {
  // ---------- 供应平台（11 个，仅 1688 已具备浏览器采集能力） ----------
  const supplyPlatforms = [
    { code: '1688', name: '1688', connectorStatus: 'BROWSER_READY', sortOrder: 1 },
    { code: 'TAOBAO', name: '淘宝', connectorStatus: 'PLANNED', sortOrder: 2 },
    { code: 'TMALL', name: '天猫', connectorStatus: 'PLANNED', sortOrder: 3 },
    { code: 'JD', name: '京东', connectorStatus: 'PLANNED', sortOrder: 4 },
    { code: 'PINDUODUO', name: '拼多多', connectorStatus: 'PLANNED', sortOrder: 5 },
    { code: 'DOUYIN', name: '抖音商城', connectorStatus: 'PLANNED', sortOrder: 6 },
    { code: 'XIAOHONGSHU', name: '小红书', connectorStatus: 'PLANNED', sortOrder: 7 },
    { code: 'KUAISHOU', name: '快手电商', connectorStatus: 'PLANNED', sortOrder: 8 },
    { code: 'GIGACLOUD', name: '大健云仓', connectorStatus: 'PLANNED', sortOrder: 9 },
    { code: 'YIWUGO', name: '义乌购', connectorStatus: 'PLANNED', sortOrder: 10 },
    { code: 'CUSTOM', name: '自定义平台', connectorStatus: 'PLANNED', sortOrder: 11 }
  ]
  for (const platform of supplyPlatforms) {
    const existing = await prisma.supplyPlatform.findUnique({
      where: { orgId_code: { orgId, code: platform.code } },
      select: { code: true }
    })
    if (existing) continue
    await prisma.supplyPlatform.create({ data: { orgId, ...platform } })
  }

  // ---------- 市场平台（5 个，仅 OZON 采集器就绪） ----------
  const marketplacePlatforms = [
    { code: 'OZON', name: 'Ozon / 欧众', homeUrl: 'https://www.ozon.ru/', defaultNetworkStrategy: 'LOCAL_DIRECT', collectorReady: 1 },
    { code: 'AMAZON', name: 'Amazon', homeUrl: 'https://www.amazon.com/', defaultNetworkStrategy: 'LOCAL_DIRECT', collectorReady: 0 },
    { code: 'EBAY', name: 'eBay', homeUrl: 'https://www.ebay.com/', defaultNetworkStrategy: 'LOCAL_DIRECT', collectorReady: 0 },
    { code: 'ALIEXPRESS', name: 'AliExpress', homeUrl: 'https://www.aliexpress.com/', defaultNetworkStrategy: 'LOCAL_DIRECT', collectorReady: 0 },
    { code: 'TEMU', name: 'Temu', homeUrl: 'https://www.temu.com/', defaultNetworkStrategy: 'LOCAL_DIRECT', collectorReady: 0 }
  ]
  for (const platform of marketplacePlatforms) {
    const existing = await prisma.marketplacePlatform.findUnique({
      where: { orgId_code: { orgId, code: platform.code } },
      select: { code: true }
    })
    if (existing) continue
    await prisma.marketplacePlatform.create({ data: { orgId, ...platform } })
  }

  // ---------- 产品仓库（4 个，upsert 刷新规则画像） ----------
  const now = new Date().toISOString()
  const warehouses = [
    { code: 'GIGACLOUD', name: '大健云仓', warehouseKind: 'SUPPLY', ruleProfile: ['海外仓可售库存', '仓库位置与配送区域', '尾程费用与履约时效', '重量体积与破损风险'] },
    { code: 'ALIEXPRESS', name: 'AliExpress', warehouseKind: 'MARKET', ruleProfile: ['订单量与评价质量', '售价及折扣稳定性', '配送时效与店铺表现', '竞争强度与货源利润'] },
    { code: '1688', name: '1688', warehouseKind: 'SUPPLY', ruleProfile: ['超级工厂与源头旗舰', '阶梯价格与MOQ', '回头率及全网销量', '综合服务与发货时效'] },
    { code: 'OZON', name: 'Ozon', warehouseKind: 'MARKET', ruleProfile: ['卢布售价与销量表现', '评分评论与品牌风险', '平台佣金与物流成本', '1688同款及预计利润'] }
  ]
  for (const warehouse of warehouses) {
    await prisma.productWarehouse.upsert({
      where: { orgId_code: { orgId, code: warehouse.code } },
      create: { orgId, ...warehouse, enabled: 1, updatedAt: now },
      update: { name: warehouse.name, warehouseKind: warehouse.warehouseKind, ruleProfile: warehouse.ruleProfile, enabled: 1, updatedAt: now }
    })
  }

  // ---------- 合规知识（来源/规则/类目模板） ----------
  await seedComplianceKnowledge(orgId)
}
