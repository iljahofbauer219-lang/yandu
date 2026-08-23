import { buildImageTaskQualityLayers, overallImageTaskQuality, validateImageSizeOutput } from '../src/shared/imageProduction'
import type { EbayImageCandidateReview } from '../src/shared/contracts'

function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message)}

const review:EbayImageCandidateReview={candidateUrl:'data:image/png;base64,test',purpose:'PRODUCT',status:'PASSED',identityScore:96,structuralScore:95,factScore:94,purposeScore:93,diversityScore:90,geometryScore:95,styleScore:91,languageScore:92,reason:'局部修改后一致',referenceIndices:[0],newStructures:[],missingStructures:[],geometryMismatch:false}
const passedLayers=buildImageTaskQualityLayers(review)
assert(overallImageTaskQuality(passedLayers)==='PASSED','局部修改四层均通过时应允许采用')
const rejectedLayers=buildImageTaskQualityLayers({...review,newStructures:['虚构配件'],languageScore:40})
assert(overallImageTaskQuality(rejectedLayers)==='REJECTED','局部修改产生事实或语言硬错误时必须拒绝')

const validSize=validateImageSizeOutput({width:1200,height:1200,expectedWidth:1200,expectedHeight:1200,format:'image/png',byteSize:2*1024*1024,placement:{x:100,y:0,width:1000,height:1200}})
assert(validSize.status==='PASSED'&&validSize.checks.length===4,'正确尺寸、格式、体积和完整主体应通过')
const invalidSize=validateImageSizeOutput({width:800,height:1200,expectedWidth:1200,expectedHeight:1200,format:'image/gif',byteSize:11*1024*1024,placement:{x:-10,y:0,width:900,height:1200}})
assert(invalidSize.status==='REJECTED'&&invalidSize.issues.length===4,'错误尺寸、格式、体积和裁切必须全部拦截')

console.log(JSON.stringify({localEditPassed:overallImageTaskQuality(passedLayers),localEditRejected:overallImageTaskQuality(rejectedLayers),validSize,invalidSize},null,2))
