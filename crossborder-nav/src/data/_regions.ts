export interface Site { name: string; desc: string; logo: string; href: string }
export interface Region { title: string; sites: Site[] }
export const REGIONS: Region[] = [
  {
    "title": "热门平台",
    "sites": [
      {
        "name": "亚马逊",
        "desc": "亚马逊（Amazon），是美国最大的一家电商企业，位于华盛顿州的西雅图，它是最早开始运营电商业务的公司之一",
        "logo": "./logos/ac87a5a0f31a2951.jpeg",
        "href": "https://www.amz123.com/amazon",
        "guide": ""
      },
      {
        "name": "eBay",
        "desc": "美国线上拍卖及购物网站，可让全球民众在网上买卖物品",
        "logo": "./logos/aa3e95cc7e918513.png",
        "href": "https://www.amz123.com/ebay",
        "guide": "https://www.amz123.com/ebay/guide"
      },
      {
        "name": "Ozon",
        "desc": "俄罗斯本土的B2C电商平台，多品类电商平台",
        "logo": "./logos/b278940468743587.png",
        "href": "https://www.amz123.com/ozonglobal",
        "guide": "https://www.amz123.com/ozonglobal/guide"
      },
      {
        "name": "Coupang",
        "desc": "Coupang是韩国Top级电商网站，被评为韩国最受欢迎的购物APP，在2020第一季度跃升成为韩国第一大线上零售商。截止2018年，该网站的注册会员数超过了2500万。",
        "logo": "./logos/c6cfa142b6b322b2.png",
        "href": "https://www.amz123.com/coupang",
        "guide": ""
      },
      {
        "name": "Temu",
        "desc": "拼多多旗下的全品类跨境电商平台，平台首站面向北美市场",
        "logo": "./logos/2bae2512b9b3c83e.png",
        "href": "https://www.amz123.com/temu",
        "guide": "https://www.amz123.com/temu/guide"
      },
      {
        "name": "TikTok",
        "desc": "TikTok Shop（也称TikTok 电商）是创新型电商平台，汇集商家、达人和买家。 TikTok Shop为商家和品牌提供一站式电子商务解决方案，助力在TikTok上实现销售和增长",
        "logo": "./logos/b98278cb9e6acfb9.png",
        "href": "https://www.amz123.com/tiktok",
        "guide": ""
      },
      {
        "name": "Lazada",
        "desc": "阿里巴巴集团东南亚旗舰电商平台，东南亚地区最大的在线购物网站之一。",
        "logo": "./logos/6669ddb4a7010e36.jpg",
        "href": "https://www.amz123.com/lazada",
        "guide": ""
      },
      {
        "name": "美客多",
        "desc": "拉美领先的电商与金融科技平台，致力于帮助中国品牌开拓拉美市场",
        "logo": "./logos/e71f3279224497af.webp",
        "href": "https://www.amz123.com/mercadolibre",
        "guide": ""
      },
      {
        "name": "eMAG",
        "desc": "罗马尼亚在线零售商，以电子及IT产品起家，后增加服装、化妆品、园艺等类别的产品",
        "logo": "./logos/c650494d589c0c5b.png",
        "href": "https://www.amz123.com/emag",
        "guide": ""
      },
      {
        "name": "Noon",
        "desc": "中东最大的电商平台之一，产品类别包括美容、时尚、电子产品等",
        "logo": "./logos/70adc31e150cc80d.png",
        "href": "https://www.amz123.com/noon",
        "guide": "https://www.amz123.com/noon/guide"
      },
      {
        "name": "Trendyol",
        "desc": "土耳其最大的电商平台，主要销售女士产品、男士产品、儿童产品等",
        "logo": "./logos/92a49045c0fafa7f.png",
        "href": "https://www.amz123.com/trendyol",
        "guide": "https://www.amz123.com/trendyol/guide"
      },
      {
        "name": "Daraz",
        "desc": "巴基斯坦最受欢迎的在线购物网站，市场覆盖巴基斯坦、孟加拉、斯里兰卡等",
        "logo": "./logos/5e0902600f3df692.png",
        "href": "https://www.amz123.com/daraz",
        "guide": "https://www.amz123.com/daraz/guide"
      },
      {
        "name": "Jumia",
        "desc": "全球大型交易所上市的非洲科技创业公司，拥有多个线上垂直运营平台",
        "logo": "./logos/3299a96d05013625.png",
        "href": "https://www.amz123.com/jumia",
        "guide": "https://www.amz123.com/jumia/guide"
      },
      {
        "name": "阿里巴巴国际",
        "desc": "向海外买家展示、推广供应商的企业和产品，是出口企业拓展国际贸易的首选网络平台之一",
        "logo": "./logos/45f4e4c27d7ea483.png",
        "href": "https://www.amz123.com/alibaba",
        "guide": "https://www.amz123.com/alibaba/guide"
      },
      {
        "name": "速卖通",
        "desc": "阿里巴巴旗下面向国际市场打造的跨境电商平台",
        "logo": "./logos/e5461d9456803923.png",
        "href": "https://www.amz123.com/aliexpress",
        "guide": "https://www.amz123.com/aliexpress/guide"
      }
    ]
  },
  {
    "title": "北美",
    "sites": [
      {
        "name": "亚马逊",
        "desc": "美国最大的电商平台，最早开始运营电商业务的公司之一",
        "logo": "./logos/838a5f0280af867c.jpg",
        "href": "https://www.amz123.com/amazon",
        "guide": "https://www.amz123.com/amazon/guide"
      },
      {
        "name": "Temu",
        "desc": "拼多多旗下的全品类跨境电商平台，平台首站面向北美市场",
        "logo": "./logos/2bae2512b9b3c83e.png",
        "href": "https://www.amz123.com/temu",
        "guide": "https://www.amz123.com/temu/guide"
      },
      {
        "name": "SHEIN",
        "desc": "跨境B2C快时尚电商平台，业务范围包括服装、家居产品、童装、女装等",
        "logo": "./logos/27574f9445ea830f.png",
        "href": "https://www.amz123.com/shein",
        "guide": "https://www.amz123.com/shein/guide"
      },
      {
        "name": "eBay",
        "desc": "美国线上拍卖及购物网站，可让全球民众在网上买卖物品",
        "logo": "./logos/aa3e95cc7e918513.png",
        "href": "https://www.amz123.com/ebay",
        "guide": "https://www.amz123.com/ebay/guide"
      },
      {
        "name": "沃尔玛",
        "desc": "美国的世界性连锁企业，致力于为卖家提供专业的运营服务",
        "logo": "./logos/d6bd1c7609ed4a75.png",
        "href": "https://www.amz123.com/walmart",
        "guide": "https://www.amz123.com/walmart/guide"
      },
      {
        "name": "YAMI",
        "desc": "北美领先的亚洲商品购物平台，海外华人购物首选",
        "logo": "./logos/b1eeede09f129495.webp",
        "href": "https://www.amz123.com/yamibuy",
        "guide": "https://www.amz123.com/yamibuy/guide"
      },
      {
        "name": "速卖通",
        "desc": "阿里巴巴旗下面向国际市场打造的跨境电商平台",
        "logo": "./logos/e5461d9456803923.png",
        "href": "https://www.amz123.com/aliexpress",
        "guide": "https://www.amz123.com/aliexpress/guide"
      },
      {
        "name": "Etsy",
        "desc": "专注手工艺品销售的美国在线C2C电商平台，销售的产品包括艺术品、服装、珠宝和其他装饰物品以及工艺品",
        "logo": "./logos/5d554e222f41e37c.png",
        "href": "https://www.amz123.com/etsy",
        "guide": "https://www.amz123.com/etsy/guide"
      },
      {
        "name": "Wayfair",
        "desc": "北美和欧洲最大的家居品类电商平台之一，主要销售家具和家居用品",
        "logo": "./logos/8ebedefa32b3979c.webp",
        "href": "https://www.amz123.com/wayfair",
        "guide": "https://www.amz123.com/wayfair/guide"
      },
      {
        "name": "Bed Bath &amp; Beyond",
        "desc": "美国最大的出售高品质床上用品和家庭用品的连锁商店",
        "logo": "./logos/955f2a1c60e5f4a8.png",
        "href": "https://www.amz123.com/bedbathandbeyond",
        "guide": "https://www.amz123.com/bedbathandbeyond/guide"
      },
      {
        "name": "Home Depot",
        "desc": "美国第二大零售商，是全球领先的家居建材用品零售",
        "logo": "./logos/fc21cde9fede1d4c.png",
        "href": "https://www.amz123.com/homedepot",
        "guide": "https://www.amz123.com/homedepot/guide"
      },
      {
        "name": "Lowe's",
        "desc": "全球最大的家居装饰零售商之一，销售近40,000种商品",
        "logo": "./logos/eb64f543abc16cb8.png",
        "href": "https://www.amz123.com/lowes",
        "guide": "https://www.amz123.com/lowes/guide"
      },
      {
        "name": "Wish",
        "desc": "美国跨境零售电商平台，通过愿望清单的模式为用户提供产品",
        "logo": "./logos/fee5b5a899c3a3d3.png",
        "href": "https://www.amz123.com/wish",
        "guide": "https://www.amz123.com/wish/guide"
      },
      {
        "name": "Newegg",
        "desc": "北美第二大3C电商平台，产品包括计算机硬件和消费电子产品",
        "logo": "./logos/8433fcf05e4d9fda.png",
        "href": "https://www.amz123.com/newegg",
        "guide": "https://www.amz123.com/newegg/guide"
      },
      {
        "name": "Mercari煤炉",
        "desc": "知名的二手商品交易平台，曾在美国应用下载榜单中排在第三名",
        "logo": "./logos/055b4415a8166da2.png",
        "href": "https://www.amz123.com/mercari",
        "guide": "https://www.amz123.com/mercari/guide"
      },
      {
        "name": "Poshmark",
        "desc": "二手交易平台，为女性、男性、儿童、宠物、家庭等提供全新或二手的商品",
        "logo": "./logos/28b40a5cfdea76b7.png",
        "href": "https://www.amz123.com/poshmark",
        "guide": "https://www.amz123.com/poshmark/guide"
      }
    ]
  },
  {
    "title": "欧洲",
    "sites": [
      {
        "name": "eMAG",
        "desc": "东南欧排名第一的本土跨境电商平台，月活1.2亿，900万活跃用户",
        "logo": "./logos/5366487f1146ed39.png",
        "href": "https://www.amz123.com/emag",
        "guide": "https://www.amz123.com/emag/guide"
      },
      {
        "name": "Allegro",
        "desc": "创建于波兰，是中东欧最大的电商平台，已有上万名中国商家入驻Allegro",
        "logo": "./logos/abe46691d14a1265.png",
        "href": "https://www.amz123.com/allegro",
        "guide": "https://www.amz123.com/allegro/guide"
      },
      {
        "name": "Cdiscount",
        "desc": "法国最大的本地电商平台，经营的品类类目达21种",
        "logo": "./logos/6afe078edd670d69.webp",
        "href": "https://www.amz123.com/cdiscount",
        "guide": "https://www.amz123.com/cdiscount/guide"
      },
      {
        "name": "SHEIN",
        "desc": "跨境B2C快时尚电商平台，业务范围包括服装、家居产品、童装、女装等",
        "logo": "./logos/4c848def2631756d.png",
        "href": "https://www.amz123.com/shein",
        "guide": "https://www.amz123.com/shein/guide"
      },
      {
        "name": "Kaufland",
        "desc": "德国Schwarz集团旗下低成本零售连锁商，是欧洲第5大食品零售商",
        "logo": "./logos/397fef482646e1ed.jpg",
        "href": "https://www.amz123.com/kaufland",
        "guide": "https://www.amz123.com/kaufland/guide"
      },
      {
        "name": "法国乐天",
        "desc": "法国目前影响力排行第三的网购平台，主营文化类别、数码3C，家用品、时尚等",
        "logo": "./logos/fa5b96d739bcac8d.png",
        "href": "https://www.amz123.com/rakutenfr",
        "guide": "https://www.amz123.com/rakutenfr/guide"
      },
      {
        "name": "Ozon",
        "desc": "俄罗斯本土的B2C电商平台，多品类电商平台",
        "logo": "./logos/b278940468743587.png",
        "href": "https://www.amz123.com/ozonglobal",
        "guide": "https://www.amz123.com/ozonglobal/guide"
      },
      {
        "name": "Wildberries",
        "desc": "俄语国家最大的电商平台，开拓俄语市场的最佳选择！",
        "logo": "./logos/4691503ab6718491.webp",
        "href": "https://www.amz123.com/wildberries",
        "guide": "https://www.amz123.com/wildberries/guide"
      },
      {
        "name": "Darty",
        "desc": "法国电子电器平台，主营手机、电视、多媒体、音响、家用电器等等",
        "logo": "./logos/16b2fcd4cf4eb216.png",
        "href": "https://www.amz123.com/darty",
        "guide": "https://www.amz123.com/darty/guide"
      },
      {
        "name": "Worten",
        "desc": "葡萄牙著名的专业售卖电子产品的电商平台,热销品主要有手机，3C消费类等",
        "logo": "./logos/8615b06b960f92d2.png",
        "href": "https://www.amz123.com/worten",
        "guide": "https://www.amz123.com/worten/guide"
      },
      {
        "name": "Bol",
        "desc": "荷兰最大的电商网站，也是比利时、卢森堡最大的电商平台及在线市场",
        "logo": "./logos/506bd74b968095a2.png",
        "href": "https://www.amz123.com/bolcom",
        "guide": "https://www.amz123.com/bolcom/guide"
      },
      {
        "name": "ePRICE",
        "desc": "意大利领先的电商平台，主要提供电子科技类产品、家用电器、等用品",
        "logo": "./logos/0e05629836945a59.png",
        "href": "https://www.amz123.com/eprice",
        "guide": "https://www.amz123.com/eprice/guide"
      },
      {
        "name": "Fruugo",
        "desc": "英国最大的支持全球销售的本土电商平台，遍布 46 个国家和地区",
        "logo": "./logos/7984c363f5e88482.png",
        "href": "https://www.amz123.com/fruugo",
        "guide": "https://www.amz123.com/fruugo/guide"
      },
      {
        "name": "ManoMano",
        "desc": "欧洲领先DIY、家居装饰和园艺产品在线交易平台",
        "logo": "./logos/f033dbf084754b94.png",
        "href": "https://www.amz123.com/manomano",
        "guide": "https://www.amz123.com/manomano/guide"
      },
      {
        "name": "Zalando",
        "desc": "德国在线零售商，主营儿童服装，鞋子，配件，美容产品，运动用品等",
        "logo": "./logos/560b5448e6d584df.png",
        "href": "https://www.amz123.com/zalando",
        "guide": "https://www.amz123.com/zalando/guide"
      },
      {
        "name": "OnBuy",
        "desc": "英国电商平台，是一个中间平台，没有自营模式，涵盖多个行业",
        "logo": "./logos/e40e445f3daed11e.png",
        "href": "https://www.amz123.com/onbuy",
        "guide": "https://www.amz123.com/onbuy/guide"
      },
      {
        "name": "Miravia",
        "desc": "阿里巴巴旗下，西班牙本土市场的品质和时尚综合型电商平台",
        "logo": "./logos/4740518c743c6dff.png",
        "href": "https://www.amz123.com/miravia",
        "guide": "https://www.amz123.com/miravia/guide"
      },
      {
        "name": "Voghion",
        "desc": "主要面对欧美市场，产品与服务覆盖欧洲多个国家和地区",
        "logo": "./logos/738b02698c2e5a37.png",
        "href": "https://www.amz123.com/voghion",
        "guide": "https://www.amz123.com/voghion/guide"
      },
      {
        "name": "Joom",
        "desc": "移动端购物平台，目标市场针对欧洲以及俄罗斯等独联体国家",
        "logo": "./logos/b041df3ac79ce4a4.png",
        "href": "https://www.amz123.com/joom",
        "guide": "https://www.amz123.com/joom/guide"
      },
      {
        "name": "FNAC",
        "desc": "法国最有名气的零售商之一，是欧洲增长最快的平台",
        "logo": "./logos/43611a59dec826b9.png",
        "href": "https://www.amz123.com/fnactickets",
        "guide": "https://www.amz123.com/fnactickets/guide"
      },
      {
        "name": "Vinted",
        "desc": "欧洲知名二手电商平台，平台为用户提供二手商品的买卖或赠与服务",
        "logo": "./logos/b4fe09b7da5abcf0.png",
        "href": "https://www.amz123.com/vinted",
        "guide": "https://www.amz123.com/vinted/guide"
      },
      {
        "name": "Rue du Commerce",
        "desc": "法国知名高科技电商平台，专注于电子产品、家用电器、家居等品类的销售",
        "logo": "./logos/823ae09eedbf8559.jpg",
        "href": "https://www.amz123.com/rueducommerce",
        "guide": "https://www.amz123.com/rueducommerce/guide"
      },
      {
        "name": "Yandex Market",
        "desc": "平台拥有超过18000家商业合作伙伴，是俄罗斯最大的跨界电商平台之一",
        "logo": "./logos/e5aff01ef03f1723.jpg",
        "href": "https://www.amz123.com/yandexmarket",
        "guide": "https://www.amz123.com/yandexmarket/guide"
      },
      {
        "name": "PcComponentes",
        "desc": "西班牙最大的计算机商店，计算机、电子产品拥有最优惠的价格、质量和服务",
        "logo": "./logos/73e961e779afa486.png",
        "href": "https://www.amz123.com/pccomponentes",
        "guide": "https://www.amz123.com/pccomponentes/guide"
      },
      {
        "name": "CDON",
        "desc": "北欧主要电商平台之一，服务瑞典、丹麦等国，拥有超 200 万买家。 销售电子产品、家居用品等多品类，禁售二手、动物等产品",
        "logo": "./logos/edd9a0de4b1f2c78.png",
        "href": "https://www.amz123.com/cdon",
        "guide": "https://www.amz123.com/cdon/guide"
      },
      {
        "name": "PHH GROUP",
        "desc": "波罗的海地区流量TOP1的电商平台，立陶宛、拉脱维亚、爱沙尼亚排名第一。 提供官方对接买家、海外仓、Pigu配送、本地语言翻译等服务",
        "logo": "./logos/6ac09e77aaaceb27.png",
        "href": "https://www.amz123.com/phhgroup",
        "guide": "https://www.amz123.com/phhgroup/guide"
      },
      {
        "name": "Fyndiq",
        "desc": "折扣促销电商平台，以销售划算优质的零售产品为主。商品种类丰富",
        "logo": "./logos/38bb329051fe18a9.png",
        "href": "https://www.amz123.com/fyndiq",
        "guide": "https://www.amz123.com/fyndiq/guide"
      },
      {
        "name": "亚马逊欧洲站",
        "desc": "平台用户超过3亿，月访问量超过5亿",
        "logo": "./logos/ac87a5a0f31a2951.jpeg",
        "href": "https://www.amz123.com/amazon",
        "guide": "https://www.amz123.com/amazon/guide"
      },
      {
        "name": "Hainago",
        "desc": "俄罗斯跨境B2B批发电商平台",
        "logo": "./logos/efb3332a3bc839fd.webp",
        "href": "https://www.amz123.com/hainago",
        "guide": "https://www.amz123.com/hainago/guide"
      }
    ]
  },
  {
    "title": "日韩",
    "sites": [
      {
        "name": "Coupang",
        "desc": "韩国Top级电商网站，也是韩国人气最高的团购网站之一",
        "logo": "./logos/6b1ce89110311523.png",
        "href": "https://www.amz123.com/coupang",
        "guide": "https://www.amz123.com/coupang/guide"
      },
      {
        "name": "亚马逊日本站",
        "desc": "日本TOP1电商购物网站，市场份额较大",
        "logo": "./logos/ac87a5a0f31a2951.jpeg",
        "href": "https://www.amz123.com/amazon",
        "guide": "https://www.amz123.com/amazon/guide"
      },
      {
        "name": "TikTok 日本",
        "desc": "日本站拥有购物视频、直播、橱窗、商城等功能，能够为用户提供丰富的购物体验",
        "logo": "./logos/d1f6d82eacfc8023.webp",
        "href": "https://www.amz123.com/tiktokjp",
        "guide": "https://www.amz123.com/tiktokjp/guide"
      },
      {
        "name": "日本乐天",
        "desc": "日本数一数二的电商平台，全球最大的电商平台之一",
        "logo": "./logos/4670d6c42baf459a.png",
        "href": "https://www.amz123.com/rakutenjapan",
        "guide": "https://www.amz123.com/rakutenjapan/guide"
      },
      {
        "name": "TEMU",
        "desc": "全品类全球跨境电商平台",
        "logo": "./logos/7061bdac8f79af71.png",
        "href": "https://www.amz123.com/temujp",
        "guide": "https://www.amz123.com/temujp/guide"
      },
      {
        "name": "日本雅虎购物",
        "desc": "日本国内使用人数最多的拍卖网站，网站内有多达5,000万件以上的商品可供选择",
        "logo": "./logos/05fec0dc80b1379e.png",
        "href": "https://www.amz123.com/shoppingyahoo",
        "guide": "https://www.amz123.com/shoppingyahoo/guide"
      },
      {
        "name": "Gmarket",
        "desc": "韩国排名第一的在线购物网站，主要销售书籍、MP3、化妆品、电脑、家电、衣服等",
        "logo": "./logos/2cdb6204ebbaa275.png",
        "href": "https://www.amz123.com/gmarket",
        "guide": "https://www.amz123.com/gmarket/guide"
      },
      {
        "name": "日本趣天",
        "desc": "日本趣天是面向日本市场的网上商城，由eBay Japan联合公司运营",
        "logo": "./logos/cccd775bcf1d5180.webp",
        "href": "https://www.amz123.com/qoo10jp",
        "guide": "https://www.amz123.com/qoo10jp/guide"
      },
      {
        "name": "Auction",
        "desc": "韩国在线电商拍卖网站，目前已是韩国综合型主流电商平台之一",
        "logo": "./logos/6b5f61970750feed.png",
        "href": "https://www.amz123.com/auction",
        "guide": "https://www.amz123.com/auction/guide"
      },
      {
        "name": "Mercari日本煤炉",
        "desc": "日文名为“メルカリ”，目前已经发展为日本知名二手商品交易平台",
        "logo": "./logos/fb0c2129ee5d6542.png",
        "href": "https://www.amz123.com/mercari",
        "guide": "https://www.amz123.com/mercari/guide"
      },
      {
        "name": "Wowma",
        "desc": "日本的电商百货商店，也是比较受当地年轻人关注的一个电商平台之一",
        "logo": "./logos/139a5720bb661e61.png",
        "href": "https://www.amz123.com/wowma",
        "guide": "https://www.amz123.com/wowma/guide"
      },
      {
        "name": "11Street",
        "desc": "韩国SK旗下知名在线购物网站，也是韩国主流电商平台之一",
        "logo": "./logos/ef6122e3adc81f4d.png",
        "href": "https://www.amz123.com/11st",
        "guide": "https://www.amz123.com/11st/guide"
      }
    ]
  },
  {
    "title": "东南亚",
    "sites": [
      {
        "name": "Lazada",
        "desc": "阿里巴巴东南亚旗舰电商平台",
        "logo": "./logos/6669ddb4a7010e36.jpg",
        "href": "https://www.amz123.com/lazada",
        "guide": "https://www.amz123.com/lazada/guide"
      },
      {
        "name": "Shopee",
        "desc": "东南亚最大的电商平台之一，覆盖新加坡、马来西亚、菲律宾、中国台湾、印度尼西亚、泰国等",
        "logo": "./logos/d62cfd16bf8b2e17.png",
        "href": "https://www.amz123.com/shopee",
        "guide": "https://www.amz123.com/shopee/guide"
      },
      {
        "name": "Tokopedia",
        "desc": "印度尼西亚最大的电商平台，也是流量最高的C2C购物网站",
        "logo": "./logos/ba853029e362f4e4.png",
        "href": "https://www.amz123.com/tokopedia",
        "guide": "https://www.amz123.com/tokopedia/guide"
      },
      {
        "name": "Tiki",
        "desc": "综合类B2C电商网站，也是东南亚第六大电商平台",
        "logo": "./logos/d467ecdd9a056015.png",
        "href": "https://www.amz123.com/tiki",
        "guide": "https://www.amz123.com/tiki/guide"
      },
      {
        "name": "L192",
        "desc": "柬埔寨本地最大的在线时尚生活购物平台，为柬埔寨及东南亚周边国家提供多品类的优质商品",
        "logo": "./logos/8506d036e20747f8.png",
        "href": "https://www.amz123.com/cifnews",
        "guide": "https://www.amz123.com/cifnews/guide"
      },
      {
        "name": "Thisshop",
        "desc": "泰国首家主打消费金融一体的B2C电商平台",
        "logo": "./logos/53120a2b34bf0c2c.png",
        "href": "https://www.amz123.com/thisshop",
        "guide": "https://www.amz123.com/thisshop/guide"
      }
    ]
  },
  {
    "title": "拉美",
    "sites": [
      {
        "name": "美客多",
        "desc": "拉美领先的电商与金融科技平台，致力于帮助中国品牌开拓拉美市场",
        "logo": "./logos/e71f3279224497af.webp",
        "href": "https://www.amz123.com/mercadolibre",
        "guide": "https://www.amz123.com/mercadolibre/guide"
      },
      {
        "name": "TikTok 拉美",
        "desc": "巴西和墨西哥作为拉美最大经济体，电商渗透率高，年轻用户占比大，为TikTok Shop提供了广阔空间",
        "logo": "./logos/d1f6d82eacfc8023.webp",
        "href": "https://www.amz123.com/tiktoklm",
        "guide": "https://www.amz123.com/tiktoklm/guide"
      },
      {
        "name": "Falabella",
        "desc": "拉美地区领先的电商平台，是时尚和电子产品方面的领头羊",
        "logo": "./logos/5a382235e852245c.png",
        "href": "https://www.amz123.com/falabella",
        "guide": "https://www.amz123.com/falabella/guide"
      },
      {
        "name": "Cross Commerce Store (CCS) 跨贸商店",
        "desc": "CCS 赋能中国卖家出海拉美千亿蓝海市场",
        "logo": "./logos/d31bbfbd231f8f10.png",
        "href": "https://www.amz123.com/ccs",
        "guide": "https://www.amz123.com/ccs/guide"
      },
      {
        "name": "Americanas",
        "desc": "拉丁美洲电子商务行业的领导者，同时也是实体零售店",
        "logo": "./logos/3f0c71294b046b26.png",
        "href": "https://www.amz123.com/americanas",
        "guide": "https://www.amz123.com/americanas/guide"
      },
      {
        "name": "Shopee巴西站",
        "desc": "主营3C品类、美妆美容、家居、服装、户外运动等",
        "logo": "./logos/d62cfd16bf8b2e17.png",
        "href": "https://www.amz123.com/shopee",
        "guide": "https://www.amz123.com/shopee/guide"
      },
      {
        "name": "亚马逊巴西站",
        "desc": "主营书籍、电子产品、家具、宠物店、电脑等商品",
        "logo": "./logos/838a5f0280af867c.jpg",
        "href": "https://www.amz123.com/amazon",
        "guide": "https://www.amz123.com/amazon/guide"
      },
      {
        "name": "NocNoc",
        "desc": "半代运营的跨境电商平台，可以将产品发布到15+拉美电商平台进行销售",
        "logo": "./logos/c27dbe8df96499a7.png",
        "href": "https://www.amz123.com/nocnoc",
        "guide": "https://www.amz123.com/nocnoc/guide"
      },
      {
        "name": "JoomPro",
        "desc": "专注于拉美市场的创新型 B2B 跨境电商平台，为中国卖家提供可靠高效的一站式出海解决方案，助力企业快速扩展和发掘拉美市场B2B新机会",
        "logo": "./logos/257d6422eabe5486.png",
        "href": "https://www.amz123.com/joompro",
        "guide": "https://www.amz123.com/joompro/guide"
      }
    ]
  },
  {
    "title": "澳洲",
    "sites": [
      {
        "name": "TradeMe",
        "desc": "新西兰最大的电商平台，热销品类有3C电子、家具、玩具、服装、汽车、摩托车、船、配件",
        "logo": "./logos/bec7d42938f78be4.png",
        "href": "https://www.amz123.com/trademe",
        "guide": "https://www.amz123.com/trademe/guide"
      },
      {
        "name": "亚马逊澳洲站",
        "desc": "亚马逊面向澳大利亚消费者推出的平台，当地排名第二的电商网站",
        "logo": "./logos/838a5f0280af867c.jpg",
        "href": "https://www.amz123.com/amazon",
        "guide": "https://www.amz123.com/amazon/guide"
      },
      {
        "name": "eBay",
        "desc": "澳大利亚最受欢迎的网站之一，可让全球民众在网上买卖物品",
        "logo": "./logos/03cd4d69ac1b7a37.png",
        "href": "https://www.amz123.com/ebay",
        "guide": "https://www.amz123.com/ebay/guide"
      },
      {
        "name": "Kmart.co.nz",
        "desc": "新西兰的低价连锁超市，提供广泛的产品与服务，包括日常杂货、家居用品、服装、电器等",
        "logo": "./logos/df4d4893d661dc1f.png",
        "href": "https://www.amz123.com/kmart",
        "guide": "https://www.amz123.com/kmart/guide"
      },
      {
        "name": "Kmart.com.au",
        "desc": "澳大利亚最大的超市连锁之一，提供广泛的产品与服务",
        "logo": "./logos/df4d4893d661dc1f.png",
        "href": "https://www.amz123.com/kmart",
        "guide": "https://www.amz123.com/kmart/guide"
      },
      {
        "name": "BIG W",
        "desc": "澳洲的一个零售百货店，涉及玩具、食品、服装、电子产品类等",
        "logo": "./logos/623c485ffbfa5066.png",
        "href": "https://www.amz123.com/bigw",
        "guide": "https://www.amz123.com/bigw/guide"
      },
      {
        "name": "Target",
        "desc": "美国第二大零售百货集团，也是全球最大的折扣零售商之一",
        "logo": "./logos/db1b723b9d1f2070.png",
        "href": "https://www.amz123.com/target",
        "guide": "https://www.amz123.com/target/guide"
      },
      {
        "name": "MyDeal",
        "desc": "集家居、时尚及电子产品等为一体的在线零售市场",
        "logo": "./logos/f6f1aaf84a80efd3.png",
        "href": "https://www.amz123.com/mydeal",
        "guide": "https://www.amz123.com/mydeal/guide"
      },
      {
        "name": "Harvey Norman",
        "desc": "主要经营家居用品、电子产品、计算机及办公设备、小型家电、家具以及床上用品等多元化产品线",
        "logo": "./logos/6471dc537b22f785.jpg",
        "href": "https://www.amz123.com/harveynorman",
        "guide": "https://www.amz123.com/harveynorman/guide"
      },
      {
        "name": "The  good  guys",
        "desc": "连锁家用电器零售商，主要销售相机和冰箱等电子产品",
        "logo": "./logos/478714f6c5fa65f6.png",
        "href": "https://www.amz123.com/thegoodguys",
        "guide": "https://www.amz123.com/thegoodguys/guide"
      },
      {
        "name": "Myer",
        "desc": "澳大利亚最具代表性和历史底蕴的百货公司之一",
        "logo": "./logos/30fabd1ef854f2ef.png",
        "href": "https://www.amz123.com/myer",
        "guide": "https://www.amz123.com/myer/guide"
      },
      {
        "name": "Kogan",
        "desc": "折扣数码购物网站，提供消费电子产品、家用电器、家居用品、玩具等",
        "logo": "./logos/ce599b8f7825198d.png",
        "href": "https://www.amz123.com/kogan",
        "guide": "https://www.amz123.com/kogan/guide"
      },
      {
        "name": "Supercheap Auto",
        "desc": "澳大利亚汽车零配件和工具零售商，提供各种汽车零配件、工具和设备等",
        "logo": "./logos/6dfaeba562b7a237.png",
        "href": "https://www.amz123.com/supercheapauto",
        "guide": "https://www.amz123.com/supercheapauto/guide"
      },
      {
        "name": "Temple &amp; Webster",
        "desc": "美国的生活方式品牌，专注于提供现代家具和家居装饰品",
        "logo": "./logos/758451453296813c.webp",
        "href": "https://www.amz123.com/templeandwebster",
        "guide": "https://www.amz123.com/templeandwebster/guide"
      },
      {
        "name": "JB HI-FI",
        "desc": "澳大利亚知名的家用电器零售商，主要销售手机、电脑、咖啡机等多种电子产品",
        "logo": "./logos/35920b330515cf8e.png",
        "href": "https://www.amz123.com/jbhifi",
        "guide": "https://www.amz123.com/jbhifi/guide"
      },
      {
        "name": "Gumtree",
        "desc": "英国最大的分类信息网站，同时覆盖了多个国家如波兰、美国、澳大利亚等",
        "logo": "./logos/0770afd4b310cd94.png",
        "href": "https://www.amz123.com/gumtree",
        "guide": "https://www.amz123.com/gumtree/guide"
      },
      {
        "name": "The Warehouse",
        "desc": "新西兰大型仓储式超市，提供园艺工具、玩具、厨房用品等商品",
        "logo": "./logos/3b9a74660ea9045d.png",
        "href": "https://www.amz123.com/thewarehouse",
        "guide": "https://www.amz123.com/thewarehouse/guide"
      },
      {
        "name": "UMART",
        "desc": "UMART 是澳大利亚一家领先的电脑硬件、电子产品及周边设备的零售商。它以其极具竞争力的价格和高效的“线上订购，线下提货”商业模式而闻名，在澳洲消费者中享有很高的声誉。",
        "logo": "./logos/2c573b0efb749ea3.webp",
        "href": "https://www.amz123.com/umart",
        "guide": "https://www.amz123.com/umart/guide"
      }
    ]
  },
  {
    "title": "中东",
    "sites": [
      {
        "name": "Noon",
        "desc": "中东最大的电商平台之一，产品类别包括美容、时尚、电子产品等",
        "logo": "./logos/70adc31e150cc80d.png",
        "href": "https://www.amz123.com/noon",
        "guide": "https://www.amz123.com/noon/guide"
      },
      {
        "name": "Fordeal",
        "desc": "中国面向海外C端消费者的电商一站式购物平台",
        "logo": "./logos/d25d66e2cfa64b4c.png",
        "href": "https://www.amz123.com/fordeal",
        "guide": "https://www.amz123.com/fordeal/guide"
      },
      {
        "name": "亚马逊沙特站",
        "desc": "当地最受欢迎的购物网站，目前为止共有34个类别",
        "logo": "./logos/ac87a5a0f31a2951.jpeg",
        "href": "https://www.amz123.com/amazon",
        "guide": "https://www.amz123.com/amazon/guide"
      },
      {
        "name": "亚马逊阿联酋站",
        "desc": "中东最大且最成熟的电商市场之一，市场潜力巨大",
        "logo": "./logos/ac87a5a0f31a2951.jpeg",
        "href": "https://www.amz123.com/amazon",
        "guide": "https://www.amz123.com/amazon/guide"
      },
      {
        "name": "Trendyol",
        "desc": "土耳其最大的电商平台，主要销售女士产品、男士产品、儿童产品等",
        "logo": "./logos/92a49045c0fafa7f.png",
        "href": "https://www.amz123.com/trendyol",
        "guide": "https://www.amz123.com/trendyol/guide"
      },
      {
        "name": "Hepsiburada",
        "desc": "土耳其的著名电商平台，平台拥有近30个产品类别",
        "logo": "./logos/4d417a6d0d9bc1be.png",
        "href": "https://www.amz123.com/hepsiburada",
        "guide": "https://www.amz123.com/hepsiburada/guide"
      },
      {
        "name": "GittiGidiyor",
        "desc": "土耳其最早的一家电商公司，目前是土耳其第三大在线平台",
        "logo": "./logos/f8a474fdb8813461.png",
        "href": "https://www.amz123.com/gittigidiyor",
        "guide": "https://www.amz123.com/gittigidiyor/guide"
      },
      {
        "name": "N11",
        "desc": "有韩资背景(与韩国SK集团合作成立)的土耳其新兴电商平台",
        "logo": "./logos/6552a353baf2fddb.png",
        "href": "https://www.amz123.com/n11",
        "guide": "https://www.amz123.com/n11/guide"
      },
      {
        "name": "亚马逊土耳其站",
        "desc": "2018年9月20日开通，属于新兴市场，有极大的增长空间",
        "logo": "./logos/ac87a5a0f31a2951.jpeg",
        "href": "https://www.amz123.com/amazon",
        "guide": "https://www.amz123.com/amazon/guide"
      }
    ]
  },
  {
    "title": "非洲",
    "sites": [
      {
        "name": "Jumia",
        "desc": "全球大型交易所上市的非洲科技创业公司，拥有多个线上垂直运营平台",
        "logo": "./logos/3299a96d05013625.png",
        "href": "https://www.amz123.com/jumia",
        "guide": "https://www.amz123.com/jumia/guide"
      },
      {
        "name": "KiKUU",
        "desc": "非洲领先的跨境电商平台，整合线上支付渠道，自建物流派送体系",
        "logo": "./logos/7463382332db3e00.png",
        "href": "https://www.amz123.com/kikuu",
        "guide": "https://www.amz123.com/kikuu/guide"
      },
      {
        "name": "KiliMall",
        "desc": "肯尼亚领先的在线购物网站，拥有非洲本土的品牌营销、仓储物流、售后客服体系",
        "logo": "./logos/72434bf444ca1df7.png",
        "href": "https://www.amz123.com/kilimall",
        "guide": "https://www.amz123.com/kilimall/guide"
      },
      {
        "name": "Tospino B2B",
        "desc": "面向非洲市场的领先本地化电商平台，致力于帮助国内中小企业拓展海外市场",
        "logo": "./logos/a260648f819e9c6f.png",
        "href": "https://www.amz123.com/tospino",
        "guide": "https://www.amz123.com/tospino/guide"
      },
      {
        "name": "TospinoMall",
        "desc": "面向非洲市场的领先本地化电商平台，致力于帮助国内中小企业拓展海外市场",
        "logo": "./logos/87dd9ac8546f8d10.png",
        "href": "https://www.amz123.com/tospino",
        "guide": "https://www.amz123.com/tospino/guide"
      },
      {
        "name": "Takealot",
        "desc": "南非领先的在线零售商，有自营和第三方两种业务模式",
        "logo": "./logos/ca13c10a60c1e00a.png",
        "href": "https://www.amz123.com/takealot",
        "guide": "https://www.amz123.com/takealot/guide"
      },
      {
        "name": "亚马逊埃及站",
        "desc": "亚马逊全球第20个站点，目前亚马逊在埃及拥有广泛的履行网络",
        "logo": "./logos/ac87a5a0f31a2951.jpeg",
        "href": "https://www.amz123.com/amazon",
        "guide": "https://www.amz123.com/amazon/guide"
      }
    ]
  },
  {
    "title": "南亚",
    "sites": [
      {
        "name": "Daraz",
        "desc": "巴基斯坦最受欢迎的在线购物网站，市场覆盖巴基斯坦、孟加拉、斯里兰卡等",
        "logo": "./logos/5e0902600f3df692.png",
        "href": "https://www.amz123.com/daraz",
        "guide": "https://www.amz123.com/daraz/guide"
      },
      {
        "name": "亚马逊印度站",
        "desc": "常年位居印度电商网站流量前列，为客户提供数百万种全新、翻新及二手商品",
        "logo": "./logos/ac87a5a0f31a2951.jpeg",
        "href": "https://www.amz123.com/amazon",
        "guide": "https://www.amz123.com/amazon/guide"
      },
      {
        "name": "Flipkart",
        "desc": "印度本土知名电商公司，主营书籍、消费电子、服饰、时尚等",
        "logo": "./logos/7629bd01bc968491.png",
        "href": "https://www.amz123.com/flipkart",
        "guide": "https://www.amz123.com/flipkart/guide"
      },
      {
        "name": "Myntra",
        "desc": "专注于线上的印度电商公司，目前已在时尚电商领域的成为市场领导者",
        "logo": "./logos/42768148cebad9e6.png",
        "href": "https://www.amz123.com/myntra",
        "guide": "https://www.amz123.com/myntra/guide"
      },
      {
        "name": "Meesho",
        "desc": "印度的社交电商平台，注重本土化运营",
        "logo": "./logos/91e2516135b3e041.png",
        "href": "https://www.amz123.com/meesho",
        "guide": "https://www.amz123.com/meesho/guide"
      },
      {
        "name": "Snapdeal",
        "desc": "印度领先的纯价值电子商务平台，是印度四大在线生活方式购物目的地之一",
        "logo": "./logos/76dfbccc0b5b1241.png",
        "href": "https://www.amz123.com/snapdeal",
        "guide": "https://www.amz123.com/snapdeal/guide"
      }
    ]
  },
  {
    "title": "中亚",
    "sites": [
      {
        "name": "Kaspi",
        "desc": "哈萨克斯坦最大的电子商务平台，主营电子产品、服装、家居用品等",
        "logo": "./logos/fcf0bac1af225d0f.png",
        "href": "https://www.amz123.com/kaspi",
        "guide": "https://www.amz123.com/kaspi/guide"
      }
    ]
  },
  {
    "title": "B2B",
    "sites": [
      {
        "name": "阿里巴巴国际",
        "desc": "向海外买家展示、推广供应商的企业和产品，是出口企业拓展国际贸易的首选网络平台之一",
        "logo": "./logos/45f4e4c27d7ea483.png",
        "href": "https://www.amz123.com/alibaba",
        "guide": "https://www.amz123.com/alibaba/guide"
      },
      {
        "name": "敦煌网",
        "desc": "美国领先的全球中小零售商一站式贸易和服务平台",
        "logo": "./logos/47a9a6d8bcae3da6.png",
        "href": "https://www.amz123.com/dhw",
        "guide": "https://www.amz123.com/dhw/guide"
      },
      {
        "name": "亚马逊企业购",
        "desc": "新型一站式跨境电商 DTB模式站点，相当于亚马逊平台中的B2B业务",
        "logo": "./logos/3d3a08cdcf7897ec.png",
        "href": "https://www.amz123.com/amazonbusiness",
        "guide": "https://www.amz123.com/amazonbusiness/guide"
      }
    ]
  }
]
