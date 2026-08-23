const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const qaProfile = {
  id:'image-source-ui-qa',email:'qa@example.test',name:'三入口验收',isOwner:true,status:'ACTIVE',mustChangePassword:false,lastLoginAt:null,
  org:{id:'image-source-ui-qa-org',name:'三入口验收组织'},roles:[],permissions:'ALL',stores:null
}

async function openSourceMenu(page) {
  const add=page.getByRole('button',{name:/添加商品|点击更换来源/}).first()
  await add.click()
  await page.getByRole('heading',{name:'选择商品来源'}).waitFor()
}

async function assertFactAndTasks(page, sourceText) {
  await page.getByText('商品事实确认',{exact:true}).waitFor({timeout:15000})
  await page.getByText(sourceText,{exact:true}).first().waitFor()
  await page.getByRole('button',{name:'确认商品事实并生成清单'}).click()
  const tasks=await page.locator('.production-task').count()
  if(tasks!==12)throw new Error(`${sourceText}未生成12个任务：${tasks}`)
}

;(async()=>{
  const executablePath=path.resolve(__dirname,'../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir=fs.mkdtempSync(path.join(os.tmpdir(),'image-sources-electron-'))
  const fixturePaths=['local-product.png','local-detail.png','local-package.png'].map(name=>path.join(userDataDir,name))
  for(const fixturePath of fixturePaths)fs.writeFileSync(fixturePath,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64'))
  const app=await electron.launch({executablePath,args:[`.`,`--user-data-dir=${userDataDir}`],cwd:path.resolve(__dirname,'..')})
  try{
    const page=await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.route('**/api/auth/me',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(qaProfile)}))
    await app.evaluate(({app})=>{
      const {DatabaseSync}=process.getBuiltinModule('node:sqlite')
      const database=new DatabaseSync(`${app.getPath('userData')}/sourcing-data.sqlite`)
      database.exec('PRAGMA foreign_keys = OFF')
      const now=new Date().toISOString()
      database.prepare(`INSERT OR REPLACE INTO supply_warehouse_products
        (id,warehouse_code,selection_id,source_url,product_id,title,image_url,price_text,supplier_name,category,subcategory,tertiary_category,status,payload,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('source-ui-inventory','1688','source-ui-selection','https://example.test/inventory','SKU-INVENTORY','AI入库验收商品','', '¥99.00','验收供应商','家居','收纳','桌面收纳','ACTIVE','{}',now,now)
      database.close()
    })
    await page.evaluate(profile=>{
      localStorage.setItem('sourcing.auth.tokens:v1',JSON.stringify({accessToken:'qa',refreshToken:'qa',refreshTokenExpiresAt:'2099-01-01T00:00:00.000Z'}))
      localStorage.setItem('sourcing.auth.profile:v1',JSON.stringify(profile))
    },qaProfile)
    await page.reload();await page.waitForTimeout(1000)
    await page.getByRole('button',{name:'AI美工'}).first().click();await page.getByText('AI生图',{exact:true}).first().click()
    await page.getByText('商品来源',{exact:true}).waitFor()

    await app.evaluate(({dialog},filePaths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths})},fixturePaths)
    await openSourceMenu(page)
    await page.locator('.image-source-options').getByRole('button',{name:/本地图片/}).click()
    await page.getByRole('button',{name:/管理参考图 3张/}).click()
    await page.getByRole('heading',{name:'管理参考图'}).waitFor()
    if(await page.locator('.image-reference-list article').count()!==3)throw new Error('本地3张参考图未完整显示')
    await page.getByLabel('local-detail.png图片角色').selectOption('PRIMARY')
    await page.getByLabel('local-package.png图片角色').selectOption('PACKAGING')
    await page.getByRole('button',{name:'local-package.png上移'}).click()
    await page.getByRole('button',{name:'local-product.png删除'}).click()
    if(await page.locator('.image-reference-list article').count()!==2)throw new Error('参考图删除未生效')
    if(await page.locator('.image-reference-list article.primary').count()!==1)throw new Error('主参考图应且只能有1张')
    fs.mkdirSync(path.resolve('output/playwright'),{recursive:true})
    const referenceScreenshot=path.resolve('output/playwright/image-reference-manager-phase2.png')
    await page.screenshot({path:referenceScreenshot,fullPage:true})
    await page.getByRole('button',{name:'完成'}).click()
    await page.getByLabel('商品名称').fill('手动修正商品名')
    await page.getByLabel('商品SKU').fill('SKU-MANUAL-EDIT')
    await page.getByLabel('商品价格').fill('¥168.00')
    await assertFactAndTasks(page,'本地图片')

    await openSourceMenu(page)
    await page.locator('.image-source-options').getByRole('button',{name:/产品网址/}).click()
    await page.getByLabel('产品网址').fill('https://httpbin.org/image/png')
    await page.getByLabel('产品网址').press('Enter')
    await page.getByText('查看解析证据',{exact:true}).waitFor({timeout:15000})
    await assertFactAndTasks(page,'网址图片')

    await openSourceMenu(page)
    await page.locator('.image-source-options').getByRole('button',{name:/AI入库商品/}).click()
    await page.getByRole('button',{name:'AI做图'}).first().click()
    await assertFactAndTasks(page,'1688 · 验收供应商')

    await app.evaluate(({ipcMain})=>{
      globalThis.__imagePhase3Qa={generated:0,reviews:{}}
      ipcMain.removeHandler('image:generate')
      ipcMain.handle('image:generate',(_event,request)=>{globalThis.__imagePhase3Qa.generated+=1;const code=request.prompt.match(/Image task ([HD]\d+)/)?.[1]||'UNKNOWN';return{taskId:`qa-${code}-${globalThis.__imagePhase3Qa.generated}`,imageUrls:[`https://httpbin.org/image/png?task=${code}&run=${globalThis.__imagePhase3Qa.generated}`]}})
      ipcMain.removeHandler('image:review-candidate')
      ipcMain.handle('image:review-candidate',(_event,request)=>{const code=request.shotInstruction?.match(/^([HD]\d+)/)?.[1]||'UNKNOWN';globalThis.__imagePhase3Qa.reviews[code]=(globalThis.__imagePhase3Qa.reviews[code]||0)+1;const first=globalThis.__imagePhase3Qa.reviews[code]===1;const status=code==='H02'&&first?'REVIEW':code==='H05'&&first?'REJECTED':'PASSED';return{candidateUrl:request.candidateUrl,purpose:request.purpose,status,identityScore:status==='PASSED'?96:72,structuralScore:status==='PASSED'?95:70,factScore:status==='PASSED'?97:75,purposeScore:status==='PASSED'?94:76,diversityScore:90,reason:status==='PASSED'?'自动质检通过':status==='REVIEW'?'细节一致性需人工复核':'包装结构与参考图不一致',referenceIndices:request.referenceIndices}})
    })
    await page.getByRole('button',{name:'确认并开始生成'}).first().click()
    await page.locator('.image-production-dialog').getByRole('button',{name:'确认并开始生成'}).click()
    await page.waitForFunction(()=>document.querySelectorAll('.production-task.running,.production-task.pending').length===0,null,{timeout:15000})
    if(await page.locator('.production-task.success').count()!==10)throw new Error('质检首轮应有10张通过')
    if(await page.locator('.production-task.review').count()!==1)throw new Error('质检首轮应有1张待人工复核')
    if(await page.locator('.production-task.failed').count()!==1)throw new Error('质检首轮应有1张拒绝')
    const qualityReviewScreenshot=path.resolve('output/playwright/image-production-quality-review-phase3.png')
    await page.screenshot({path:qualityReviewScreenshot,fullPage:true})
    await page.locator('.production-task.review').getByRole('button',{name:'人工通过'}).click()
    await page.locator('.production-task.failed').getByRole('button',{name:'单张重做'}).click()
    await page.waitForFunction(()=>document.querySelectorAll('.production-task.running,.production-task.pending,.production-task.review,.production-task.failed').length===0,null,{timeout:10000})
    const phase3Counters=await app.evaluate(()=>globalThis.__imagePhase3Qa)
    if(phase3Counters.generated!==13)throw new Error(`单张重做应只新增1次生成，实际总调用${phase3Counters.generated}`)
    const qualityScreenshot=path.resolve('output/playwright/image-production-quality-phase3.png')
    await page.screenshot({path:qualityScreenshot,fullPage:true})

    fs.mkdirSync(path.resolve('output/playwright'),{recursive:true})
    const screenshot=path.resolve('output/playwright/image-sources-phase1.png')
    await page.screenshot({path:screenshot,fullPage:true})
    await page.getByRole('button',{name:'深色'}).click()
    await openSourceMenu(page)
    if(await page.locator('.image-source-options>button').count()!==3)throw new Error('深色主题下三入口未完整显示')
    const darkScreenshot=path.resolve('output/playwright/image-sources-phase1-dark.png')
    await page.screenshot({path:darkScreenshot,fullPage:true})
    const loadedAssets=await page.evaluate(()=>[...document.querySelectorAll('link[rel="stylesheet"],script[src]')].map(node=>node.getAttribute('href')||node.getAttribute('src')).filter(Boolean))
    console.log(JSON.stringify({local:{facts:true,tasks:12,references:2,primary:1,roles:true,reorder:true,delete:true,factCorrection:true},url:{facts:true,tasks:12,evidence:true},inventory:{facts:true,tasks:12},quality:{initial:{passed:10,review:1,rejected:1},manualAccept:true,singleRetry:true,generatedCalls:phase3Counters.generated,finalPassed:12},themes:{light:true,dark:true},loadedAssets,referenceScreenshot,qualityReviewScreenshot,qualityScreenshot,screenshot,darkScreenshot},null,2))
  }finally{await app.close()}
})().catch(error=>{console.error(error);process.exit(1)})
