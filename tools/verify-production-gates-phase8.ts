import { buildImageTaskQualityLayers, overallImageTaskQuality } from '../src/shared/imageProduction'
import type { EbayImageCandidateReview } from '../src/shared/contracts'

const highScores:EbayImageCandidateReview={status:'PASSED',score:95,reason:'通过',identityScore:95,structuralScore:95,factScore:95,geometryScore:95,purposeScore:95,styleScore:95,languageScore:95,newStructures:[],missingStructures:[],geometryMismatch:false}

const technicalReview=buildImageTaskQualityLayers({...highScores,status:'REVIEW',score:0,identityScore:0,structuralScore:0,factScore:0,geometryScore:0,purposeScore:0,styleScore:0,languageScore:0,reason:'视觉模型没有返回可解析的结构化结果；需人工确认后采用。'})
if(overallImageTaskQuality(technicalReview)!=='REVIEW')throw new Error('技术性复核不得自动拒绝或通过')

const modelReview=buildImageTaskQualityLayers({...highScores,status:'REVIEW',reason:'包装文字需要人工复核'})
if(overallImageTaskQuality(modelReview)!=='REVIEW')throw new Error('模型最终复核状态不得被高分覆盖')

const modelRejected=buildImageTaskQualityLayers({...highScores,status:'REJECTED',reason:'包装文字为乱码'})
if(overallImageTaskQuality(modelRejected)!=='REJECTED')throw new Error('模型最终拒绝状态不得被高分覆盖')

console.log(JSON.stringify({technicalFallback:overallImageTaskQuality(technicalReview),modelReview:overallImageTaskQuality(modelReview),modelRejected:overallImageTaskQuality(modelRejected)},null,2))
