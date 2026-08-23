import { buildImageTaskQualityLayers, overallImageTaskQuality, summarizeImageTaskQuality } from '../src/shared/imageProduction'
import type { EbayImageCandidateReview } from '../src/shared/contracts'

function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message)}
const base:EbayImageCandidateReview={candidateUrl:'https://example.test/image.png',purpose:'PRODUCT',status:'PASSED',identityScore:95,structuralScore:95,factScore:95,purposeScore:95,diversityScore:100,geometryScore:95,styleScore:90,languageScore:90,reason:'ok',referenceIndices:[0],newStructures:[],missingStructures:[],geometryMismatch:false}
const passed=buildImageTaskQualityLayers(base)
assert(overallImageTaskQuality(passed)==='PASSED','四层全部合格时必须通过')
const factFailure=buildImageTaskQualityLayers({...base,newStructures:['虚构配件']})
assert(factFailure.facts.status==='REJECTED'&&overallImageTaskQuality(factFailure)==='REJECTED','商品事实硬错误必须拒绝')
const taskFailure=buildImageTaskQualityLayers({...base,purposeScore:50})
assert(taskFailure.task.status==='REJECTED','任务类型错误必须拒绝')
const styleFailure=buildImageTaskQualityLayers({...base,styleScore:50})
assert(styleFailure.style.status==='REJECTED','风格关键特征缺失必须拒绝')
const languageFailure=buildImageTaskQualityLayers({...base,languageScore:40})
assert(languageFailure.language.status==='REJECTED','底图乱码或营销文字必须拒绝')
assert(summarizeImageTaskQuality(languageFailure).includes('事实通过')&&summarizeImageTaskQuality(languageFailure).includes('语言不通过'),'质检摘要必须同时显示四层状态')
console.log(JSON.stringify({allPassed:true,factHardErrorRejected:true,taskMismatchRejected:true,styleMismatchRejected:true,languageMismatchRejected:true,summary:summarizeImageTaskQuality(languageFailure)},null,2))
