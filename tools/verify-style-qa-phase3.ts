import { EbayImageGroundingService } from '../src/main/services/EbayImageGroundingService'
import { cloneImageStylePreset, imageStyleTaskPrompt } from '../src/shared/imageProduction'

function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message)}
;(async()=>{
  const service=new EbayImageGroundingService('test-key','https://example.test','mock-model') as any
  const baseResult={newStructures:[],missingStructures:[],identityScore:95,structuralScore:95,factScore:95,purposeScore:95,diversityScore:100,geometryScore:95,geometryMismatch:false,status:'PASSED',reason:'mock style review'}
  const request={title:'Test Product',description:'style qa',itemSpecifics:[],purpose:'PRODUCT' as const,candidateUrl:'https://example.test/candidate.png',sourceImages:['https://example.test/source.png'],sourceLabels:['主图'],referenceIndices:[0],protectedAttributes:['结构','颜色'],verifiedFacts:['Test Product'],shotInstruction:'D06 场景覆盖',styleInstruction:imageStyleTaskPrompt(cloneImageStylePreset('LIFESTYLE'),{code:'D06',group:'DETAIL' as const})}
  service.chat=async()=>({...baseResult,styleScore:50})
  const rejected=await service.reviewCandidate(request)
  assert(rejected.status==='REJECTED','风格分低于55必须拒绝')
  assert(rejected.reason.includes('Style Lock 命中不足'),'风格拒绝必须显示原因')
  service.chat=async()=>({...baseResult,styleScore:85})
  const passed=await service.reviewCandidate(request)
  assert(passed.status==='PASSED','风格分达到75且其他项合格时必须通过')
  console.log(JSON.stringify({lowStyleScore:rejected.styleScore,lowStatus:rejected.status,highStyleScore:passed.styleScore,highStatus:passed.status,taskAwareInstruction:true},null,2))
})().catch(error=>{console.error(error);process.exit(1)})
