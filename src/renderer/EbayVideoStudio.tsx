import { useEffect, useMemo, useState } from 'react'
import type {
  EbayVideoCapabilityStatus,
  EbayVideoStudioConfiguration,
  EbayVideoStudioProgress,
  EbayVideoStudioProject,
  EbayVideoStudioRequest,
  EbayVideoStoryboardShot,
  EbayVideoSubtitleMode,
  EbayVideoVoiceMode,
  EbayVideoVoiceProvider,
  EbayVideoVoiceStyle
} from '../shared/contracts'
import './ebay-video-studio.css'

interface EbayVideoStudioProps {
  listingId:string
  title:string
  description:string
  chineseDescription:string
  imageUrls:string[]
  storyboard:EbayVideoStoryboardShot[]
  imagesReady:boolean
}

function readableError(reason:unknown,fallback:string) {
  return reason instanceof Error&&reason.message?reason.message:fallback
}

function defaultNarration(title:string,storyboard:EbayVideoStoryboardShot[]) {
  const captions=storyboard.slice(0,3).map(item=>item.caption).filter(Boolean)
  return (captions.length?captions.join('. '):title).replace(/\s+/g,' ').trim().slice(0,220)
}

function phaseLabel(progress:EbayVideoStudioProgress|null) {
  if(!progress)return ''
  return progress.phase==='PREPARING'?'准备素材'
    :progress.phase==='SUBMITTING'?'提交方舟任务'
      :progress.phase==='GENERATING'?'方舟生成中'
        :progress.phase==='DOWNLOADING'?'下载到本系统'
          :progress.phase==='COMPOSITING'?'合成视频'
            :progress.phase==='COMPLETED'?'生成完成':'生成失败'
}

function capabilityStatusLabel(status:EbayVideoCapabilityStatus) {
  return status==='CALLABLE'?'可调用'
    :status==='CONFIGURED'?'已配置'
      :status==='PENDING_VERIFICATION'?'待验证'
        :status==='VERIFYING'?'验证中'
          :status==='FAILED'?'验证失败':'未配置'
}

export default function EbayVideoStudio({listingId,title,description,chineseDescription,imageUrls,storyboard,imagesReady}:EbayVideoStudioProps) {
  const [configuration,setConfiguration]=useState<EbayVideoStudioConfiguration|null>(null)
  const [projects,setProjects]=useState<EbayVideoStudioProject[]>([])
  const [additionalImages,setAdditionalImages]=useState<Array<{name:string;dataUrl:string}>>([])
  const [additionalText,setAdditionalText]=useState('')
  const [subtitleMode,setSubtitleMode]=useState<EbayVideoSubtitleMode>('ENGLISH')
  const [videoModelId,setVideoModelId]=useState('')
  const [textModelId,setTextModelId]=useState('')
  const [voiceMode,setVoiceMode]=useState<EbayVideoVoiceMode>('NONE')
  const [voiceProvider,setVoiceProvider]=useState<EbayVideoVoiceProvider>('LOCAL_MACOS')
  const [voiceStyle,setVoiceStyle]=useState<EbayVideoVoiceStyle>('NATURAL_FEMALE')
  const [voiceSpeed,setVoiceSpeed]=useState(1)
  const [narrationText,setNarrationText]=useState(()=>defaultNarration(title,storyboard))
  const [progress,setProgress]=useState<EbayVideoStudioProgress|null>(null)
  const [generating,setGenerating]=useState(false)
  const [checkingCapabilities,setCheckingCapabilities]=useState(false)
  const [verifyingCapabilityId,setVerifyingCapabilityId]=useState('')
  const [error,setError]=useState('')
  const [selectedProjectId,setSelectedProjectId]=useState('')

  useEffect(()=>{
    setNarrationText(defaultNarration(title,storyboard))
    setAdditionalImages([])
    setAdditionalText('')
    setProgress(null)
    setError('')
    setSelectedProjectId('')
  },[listingId])

  useEffect(()=>{
    let cancelled=false
    void Promise.all([
      window.desktop.ebay.videoStudioConfiguration(),
      window.desktop.ebay.videoStudioProjects(listingId)
    ]).then(([nextConfiguration,nextProjects])=>{
      if(cancelled)return
      setConfiguration(nextConfiguration)
      setProjects(nextProjects)
      setSelectedProjectId(current=>current||nextProjects.find(item=>item.status==='READY')?.id||'')
    }).catch(reason=>{if(!cancelled)setError(readableError(reason,'视频工作台读取失败'))})
    return()=>{cancelled=true}
  },[listingId])

  useEffect(()=>window.desktop.ebay.onVideoStudioProgress(next=>{
    if(next.listingId!==listingId)return
    setProgress(next)
  }),[listingId])

  useEffect(()=>{
    if(!configuration)return
    setVideoModelId(current=>{
      if(configuration.videoModels.some(item=>item.id===current&&item.selectable))return current
      const configuredDefault=configuration.videoModels.find(item=>item.id===configuration.model&&item.selectable)
      return configuredDefault?.id||configuration.videoModels.find(item=>item.selectable)?.id||''
    })
    setTextModelId(current=>{
      if(configuration.textModels.some(item=>item.id===current&&item.selectable))return current
      return configuration.textModels.find(item=>item.selectable)?.id||''
    })
    setVoiceProvider(current=>{
      if(configuration.voiceProviders.some(item=>item.id===current&&item.selectable))return current
      return configuration.voiceProviders.find(item=>item.selectable)?.id as EbayVideoVoiceProvider||'LOCAL_MACOS'
    })
  },[configuration])

  const selectedProject=projects.find(item=>item.id===selectedProjectId)||projects.find(item=>item.status==='READY')
  const sourceImages=useMemo(()=>imageUrls.slice(0,6),[imageUrls])
  const selectedVideoModel=configuration?.videoModels.find(item=>item.id===videoModelId)
  const selectedTextModel=configuration?.textModels.find(item=>item.id===textModelId)
  const selectedVoiceProvider=configuration?.voiceProviders.find(item=>item.id===voiceProvider)
  const voiceReady=voiceMode==='NONE'||Boolean(selectedVoiceProvider?.selectable)
  const canGenerate=Boolean(configuration?.connected&&selectedVideoModel?.selectable&&selectedTextModel?.selectable&&voiceReady&&imagesReady&&sourceImages.length&&title.trim()&&description.trim()&&!generating)
  const videoModelLabel=(modelId:string|undefined)=>configuration?.videoModels.find(item=>item.id===modelId)?.label||modelId||'旧版本未记录模型'
  const voiceProviderLabel=(provider:EbayVideoVoiceProvider|undefined)=>configuration?.voiceProviders.find(item=>item.id===(provider||'LOCAL_MACOS'))?.label||provider||'本机配音 · macOS'

  const pickImages=async()=>{
    setError('')
    try{
      const picked=await window.desktop.ebay.pickVideoStudioImages()
      setAdditionalImages(current=>[...current,...picked].slice(0,6))
    }catch(reason){setError(readableError(reason,'补充图片读取失败'))}
  }

  const generate=async()=>{
    if(!canGenerate)return
    const request:EbayVideoStudioRequest={
      listingId,videoModelId,textModelId,title,description,chineseDescription,imageUrls:sourceImages,
      additionalImageUrls:additionalImages.map(item=>item.dataUrl),
      additionalText:additionalText.trim(),subtitleMode,voiceMode,voiceProvider,voiceStyle,voiceSpeed,
      narrationText:narrationText.trim(),storyboard
    }
    setGenerating(true);setError('')
    setProgress({listingId,projectId:'',phase:'PREPARING',progress:1,message:'正在建立视频项目'})
    try{
      const project=await window.desktop.ebay.generateVideoStudio(request)
      const nextProjects=await window.desktop.ebay.videoStudioProjects(listingId)
      setProjects(nextProjects)
      setSelectedProjectId(project.id)
    }catch(reason){setError(readableError(reason,'15秒产品视频生成失败'))}
    finally{setGenerating(false)}
  }

  const confirmProject=async()=>{
    if(!selectedProject?.video)return
    setError('')
    try{
      const nextProjects=await window.desktop.ebay.confirmVideoStudioProject(listingId,selectedProject.id)
      setProjects(nextProjects)
    }catch(reason){setError(readableError(reason,'确认视频版本失败'))}
  }

  const checkCapabilities=async()=>{
    setCheckingCapabilities(true)
    setError('')
    try{
      setConfiguration(await window.desktop.ebay.checkVideoStudioCapabilities())
    }catch(reason){setError(readableError(reason,'模型能力检测失败'))}
    finally{setCheckingCapabilities(false)}
  }

  const verifyCapability=async(item:EbayVideoStudioConfiguration['videoModels'][number])=>{
    if(!item.configured)return
    if(item.kind==='VIDEO'&&!window.confirm(`将真实调用 ${item.label} 生成一段5秒验证视频，会产生方舟费用。是否继续？`))return
    setVerifyingCapabilityId(`${item.kind}:${item.id}`)
    setError('')
    try{
      setConfiguration(await window.desktop.ebay.verifyVideoStudioCapability({
        id:item.id,kind:item.kind,imageUrl:item.kind==='VIDEO'?sourceImages[0]:undefined
      }))
    }catch(reason){setError(readableError(reason,'真实调用验证失败'))}
    finally{setVerifyingCapabilityId('')}
  }

  return <div className="ebay-video-studio">
    <header className="ebay-video-studio-heading">
      <div><b>15秒产品视频生成</b><small>自动读取已确认的商品描述和图片优化最终稿，在本窗口生成、预览并永久保存。</small></div>
      <span className={configuration?.connected?'connected':'disconnected'}><i/>{configuration?.connected?`方舟凭证已配置 · ${configuration.model}`:'火山方舟未配置'}</span>
    </header>

    {!imagesReady&&<div className="ebay-video-studio-warning">请先在03图片优化中确认最终图片并通过检查，视频只能使用已确认的商品素材。</div>}
    {configuration&&!configuration.connected&&<div className="ebay-video-studio-warning">{configuration.message}</div>}
    {error&&<div className="ebay-video-studio-error">{error}</div>}

    {configuration&&<section className="ebay-video-capabilities">
      <header>
        <div><b>模型与服务状态</b><small>“模型列表可发现”不等于账号已开通；未配置或待验证的能力不会进入可选项。</small></div>
        <button type="button" disabled={checkingCapabilities} onClick={()=>void checkCapabilities()}>{checkingCapabilities?'检测中…':'检测可用性'}</button>
      </header>
      <div className="ebay-video-capability-grid">
        {[
          {title:'视频生成',items:configuration.videoModels},
          {title:'字幕与文案',items:configuration.textModels},
          {title:'配音服务',items:configuration.voiceProviders}
        ].map(group=><article key={group.title}>
          <h4>{group.title}</h4>
          <div>{group.items.map(item=><div className={`capability-row ${item.status.toLowerCase()}`} key={item.id}>
            <span><b>{item.label}</b><small>{item.message}</small></span>
            <div className="capability-actions">
              <em>{verifyingCapabilityId===`${item.kind}:${item.id}`?'验证中':capabilityStatusLabel(item.status)}</em>
              {item.configured&&item.status!=='CALLABLE'&&<button type="button" disabled={Boolean(verifyingCapabilityId)} onClick={()=>void verifyCapability(item)}>真实验证</button>}
            </div>
          </div>)}</div>
        </article>)}
      </div>
      <footer className={configuration.checkStatus.toLowerCase()}>
        <span>{configuration.checkMessage}</span>
        {configuration.checkedAt&&<time>{new Date(configuration.checkedAt).toLocaleString('zh-CN')}</time>}
      </footer>
    </section>}

    <section className="ebay-video-materials">
      <header><div><b>视频素材</b><small>默认读取图片优化最终稿；补充图片只属于当前视频，不会修改03图片结果。</small></div><button type="button" onClick={()=>void pickImages()}>＋ 添加图片</button></header>
      <div className="ebay-video-material-grid">
        {sourceImages.map((url,index)=><figure key={`source-${index}`}><img src={url} alt={`优化图片 ${index+1}`}/><figcaption>{index===0?'优化主图':index===1?'优化细节图':index===2?'痛点解决图':index===3?'优化场景图':`优化图片 ${index+1}`}</figcaption></figure>)}
        {additionalImages.map((item,index)=><figure className="additional" key={`${item.name}-${index}`}><button type="button" aria-label="移除补充图片" onClick={()=>setAdditionalImages(current=>current.filter((_,itemIndex)=>itemIndex!==index))}>×</button><img src={item.dataUrl} alt={item.name}/><figcaption>补充 · {item.name}</figcaption></figure>)}
      </div>
    </section>

    <section className="ebay-video-script">
      <header><div><b>15秒视频脚本</b><small>系统已根据前面的描述优化和图片结果生成三段内容，可补充但不能改变商品事实。</small></div><span>3段 × 5秒</span></header>
      <div className="ebay-video-shot-grid">{[0,1,2].map(index=>{const shot=storyboard[index];return <article key={index}><em>{index+1}</em><div><b>{index===0?'产品全貌':index===1?'核心细节':'应用场景'} · 5秒</b><p>{shot?.visual||'使用已确认图片进行轻微、真实的镜头运动。'}</p><small>字幕：{shot?.caption||title}</small></div></article>})}</div>
      <label>补充视频文字或要求（可选）<textarea value={additionalText} onChange={event=>setAdditionalText(event.target.value)} maxLength={300} placeholder="例如：第三段重点展示墙面安装效果。不得填写未经核实的功能、材质或配件。"/><small>{additionalText.length}/300</small></label>
    </section>

    <section className="ebay-video-output-settings">
      <header><div><b>输出设置</b><small>最终固定生成一条15秒、16:9、1280×720的MP4。</small></div><span>15秒 · 16:9 · 720p</span></header>
      <div className="ebay-video-setting-grid">
        <label>视频模型<select value={videoModelId} onChange={event=>setVideoModelId(event.target.value)}>{configuration?.videoModels.map(item=><option key={item.id} value={item.id} disabled={!item.selectable}>{item.label}{item.selectable?'':`（${capabilityStatusLabel(item.status)}）`}</option>)}</select><small>{selectedVideoModel?.message||'当前没有已配置且可选择的视频模型。'}</small></label>
        <label>字幕与文案模型<select value={textModelId} onChange={event=>setTextModelId(event.target.value)}>{configuration?.textModels.map(item=><option key={item.id} value={item.id} disabled={!item.selectable}>{item.label}{item.selectable?'':`（${capabilityStatusLabel(item.status)}）`}</option>)}</select><small>{selectedTextModel?.message||'当前没有通过真实推理验证的文案模型。'}</small></label>
        <label>字幕<select value={subtitleMode} onChange={event=>setSubtitleMode(event.target.value as EbayVideoSubtitleMode)}><option value="NONE">不添加字幕</option><option value="ENGLISH">英文字幕（推荐）</option><option value="CHINESE">中文字幕</option><option value="BILINGUAL">中英双语字幕</option></select><small>字幕由本地后期合成，避免模型生成乱码。</small></label>
        <label>配音<select value={voiceMode} onChange={event=>setVoiceMode(event.target.value as EbayVideoVoiceMode)}><option value="NONE">无配音（默认）</option><option value="ENGLISH">英文配音</option><option value="CHINESE">中文配音</option></select><small>选择语言后可使用本机配音或豆包语音合成 2.0。</small></label>
        {voiceMode!=='NONE'&&<><label>配音服务<select value={voiceProvider} onChange={event=>setVoiceProvider(event.target.value as EbayVideoVoiceProvider)}>{configuration?.voiceProviders.map(item=><option key={item.id} value={item.id} disabled={!item.selectable}>{item.label}{item.selectable?'':`（${capabilityStatusLabel(item.status)}）`}</option>)}</select><small>{selectedVoiceProvider?.message||'当前没有可用的配音服务。'}</small></label><label>音色<select value={voiceStyle} onChange={event=>setVoiceStyle(event.target.value as EbayVideoVoiceStyle)}><option value="NATURAL_FEMALE">自然女声</option><option value="NATURAL_MALE">自然男声</option><option value="PROFESSIONAL_FEMALE">专业女声</option><option value="PROFESSIONAL_MALE">专业男声</option></select><small>豆包专业音色未单独配置时复用相同性别默认音色。</small></label><label>语速<select value={voiceSpeed} onChange={event=>setVoiceSpeed(Number(event.target.value))}><option value={.85}>慢</option><option value={1}>标准</option><option value={1.15}>快</option></select></label></>}
      </div>
      {voiceMode!=='NONE'&&<label className="ebay-video-narration">配音文稿<textarea value={narrationText} onChange={event=>setNarrationText(event.target.value)} maxLength={voiceMode==='CHINESE'?70:220}/><small>{voiceMode==='CHINESE'?'建议45–60字':'建议28–35个英文单词'}，系统会将配音控制在15秒内。</small></label>}
    </section>

    {progress&&<section className={`ebay-video-progress ${progress.phase.toLowerCase()}`}><header><b>{phaseLabel(progress)}</b><span>{progress.progress}%</span></header><div><i style={{width:`${progress.progress}%`}}/></div><p>{progress.message}</p></section>}

    <button className="primary ebay-video-generate-button" disabled={!canGenerate} onClick={()=>void generate()}>{generating?'正在生成15秒视频…':!imagesReady?'等待图片优化完成':!configuration?.connected?'火山方舟未配置':!selectedVideoModel?.selectable?'没有可用视频模型':!selectedTextModel?.selectable?'没有可用文案模型':!voiceReady?'没有可用配音服务':'生成15秒产品视频'}</button>

    {selectedProject?.video&&<section className="ebay-video-result">
      <header><div><b>最终视频 · V{selectedProject.version}</b><small>已下载并永久保存到本系统视频库</small></div><span>✓ 已完成</span></header>
      <video src={selectedProject.video.previewUrl} controls preload="metadata"/>
      <div className="ebay-video-result-meta"><span>{videoModelLabel(selectedProject.model)}</span><span>{configuration?.textModels.find(item=>item.id===selectedProject.textModelId)?.label||selectedProject.textModelId||'旧版本未记录文案模型'}</span><span>15秒</span><span>1280×720</span><span>{selectedProject.sourceImageCount}张素材</span><span>{selectedProject.subtitleMode==='NONE'?'无字幕':selectedProject.subtitleMode==='ENGLISH'?'英文字幕':selectedProject.subtitleMode==='CHINESE'?'中文字幕':'双语字幕'}</span><span>{selectedProject.voiceMode==='NONE'?'无配音':`${selectedProject.voiceMode==='ENGLISH'?'英文':'中文'} · ${voiceProviderLabel(selectedProject.voiceProvider)}`}</span></div>
      <footer><a href={selectedProject.video.previewUrl} download={selectedProject.video.fileName}>下载 MP4</a><button className="primary" type="button" disabled={Boolean(selectedProject.confirmedAt)} onClick={()=>void confirmProject()}>{selectedProject.confirmedAt?'✓ 当前视频已确认':'确认采用当前视频'}</button></footer>
    </section>}

    {projects.length>0&&<section className="ebay-video-versions">
      <header><b>系统视频版本</b><small>每次生成都会保留独立版本，不覆盖已确认的视频文件。</small></header>
      <div>{projects.map(project=><button type="button" className={`${selectedProject?.id===project.id?'active':''} ${project.confirmedAt?'confirmed':''}`} key={project.id} onClick={()=>setSelectedProjectId(project.id)}><span><b>V{project.version} · {project.confirmedAt?'✓ 已确认':project.status==='READY'?'已完成':project.status==='FAILED'?'生成失败':'生成中'}</b><small>{videoModelLabel(project.model)} · {new Date(project.updatedAt).toLocaleString('zh-CN')}</small></span><em>{project.subtitleMode==='NONE'?'无字幕':project.subtitleMode==='ENGLISH'?'英文字幕':project.subtitleMode==='CHINESE'?'中文字幕':'双语字幕'} · {project.voiceMode==='NONE'?'无配音':voiceProviderLabel(project.voiceProvider)}</em></button>)}</div>
    </section>}
  </div>
}
