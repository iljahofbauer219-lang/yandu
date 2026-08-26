// 平台详情页数据（自建内容，不依赖 amz123 详情页）
// 本次先落地 amazon 样本；结构预留批量扩展。

export interface PlatformSite {
  /** 站点显示名，如「美国站」 */
  name: string
  /** 本地国旗资源路径（public/flags/xx.svg） */
  flag: string
  /** 该分站官网地址，点击新页打开 */
  url: string
}

/** 简介内容块：text=单段落；list=要点列表；steps=编号流程 */
export interface IntroSection {
  title: string
  type: 'text' | 'list' | 'steps'
  text?: string
  items?: string[]
}

export interface PlatformDetail {
  /** 路由 slug：/nav/platform/{slug} */
  slug: string
  /** 与 _sites.ts 中 name 对应，用于首页卡片跳转匹配 */
  matchName: string
  name: string
  /** 本地 logo 路径（复用 public/logos/） */
  logo: string
  /** 顶部一句话简介 */
  tagline: string
  /** 官网地址 */
  officialUrl: string
  officialHost: string
  /** 顶部横幅渐变色 [起, 止] */
  banner: [string, string]
  /** ② 平台站点入口 */
  sites: PlatformSite[]
  /** ③ 平台详细介绍 */
  intro: {
    /** 本地平台截图（public/shots/xxx.png），可选 */
    image?: string
    heading: string
    sections: IntroSection[]
    facts: { label: string; value: string }[]
  }
}

export const PLATFORM_DETAILS: PlatformDetail[] = [
  {
    slug: 'amazon',
    matchName: '亚马逊',
    name: '亚马逊',
    logo: './logos/ac87a5a0f31a2951.jpeg',
    tagline: '亚马逊（Amazon），是美国最大的一家电商企业，位于华盛顿州的西雅图，它是最早开始运营电商业务的公司之一',
    officialUrl: 'https://www.amazon.com',
    officialHost: 'www.amazon.com',
    banner: ['#5b8def', '#7d6bf9'],
    sites: [
      { name: '美国站', flag: './flags/us.svg', url: 'https://www.amazon.com' },
      { name: '英国站', flag: './flags/gb.svg', url: 'https://www.amazon.co.uk' },
      { name: '德国站', flag: './flags/de.svg', url: 'https://www.amazon.de' },
      { name: '法国站', flag: './flags/fr.svg', url: 'https://www.amazon.fr' },
      { name: '意大利站', flag: './flags/it.svg', url: 'https://www.amazon.it' },
      { name: '西班牙站', flag: './flags/es.svg', url: 'https://www.amazon.es' },
      { name: '日本站', flag: './flags/jp.svg', url: 'https://www.amazon.co.jp' },
      { name: '加拿大站', flag: './flags/ca.svg', url: 'https://www.amazon.ca' },
      { name: '墨西哥站', flag: './flags/mx.svg', url: 'https://www.amazon.com.mx' },
      { name: '印度站', flag: './flags/in.svg', url: 'https://www.amazon.in' },
      { name: '巴西站', flag: './flags/br.svg', url: 'https://www.amazon.com.br' },
      { name: '荷兰站', flag: './flags/nl.svg', url: 'https://www.amazon.nl' },
      { name: '瑞典站', flag: './flags/se.svg', url: 'https://www.amazon.se' },
      { name: '波兰站', flag: './flags/pl.svg', url: 'https://www.amazon.pl' },
      { name: '比利时站', flag: './flags/be.svg', url: 'https://www.amazon.com.be' },
      { name: '土耳其站', flag: './flags/tr.svg', url: 'https://www.amazon.com.tr' },
      { name: '澳大利亚站', flag: './flags/au.svg', url: 'https://www.amazon.com.au' },
      { name: '阿联酋站', flag: './flags/ae.svg', url: 'https://www.amazon.ae' },
      { name: '埃及站', flag: './flags/eg.svg', url: 'https://www.amazon.eg' },
      { name: '沙特站', flag: './flags/sa.svg', url: 'https://www.amazon.sa' },
      { name: '新加坡站', flag: './flags/sg.svg', url: 'https://www.amazon.sg' },
      { name: '卖家中心', flag: './flags/seller.svg', url: 'https://sell.amazon.com' },
    ],
    intro: {
      image: './shots/amazon.jpg',
      heading: '关于 Amazon（亚马逊）：',
      sections: [
        {
          title: '平台概览',
          type: 'text',
          text: '亚马逊（Amazon）创立于 1995 年，总部位于美国西雅图，从在线书店起步，成长为全球最大的综合性电商与云计算公司之一，业务覆盖电商零售、AWS 云服务、智能硬件与数字内容，是全球市值最高的互联网企业之一。对跨境卖家而言，亚马逊仍是体量最大、规则最成熟的第三方销售平台。',
        },
        {
          title: '主要市场',
          type: 'text',
          text: '亚马逊目前在全球开放 20 余个站点，覆盖北美（美国、加拿大、墨西哥）、拉美（巴西）、欧洲（英国、德国、法国、意大利、西班牙、荷兰、瑞典、波兰、比利时、土耳其）、中东（阿联酋、沙特、埃及）与亚太（日本、澳大利亚、新加坡、印度）。一套注册资料可同时申请开通多个站点，专业计划月租费各站点共享。',
        },
        {
          title: '主要品类',
          type: 'text',
          text: '涵盖家居生活、消费电子、服装鞋包、美妆个护、母婴玩具、运动户外、厨房小家电、宠物用品、办公文具等大类，其中家居、电子、服饰为成交体量最大的三大类目。',
        },
        {
          title: '平台优势',
          type: 'list',
          items: [
            '优质客群：全球超 2 亿 Prime 会员，复购率与客单价高，构成平台核心护城河；',
            '成熟物流：FBA 履约网络遍布全球，商品可配送至 200 多个国家和地区；',
            '品牌保护：Brand Registry、Transparency 透明计划等工具帮助权利人打击跟卖与假货；',
            'AI 加持（最新变化）：Rufus AI 购物助手与 AI 生成 Listing 工具陆续上线，正在改变流量分发与内容生产方式。',
          ],
        },
        {
          title: '物流方式',
          type: 'text',
          text: '分为 FBA（Fulfillment by Amazon，亚马逊物流）与 FBM（卖家自发货）两种模式。FBA 将仓储、拣货、包装、配送与售后交给平台，Listing 可获得 Prime 标识与更优曝光；FBM 由卖家自行发货，灵活度更高，适合测新品与长尾 SKU。多数卖家采用「FBA 为主、FBM 为辅」的组合策略。',
        },
        {
          title: '平台费用',
          type: 'list',
          items: [
            '月租费：专业卖家计划 39.99 美元/月，2024 年起一套月租覆盖全球主要站点（新政策）；',
            '销售佣金：按品类差异化收取，普遍在 8%–15% 之间，部分品类设最低佣金；',
            '物流仓储费：FBA 按件收取配送费与月度仓储费，旺季（Q4）仓储费上浮。',
          ],
        },
        {
          title: '平台收款',
          type: 'text',
          text: '回款周期约 14 天；主要站点支持原币种结算，卖家通常接入 Payoneer、连连、PingPong 等第三方收款工具结汇回国。',
        },
        {
          title: '禁售与受限商品',
          type: 'list',
          items: [
            '绝对禁售：处方药、违禁药品、枪支弹药与爆炸物、电子烟及烟草、干扰监控设备、侵犯他人知识产权的商品；',
            '受限品类：食品、化妆品、医疗器械、儿童用品等需申请类目审核或提交合规认证（如 FDA、CE）；',
            'Listing 宣传不得出现虚假医疗功效宣称，违者下架并可能冻结账户。',
          ],
        },
        {
          title: '入驻流程',
          type: 'steps',
          items: [
            '准备资料：营业执照、法人身份证、双币信用卡、收款账户、邮箱与手机号；',
            '注册账户：进入卖家平台注册，填写信息并完成身份验证与视频认证；',
            '店铺设置：绑定收款与税务信息，设置退货地址与配送模板；',
            '上架发货：创建 Listing，选择 FBA 入仓或 FBM 自发货；',
            '运营推广：开启广告、报名促销、维护评价，用数据工具持续优化；',
            '品牌沉淀：注册商标并加入 Brand Registry，解锁品牌保护与 A+ 内容。',
          ],
        },
      ],
      facts: [
        { label: '成立时间', value: '1995 年' },
        { label: '总部', value: '美国 · 西雅图' },
        { label: 'Prime 会员', value: '2 亿+（全球）' },
        { label: '开放站点', value: '20+ 个国家/地区' },
      ],
    },
  },
]

/** 首页卡片 → 详情页 slug 匹配；未收录的平台返回 null（仍跳原链接） */
export function findDetailBySiteName(name: string): PlatformDetail | null {
  return PLATFORM_DETAILS.find((d) => d.matchName === name) ?? null
}

export function findDetailBySlug(slug: string): PlatformDetail | null {
  return PLATFORM_DETAILS.find((d) => d.slug === slug) ?? null
}
