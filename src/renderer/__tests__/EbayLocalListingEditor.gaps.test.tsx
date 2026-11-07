import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import EbayLocalListingEditor from '../EbayLocalListingEditor'
import type { EbayLocalProduct, EbayLocalProductUpdateInput, EbayStoreBusinessPolicy } from '../../shared/contracts'
import { formValuesFromInput, requiredFormGaps } from '../../shared/ebayListingForm'

const product={id:'lp1',storeId:'s1',listingId:'T1',title:'Bracket',imageUrl:'',imageUrls:[],price:'9.9',currency:'USD',quantity:12,status:'ACTIVE',versionCount:1,updatedAt:'',categoryId:'',categoryName:'',snapshot:{details:{url:'',itemSpecifics:[{name:'Brand',value:'OEM'}],condition:'New',imageUrls:[],quantity:'12',paymentPolicy:'257217501013',shippingPolicy:'18510002003',returnPolicy:'19007008009',itemLocation:'Guangdong, CN',postalCode:'528000',listingFormat:'FIXED_PRICE',descriptionText:'x'},media:[],sourceListing:{} as never,completeness:100,missingFields:[],contentHash:'',capturedAt:'',id:'snap1',localProductId:'lp1',version:1}} as unknown as EbayLocalProduct

const draftOf=(over:Partial<EbayLocalProductUpdateInput>={}):EbayLocalProductUpdateInput=>({
  title:'Bracket',descriptionText:'desc',descriptionHtml:'',price:'9.9',currency:'USD',
  media:[{id:'m1',mediaType:'IMAGE',sortOrder:0,remoteUrl:'https://img/a.jpg',localPath:'/tmp/a.jpg',mimeType:'image/jpeg',width:1200,height:1200,fileSize:1,sha256:'',downloadStatus:'DOWNLOADED'}],
  quantity:'12',condition:'New',listingFormat:'FIXED_PRICE',sku:'',itemLocation:'Guangdong, CN',postalCode:'528000',itemSpecifics:[{name:'Brand',value:'OEM'}],
  ...over
})

const noop=vi.fn()
const props=(draft:EbayLocalProductUpdateInput,over:Partial<ComponentProps<typeof EbayLocalListingEditor>>={}):ComponentProps<typeof EbayLocalListingEditor>=>({
  inline:true,product,draft,saving:false,uploading:false,preparing:false,readingPolicies:false,businessPolicies:[],categories:[],
  onChange:noop,onSave:noop,onClose:noop,onUpload:noop,onPrepare:noop,onSetCategory:noop,onAutoClassify:noop,onReadPolicies:noop,
  gaps:requiredFormGaps([],formValuesFromInput(draft)),...over
})

describe('EbayLocalListingEditor · 05 状况与库存', () => {
  it('渲染 05 区块的四个字段并回填草稿值', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf())}/>)
    expect(html).toContain('05 状况与库存')
    expect(html).toContain('value="12"')
    expect(html).toContain('eBay 商品状况')
    // 05 刊登格式下拉的判别式断言：React19 renderToStaticMarkup 不给 <select> 输出 value，
    // value="FIXED_PRICE" 在未经改动的 04 区块（EbayLocalListingEditor.tsx:247）里也存在，
    // 无法证明 05 下拉。value="AUCTION" 仅 05 select 会渲染，且把它锁在 <select>…</select> 内，
    // 05 select 一旦整段回归即消失，测试必红。
    expect(html).toMatch(/<select><option value="FIXED_PRICE"[^>]*>现在购买<\/option><option value="AUCTION">拍卖<\/option><\/select>/)
    // 门禁不 brick（DOM 级）：05 数量/状况输入恒不带 disabled——即使有 ERROR 也必须可编辑，
    // 否则「保存」被 errors.length>0 禁用后用户无从修复非法值。
    expect(html).toMatch(/<span>数量<\/span><input(?:(?!disabled)[\s\S])*?value="12"\/>/)
    expect(html).toMatch(/<span>eBay 商品状况<\/span><input(?:(?!disabled)[\s\S])*?value="New"\/>/)
  })

  it('数量非正整数时报必须修改', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({quantity:'0'}))}/>)
    expect(html).toContain('数量必须是大于 0 的整数')
    // 该字段自身处于 ERROR（数量非法）时仍不禁用，即「非空但非法」错误自带改值逃生门，不 brick。
    expect(html).toMatch(/<span>数量<\/span><input(?:(?!disabled)[\s\S])*?value="0"\/>/)
  })

  it('属性来源徽标显示中文来源与「待确认」', () => {
    const draft=draftOf({itemSpecifics:[{name:'Brand',value:'OEM',source:'AI',confidence:'MEDIUM',needsConfirmation:true}]})
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draft)}/>)
    expect(html).toContain('AI 推断')
    expect(html).toContain('待确认')
  })

  it('gaps 命中的字段挂 data-gap，未命中的不挂', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),{gaps:[{kind:'FIELD',name:'quantity',label:'数量'}]})}/>)
    expect(html).toContain('data-gap="quantity"')
    expect(html).not.toContain('data-gap="condition"')
  })
})

// 评审裁决 2：DAO（getEbayBusinessPolicies 无 kind 时按 kind,label 排序，不按 isDefault）不保证默认在前，
// 故 fixture 故意把非默认的 18510002004 排在默认的 18510002003 之前——组件不自己按 isDefault 前置，
// 「默认政策先渲染」必红；若 fixture 不重排，这条断言在没有排序时也会假绿。
const policies:EbayStoreBusinessPolicy[]=[
  {id:'s1:PAYMENT:257217501013',storeId:'s1',kind:'PAYMENT',policyId:'257217501013',label:'eBay Managed Payments',isDefault:true,updatedAt:''},
  {id:'s1:SHIPPING:18510002004',storeId:'s1',kind:'SHIPPING',policyId:'18510002004',label:'标准运输',isDefault:false,updatedAt:''},
  {id:'s1:SHIPPING:18510002003',storeId:'s1',kind:'SHIPPING',policyId:'18510002003',label:'云仓包邮',listingCount:1851,isDefault:true,updatedAt:''},
  {id:'s1:RETURN:19007008009',storeId:'s1',kind:'RETURN',policyId:'19007008009',label:'14天大健云仓退货',isDefault:true,updatedAt:''},
  {id:'s1:FULFILLMENT:6600001',storeId:'s1',kind:'FULFILLMENT',policyId:'6600001',label:'云仓代发履约政策',isDefault:true,updatedAt:''}
]

describe('EbayLocalListingEditor · 07 政策与所在地', () => {
  it('已有政策时按 kind 分组渲染下拉并选中草稿值', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({policyIds:{shipping:'18510002004'}}),{businessPolicies:policies})}/>)
    expect(html).toContain('07 政策与所在地')
    expect(html).toContain('data-policy-kind="shipping"')
    expect(html).toContain('<option value="18510002004" selected="">')
    expect(html).toContain('云仓包邮')
  })

  it('无政策时给出「从 Seller Hub 读取政策」入口而不是空白', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),{businessPolicies:[]})}/>)
    expect(html).toContain('从 Seller Hub 读取政策')
  })

  it('就绪度条点名缺口，并声明这些字段页面沿用线上原值', () => {
    const draft=draftOf({condition:'',postalCode:'',policyIds:{payment:'257217501013',shipping:'18510002003',return:'19007008009'}})
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draft,{gaps:requiredFormGaps([],formValuesFromInput(draft))})}/>)
    expect(html).toContain('eBay 必填待补齐 2 项')
    expect(html).toContain('商品状况')
    expect(html).toContain('沿用 eBay 线上原值')
    expect(html).not.toContain('四项核心资料已通过')
  })

  it('所在地与邮编可编辑并回填', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({itemLocation:'Yunnan, CN',postalCode:'650000'}))}/>)
    expect(html).toContain('value="Yunnan, CN"')
    expect(html).toContain('value="650000"')
  })

  it('同类政策 isDefault 排最前，且 FULFILLMENT 不进 07 下拉（裁决 2/3）', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),{businessPolicies:policies})}/>)
    const shipping=html.slice(html.indexOf('data-policy-kind="shipping"'),html.indexOf('data-policy-kind="return"'))
    expect(shipping.indexOf('18510002003')).toBeGreaterThan(-1)
    expect(shipping.indexOf('18510002003')).toBeLessThan(shipping.indexOf('18510002004'))
    expect(html).not.toContain('data-policy-kind="fulfillment"')
    expect(html).not.toContain('6600001')
  })
})
