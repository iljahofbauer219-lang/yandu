import { describe, expect, it } from 'vitest'
import type { EbayCategorySpecificRequirement, EbayLocalProductUpdateInput, EbayProductDetails } from '../contracts'
import { EBAY_HARD_REQUIRED_FIELDS, extractPolicyIdFromLabel, formatFormGaps, formValuesFromInput, mergeEbayLocalDetailsEdit, normaliseAspectName, requiredFormGaps } from '../ebayListingForm'

const requirement=(name:string,required:boolean,value=''):EbayCategorySpecificRequirement=>({name,required,value,options:[],source:'SELLER_HUB'})

const previous:EbayProductDetails={
  url:'https://www.ebay.com/itm/123',
  itemSpecifics:[{name:'Brand',value:'OEM',source:'SOURCE_PAGE',confidence:'HIGH',needsConfirmation:false}],
  condition:'New',
  imageUrls:['https://img.example/a.jpg'],
  videoUrl:'https://img.example/v.mp4',
  title:'Old Title',
  subtitle:'sub',
  descriptionText:'old text',
  descriptionHtml:'<p>old</p>',
  price:'9.90',
  currency:'USD',
  shippingPolicy:'云仓包邮',
  returnPolicy:'14天大健云仓退货',
  paymentPolicy:'eBay Managed Payments',
  sellerNotes:'notes',
  listingFormat:'FIXED_PRICE',
  bestOfferEnabled:false,
  quantity:'12',
  itemLocation:'Guangdong, CN',
  postalCode:'528000'
}

const changes:EbayLocalProductUpdateInput={
  title:'New Title',
  descriptionText:'new text',
  descriptionHtml:'<p>new</p>',
  price:'19.90',
  currency:'USD',
  media:[{id:'m1',mediaType:'IMAGE',sortOrder:0,remoteUrl:'https://img.example/b.jpg',localPath:'/tmp/b.jpg',mimeType:'image/jpeg',width:1200,height:1200,fileSize:100,sha256:'',downloadStatus:'DOWNLOADED'}]
}

describe('mergeEbayLocalDetailsEdit', () => {
  it('只改四项核心资料时，属性、状况、视频、政策、数量、所在地全部保留', () => {
    const merged=mergeEbayLocalDetailsEdit(previous,changes)
    expect(merged.title).toBe('New Title')
    expect(merged.price).toBe('19.90')
    expect(merged.itemSpecifics).toEqual(previous.itemSpecifics)
    expect(merged.condition).toBe('New')
    expect(merged.videoUrl).toBe(previous.videoUrl)
    expect(merged.subtitle).toBe('sub')
    expect(merged.sellerNotes).toBe('notes')
    expect(merged.listingFormat).toBe('FIXED_PRICE')
    expect(merged.bestOfferEnabled).toBe(false)
    expect(merged.quantity).toBe('12')
    expect(merged.itemLocation).toBe('Guangdong, CN')
    expect(merged.postalCode).toBe('528000')
    expect(merged.shippingPolicy).toBe('云仓包邮')
  })

  it('显式提交的属性与状况覆盖旧值，空数组视为清空而不是忽略', () => {
    const merged=mergeEbayLocalDetailsEdit(previous,{...changes,condition:'Used',itemSpecifics:[{name:'Brand',value:'Generic'}]})
    expect(merged.condition).toBe('Used')
    expect(merged.itemSpecifics).toEqual([{name:'Brand',value:'Generic'}])
    expect(mergeEbayLocalDetailsEdit(previous,{...changes,itemSpecifics:[]}).itemSpecifics).toEqual([])
  })

  it('政策选择按 kind 写入对应旧字段，未提交的 kind 保原值', () => {
    const merged=mergeEbayLocalDetailsEdit(previous,{...changes,policyIds:{shipping:'257217501013'}})
    expect(merged.shippingPolicy).toBe('257217501013')
    expect(merged.returnPolicy).toBe('14天大健云仓退货')
    expect(merged.paymentPolicy).toBe('eBay Managed Payments')
  })

  it('图片清单以提交媒体为准，缺 remoteUrl 的行不污染图集', () => {
    const merged=mergeEbayLocalDetailsEdit(previous,{...changes,media:[
      ...changes.media,
      {id:'m2',mediaType:'IMAGE' as const,sortOrder:1,remoteUrl:'',localPath:'/tmp/c.jpg',mimeType:'image/jpeg',width:1200,height:1200,fileSize:100,sha256:'',downloadStatus:'DOWNLOADED' as const}
    ]})
    expect(merged.imageUrls).toEqual(['https://img.example/b.jpg'])
  })

  it('不改动传入的旧对象（纯函数，无引用泄漏）', () => {
    const merged=mergeEbayLocalDetailsEdit(previous,changes)
    merged.itemSpecifics.push({name:'Material',value:'Steel'})
    expect(previous.itemSpecifics).toHaveLength(1)
  })
})

describe('mergeEbayLocalDetailsEdit 边界（修复轮 1）', () => {
  it('SKU 与处理时间：本次没提交就保原值，提交了才覆盖并去掉前后空格', () => {
    const base:EbayProductDetails={...previous,sku:'OLD-SKU',handlingTime:'3'}
    const untouched=mergeEbayLocalDetailsEdit(base,changes)
    expect(untouched.sku).toBe('OLD-SKU')
    expect(untouched.handlingTime).toBe('3')
    const edited=mergeEbayLocalDetailsEdit(base,{...changes,sku:'  NEW-SKU  ',handlingTime:' 5 '})
    expect(edited.sku).toBe('NEW-SKU')
    expect(edited.handlingTime).toBe('5')
  })

  it('媒体行里的视频不进入图片清单，图片清单只留 IMAGE 行', () => {
    const merged=mergeEbayLocalDetailsEdit(previous,{...changes,media:[
      ...changes.media,
      {id:'v1',mediaType:'VIDEO' as const,sortOrder:1,remoteUrl:'https://img.example/v.mp4',localPath:'/tmp/v.mp4',mimeType:'video/mp4',width:0,height:0,fileSize:100,sha256:'',downloadStatus:'DOWNLOADED' as const}
    ]})
    expect(merged.imageUrls).toEqual(['https://img.example/b.jpg'])
    expect(merged.videoUrl).toBe('https://img.example/v.mp4')
  })

  it('政策三项存的是政策 id 数字串，页面读取带进来的空格必须被去掉', () => {
    const merged=mergeEbayLocalDetailsEdit(previous,{...changes,policyIds:{payment:' 123456789012 ',shipping:' 257217501013 ',return:' 987654321099 '}})
    expect(merged.paymentPolicy).toBe('123456789012')
    expect(merged.shippingPolicy).toBe('257217501013')
    expect(merged.returnPolicy).toBe('987654321099')
  })

  it('提交的属性逐条复制，改返回值里的属性值不会回写旧快照', () => {
    const merged=mergeEbayLocalDetailsEdit(previous,{...changes,itemSpecifics:[{name:'Brand',value:'OEM'}]})
    merged.itemSpecifics[0].value='Generic'
    expect(previous.itemSpecifics[0].value).toBe('OEM')
  })
})

describe('EBAY_HARD_REQUIRED_FIELDS', () => {
  it('固化 spec §1.1 的与类目无关硬必填全集，且不含可选字段', () => {
    expect(EBAY_HARD_REQUIRED_FIELDS.filter(item=>item.required).map(item=>item.key).sort()).toEqual(
      ['condition','itemLocation','listingFormat','paymentPolicy','postalCode','quantity','returnPolicy','shippingPolicy']
    )
    expect(EBAY_HARD_REQUIRED_FIELDS.some(item=>item.key==='sku')).toBe(false)
    expect(EBAY_HARD_REQUIRED_FIELDS.some(item=>item.key==='storeCategory')).toBe(false)
    expect(EBAY_HARD_REQUIRED_FIELDS.every(item=>item.options.length===0||item.key==='listingFormat')).toBe(true)
  })
})

describe('requiredFormGaps', () => {
  const filled={quantity:'12',condition:'New',listingFormat:'FIXED_PRICE',paymentPolicy:'257217501013',shippingPolicy:'1851',returnPolicy:'14',itemLocation:'Guangdong, CN',postalCode:'528000'}

  it('全集齐 → 无缺口', () => {
    expect(requiredFormGaps([],filled)).toEqual([])
  })

  it('政策格里是整段页面文字而非政策 id 时按未记录点名，避免伪装成已填', () => {
    const prose='PayPal Preferred Shipping to United States. 3-5 business days. See details'
    const gaps=requiredFormGaps([],{...filled,paymentPolicy:prose,shippingPolicy:' 1851 '})
    expect(gaps).toEqual([{kind:'FIELD',name:'paymentPolicy',label:'付款政策'}])
  })

  it('缺几项点几名，字段缺口排在属性缺口之前', () => {
    const gaps=requiredFormGaps([requirement('Brand',true),requirement('Type',false)],{...filled,condition:'',postalCode:'  '})
    expect(gaps).toEqual([
      {kind:'FIELD',name:'condition',label:'商品状况'},
      {kind:'FIELD',name:'postalCode',label:'所在地邮编'},
      {kind:'ASPECT',name:'Brand',label:'Brand'}
    ])
  })

  it('非必填属性即使空着也不算缺口；必填属性有值也不算', () => {
    expect(requiredFormGaps([requirement('Color',false),requirement('MPN',true,'1K-205')],filled)).toEqual([])
  })

  it('属性名归一后去重，同名必填只报一次', () => {
    const gaps=requiredFormGaps([requirement('Brand',true),requirement('brand *',true)],filled)
    expect(gaps.filter(item=>item.kind==='ASPECT')).toHaveLength(1)
  })

  it('formatFormGaps 输出中文顿号清单，空数组返回空串', () => {
    expect(formatFormGaps([])).toBe('')
    expect(formatFormGaps([{kind:'FIELD',name:'quantity',label:'数量'},{kind:'ASPECT',name:'Brand',label:'Brand'}])).toBe('数量、Brand')
  })

  it('formValuesFromInput 把 policyIds 摊平成三个政策键', () => {
    const values=formValuesFromInput({title:'t',descriptionText:'',descriptionHtml:'',price:'1',currency:'USD',media:[],quantity:'3',condition:'New',policyIds:{shipping:'18510002003'}})
    expect(values.quantity).toBe('3')
    expect(values.shippingPolicy).toBe('18510002003')
    expect(values.paymentPolicy).toBeUndefined()
    expect(requiredFormGaps([],formValuesFromInput({title:'t',descriptionText:'',descriptionHtml:'',price:'1',currency:'USD',media:[],quantity:'3',condition:'New',itemLocation:'CN',postalCode:'528000',listingFormat:'FIXED_PRICE'})).map(item=>item.name)).toEqual(['paymentPolicy','shippingPolicy','returnPolicy'])
  })

  it('Required Parts 与 Parts 是两条不同的必填属性，空值时各报一个缺口', () => {
    const gaps=requiredFormGaps([requirement('Required Parts',true),requirement('Parts',true)],filled)
    expect(gaps.filter(item=>item.kind==='ASPECT')).toEqual([
      {kind:'ASPECT',name:'Required Parts',label:'Required Parts'},
      {kind:'ASPECT',name:'Parts',label:'Parts'}
    ])
  })

  it('建议零售价 与 零售价 不被归一成同一个键，两条空必填各自点名', () => {
    const gaps=requiredFormGaps([requirement('建议零售价',true),requirement('零售价',true)],filled)
    expect(gaps.filter(item=>item.kind==='ASPECT').map(item=>item.label)).toEqual(['建议零售价','零售价'])
  })
})

describe('normaliseAspectName', () => {
  it('剥掉作为后缀的必填标记、星号与冒号', () => {
    expect(normaliseAspectName('Brand *')).toBe('Brand')
    expect(normaliseAspectName('Country required')).toBe('Country')
    expect(normaliseAspectName('品牌（必填）')).toBe('品牌')
    expect(normaliseAspectName('MPN (required)')).toBe('MPN')
    expect(normaliseAspectName('Condition:')).toBe('Condition')
    expect(normaliseAspectName('Material required immediately')).toBe('Material')
    expect(normaliseAspectName('MPN (required per policy)')).toBe('MPN')
    expect(normaliseAspectName('品牌（必填）：')).toBe('品牌')
  })

  it('标记不是后缀时属性名原样保留，不把真属性名削成同名词', () => {
    expect(normaliseAspectName('Required Parts')).toBe('Required Parts')
    expect(normaliseAspectName('建议零售价')).toBe('建议零售价')
  })

  it('多余空白合并，空输入返回空串', () => {
    expect(normaliseAspectName('  Type   of   Item  ')).toBe('Type of Item')
    expect(normaliseAspectName('')).toBe('')
    expect(normaliseAspectName('   ')).toBe('')
  })

  it('归一化幂等：同一标签二次归一不再变化', () => {
    for(const name of ['Brand *','Country required','品牌（必填）','MPN (required)','Condition:','Required Parts','建议零售价：']) {
      expect(normaliseAspectName(normaliseAspectName(name))).toBe(normaliseAspectName(name))
    }
  })
})

describe('extractPolicyIdFromLabel', () => {
  it('解出括号里的数字政策 ID 并剥掉尾括号', () => {
    expect(extractPolicyIdFromLabel('eBay Managed Payments (257217501013)')).toEqual({policyId:'257217501013',label:'eBay Managed Payments'})
  })
  it('解出 listings 计数但不误认成政策 ID', () => {
    expect(extractPolicyIdFromLabel('云仓包邮 (1851 listings)')).toEqual({label:'云仓包邮',listingCount:1851})
  })
  it('既无 ID 也无计数的名字原样返回', () => {
    expect(extractPolicyIdFromLabel('14天大健云仓退货')).toEqual({label:'14天大健云仓退货'})
  })
  it('千分位计数与多余空白一并规整', () => {
    expect(extractPolicyIdFromLabel('  标准运输  (2,050 listings) ')).toEqual({label:'标准运输',listingCount:2050})
  })
  it('空串与纯空白返回空 label，不抛异常', () => {
    expect(extractPolicyIdFromLabel('')).toEqual({label:''})
  })
})
