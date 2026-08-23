import { BailianTranslationService } from '../src/main/services/BailianTranslationService'

function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message)}
;(async()=>{
  let requestBody:any
  const originalFetch=globalThis.fetch
  globalThis.fetch=(async(_input,init)=>{requestBody=JSON.parse(String(init?.body||'{}'));return new Response(JSON.stringify({choices:[{message:{content:'Подходит для ежедневного использования 33×45cm'}}]}),{status:200,headers:{'content-type':'application/json'}})}) as typeof fetch
  try{
    const service=new BailianTranslationService('test-key','https://example.test')
    const translated=await service.translateTexts(['适合日常使用 33×45cm'],'Russian','跨境电商图片营销文案。保留数字和尺寸。')
    assert(translated.get('适合日常使用 33×45cm')==='Подходит для ежедневного использования 33×45cm','翻译结果映射错误')
    assert(requestBody.translation_options.target_lang==='Russian','翻译服务没有真正请求俄语')
    assert(String(requestBody.translation_options.domains).includes('保留数字和尺寸'),'翻译保护指令未传给服务')
    console.log(JSON.stringify({targetLanguage:requestBody.translation_options.target_lang,protectedDomain:true,resultMapped:true},null,2))
  }finally{globalThis.fetch=originalFetch}
})().catch(error=>{console.error(error);process.exit(1)})
