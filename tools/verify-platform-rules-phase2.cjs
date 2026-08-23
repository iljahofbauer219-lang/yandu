const { _electron: electron }=require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path=require('node:path'),fs=require('node:fs'),os=require('node:os')
const qaProfile={id:'platform-rules-qa',email:'qa@example.test',name:'平台规则验收',isOwner:true,status:'ACTIVE',mustChangePassword:false,lastLoginAt:null,org:{id:'platform-rules-org',name:'平台规则验收组织'},roles:[],permissions:'ALL',stores:null}
;(async()=>{
  const executablePath=path.resolve(__dirname,'../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),userDataDir=fs.mkdtempSync(path.join(os.tmpdir(),'platform-rules-phase2-'))
  const app=await electron.launch({executablePath,args:[`--user-data-dir=${userDataDir}`,`.`],cwd:path.resolve(__dirname,'..')})
  try{
    const page=await app.firstWindow();await page.waitForLoadState('domcontentloaded');await page.route('**/api/auth/me',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(qaProfile)}))
    await app.evaluate(({app})=>{const{DatabaseSync}=process.getBuiltinModule('node:sqlite'),db=new DatabaseSync(`${app.getPath('userData')}/sourcing-data.sqlite`),now=new Date().toISOString();db.exec('PRAGMA foreign_keys = OFF');db.prepare(`INSERT OR REPLACE INTO supply_warehouse_products (id,warehouse_code,selection_id,source_url,product_id,title,image_url,price_text,supplier_name,category,subcategory,tertiary_category,status,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run('platform-product','1688','platform-selection','https://example.test/product','PLATFORM-SKU-001','平台规则验收商品','','¥88.00','测试供应商','家居','收纳','桌面收纳','ACTIVE','{}',now,now);db.close()})
    await page.evaluate(profile=>{localStorage.setItem('sourcing.auth.tokens:v1',JSON.stringify({accessToken:'qa',refreshToken:'qa',refreshTokenExpiresAt:'2099-01-01T00:00:00.000Z'}));localStorage.setItem('sourcing.auth.profile:v1',JSON.stringify(profile))},qaProfile);await page.reload();await page.waitForTimeout(700)
    await page.getByRole('button',{name:'AI美工'}).first().click();await page.getByText('AI生图',{exact:true}).first().click();await page.getByRole('button',{name:/添加商品/}).first().click();await page.locator('.image-source-options').getByRole('button',{name:/AI入库商品/}).click();await page.getByRole('button',{name:'AI做图'}).first().click()
    await page.getByText('Ozon图片规则',{exact:true}).waitFor();await page.getByText('最多15张',{exact:true}).waitFor();await page.getByText('5张主图 + 7张详情页',{exact:true}).first().waitFor()
    const officialHref=await page.getByRole('link',{name:/查看官方依据/}).getAttribute('href');if(!officialHref?.startsWith('https://docs.ozon.com/'))throw new Error('Ozon官方依据链接缺失')
    await page.getByLabel('主图生成数量').fill('8');await page.getByLabel('详情页生成数量').fill('8');await page.getByText(/计划生成16张，超过Ozon单个商品图库最多15张/).first().waitFor()
    await page.getByRole('button',{name:'确认并锁定商品事实'}).click();await page.waitForFunction(()=>document.querySelectorAll('.production-task').length===16)
    const stored=await page.evaluate(()=>JSON.parse(localStorage.getItem('image-production-projects:v1')||'[]')[0]);if(stored.platformRuleVersion!=='2026-08-04')throw new Error('平台规则版本未保存');if(stored.tasks.filter(task=>task.group==='MAIN').length!==8||stored.tasks.filter(task=>task.group==='DETAIL').length!==8)throw new Error('任务图组未按计划确定')
    if(!stored.tasks.every(task=>task.prompt.includes('PLATFORM CONTRACT OZON')))throw new Error('平台合同未进入所有任务Prompt')
    if(!stored.tasks.filter(task=>task.group==='MAIN').every(task=>task.prompt.includes('supporting gallery image')||task.prompt.includes('platform hero')))throw new Error('主图合同错误')
    if(!stored.tasks.filter(task=>task.group==='DETAIL').every(task=>task.prompt.includes('detail-page content module')))throw new Error('详情页合同错误')
    if(stored.tasks.find(task=>task.code==='D02').group!=='DETAIL')throw new Error('D02被错误分类为主图')
    fs.mkdirSync(path.resolve('output/playwright'),{recursive:true});const screenshot=path.resolve('output/playwright/platform-rules-phase2.png');await page.screenshot({path:screenshot,fullPage:true});const loadedAssets=await page.evaluate(()=>[...document.querySelectorAll('link[rel="stylesheet"],script[src]')].map(node=>node.getAttribute('href')||node.getAttribute('src')).filter(Boolean))
    console.log(JSON.stringify({officialRuleVisible:true,officialSourceLinked:true,recommendedCounts:'5+7',customCounts:'8+8',overLimitWarning:true,mainTasks:8,detailTasks:8,d02RemainsDetail:true,platformContractInPrompts:true,ruleVersionPersisted:true,loadedAssets,screenshot},null,2))
  }finally{await app.close()}
})().catch(error=>{console.error(error);process.exit(1)})
