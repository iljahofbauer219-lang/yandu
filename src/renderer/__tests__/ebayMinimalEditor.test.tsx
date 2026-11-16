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
  it('CSS：core 隐藏 eBay 资料六段＋定价选项侧栏＋付款政策；details（刊登资料抽屉）不隐藏核心五段，须含图片等与本地产品编辑同源', () => {
    const css=readFileSync(path.resolve(process.cwd(),'src/renderer/ebay-local-listing-editor.css'),'utf8')
    for(const sel of ['.ebay-revise-validation','#ebay-revise-specifics','#ebay-revise-condition','#ebay-revise-policies','#ebay-revise-others','.ebay-pricing-aside','[data-policy-kind="payment"]']){
      expect(css).toContain(`.ebay-revise-shell[data-mode="core"] ${sel}`)
    }
    for(const sel of ['#ebay-revise-media','#ebay-revise-title','#ebay-revise-category','#ebay-revise-variations','#ebay-revise-description']){
      expect(css, `刊登资料抽屉须显示 ${sel}（与图1本地产品编辑同源，不得少图片）`).not.toContain(`.ebay-revise-shell[data-mode="details"] ${sel}`)
    }
    expect(css).toContain('{display:none}')
  })
  it('运输与所在地/其他刊登选项两段全 mode 隐藏（删 UI 不删数据）', () => {
    const css=readFileSync(path.resolve(process.cwd(),'src/renderer/ebay-local-listing-editor.css'),'utf8')
    expect(css).toContain('.ebay-revise-shell #ebay-revise-policies,.ebay-revise-shell #ebay-revise-others{display:none}')
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
  it('内联发布编辑器传 mode="core"（仅核心段、六段隐；draft/保存/抽屉入口保留）', () => {
    const inline=app().split('\n').find(line=>line.includes('<EbayLocalListingEditor inline'))??''
    expect(inline).toContain('mode="core"')
  })
  it('W 隐藏原生视图扩展到 details 抽屉：抽屉开时隐藏、关闭恢复', () => {
    expect(app()).toContain("const overlayOpen=ebayFixedPresetOpen||(localEditorMode==='details'&&Boolean(localEditorProduct))")
  })
  it('线上发布页只留本地定时发布：交付页眉/验收中心/就绪横幅/逐商品发布卡片均已删除', () => {
    const source=app()
    expect(source).not.toContain('ebay-final-handoff-heading')
    expect(source).not.toContain('ebay-acceptance-center')
    expect(source).not.toContain('ebay-publish-readiness')
    expect(source).not.toContain('ebay-premium-grid')
    expect(source).not.toContain('ebay-publish-actions')
    expect(source).toContain('ebay-scheduled-publish')
  })
  it('优品仓库与线上发布环节互斥：列表/计数/类目树同源排除已有本地产品的草稿', () => {
    const source=app()
    expect(source, '要有按「已有同 listingId 本地产品」排除的单一来源').toContain('const premiumStageDrafts=optimizationDrafts.filter(')
    expect(source).toContain('product.listingId===draft.listing.listingId')
    for(const anchor of [
      'const publishReadyDrafts=premiumStageDrafts.filter',
      'const premiumListings=premiumStageDrafts.map',
      'const visiblePremiumDrafts=premiumStageDrafts.filter',
      'const premiumUnclassifiedCount=premiumStageDrafts.filter',
      'const premiumReviewCount=premiumStageDrafts.filter',
      'const premiumMissingImageCount=premiumStageDrafts.filter',
      'const premiumMissingDecisionCount=premiumStageDrafts.filter'
    ]) expect(source, anchor).toContain(anchor)
    expect(source, '全部优品计数也要走同一来源').toContain('全部优品 <em>{premiumStageDrafts.length}</em>')
  })
  it('eBay 左栏与货盘目录左栏同宽同款：共享宽度/内边距/阴影变量，滚动观感一致', () => {
    const base=readFileSync(path.resolve(process.cwd(),'src/renderer/styles.css'),'utf8')
    const studio=readFileSync(path.resolve(process.cwd(),'src/renderer/image-studio.css'),'utf8')
    expect(base, '宽度单一来源').toContain('--side-panel-w:330px')
    expect(base, '目录左栏宽度单一来源').toContain('--side-panel-w-catalog:220px')
    expect(base, '内边距单一来源').toContain('--side-panel-pad:14px')
    expect(base, '阴影单一来源').toContain('--side-panel-shadow:0 5px 20px rgba(0,0,0,.035)')
    expect(base, '货盘左栏列宽走变量').toContain('.warehouse-catalog-layout { flex:1; min-height:0; display:grid; grid-template-columns:var(--side-panel-w)')
    expect(base, '我的货盘左栏列宽走目录变量').toContain('.pallet-catalog-page { grid-template-columns:var(--side-panel-w-catalog)')
    expect(base, '目录面板阴影走变量').toContain('box-shadow:var(--side-panel-shadow)')
    expect(studio, 'eBay 左栏列宽走目录同一变量').toContain('.ebay-browser-layout { flex:1; min-height:0; display:grid; grid-template-columns:var(--side-panel-w-catalog)')
    expect(studio, 'eBay 左栏内边距走变量').toContain('padding:var(--side-panel-pad)')
    expect(studio, 'eBay 左栏阴影走变量').toContain('box-shadow:var(--side-panel-shadow)')
    expect(studio, '不再强制常显滚动条与 gutter').not.toContain('scrollbar-gutter:stable')
  })
  it('工作台标题区只留主标题：眉标与副标题两串文字已删除', () => {
    const source=app()
    expect(source, '眉标要删除').not.toContain('EBAY WORKBENCH')
    expect(source, '副标题要删除').not.toContain('登录身份与浏览会话按店铺独立保存')
    expect(source, '主标题保留').toContain('<h2>ebay工作台</h2>')
  })
  it('平台头部带与子页签带同高：共用 --ebay-band-h，不再各自 min-height 撑高', () => {
    const ui=readFileSync(path.resolve(process.cwd(),'src/renderer/ui-readability.css'),'utf8')
    const base=readFileSync(path.resolve(process.cwd(),'src/renderer/styles.css'),'utf8')
    expect(base, '高度单一来源').toContain('--ebay-band-h:48px')
    expect(ui, '头部带用同一变量定高').toContain('.ebay-store-bar{height:var(--ebay-band-h)')
    expect(ui, '子页签带用同一变量定高').toMatch(/\.ebay-business-nav\{[^}]*height:var\(--ebay-band-h\)/)
    expect(ui, '头部带不得再用 min-height 撑高').not.toContain('.ebay-store-bar{min-height:82px')
  })
  it('定时发布行两行布局：三按钮与时间设置在第二行控件块，行内发布时间删除、改弹窗设置', () => {
    const source=app()
    const block=source.split('<div className="ebay-scheduled-actions">')[1]?.split('</div>')[0] ?? ''
    for(const anchor of ['>草稿发布</button>','>草稿查看</button>',"sch.enabled?'自动发布·开':'自动发布'",'>时间设置</button>'])
      expect(block, '第二行控件块要含 '+anchor).toContain(anchor)
    expect(block.indexOf('>草稿发布</button>')).toBeLessThan(block.indexOf('>草稿查看</button>'))
    expect(block.indexOf('>草稿查看</button>')).toBeLessThan(block.indexOf("sch.enabled?'自动发布·开':'自动发布'"))
    expect(block.indexOf("sch.enabled?'自动发布·开':'自动发布'")).toBeLessThan(block.indexOf('>时间设置</button>'))
    expect(source, '行内发布时间标签与输入框要删除').not.toContain('ebay-scheduled-time')
    expect(source, '时间设置要开弹窗').toContain('setScheduleTimeDraft({productId:product.id')
    expect(source, '弹窗确认要写回该产品的 sch.at').toContain('writeScheduledPublish({...scheduledPublish,[scheduleTimeDraft.productId]:{enabled:')
    const css=readFileSync(path.resolve(process.cwd(),'src/renderer/styles.css'),'utf8')
    expect(css, '第二行控件块四列网格').toContain('.ebay-scheduled-actions{display:grid;grid-template-columns:repeat(4,auto)')
  })
  it('本地定时发布每行在手动发布后、自动发布前有草稿发布/草稿查看两按钮，且接去重业务', () => {
    const source=app()
    const seg=source.split('>手动发布</button>')[1]?.split('<button type="button" className={sch.enabled?\'primary\':\'\'}')[0] ?? ''
    expect(seg, '手动发布与自动发布之间要有草稿发布').toContain('>草稿发布</button>')
    expect(seg, '手动发布与自动发布之间要有草稿查看').toContain('>草稿查看</button>')
    expect(seg.indexOf('>草稿发布</button>'), '草稿发布在草稿查看之前').toBeLessThan(seg.indexOf('>草稿查看</button>'))
    expect(seg, '草稿发布复用手动发布去重链路（并传 saveDraft 开关）').toContain('onClick={()=>void manualPublishLocal(product,true)}>草稿发布')
    expect(seg, '草稿查看打开唯一草稿/刊登').toContain('onClick={()=>viewPublishDraft(product)}>草稿查看')
    const css=readFileSync(path.resolve(process.cwd(),'src/renderer/styles.css'),'utf8')
    expect(css, '行改三轨（图/标题/控件块），控件块内四列两行').toContain('.ebay-scheduled-row{display:grid;grid-template-columns:56px minmax(0,1fr) auto;')
    expect(css).toContain('.ebay-scheduled-actions{display:grid;grid-template-columns:repeat(4,auto)')
  })
  it('内联发布编辑器店铺类目「自动分类/手动选类」接通真实 handler（非 noop），作用于 publishEditorProduct', () => {
    const source=app()
    expect(source).toContain('onAutoClassify={()=>void autoClassifyLocal(publishEditorProduct?.id)}')
    expect(source).toContain('onSetCategory={(categoryId,categoryName)=>void setLocalCategory(categoryId,categoryName,publishEditorProduct?.id)}')
    expect(source).not.toContain('onSetCategory={()=>{}} onAutoClassify={()=>{}}')
  })
})