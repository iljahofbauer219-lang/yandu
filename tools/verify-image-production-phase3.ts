import assert from 'node:assert/strict'
import { buildImageProductionTasks, deriveImageProjectStatus, selectTaskReferenceImages, taskReviewPurpose } from '../src/shared/imageProduction'
import type { ImportedProductImage } from '../src/shared/contracts'

const images:ImportedProductImage[]=[
  {id:'primary',name:'primary.png',dataUrl:'data:image/png;base64,AA==',source:'primary',mimeType:'image/png',role:'PRIMARY'},
  {id:'detail',name:'detail.png',dataUrl:'data:image/png;base64,AA==',source:'detail',mimeType:'image/png',role:'DETAIL'},
  {id:'package',name:'package.png',dataUrl:'data:image/png;base64,AA==',source:'package',mimeType:'image/png',role:'PACKAGING'},
  {id:'accessory',name:'accessory.png',dataUrl:'data:image/png;base64,AA==',source:'accessory',mimeType:'image/png',role:'ACCESSORY'}
]
const tasks=buildImageProductionTasks({plan:'full',productName:'Test',sku:'SKU',platform:'Ozon',language:'俄语',sourceContext:'verified'})
const hero=tasks.find(task=>task.code==='H01')!
const packageTask=tasks.find(task=>task.code==='H05')!
const detail=tasks.find(task=>task.code==='D03')!
assert.equal(selectTaskReferenceImages(hero,images,1)[0].id,'primary')
assert.deepEqual(selectTaskReferenceImages(packageTask,images,2).map(image=>image.id),['package','accessory'])
assert.equal(selectTaskReferenceImages(detail,images,1)[0].id,'detail')
assert.equal(taskReviewPurpose(hero),'HERO')
assert.equal(taskReviewPurpose(tasks.find(task=>task.code==='H03')!),'SCENE')

const qualityTasks=tasks.slice(0,3).map((task,index)=>({...task,status:(index===0?'SUCCESS':index===1?'REVIEW':'FAILED') as typeof task.status,outputUrl:`https://example.test/${index}.png`}))
assert.equal(deriveImageProjectStatus(qualityTasks),'PARTIAL')
console.log(JSON.stringify({heroReference:'primary',packageReferences:['package','accessory'],detailReference:'detail',reviewPurpose:true,qualityIsolation:'PARTIAL'},null,2))
