import { readFileSync } from 'node:fs'
import path from 'node:path'
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
// 载体编号默认给一个合法在架 itemId：R1 后 07 区恒渲染校验提示，默认值让上面既有断言仍针对「政策已就绪」的正常态，
// 不合法的分支由下面 R1 专测按 over 覆盖，避免每条旧断言都被红色提示污染。
const props=(draft:EbayLocalProductUpdateInput,over:Partial<ComponentProps<typeof EbayLocalListingEditor>>={}):ComponentProps<typeof EbayLocalListingEditor>=>({
  inline:true,product,draft,saving:false,uploading:false,preparing:false,readingPolicies:false,businessPolicies:[],categories:[],
  onChange:noop,onSave:noop,onClose:noop,onUpload:noop,onPrepare:noop,onSetCategory:noop,onAutoClassify:noop,onReadPolicies:noop,
  policyCarrierItemId:'189035181453',onPolicyCarrierItemIdChange:noop,
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

// 评审 Important-4：本任务的核心不变量「政策按 eBay 政策 ID 命中，不按名称猜」必须有回归锁。
// option 的 value 只允许是数字 policyId；中文 label 只许出现在标签文本里。故两侧同时断言：
// value 里出现 label（把 value={item.policyId} 突变成 value={item.label}）必红。
describe('EbayLocalListingEditor · 08 政策与所在地', () => {
  it('已有政策时按 kind 分组渲染下拉并选中草稿值', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({policyIds:{shipping:'18510002004'}}),{businessPolicies:policies})}/>)
    expect(html).toContain('08 政策与所在地')
    // data-policy-kind 挂在 <select> 自身（不是 label 或 option），评审 Minor-2 点名核对：实现本已如此，只在测试侧锁死位置。
    expect(html).toMatch(/<select data-policy-kind="shipping"/)
    expect(html).toContain('<option value="18510002004" selected="">')
    expect(html).toContain('云仓包邮')
    // 命中不变量：value 是政策 ID（付款政策未选值，故裸 option 标签），中文 label 绝不进 value。
    expect(html).toContain('<option value="257217501013"')
    expect(html).not.toContain('value="eBay Managed Payments"')
    expect(html).not.toContain('value="云仓包邮"')
  })

  it('无政策时给出「从 Seller Hub 读取政策」入口而不是空白', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),{businessPolicies:[]})}/>)
    expect(html).toContain('从 Seller Hub 读取政策')
    // 评审 Minor-1：上一条只锁页眉按钮文案（与 businessPolicies 无关、恒渲染），空状态提示本身也得被钉住。
    expect(html).toContain('尚未读取到店铺政策')
  })

  it('读取政策按钮在保存/上传/准备进行中同样禁用，并写明为什么点不动（评审 Important-2）', () => {
    const readButton=(over:Partial<ComponentProps<typeof EbayLocalListingEditor>>={})=>{
      const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),{businessPolicies:policies,...over})}/>)
      const section=html.slice(html.indexOf('id="ebay-revise-policies"'))
      return section.slice(section.indexOf('<button'),section.indexOf('</button>')+'</button>'.length)
    }
    // 空闲：可点且文案就是动作本身
    expect(readButton()).toContain('>从 Seller Hub 读取政策<')
    expect(readButton()).not.toContain('disabled')
    // 读取中：禁用 + 进度文案
    expect(readButton({readingPolicies:true})).toContain('disabled')
    expect(readButton({readingPolicies:true})).toContain('>正在读取…<')
    // 其它流程占用全局 busy 时：静默禁用会被读成「代码没生效」，故文案点名原因
    for (const occupied of [{saving:true},{uploading:true},{preparing:true}]) {
      expect(readButton(occupied)).toContain('disabled')
      expect(readButton(occupied)).toContain('>请等待当前操作完成<')
    }
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

// 页眉范围声明：本对话框自 Task 6/7 起已渲染 05 状况与库存、08 政策与所在地（分区顺序对齐 eBay 现网修改页后编号顺延），
// 「仅保存图片、标题、描述和价格」是对渲染范围的事实错误声明，必须消失；
// 同时钉住「不代您提交线上刊登」——最终提交按钮恒由操作员点击，任何文案不得暗示代码代提交。
describe('EbayLocalListingEditor · 页眉范围声明', () => {
  const headerEm=(html:string):string=>{
    const topbar=html.slice(html.indexOf('ebay-revise-topbar'),html.indexOf('ebay-revise-body'))
    return /<em>([^<]*)<\/em>/.exec(topbar)?.[1]??''
  }
  it('页眉 <em> 不再声明只处理标题/描述/价格，且说明不代您提交线上刊登', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf())}/>)
    const em=headerEm(html)
    expect(em).not.toBe('')
    expect(em).not.toContain('仅保存图片、标题、描述和价格')
    expect(em).not.toContain('标题、描述和价格')
    expect(em).toContain('不代您提交线上刊登')
    expect(em).not.toMatch(/。$/)
  })

  it('源码守卫：App.tsx 本地详情准备提示与「进入发布」副本同口径，旧「标题、描述和价格」范围声明不得残留', () => {
    const appSource=readFileSync(path.resolve(process.cwd(),'src/renderer/App.tsx'),'utf8')
    const line=appSource.split('\n').find(item=>item.startsWith('  const prepareLocalEditorInSellerHub='))??''
    expect(line).not.toBe('')
    expect(line).not.toContain('准备标题、描述和价格')
    // 点名实际写入项与未能自动写入项，且保留本地版本号 / 图片人工核对 / 未提交三项既有事实
    expect(line).toContain('new Set(result.filledFields)')
    expect(line).toContain('未能自动写入')
    expect(line).toContain(`本地 V\${product.versionCount}`)
    expect(line).toContain('图片仍由您在页面人工核对，系统没有提交')
    // 「进入发布」副本（App.tsx:4172）保持同口径，两处不得各自漂移：路由第一句只能来自同一条 lead
    const sibling=appSource.split('\n').find(item=>item.includes('setNotice(`${ebayPreparedNoticeLead(result,filled)}'))??''
    expect(sibling).not.toBe('')
    expect(sibling).toContain('未能自动写入')
    expect(sibling).toContain('最终提交按钮仍需由您点击')
  })
})

// (b) 三路由真机取证：PALLET 货盘产品没有 eBay 在架编号，只能按平台类目开首次刊登页；连类目也没有时只能开「List an item」。
// 对这两类产品继续说「Seller Hub 修改页」「沿用线上原值」是假话，按钮与就绪度句子必须随路由改写；
// 但门禁只点名不阻断——任何路由下主按钮都得能点（拦截+显示指导会被读成「代码没生效」）。
describe('EbayLocalListingEditor · 开页路由文案', () => {
  const primaryTag=(over:Partial<ComponentProps<typeof EbayLocalListingEditor>>={})=>{
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),over)}/>)
    const buttons=html.match(/<button class="primary"[^>]*>[\s\S]*?<\/button>/g)??[]
    return buttons[buttons.length-1]??''
  }
  const conditionGap={kind:'FIELD' as const,name:'condition',label:'商品状况'}

  it('未传路由时保持修改页口径：按钮写「修改」，缺口句仍说沿用 eBay 线上原值', () => {
    expect(primaryTag()).toContain('保存并准备到 eBay 修改')
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({condition:''}),{gaps:[conditionGap]})}/>)
    expect(html).toContain('商品状况 未在 APP 记录')
    expect(html).toContain('沿用 eBay 线上原值')
    expect(html).not.toContain('首次刊登')
  })

  it('首次刊登路由：按钮写「首次刊登」，点名按平台类目开页，且不再谎称沿用线上原值', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf({condition:''}),{gaps:[conditionGap],routeKind:'add'})}/>)
    expect(primaryTag({routeKind:'add'})).toContain('保存并准备到 eBay 首次刊登')
    expect(html).toContain('按上方「平台类目」选定的类目打开 eBay 首次刊登页')
    expect(html).not.toContain('沿用 eBay 线上原值')
    expect(html).not.toContain('Seller Hub 修改页')
  })

  it('新建刊登路由：按钮写「新建刊登」，点名先在「平台类目」定类目，且按钮照样能点', () => {
    const tag=primaryTag({routeKind:'prelist'})
    expect(tag).toContain('保存并打开 eBay 新建刊登')
    expect(tag).not.toContain('disabled')
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),{routeKind:'prelist'})}/>)
    expect(html).toContain('请先在上方「平台类目」确定类目')
    expect(html).not.toContain('沿用 eBay 线上原值')
  })

  it('准备进行中：主按钮一律禁用，进度文案也按路由说页面名', () => {
    expect(primaryTag({routeKind:'prelist',preparing:true})).toContain('正在打开 eBay…')
    expect(primaryTag({routeKind:'prelist',preparing:true})).toContain('disabled')
    expect(primaryTag({routeKind:'add',preparing:true})).toContain('正在准备 eBay 首次刊登页…')
  })

  it('源码守卫：两个编辑器调用点都带路由与收缩后的缺口集合，两条准备提示共用同一条路由口径', () => {
    const appSource=readFileSync(path.resolve(process.cwd(),'src/renderer/App.tsx'),'utf8')
    const callSites=appSource.split('\n').filter(line=>line.includes('<EbayLocalListingEditor'))
    expect(callSites.length).toBe(2)
    callSites.forEach(line=>{
      expect(line).toContain('routeKind={')
      expect(line).toContain('ebayHardRequiredFieldsForRoute(')
    })
    expect(appSource).toContain('const ebayPreparedNoticeLead=')
    // 两处 prepare 完成提示只能经同一条 lead，各自漂移即红
    expect(appSource.match(/ebayPreparedNoticeLead\(result,filled\)/g)).toHaveLength(2)
  })
})

// D1 断点：「进入发布」曾把远程 AI 出图标成 DOWNLOADED 且 localPath 为空——编辑器判据偏松于是绿灯，
// 主进程 updateEbayLocalProduct 的判据偏严（DOWNLOADED 且 localPath 非空）必然拒保存。
// 这里把两侧钉成同一判据：没有本地文件就不算已下载。
describe('EbayLocalListingEditor · 图片必须真在本地（D1）', () => {
  const remoteOnly=(over:Partial<EbayLocalProductUpdateInput['media'][number]>={})=>draftOf({
    media:[{id:'ai-opt-1',mediaType:'IMAGE',sortOrder:0,remoteUrl:'https://img/a.jpg',localPath:'',mimeType:'image/jpeg',width:0,height:0,fileSize:0,sha256:'',downloadStatus:'DOWNLOADED',...over}]
  })

  it('DOWNLOADED 但 localPath 为空的远程图判为「至少需要 1 张已保存到本地的商品图片」', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(remoteOnly())}/>)
    expect(html).toContain('至少需要 1 张已保存到本地的商品图片')
  })

  it('落盘失败的 FAILED 行仍用远程地址显示，不因为下载失败出破图', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(remoteOnly({downloadStatus:'FAILED'}))}/>)
    expect(html).toContain('src="https://img/a.jpg"')
    expect(html).not.toContain('cross-media://local')
    expect(html).toContain('至少需要 1 张已保存到本地的商品图片')
  })

  it('localPath 真实的 DOWNLOADED 行不再报缺图（判据只认本地文件）', () => {
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(remoteOnly({localPath:'/tmp/a.jpg',width:1200,height:1200,fileSize:1}))}/>)
    expect(html).not.toContain('至少需要 1 张已保存到本地的商品图片')
    expect(html).toContain('src="cross-media://local/%2Ftmp%2Fa.jpg"')
  })

  it('源码守卫：「进入发布」不再伪造 DOWNLOADED，内联编辑器接到真下载与真上传', () => {
    const appSource=readFileSync(path.resolve(process.cwd(),'src/renderer/App.tsx'),'utf8')
    expect(appSource).not.toContain("downloadStatus:'DOWNLOADED' as const")
    expect(appSource).not.toContain("/^https?:\\/\\//.test(url)?'':url")
    expect(appSource).toContain('downloadLocalProductMedia(')
    const inline=appSource.split('\n').find(item=>item.includes('<EbayLocalListingEditor inline'))??''
    expect(inline).not.toBe('')
    expect(inline).not.toContain('onUpload={()=>{}}')
    expect(inline).toContain('onUpload={files=>void uploadPublishEditorMedia(files)}')
    expect(inline).not.toContain('uploading={false}')
    expect(inline).toContain('uploading={busy===`publish-media:${publishEditorProduct?.id}`}')
  })
})

// R1 断点：本地产品 listingId 是 PALLET-<货盘编号>，直接拼进 ReviseItem 会被 eBay 拒成 createOrGetDraft 错误页，
// 政策永远抓不到（真机取证见 5.4）。政策是店铺级资产，故开页载体改由操作员手填真实在架商品编号、按店铺记住，
// 且「不合法就不发 IPC」——开一个必然报错的页签比当场点名缺什么更糟。
describe('EbayLocalListingEditor · 08 政策读取载体（R1）', () => {
  const carrierTag=(over:Partial<ComponentProps<typeof EbayLocalListingEditor>>={})=>{
    const html=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),over)}/>)
    return /<input data-policy-carrier[^>]*>/.exec(html)?.[0]??''
  }

  it('载体编号手填回显，且任何流程进行中都不禁用它（禁用会被读成「代码没生效」）', () => {
    expect(carrierTag()).toContain('value="189035181453"')
    expect(carrierTag({readingPolicies:true,saving:true,uploading:true,preparing:true})).not.toContain('disabled')
  })

  it('载体空着或填成本地 PALLET 编号时当场点名，全中文且不靠 eBay 报错', () => {
    const empty=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),{policyCarrierItemId:''})}/>)
    expect(empty).toContain('「在架商品编号」还是空的')
    const pallet=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),{policyCarrierItemId:'PALLET-4b695b47-1'})}/>)
    expect(pallet).toContain('PALLET-4b695b47-1')
    expect(pallet).toContain('不是 eBay 商品编号')
  })

  it('上次抓取时间沿用政策入库时间口径，未抓取过时如实说明', () => {
    const fetched=renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf(),{businessPolicies:policies.map((item,index)=>({...item,updatedAt:index===4?'2026-11-07T12:00:00.000Z':'2026-10-01T00:00:00.000Z'}))})}/>)
    expect(fetched).toContain('上次抓取：2026/11')
    expect(fetched).not.toContain('尚未抓取过')
    expect(renderToStaticMarkup(<EbayLocalListingEditor {...props(draftOf())}/>)).toContain('上次抓取：尚未抓取过')
  })

  it('源码守卫：读取入口先过纯函数再发 IPC，两个编辑器调用点都接载体，且按店铺记住', () => {
    const appSource=readFileSync(path.resolve(process.cwd(),'src/renderer/App.tsx'),'utf8')
    const start=appSource.indexOf('const readBusinessPoliciesFor=async')
    expect(start).toBeGreaterThan(-1)
    const body=appSource.slice(start,start+2400)
    expect(body).toContain('const carrier=checkEbayPolicyCarrierItemId(policyCarrierItemId)')
    expect(body).toContain('if(!carrier.ok){setEbayError(carrier.message);return}')
    expect(body).toContain('localProductRequirements(storeId,carrier.itemId,title)')
    // 不再拿 PALLET 本地编号当载体开页；setBusy 也必须在把关之后，否则空载体照样进入「正在读取…」
    expect(body).not.toMatch(/localProductRequirements\(storeId,listingId/)
    expect(body.indexOf('if(!carrier.ok)')).toBeLessThan(body.indexOf('setBusy(busyKey)'))
    const callSites=appSource.split('\n').filter(line=>line.includes('policyCarrierItemId={policyCarrierItemId}'))
    expect(callSites.length).toBe(2)
    callSites.forEach(line=>expect(line).toContain('onPolicyCarrierItemIdChange={setPolicyCarrierForActiveStore}'))
    expect(appSource).toContain('const ebayPolicyCarrierKey=(storeId:string)=>`ebay-policy-carrier:${storeId}`')
    expect(appSource).toContain('setPolicyCarrierItemId(readPolicyCarrierItemId(activeStore?.id||\'\'))')
  })
})
