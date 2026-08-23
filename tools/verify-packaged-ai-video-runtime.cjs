const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const root=path.resolve(__dirname,'..')
const executablePath=path.join(root,'release/mac/砚都跨境.app/Contents/MacOS/砚都跨境')
;(async()=>{
  if(!fs.existsSync(executablePath))throw new Error('打包应用不存在')
  const userDataDir=fs.mkdtempSync(path.join(os.tmpdir(),'yandu-packaged-ai-video-'))
  const app=await electron.launch({executablePath,args:[`--user-data-dir=${userDataDir}`],env:{...process.env,ELECTRON_RUN_AS_NODE:'',NODE_OPTIONS:''}})
  try{
    const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded')
    const result=await page.evaluate(async()=>({watch:await window.desktop.system.watchSkillStatus(),resource:await window.desktop.system.resource2SkillStatus()}))
    if(!result.watch.checks.engine||!result.watch.checks.ffmpeg||!result.watch.checks.whisper||!result.watch.checks.ocr)throw new Error(`包内 Watch 运行时未就绪: ${JSON.stringify(result.watch)}`)
    if(!result.resource.officialRuntimeReady||!result.resource.domains.includes('general'))throw new Error(`包内 Resource2Skill 运行时未就绪: ${JSON.stringify(result.resource)}`)
    console.log(JSON.stringify({passed:true,packaged:true,watch:result.watch.checks,domains:result.resource.domains,note:result.resource.note},null,2))
  }finally{await app.close()}
})().catch(error=>{console.error(`PACKAGED VERIFY FAILED: ${error.stack||error.message}`);process.exit(1)})
