import { buildImageOperationsSummary, isImageTaskExportReady } from '../src/shared/imageProduction'
import type { ImageProductionProject, ImageProductionTask } from '../src/shared/imageProduction'

function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message)}
const now=new Date().toISOString(),base={id:'H01',code:'H01',group:'MAIN' as const,title:'首图',objective:'展示商品',prompt:'test',status:'SUCCESS' as const,outputUrl:'data:image/png;base64,ok',attempts:1,qualityStatus:'PASSED' as const,updatedAt:now}
const hero:ImageProductionTask={...base}
const detailWithoutLayout:ImageProductionTask={...base,id:'D01',code:'D01',group:'DETAIL',title:'详情',qualityStatus:'PASSED'}
const detailReady:ImageProductionTask={...detailWithoutLayout,finalOutputUrl:'data:image/png;base64,layout'}
const rejected:ImageProductionTask={...base,id:'H02',code:'H02',status:'FAILED',qualityStatus:'REJECTED'}
assert(isImageTaskExportReady(hero),'四层通过的首图应可导出')
assert(!isImageTaskExportReady(detailWithoutLayout),'详情图未正式排版时不得导出')
assert(isImageTaskExportReady(detailReady),'详情图四层通过且完成正式排版后应可导出')
assert(!isImageTaskExportReady(rejected),'质检拒绝图片不得导出')
const project:ImageProductionProject={id:'p',productKey:'sku',productTitle:'商品',productImageUrl:'',plan:'full',platform:'Ozon',language:'俄语',model:'mock',facts:{productName:'商品',sku:'sku',source:'test',price:'',referenceImageUrl:'',confirmed:true},approved:true,status:'PARTIAL',tasks:[hero,detailReady,{...rejected,attempts:2}],createdAt:now,updatedAt:now}
const summary=buildImageOperationsSummary([project])
assert(summary.taskCount===3&&summary.exportReadyCount===2,'运营摘要应统计任务与安全导出数量')
assert(summary.rejectionRate===33&&summary.retryCount===1,'运营摘要应统计拒绝率与重试')
assert(summary.formalLayoutCount===1,'运营摘要应统计正式排版数量')
console.log(JSON.stringify({heroReady:true,detailWithoutLayoutBlocked:true,rejectedBlocked:true,summary},null,2))
