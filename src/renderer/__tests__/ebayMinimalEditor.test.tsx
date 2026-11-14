import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ComponentProps } from 'react'
import EbayLocalListingEditor from '../EbayLocalListingEditor'
import type { EbayLocalProduct, EbayLocalProductUpdateInput } from '../../shared/contracts'
import { formValuesFromInput, requiredFormGaps } from '../../shared/ebayListingForm'

/**
 * 极简编辑器专项重构（2026-11-14，方案A 的低风险显隐迁移实现）：
 * 本地产品编辑只留核心（图片/标题/类别/描述/定价的价格数量/保存），eBay 资料六段
 * （类目属性/状况/运输与所在地/定价选项/付款政策/其他刊登选项/必填待补齐）迁到浏览器侧
 * 「刊登资料」抽屉。数据/保存/准备/自动填写链路零改动——六段 JSX 仍在组件内，仅按 mode 显隐：
 *   · full（默认）＝十段全显，内联发布编辑器走这条，不回归；
 *   · core＝隐藏六段，本地产品编辑正常打开走这条；
 *   · details＝只显六段，浏览器「刊登资料」抽屉走这条。
 * 这里同时锁「显隐口径（data-mode + CSS）」与「App 接线（状态/按钮/抽屉/W 隐藏原生视图）」，
 * 任一处漂了都必红。CSS 显隐不改 DOM，故 renderToStaticMarkup 里十段锚点恒在。
 */
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
  policyCarrierItemId:'189035181453',onPolicyCarrierItemIdChange:noop,
  gaps:requiredFormGaps([],formValuesFromInput(draft)),...over
})
const SECTION_IDS=['media','title','category','variations','specifics','condition','description','pricing','policies','others']

describe('极简编辑器 · 显隐口径（data-mode + CSS）', () => {
  it('默认 mode=full：内联发布编辑器不传 mode 时十段全显，不回归', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf())}/>)
    expect(html).toContain('data-mode="full"')
  })
  it('core/details 各自落到 data-mode，且十段锚点恒在（CSS 显隐不改 DOM）', () => {
    const core=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),{mode:'core'})}/>)
    const details=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),{mode:'details'})}/>)
    expect(core).toContain('data-mode="core"')
    expect(details).toContain('data-mode="details"')
    for(const id of SECTION_IDS){
      expect(core).toContain(`id="ebay-revise-${id}"`)
      expect(details).toContain(`id="ebay-revise-${id}"`)
    }
  })
  it('CSS：core 隐藏 eBay 资料六段＋定价选项侧栏＋付款政策；details 隐藏核心五段', () => {
    const css=readFileSync(path.resolve(process.cwd(),'src/renderer/ebay-local-listing-editor.css'),'utf8')
    for(const sel of ['.ebay-revise-validation','#ebay-revise-specifics','#ebay-revise-condition','#ebay-revise-policies','#ebay-revise-others','.ebay-pricing-aside','[data-policy-kind="payment"]']){
      expect(css).toContain(`.ebay-revise-shell[data-mode="core"] ${sel}`)
    }
    for(const sel of ['#ebay-revise-media','#ebay-revise-title','#ebay-revise-category','#ebay-revise-variations','#ebay-revise-description']){
      expect(css).toContain(`.ebay-revise-shell[data-mode="details"] ${sel}`)
    }
    expect(css).toContain('{display:none}')
  })
})

describe('极简编辑器 · App.tsx 接线', () => {
  const app=()=>readFileSync(path.resolve(process.cwd(),'src/renderer/App.tsx'),'utf8')
  it('localEditorMode 会话状态默认 core', () => {
    expect(app()).toContain("const [localEditorMode,setLocalEditorMode]=useState<'core'|'details'>('core')")
  })
  it('浏览器 header 增「刊登资料」按钮，按当前填写目标商品开 details 抽屉', () => {
    const source=app()
    expect(source).toContain('const openListingDetails=')
    expect(source).toContain('>刊登资料</button>')
    expect(source).toContain("setLocalEditorMode('details')")
    expect(source).toContain('const product=localProducts.find(item=>item.id===id)')
  })
  it('本地产品编辑正常打开置 core；overlay 传 mode={localEditorMode}；关闭重置 core', () => {
    const source=app()
    expect(source).toContain("setLocalEditorMode('core')")
    expect(source).toContain('mode={localEditorMode}')
    const overlay=source.split('\n').find(line=>line.includes('<EbayLocalListingEditor')&&!line.includes('inline'))??''
    expect(overlay).toContain('mode={localEditorMode}')
    expect(overlay).toContain("setLocalEditorMode('core')")
  })
  it('内联发布编辑器不传 mode（保持 full，十段全显）', () => {
    const inline=app().split('\n').find(line=>line.includes('<EbayLocalListingEditor inline'))??''
    expect(inline).not.toContain('mode=')
  })
  it('W 隐藏原生视图扩展到 details 抽屉：抽屉开时隐藏、关闭恢复', () => {
    expect(app()).toContain("const overlayOpen=ebayFixedPresetOpen||(localEditorMode==='details'&&Boolean(localEditorProduct))")
  })
})