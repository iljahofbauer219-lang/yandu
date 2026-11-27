// 货盘平台首页与会话罐单一真值源：渲染层开页与主进程 partition 共用，避免两处名录漂移。
// 每个货盘平台独立 cookie 罐（persist:supply-site:<注册域>）；大健云仓/1688 沿用既有供应罐保证自动登录与采集零回归。
export const PALLET_HOME_URLS: Record<string, string> = {QUFENXIAO:'https://www.qufenxiao.com/',KJDS:'https://www.kjds.com/',KJDS_EU:'https://www.kjds.com/',KJDS_AU:'https://www.kjds.com/sells/homes/search?country_id=16506',KJDS_CN:'https://www.kjds.com/sells/homes/search?country_id=13227',BIGBUY:'https://www.bigbuy.eu/en/',SALEYEE_NA:'https://global.saleyee.com/',SALEYEE_EU:'https://global.saleyee.com/',SALEYEE_AS:'https://global.saleyee.com/',SALEYEE_OCE:'https://global.saleyee.com/',SALEYEE_LATAM:'https://global.saleyee.com/',SALEYEE_ME:'https://global.saleyee.com/',YIMAI:'https://dcmshop.easyseller.com/',HAIBEI:'https://www.haibeigoods.com/',HAIBEI_NA:'https://www.haibeigoods.com/',HAIBEI_EU:'https://www.haibeigoods.com/',XIZHIYUE_NA:'https://westmonth.com/',XIZHIYUE_AU:'https://westmonth.com/',XIZHIYUE_EU:'https://westmonth.com/',XIZHIYUE_LATAM:'https://westmonth.com/',XIZHIYUE_AS:'https://westmonth.com/',XIZHIYUE_CN:'https://westmonth.com/',CJDROP_NA:'https://www.cjdropshipping.com/',CJDROP_EU:'https://www.cjdropshipping.com/',CJDROP_AU:'https://www.cjdropshipping.com/',CJDROP_LATAM:'https://www.cjdropshipping.com/',CJDROP_CN:'https://www.cjdropshipping.com/',FAIRE:'https://www.faire.com/',JOYB2B:'https://joyb2b.com/',SYNCEE_NA:'https://syncee.com/',SYNCEE_EU:'https://syncee.com/',SYNCEE_AU:'https://syncee.com/',DSERS:'https://www.dsers.com/',VANTA_LATAM:'https://vantadist.com/',VANTA_AFRICA:'https://vantadist.com/',VANTA_AS:'https://vantadist.com/',BOTACLOUD:'https://www.botacloud.com/',FORTUNE_NA:'https://www.fortune-onestop.com/',FORTUNE_EU:'https://www.fortune-onestop.com/',FORTUNE_LATAM:'https://www.fortune-onestop.com/',FORTUNE_AFRICA:'https://www.fortune-onestop.com/',FORTUNE_AS:'https://www.fortune-onestop.com/',FORTUNE_CN:'https://www.fortune-onestop.com/','4SUPPLY':'https://www.4supply.com/',DROPSHIP:'https://www.eggracks.com/',XUNFENG:'https://www.xffbb.com/',ALIBABA_US:'https://sale.alibaba.com/p/d6dcdevhb/index.html',ALIDROP_NA:'https://www.alibaba.com/dropshipping/products',ALIDROP_EU:'https://www.alibaba.com/dropshipping/products',ALIDROP_AS:'https://www.alibaba.com/dropshipping/products',ALIDROP_CN:'https://www.alibaba.com/dropshipping/products',HICUSTOM:'https://www.hicustom.com/',ARKSWIFT:'https://www.arkswift.com/',HERTWILL:'https://hertwill.com/',MATTERHORN:'https://matterhorn.pl/',APPSCENIC:'https://appscenic.com/',STOCKETIK:'https://www.stocketik.eu/',DROPXL:'https://www.dropxl.com/',DOBA:'https://www.doba.com/',TOPDAWG:'https://topdawg.com/',SPOCKET:'https://www.spocket.co/',ZENDROP:'https://www.zendrop.com/',WHOLESALE2B:'https://www.wholesale2b.com/',SODALEMONS:'https://sodalemons.com/',EBOXMAN:'https://eboxman.com/',AUTODS:'https://www.autods.com/',USDIRECT:'https://gousdirect.com/',WHOLESALECENTRAL:'https://www.wholesalecentral.com/',DROPCOMMERCE:'https://www.dropcommerce.com/',OBERLO:'https://www.oberlo.com/',MODALYST:'https://www.modalyst.co/',GREENDROPSHIP:'https://greendropship.com/',SALEHOO:'https://www.salehoo.com/',WORLDWIDEBRANDS:'https://worldwidebrands.com/',MISSIONIMPRINTABLES:'https://www.missionimprintables.com/',INVENTORYSOURCE:'https://www.inventorysource.com/',SHIPSTATION:'https://www.shipstation.com/',DSMTOOL:'https://www.dsmtool.com/',DIECASTDROPSHIPPER:'https://www.diecastdropshipper.com/',RITHUM:'https://www.rithum.com/',SHOPIFY:'https://www.shopify.com/collective',BRANDSGATEWAY:'https://brandsgateway.com/',BDROPPY:'https://www.bdroppy.com/',BRANDSDISTRIBUTION:'https://www.brandsdistribution.com/',WAVEGO:'https://www.wavego.eu/',M5AZN:'https://m5azn.com/',DROPSHIPSA:'https://dropship.sa/',EMIRATEFULFIL:'https://www.emiratefulfil.com/',CODPARTNER:'https://codpartner.com/',TRADELING:'https://www.tradeling.com/',TEJARAA:'https://tejaraa.com/',KSADROP:'https://ksadrop.com/',SMMD:'https://www.saudidropshipping.com/',YALLAHSELL:'https://yallahsell.com/',ATSUM:'https://www.myatsum.com/',DROPI:'https://dropi.co/',DROPLATAM:'https://home.droplatam.com.br/',DEPDROP:'https://depdrop.com.br/',DROPPING:'https://dropping.com.br/',DROPI_BR:'https://dropi.com.br/',NOCNOC:'https://nocnocstore.com/',CARPARTS:'https://www.carparts.com/',MADEINCHINA:'https://www.made-in-china.com/',YIWUGO:'https://www.yiwugo.com/',VIDAXL:'https://corporate.vidaxl.com/',DUBLAA:'https://dublaa.com/',SAAZ:'https://saazautospareparts.ae/',TRIPLEA:'https://triple-a-trading.com/',EMEX:'https://emexdwc.ae/','1688GLOBAL':'https://global.1688.com/',TOYBABA:'https://www.toybaba.com/',ICHUNT:'https://www.ichunt.com/',HQEW:'https://www.hqew.com/',BOQII:'https://www.boqii.com/',POPFASHION:'https://www.pop-fashion.com/',YUNCHEPIN:'https://www.yunchepin.cn/'}

const MULTI_PART_SUFFIXES = ['com.br', 'com.au', 'co.uk', 'com.cn', 'com.mx', 'co.nz', 'com.ar']

export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean)
  const tail2 = labels.slice(-2).join('.')
  if (MULTI_PART_SUFFIXES.includes(tail2)) return labels.slice(-3).join('.')
  return tail2
}

const SUPPLY_SITE_DOMAINS = new Set(Object.values(PALLET_HOME_URLS).map(url => {
  try { return registrableDomain(new URL(url).hostname) } catch { return '' }
}).filter(Boolean))

/** 货盘域名 → 独立会话罐；非货盘域名返回 null（调用方回落通用罐） */
export function supplySessionPartitionForUrl(url: string): string | null {
  let host = ''
  try { host = new URL(url).hostname } catch { return null }
  const domain = registrableDomain(host)
  if (domain === 'gigab2b.com') return 'persist:supply:GIGACLOUD:default'
  if (domain === '1688.com') return 'persist:supply:1688:default'
  if (!SUPPLY_SITE_DOMAINS.has(domain)) return null
  return `persist:supply-site:${domain}`
}

/** 页签组（平台入口码）→ 会话罐：新建空白页与开页同罐，登录态互通 */
export function supplyPartitionForGroup(group: string): string {
  const home = PALLET_HOME_URLS[group]
  return (home && supplySessionPartitionForUrl(home)) || 'persist:web-general'
}

const EXTRA_PLATFORM_DOMAINS: Record<string, string[]> = {
  GIGACLOUD: ['gigab2b.com'],
  '1688': ['1688.com'],
  PINDUODUO: ['pinduoduo.com', 'yangkeduo.com'],
  YIWUGO: ['yiwugo.com', 'yiwugou.com', 'yiwugocn.com']
}

/** 采集/凭据域名闸口径：当前货盘平台自身登记域（区域变体同域），未登记平台返回空 */
export function platformDomainsForCode(code: string): string[] {
  const extra = EXTRA_PLATFORM_DOMAINS[code]
  if (extra) return extra
  const home = PALLET_HOME_URLS[code]
  if (!home) return []
  try { return [registrableDomain(new URL(home).hostname)] } catch { return [] }
}

export function hostAllowedForDomains(host: string, domains: string[]): boolean {
  return domains.some(domain => host === domain || host.endsWith(`.${domain}`))
}
