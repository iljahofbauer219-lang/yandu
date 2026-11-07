import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import EbayLocalListingEditor from '../EbayLocalListingEditor'
import type { EbayLocalProduct, EbayLocalProductUpdateInput } from '../../shared/contracts'
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
