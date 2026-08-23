import fs from 'node:fs'
import path from 'node:path'
import { VolcImageService } from '../src/main/services/VolcImageService'
import { EbayImageGroundingService } from '../src/main/services/EbayImageGroundingService'
import { buildImageProductionTasks, buildImageTaskQualityLayers, cloneImageStylePreset, confirmedImageFactContext, imageStyleTaskPrompt, overallImageTaskQuality, summarizeImageTaskQuality, taskReviewPurpose } from '../src/shared/imageProduction'
import type { ImageProductFacts } from '../src/shared/imageProduction'

function loadEnv(file:string){if(!fs.existsSync(file))return;for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const match=line.match(/^([A-Z0-9_]+)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].trim().replace(/^(['"])(.*)\1$/,'$2')}}
loadEnv(path.resolve('.env.local'))
const apiKey=process.env.ARK_API_KEY||'',bailianKey=process.env.BAILIAN_API_KEY||''
if(!apiKey||!bailianKey)throw new Error('真实验收需要 ARK_API_KEY 与 BAILIAN_API_KEY')

const referenceDir='/Users/zyc/Desktop/ 朱云初/codex/codex学习/参考图片/1'
const referenceNames=['IMG_1172.JPG','IMG_1173.JPG','IMG_1174.JPG','IMG_1175.JPG','IMG_1180.JPG','IMG_1198.JPG','IMG_1200.JPG']
const referenceRoles=['PRIMARY','DETAIL','DETAIL','DETAIL','DETAIL','PACKAGING','DETAIL']
const references=referenceNames.map(name=>{const file=path.join(referenceDir,name),data=fs.readFileSync(file).toString('base64');return`data:image/jpeg;base64,${data}`})
const facts:ImageProductFacts={productName:'蓝色宠物训练尿垫',sku:'REAL-PAD-001',source:'人工标注真实参考图',price:'',referenceImageUrl:references[0],confirmed:true,confirmedAt:new Date().toISOString(),entries:[
  {key:'productName',label:'商品名称',value:'宠物训练尿垫',source:'USER',sourceLabel:'人工标注',status:'CONFIRMED'},
  {key:'mainColor',label:'主体颜色',value:'蓝色垫体，白色包装区域',source:'IMAGE',sourceLabel:'7张真实参考图',status:'CONFIRMED'},
  {key:'structure',label:'商品结构',value:'矩形薄片、压纹吸收层、可展开或卷叠',source:'IMAGE',sourceLabel:'7张真实参考图',status:'CONFIRMED',highRisk:true},
  {key:'packaging',label:'包装形态',value:'袋装；不同参考图存在不同规格包装，不得混用文字与数量',source:'IMAGE',sourceLabel:'7张真实参考图',status:'CONFIRMED',highRisk:true},
  {key:'useScenario',label:'使用场景',value:'宠物室内定点训练与地面防护',source:'IMAGE',sourceLabel:'参考图',status:'CONFIRMED'}
],prohibitedInferences:['不得虚构片数、尺寸、厚度、吸水倍数、品牌、认证和功效数据','不得混用不同规格包装文字']}
const style=cloneImageStylePreset('CLEAN_COMMERCE'),tasks=buildImageProductionTasks({plan:'full',productName:facts.productName,sku:facts.sku,platform:'Ozon',language:'俄语',sourceContext:confirmedImageFactContext(facts),styleLock:style,mainCount:3,detailCount:4}).filter(task=>['H01','H03','D04'].includes(task.code))
const generator=new VolcImageService(apiKey,process.env.ARK_BASE_URL||'https://ark.cn-beijing.volces.com/api/v3')
const reviewer=new EbayImageGroundingService(bailianKey,process.env.BAILIAN_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1',process.env.BAILIAN_VISION_MODEL||'qwen3.6-flash')
const outputDir=path.resolve('output/production-acceptance-phase8');fs.mkdirSync(outputDir,{recursive:true})
async function main(){
const reviewExisting=process.argv.includes('--review-existing'),previous=reviewExisting?JSON.parse(fs.readFileSync(path.join(outputDir,'report.json'),'utf8')):null,previousByCode=new Map((previous?.results||[]).map((item:any)=>[item.code,item]))
const results:any[]=[],candidateUrls:string[]=[]
for(const task of tasks){
  const started=Date.now(),referenceIndices=task.code==='H01'?[0,1,2,4]:task.code==='H03'?[0,2,3,4]:[0,1,2,3,4,6],selected=referenceIndices.map(index=>references[index])
  try{
    const previousItem=previousByCode.get(task.code) as any,generated=reviewExisting?{imageUrls:[previousItem?.candidateUrl]}:await generator.generate({model:'doubao-seedream-5-0-260128',prompt:task.prompt,referenceImageUrl:selected[0],referenceImageUrls:selected,size:'1K',count:1}),candidateUrl=generated.imageUrls[0]
    if(!candidateUrl)throw new Error('真实模型没有返回图片')
    const review=await reviewer.reviewCandidate({title:facts.productName,description:task.objective,itemSpecifics:[{name:'SKU',value:facts.sku}],purpose:taskReviewPurpose(task),candidateUrl,sourceImages:references,sourceLabels:referenceRoles,referenceIndices,protectedAttributes:['蓝色矩形薄片结构','压纹吸收层','包装规格不得混用'],verifiedFacts:['蓝色宠物训练尿垫','矩形薄片','袋装参考图存在不同规格'],shotInstruction:`${task.code} ${task.title}：${task.objective}`,styleInstruction:imageStyleTaskPrompt(style,task),targetLanguage:'俄语',baseImageNoMarketingText:true,comparisonCandidateUrls:candidateUrls})
    const layers=buildImageTaskQualityLayers(review),overall=overallImageTaskQuality(layers),response=await fetch(candidateUrl);if(!response.ok)throw new Error(`下载候选图失败 HTTP ${response.status}`)
    const contentType=response.headers.get('content-type')||'image/jpeg',extension=contentType.includes('png')?'png':'jpg',localPath=path.join(outputDir,`${task.code}.${extension}`);if(!reviewExisting)fs.writeFileSync(localPath,Buffer.from(await response.arrayBuffer()));candidateUrls.push(candidateUrl)
    results.push({code:task.code,title:task.title,status:overall,summary:summarizeImageTaskQuality(layers),layers,reviewReason:review.reason,newStructures:review.newStructures||[],missingStructures:review.missingStructures||[],geometryMismatch:Boolean(review.geometryMismatch),durationMs:Date.now()-started,estimatedCostCny:reviewExisting?0:0.22,localPath,candidateUrl})
  }catch(error){results.push({code:task.code,title:task.title,status:'ERROR',error:error instanceof Error?error.message:String(error),durationMs:Date.now()-started,estimatedCostCny:0.22})}
}
const accepted=results.filter(item=>item.status==='PASSED').length,review=results.filter(item=>item.status==='REVIEW').length,rejected=results.filter(item=>item.status==='REJECTED').length,errors=results.filter(item=>item.status==='ERROR').length
const cumulativeGenerationCostCny=reviewExisting?Number(previous?.cumulativeGenerationCostCny||previous?.estimatedGenerationCostCny||0.66):Number((tasks.length*.22).toFixed(2))
const report={mode:reviewExisting?'REAL_MODEL_REVIEW_RETRY':'REAL_PAID_MODEL',generatedAt:new Date().toISOString(),sample:{product:facts.productName,referenceCount:references.length,taskCount:tasks.length},model:'doubao-seedream-5-0-260128',visionModel:process.env.BAILIAN_VISION_MODEL||'qwen3.6-flash',accepted,review,rejected,errors,automaticPassRate:tasks.length?Math.round(accepted/tasks.length*100):0,estimatedGenerationCostCny:cumulativeGenerationCostCny,cumulativeGenerationCostCny,reviewRetryGenerationCostCny:0,results}
fs.writeFileSync(path.join(outputDir,'report.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
}
void main().catch(error=>{console.error(error);process.exit(1)})
