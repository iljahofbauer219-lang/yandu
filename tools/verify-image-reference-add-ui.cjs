const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const qaProfile = {
  id:'image-reference-add-qa',email:'qa@example.test',name:'参考图补充验收',isOwner:true,status:'ACTIVE',mustChangePassword:false,lastLoginAt:null,
  org:{id:'image-reference-add-qa-org',name:'参考图补充验收组织'},roles:[],permissions:'ALL',stores:null
}

;(async()=>{
  const executablePath=path.resolve(__dirname,'../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir=fs.mkdtempSync(path.join(os.tmpdir(),'image-reference-add-'))
  const fixturePaths=Array.from({length:12},(_,index)=>path.join(userDataDir,`reference-${index+1}.png`))
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')
  fixturePaths.forEach((filePath,index)=>fs.writeFileSync(filePath,Buffer.concat([png,Buffer.from(String(index))])))
  const app=await electron.launch({executablePath,args:[`.`,`--user-data-dir=${userDataDir}`],cwd:path.resolve(__dirname,'..')})
  try{
    const page=await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.route('**/api/auth/me',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(qaProfile)}))
    await page.evaluate(profile=>{
      localStorage.setItem('sourcing.auth.tokens:v1',JSON.stringify({accessToken:'qa',refreshToken:'qa',refreshTokenExpiresAt:'2099-01-01T00:00:00.000Z'}))
      localStorage.setItem('sourcing.auth.profile:v1',JSON.stringify(profile))
    },qaProfile)
    await page.reload()
    await page.getByRole('button',{name:'AI美工'}).first().click()
    await page.getByText('AI生图',{exact:true}).first().click()

    await app.evaluate(({dialog},filePaths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths})},fixturePaths.slice(0,9))
    await page.getByRole('button',{name:/添加商品/}).first().click()
    await page.getByText('JPG、PNG、WebP · 可多选，数量不限',{exact:true}).waitFor()
    await page.locator('.image-source-options').getByRole('button',{name:/本地图片/}).click()
    await page.getByRole('button',{name:/管理参考图 9张/}).click()
    await page.getByRole('heading',{name:'管理参考图'}).waitFor()

    await app.evaluate(({dialog},filePaths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths})},fixturePaths.slice(9,12))
    await page.getByRole('button',{name:'＋ 添加图片'}).click()
    await page.waitForFunction(()=>document.querySelectorAll('.image-reference-list article').length===12)
    const afterAddCount=await page.locator('.image-reference-list article').count()
    if(afterAddCount!==12)throw new Error(`补充3张后参考图数量不是12张，实际${afterAddCount}张；${await page.locator('.image-reference-error').allTextContents()}`)
    for(const name of ['reference-10.png','reference-11.png','reference-12.png']){
      if(await page.getByLabel(`${name}图片角色`).inputValue()!=='DETAIL')throw new Error(`${name}未默认设为细节图`)
    }

    await page.getByRole('button',{name:'＋ 添加图片'}).click()
    await page.locator('.image-reference-error').getByText('所选图片已在参考图列表中',{exact:true}).waitFor()
    if(await page.locator('.image-reference-list article').count()!==12)throw new Error('重复图片被错误加入')
    if(await page.getByRole('button',{name:'＋ 添加图片'}).isDisabled())throw new Error('超过8张后添加按钮被错误禁用')
    if(await page.locator('.image-reference-list article.primary').count()!==1)throw new Error('补图后主参考图数量发生变化')

    fs.mkdirSync(path.resolve('output/playwright'),{recursive:true})
    const screenshot=path.resolve('output/playwright/image-reference-add.png')
    await page.screenshot({path:screenshot,fullPage:true})
    const loadedAssets=await page.evaluate(()=>[...document.querySelectorAll('link[rel="stylesheet"],script[src]')].map(node=>node.getAttribute('href')||node.getAttribute('src')).filter(Boolean))
    console.log(JSON.stringify({initialUpload:9,addThree:true,totalReferences:12,unlimitedLabel:true,defaultRole:'DETAIL',duplicateBlocked:true,addButtonStillEnabled:true,primaryCount:1,loadedAssets,screenshot},null,2))
  }finally{await app.close()}
})().catch(error=>{console.error(error);process.exit(1)})
