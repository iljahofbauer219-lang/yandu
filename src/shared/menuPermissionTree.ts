/**
 * 两级使用权限树：一级=侧边栏菜单，二级=栏目内卡片。
 * 码表与 server/src/modules/rbac/permissions.ts 保持一致（前后端各存一份）。
 */
export interface MenuCardPerm {
  code: string
  label: string
}

export interface MenuPermNode {
  code: string
  label: string
  cards: MenuCardPerm[]
}

export const MENU_PERMISSION_TREE: MenuPermNode[] = [
  // 阶段：左侧栏重排新增的三个占位入口（尚不执行业务代码）
  { code: 'menu.cb-news', label: 'CB资讯', cards: [] },
  { code: 'menu.ie-browser', label: 'IE浏览', cards: [] },
  {
    code: 'menu.crossborder', label: 'AI跨境', cards: [
      { code: 'menu.crossborder.login', label: '平台登录' },
      { code: 'menu.crossborder.title', label: '标题优化' },
      { code: 'menu.crossborder.desc', label: '描述优化' },
      { code: 'menu.crossborder.image', label: '图片优化' }
    ]
  },
  { code: 'menu.advisor', label: 'AI参谋', cards: [{ code: 'menu.advisor.online', label: '在线参谋' }] },
  { code: 'menu.warehouse', label: '货盘仓库', cards: [
    { code: 'menu.warehouse.hub', label: '货盘仓库' },
    { code: 'menu.warehouse.pool', label: '采集池' },
    { code: 'menu.warehouse.products', label: '产品库' },
    { code: 'menu.warehouse.changes', label: '待确认变更' },
    { code: 'menu.warehouse.patrol', label: '巡盘日志' },
    { code: 'menu.warehouse.pricing', label: '定价规则' }
  ] },
  {
    code: 'menu.collect', label: 'AI采集', cards: [
      { code: 'menu.collect.gigacloud', label: '大健云仓' },
      { code: 'menu.collect.1688', label: '1688' },
      { code: 'menu.collect.aliexpress', label: 'AliExpress' },
      { code: 'menu.collect.ozon', label: 'Ozon' },
      { code: 'menu.collect.qufenxiao', label: '趣分销' },
      { code: 'menu.collect.kjds', label: '越域网' },
      { code: 'menu.collect.kjdseu', label: '越域网(欧洲)' },
      { code: 'menu.collect.kjdsau', label: '越域网(澳洲)' },
      { code: 'menu.collect.kjdscn', label: '越域网(国内)' },
      { code: 'menu.collect.bigbuy', label: 'BigBuy' },
      { code: 'menu.collect.saleyeena', label: '赛盈(北美)' },
      { code: 'menu.collect.saleyeeeu', label: '赛盈(欧洲)' },
      { code: 'menu.collect.saleyeeas', label: '赛盈(亚洲)' },
      { code: 'menu.collect.saleyeeoce', label: '赛盈(澳洲)' },
      { code: 'menu.collect.saleyeelatam', label: '赛盈(拉美)' },
      { code: 'menu.collect.saleyeeme', label: '赛盈(中东)' },
      { code: 'menu.collect.yimai', label: '亿迈' },
      { code: 'menu.collect.haibei', label: '海贝' },
      { code: 'menu.collect.haibeina', label: '海贝(北美)' },
      { code: 'menu.collect.haibeeeu', label: '海贝(欧洲)' },
      { code: 'menu.collect.xizhiyuena', label: '西之月(北美)' },
      { code: 'menu.collect.xizhiyueau', label: '西之月(澳洲)' },
      { code: 'menu.collect.xizhiyueeu', label: '西之月(欧洲)' },
      { code: 'menu.collect.xizhiyuelatam', label: '西之月(拉美)' },
      { code: 'menu.collect.xizhiyueas', label: '西之月(亚洲)' },
      { code: 'menu.collect.xizhiyuecn', label: '西之月(中国)' },
      { code: 'menu.collect.cjdropna', label: 'CJdropshipping(北美)' },
      { code: 'menu.collect.cjdropeu', label: 'CJdropshipping(欧洲)' },
      { code: 'menu.collect.cjdropau', label: 'CJdropshipping(澳洲)' },
      { code: 'menu.collect.cjdroplatam', label: 'CJdropshipping(拉美)' },
      { code: 'menu.collect.cjdropcn', label: 'CJdropshipping(中国)' },
      { code: 'menu.collect.faire', label: 'Faire' },
      { code: 'menu.collect.joyb2b', label: 'JOYB2B' },
      { code: 'menu.collect.synceena', label: 'Syncee(北美)' },
      { code: 'menu.collect.synceeeu', label: 'Syncee(欧洲)' },
      { code: 'menu.collect.synceeau', label: 'Syncee(澳洲)' },
      { code: 'menu.collect.dsers', label: 'DSers' },
      { code: 'menu.collect.vantalatam', label: 'VANTA(拉美)' },
      { code: 'menu.collect.vantafrica', label: 'VANTA(非洲)' },
      { code: 'menu.collect.vantaas', label: 'VANTA(亚洲)' },
      { code: 'menu.collect.botacloud', label: 'Botacloud' },
      { code: 'menu.collect.fortunena', label: 'Fortune(北美)' },
      { code: 'menu.collect.fortuneeu', label: 'Fortune(欧洲)' },
      { code: 'menu.collect.fortunelatam', label: 'Fortune(拉美)' },
      { code: 'menu.collect.fortuneafrica', label: 'Fortune(非洲)' },
      { code: 'menu.collect.fortuneas', label: 'Fortune(亚洲)' },
      { code: 'menu.collect.fortunecn', label: 'Fortune(中国)' },
      { code: 'menu.collect.4supply', label: '4supply' },
      { code: 'menu.collect.dropship', label: 'Dropshipping' },
      { code: 'menu.collect.xunfeng', label: '迅蜂' },
      { code: 'menu.collect.alibabaus', label: '阿里巴巴美国盘' },
      { code: 'menu.collect.alidropna', label: '阿里一件代发(北美)' },
      { code: 'menu.collect.alidropeu', label: '阿里一件代发(欧洲)' },
      { code: 'menu.collect.alidropas', label: '阿里一件代发(亚洲)' },
      { code: 'menu.collect.alidropcn', label: '阿里一件代发(中国)' },
      { code: 'menu.collect.hicustom', label: '指纹科技' },
      { code: 'menu.collect.arkswift', label: 'ArkSwift' },
      { code: 'menu.collect.hertwill', label: 'Hertwill' },
      { code: 'menu.collect.matterhorn', label: 'Matterhorn' },
      { code: 'menu.collect.appscenic', label: 'Appscenic' },
      { code: 'menu.collect.stocketik', label: 'Stocketik' },
      { code: 'menu.collect.dropxl', label: 'dropXL' },
      { code: 'menu.collect.doba', label: 'doba' },
      { code: 'menu.collect.topdawg', label: 'TopDawg' },
      { code: 'menu.collect.spocket', label: 'spocket' },
      { code: 'menu.collect.zendrop', label: 'Zendrop' },
      { code: 'menu.collect.wholesale2b', label: 'Wholesale2b' },
      { code: 'menu.collect.sodalemons', label: 'Sodalemons' },
      { code: 'menu.collect.eboxman', label: 'Eboxman' },
      { code: 'menu.collect.autods', label: 'Autods' },
      { code: 'menu.collect.usdirect', label: 'US Direct' },
      { code: 'menu.collect.wholesalecentral', label: 'Wholesalecentral' },
      { code: 'menu.collect.dropcommerce', label: 'DropCommerce' },
      { code: 'menu.collect.oberlo', label: 'Oberlo' },
      { code: 'menu.collect.modalyst', label: 'Modalyst' },
      { code: 'menu.collect.greendropship', label: 'GreenDropShip' },
      { code: 'menu.collect.salehoo', label: 'SaleHoo' },
      { code: 'menu.collect.worldwidebrands', label: 'Worldwide Brands' },
      { code: 'menu.collect.missionimprintables', label: 'Missionimprintables' },
      { code: 'menu.collect.inventorysource', label: 'Inventory Source' },
      { code: 'menu.collect.shipstation', label: 'ShipStation' },
      { code: 'menu.collect.dsmtool', label: 'DSMTool' },
      { code: 'menu.collect.diecastdropshipper', label: 'Diecastdropshipper' },
      { code: 'menu.collect.rithum', label: 'Rithum' },
      { code: 'menu.collect.shopify', label: 'Shopify' },
      { code: 'menu.collect.brandsgateway', label: 'Brandsgateway' },
      { code: 'menu.collect.bdroppy', label: 'BDroppy' },
      { code: 'menu.collect.brandsdistribution', label: 'BrandsDistribution' },
      { code: 'menu.collect.wavego', label: 'WaveGo' },
      { code: 'menu.collect.m5azn', label: 'M5azn' },
      { code: 'menu.collect.dropshipsa', label: 'Dropship' },
      { code: 'menu.collect.emiratefulfil', label: 'Emiratefulfil' },
      { code: 'menu.collect.codpartner', label: 'Cod Partner' },
      { code: 'menu.collect.tradeling', label: 'Tradeling' },
      { code: 'menu.collect.tejaraa', label: 'Tejaraa' },
      { code: 'menu.collect.ksadrop', label: 'Ksa Drop' },
      { code: 'menu.collect.smmd', label: 'SMMD Dropshipping' },
      { code: 'menu.collect.yallahsell', label: 'YallahSell' },
      { code: 'menu.collect.atsum', label: 'ATSUM' }
    ]
  },
  {
    code: 'menu.art', label: 'AI美工', cards: [
      { code: 'menu.art.studio', label: 'AI生图' },
      { code: 'menu.art.realshift', label: 'AI洗图' }
    ]
  },
  { code: 'menu.video', label: 'AI视频', cards: [] },
  // AI任务：服务端顶级权限码（permissions.ts 中与 menu.hq 平级，并非 AI总部子卡）。
  // 曾误挂在 menu.hq.cards 下，导致勾选「AI任务」经 toggleMenuCard 连带授予 menu.hq（AI总部整栏）。
  // 独立成栏后勾选只影响自身；AI任务卡片仍渲染在 AI总部页内（App.tsx），存量经旧树授权的用户
  // 因勾选时已被连带写入 menu.hq 而不丢访问，OPERATOR 预置也已显式补 menu.hq。
  { code: 'menu.tasks', label: 'AI任务', cards: [] },
  { code: 'menu.employee', label: 'AI员工', cards: [] },
  {
    code: 'menu.planet', label: 'AI星球', cards: [
      { code: 'menu.planet.ops', label: '运营知识库' },
      { code: 'menu.planet.compliance', label: '合规知识库' }
    ]
  },
  {
    code: 'menu.hq', label: 'AI总部', cards: [
      { code: 'menu.hq.finance', label: 'AI财务' },
      { code: 'menu.hq.support', label: 'AI客服' },
      { code: 'menu.hq.feishu', label: 'AI飞书' },
      { code: 'menu.hq.vpn', label: '翻墙管理' },
      { code: 'menu.hq.crossborder', label: '跨境导航' },
      { code: 'menu.hq.crawler', label: '文章抓取' },
      { code: 'menu.hq.admin', label: '系统管理' }
    ]
  }
]

export type MenuCheckState = 'none' | 'some' | 'all'

/** 一级勾选三态：无二级的一级叶子按一级码；有二级时按二级勾选数量（持有一级码但无二级视为半选） */
export function menuCheckState(selected: string[], node: MenuPermNode): MenuCheckState {
  const set = new Set(selected)
  if (node.cards.length === 0) return set.has(node.code) ? 'all' : 'none'
  const count = node.cards.filter(card => set.has(card.code)).length
  if (count === node.cards.length) return 'all'
  if (count > 0 || set.has(node.code)) return 'some'
  return 'none'
}

/** 一级菜单访问判断：持有一级码或任一下属二级码 */
export function hasMenuAccess(hasPerm: (code: string) => boolean, node: MenuPermNode): boolean {
  return hasPerm(node.code) || node.cards.some(card => hasPerm(card.code))
}

/** 点击一级勾选框：全选/清空该栏（含一级码与全部二级码） */
export function toggleMenu(selected: string[], node: MenuPermNode, checked: boolean): string[] {
  const codes = [node.code, ...node.cards.map(card => card.code)]
  if (checked) return [...new Set([...selected, ...codes])]
  return selected.filter(code => !codes.includes(code))
}

/** 点击二级勾选框：勾选自动带上一级；取消最后一个二级时自动取消一级 */
export function toggleMenuCard(selected: string[], node: MenuPermNode, cardCode: string, checked: boolean): string[] {
  if (checked) return [...new Set([...selected, cardCode, node.code])]
  let next = selected.filter(code => code !== cardCode)
  if (next.includes(node.code) && !node.cards.some(card => next.includes(card.code))) {
    next = next.filter(code => code !== node.code)
  }
  return next
}

/** 成员使用权限摘要：一级名顿号分隔，部分二级时如「AI美工（AI生图）」 */
export function summarizeMenuPermissions(selected: string[]): string {
  const set = new Set(selected)
  const parts: string[] = []
  for (const node of MENU_PERMISSION_TREE) {
    const state = menuCheckState(selected, node)
    if (state === 'none') continue
    if (state === 'all') {
      parts.push(node.label)
      continue
    }
    const cardLabels = node.cards.filter(card => set.has(card.code)).map(card => card.label)
    parts.push(cardLabels.length > 0 ? `${node.label}（${cardLabels.join('/')}）` : node.label)
  }
  return parts.join('、')
}
