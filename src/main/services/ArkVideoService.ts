import ffmpeg from '@ffmpeg-installer/ffmpeg'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type {
  EbayPublishVideoArtifact,
  EbayVideoCapabilityKind,
  EbayVideoCapabilityVerificationRequest,
  EbayVideoStudioCapability,
  EbayVideoStudioConfiguration,
  EbayVideoStudioProgress,
  EbayVideoStudioProject,
  EbayVideoStudioRequest,
  EbayVideoTextPlan,
  EbayVideoTextPlanShot,
  EbayVideoVoiceProvider,
  EbayVideoVoiceStyle
} from '../../shared/contracts'

const WIDTH=1280
const HEIGHT=720
const CLIP_SECONDS=5
const TOTAL_SECONDS=15
const POLL_INTERVAL_MS=5_000
const TASK_TIMEOUT_MS=20*60_000

type ProgressCallback=(progress:EbayVideoStudioProgress)=>void

interface ArkCapabilityOptions {
  configuredVideoModels:string[]
  configuredTextModels:string[]
  ttsAppId:string
  ttsAccessToken:string
  ttsBaseUrl?:string
  ttsResourceId?:string
  ttsVoices?:Partial<Record<EbayVideoVoiceStyle,string>>
}

interface CapabilityVerificationRecord {
  id:string
  kind:EbayVideoCapabilityKind
  status:'CALLABLE'|'FAILED'
  message:string
  verifiedAt:string
  taskId?:string
  artifactPath?:string
}

const VIDEO_MODEL_CATALOG=[
  {id:'doubao-seedance-2-0-260128',label:'Seedance 2.0 · 高质量'},
  {id:'doubao-seedance-2-0-fast-260128',label:'Seedance 2.0 Fast · 日常推荐'},
  {id:'doubao-seedance-2-0-mini-260615',label:'Seedance 2.0 Mini · 经济预览'}
] as const

const TEXT_MODEL_CATALOG=[
  {id:'doubao-seed-2-1-turbo-260628',label:'Seed 2.1 Turbo · 日常推荐'},
  {id:'doubao-seed-2-1-pro-260628',label:'Seed 2.1 Pro · 高质量'},
  {id:'doubao-seed-evolving',label:'Seed Evolving · 长程任务'}
] as const

function run(command:string,args:string[]):Promise<void> {
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{stdio:['ignore','ignore','pipe']})
    let diagnostics=''
    child.stderr.on('data',chunk=>{diagnostics+=String(chunk)})
    child.once('error',reject)
    child.once('close',code=>code===0?resolve():reject(new Error(`${path.basename(command)} 执行失败（${code}）：${diagnostics.slice(-1600)}`)))
  })
}

function wait(milliseconds:number) {
  return new Promise(resolve=>setTimeout(resolve,milliseconds))
}

function safeSegment(value:string) {
  return value.replace(/[^a-zA-Z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80)||'item'
}

function mimeForExtension(extension:string) {
  if(extension==='.png')return 'image/png'
  if(extension==='.webp')return 'image/webp'
  return 'image/jpeg'
}

function extensionForContentType(contentType:string,url:string) {
  if(contentType.includes('png'))return '.png'
  if(contentType.includes('webp'))return '.webp'
  const extension=path.extname(new URL(url).pathname).toLowerCase()
  return ['.jpg','.jpeg','.png','.webp'].includes(extension)?extension:'.jpg'
}

function dataUrlParts(value:string) {
  const match=value.match(/^data:([^;,]+);base64,(.+)$/s)
  return match?{mime:match[1],buffer:Buffer.from(match[2],'base64')}:null
}

function arkVideoUrl(payload:unknown):string {
  const value=payload as Record<string,unknown>
  const content=value.content as Record<string,unknown>|undefined
  const result=value.result as Record<string,unknown>|undefined
  const candidates=[
    content?.video_url,
    (content?.video as Record<string,unknown>|undefined)?.url,
    result?.video_url,
    (result?.video as Record<string,unknown>|undefined)?.url,
    value.video_url,
    value.url
  ]
  return candidates.find(item=>typeof item==='string'&&item.startsWith('http')) as string||''
}

function taskStatus(payload:unknown) {
  const value=payload as Record<string,unknown>
  return String(value.status||value.state||'').toLowerCase()
}

function taskError(payload:unknown) {
  const value=payload as Record<string,unknown>
  const error=value.error as Record<string,unknown>|string|undefined
  if(typeof error==='string')return error
  return String(error?.message||value.message||'方舟视频任务生成失败')
}

function capabilityError(error:unknown) {
  const message=error instanceof Error?error.message:'真实调用验证失败'
  if(/has not activated the model/i.test(message))return '当前方舟账号尚未开通此模型服务，请在控制台开通后重新验证'
  if(/insufficient|balance|quota/i.test(message))return '当前方舟账号余额或调用额度不足，请处理后重新验证'
  return message.slice(0,360)
}

function normalizeCaption(value:string,maxLength=82) {
  return value.replace(/\s+/g,' ').trim().slice(0,maxLength)
}

function captionLines(request:EbayVideoStudioRequest,plan:EbayVideoTextPlan,language:'ENGLISH'|'CHINESE'='ENGLISH') {
  return [0,1,2].map(index=>normalizeCaption(
    language==='CHINESE'
      ?plan.shots[index]?.chineseCaption||request.title
      :plan.shots[index]?.englishCaption||request.storyboard[index]?.caption||request.title
  ))
}

function promptForShot(request:EbayVideoStudioRequest,shot:EbayVideoTextPlanShot|undefined,index:number) {
  const defaultMotion=['Slow controlled camera push-in on the complete product.','Slow lateral camera movement revealing verified construction details.','Gentle cinematic movement showing the product in its verified use context.'][index]
  const visual=normalizeCaption(shot?.visual||defaultMotion,420)
  const supplement=normalizeCaption(request.additionalText,300)
  return [
    `Create a realistic ecommerce product video shot using the supplied product image as the exact visual reference.`,
    `Product: ${normalizeCaption(request.title,220)}.`,
    visual,
    supplement?`Seller-approved supplement: ${supplement}.`:'',
    `Preserve the exact product identity, shape, structure, proportions, color, material, visible parts and included accessories.`,
    `Use subtle physically plausible camera motion. Keep the product sharp and fully recognizable.`,
    `Do not add people, hands, logos, text, subtitles, badges, measurements, packaging, accessories or product functions that are not visible in the reference image.`,
    `Do not deform, recolor, replace or redesign the product.`,
    `No audio and no generated on-screen text.`,
    `--resolution 720p --duration ${CLIP_SECONDS} --ratio 16:9 --watermark false`
  ].filter(Boolean).join(' ')
}

function srtTimestamp(seconds:number) {
  const milliseconds=Math.round(seconds*1000)
  const hours=Math.floor(milliseconds/3_600_000)
  const minutes=Math.floor(milliseconds%3_600_000/60_000)
  const secs=Math.floor(milliseconds%60_000/1000)
  const ms=milliseconds%1000
  return `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')},${String(ms).padStart(3,'0')}`
}

function buildSrt(lines:string[]) {
  return lines.map((line,index)=>`${index+1}\n${srtTimestamp(index*CLIP_SECONDS)} --> ${srtTimestamp((index+1)*CLIP_SECONDS-.08)}\n${line}\n`).join('\n')
}

function ffmpegFilterPath(filePath:string) {
  return filePath.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'")
}

function concatenatedJsonObjects(source:string) {
  const objects:Record<string,unknown>[]=[]
  let start=-1
  let depth=0
  let inString=false
  let escaped=false
  for(let index=0;index<source.length;index+=1){
    const character=source[index]
    if(inString){
      if(escaped)escaped=false
      else if(character==='\\')escaped=true
      else if(character==='"')inString=false
      continue
    }
    if(character==='"'){inString=true;continue}
    if(character==='{'){
      if(depth===0)start=index
      depth+=1
      continue
    }
    if(character!=='}'||depth===0)continue
    depth-=1
    if(depth!==0||start<0)continue
    try{objects.push(JSON.parse(source.slice(start,index+1)) as Record<string,unknown>)}
    catch{}
    start=-1
  }
  return objects
}

export class ArkVideoService {
  constructor(
    private readonly apiKey:string,
    private readonly baseUrl:string,
    private readonly model:string,
    private readonly rootDirectory:string,
    private readonly capabilityOptions:ArkCapabilityOptions={
      configuredVideoModels:[],
      configuredTextModels:[],
      ttsAppId:'',
      ttsAccessToken:'',
      ttsBaseUrl:'',
      ttsResourceId:'',
      ttsVoices:{}
    }
  ) {}

  configuration():EbayVideoStudioConfiguration {
    return this.buildConfiguration(new Set(),'NOT_CHECKED','尚未执行在线检测')
  }

  async checkCapabilities():Promise<EbayVideoStudioConfiguration> {
    const checkedAt=new Date().toISOString()
    if(!this.apiKey)return this.buildConfiguration(new Set(),'FAILED','火山方舟 API Key 未配置',checkedAt)
    try {
      const response=await fetch(`${this.baseUrl}/models`,{
        signal:AbortSignal.timeout(20_000),
        headers:{Authorization:`Bearer ${this.apiKey}`}
      })
      if(!response.ok)return this.buildConfiguration(new Set(),'FAILED',`模型列表检测失败（HTTP ${response.status}）`,checkedAt)
      const payload=await response.json().catch(()=>({}))
      const rows=(payload as {data?:Array<{id?:unknown}>}).data
      if(!Array.isArray(rows))return this.buildConfiguration(new Set(),'FAILED','模型列表返回格式异常',checkedAt)
      const discovered=new Set(rows.map(item=>typeof item.id==='string'?item.id:'').filter(Boolean))
      return this.buildConfiguration(discovered,'SUCCEEDED',`检测完成：发现 ${discovered.size} 个方舟模型；可发现不等于已开通`,checkedAt)
    } catch(error) {
      const message=error instanceof Error&&error.name==='TimeoutError'?'模型列表检测超时':'模型列表检测失败，请检查网络和方舟配置'
      return this.buildConfiguration(new Set(),'FAILED',message,checkedAt)
    }
  }

  async verifyCapability(request:EbayVideoCapabilityVerificationRequest):Promise<EbayVideoStudioConfiguration> {
    const startedAt=Date.now()
    let taskId:string|undefined
    let artifactPath:string|undefined
    try {
      if(request.kind==='VIDEO'){
        this.ensureConfiguredModel(request.id,'VIDEO')
        const probeDirectory=path.join(this.rootDirectory,'capability-probes',safeSegment(request.id),new Date().toISOString().replace(/[:.]/g,'-'))
        fs.mkdirSync(probeDirectory,{recursive:true})
        const sourceDirectory=path.join(probeDirectory,'source')
        fs.mkdirSync(sourceDirectory,{recursive:true})
        const imagePath=request.imageUrl
          ?await this.materializeImage(request.imageUrl,sourceDirectory,0)
          :await this.createProbeImage(sourceDirectory)
        taskId=await this.createTask(
          `Create a five-second realistic ecommerce product test shot using the supplied image as the exact reference. Add only a subtle slow camera push-in. Preserve every visible shape and color. No people, no text, no logo, no audio. --resolution 720p --duration ${CLIP_SECONDS} --ratio 16:9 --watermark false`,
          [imagePath],
          request.id
        )
        const videoUrl=await this.waitForTask(taskId)
        artifactPath=path.join(probeDirectory,'probe.mp4')
        await this.download(videoUrl,artifactPath)
        await run(ffmpeg.path,['-v','error','-i',artifactPath,'-f','null','-'])
      } else if(request.kind==='TEXT'){
        this.ensureConfiguredModel(request.id,'TEXT')
        await this.probeTextModel(request.id)
      } else if(request.id==='LOCAL_MACOS'){
        if(process.platform!=='darwin')throw new Error('当前系统不支持 macOS 本机配音')
        const probeDirectory=path.join(this.rootDirectory,'capability-probes','local-macos')
        fs.mkdirSync(probeDirectory,{recursive:true})
        artifactPath=path.join(probeDirectory,'probe.aiff')
        await run('/usr/bin/say',['-v','Tingting','-o',artifactPath,'视频配音服务验证通过'])
        await run(ffmpeg.path,['-v','error','-i',artifactPath,'-f','null','-'])
      } else if(request.id==='DOUBAO_TTS_2_0'){
        if(!this.capabilityOptions.ttsAppId||!this.capabilityOptions.ttsAccessToken)throw new Error('需要配置 VOLC_TTS_APP_ID 和 VOLC_TTS_ACCESS_TOKEN')
        const probeDirectory=path.join(this.rootDirectory,'capability-probes','doubao-tts-2-0')
        fs.mkdirSync(probeDirectory,{recursive:true})
        artifactPath=path.join(probeDirectory,'probe.mp3')
        await this.synthesizeDoubaoVoice({
          listingId:'capability-probe',title:'',description:'',chineseDescription:'',imageUrls:[],additionalImageUrls:[],
          additionalText:'',subtitleMode:'NONE',voiceMode:'CHINESE',voiceProvider:'DOUBAO_TTS_2_0',
          voiceStyle:'NATURAL_FEMALE',voiceSpeed:1,narrationText:'视频配音服务验证通过',storyboard:[]
        },'视频配音服务验证通过',artifactPath)
        await run(ffmpeg.path,['-v','error','-i',artifactPath,'-f','null','-'])
      } else {
        throw new Error(`不支持的能力：${request.id}`)
      }
      this.saveVerification({
        id:request.id,kind:request.kind,status:'CALLABLE',
        message:`真实调用验证通过（${Math.max(1,Math.round((Date.now()-startedAt)/1000))}秒）`,
        verifiedAt:new Date().toISOString(),taskId,artifactPath
      })
    } catch(error) {
      const message=capabilityError(error)
      this.saveVerification({
        id:request.id,kind:request.kind,status:'FAILED',message,
        verifiedAt:new Date().toISOString(),taskId,artifactPath
      })
    }
    return this.configuration()
  }

  private buildConfiguration(
    discovered:Set<string>,
    checkStatus:EbayVideoStudioConfiguration['checkStatus'],
    checkMessage:string,
    checkedAt?:string
  ):EbayVideoStudioConfiguration {
    const connected=Boolean(this.apiKey&&this.model)
    const configuredVideoModels=new Set([this.model,...this.capabilityOptions.configuredVideoModels].filter(Boolean))
    const configuredTextModels=new Set(this.capabilityOptions.configuredTextModels.filter(Boolean))
    const verifiedVideoModels=this.verifiedVideoModels()
    const verifications=this.verifications()
    const videoModels=VIDEO_MODEL_CATALOG.map(item=>this.modelCapability(
      item.id,item.label,'VIDEO',configuredVideoModels.has(item.id),verifications.get(`VIDEO:${item.id}`),discovered.has(item.id),verifiedVideoModels.has(item.id)
    ))
    const textModels=TEXT_MODEL_CATALOG.map(item=>this.modelCapability(
      item.id,item.label,'TEXT',configuredTextModels.has(item.id),verifications.get(`TEXT:${item.id}`),discovered.has(item.id)
    ))
    const ttsConfigured=Boolean(this.capabilityOptions.ttsAppId&&this.capabilityOptions.ttsAccessToken)
    const ttsPartiallyConfigured=Boolean(this.capabilityOptions.ttsAppId||this.capabilityOptions.ttsAccessToken)
    const localVoiceAvailable=process.platform==='darwin'
    const localVerification=verifications.get('VOICE:LOCAL_MACOS')
    const ttsVerification=verifications.get('VOICE:DOUBAO_TTS_2_0')
    const voiceProviders:EbayVideoStudioCapability[]=[
      this.voiceCapability('LOCAL_MACOS','本机配音 · macOS',localVoiceAvailable,localVoiceAvailable,localVerification,
        '本机语音已就绪，需真实合成验证','当前系统不支持 macOS 本机配音'),
      this.voiceCapability('DOUBAO_TTS_2_0','豆包语音合成 2.0',ttsConfigured,false,ttsVerification,
        'V3 云端合成已配置，需真实合成验证',
        ttsPartiallyConfigured?'语音凭证配置不完整':'需要配置 VOLC_TTS_APP_ID 和 VOLC_TTS_ACCESS_TOKEN')
    ]
    return {
      connected,
      model:this.model||'未配置',
      voiceAvailable:localVoiceAvailable,
      message:connected?'火山方舟视频生成已配置':'请配置 ARK_API_KEY 和 ARK_VIDEO_MODEL',
      videoModels,textModels,voiceProviders,checkStatus,checkMessage,checkedAt
    }
  }

  private modelCapability(
    id:string,
    label:string,
    kind:'VIDEO'|'TEXT',
    configured:boolean,
    verification:CapabilityVerificationRecord|undefined,
    discovered:boolean,
    legacyVerified=false
  ):EbayVideoStudioCapability {
    if(verification?.status==='CALLABLE')return {
      id,label,kind,status:'CALLABLE',selectable:true,configured:true,discovered,
      message:verification.message,verifiedAt:verification.verifiedAt,verificationTaskId:verification.taskId
    }
    if(legacyVerified)return {id,label,kind,status:'CALLABLE',selectable:true,configured:true,discovered,message:'已有成功视频生成记录，可调用'}
    if(verification?.status==='FAILED')return {
      id,label,kind,status:'FAILED',selectable:false,configured,discovered,
      message:verification.message,verifiedAt:verification.verifiedAt,verificationTaskId:verification.taskId
    }
    if(configured)return {
      id,label,kind,status:discovered?'PENDING_VERIFICATION':'CONFIGURED',selectable:false,configured:true,discovered,
      message:discovered?'本地配置完整且模型列表可发现，等待真实调用验证':'本地配置完整，尚未完成真实调用验证'
    }
    return {
      id,label,kind,status:'PENDING_VERIFICATION',selectable:false,configured:false,discovered,
      message:discovered?'模型列表可发现，但账号开通与计费权限尚未验证':'尚未配置且未验证'
    }
  }

  private voiceCapability(
    id:EbayVideoVoiceProvider,
    label:string,
    configured:boolean,
    discovered:boolean,
    verification:CapabilityVerificationRecord|undefined,
    configuredMessage:string,
    unconfiguredMessage:string
  ):EbayVideoStudioCapability {
    if(verification?.status==='CALLABLE'&&configured)return {
      id,label,kind:'VOICE',status:'CALLABLE',selectable:true,configured,discovered,
      message:verification.message,verifiedAt:verification.verifiedAt
    }
    if(verification?.status==='FAILED'&&configured)return {
      id,label,kind:'VOICE',status:'FAILED',selectable:false,configured,discovered,
      message:verification.message,verifiedAt:verification.verifiedAt
    }
    return {
      id,label,kind:'VOICE',status:configured?'CONFIGURED':'UNCONFIGURED',selectable:false,configured,discovered,
      message:configured?configuredMessage:unconfiguredMessage
    }
  }

  private verificationFile() {
    return path.join(this.rootDirectory,'capability-verifications.json')
  }

  private verifications() {
    const records=new Map<string,CapabilityVerificationRecord>()
    const filePath=this.verificationFile()
    if(!fs.existsSync(filePath))return records
    try {
      const rows=JSON.parse(fs.readFileSync(filePath,'utf8')) as CapabilityVerificationRecord[]
      for(const row of Array.isArray(rows)?rows:[])records.set(`${row.kind}:${row.id}`,row)
    } catch {}
    return records
  }

  private saveVerification(record:CapabilityVerificationRecord) {
    fs.mkdirSync(this.rootDirectory,{recursive:true})
    const records=this.verifications()
    records.set(`${record.kind}:${record.id}`,record)
    fs.writeFileSync(this.verificationFile(),JSON.stringify([...records.values()],null,2),'utf8')
  }

  private ensureConfiguredModel(id:string,kind:'VIDEO'|'TEXT') {
    if(!this.apiKey)throw new Error('火山方舟 API Key 未配置')
    const configured=kind==='VIDEO'
      ?new Set([this.model,...this.capabilityOptions.configuredVideoModels].filter(Boolean))
      :new Set(this.capabilityOptions.configuredTextModels.filter(Boolean))
    if(!configured.has(id))throw new Error(`${kind==='VIDEO'?'视频':'文案'}模型 ${id} 尚未配置`)
  }

  private verifiedVideoModels() {
    const verified=new Set<string>()
    if(!fs.existsSync(this.rootDirectory))return verified
    for(const listing of fs.readdirSync(this.rootDirectory,{withFileTypes:true})){
      if(!listing.isDirectory())continue
      const listingDirectory=path.join(this.rootDirectory,listing.name)
      for(const version of fs.readdirSync(listingDirectory,{withFileTypes:true})){
        if(!version.isDirectory())continue
        const metadataPath=path.join(listingDirectory,version.name,'project.json')
        if(!fs.existsSync(metadataPath))continue
        try {
          const project=JSON.parse(fs.readFileSync(metadataPath,'utf8')) as Partial<EbayVideoStudioProject>
          if(project.status==='READY'&&project.model)verified.add(project.model)
        } catch {}
      }
    }
    return verified
  }

  list(listingId:string):EbayVideoStudioProject[] {
    const listingDirectory=path.join(this.rootDirectory,safeSegment(listingId))
    if(!fs.existsSync(listingDirectory))return []
    return fs.readdirSync(listingDirectory,{withFileTypes:true})
      .filter(entry=>entry.isDirectory())
      .map(entry=>path.join(listingDirectory,entry.name,'project.json'))
      .filter(file=>fs.existsSync(file))
      .map(file=>{
        try{return JSON.parse(fs.readFileSync(file,'utf8')) as EbayVideoStudioProject}
        catch{return null}
      })
      .filter((project):project is EbayVideoStudioProject=>Boolean(project))
      .sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt))
  }

  confirm(listingId:string,projectId:string):EbayVideoStudioProject[] {
    const projects=this.list(listingId)
    const target=projects.find(project=>project.id===projectId)
    if(!target?.video||target.status!=='READY')throw new Error('只能确认已经生成完成的视频版本')
    const confirmedAt=new Date().toISOString()
    for(const project of projects){
      const projectDirectory=path.dirname(project.video?.filePath||project.clipPaths[0]||'')
      const metadataPath=project.video
        ?path.join(path.dirname(path.dirname(project.video.filePath)),'project.json')
        :projectDirectory?path.join(path.dirname(projectDirectory),'project.json'):''
      if(!metadataPath||!fs.existsSync(metadataPath))continue
      const updated:EbayVideoStudioProject={...project,confirmedAt:project.id===projectId?confirmedAt:undefined,updatedAt:project.id===projectId?confirmedAt:project.updatedAt}
      fs.writeFileSync(metadataPath,JSON.stringify(updated,null,2),'utf8')
    }
    return this.list(listingId)
  }

  async pickImages():Promise<Array<{name:string;dataUrl:string}>> {
    throw new Error('图片选择应由主进程对话框处理')
  }

  async generate(request:EbayVideoStudioRequest,onProgress:ProgressCallback):Promise<EbayVideoStudioProject> {
    if(!this.apiKey)throw new Error('未配置火山方舟 API Key')
    const videoModelId=this.resolveVideoModel(request.videoModelId)
    const textModelId=this.resolveTextModel(request.textModelId)
    const voiceProvider=this.resolveVoiceProvider(request)
    const images=[...request.imageUrls,...request.additionalImageUrls].filter(Boolean)
    if(!images.length)throw new Error('没有可用于视频生成的图片')
    const projectId=randomUUID()
    const listingDirectory=path.join(this.rootDirectory,safeSegment(request.listingId))
    const version=this.list(request.listingId).reduce((max,item)=>Math.max(max,item.version),0)+1
    const projectDirectory=path.join(listingDirectory,`${String(version).padStart(3,'0')}-${projectId}`)
    const sourceDirectory=path.join(projectDirectory,'source')
    const clipsDirectory=path.join(projectDirectory,'clips')
    const finalDirectory=path.join(projectDirectory,'final')
    fs.mkdirSync(sourceDirectory,{recursive:true})
    fs.mkdirSync(clipsDirectory,{recursive:true})
    fs.mkdirSync(finalDirectory,{recursive:true})
    const now=new Date().toISOString()
    let project:EbayVideoStudioProject={
      id:projectId,listingId:request.listingId,version,status:'GENERATING',model:videoModelId,textModelId,title:request.title,
      sourceImageCount:images.length,subtitleMode:request.subtitleMode,voiceMode:request.voiceMode,voiceProvider,
      additionalText:request.additionalText,narrationText:request.narrationText,taskIds:[],clipPaths:[],
      createdAt:now,updatedAt:now
    }
    const save=(patch:Partial<EbayVideoStudioProject>={})=>{
      project={...project,...patch,updatedAt:new Date().toISOString()}
      fs.writeFileSync(path.join(projectDirectory,'project.json'),JSON.stringify(project,null,2),'utf8')
      return project
    }
    const progress=(phase:EbayVideoStudioProgress['phase'],value:number,message:string)=>{
      onProgress({listingId:request.listingId,projectId,phase,progress:value,message})
    }
    save()
    try {
      progress('PREPARING',3,`正在使用 ${textModelId} 生成视频脚本、字幕与配音文案`)
      const textPlan=await this.generateTextPlan(request,textModelId)
      save({textPlan})
      progress('PREPARING',6,'正在保存并检查视频素材')
      const sourceImages:string[]=[]
      for(let index=0;index<images.length;index+=1)sourceImages.push(await this.materializeImage(images[index],sourceDirectory,index))
      const taskIds:string[]=[]
      const clipPaths:string[]=[]
      for(let index=0;index<3;index+=1){
        progress('SUBMITTING',10+index*24,`正在提交第 ${index+1}/3 段方舟视频`)
        const primaryImage=sourceImages[index%sourceImages.length]
        const taskImages=[primaryImage,...sourceImages.filter(image=>image!==primaryImage)].slice(0,6)
        const taskId=await this.createTask(promptForShot(request,textPlan.shots[index],index),taskImages,videoModelId)
        taskIds.push(taskId);save({taskIds:[...taskIds]})
        progress('GENERATING',12+index*25,`方舟正在生成第 ${index+1}/3 段`)
        const videoUrl=await this.waitForTask(taskId)
        progress('DOWNLOADING',28+index*25,`正在下载第 ${index+1}/3 段到本系统`)
        const clipPath=path.join(clipsDirectory,`clip-${index+1}.mp4`)
        await this.download(videoUrl,clipPath)
        clipPaths.push(clipPath);save({clipPaths:[...clipPaths]})
      }
      progress('COMPOSITING',84,'正在拼接15秒视频')
      const combinedPath=path.join(projectDirectory,'combined.mp4')
      await this.concatClips(clipPaths,combinedPath)
      const captions=captionLines(request,textPlan)
      const chineseCaptions=captionLines(request,textPlan,'CHINESE')
      let currentPath=combinedPath
      let subtitlePath:string|undefined
      if(request.subtitleMode!=='NONE'){
        progress('COMPOSITING',89,'正在生成并合成字幕')
        subtitlePath=path.join(projectDirectory,'subtitles.srt')
        const subtitleLines=request.subtitleMode==='CHINESE'
          ?chineseCaptions
          :request.subtitleMode==='BILINGUAL'
            ?captions.map((line,index)=>`${line}\n${chineseCaptions[index]}`)
            :captions
        fs.writeFileSync(subtitlePath,buildSrt(subtitleLines),'utf8')
        const subtitledPath=path.join(projectDirectory,'subtitled.mp4')
        await this.burnSubtitles(currentPath,subtitlePath,subtitledPath)
        currentPath=subtitledPath
      }
      let voicePath:string|undefined
      if(request.voiceMode!=='NONE'){
        const activeVoiceProvider=voiceProvider as EbayVideoVoiceProvider
        progress('COMPOSITING',94,'正在生成并合成配音')
        voicePath=path.join(projectDirectory,activeVoiceProvider==='DOUBAO_TTS_2_0'?'voice.mp3':'voice.aiff')
        await this.synthesizeVoice(request,voicePath,captions,activeVoiceProvider,textPlan)
        const voicedPath=path.join(projectDirectory,'voiced.mp4')
        await this.addVoice(currentPath,voicePath,voicedPath)
        currentPath=voicedPath
      }
      const fileName=`ebay-${safeSegment(request.listingId)}-video-v${version}.mp4`
      const filePath=path.join(finalDirectory,fileName)
      fs.copyFileSync(currentPath,filePath)
      const stat=fs.statSync(filePath)
      const relativePath=path.relative(this.rootDirectory,filePath).split(path.sep).join('/')
      const video:EbayPublishVideoArtifact={
        status:'READY',fileName,filePath,previewUrl:`cross-media://ebay/${encodeURIComponent(relativePath)}`,
        durationSeconds:TOTAL_SECONDS,width:WIDTH,height:HEIGHT,imageCount:sourceImages.length,sizeBytes:stat.size,
        generatedAt:new Date().toISOString(),message:`方舟视频 V${version} 已永久保存到本系统`
      }
      save({status:'READY',video,subtitlePath,voicePath})
      progress('COMPLETED',100,'15秒产品视频已生成并保存')
      return project
    } catch(error) {
      const message=error instanceof Error?error.message:'火山方舟视频生成失败'
      save({status:'FAILED',error:message})
      progress('FAILED',100,message)
      throw error
    }
  }

  private resolveVideoModel(requestedModel?:string) {
    const videoModelId=requestedModel?.trim()||this.model
    if(!videoModelId)throw new Error('未配置火山方舟视频模型 ID')
    const configuredModels=new Set([this.model,...this.capabilityOptions.configuredVideoModels].filter(Boolean))
    if(!configuredModels.has(videoModelId))throw new Error(`视频模型 ${videoModelId} 尚未配置，已阻止提交方舟任务`)
    const verified=this.verifications().get(`VIDEO:${videoModelId}`)
    if(verified?.status!=='CALLABLE'&&!this.verifiedVideoModels().has(videoModelId))throw new Error(`视频模型 ${videoModelId} 尚未通过真实生成验证，已阻止提交`)
    return videoModelId
  }

  private resolveTextModel(requestedModel?:string) {
    const textModelId=requestedModel?.trim()
    if(!textModelId)throw new Error('请选择已验证可调用的字幕与文案模型')
    const configuredModels=new Set(this.capabilityOptions.configuredTextModels.filter(Boolean))
    if(!configuredModels.has(textModelId))throw new Error(`文案模型 ${textModelId} 尚未配置，已阻止生成`)
    if(this.verifications().get(`TEXT:${textModelId}`)?.status!=='CALLABLE')throw new Error(`文案模型 ${textModelId} 尚未通过真实推理验证，已阻止生成`)
    return textModelId
  }

  private resolveVoiceProvider(request:EbayVideoStudioRequest):EbayVideoVoiceProvider|undefined {
    if(request.voiceMode==='NONE')return undefined
    const provider=request.voiceProvider||'LOCAL_MACOS'
    if(provider==='LOCAL_MACOS'){
      if(process.platform!=='darwin')throw new Error('当前系统不支持 macOS 本机配音，请选择豆包云端配音')
      if(this.verifications().get('VOICE:LOCAL_MACOS')?.status!=='CALLABLE')throw new Error('macOS 本机配音尚未通过真实合成验证')
      return provider
    }
    if(provider==='DOUBAO_TTS_2_0'){
      if(!this.capabilityOptions.ttsAppId||!this.capabilityOptions.ttsAccessToken){
        throw new Error('豆包语音合成 2.0 凭证未配置完整，已阻止生成视频')
      }
      if(this.verifications().get('VOICE:DOUBAO_TTS_2_0')?.status!=='CALLABLE')throw new Error('豆包语音合成 2.0 尚未通过真实合成验证')
      return provider
    }
    throw new Error('不支持的配音服务，已阻止生成视频')
  }

  private async materializeImage(value:string,directory:string,index:number) {
    const data=dataUrlParts(value)
    if(data){
      const extension=data.mime.includes('png')?'.png':data.mime.includes('webp')?'.webp':'.jpg'
      const filePath=path.join(directory,`source-${index+1}${extension}`)
      fs.writeFileSync(filePath,data.buffer)
      return filePath
    }
    if(value.startsWith('cross-media://local/')){
      const filePath=decodeURIComponent(new URL(value).pathname.slice(1))
      if(!fs.existsSync(filePath))throw new Error(`视频素材 ${index+1} 的本地文件不存在`)
      const target=path.join(directory,`source-${index+1}${path.extname(filePath)||'.jpg'}`)
      fs.copyFileSync(filePath,target)
      return target
    }
    const response=await fetch(value,{signal:AbortSignal.timeout(30_000),headers:{'User-Agent':'Mozilla/5.0'}})
    if(!response.ok)throw new Error(`视频素材 ${index+1} 下载失败：HTTP ${response.status}`)
    const extension=extensionForContentType(response.headers.get('content-type')||'',value)
    const filePath=path.join(directory,`source-${index+1}${extension}`)
    fs.writeFileSync(filePath,Buffer.from(await response.arrayBuffer()))
    return filePath
  }

  private async createProbeImage(directory:string) {
    const source=path.join(directory,'probe-source.ppm')
    const output=path.join(directory,'probe.png')
    const pixels=Buffer.alloc(WIDTH*HEIGHT*3)
    for(let y=0;y<HEIGHT;y+=1){
      for(let x=0;x<WIDTH;x+=1){
        const offset=(y*WIDTH+x)*3
        const inside=x>390&&x<890&&y>110&&y<610
        const accent=Math.hypot(x-640,y-300)<92
        const color=accent?[17,167,158]:inside?[255,255,255]:[232,247,245]
        pixels[offset]=color[0];pixels[offset+1]=color[1];pixels[offset+2]=color[2]
      }
    }
    fs.writeFileSync(source,Buffer.concat([Buffer.from(`P6\n${WIDTH} ${HEIGHT}\n255\n`),pixels]))
    await run(ffmpeg.path,['-i',source,'-frames:v','1','-y',output])
    return output
  }

  private async probeTextModel(modelId:string) {
    await this.generateTextPlan({
      listingId:'capability-probe',videoModelId:this.model,textModelId:modelId,
      title:'UV-resistant sports jersey display frame',
      description:'A wall-mounted jersey display frame with a clear acrylic door that helps keep dust away.',
      chineseDescription:'壁挂式球衣展示框，透明亚克力门有助于隔绝灰尘。',
      imageUrls:[],additionalImageUrls:[],additionalText:'',subtitleMode:'BILINGUAL',
      voiceMode:'NONE',voiceStyle:'NATURAL_FEMALE',voiceSpeed:1,narrationText:'',
      storyboard:[
        {order:1,durationSeconds:5,visual:'Show the complete display frame.',caption:'Display your jersey clearly.',sourceRequirement:'Complete product image'},
        {order:2,durationSeconds:5,visual:'Show the clear acrylic door.',caption:'Helps keep dust away.',sourceRequirement:'Door detail image'},
        {order:3,durationSeconds:5,visual:'Show the frame mounted on a wall.',caption:'Wall-mounted display.',sourceRequirement:'Mounted product image'}
      ]
    },modelId)
  }

  private async generateTextPlan(request:EbayVideoStudioRequest,modelId:string):Promise<EbayVideoTextPlan> {
    const sourceStoryboard=request.storyboard.slice(0,3).map((shot,index)=>({
      order:index+1,visual:shot.visual,caption:shot.caption,sourceRequirement:shot.sourceRequirement
    }))
    const prompt=[
      'Create a fact-grounded 15-second ecommerce product video plan split into exactly 3 shots of 5 seconds.',
      'Use only facts found in the supplied title, descriptions, storyboard and seller supplement. Do not invent dimensions, materials, accessories, certifications or performance claims.',
      'Return JSON only with this exact shape:',
      '{"shots":[{"visual":"English visual direction","englishCaption":"max 12 words","chineseCaption":"max 22 Chinese characters","englishNarration":"short English phrase","chineseNarration":"short Chinese phrase"}],"englishNarration":"28-35 English words total","chineseNarration":"45-60 Chinese characters total"}',
      `Title: ${request.title}`,
      `English description: ${request.description}`,
      `Chinese reference: ${request.chineseDescription}`,
      `Confirmed storyboard: ${JSON.stringify(sourceStoryboard)}`,
      request.additionalText?`Seller supplement: ${request.additionalText}`:''
    ].filter(Boolean).join('\n')
    const content=await this.callTextModel(modelId,[
      {role:'system',content:'You are an ecommerce video copywriter. Keep all claims strictly grounded. Return valid JSON only.'},
      {role:'user',content:prompt}
    ],1500)
    const parsed=this.parseJsonObject(content) as Partial<EbayVideoTextPlan>
    if(!Array.isArray(parsed.shots)||parsed.shots.length!==3)throw new Error('文案模型未返回3段有效视频脚本')
    const shots=parsed.shots.map((raw,index)=>{
      const shot=raw as Partial<EbayVideoTextPlanShot>
      const values=[shot.visual,shot.englishCaption,shot.chineseCaption,shot.englishNarration,shot.chineseNarration]
      if(values.some(value=>typeof value!=='string'||!value.trim()))throw new Error(`文案模型第 ${index+1} 段字段不完整`)
      return {
        visual:normalizeCaption(shot.visual!,420),
        englishCaption:normalizeCaption(shot.englishCaption!,82),
        chineseCaption:normalizeCaption(shot.chineseCaption!,44),
        englishNarration:normalizeCaption(shot.englishNarration!,120),
        chineseNarration:normalizeCaption(shot.chineseNarration!,70)
      }
    })
    return {
      model:modelId,shots,
      englishNarration:normalizeCaption(String(parsed.englishNarration||shots.map(item=>item.englishNarration).join('. ')),240),
      chineseNarration:normalizeCaption(String(parsed.chineseNarration||shots.map(item=>item.chineseNarration).join('')),90),
      generatedAt:new Date().toISOString()
    }
  }

  private async callTextModel(modelId:string,messages:Array<{role:'system'|'user';content:string}>,maxTokens:number) {
    const response=await fetch(`${this.baseUrl}/chat/completions`,{
      method:'POST',signal:AbortSignal.timeout(120_000),
      headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({
        model:modelId,messages,response_format:{type:'json_object'},thinking:{type:'disabled'},
        temperature:.1,max_tokens:maxTokens
      })
    })
    const payload=await response.json().catch(()=>({}))
    if(!response.ok)throw new Error(`文案模型调用失败（HTTP ${response.status}）：${taskError(payload)}`)
    const choice=(payload as {choices?:Array<{message?:{content?:unknown}}>}).choices?.[0]
    const content=choice?.message?.content
    if(typeof content!=='string'||!content.trim())throw new Error('文案模型未返回有效内容')
    return content
  }

  private parseJsonObject(content:string):Record<string,unknown> {
    const cleaned=content.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'')
    try{return JSON.parse(cleaned) as Record<string,unknown>}
    catch {
      const start=cleaned.indexOf('{')
      const end=cleaned.lastIndexOf('}')
      if(start>=0&&end>start)return JSON.parse(cleaned.slice(start,end+1)) as Record<string,unknown>
      throw new Error('文案模型返回的 JSON 无法解析')
    }
  }

  private async createTask(prompt:string,imagePaths:string[],videoModelId:string) {
    const imageContent=imagePaths.map(imagePath=>{
      const extension=path.extname(imagePath).toLowerCase()
      const imageData=`data:${mimeForExtension(extension)};base64,${fs.readFileSync(imagePath).toString('base64')}`
      return {type:'image_url',image_url:{url:imageData}}
    })
    const response=await fetch(`${this.baseUrl}/contents/generations/tasks`,{
      method:'POST',signal:AbortSignal.timeout(60_000),
      headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},
      body:JSON.stringify({model:videoModelId,content:[{type:'text',text:prompt},...imageContent]})
    })
    const payload=await response.json().catch(()=>({}))
    if(!response.ok)throw new Error(`方舟任务提交失败（HTTP ${response.status}）：${taskError(payload)}`)
    const taskId=String((payload as Record<string,unknown>).id||(payload as Record<string,unknown>).task_id||'')
    if(!taskId)throw new Error('方舟任务未返回任务ID')
    return taskId
  }

  private async waitForTask(taskId:string) {
    const started=Date.now()
    while(Date.now()-started<TASK_TIMEOUT_MS){
      const response=await fetch(`${this.baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`,{
        signal:AbortSignal.timeout(30_000),headers:{Authorization:`Bearer ${this.apiKey}`}
      })
      const payload=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(`方舟任务查询失败（HTTP ${response.status}）：${taskError(payload)}`)
      const status=taskStatus(payload)
      const url=arkVideoUrl(payload)
      if(url)return url
      if(['failed','error','cancelled','canceled','expired'].includes(status))throw new Error(taskError(payload))
      await wait(POLL_INTERVAL_MS)
    }
    throw new Error('方舟视频生成超过20分钟仍未完成，请稍后重试')
  }

  private async download(url:string,filePath:string) {
    const response=await fetch(url,{signal:AbortSignal.timeout(120_000)})
    if(!response.ok)throw new Error(`方舟视频下载失败：HTTP ${response.status}`)
    fs.writeFileSync(filePath,Buffer.from(await response.arrayBuffer()))
    if(fs.statSync(filePath).size<10_000)throw new Error('方舟返回的视频文件异常')
  }

  private async concatClips(clips:string[],output:string) {
    const args:string[]=[]
    clips.forEach(clip=>args.push('-i',clip))
    const filters=clips.map((_,index)=>`[${index}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30,trim=duration=${CLIP_SECONDS},setpts=PTS-STARTPTS[v${index}]`)
    filters.push(`${clips.map((_,index)=>`[v${index}]`).join('')}concat=n=${clips.length}:v=1:a=0[outv]`)
    args.push('-filter_complex',filters.join(';'),'-map','[outv]','-t',String(TOTAL_SECONDS),'-an','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart','-y',output)
    await run(ffmpeg.path,args)
  }

  private async burnSubtitles(input:string,subtitlePath:string,output:string) {
    const style="FontName=Arial,FontSize=22,PrimaryColour=&H00FFFFFF,OutlineColour=&H70000000,BorderStyle=3,Outline=1,Shadow=0,Alignment=2,MarginV=42"
    await run(ffmpeg.path,['-i',input,'-vf',`subtitles='${ffmpegFilterPath(subtitlePath)}':force_style='${style}'`,'-c:v','libx264','-preset','medium','-crf','20','-an','-movflags','+faststart','-y',output])
  }

  private async synthesizeVoice(
    request:EbayVideoStudioRequest,
    output:string,
    captions:string[],
    provider:EbayVideoVoiceProvider,
    plan:EbayVideoTextPlan
  ) {
    const fallback=captions.join('. ')
    const generated=request.voiceMode==='CHINESE'?plan.chineseNarration:plan.englishNarration
    const raw=(request.narrationText||generated||fallback).replace(/\s+/g,' ').trim()
    const text=request.voiceMode==='CHINESE'?raw.slice(0,70):raw.split(' ').slice(0,38).join(' ')
    if(!text)throw new Error('配音文稿为空，无法合成语音')
    if(provider==='DOUBAO_TTS_2_0'){
      await this.synthesizeDoubaoVoice(request,text,output)
      return
    }
    const female=request.voiceStyle.includes('FEMALE')
    const professional=request.voiceStyle.startsWith('PROFESSIONAL')
    const voice=request.voiceMode==='CHINESE'
      ?female?'Tingting':'Eddy (中文（中国大陆）)'
      :professional
        ?female?'Samantha':'Daniel'
        :female?'Sandy (英语（美国）)':'Eddy (英语（美国）)'
    const rate=Math.max(120,Math.min(230,Math.round(165*request.voiceSpeed)))
    await run('/usr/bin/say',['-v',voice,'-r',String(rate),'-o',output,text])
  }

  private async synthesizeDoubaoVoice(request:EbayVideoStudioRequest,text:string,output:string) {
    const female=request.voiceStyle.includes('FEMALE')
    const defaultVoice=female?'zh_female_vv_uranus_bigtts':'zh_male_dayi_saturn_bigtts'
    const speaker=this.capabilityOptions.ttsVoices?.[request.voiceStyle]||defaultVoice
    const endpoint=(this.capabilityOptions.ttsBaseUrl||'https://openspeech.bytedance.com/api/v3/tts/unidirectional').replace(/\/+$/,'')
    const requestId=randomUUID()
    const response=await fetch(endpoint,{
      method:'POST',
      signal:AbortSignal.timeout(60_000),
      headers:{
        'Content-Type':'application/json',
        'X-Api-App-Id':this.capabilityOptions.ttsAppId,
        'X-Api-Access-Key':this.capabilityOptions.ttsAccessToken,
        'X-Api-Resource-Id':this.capabilityOptions.ttsResourceId||'seed-tts-2.0',
        'X-Api-Request-Id':requestId
      },
      body:JSON.stringify({
        user:{uid:`ebay-video-${safeSegment(request.listingId)}`},
        req_params:{
          text,
          speaker,
          audio_params:{
            format:'mp3',
            sample_rate:24_000,
            speech_rate:Math.round((Math.max(.5,Math.min(2,request.voiceSpeed))-1)*100)
          }
        }
      })
    })
    const responseText=await response.text()
    if(!response.ok)throw new Error(`豆包配音请求失败（HTTP ${response.status}）`)
    const payloads=concatenatedJsonObjects(responseText)
    const failure=payloads.find(item=>Number(item.code)!==0&&Number(item.code)!==20_000_000)
    if(failure)throw new Error(`豆包配音生成失败：${String(failure.message||failure.code||'未知错误')}`)
    const audio=payloads
      .filter(item=>Number(item.code)===0&&typeof item.data==='string')
      .map(item=>Buffer.from(item.data as string,'base64'))
    if(!audio.length)throw new Error('豆包配音未返回有效音频')
    fs.writeFileSync(output,Buffer.concat(audio))
    if(fs.statSync(output).size<1_000)throw new Error('豆包配音返回的音频文件异常')
  }

  private async addVoice(input:string,voicePath:string,output:string) {
    await run(ffmpeg.path,['-i',input,'-i',voicePath,'-filter_complex','[1:a]volume=1.0,apad[a]','-map','0:v','-map','[a]','-t',String(TOTAL_SECONDS),'-c:v','copy','-c:a','aac','-b:a','160k','-movflags','+faststart','-y',output])
  }
}
