const fs=require('node:fs')
const path=require('node:path')
const {ArkVideoService}=require('../dist/main/main/services/ArkVideoService.js')

for(const line of fs.readFileSync(path.join(process.cwd(),'.env.local'),'utf8').split(/\r?\n/)){
  const match=line.match(/^([A-Z0-9_]+)=(.*)$/)
  if(match&&!process.env[match[1]])process.env[match[1]]=match[2].trim().replace(/^(['"])(.*)\1$/,'$2')
}

const configured=value=>[...new Set((value||'').split(',').map(item=>item.trim()).filter(Boolean))]
const rootDirectory=process.env.ARK_VIDEO_VERIFY_ROOT
  ||path.join(process.env.HOME,'Library','Application Support','cross-border-sourcing-desktop','ebay-videos')
const service=new ArkVideoService(
  process.env.ARK_API_KEY||'',
  (process.env.ARK_BASE_URL||'https://ark.cn-beijing.volces.com/api/v3').replace(/\/+$/,''),
  process.env.ARK_VIDEO_MODEL||'',
  rootDirectory,
  {
    configuredVideoModels:configured(process.env.ARK_VIDEO_MODELS),
    configuredTextModels:configured(process.env.ARK_TEXT_MODELS),
    ttsAppId:process.env.VOLC_TTS_APP_ID||'',
    ttsAccessToken:process.env.VOLC_TTS_ACCESS_TOKEN||'',
    ttsBaseUrl:process.env.VOLC_TTS_BASE_URL||'',
    ttsResourceId:process.env.VOLC_TTS_RESOURCE_ID||'seed-tts-2.0',
    ttsVoices:{
      NATURAL_FEMALE:process.env.VOLC_TTS_VOICE_NATURAL_FEMALE||'',
      NATURAL_MALE:process.env.VOLC_TTS_VOICE_NATURAL_MALE||'',
      PROFESSIONAL_FEMALE:process.env.VOLC_TTS_VOICE_PROFESSIONAL_FEMALE||'',
      PROFESSIONAL_MALE:process.env.VOLC_TTS_VOICE_PROFESSIONAL_MALE||''
    }
  }
)

async function main(){
  const requested=process.argv.slice(2)
  const targets=requested.length?requested:[
    'TEXT:doubao-seed-2-1-turbo-260628',
    'TEXT:doubao-seed-2-1-pro-260628',
    'TEXT:doubao-seed-evolving',
    'VOICE:LOCAL_MACOS',
    'VIDEO:doubao-seedance-2-0-260128',
    'VIDEO:doubao-seedance-2-0-fast-260128',
    'VIDEO:doubao-seedance-2-0-mini-260615'
  ]
  for(const target of targets){
    const separator=target.indexOf(':')
    const kind=target.slice(0,separator)
    const id=target.slice(separator+1)
    console.log(`VERIFY_START ${kind} ${id}`)
    const configuration=await service.verifyCapability({kind,id})
    const rows=kind==='VIDEO'?configuration.videoModels:kind==='TEXT'?configuration.textModels:configuration.voiceProviders
    const result=rows.find(item=>item.id===id)
    console.log(`VERIFY_RESULT ${kind} ${id} ${result?.status||'MISSING'} ${result?.message||''}`)
  }
}

main().catch(error=>{
  console.error(`VERIFY_FATAL ${error instanceof Error?error.message:String(error)}`)
  process.exitCode=1
})
