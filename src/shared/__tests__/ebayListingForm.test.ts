import { describe, expect, it } from 'vitest'
import type { EbayLocalProductUpdateInput, EbayProductDetails } from '../contracts'
import { mergeEbayLocalDetailsEdit } from '../ebayListingForm'

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
