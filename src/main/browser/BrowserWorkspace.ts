import { BaseWindow, WebContents, WebContentsView } from 'electron'
import type { BrowserBounds, BrowserState, BrowserTab, BuiltInCollectorState, CollectedOzonProduct, CollectedSupplyProduct, CollectorPluginProduct, EbayBrowserPluginState, EbayCategorySpecificRequirement, EbayCollectedProduct, EbayDeliveryLocationResult, EbayDirectoryProductScanCategory, EbayLoginResult, EbayMarketResearchFilter, EbayMarketResearchMetric, EbayMarketResearchSample, EbayMarketResearchSnapshot, EbayOptimizationDraft, EbayProductDetails, EbaySellerHubAcceptanceSnapshot, EbayStoreCategory, MarketplacePlatformCode, NetworkStrategy, Platform, SelectionTask, SupplyActivationResult } from '../../shared/contracts'
import gigaCatalog from '../../renderer/gigaCatalog.json'
import type { EbayLocalListingRequirements, EbayLocalProduct, EbayLocalRevisionPreparationResult } from '../../shared/contracts'

const GIGA_CATALOG_VERSION = 'gigab2b-2026-07-13'
const GIGA_CATEGORY_PATHS = Object.fromEntries(gigaCatalog.flatMap(level1 => level1.children.flatMap(level2 => level2.children.map(level3 => [level3.id, [
  { id:level1.id, name:level1.name }, { id:level2.id, name:level2.name }, { id:level3.id, name:level3.name }
]]))))

interface DetailTab {
  id: string
  platform: Platform
  title: string
  faviconUrl?: string
  siteLogoUrl?: string
  view: WebContentsView
  generic?: boolean
  closable?: boolean
  scopeId?: string
  domains?: string[]
}

interface BuiltInCollectorSnapshot {
  products: CollectorPluginProduct[]
  visibleUrls: string[]
  changes?: Array<{ selected: boolean; product: CollectorPluginProduct }>
}

const HOME: Record<Platform, string> = {
  ozon: 'https://www.ozon.ru/',
  '1688': 'https://www.1688.com/',
  web: 'about:blank'
}

export class BrowserWorkspace {
  private readonly views = new Map<Platform, WebContentsView>()
  private readonly supplyViews = new Map<'1688'|'GIGACLOUD', WebContentsView>()
  private readonly detailTabs = new Map<string, DetailTab>()
  private active: Platform = '1688'
  private activeTabId = 'home-1688'
  private attached: WebContentsView | null = null
  private browserVisible = false
  private activationVersion = 0
  private bounds: BrowserBounds = { x: 264, y: 112, width: 900, height: 640 }
  private marketplaceTitle = 'Ozon 市场'
  private marketplaceDomains = ['ozon.ru']
  private marketplacePartition = 'persist:market:OZON:ozon-default'
  private supplyTabVisible = true
  private supplyTitle = '1688 采购'
  private supplyPlatformCode: '1688'|'GIGACLOUD' = '1688'
  private marketplaceTabVisible = false
  private credentialDomains: string[] = []
  private builtInCollectorActive = false
  private readonly builtInCollectorProducts = new Map<string, CollectorPluginProduct>()
  private ebayPluginActive = false
  private readonly ebayPluginProducts = new Map<string,EbayCollectedProduct>()
  private gigaAutoLoginAttemptedAt = 0
  private readonly ebayAutoLoginAttemptedAt = new Map<string,number>()

  constructor(private readonly window: BaseWindow, private readonly shellContents: WebContents) {}

  private sleep(milliseconds:number) { return new Promise(resolve=>setTimeout(resolve,milliseconds)) }

  private bindTabFavicon(tab:DetailTab) {
    const update=(faviconUrl?:string)=>{
      if(!faviconUrl||tab.faviconUrl===faviconUrl)return
      tab.faviconUrl=faviconUrl
      this.emitTabs()
    }
    tab.view.webContents.on('page-favicon-updated',(_event,favicons)=>{
      update(favicons.find(value=>/^https?:\/\//i.test(value)||/^data:image\//i.test(value)))
    })
    tab.view.webContents.on('dom-ready',()=>{
      void tab.view.webContents.executeJavaScript(`(() => {
        const icon=[...document.querySelectorAll('link[rel~="icon"],link[rel="shortcut icon"],link[rel="apple-touch-icon"]')]
          .map(node=>node.href).find(Boolean)
        return icon||''
      })()`).then(value=>update(typeof value==='string'?value:undefined)).catch(()=>undefined)
    })
    tab.view.webContents.on('did-stop-loading',()=>{
      if(tab.siteLogoUrl||tab.view.webContents.isDestroyed())return
      void tab.view.webContents.executeJavaScript(`(() => {
        const root=document.querySelector('#gh-logo,.gh-logo,a[aria-label="eBay"],a[aria-label*="eBay" i],header [class*="logo" i]')
        const node=root?.matches?.('img,svg')?root:(root?.querySelector?.('img,svg')||root)
        if(!node)return null
        const rect=node.getBoundingClientRect()
        if(rect.width<20||rect.height<10)return null
        return {x:Math.max(0,Math.floor(rect.x)),y:Math.max(0,Math.floor(rect.y)),width:Math.min(320,Math.ceil(rect.width)),height:Math.min(120,Math.ceil(rect.height))}
      })()`).then(async rect=>{
        if(!rect||tab.view.webContents.isDestroyed())return
        const logo=await tab.view.webContents.capturePage(rect)
        if(logo.isEmpty())return
        tab.siteLogoUrl=logo.toDataURL()
        this.emitTabs()
      }).catch(()=>undefined)
    })
  }

  private async protectCollectionStep(view:WebContentsView,task:SelectionTask,step:number,onProgress:(message:string,collected:number)=>void,startedAt:number) {
    if (!task.collectionProtectionEnabled) return
    const maxRunMinutes=task.collectionMaxRunMinutes||20
    if (Date.now()-startedAt>maxRunMinutes*60_000) throw new Error(`采集保护已暂停：连续运行达到${maxRunMinutes}分钟，请稍后重新启动`)
    if (task.collectionAutoPause!==false) {
      const issue=await view.webContents.executeJavaScript(`(() => { const text=(document.body?.innerText||'').slice(0,12000); const url=location.href; if (/captcha|verify|安全验证|滑块|验证码|访问频繁|操作异常|请求过于频繁|too many requests/i.test(text+' '+url)) return '检测到安全验证或访问频繁'; if (/account\/login|请登录|重新登录|登录已失效/i.test(text+' '+url)) return '登录状态可能已失效'; return ''; })()` ) as string
      if (issue) throw new Error(`采集保护已暂停：${issue}。请在右侧浏览器人工处理后重新启动`)
    }
    const actionRange=task.collectionProtectionMode==='CAUTIOUS'?[1400,2800]:task.collectionProtectionMode==='FAST'?[350,900]:[700,1600]
    await this.sleep(actionRange[0]+Math.random()*(actionRange[1]-actionRange[0]))
    const batchSteps=Math.max(2,Math.ceil((task.collectionBatchSize||12)/10))
    if (step>0&&step%batchSteps===0) {
      const minimum=Math.max(1,task.collectionRestMinSeconds||20),maximum=Math.max(minimum,task.collectionRestMaxSeconds||45)
      const seconds=Math.round(minimum+Math.random()*(maximum-minimum))
      onProgress(`采集保护：本批完成，休息${seconds}秒后继续`,0)
      await this.sleep(seconds*1000)
    }
  }

  private createView(platform: Platform, initialLoad = true) {
    if (platform === 'web') throw new Error('通用网页必须通过新标签页创建')
    const view = new WebContentsView({
      webPreferences: {
        partition: platform === 'ozon' ? this.marketplacePartition : `persist:supply:${this.supplyPlatformCode}:default`,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })

    view.setBackgroundColor('#ffffff')
    const browserUserAgent = view.webContents
      .getUserAgent()
      .replace(/\sElectron\/[^\s]+/g, '')
      .replace(/\scross-border-sourcing-desktop\/[^\s]+/g, '')
    if (platform === 'ozon') {
      view.webContents.session.setUserAgent(browserUserAgent, 'ru-RU,ru;q=0.9,en;q=0.8')
    } else {
      view.webContents.setUserAgent(browserUserAgent)
    }
    view.webContents.setWindowOpenHandler(({ url }) => {
      void this.openTab(platform, url)
      return { action: 'deny' }
    })
    view.webContents.on('will-navigate', (event, url) => {
      if (!this.isAllowedUrl(platform, url)) event.preventDefault()
    })
    view.webContents.on('did-navigate', () => { this.emitState(platform); this.emitTabs() })
    view.webContents.on('did-navigate-in-page', () => {
      this.emitState(platform)
      this.emitTabs()
      if (this.builtInCollectorActive) void this.injectBuiltInCollector(view).catch(() => undefined)
    })
    view.webContents.on('did-start-loading', () => this.emitState(platform))
    view.webContents.on('dom-ready', () => {
      if (this.builtInCollectorActive) void this.injectBuiltInCollector(view).catch(() => undefined)
    })
    view.webContents.on('did-stop-loading', () => {
      this.emitState(platform)
      if (this.builtInCollectorActive) void this.injectBuiltInCollector(view).catch(() => undefined)
    })
    view.webContents.on('page-title-updated', () => this.emitState(platform))
    this.views.set(platform, view)
    if (platform === '1688') this.supplyViews.set(this.supplyPlatformCode, view)
    if (initialLoad) void this.configureNetworkAndLoad(platform, view)
    return view
  }

  async activateMarketplace(platformCode: MarketplacePlatformCode, accountId: string, strategy: NetworkStrategy) {
    const profiles: Record<MarketplacePlatformCode, { title: string; url: string; domains: string[] }> = {
      OZON: { title: 'Ozon 市场', url: 'https://www.ozon.ru/', domains: ['ozon.ru'] },
      AMAZON: { title: 'Amazon 市场', url: 'https://www.amazon.com/', domains: ['amazon.com', 'amazon.cn'] },
      EBAY: { title: 'eBay 市场', url: 'https://www.ebay.com/', domains: ['ebay.com'] },
      ALIEXPRESS: { title: 'AliExpress 市场', url: 'https://www.aliexpress.com/', domains: ['aliexpress.com'] },
      TEMU: { title: 'Temu 市场', url: 'https://www.temu.com/', domains: ['temu.com'] }
    }
    const profile = profiles[platformCode]
    this.active = 'ozon'
    this.activeTabId = 'home-ozon'
    this.supplyTabVisible = false
    this.marketplaceTabVisible = true
    this.closeDetailTabs()
    const previous = this.views.get('ozon')
    if (previous && this.attached === previous) {
      this.window.contentView.removeChildView(previous)
      this.attached = null
    }
    this.views.delete('ozon')
    const previousContents = previous?.webContents
    if (previousContents && !previousContents.isDestroyed()) previousContents.close()
    this.marketplaceTitle = profile.title
    this.marketplaceDomains = profile.domains
    this.marketplacePartition = `persist:market:${platformCode}:${accountId}`
    const view = new WebContentsView({ webPreferences: { partition: this.marketplacePartition, nodeIntegration: false, contextIsolation: true, sandbox: true } })
    this.views.set('ozon', view)
    view.setBackgroundColor('#ffffff')
    const userAgent = view.webContents.getUserAgent().replace(/\sElectron\/[^\s]+/g, '').replace(/\scross-border-sourcing-desktop\/[^\s]+/g, '')
    view.webContents.session.setUserAgent(userAgent)
    if (strategy === 'LOCAL_DIRECT') await view.webContents.session.setProxy({ mode: 'direct' })
    else if (strategy === 'SYSTEM') await view.webContents.session.setProxy({ mode: 'system' })
    await view.webContents.session.closeAllConnections()
    view.webContents.setWindowOpenHandler(({ url }) => { if (this.isAllowedUrl('ozon', url)) void view.webContents.loadURL(url); return { action: 'deny' } })
    view.webContents.on('will-navigate', (event, url) => { if (!this.isAllowedUrl('ozon', url)) event.preventDefault() })
    const emit = () => { this.emitState('ozon'); this.emitTabs() }
    view.webContents.on('did-navigate', emit)
    view.webContents.on('did-navigate-in-page', emit)
    view.webContents.on('did-start-loading', () => this.emitState('ozon'))
    view.webContents.on('did-stop-loading', () => this.emitState('ozon'))
    this.attachView(view)
    this.emitTabs()
    try {
      await view.webContents.loadURL(profile.url)
    } catch (error) {
      const loadError = error as Error & { code?: string; errno?: number }
      const currentContents = view.webContents
      if (!currentContents || currentContents.isDestroyed()) return
      const currentUrl = currentContents.getURL()
      const redirectedToPlatform = Boolean(currentUrl) && this.isAllowedUrl('ozon', currentUrl)
      if (loadError.code !== 'ERR_ABORTED' && loadError.errno !== -3 && !(loadError.code === 'ERR_FAILED' && redirectedToPlatform)) throw error
    }
  }

  async activateSupplyPlatform(platformCode: '1688' | 'GIGACLOUD'): Promise<number | null> {
    const activationVersion = ++this.activationVersion
    const profile = platformCode === 'GIGACLOUD'
      ? { url: 'https://www.gigab2b.com/index.php?route=common/home', domains:['gigab2b.com'] }
      : { url: 'https://www.1688.com/', domains:['1688.com'] }
    this.supplyTitle = platformCode === 'GIGACLOUD' ? '大健云仓采购' : '1688 采购'
    this.supplyTabVisible = true
    this.marketplaceTabVisible = false
    this.active = '1688'
    this.activeTabId = 'home-1688'
    this.closeDetailTabs()
    this.supplyPlatformCode = platformCode
    let view = this.supplyViews.get(platformCode)
    if (!view || view.webContents.isDestroyed()) {
      view = this.createView('1688', false)
      await this.configureNetworkAndLoad('1688', view)
    } else {
      this.views.set('1688', view)
      const currentUrl=view.webContents.getURL()
      let isPlatformPage=false
      try { const hostname=new URL(currentUrl).hostname;isPlatformPage=profile.domains.some(domain=>hostname===domain||hostname.endsWith(`.${domain}`)) } catch { isPlatformPage=false }
      if (!isPlatformPage) await view.webContents.loadURL(profile.url)
    }
    if (!this.isActivationCurrent(activationVersion, platformCode)) return null
    if (platformCode === 'GIGACLOUD') {
      this.builtInCollectorActive = true
    } else {
      this.builtInCollectorActive = false
      this.builtInCollectorProducts.clear()
    }
    this.attachView(view)
    this.emitTabs()
    if (!view.webContents.getURL()) await view.webContents.loadURL(profile.url)
    return this.isActivationCurrent(activationVersion, platformCode) ? activationVersion : null
  }

  async startBuiltInCollector(): Promise<BuiltInCollectorState> {
    const view = this.attached
    if (!view || !this.isGigaCloudView(view)) throw new Error('请先在右侧打开大健云仓商品列表或详情页')
    if (!this.builtInCollectorActive) this.builtInCollectorProducts.clear()
    this.builtInCollectorActive = true
    await Promise.all(this.getGigaCloudViews().map(item => this.injectBuiltInCollector(item).catch(() => undefined)))
    return this.getBuiltInCollectorState()
  }

  async getBuiltInCollectorState(): Promise<BuiltInCollectorState> {
    if (!this.builtInCollectorActive) return { active: false, platformCode: 'GIGACLOUD', recognizedCount: 0, products: [] }
    const views = this.getGigaCloudViews()
    let recognizedCount = 0
    for (const view of views) {
      const result = await this.readBuiltInCollectorSnapshot(view)
      if (view === this.attached) recognizedCount = new Set(result.visibleUrls).size
      result.changes?.forEach(change => {
        if (change.selected) this.builtInCollectorProducts.set(change.product.url, change.product)
        else this.builtInCollectorProducts.delete(change.product.url)
      })
    }
    const products = [...this.builtInCollectorProducts.values()]
    await Promise.all(views.map(view => this.syncBuiltInCollectorSelection(view, products)))
    return { active: true, platformCode: 'GIGACLOUD', recognizedCount, products }
  }

  async removeBuiltInCollectorProduct(url: string): Promise<BuiltInCollectorState> {
    this.builtInCollectorProducts.delete(url)
    if (this.builtInCollectorActive) {
      await Promise.all(this.getGigaCloudViews().map(async view => {
        try { await view.webContents.executeJavaScript(`window.__crossBorderCollector?.remove?.(${JSON.stringify(url)})`) } catch { /* 页面切换时由下一次同步更新 */ }
      }))
    }
    return this.getBuiltInCollectorState()
  }

  async stopBuiltInCollector() {
    this.builtInCollectorActive = false
    this.builtInCollectorProducts.clear()
    await Promise.all(this.getGigaCloudViews().map(async view => {
      try { await view.webContents.executeJavaScript(`window.__crossBorderCollector?.stop?.()`) } catch { /* 页面已经离开 */ }
    }))
  }

  private isEbayView(view: WebContentsView) {
    if (view.webContents.isDestroyed()) return false
    try {
      const current = new URL(view.webContents.getURL())
      return current.hostname === 'ebay.com' || current.hostname.endsWith('.ebay.com')
    } catch { return false }
  }

  private getEbayViews() {
    return [...new Set([...this.detailTabs.values()].map(tab => tab.view))].filter(view => this.isEbayView(view))
  }

  private async injectEbayPlugin(view: WebContentsView) {
    if (!this.isEbayView(view) || view.webContents.isDestroyed()) return
    const seeded = [...this.ebayPluginProducts.values()]
    await view.webContents.executeJavaScript(String.raw`(() => {
      const previous=window.__crossBorderEbayPlugin?.snapshot?.() || {products:[],changes:[]};
      window.__crossBorderEbayPlugin?.stop?.();
      const changes=previous.changes||[];
      const selected=new Map([...${JSON.stringify(seeded)},...(previous.products||[])].map(item=>[item.url,item]));
      const overlay=document.createElement('div');overlay.id='cross-border-ebay-plugin-overlay';document.documentElement.appendChild(overlay);
      const entries=new Map();
      const normalize=raw=>{try{const url=new URL(raw,location.href);const match=url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d+)/);return match?url.origin+'/itm/'+match[1]:url.origin+url.pathname}catch{return raw||''}};
      const textOf=node=>(node?.innerText||node?.textContent||'').replace(/\s+/g,' ').trim();
      const originalTextOf=node=>{if(!node)return'';const clone=node.cloneNode(true);if(clone instanceof Element&&clone.matches('[data-codex-translated]'))return(clone.getAttribute('data-codex-original')||clone.textContent||'').replace(/\s+/g,' ').trim();clone.querySelectorAll?.('[data-codex-translated]').forEach(item=>item.replaceWith(document.createTextNode(item.getAttribute('data-codex-original')||item.textContent||'')));return(clone.textContent||'').replace(/\s+/g,' ').trim()};
      const translatedTextOf=node=>{if(!node)return'';const wrappers=[...(node instanceof Element&&node.matches('[data-codex-translated]')?[node]:[]),...(node.querySelectorAll?.('[data-codex-translated]')||[])];return wrappers.map(item=>item.getAttribute('data-codex-translation')||'').filter(Boolean).join(' ').replace(/\s+/g,' ').trim()};
      const structuredTitleOf=()=>{for(const script of document.querySelectorAll('script[type="application/ld+json"]')){try{const queue=[JSON.parse(script.textContent||'null')];while(queue.length){const value=queue.shift();if(Array.isArray(value)){queue.push(...value);continue}if(!value||typeof value!=='object')continue;const type=value['@type'];if((type==='Product'||Array.isArray(type)&&type.includes('Product'))&&typeof value.name==='string'&&value.name.trim())return value.name.replace(/\s+/g,' ').trim();queue.push(...Object.values(value))}}catch{}}return(document.querySelector('meta[property="og:title"]')?.getAttribute('content')||'').replace(/\s+/g,' ').trim()};
      const imageOf=(image,card)=>{const candidates=[image?.currentSrc,image?.src,image?.getAttribute?.('data-src'),image?.getAttribute?.('data-original'),...(image?.getAttribute?.('srcset')||'').split(',').map(value=>value.trim().split(/\s+/)[0])];return candidates.find(value=>/^https?:\/\//i.test(value||'')&&!/(placeholder|loading|blank|transparent)/i.test(value))||[...card.querySelectorAll('img')].map(item=>item.currentSrc||item.src).find(value=>/^https?:\/\//i.test(value||''))||''};
      const categoryOf=()=>{const page=new URL(location.href);const selectors=['[aria-current="page"]','.str-categories__category-name','.breadcrumbs [aria-current="page"]','nav [class*="selected"]'];const selected=[...document.querySelectorAll('a[aria-current="page"],a[class*="selected"],.str-categories a')];const candidates=[page.searchParams.get('store_cat'),page.searchParams.get('_sacat'),page.searchParams.get('categoryId'),...selected.flatMap(anchor=>{try{const url=new URL(anchor.href,location.href);return [url.searchParams.get('store_cat'),url.searchParams.get('_sacat'),url.searchParams.get('categoryId')]}catch{return []}})].filter(Boolean);const categoryId=candidates.find(value=>/^\d{5,}$/.test(value||''))||'';const categoryName=selectors.map(selector=>textOf(document.querySelector(selector))).find(value=>value&&value.length<100&&!/^\d+$/.test(value)&&!/seller hub|ebay|\u5356\u5bb6\u4e13\u533a|\u5168\u90e8\u7269\u54c1|all items/i.test(value))||'';return {categoryId,categoryName}};
      const extract=(anchor,card)=>{const url=normalize(anchor?.href||location.href);const listingId=url.match(/\/itm\/(\d+)/)?.[1]||'';const image=anchor?.querySelector('img')||card.querySelector('img');const text=textOf(card);const titleNode=card.querySelector('h1,h2,h3,[class*="title"]');const linkOriginalTitle=originalTextOf(anchor);const structuredTitle=!anchor&&/\/itm\//.test(location.pathname)?structuredTitleOf():'';const fallbackTitle=originalTextOf(titleNode)||anchor?.getAttribute('title')||image?.alt||originalTextOf(card).slice(0,180)||text.slice(0,180);const originalTitle=linkOriginalTitle||structuredTitle||fallbackTitle;const originalTitleVerified=Boolean(linkOriginalTitle||structuredTitle);const titleSource=linkOriginalTitle?'EBAY_STORE_LINK':structuredTitle?'EBAY_STRUCTURED_DATA':'UNVERIFIED_PAGE_TEXT';const translatedTitle=translatedTextOf(anchor)||translatedTextOf(titleNode);const title=originalTitle;const priceText=text.match(/(?:US\s*)?\$\s*[\d,.]+|(?:RMB|USD|CNY|GBP|EUR)\s*[\d,.]+|[\d,.]+\s*(?:RMB|USD|CNY|GBP|EUR)/i)?.[0]||'';const currency=/GBP|\u00a3/i.test(priceText)?'GBP':/EUR|\u20ac/i.test(priceText)?'EUR':/RMB/i.test(priceText)?'RMB':/CNY|\u00a5|\uffe5/i.test(priceText)?'CNY':'USD';const price=priceText.replace(/[^0-9.,-]/g,'').replace(/,/g,'');return {url,listingId,title,originalTitle,translatedTitle:translatedTitle!==originalTitle?translatedTitle:'',originalTitleVerified,titleSource,imageUrl:imageOf(image,card),price,currency,...categoryOf()}};
      const update=entry=>{const chosen=selected.has(entry.product.url);entry.button.textContent=chosen?'\u2713 \u5df2\u9009':'\ud83e\udd16 \u91c7\u96c6';entry.button.classList.toggle('is-selected',chosen);entry.card?.classList.toggle('cross-border-ebay-card-active',chosen)};
      const remove=entry=>{entry.card?.classList.remove('cross-border-ebay-card-active');entry.button.remove();entries.delete(entry.url)};
      const toggle=entry=>{const chosen=!selected.has(entry.product.url);if(chosen){entry.product=extract(entry.anchor,entry.card||document.body);selected.set(entry.product.url,entry.product)}else selected.delete(entry.product.url);changes.push({selected:chosen,product:entry.product});update(entry)};
      const position=()=>entries.forEach(entry=>{if(!entry.target?.isConnected){remove(entry);return}const rect=entry.target.getBoundingClientRect();const visible=rect.width>60&&rect.height>60&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth;entry.button.hidden=!visible;if(!visible)return;entry.button.style.top=Math.max(6,rect.top+8)+'px';entry.button.style.left=Math.min(innerWidth-8,Math.max(rect.left+90,rect.right-8))+'px';update(entry)});
      const scan=()=>{
        const anchors=[...document.querySelectorAll('a[href*="/itm/"]')];const seen=new Set();
        anchors.forEach(anchor=>{const url=normalize(anchor.href);if(!url||seen.has(url))return;seen.add(url);if(entries.has(url))return;const card=anchor.closest('li.s-item,[data-testid*="item"],[class*="item-card"],[class*="listing"],article,li')||anchor.parentElement;const image=anchor.querySelector('img')||card?.querySelector('img');if(!card||!image||image.getBoundingClientRect().width<60)return;const button=document.createElement('button');button.type='button';button.className='cross-border-ebay-select';const entry={url,anchor,card,target:image.parentElement||image,button,product:extract(anchor,card)};if(selected.has(url))selected.set(url,entry.product);button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();toggle(entry)});entries.set(url,entry);overlay.appendChild(button);update(entry)});
        entries.forEach(entry=>{if(!seen.has(entry.url)&&!entry.detail)remove(entry)});
        if(/\/itm\//.test(location.pathname)&&!entries.has(normalize(location.href))){const url=normalize(location.href);const button=document.createElement('button');button.type='button';button.className='cross-border-ebay-select cross-border-ebay-current';const entry={url,anchor:null,card:document.body,target:document.documentElement,button,detail:true,product:extract(null,document.body)};if(selected.has(url))selected.set(url,entry.product);button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();toggle(entry)});entries.set(url,entry);overlay.appendChild(button);update(entry)}
        position();
      };
      const style=document.createElement('style');style.id='cross-border-ebay-plugin-style';style.textContent='#cross-border-ebay-plugin-overlay{position:fixed!important;z-index:2147483646!important;inset:0!important;width:0!important;height:0!important;overflow:visible!important;pointer-events:none!important}.cross-border-ebay-select{position:fixed!important;z-index:2147483647!important;transform:translateX(-100%)!important;padding:9px 12px!important;border:2px solid #fff!important;border-radius:8px!important;color:#fff!important;background:#4f92cf!important;box-shadow:0 4px 14px rgba(30,91,145,.35)!important;font:700 13px/1 sans-serif!important;white-space:nowrap!important;pointer-events:auto!important;cursor:pointer!important}.cross-border-ebay-select.is-selected{background:#e79500!important}.cross-border-ebay-card-active{outline:3px solid #e79500!important;outline-offset:-3px!important;border-radius:12px!important}.cross-border-ebay-current{top:auto!important;left:auto!important;right:24px!important;bottom:24px!important;transform:none!important;padding:14px 18px!important}';document.documentElement.appendChild(style);
      let queued=false;const queue=()=>{if(queued)return;queued=true;setTimeout(()=>{queued=false;scan()},180)};const observer=new MutationObserver(queue);observer.observe(document.body||document.documentElement,{childList:true,subtree:true});const timer=setInterval(scan,1000);document.addEventListener('scroll',position,true);addEventListener('resize',position);scan();
      window.__crossBorderEbayPlugin={snapshot:()=>({recognizedCount:entries.size,products:[...selected.values()],changes:changes.splice(0)}),sync:products=>{selected.clear();products.forEach(product=>selected.set(product.url,product));entries.forEach(update)},remove:url=>{selected.delete(url);const entry=entries.get(url);if(entry)update(entry)},stop:()=>{observer.disconnect();clearInterval(timer);document.removeEventListener('scroll',position,true);removeEventListener('resize',position);[...entries.values()].forEach(remove);overlay.remove();style.remove();delete window.__crossBorderEbayPlugin}};
      return true;
    })()`)
  }

  async startEbayPlugin(): Promise<EbayBrowserPluginState> {
    const view = this.attached
    if (!view || !this.isEbayView(view)) throw new Error('请先在右侧打开 eBay 页面')
    this.ebayPluginActive = true
    await this.injectEbayPlugin(view)
    return this.getEbayPluginState()
  }

  async getEbayPluginState(): Promise<EbayBrowserPluginState> {
    if (!this.ebayPluginActive) return { active:false, recognizedCount:0, selectedCount:0, products:[] }
    let recognizedCount = 0
    const views=this.getEbayViews()
    for (const view of views) {
      try {
        const snapshot = await view.webContents.executeJavaScript(`window.__crossBorderEbayPlugin?.snapshot?.() || {recognizedCount:0,products:[],changes:[]}`) as { recognizedCount:number; products:EbayCollectedProduct[]; changes:Array<{selected:boolean;product:EbayCollectedProduct}> }
        snapshot.changes.forEach(change=>change.selected?this.ebayPluginProducts.set(change.product.url,change.product):this.ebayPluginProducts.delete(change.product.url))
        if (view === this.attached) recognizedCount = snapshot.recognizedCount
      } catch { /* 页面切换时等待下一次轮询 */ }
    }
    const products=[...this.ebayPluginProducts.values()]
    await Promise.all(views.map(async view=>{try{await view.webContents.executeJavaScript(`window.__crossBorderEbayPlugin?.sync?.(${JSON.stringify(products)})`)}catch{/* 页面切换时等待下一次轮询 */}}))
    return { active:true, recognizedCount, selectedCount:products.length, products }
  }

  async removeEbayPluginProduct(url:string) {
    this.ebayPluginProducts.delete(url)
    await Promise.all(this.getEbayViews().map(async view=>{try{await view.webContents.executeJavaScript(`window.__crossBorderEbayPlugin?.remove?.(${JSON.stringify(url)})`)}catch{/* 页面已切换 */}}))
    return this.getEbayPluginState()
  }

  async clearEbayPluginProducts() {
    this.ebayPluginProducts.clear()
    await Promise.all(this.getEbayViews().map(async view=>{try{await view.webContents.executeJavaScript(`window.__crossBorderEbayPlugin?.sync?.([])`)}catch{/* 页面已切换 */}}))
    return this.getEbayPluginState()
  }

  async stopEbayPlugin() {
    this.ebayPluginActive = false
    this.ebayPluginProducts.clear()
    await Promise.all(this.getEbayViews().map(async view=>{try{await view.webContents.executeJavaScript(`window.__crossBorderEbayPlugin?.stop?.()`)}catch{/* 页面已关闭 */}}))
  }

  private isGigaCloudView(view: WebContentsView) {
    if (view.webContents.isDestroyed()) return false
    try {
      const current = new URL(view.webContents.getURL())
      return current.hostname === 'gigab2b.com' || current.hostname.endsWith('.gigab2b.com')
    } catch { return false }
  }

  private getGigaCloudViews() {
    return [...new Set([...this.views.values(), ...[...this.detailTabs.values()].map(tab => tab.view)])]
      .filter(view => this.isGigaCloudView(view))
  }

  private async readBuiltInCollectorSnapshot(view: WebContentsView): Promise<BuiltInCollectorSnapshot> {
    if (view.webContents.isDestroyed()) return { products: [], visibleUrls: [] }
    try {
      return await view.webContents.executeJavaScript(`(() => window.__crossBorderCollector?.snapshot?.() || { products: [], visibleUrls: [], changes: [] })()`)
    } catch { return { products: [], visibleUrls: [] } }
  }

  private async syncBuiltInCollectorSelection(view: WebContentsView, products: CollectorPluginProduct[]) {
    if (view.webContents.isDestroyed()) return
    try { await view.webContents.executeJavaScript(`window.__crossBorderCollector?.sync?.(${JSON.stringify(products)})`) } catch { /* 页面切换时等待下一次注入 */ }
  }

  private async injectBuiltInCollector(view: WebContentsView) {
    if (!this.isGigaCloudView(view)) return
    const seeded = [...this.builtInCollectorProducts.values()]
    await view.webContents.executeJavaScript(String.raw`(() => {
      const previousSnapshot = window.__crossBorderCollector?.snapshot?.() || {products:[],changes:[]};
      const previousSelected = previousSnapshot.products || [];
      const changes = previousSnapshot.changes || [];
      window.__crossBorderCollector?.stop?.();
      const selected = new Map([...${JSON.stringify(seeded)},...previousSelected].map(item => [item.url, item]));
      const knownCategoryPaths=${JSON.stringify(GIGA_CATEGORY_PATHS)};
      const buttonClass = 'cross-border-collector-select';
      const textOf = node => (node?.innerText || node?.textContent || '').replace(/\s+/g,' ').trim();
      const isRealProductImage = url => /^https?:\/\//i.test(url || '') && !/(?:product_base|placeholder|default[-_]?image|loading|lazyload|blank|transparent|no[-_]?image)/i.test(url);
      const imageUrlOf = image => {
        if (!image) return '';
        const srcset = (image.getAttribute('srcset') || image.getAttribute('data-srcset') || '').split(',').map(value=>value.trim().split(/\s+/)[0]).filter(Boolean).pop() || '';
        return [image.currentSrc,image.src,image.getAttribute('data-src'),image.getAttribute('data-original'),image.getAttribute('data-lazy-src'),image.getAttribute('data-url'),srcset].find(isRealProductImage) || '';
      };
      const categoryIdsOf = rawUrl => {
        try {
          const parsed=new URL(rawUrl,location.href);
          const path=parsed.searchParams.get('path') || parsed.searchParams.get('category_path') || '';
          const direct=parsed.searchParams.get('product_category_id') || parsed.searchParams.get('category_id') || parsed.searchParams.get('categoryId') || '';
          return (path || direct).split(/[_>,\-]+/).map(value=>value.trim()).filter(value=>/^\d+$/.test(value));
        } catch { return []; }
      };
      const categoryContextOf = productUrl => {
        const categoryAnchors=[...document.querySelectorAll('a[href]')].map(node=>{
          const href=node.href || node.getAttribute('href') || '';
          const ids=categoryIdsOf(href);
          const isCategory=/route=product\/category|category_id=|[?&]path=/i.test(href) && !/route=product\/product/i.test(href);
          return {node,href,ids,isCategory};
        }).filter(item=>item.isCategory&&item.ids.length);
        const productIds=categoryIdsOf(productUrl);
        const pageIds=categoryIdsOf(location.href);
        const anchorIds=categoryAnchors.map(item=>item.ids).sort((left,right)=>right.length-left.length)[0] || [];
        const resolved=[{ids:productIds,from:'PRODUCT_URL'},{ids:pageIds,from:'PAGE_CONTEXT'},{ids:anchorIds,from:'BREADCRUMB'}].sort((left,right)=>right.ids.length-left.ids.length)[0];
        const rawIds=resolved.ids.slice(0,3);
        const knownPath=[...rawIds].reverse().map(id=>knownCategoryPaths[id]).find(Boolean);
        const ids=knownPath?knownPath.map(item=>item.id):rawIds;
        const namesById=new Map();
        categoryAnchors.forEach(item=>{const name=textOf(item.node);const id=item.ids[item.ids.length-1];if(id&&name&&name.length<100)namesById.set(id,name)});
        const names=ids.map((id,index)=>knownPath?.[index]?.name || namesById.get(id) || '');
        const level=(index)=>ids[index]?{id:ids[index],name:names[index]||''}:undefined;
        const capturedFrom=resolved.from==='PRODUCT_URL'?'PRODUCT_URL':resolved.from==='BREADCRUMB'?'BREADCRUMB':'PAGE_CONTEXT';
        return {platformCode:'GIGACLOUD',catalogVersion:${JSON.stringify(GIGA_CATALOG_VERSION)},level1:level(0),level2:level(1),level3:level(2),pathIds:ids,pathNames:names.filter(Boolean),capturedFrom,status:knownPath||ids.length>=3?'EXACT':ids.length?'PARTIAL':'NEEDS_REVIEW',capturedAt:new Date().toISOString()};
      };
      const extract = (anchor, source) => {
        const url = new URL(anchor?.href || location.href, location.href);
        const productId = url.searchParams.get('product_id') || textOf(document.body).match(/Item\s*Code\s*:\s*([\w-]+)/i)?.[1] || '';
        let card = source === 'DETAIL' ? document.body : anchor.closest('[class*="product"],[class*="goods"],[class*="card"],li,article');
        if (!card || textOf(card).length < 15) card = anchor?.parentElement?.parentElement || document.body;
        const text = textOf(card);
        const heading = source === 'DETAIL' ? document.querySelector('h1,[class*="product-name"],[class*="product-title"]') : null;
        const imageNodes=[...new Set([...(anchor?.querySelectorAll?.('img') || []),...card.querySelectorAll('img')])];
        const imageChoices=imageNodes.map(image=>({image,url:imageUrlOf(image)})).filter(item=>item.url).sort((left,right)=>((/b2bfiles|gigab2b\.cn/i.test(right.url)?100:0)+Math.min(right.image.naturalWidth||0,1000))-((/b2bfiles|gigab2b\.cn/i.test(left.url)?100:0)+Math.min(left.image.naturalWidth||0,1000)));
        const image=imageChoices[0]?.image || imageNodes[0] || null;
        const backgroundImageUrl=[...card.querySelectorAll('*')].map(node=>getComputedStyle(node).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1] || '').find(isRealProductImage) || '';
        const resolvedImageUrl=imageChoices[0]?.url || backgroundImageUrl;
        const title = textOf(heading) || anchor?.getAttribute('title') || image?.alt || text.slice(0,180);
        const priceText = text.match(/(?:US)?\$\s*[\d,.]+(?:\s*-\s*(?:US)?\$?\s*[\d,.]+)?/i)?.[0] || '';
        const salesText = text.match(/(?:Available\s*Stock|可售库存|库存)\s*[:：]?\s*[\d,]+/i)?.[0] || '';
        const sellableInventory = Number(salesText.match(/[\d,]+/)?.[0]?.replace(/,/g,'') || 0) || null;
        const shippingFeeText = text.match(/(?:Shipping(?:\s*Fee)?|物流费)\s*[:：]?\s*((?:US)?\$\s*[\d,.]+(?:\s*-\s*(?:US)?\$?\s*[\d,.]+)?(?:\s*\/件)?)/i)?.[1] || '';
        const promotionText = text.match(/\d+(?:\.\d+)?%\s*OFF/i)?.[0] || '';
        const gigaIndex = Number(text.match(/(?:Seller\s*)?GIGA\s*Index\s*[:：]?\s*(\d+(?:\.\d+)?)/i)?.[1] || 0) || null;
        const storeReturnRate = text.match(/(?:店铺退货率|Shop\s*Return\s*Rate)\s*[:：]?\s*([^|,，;；]{1,20})/i)?.[1]?.trim() || '';
        const supplierName = text.match(/(?:Seller|Supplier|供应商)\s*[:：]\s*([^|,，;；]{2,80})/i)?.[1]?.trim() || '';
        return { platformCode:'GIGACLOUD', productId, url:url.href, title, imageUrl:resolvedImageUrl, priceText, salesText, shippingFeeText, sellableInventory, promotionText, supplierName, gigaIndex, storeReturnRate, capturedFrom:source, sourceCategory:categoryContextOf(url.href) };
      };
      const overlay=document.createElement('div');overlay.id='cross-border-collector-overlay';document.documentElement.appendChild(overlay);
      const entries=new Map();
      const update = entry => { const chosen=selected.has(entry.product.url); entry.button.textContent=chosen?'✓ 已选':'🤖 采集'; entry.button.classList.toggle('is-selected',chosen); entry.card?.classList.toggle('cross-border-collector-card-active',chosen); };
      const toggle = entry => { const isSelected=!selected.has(entry.product.url);if(isSelected){entry.product={...entry.product,...extract(entry.anchor,entry.product.capturedFrom||'LIST')};selected.set(entry.product.url,entry.product)}else selected.delete(entry.product.url);changes.push({selected:isSelected,product:entry.product});update(entry); };
      const removeEntry = entry => { entry.card?.classList.remove('cross-border-collector-card-active');entry.button.remove();entries.delete(entry.product.url); };
      const position = () => {
        entries.forEach(entry=>{
          if(!entry.anchor?.isConnected||!entry.target?.isConnected){removeEntry(entry);return}
          const rect=entry.target.getBoundingClientRect();
          const visible=rect.width>40&&rect.height>40&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth;
          entry.button.hidden=!visible;if(!visible)return;
          entry.button.style.top=Math.max(6,rect.top+8)+'px';entry.button.style.left=Math.min(innerWidth-8,Math.max(rect.left+80,rect.right-52))+'px';
          update(entry);
        });
      };
      let frame=0;const schedulePosition=()=>position();
      const scan = () => {
        const anchors=[...document.querySelectorAll('a[href*="route=product/product"][href*="product_id="]')];
        const currentUrls=new Set();
        anchors.forEach(anchor => {
          const url=new URL(anchor.href,location.href).href;currentUrls.add(url);
          if(entries.has(url)){const existing=entries.get(url);if(existing.anchor===anchor){existing.target=anchor.querySelector('img')?.parentElement||anchor;return}removeEntry(existing)}
          const card=anchor.closest('[class*="product"],[class*="goods"],[class*="card"],li,article') || anchor.parentElement;
          if(!card)return;
          const product=extract(anchor,'LIST');
          const button=document.createElement('button');button.type='button';button.className=buttonClass;
          const entry={anchor,card,target:anchor.querySelector('img')?.parentElement||anchor,product,button,detail:false};
          button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();toggle(entry)});
          entries.set(url,entry);overlay.appendChild(button);update(entry);
        });
        entries.forEach(entry=>{if(!entry.detail&&!currentUrls.has(entry.product.url))removeEntry(entry)});
        if(location.href.includes('route=product/product')&&!document.querySelector('.cross-border-collector-current')){
          const product=extract(null,'DETAIL');const button=document.createElement('button');button.type='button';button.className=buttonClass+' cross-border-collector-current';
          const entry={anchor:document.documentElement,card:null,target:document.documentElement,product,button,detail:true};button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();toggle(entry)});entries.set(product.url,entry);overlay.appendChild(button);update(entry);
        }
        schedulePosition();
      };
      const style=document.createElement('style');style.id='cross-border-collector-style';style.textContent='#cross-border-collector-overlay{position:fixed!important;z-index:2147483646!important;inset:0!important;width:0!important;height:0!important;overflow:visible!important;pointer-events:none!important}.cross-border-collector-select{position:fixed!important;z-index:2147483647!important;transform:translateX(-100%)!important;padding:9px 12px!important;border:2px solid #fff!important;border-radius:8px!important;color:#fff!important;background:#4f92cf!important;box-shadow:0 4px 14px rgba(30,91,145,.35)!important;font:700 13px/1 sans-serif!important;white-space:nowrap!important;pointer-events:auto!important;cursor:pointer!important}.cross-border-collector-select.is-selected{background:#e79500!important}.cross-border-collector-card-active{outline:3px solid #e79500!important;outline-offset:-3px!important;border-radius:12px!important}.cross-border-collector-select.cross-border-collector-current{top:auto!important;left:auto!important;right:24px!important;bottom:24px!important;transform:none!important;padding:14px 18px!important}';document.documentElement.appendChild(style);
      let timer=0;let scanQueued=false;const queueScan=()=>{if(scanQueued)return;scanQueued=true;timer=setTimeout(()=>{scanQueued=false;scan()},180)};const observer=new MutationObserver(queueScan);observer.observe(document.body||document.documentElement,{childList:true,subtree:true});const scanInterval=setInterval(scan,1000);document.addEventListener('scroll',schedulePosition,true);addEventListener('resize',schedulePosition);scan();
      window.__crossBorderCollector={
        snapshot:()=>({products:[...selected.values()],visibleUrls:[...entries.keys()],changes:changes.splice(0)}),
        sync:products=>{selected.clear();products.forEach(product=>selected.set(product.url,product));entries.forEach(update)},
        remove:url=>{selected.delete(url);const entry=entries.get(url);if(entry)update(entry)},
        stop:()=>{observer.disconnect();clearTimeout(timer);clearInterval(scanInterval);cancelAnimationFrame(frame);document.removeEventListener('scroll',schedulePosition,true);removeEventListener('resize',schedulePosition);[...entries.values()].forEach(removeEntry);overlay.remove();document.querySelector('#cross-border-collector-style')?.remove();delete window.__crossBorderCollector}
      };
      return true;
    })()`)
  }

  async openCredentialLogin(accountId: string, title: string, url: string, domains: string[]) {
    const target = new URL(url)
    const allowed = (rawUrl:string)=>{try{const next=new URL(rawUrl);return next.protocol==='https:'&&domains.some(domain=>next.hostname===domain||next.hostname.endsWith(`.${domain}`))}catch{return false}}
    if (!allowed(target.toString())) throw new Error('登录地址不在平台HTTPS白名单中')
    const loadCredentialUrl=async(view:WebContentsView)=>{
      try {
        await view.webContents.loadURL(target.toString())
      } catch(error) {
        const loadError=error as Error & {code?:string;errno?:number}
        if(view.webContents.isDestroyed())throw error
        const currentUrl=view.webContents.getURL()
        const redirectedToPlatform=Boolean(currentUrl)&&allowed(currentUrl)
        if((loadError.code==='ERR_ABORTED'||loadError.errno===-3)&&redirectedToPlatform)return
        throw error
      }
    }
    // 登录页可能因网络或平台风控长时间处于加载中；先挂载视图，避免界面一直显示空白占位层。
    this.browserVisible = true
    if (accountId === 'supply:GIGACLOUD:default') {
      this.supplyPlatformCode='GIGACLOUD'
      const view=this.supplyViews.get('GIGACLOUD') || this.createView('1688',false)
      this.views.set('1688',view)
      this.active='1688';this.activeTabId='home-1688';this.supplyTitle=title;this.credentialDomains=domains
      this.attachView(view);this.emitTabs();await view.webContents.loadURL(url);return 'home-1688'
    }
    const id = `login-${accountId}`
    const previous = this.detailTabs.get(id)
    if (previous) {
      this.active='web';this.activeTabId=id;this.credentialDomains=domains;this.attachView(previous.view);this.emitTabs()
      if(!allowed(previous.view.webContents.getURL()))await loadCredentialUrl(previous.view)
      return id
    }
    const view = new WebContentsView({ webPreferences:{ partition:`persist:login:${accountId}`,nodeIntegration:false,contextIsolation:true,sandbox:true } })
    const ebayAccount=accountId.startsWith('ebay:')
    view.setBackgroundColor('#ffffff')
    view.webContents.setUserAgent(view.webContents.getUserAgent().replace(/\sElectron\/[^\s]+/g,'').replace(/\scross-border-sourcing-desktop\/[^\s]+/g,''))
    view.webContents.setWindowOpenHandler(({url:next})=>{if(allowed(next))void view.webContents.loadURL(next);return{action:'deny'}})
    view.webContents.on('will-navigate',(event,next)=>{if(!allowed(next))event.preventDefault()})
    const tab: DetailTab = { id,platform:'web',title,view,generic:true,closable:false,scopeId:accountId,domains }
    this.detailTabs.set(id,tab)
    this.bindTabFavicon(tab)
    const emit=()=>{this.emitState('web');this.emitTabs()}
    view.webContents.on('did-navigate',emit)
    view.webContents.on('did-navigate-in-page',()=>{emit();if(this.builtInCollectorActive)void this.injectBuiltInCollector(view).catch(()=>undefined);if(this.ebayPluginActive)void this.injectEbayPlugin(view).catch(()=>undefined)})
    view.webContents.on('did-start-loading',emit)
    view.webContents.on('dom-ready',()=>{if(ebayAccount)void this.injectEbayScrollbars(view).catch(()=>undefined);if(this.builtInCollectorActive)void this.injectBuiltInCollector(view).catch(()=>undefined);if(this.ebayPluginActive)void this.injectEbayPlugin(view).catch(()=>undefined)})
    view.webContents.on('did-stop-loading',()=>{emit();if(ebayAccount)void this.injectEbayScrollbars(view).catch(()=>undefined);if(this.builtInCollectorActive)void this.injectBuiltInCollector(view).catch(()=>undefined);if(this.ebayPluginActive)void this.injectEbayPlugin(view).catch(()=>undefined)})
    this.active='web';this.activeTabId=id;this.credentialDomains=domains;this.attachView(view);this.emitTabs();await loadCredentialUrl(view);return id
  }

  async newEbayTab(accountId:string,title:string,targetUrl='https://www.ebay.com/') {
    if(this.visibleTabCount()>=8)throw new Error('最多同时打开8个浏览标签，请先关闭不需要的标签')
    const base=this.detailTabs.get(`login-${accountId}`)
    if(!base||base.view.webContents.isDestroyed())throw new Error('请先打开当前eBay店铺浏览器')
    const domains=['ebay.com']
    const target=new URL(targetUrl)
    if(target.protocol!=='https:'||!domains.some(domain=>target.hostname===domain||target.hostname.endsWith(`.${domain}`)))throw new Error('原商品链接不属于 eBay，已阻止打开')
    const id=`ebay-${accountId}-${crypto.randomUUID()}`
    const view=new WebContentsView({webPreferences:{partition:`persist:login:${accountId}`,nodeIntegration:false,contextIsolation:true,sandbox:true}})
    view.setBackgroundColor('#ffffff')
    view.webContents.setUserAgent(view.webContents.getUserAgent().replace(/\sElectron\/[^\s]+/g,'').replace(/\scross-border-sourcing-desktop\/[^\s]+/g,''))
    const allowed=(rawUrl:string)=>{try{const next=new URL(rawUrl);return next.protocol==='https:'&&domains.some(domain=>next.hostname===domain||next.hostname.endsWith(`.${domain}`))}catch{return false}}
    view.webContents.setWindowOpenHandler(({url})=>{if(allowed(url))void view.webContents.loadURL(url);return{action:'deny'}})
    view.webContents.on('will-navigate',(event,url)=>{if(!allowed(url))event.preventDefault()})
    const tab:DetailTab={id,platform:'web',title:title||'eBay 新标签页',view,generic:true,closable:true,scopeId:accountId,domains}
    this.detailTabs.set(id,tab)
    this.bindTabFavicon(tab)
    const emit=()=>{this.emitState('web');this.emitTabs()}
    view.webContents.on('did-navigate',()=>{emit();const url=view.webContents.getURL();if(url){try{tab.title=new URL(url).hostname.replace(/^www\./,'')||tab.title}catch{/* 保留标题 */}}this.emitTabs()})
    view.webContents.on('did-navigate-in-page',()=>{emit();if(this.ebayPluginActive)void this.injectEbayPlugin(view).catch(()=>undefined)})
    view.webContents.on('did-start-loading',emit)
    view.webContents.on('dom-ready',()=>{void this.injectEbayScrollbars(view).catch(()=>undefined);if(this.ebayPluginActive)void this.injectEbayPlugin(view).catch(()=>undefined)})
    view.webContents.on('did-stop-loading',()=>{emit();void this.injectEbayScrollbars(view).catch(()=>undefined);if(this.ebayPluginActive)void this.injectEbayPlugin(view).catch(()=>undefined)})
    view.webContents.on('page-title-updated',(_event,pageTitle)=>{tab.title=pageTitle||title||tab.title;this.emitTabs()})
    this.browserVisible=true;this.active='web';this.activeTabId=id;this.credentialDomains=domains;this.attachView(view);this.emitTabs()
    await view.webContents.loadURL(target.toString())
    return id
  }

  async readEbayProductDetails(accountId:string,title:string,targetUrl:string):Promise<EbayProductDetails> {
    const base=this.detailTabs.get(`login-${accountId}`)
    if(!base||base.view.webContents.isDestroyed())throw new Error('请先打开当前eBay店铺并完成登录')
    const target=new URL(targetUrl)
    if(target.protocol!=='https:'||!(target.hostname==='ebay.com'||target.hostname.endsWith('.ebay.com')))throw new Error('原商品链接不属于 eBay，已阻止读取')
    const view=new WebContentsView({webPreferences:{partition:`persist:login:${accountId}`,nodeIntegration:false,contextIsolation:true,sandbox:true}})
    view.setBackgroundColor('#ffffff')
    view.webContents.setUserAgent(base.view.webContents.getUserAgent())
    const script=`(async()=>{
      const clean=value=>(value||'').replace(/\\s+/g,' ').trim();
      const normalizeImage=value=>{try{value=String(value||'').replace(/&amp;/g,'&').trim();if(!value||value.startsWith('data:'))return '';if(value.startsWith('//'))value='https:'+value;const url=new URL(value,location.href);if(url.protocol!=='https:'||!(url.hostname==='ebayimg.com'||url.hostname.endsWith('.ebayimg.com')))return '';url.pathname=url.pathname.replace(/\\/s-l\\d+(?=\\.[a-z0-9]+$)/i,'/s-l1600');return url.toString()}catch{return ''}};
      const images=[],imageKeys=new Set();
      const addImage=value=>{const url=normalizeImage(value);if(!url)return;const key=url.match(/\\/images\\/g\\/([^/]+)/i)?.[1]||url;if(!imageKeys.has(key)){imageKeys.add(key);images.push(url)}};
      const addNode=node=>{if(!node)return;['data-zoom-src','data-src','src'].forEach(name=>addImage(node.getAttribute?.(name)));addImage(node.currentSrc);const srcset=node.getAttribute?.('srcset')||node.getAttribute?.('data-srcset')||'';srcset.split(',').forEach(entry=>addImage(entry.trim().split(/\\s+/)[0]))};
      let structuredProduct=null;
      const addStructured=node=>{if(!node)return;if(Array.isArray(node)){node.forEach(addStructured);return}if(typeof node!=='object')return;const types=Array.isArray(node['@type'])?node['@type']:[node['@type']];if(types.some(type=>String(type).toLowerCase()==='product')){structuredProduct=structuredProduct||node;const values=Array.isArray(node.image)?node.image:[node.image];values.filter(Boolean).forEach(value=>typeof value==='string'?addImage(value):addImage(value?.url||value?.contentUrl))}if(node['@graph'])addStructured(node['@graph'])};
      document.querySelectorAll('script[type="application/ld+json"]').forEach(node=>{try{addStructured(JSON.parse(node.textContent||''))}catch{}});
      const gallerySelectors=['[data-testid*="image-carousel"] img','.ux-image-carousel img','[class*="image-carousel"] img','[class*="image-gallery"] img','[class*="ux-image"] img'];
      gallerySelectors.forEach(selector=>document.querySelectorAll(selector).forEach(addNode));
      document.querySelectorAll('a[href*="i.ebayimg.com"] , source[srcset*="i.ebayimg.com"]').forEach(node=>{addImage(node.getAttribute('href'));addNode(node)});
      const headings=[...document.querySelectorAll('h1,h2,h3,[role="heading"]')];
      const heading=headings.find(node=>/^(item specifics|物品详情|商品详情)$/i.test(clean(node.textContent)));
      const scope=heading?.closest('.ux-layout-section-evo,section,[data-testid*="section"]')||document;
      const pairs=[];
      const add=(name,value)=>{name=clean(name).replace(/:$/,'');value=clean(value);if(!name||!value||name.length>80||value.length>500)return;if(!pairs.some(item=>item.name.toLowerCase()===name.toLowerCase()))pairs.push({name,value});};
      scope.querySelectorAll('.ux-labels-values,[data-testid="ux-labels-values"]').forEach(row=>add(row.querySelector('.ux-labels-values__labels-content,[class*="labels-content"]')?.textContent,row.querySelector('.ux-labels-values__values-content,[class*="values-content"]')?.textContent));
      scope.querySelectorAll('dl').forEach(list=>{const terms=[...list.querySelectorAll(':scope>dt')];terms.forEach(term=>{let value=term.nextElementSibling;while(value&&value.tagName!=='DD')value=value.nextElementSibling;add(term.textContent,value?.textContent)})});
      const conditionNode=[...document.querySelectorAll('.ux-labels-values,[data-testid="ux-labels-values"]')].find(row=>/^condition$/i.test(clean(row.querySelector('.ux-labels-values__labels-content,[class*="labels-content"]')?.textContent).replace(/:$/,'')));
      const condition=clean(conditionNode?.querySelector('.ux-labels-values__values-content,[class*="values-content"]')?.textContent);
      const title=clean(document.querySelector('h1,[data-testid="x-item-title"]')?.textContent||structuredProduct?.name);
      const subtitle=clean(document.querySelector('[data-testid*="subtitle"],.x-item-title__subTitle,[class*="subtitle"]')?.textContent);
      const offers=Array.isArray(structuredProduct?.offers)?structuredProduct.offers[0]:structuredProduct?.offers;
      const visiblePriceText=clean(document.querySelector('[data-testid*="price" i],.x-price-primary,.x-bin-price,[class*="price-primary" i]')?.textContent);
      const rawPrice=clean(offers?.price||document.querySelector('[itemprop="price"]')?.getAttribute('content')||visiblePriceText);
      const price=(rawPrice.match(/[\\d,.]+/)?.[0]||'').replace(/,/g,'');
      const currency=clean(offers?.priceCurrency||document.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content')||(/RMB/i.test(visiblePriceText)?'RMB':/GBP|\u00a3/i.test(visiblePriceText)?'GBP':/EUR|\u20ac/i.test(visiblePriceText)?'EUR':/CNY|\u00a5|\uffe5/i.test(visiblePriceText)?'CNY':/\\$|USD/i.test(visiblePriceText)?'USD':''));
      let descriptionHtml='',descriptionText=clean(structuredProduct?.description);
      const descriptionRoot=document.querySelector('.x-item-description,.d-item-description,#viTabs_0_is');
      if(descriptionRoot){descriptionHtml=String(descriptionRoot.innerHTML||'').slice(0,100000);descriptionText=clean(descriptionRoot.textContent).slice(0,50000)}
      const descriptionFrame=document.querySelector('iframe#desc_ifr,iframe[src*="ebaydesc"],iframe[title*="description" i]');
      if(descriptionFrame?.src&&!descriptionText){try{const response=await fetch(descriptionFrame.src,{credentials:'include'});if(response.ok){const html=await response.text();const parsed=new DOMParser().parseFromString(html,'text/html');descriptionHtml=String(parsed.body?.innerHTML||'').slice(0,100000);descriptionText=clean(parsed.body?.textContent).slice(0,50000)}}catch{}}
      const sectionText=label=>{const head=headings.find(node=>clean(node.textContent).toLowerCase().includes(label));const section=head?.closest('section,.ux-layout-section-evo,[data-testid*="section"]');return clean(section?.textContent).slice(0,3000)};
      const shippingPolicy=sectionText('shipping');
      const returnPolicy=sectionText('return');
      const paymentPolicy=sectionText('payment');
      const sellerNotes=sectionText('seller');
      const text=clean(document.body?.innerText);
      const login=Boolean(document.querySelector('#userid,#pass,input[type="password"]'))||/signin|login/i.test(location.pathname);
      const verification=/captcha|security check|verification code|验证码|安全验证|确认是您本人/i.test(text+' '+location.href);
      return {url:location.href,itemSpecifics:pairs.filter(item=>!/^condition$/i.test(item.name)),condition,imageUrls:images,title,subtitle,descriptionHtml,descriptionText,price,currency,shippingPolicy,returnPolicy,paymentPolicy,sellerNotes,login,verification};
    })()`
    let details:EbayProductDetails&{login?:boolean;verification?:boolean}={url:targetUrl,itemSpecifics:[],condition:'',imageUrls:[]}
    try {
      await Promise.race([
        view.webContents.loadURL(target.toString()),
        this.sleep(25_000).then(()=>{throw new Error('eBay 原商品页加载超时，请检查网络或登录状态后重试')})
      ])
      let previousImageCount=-1,stableImageReads=0
      for(let attempt=0;attempt<12;attempt+=1) {
        details=await view.webContents.executeJavaScript(script) as typeof details
        if(details.login)throw new Error('eBay登录会话已失效，请先返回店铺采集完成登录')
        if(details.verification)throw new Error('eBay要求安全验证，请先在店铺采集浏览器中完成人工验证')
        if(details.imageUrls.length===previousImageCount&&details.imageUrls.length)stableImageReads+=1
        else stableImageReads=0
        previousImageCount=details.imageUrls.length
        if(stableImageReads>=2&&(details.itemSpecifics.length||details.condition||attempt>=3))break
        await this.sleep(750)
      }
    } finally {
      if(!view.webContents.isDestroyed())view.webContents.close()
    }
    if(!details.imageUrls.length&&!details.itemSpecifics.length&&!details.condition)throw new Error('未从原商品页识别到图片或商品属性，请确认商品页已完整加载后重试')
    return {url:details.url,itemSpecifics:details.itemSpecifics,condition:details.condition,imageUrls:details.imageUrls,title:details.title,subtitle:details.subtitle,descriptionHtml:details.descriptionHtml,descriptionText:details.descriptionText,price:details.price,currency:details.currency,shippingPolicy:details.shippingPolicy,returnPolicy:details.returnPolicy,paymentPolicy:details.paymentPolicy,sellerNotes:details.sellerNotes}
  }

  async readEbayRevisionCore(accountId:string,listingId:string,currency:string):Promise<{price:string;currency:string;descriptionText:string;descriptionHtml:string}> {
    const base=this.detailTabs.get(`login-${accountId}`)
    if(!base||base.view.webContents.isDestroyed())throw new Error('请先打开当前 eBay 店铺并完成登录')
    const reviseUrl=`https://www.ebay.com/sl/list?mode=ReviseItem&itemId=${encodeURIComponent(listingId)}&ReturnURL=${encodeURIComponent('https://www.ebay.com/sh/lst/active')}`
    const view=new WebContentsView({webPreferences:{partition:`persist:login:${accountId}`,nodeIntegration:false,contextIsolation:true,sandbox:true}})
    view.setBackgroundColor('#ffffff')
    view.webContents.setUserAgent(base.view.webContents.getUserAgent())
    const script=String.raw`(() => {
      const clean=value=>(value||'').replace(/\s+/g,' ').trim();
      const preserveDescription=value=>String(value||'').replace(/\r\n?/g,'\n').replace(/\u00a0/g,' ');
      const visible=node=>Boolean(node&&node.getClientRects().length&&!node.disabled);
      const bodyText=clean(document.body?.innerText).slice(0,40000);
      const login=Boolean(document.querySelector('#userid,#pass,input[type="password"]'))||/signin|login/i.test(location.pathname);
      const verification=/captcha|security check|verification code|验证码|安全验证|确认是您本人/i.test(bodyText+' '+location.href);
      const roots=[document];
      for(let index=0;index<roots.length;index+=1){roots[index].querySelectorAll('*').forEach(node=>{if(node.shadowRoot&&!roots.includes(node.shadowRoot))roots.push(node.shadowRoot)})}
      const queryAll=selector=>roots.flatMap(root=>[...root.querySelectorAll(selector)]);
      const fields=queryAll('input').filter(visible);
      const explicitLabel=field=>{if(!field.id)return null;for(const root of roots){const label=root.querySelector('label[for="'+CSS.escape(field.id)+'"]');if(label)return label}return null};
      const labelFor=field=>clean(explicitLabel(field)?.textContent||field.closest('label')?.textContent||field.getAttribute('aria-label')||field.getAttribute('placeholder')||field.name||field.id);
      const priceField=fields.find(field=>{const label=labelFor(field)+' '+(field.name||'')+' '+(field.id||'');return /buy it now price|fixed price|item price|商品价格|一口价|立即购买价格/i.test(label)&&!/(shipping|运费|discount|优惠)/i.test(label)})||fields.find(field=>{const label=labelFor(field)+' '+(field.name||'')+' '+(field.id||'');return /price|价格/i.test(label)&&!/(shipping|运费|discount|优惠)/i.test(label)});
      const raw=clean(priceField?.value||'');
      const price=(raw.match(/[\d,.]+/)?.[0]||'').replace(/,/g,'');
      const badDescription=value=>/item specifics\s*condition|brand\s*unbranded[\s\S]*upc\s*does not apply|shipping, returns, and payments/i.test(clean(value));
      const candidates=[];
      const addCandidate=(node,context='',bonus=0)=>{
        if(!node)return;
        const rawText=node.tagName==='TEXTAREA'||node.tagName==='INPUT'?node.value:node.innerText||node.textContent;
        const text=preserveDescription(rawText);
        if(text.length<40||badDescription(text))return;
        const label=clean(labelFor(node)+' '+context+' '+(node.name||'')+' '+(node.id||'')+' '+(node.className||''));
        let score=bonus+(text.length>=150?20:0)+(text.length>=400?10:0);
        if(/description|描述|详情/i.test(label))score+=120;
        if(/title|标题|price|价格|condition|成色|item specifics|物品详情/i.test(label))score-=180;
        const html=node.tagName==='TEXTAREA'||node.tagName==='INPUT'?text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>'):String(node.innerHTML||'');
        candidates.push({text,html,score});
      };
      const editableSelector='textarea,[contenteditable="true"],[role="textbox"]';
      queryAll(editableSelector).forEach(node=>addCandidate(node));
      const headings=queryAll('h1,h2,h3,h4,h5,h6,[role="heading"],label,legend').filter(node=>/^(description|描述)$/i.test(clean(node.textContent)));
      headings.forEach(heading=>{
        heading.scrollIntoView({block:'center'});
        let scope=heading.parentElement;
        for(let depth=0;scope&&depth<7;depth+=1,scope=scope.parentElement){
          const editors=[...scope.querySelectorAll(editableSelector)];
          if(editors.length){editors.forEach(node=>addCandidate(node,'description section',240-depth*15));break}
        }
      });
      queryAll('iframe').forEach(frame=>{
        try{
          const frameBody=frame.contentDocument?.body;
          if(frameBody)addCandidate(frameBody,clean(frame.title+' '+frame.name+' '+frame.id+' '+frame.parentElement?.textContent),/description|描述/i.test(frame.title+' '+frame.name+' '+frame.id)?220:40);
        }catch{}
      });
      candidates.sort((a,b)=>b.score-a.score||b.text.length-a.text.length);
      const description=candidates[0]||{text:'',html:'',score:0};
      return {url:location.href,login,verification,priceReady:Boolean(priceField&&price),descriptionReady:Boolean(description.text&&description.score>=100),price,descriptionText:description.text,descriptionHtml:description.html};
    })()`
    let result:{url:string;login:boolean;verification:boolean;priceReady:boolean;descriptionReady:boolean;price:string;descriptionText:string;descriptionHtml:string}={url:reviseUrl,login:false,verification:false,priceReady:false,descriptionReady:false,price:'',descriptionText:'',descriptionHtml:''}
    try {
      await Promise.race([
        view.webContents.loadURL(reviseUrl),
        this.sleep(25_000).then(()=>{throw new Error('Seller Hub 修改页加载超时，请检查网络或登录状态后重试')})
      ])
      for(let attempt=0;attempt<24;attempt+=1) {
        result=await view.webContents.executeJavaScript(script,true) as typeof result
        if(result.login)throw new Error('eBay 登录会话已失效，请先完成登录')
        if(result.verification)throw new Error('eBay 要求安全验证，请人工完成后重试')
        if(result.priceReady&&result.descriptionReady)break
        await this.sleep(750)
      }
      if(!result.priceReady)throw new Error('未能从 Seller Hub 修改页读取原刊登价格')
      if(!result.descriptionReady)throw new Error('未能从 Seller Hub 修改页读取真实 DESCRIPTION 编辑器内容')
      return {price:result.price,currency,descriptionText:result.descriptionText,descriptionHtml:result.descriptionHtml}
    } finally {
      if(!view.webContents.isDestroyed())view.webContents.close()
    }
  }

  async captureCurrentEbayMarketResearch(accountId:string):Promise<{sourceUrl:string;query:string;periodDays:number;metrics:EbayMarketResearchMetric[];samples:EbayMarketResearchSample[];filters:EbayMarketResearchFilter[]}> {
    const tab=this.detailTabs.get(this.activeTabId)
    if(!tab||tab.scopeId!==accountId||tab.view.webContents.isDestroyed())throw new Error('请先打开当前店铺的“市场实况调研”页面')
    const view=tab.view
    const current=view.webContents.getURL()
    let url:URL
    try { url=new URL(current) } catch { throw new Error('当前页面地址无效，请重新打开市场实况调研') }
    if(!(url.hostname==='ebay.com'||url.hostname.endsWith('.ebay.com'))||url.pathname!=='/sh/research')throw new Error('当前浏览器不是 eBay Product Research 页面，请先点击“市场实况调研”')
    if(view.webContents.isLoading())throw new Error('eBay Research 页面仍在加载，请等待结果完整显示后再采集')
    const result=await view.webContents.executeJavaScript(`(()=>{
      const clean=value=>(value||'').replace(/\\s+/g,' ').trim();
      const rawBodyText=(document.body?.innerText||'').replace(/\\u00a0/g,' ');
      const bodyText=clean(rawBodyText);
      const lines=rawBodyText.split(/\\n+/).map(clean).filter(Boolean);
      const valueAfter=(labels,valuePattern)=>{for(const label of labels){const lowerLabel=label.toLowerCase();const index=lines.findIndex(line=>line.toLowerCase()===lowerLabel||line.toLowerCase().startsWith(lowerLabel+':')||line.toLowerCase().startsWith(lowerLabel+'：'));if(index<0)continue;const inline=clean(lines[index].slice(label.length).replace(/^[:：]/,''));for(const candidate of [inline,lines[index+1]||'']){const match=candidate.match(valuePattern);if(match?.[1])return clean(match[1])}}return''};
      const metric=(key,label,labels,patterns,valuePattern)=>{for(const pattern of patterns){const match=bodyText.match(pattern);if(match?.[1])return {key,label,value:clean(match[1]),available:true}}const value=valueAfter(labels,valuePattern);return {key,label,value:value||'页面未提供',available:Boolean(value)}};
      const metrics=[
        metric('TOTAL_SOLD','已售出',['已售出','总成交量','Total items sold'],[/已售出\\s*([\\d,.]+)/i,/total items sold\\s*([\\d,.]+)/i],/^([\\d,.]+)$/),
        metric('AVERAGE_SOLD_PRICE','平均售价',['平均售价','平均成交价','Average sold price'],[/平均售价\\s*((?:USD|US\\s*\\$|\\$)?\\s*[\\d,.]+)/i,/average sold price\\s*((?:USD|US\\s*\\$|\\$)?\\s*[\\d,.]+)/i],/^((?:USD|US\\s*\\$|\\$)?\\s*[\\d,.]+)$/i),
        metric('SOLD_PRICE_RANGE','售价范围',['售价范围','成交价区间','Sold price range'],[/售价范围\\s*((?:USD|US\\s*\\$|\\$)?\\s*[\\d,.]+\\s*(?:-|–|至|to)\\s*(?:USD|US\\s*\\$|\\$)?\\s*[\\d,.]+)/i],/^((?:USD|US\\s*\\$|\\$)?\\s*[\\d,.]+\\s*(?:-|–|至|to)\\s*(?:USD|US\\s*\\$|\\$)?\\s*[\\d,.]+)$/i),
        metric('AVERAGE_SHIPPING','平均运费',['平均运费','Average shipping'],[/平均运费\\s*((?:USD|US\\s*\\$|\\$)?\\s*[\\d,.]+)/i],/^((?:USD|US\\s*\\$|\\$)?\\s*[\\d,.]+)$/i),
        metric('FREE_SHIPPING_RATE','包邮率',['包邮','包邮率','Free shipping'],[/包邮\\s*([\\d.]+%)/i,/free shipping\\s*([\\d.]+%)/i],/^([\\d.]+%)$/),
        metric('SELL_THROUGH_RATE','售出率',['售出率','售罄率','Sell-through rate'],[/售出率\\s*([\\d.]+%)/i,/sell.through rate\\s*([\\d.]+%)/i],/^([\\d.]+%)$/),
        metric('SELLER_COUNT','卖家总数',['卖家总数','成交卖家数','Total sellers'],[/卖家总数\\s*([\\d,.]+)/i,/total sellers\\s*([\\d,.]+)/i],/^([\\d,.]+)$/)
      ];
      const priceOf=text=>{const match=clean(text).match(/(?:USD|US\\s*\\$|\\$)\\s*([\\d,.]+)/i);return (match?.[1]||'').replace(/,/g,'')};
      const shippingOf=text=>clean(text).match(/(?:运费|shipping)\\s*[:：]?\\s*((?:USD|US\\s*\\$|\\$)?\\s*[\\d,.]+|free|包邮)/i)?.[1]||'';
      const soldDateOf=text=>clean(text).match(/(?:售出日期|成交日期|date last sold|last sold|sold)\\s*[:：]?\\s*([A-Za-z]{3,9}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,4}[\\/-]\\d{1,2}[\\/-]\\d{1,4})/i)?.[1]||'';
      const samples=[],seen=new Set();
      const add=(row,anchor)=>{
        const text=clean(row?.innerText);if(!text||text.length<12)return;
        let href=anchor?.href||'';let itemId=href.match(/\\/itm\\/(?:[^/]+\\/)?(\\d{9,15})/)?.[1]||text.match(/(?:Item\\s*ID|物品编号)\\s*[:：]?\\s*(\\d{9,15})/i)?.[1]||'';
        const titleNode=row.querySelector?.('a[href*="/itm/"],[data-testid*="title"],[class*="title"],h3,h4');
        const title=clean(titleNode?.getAttribute?.('title')||titleNode?.textContent||anchor?.textContent);
        if(title.length<5||/^(shop on ebay|sign in|register|see all|view item|research)$/i.test(title))return;
        const key=itemId||title+'|'+priceOf(text);if(seen.has(key))return;seen.add(key);
        const image=row.querySelector?.('img');
        samples.push({title:title.slice(0,240),price:priceOf(text),currency:'USD',soldDate:soldDateOf(text),url:href||location.href,imageUrl:image?.currentSrc||image?.src||'',itemId,shipping:shippingOf(text),condition:text.match(/(?:Condition|状况)\\s*[:：]?\\s*([^|·]{2,40})/i)?.[1]?.trim()||'',listingFormat:text.match(/(?:Format|格式)\\s*[:：]?\\s*([^|·]{2,40})/i)?.[1]?.trim()||'',soldQuantity:text.match(/(?:Qty sold|数量已售|已售)\\s*[:：]?\\s*([\\d,.]+)/i)?.[1]||''});
      };
      [...document.querySelectorAll('a[href*="/itm/"]')].forEach(anchor=>add(anchor.closest('tr,[role="row"],article,li,[class*="result"],[class*="item"]')||anchor.parentElement,anchor));
      if(!samples.length)[...document.querySelectorAll('tr,[role="row"]')].forEach(row=>add(row,row.querySelector('a[href]')));
      const visible=node=>{const rect=node.getBoundingClientRect();const style=getComputedStyle(node);return rect.width>4&&rect.height>4&&style.display!=='none'&&style.visibility!=='hidden'};
      const filters=[...document.querySelectorAll('button,[role="button"],select')].filter(visible).map(node=>clean(node.getAttribute('aria-label')||node.textContent||node.value)).filter(value=>value&&value.length<100&&/(过去|天|类别|状况|格式|价格|评分|sold|active|category|condition|format|price|marketplace|ebay\\.com)/i.test(value)).slice(0,20).map((value,index)=>({label:'页面筛选 '+(index+1),value}));
      const query=document.querySelector('input[type="search"],input[placeholder*="研究"],input[placeholder*="Search"],input[aria-label*="search" i]')?.value||new URL(location.href).searchParams.get('keywords')||'';
      const dayRange=Number(new URL(location.href).searchParams.get('dayRange')||clean(filters.find(item=>/天|day/i.test(item.value))?.value).match(/\\d+/)?.[0]||30);
      return {sourceUrl:location.href,query:clean(query),periodDays:[30,90,365].includes(dayRange)?dayRange:30,metrics,samples:samples.slice(0,100),filters};
    })()`,true) as {sourceUrl:string;query:string;periodDays:number;metrics:EbayMarketResearchMetric[];samples:EbayMarketResearchSample[];filters:EbayMarketResearchFilter[]}
    if(!result.query)throw new Error('未识别到本次研究关键词，请先在 Research 页面执行一次研究')
    if(!result.metrics.some(item=>item.available)&&!result.samples.length)throw new Error('当前 Research 页面尚未显示可采集结果，请完成关键词研究并等待结果加载')
    return result
  }

  async inspectEbayListingRequirements(accountId:string,listingId:string,title:string):Promise<EbayLocalListingRequirements> {
    const reviseUrl=`https://www.ebay.com/sl/list?mode=ReviseItem&itemId=${encodeURIComponent(listingId)}&ReturnURL=${encodeURIComponent('https://www.ebay.com/sh/lst/active')}`
    const tabId=await this.newEbayTab(accountId,`${title.slice(0,42)} · 读取刊登规则`,reviseUrl)
    const tab=this.detailTabs.get(tabId)
    if(!tab)throw new Error('未能创建 Seller Hub 修改页面')
    const script=String.raw`(() => {
      const clean=value=>(value||'').replace(/\s+/g,' ').trim();
      const visible=node=>Boolean(node&&node.getClientRects().length&&!node.disabled);
      const bodyText=clean(document.body?.innerText).slice(0,30000);
      const login=Boolean(document.querySelector('#userid,#pass,input[type="password"]'))||/signin|login/i.test(location.pathname);
      const verification=/captcha|security check|verification code|验证码|安全验证|确认是您本人/i.test(bodyText+' '+location.href);
      const fields=[...document.querySelectorAll('input,textarea,select,[contenteditable="true"]')];
      const labelFor=field=>{const attributeName=(field.name||'').match(/^(?:search-box-)?attributes[._-]?(.+)$/i)?.[1];if(attributeName)return clean(attributeName.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[._-]+/g,' '));const explicit=field.id?document.querySelector('label[for="'+CSS.escape(field.id)+'"]'):null;return clean(explicit?.textContent||field.closest('label')?.textContent||field.getAttribute('aria-label')||field.getAttribute('placeholder')||field.name||field.id)};
      const categorySpecifics=[];
      for(const field of fields.filter(field=>/attributes/i.test((field.name||'')+' '+(field.id||'')))){const label=labelFor(field);if(!label||label.length>120||/title|标题|description|描述|price|价格|quantity|数量|sku/i.test(label))continue;const name=label.replace(/\*|required soon|recommended|required|必填|建议/ig,'').replace(/[:：]$/,'').trim();if(!name||categorySpecifics.some(item=>item.name.toLowerCase()===name.toLowerCase()))continue;const options=field.tagName==='SELECT'?[...field.options].map(item=>clean(item.textContent)).filter(Boolean).slice(0,100):[];const required=Boolean(field.required||field.getAttribute('aria-required')==='true'||/\[ESSENTIAL\]/i.test(field.id||'')||/\*|required|必填/i.test(label));categorySpecifics.push({name,required,value:clean(field.value||field.textContent),options,source:'SELLER_HUB'})}
      const titleField=fields.find(field=>visible(field)&&/^(title|listing title|item title|物品标题|商品标题|刊登标题)(?:\s|$)/i.test(labelFor(field)))||document.querySelector('input[name="title"],input[id="title"]');
      return {url:location.href,login,verification,ready:Boolean(titleField),categorySpecifics};
    })()`
    let result:{url:string;login:boolean;verification:boolean;ready:boolean;categorySpecifics:EbayCategorySpecificRequirement[]}={url:reviseUrl,login:false,verification:false,ready:false,categorySpecifics:[]}
    for(let attempt=0;attempt<20;attempt+=1){result=await tab.view.webContents.executeJavaScript(script,true) as typeof result;if(result.login)throw new Error('eBay 登录会话已失效，请先完成登录');if(result.verification)throw new Error('eBay 要求安全验证，请人工完成后重试');if(result.ready)break;await this.sleep(750)}
    if(!result.ready)throw new Error('Seller Hub 修改页尚未加载完成，请确认商品仍在线后重试')
    return {sourceUrl:result.url,categorySpecifics:result.categorySpecifics,inspectedAt:new Date().toISOString(),warnings:result.categorySpecifics.length?[]:['页面未读取到类目属性；可能是页面结构变化或该类目没有可见属性']}
  }

  async prepareEbayLocalProductRevision(accountId:string,product:EbayLocalProduct):Promise<EbayLocalRevisionPreparationResult> {
    const snapshot=product.snapshot
    const listing=snapshot.sourceListing
    const details=snapshot.details
    const reviseUrl=`https://www.ebay.com/sl/list?mode=ReviseItem&itemId=${encodeURIComponent(product.listingId)}&ReturnURL=${encodeURIComponent('https://www.ebay.com/sh/lst/active')}`
    const tabId=await this.newEbayTab(accountId,`${product.title.slice(0,42)} · 本地版本待确认`,reviseUrl)
    const tab=this.detailTabs.get(tabId)
    if(!tab)throw new Error('未能创建 Seller Hub 修改页面')
    const payload={
      title:details.title||listing.title,
      price:details.price||listing.price,
      description:details.descriptionHtml||details.descriptionText||'',
      localImageCount:snapshot.media.filter(item=>item.downloadStatus==='DOWNLOADED'&&item.localPath).length
    }
    const script=String.raw`(() => {
      const desired=${JSON.stringify(payload)};
      const clean=value=>(value||'').replace(/\s+/g,' ').trim();
      const visible=node=>Boolean(node&&node.getClientRects().length&&!node.disabled);
      const bodyText=clean(document.body?.innerText).slice(0,40000);
      const login=Boolean(document.querySelector('#userid,#pass,input[type="password"]'))||/signin|login/i.test(location.pathname);
      const verification=/captcha|security check|verification code|验证码|安全验证|确认是您本人/i.test(bodyText+' '+location.href);
      const allFields=[...document.querySelectorAll('input,textarea,select,[contenteditable="true"]')];
      const fields=allFields.filter(visible);
      const labelFor=field=>{const explicit=field.id?document.querySelector('label[for="'+CSS.escape(field.id)+'"]'):null;return clean(explicit?.textContent||field.closest('label')?.textContent||field.getAttribute('aria-label')||field.getAttribute('placeholder')||field.name||field.id)};
      const find=(patterns,selectors='')=>{if(selectors){const direct=document.querySelector(selectors);if(visible(direct))return direct}return fields.find(field=>patterns.some(pattern=>pattern.test(labelFor(field)+' '+(field.name||'')+' '+(field.id||''))))};
      const setValue=(field,value)=>{if(!field||value===undefined||value===null||value==='')return false;if(field.type==='checkbox'){const checked=Boolean(value);if(field.checked!==checked){field.click()}return true}if(field.tagName==='SELECT'){const normalized=clean(String(value)).toLowerCase();const option=[...field.options].find(item=>clean(item.value).toLowerCase()===normalized||clean(item.textContent).toLowerCase()===normalized);if(!option)return false;field.value=option.value}else if(field.isContentEditable){field.textContent=String(value);field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:String(value)}))}else{const proto=field.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')?.set?.call(field,String(value))}field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));field.dispatchEvent(new Event('blur',{bubbles:true}));return true};
      const filledFields=[],skippedFields=[],warnings=[];
      const fill=(label,field,value)=>{if(setValue(field,value))filledFields.push(label);else if(value!==undefined&&value!==null&&String(value).trim())skippedFields.push(label)};
      const titleField=find([/^(item |listing )?title\b/i,/物品标题|商品标题|刊登标题/], 'input[name="title"],input[id="title"]');
      fill('标题',titleField,desired.title);
      fill('价格',find([/^price\b|buy it now price|starting price/i,/价格|一口价|起拍价/]),desired.price);
      const descriptionField=allFields.find(field=>field.tagName==='TEXTAREA'&&/description|详情|描述/i.test(labelFor(field)))||fields.find(field=>field.isContentEditable&&/description|详情|描述/i.test(labelFor(field)));
      fill('描述',descriptionField,desired.description);
      const submitButtonDetected=[...document.querySelectorAll('button,input[type="submit"],a[role="button"]')].filter(visible).some(node=>/^(submit|publish|list it|revise it|update listing|save changes|modify|提交|发布|修改|确认修改|更新刊登)/i.test(clean(node.textContent||node.value||node.getAttribute('aria-label'))));
      if(desired.localImageCount)warnings.push('本地已保存 '+desired.localImageCount+' 张图片；为防止误覆盖线上媒体，图片仍需在本页人工核对。');
      warnings.push('本次只准备标题、描述和价格；其余 eBay 字段保持线上原值。');
      let banner=document.getElementById('__cross_border_local_revision_guard');if(!banner){banner=document.createElement('div');banner.id='__cross_border_local_revision_guard';banner.style.cssText='position:fixed;z-index:2147483647;left:20px;right:20px;bottom:20px;padding:14px 18px;border:2px solid #12a9a3;border-radius:12px;background:#e8faf8;color:#075b57;font:700 14px/20px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.18)';document.body.appendChild(banner)}banner.textContent='已从本地版本填写 '+[...new Set(filledFields)].length+' 项，跳过 '+[...new Set(skippedFields)].length+' 项；尚未提交。请逐项核对图片、类目、业务政策和费用，再由您点击 eBay 最终提交按钮。';
      return {url:location.href,login,verification,ready:Boolean(titleField),filledFields:[...new Set(filledFields)],skippedFields:[...new Set(skippedFields)],warnings,submitButtonDetected};
    })()`
    let result:{url:string;login:boolean;verification:boolean;ready:boolean;filledFields:string[];skippedFields:string[];warnings:string[];submitButtonDetected:boolean}={url:reviseUrl,login:false,verification:false,ready:false,filledFields:[],skippedFields:[],warnings:[],submitButtonDetected:false}
    for(let attempt=0;attempt<20;attempt+=1){result=await tab.view.webContents.executeJavaScript(script,true) as typeof result;if(result.login)throw new Error('eBay 登录会话已失效，请先完成登录');if(result.verification)throw new Error('eBay 要求安全验证，请人工完成后重试');if(result.ready&&result.submitButtonDetected)break;await this.sleep(750)}
    if(!result.ready)throw new Error('Seller Hub 修改页尚未加载出标题字段，请确认商品仍在线后重试')
    return {reviseUrl:result.url,filledFields:result.filledFields,skippedFields:result.skippedFields,warnings:result.warnings,submitButtonDetected:result.submitButtonDetected,preparedAt:new Date().toISOString()}
  }

  async prepareEbayListingRevision(accountId:string,draft:EbayOptimizationDraft):Promise<{reviseUrl:string;categorySpecifics:EbayCategorySpecificRequirement[];filledFields:string[];warnings:string[];submitButtonDetected:boolean}> {
    const reviseUrl=`https://www.ebay.com/sl/list?mode=ReviseItem&itemId=${encodeURIComponent(draft.listingId)}&ReturnURL=${encodeURIComponent('https://www.ebay.com/sh/lst/active')}`
    const tabId=await this.newEbayTab(accountId,`${draft.selectedTitle.slice(0,42)} · 待确认发布`,reviseUrl)
    const tab=this.detailTabs.get(tabId)
    if(!tab)throw new Error('未能创建 Seller Hub 修改页面')
    const view=tab.view
    let result:{url:string;login:boolean;verification:boolean;ready:boolean;categorySpecifics:EbayCategorySpecificRequirement[];filledFields:string[];warnings:string[];submitButtonDetected:boolean}={url:reviseUrl,login:false,verification:false,ready:false,categorySpecifics:[],filledFields:[],warnings:[],submitButtonDetected:false}
    const script=String.raw`(() => {
      const clean=value=>(value||'').replace(/\s+/g,' ').trim();
      const visible=node=>Boolean(node&&node.getClientRects().length&&!node.disabled);
      const bodyText=clean(document.body?.innerText).slice(0,30000);
      const login=Boolean(document.querySelector('#userid,#pass,input[type="password"]'))||/signin|login/i.test(location.pathname);
      const verification=/captcha|security check|verification code|验证码|安全验证|确认是您本人/i.test(bodyText+' '+location.href);
      const allFields=[...document.querySelectorAll('input,textarea,select,[contenteditable="true"]')];const fields=allFields.filter(visible);
      const labelFor=field=>{const attributeName=(field.name||'').match(/^(?:search-box-)?attributes[._]?(.+)$/i)?.[1];if(attributeName)return clean(attributeName.replace(/([a-z])([A-Z])/g,'$1 $2'));const explicit=field.id?document.querySelector('label[for="'+CSS.escape(field.id)+'"]'):null;return clean(explicit?.textContent||field.closest('label')?.textContent||field.getAttribute('aria-label')||field.getAttribute('placeholder')||field.name||field.id)};
      const setValue=(field,value)=>{if(!field||!value)return false;if(field.tagName==='SELECT'){const option=[...field.options].find(item=>clean(item.value).toLowerCase()===clean(value).toLowerCase()||clean(item.textContent).toLowerCase()===clean(value).toLowerCase());if(!option)return false;field.value=option.value}else if(field.isContentEditable){field.textContent=value;field.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}))}else{const proto=field.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')?.set?.call(field,value)}field.dispatchEvent(new Event('input',{bubbles:true}));field.dispatchEvent(new Event('change',{bubbles:true}));field.dispatchEvent(new Event('blur',{bubbles:true}));return true};
      const titleField=fields.find(field=>/^(title|listing title|商品标题|刊登标题)/i.test(labelFor(field))||/title/i.test(field.name||field.id||''));
      const descriptionField=allFields.find(field=>field.tagName==='TEXTAREA'&&/description|详情|描述/i.test(labelFor(field)))||fields.find(field=>field.isContentEditable&&/description|详情|描述/i.test(labelFor(field)));
      const filledFields=[];if(setValue(titleField,${JSON.stringify(draft.selectedTitle)}))filledFields.push('标题');if(setValue(descriptionField,${JSON.stringify(draft.description)}))filledFields.push('英文详情');
      const desired=new Map(${JSON.stringify(draft.itemSpecifics.map(item=>[item.name.toLowerCase(),item.value]))});const categorySpecifics=[];
      const specificFields=allFields.filter(field=>/attributes/i.test((field.name||'')+' '+(field.id||'')));
      for(const field of specificFields){const label=labelFor(field);if(!label||label.length>120||/title|标题|description|描述|price|价格|quantity|数量|sku/i.test(label))continue;const normalized=label.replace(/\*|required|必填/ig,'').replace(/[:：]$/,'').trim();const options=field.tagName==='SELECT'?[...field.options].map(item=>clean(item.textContent)).filter(Boolean).slice(0,80):[];const required=Boolean(field.required||field.getAttribute('aria-required')==='true'||/\[ESSENTIAL\]/i.test(field.id||'')||/\*|required|必填/i.test(label));const current=clean(field.value||field.textContent);if(required||options.length||desired.has(normalized.toLowerCase())){categorySpecifics.push({name:normalized,required,value:current,options,source:'SELLER_HUB'});const value=desired.get(normalized.toLowerCase());if(value&&visible(field)&&setValue(field,value))filledFields.push('属性：'+normalized)}}
      const actions=[...document.querySelectorAll('button,input[type="submit"],a[role="button"]')].filter(visible);const submitButtonDetected=actions.some(node=>/^(submit|publish|list it|revise it|update listing|save changes|modify|提交|发布|修改|确认修改|更新刊登)/i.test(clean(node.textContent||node.value||node.getAttribute('aria-label'))));
      let banner=document.getElementById('__cross_border_publish_guard');if(!banner){banner=document.createElement('div');banner.id='__cross_border_publish_guard';banner.style.cssText='position:fixed;z-index:2147483647;left:20px;right:20px;bottom:20px;padding:14px 18px;border:2px solid #12a9a3;border-radius:12px;background:#e8faf8;color:#075b57;font:700 14px/20px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.18)';document.body.appendChild(banner)}banner.textContent='第五步：已统一预填 '+filledFields.length+' 项确认资料，尚未提交。图片、价格、库存和业务政策保留线上原值，请人工核对全部资料后再点击 eBay 最终提交按钮。';
      const warnings=[];if(!titleField)warnings.push('未识别标题输入框');if(!descriptionField)warnings.push('未识别描述输入框，可能位于独立编辑器');if(!submitButtonDetected)warnings.push('尚未识别最终提交按钮，请确认页面已完整加载');warnings.push('图片、价格、库存和业务政策保留 Seller Hub 线上原值，最终提交前需人工核对');
      return {url:location.href,login,verification,ready:Boolean(titleField&&descriptionField&&submitButtonDetected),categorySpecifics,filledFields:[...new Set(filledFields)],warnings,submitButtonDetected};
    })()`
    let previousSpecificCount=-1,stableReads=0
    for(let attempt=0;attempt<20;attempt+=1){result=await view.webContents.executeJavaScript(script,true) as typeof result;if(result.login)throw new Error('eBay登录会话已失效，请先完成登录');if(result.verification)throw new Error('eBay要求安全验证，请人工完成后重试');if(result.ready){if(result.categorySpecifics.length===previousSpecificCount)stableReads+=1;else stableReads=0;previousSpecificCount=result.categorySpecifics.length;if(stableReads>=2&&attempt>=5)break}await this.sleep(750)}
    if(!result.ready)throw new Error('Seller Hub 修改页尚未加载出可填写字段，请确认商品仍在线并重试')
    return {reviseUrl:result.url,categorySpecifics:result.categorySpecifics,filledFields:result.filledFields,warnings:result.warnings,submitButtonDetected:result.submitButtonDetected}
  }

  async prepareEbayVideoUpload(accountId:string,draft:EbayOptimizationDraft,videoPath:string):Promise<{status:'FILE_SELECTED'|'MANUAL_SELECTION_REQUIRED'|'FAILED';reviseUrl:string;fileInputDetected:boolean;preparedAt:string;message:string}> {
    const expected=`itemId=${encodeURIComponent(draft.listingId)}`
    let tab=[...this.detailTabs.values()].find(item=>item.scopeId===accountId&&item.view.webContents.getURL().includes(expected))
    if(!tab){
      const reviseUrl=`https://www.ebay.com/sl/list?mode=ReviseItem&itemId=${encodeURIComponent(draft.listingId)}&ReturnURL=${encodeURIComponent('https://www.ebay.com/sh/lst/active')}`
      const tabId=await this.newEbayTab(accountId,`${draft.selectedTitle.slice(0,38)} · 视频待上传`,reviseUrl)
      tab=this.detailTabs.get(tabId)
    }
    if(!tab)throw new Error('未能打开 Seller Hub 视频上传页面')
    const view=tab.view
    const inspect=String.raw`(() => {
      const clean=value=>(value||'').replace(/\s+/g,' ').trim();
      const visible=node=>Boolean(node&&node.getClientRects().length&&!node.disabled);
      const bodyText=clean(document.body?.innerText).slice(0,30000);
      const login=Boolean(document.querySelector('#userid,#pass,input[type="password"]'))||/signin|login/i.test(location.pathname);
      const verification=/captcha|security check|verification code|验证码|安全验证|确认是您本人/i.test(bodyText+' '+location.href);
      const selector='input[type="file"][accept*="video"],input[type="file"][id*="video"],input[type="file"][name*="video"]';
      let input=document.querySelector(selector);
      if(!input){const action=[...document.querySelectorAll('button,[role="button"],a')].find(node=>visible(node)&&/^(add video|upload video|video|添加视频|上传视频)$/i.test(clean(node.textContent||node.getAttribute('aria-label'))));if(action)action.click()}
      input=document.querySelector(selector);
      let banner=document.getElementById('__cross_border_publish_guard');if(!banner){banner=document.createElement('div');banner.id='__cross_border_publish_guard';banner.style.cssText='position:fixed;z-index:2147483647;left:20px;right:20px;bottom:20px;padding:14px 18px;border:2px solid #12a9a3;border-radius:12px;background:#e8faf8;color:#075b57;font:700 14px/20px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.18)';document.body.appendChild(banner)}banner.textContent=input?'砚都助手已定位视频上传控件，正在选择本地视频；尚未提交。':'尚未识别 eBay 视频上传控件。视频文件已生成，请在本页人工选择；系统不会点击最终提交。';
      return {url:location.href,login,verification,fileInputDetected:Boolean(input)};
    })()`
    let state:{url:string;login:boolean;verification:boolean;fileInputDetected:boolean}={url:view.webContents.getURL(),login:false,verification:false,fileInputDetected:false}
    for(let attempt=0;attempt<16;attempt+=1){
      state=await view.webContents.executeJavaScript(inspect,true) as typeof state
      if(state.login)throw new Error('eBay登录会话已失效，请先完成登录')
      if(state.verification)throw new Error('eBay要求安全验证，请人工完成后重试')
      if(state.fileInputDetected)break
      await this.sleep(750)
    }
    if(!state.fileInputDetected)return {status:'MANUAL_SELECTION_REQUIRED',reviseUrl:state.url,fileInputDetected:false,preparedAt:new Date().toISOString(),message:'Seller Hub 当前页面未暴露视频文件控件，已打开修改页，请人工点击“添加视频”并选择已生成文件；系统未提交'}
    const debuggerApi=view.webContents.debugger
    const attachedHere=!debuggerApi.isAttached()
    try {
      if(attachedHere)debuggerApi.attach('1.3')
      const documentResult=await debuggerApi.sendCommand('DOM.getDocument',{depth:-1,pierce:true}) as {root:{nodeId:number}}
      const selected=await debuggerApi.sendCommand('DOM.querySelector',{nodeId:documentResult.root.nodeId,selector:'input[type="file"][accept*="video"],input[type="file"][id*="video"],input[type="file"][name*="video"]'}) as {nodeId:number}
      if(!selected.nodeId)throw new Error('视频上传控件已变化，请人工选择文件')
      await debuggerApi.sendCommand('DOM.setFileInputFiles',{nodeId:selected.nodeId,files:[videoPath]})
      await this.sleep(1000)
      const processing=await view.webContents.executeJavaScript(`(()=>/正在审查|processing|reviewing|uploading|正在上传/i.test(document.body?.innerText||''))()`,true) as boolean
      await view.webContents.executeJavaScript(`(()=>{const banner=document.getElementById('__cross_border_publish_guard');if(banner)banner.textContent='砚都助手已选择本地视频文件，eBay ${processing?'已开始审查':'可能正在上传或处理'}；尚未提交。请人工检查视频状态，再由您点击最终提交按钮。'})()`,true)
      return {status:'FILE_SELECTED',reviseUrl:state.url,fileInputDetected:true,preparedAt:new Date().toISOString(),message:`已选择本地视频文件，eBay ${processing?'已开始审查':'可能正在上传或处理'}；尚未提交，请人工确认处理结果`}
    } catch(error) {
      return {status:'MANUAL_SELECTION_REQUIRED',reviseUrl:state.url,fileInputDetected:true,preparedAt:new Date().toISOString(),message:`已定位视频区域，但自动选择文件失败：${error instanceof Error?error.message:'未知错误'}；请人工选择，系统未提交`}
    } finally {
      if(attachedHere&&debuggerApi.isAttached())debuggerApi.detach()
    }
  }

  async inspectEbayListingAcceptance(accountId:string,draft:EbayOptimizationDraft):Promise<EbaySellerHubAcceptanceSnapshot> {
    const expected=`mode=ReviseItem`
    let tab=[...this.detailTabs.values()].find(item=>item.scopeId===accountId&&item.view.webContents.getURL().includes(expected))
    if(!tab){
      const reviseUrl=`https://www.ebay.com/sl/list?mode=ReviseItem&itemId=${encodeURIComponent(draft.listingId)}&ReturnURL=${encodeURIComponent('https://www.ebay.com/sh/lst/active')}`
      const tabId=await this.newEbayTab(accountId,`${draft.selectedTitle.slice(0,38)} · 第三阶段验收`,reviseUrl)
      tab=this.detailTabs.get(tabId)
    }
    if(!tab)throw new Error('未能打开 Seller Hub 验收页面')
    const view=tab.view
    const script=String.raw`(() => {
      const clean=value=>(value||'').replace(/\s+/g,' ').trim();
      const visible=node=>Boolean(node&&node.getClientRects().length&&!node.disabled);
      const bodyText=clean(document.body?.innerText).slice(0,40000);
      const login=Boolean(document.querySelector('#userid,#pass,input[type="password"]'))||/signin|login/i.test(location.pathname);
      const verification=/captcha|security check|verification code|验证码|安全验证|确认是您本人/i.test(bodyText+' '+location.href);
      const fields=[...document.querySelectorAll('input,textarea,select,[contenteditable="true"]')];
      const labelFor=field=>{const explicit=field.id?document.querySelector('label[for="'+CSS.escape(field.id)+'"]'):null;return clean(explicit?.textContent||field.closest('label')?.textContent||field.getAttribute('aria-label')||field.getAttribute('placeholder')||field.name||field.id)};
      const titleField=fields.find(field=>visible(field)&&/^(title|listing title|item title|物品标题|商品标题|刊登标题)(?:\s|$)/i.test(labelFor(field)))||document.querySelector('input[name="title"],input[id="title"]');
      const descriptionField=fields.find(field=>field.tagName==='TEXTAREA'&&/description|详情|描述/i.test(labelFor(field)))||fields.find(field=>field.isContentEditable&&/description|详情|描述/i.test(labelFor(field)));
      const specifics=[];for(const field of fields.filter(field=>/attributes/i.test((field.name||'')+' '+(field.id||'')))){const rawKey=((field.name||field.id||'').match(/^(?:search-box-)?attributes[._-]?(.+)$/i)||[])[1]||'';const inferredName=clean(rawKey.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[._-]+/g,' '));const label=labelFor(field);const name=(inferredName||label).replace(/\*|required|必填/ig,'').replace(/[:：]$/,'').trim();if(!name||name.length>120)continue;const required=Boolean(field.required||field.getAttribute('aria-required')==='true'||/\[ESSENTIAL\]/i.test(field.id||'')||/\*|required|必填/i.test(label)||/^search-box-attributes/i.test(field.name||''));let value=clean(field.value||field.textContent);if(!value){let node=field.parentElement;for(let depth=0;node&&depth<6;depth+=1,node=node.parentElement){const text=clean(node.innerText);if(!text||text.length>220)continue;const escapedName=name.replace(/[\\^$.*+?()[\]{}|]/g,'\\$&');const candidate=text.replace(new RegExp(escapedName,'ig'),'').replace(/\*|required|必填|recommended|建议/ig,'').replace(/搜索或输入您自己的内容。?|search or enter your own/ig,'').replace(/\s+/g,' ').trim();if(candidate&&candidate.length<120){value=candidate;break}}}if(required&&!specifics.some(item=>item.name.toLowerCase()===name.toLowerCase()))specifics.push({name,value})}
      const actions=[...document.querySelectorAll('button,input[type="submit"],a[role="button"]')].filter(visible);const submitButtonDetected=actions.some(node=>/^(submit|publish|list it|revise it|update listing|save changes|modify|提交|发布|修改|确认修改|更新刊登)/i.test(clean(node.textContent||node.value||node.getAttribute('aria-label'))));
      const videoStatus=bodyText.match(/00:15\s*(正在审查|processing|reviewing|ready|已就绪)?/i)?.[0]||'';
      return {url:location.href,login,verification,title:clean(titleField?.value||titleField?.textContent),descriptionLength:clean(descriptionField?.value||descriptionField?.textContent).length,requiredSpecifics:specifics,submitButtonDetected,videoStatus,fieldsReady:Boolean(titleField&&submitButtonDetected)};
    })()`
    let result:{url:string;login:boolean;verification:boolean;title:string;descriptionLength:number;requiredSpecifics:Array<{name:string;value:string}>;submitButtonDetected:boolean;videoStatus:string;fieldsReady:boolean}={url:view.webContents.getURL(),login:false,verification:false,title:'',descriptionLength:0,requiredSpecifics:[],submitButtonDetected:false,videoStatus:'',fieldsReady:false}
    for(let attempt=0;attempt<18;attempt+=1){
      result=await view.webContents.executeJavaScript(script,true) as typeof result
      if(result.login||result.verification||result.fieldsReady)break
      await this.sleep(750)
    }
    const pageStatus:EbaySellerHubAcceptanceSnapshot['pageStatus']=result.login?'LOGIN_EXPIRED':result.verification?'VERIFICATION_REQUIRED':result.fieldsReady?'READY':'FIELDS_UNAVAILABLE'
    return {...result,pageStatus,inspectedAt:new Date().toISOString()}
  }

  async readEbayMarketResearch(accountId:string,input:{query:string;categoryId:string;condition:string;marketplaceId:string;periodDays:number}):Promise<Pick<EbayMarketResearchSnapshot,'source'|'sourceUrl'|'metrics'|'samples'>> {
    const base=this.detailTabs.get(`login-${accountId}`)
    if(!base||base.view.webContents.isDestroyed())throw new Error('请先打开当前 eBay 店铺并完成登录')
    const query=input.query.replace(/\s+/g,' ').trim()
    if(!query)throw new Error('请先填写市场调研核心商品词')
    const marketplace=input.marketplaceId==='EBAY_US'?'EBAY-US':input.marketplaceId.replace('_','-')
    const endDate=Date.now(),startDate=endDate-Math.max(1,input.periodDays)*86_400_000
    const researchUrl=new URL('https://www.ebay.com/sh/research')
    researchUrl.searchParams.set('marketplace',marketplace)
    researchUrl.searchParams.set('keywords',query)
    researchUrl.searchParams.set('dayRange',String(input.periodDays))
    researchUrl.searchParams.set('endDate',String(endDate))
    researchUrl.searchParams.set('startDate',String(startDate))
    researchUrl.searchParams.set('categoryId',input.categoryId||'0')
    const conditionText=input.condition.toLowerCase().trim()
    const conditionId=/^(?:new other|全新其他)\b/.test(conditionText)?'1500':/^(?:new|brand[- ]new|全新)\b/.test(conditionText)?'1000':/certified refurbished|认证翻新/.test(conditionText)?'2000':/seller refurbished|卖家翻新/.test(conditionText)?'2500':/for parts|not working|零件|无法使用/.test(conditionText)?'7000':/acceptable|尚可/.test(conditionText)?'6000':/very good|很好/.test(conditionText)?'4000':/\bgood\b|良好/.test(conditionText)?'5000':/\bused\b|pre-owned|二手/.test(conditionText)?'3000':''
    if(conditionId)researchUrl.searchParams.set('condition',`Condition:::${conditionId}`)
    researchUrl.searchParams.set('offset','0')
    researchUrl.searchParams.set('limit','50')
    researchUrl.searchParams.set('tabName','SOLD')
    researchUrl.searchParams.set('tz',Intl.DateTimeFormat().resolvedOptions().timeZone||'Asia/Shanghai')
    const view=new WebContentsView({webPreferences:{partition:`persist:login:${accountId}`,nodeIntegration:false,contextIsolation:true,sandbox:true}})
    view.setBackgroundColor('#ffffff')
    view.webContents.setUserAgent(base.view.webContents.getUserAgent())
    const extractScript=`(()=>{
      const clean=value=>(value||'').replace(/\\s+/g,' ').trim();
      const bodyText=clean(document.body?.innerText);const lower=bodyText.toLowerCase();
      const login=Boolean(document.querySelector('#userid,#pass,input[type="password"]'))||/signin|login/.test(location.pathname.toLowerCase());
      const verification=/captcha|security check|verification code|验证码|安全验证|确认是您本人/i.test(bodyText+' '+location.href);
      const moneyOf=text=>{const match=clean(text).match(/(RMB|CNY|USD|US\\s*\\$|\\$)\\s*([\\d,.]+)/i);if(!match)return {price:'',currency:'USD'};const token=match[1].toUpperCase();return {price:match[2].replace(/,/g,''),currency:/RMB|CNY/.test(token)?'CNY':'USD'}};
      const dateOf=text=>clean(text).match(/(?:date last sold|last sold|sold|售出日期|成交日期)[:：]?\\s*([A-Za-z]{3,9}\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,4}[\\/-]\\d{1,2}[\\/-]\\d{1,4})/i)?.[1]||'';
      const soldQuantityOf=text=>{const match=clean(text).match(/(?:qty|quantity)\\s*sold[:：]?\\s*([\\d,.]+)|\\bsold[:：]?\\s*([\\d,.]+)|([\\d,.]+)\\s+(?:sold|已售)/i);return match?match.slice(1).find(Boolean)?.replace(/,/g,'')||'':''};
      const shippingOf=text=>clean(text).match(/(?:shipping|运费)\\s*[:：]?\\s*((?:RMB|CNY|USD|US\\s*\\$|\\$)?\\s*[\\d,.]+|free|包邮)/i)?.[1]||'';
      const samples=[],seen=new Set();
      [...document.querySelectorAll('a[href*="/itm/"]')].forEach(anchor=>{try{const url=new URL(anchor.href,location.href);const id=url.pathname.match(/\\/itm\\/(?:[^/]+\\/)?(\\d{9,15})/)?.[1]||url.pathname;if(seen.has(id))return;const row=anchor.closest('li.s-card,li.s-item')||anchor.closest('tr,[role="row"],article')||anchor.parentElement;const rowText=clean(row?.innerText);const titleNode=row?.querySelector('.s-card__title,.s-item__title,[data-testid*="title"],h3,[role="heading"],[class*="title"]');const candidates=[titleNode?.textContent,anchor.textContent,anchor.getAttribute('title')].map(value=>clean(value).replace(/^new listing\\s*/i,'').replace(/opens? in (?:a )?new window or tab/ig,'').trim());const title=candidates.find(value=>value.length>=5&&!/^(?:shop on ebay|sign in|register|see all|view item|research|new window|window|tab)$/i.test(value))||'';if(title.length<5||rowText.length<10)return;const image=row?.querySelector('img');const money=moneyOf(rowText);seen.add(id);samples.push({title:title.slice(0,240),price:money.price,currency:money.currency,soldDate:dateOf(rowText),url:url.toString(),imageUrl:image?.currentSrc||image?.src||'',itemId:id,shipping:shippingOf(rowText),condition:rowText.match(/\\b(Brand New|New|Pre-Owned|Used|Very Good|Good|Acceptable)\\b/i)?.[1]||'',listingFormat:rowText.match(/\\b(Buy It Now|Best Offer|Auction|\\d+ bids?)\\b/i)?.[1]||'',soldQuantity:soldQuantityOf(rowText)})}catch{}});
      const metric=(key,label,patterns)=>{for(const pattern of patterns){const match=bodyText.match(pattern);if(match?.[1])return {key,label,value:clean(match[1]),available:true}}return {key,label,value:'页面未提供',available:false}};
      const metrics=[
        metric('TOTAL_SOLD','总成交量',[/total items sold[:：]?\\s*([\\d,.]+)/i,/items sold[:：]?\\s*([\\d,.]+)/i,/总成交量[:：]?\\s*([\\d,.]+)/i]),
        metric('AVERAGE_SOLD_PRICE','平均成交价',[/average sold price[:：]?\\s*((?:US\\s*)?\\$[\\d,.]+)/i,/avg sold price[:：]?\\s*((?:US\\s*)?\\$[\\d,.]+)/i,/平均成交价[:：]?\\s*([^ ]+)/i]),
        metric('SOLD_PRICE_RANGE','成交价区间',[/sold price range[:：]?\\s*((?:US\\s*)?\\$[\\d,.]+\\s*(?:-|to|–)\\s*(?:US\\s*)?\\$[\\d,.]+)/i,/成交价区间[:：]?\\s*([^ ]+\\s*[-–至]\\s*[^ ]+)/i]),
        metric('AVERAGE_SHIPPING','平均运费',[/average shipping[:：]?\\s*((?:US\\s*)?\\$[\\d,.]+)/i,/avg shipping[:：]?\\s*((?:US\\s*)?\\$[\\d,.]+)/i,/平均运费[:：]?\\s*([^ ]+)/i]),
        metric('SELL_THROUGH_RATE','售罄率',[/sell.through rate[:：]?\\s*([\\d.]+%)/i,/售罄率[:：]?\\s*([\\d.]+%)/i]),
        metric('SELLER_COUNT','成交卖家数',[/total sellers[:：]?\\s*([\\d,.]+)/i,/number of sellers[:：]?\\s*([\\d,.]+)/i,/成交卖家数[:：]?\\s*([\\d,.]+)/i]),
        metric('FREE_SHIPPING_RATE','包邮率',[/free shipping rate[:：]?\\s*([\\d.]+%)/i,/包邮率[:：]?\\s*([\\d.]+%)/i])
      ];
      return {url:location.href,login,verification,bodyText:bodyText.slice(0,500),samples:samples.slice(0,240),metrics,ready:samples.length>0||metrics.some(item=>item.available),blocked:/access denied|temporarily unavailable|not available/i.test(lower)};
    })()`
    const load=async(url:string)=>{
      await view.webContents.loadURL(url)
      let result:{url:string;login:boolean;verification:boolean;bodyText:string;samples:EbayMarketResearchSample[];metrics:EbayMarketResearchMetric[];ready:boolean;blocked:boolean}={url,samples:[],metrics:[],login:false,verification:false,bodyText:'',ready:false,blocked:false}
      for(let attempt=0;attempt<20;attempt+=1){
        result=await view.webContents.executeJavaScript(extractScript) as typeof result
        if(result.login)throw new Error('eBay登录会话已失效，请先返回店铺采集完成登录')
        if(result.verification)throw new Error('eBay要求安全验证，请先在店铺采集浏览器中完成人工验证')
        if(result.ready)break
        await this.sleep(750)
      }
      return result
    }
    try {
      const researchSamples:EbayMarketResearchSample[]=[]
      const seenItemIds=new Set<string>()
      let researchMetrics:EbayMarketResearchMetric[]=[]
      let researchSourceUrl='',researchReady=false
      for(const offset of [0,50,100]){
        if(offset>0)await this.sleep(1000)
        const pageUrl=new URL(researchUrl.toString())
        pageUrl.searchParams.set('offset',String(offset))
        const page=await load(pageUrl.toString())
        if(offset===0){researchMetrics=page.metrics;researchSourceUrl=page.url}
        if(page.ready)researchReady=true
        const fresh=page.samples.filter(sample=>{const key=sample.itemId||sample.url;if(seenItemIds.has(key))return false;seenItemIds.add(key);return true})
        researchSamples.push(...fresh)
        if(page.samples.length<50||fresh.length===0)break
      }
      if(researchReady&&researchSamples.length)return {source:'EBAY_PRODUCT_RESEARCH',sourceUrl:researchSourceUrl,metrics:researchMetrics,samples:researchSamples}
      const soldUrl=new URL('https://www.ebay.com/sch/i.html')
      soldUrl.searchParams.set('_nkw',query);soldUrl.searchParams.set('LH_Sold','1');soldUrl.searchParams.set('LH_Complete','1');soldUrl.searchParams.set('_ipg','200')
      if(input.categoryId)soldUrl.searchParams.set('_sacat',input.categoryId)
      if(conditionId)soldUrl.searchParams.set('LH_ItemCondition',conditionId)
      const sold=await load(soldUrl.toString())
      if(!sold.samples.length)throw new Error('当前条件下未读取到成交样本，请调整核心商品词或在 eBay Product Research 中确认筛选条件后重试')
      return {source:'EBAY_SOLD_SEARCH',sourceUrl:sold.url,metrics:sold.metrics,samples:sold.samples}
    } finally {
      if(!view.webContents.isDestroyed())view.webContents.close()
    }
  }

  async openEbayDeliveryLocation():Promise<EbayDeliveryLocationResult> {
    const view=this.attached
    if(!view||view.webContents.isDestroyed())throw new Error('当前没有可用的 eBay 浏览器')
    const current=view.webContents.getURL()
    let hostname=''
    try{hostname=new URL(current).hostname}catch{/* 由下方统一处理 */}
    if(!(hostname==='ebay.com'||hostname.endsWith('.ebay.com')))throw new Error('请先打开 eBay 页面')
    const result=await view.webContents.executeJavaScript(`new Promise(resolve=>{
      const visible=node=>{const rect=node.getBoundingClientRect();const style=getComputedStyle(node);return rect.width>8&&rect.height>8&&style.display!=='none'&&style.visibility!=='hidden'};
      const text=node=>(node.getAttribute?.('aria-label')||node.textContent||'').replace(/\\s+/g,' ').trim();
      const pattern=/(ship\\s*to|shipping\\s*(?:to|location)|deliver\\s*to|delivery\\s*location|收货地点|送货地点|配送至|送至|寄送至)/i;
      const nodes=[...document.querySelectorAll('button,a,[role="button"],[tabindex="0"]')]
        .filter(node=>visible(node)&&pattern.test(text(node))&&text(node).length<120)
        .sort((a,b)=>{const ar=a.getBoundingClientRect(),br=b.getBoundingClientRect();return br.top-ar.top});
      const target=nodes[0];
      if(!target){resolve({found:false,opened:false,label:'收货地设置',fallback:false});return}
      const label=text(target)||'收货地设置';
      target.style.setProperty('scroll-margin-bottom','120px','important');
      target.scrollIntoView({block:'center',inline:'nearest'});
      let fixed=target;
      while(fixed&&fixed!==document.body){const position=getComputedStyle(fixed).position;if(position==='fixed'||position==='sticky')break;fixed=fixed.parentElement}
      if(fixed&&fixed!==document.body&&fixed.getBoundingClientRect().bottom>innerHeight-16)fixed.style.setProperty('bottom','72px','important');
      target.click();
      setTimeout(()=>{
        const dialogs=[...document.querySelectorAll('[role="dialog"],[aria-modal="true"]')].filter(visible);
        const dialog=dialogs.at(-1);
        if(dialog){const rect=dialog.getBoundingClientRect();if(rect.bottom>innerHeight-12||rect.top<12){dialog.style.setProperty('position','fixed','important');dialog.style.setProperty('top','16px','important');dialog.style.setProperty('bottom','auto','important');dialog.style.setProperty('max-height','calc(100vh - 32px)','important');dialog.style.setProperty('overflow','auto','important');dialog.style.setProperty('z-index','2147483647','important')}}
        resolve({found:true,opened:true,label,fallback:false});
      },350);
    })`,true) as EbayDeliveryLocationResult
    if(result.found)return result
    await view.webContents.loadURL('https://accountsettings.ebay.com/uas/addresses')
    return {found:false,opened:true,label:'eBay 收货地址',fallback:true}
  }

  private async injectEbayScrollbars(view:WebContentsView) {
    if(view.webContents.isDestroyed())return
    const current=view.webContents.getURL()
    let hostname=''
    try{hostname=new URL(current).hostname}catch{return}
    if(!(hostname==='ebay.com'||hostname.endsWith('.ebay.com')))return
    await view.webContents.executeJavaScript(`(() => {
      const id='__cross_border_ebay_scrollbars';
      let style=document.getElementById(id);
      if(!style){
        style=document.createElement('style');
        style.id=id;
        style.textContent=\`
        html { overflow:scroll!important; scrollbar-gutter:stable both-edges; }
        body { min-width:1600px!important; }
        html::-webkit-scrollbar, body::-webkit-scrollbar, *::-webkit-scrollbar { width:12px!important; height:12px!important; }
        html::-webkit-scrollbar-track, body::-webkit-scrollbar-track, *::-webkit-scrollbar-track { background:#eef1f2!important; }
        html::-webkit-scrollbar-thumb, body::-webkit-scrollbar-thumb, *::-webkit-scrollbar-thumb { min-width:42px; min-height:42px; background:#b7bec1!important; border:2px solid #eef1f2!important; border-radius:8px!important; }
        html::-webkit-scrollbar-thumb:hover, body::-webkit-scrollbar-thumb:hover, *::-webkit-scrollbar-thumb:hover { background:#8f999d!important; }
        html::-webkit-scrollbar-corner, body::-webkit-scrollbar-corner, *::-webkit-scrollbar-corner { background:#eef1f2!important; }
      \`;
        document.documentElement.appendChild(style);
      }
      return true;
    })()`,true)
  }

  async fillActiveLogin(username: string, password: string, submit = false) {
    const view = this.attached
    if (!view) throw new Error('当前没有可用的平台浏览器')
    const currentUrl = new URL(view.webContents.getURL())
    if (currentUrl.protocol !== 'https:') throw new Error('仅允许在HTTPS平台页面填充凭据')
    const allowedDomains = this.active === '1688' ? (this.supplyPlatformCode==='GIGACLOUD'?['gigab2b.com']:['1688.com']) : this.active === 'web' ? this.credentialDomains : this.marketplaceDomains
    const allowed = allowedDomains.some(domain=>currentUrl.hostname===domain||currentUrl.hostname.endsWith(`.${domain}`))
    if (!allowed) throw new Error('当前页面不是已允许的平台域名')
    const fillOnce = () => view.webContents.executeJavaScript(`(() => {
      const visible = element => element && element.getClientRects().length > 0 && !element.disabled;
      const usernameSelectors = ['input[type="email"]','input[name*="login" i]','input[name*="user" i]','input[name*="account" i]','input[autocomplete="username"]','input[type="tel"]','input[type="text"]'];
      const passwordSelectors = ['input[type="password"]','input[autocomplete="current-password"]'];
      const find = selectors => selectors.map(selector => [...document.querySelectorAll(selector)].find(visible)).find(Boolean);
      const set = (element, value) => { if (!element || !value) return false; const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set; setter?.call(element,value); element.dispatchEvent(new Event('input',{bubbles:true})); element.dispatchEvent(new Event('change',{bubbles:true})); return true; };
      const usernameFilled=set(find(usernameSelectors),${JSON.stringify(username)}); const passwordFilled=set(find(passwordSelectors),${JSON.stringify(password)});
      let submitted=false;
      if (${JSON.stringify(submit)} && (usernameFilled || passwordFilled)) {
        const buttons=[...document.querySelectorAll('button,input[type="submit"]')].filter(visible);
        const label=element => (element.textContent || element.value || '').trim();
        const login=buttons.find(element => /^(login|log in|sign in|登录|登入)$/i.test(label(element)));
        const next=buttons.find(element => /^(continue|next|继续|下一步)$/i.test(label(element)));
        const action=passwordFilled?(login || buttons.find(element=>element.type==='submit')):(next || login || buttons.find(element=>element.type==='submit'));
        if (action) { action.click(); submitted=true; }
      }
      const verificationRequired=[...document.querySelectorAll('[class*="captcha" i],[class*="verify" i],input[placeholder*="code" i]')].some(visible);
      return { usernameFilled, passwordFilled, submitted, verificationRequired, url:location.origin };
    })()`, true) as Promise<{usernameFilled:boolean;passwordFilled:boolean;submitted:boolean;verificationRequired:boolean;url:string}>
    let result=await fillOnce()
    if (submit && result.usernameFilled && !result.passwordFilled && result.submitted && !result.verificationRequired) {
      const deadline=Date.now()+15000
      while(Date.now()<deadline) {
        await new Promise(resolve=>setTimeout(resolve,500))
        try {
          const next=await fillOnce()
          result={usernameFilled:result.usernameFilled||next.usernameFilled,passwordFilled:result.passwordFilled||next.passwordFilled,submitted:result.submitted||next.submitted,verificationRequired:next.verificationRequired,url:next.url}
          if(next.passwordFilled||next.verificationRequired)break
        } catch {
          // eBay 正在切换账号页和密码页时执行上下文会短暂销毁，继续等待新页面。
        }
      }
    }
    return result
  }

  private async inspectEbayLogin(view:WebContentsView) {
    return view.webContents.executeJavaScript(`(() => {
      const visible=element=>Boolean(element&&element.getClientRects().length&&!element.disabled);
      const first=selectors=>selectors.map(selector=>[...document.querySelectorAll(selector)].find(visible)).find(Boolean);
      const username=first(['#userid','input[name="userid"]','input[autocomplete="username"]','input[type="email"]','input[type="text"]']);
      const password=first(['#pass','input[name="pass"]','input[autocomplete="current-password"]','input[type="password"]']);
      const oneTimeCode=first(['input[autocomplete="one-time-code"]','input[name*="otp" i]','input[name*="securityCode" i]','input[id*="securityCode" i]','input[name*="verification" i]']);
      const captcha=first(['iframe[src*="captcha" i]','iframe[src*="recaptcha" i]','iframe[src*="hcaptcha" i]','[class*="captcha" i] canvas','[id*="captcha" i] canvas']);
      const text=(document.body?.innerText||'').replace(/\\s+/g,' ').slice(0,30000);
      const url=location.href;
      const lowerUrl=url.toLowerCase();
      const signedInLink=Boolean(document.querySelector('a[href*="SignOut" i],a[href*="signout" i],a[href*="mye/myebay" i],a[href*="/sh/ovw" i]'));
      const sellerHub=!lowerUrl.includes('signin')&&!lowerUrl.includes('login')&&/\\/sh\\//i.test(new URL(url).pathname);
      const passwordError=/password.{0,30}(incorrect|invalid|doesn't match|wrong)|incorrect password|密码.{0,12}(错误|不正确)|账号或密码/i.test(text);
      const securityPage=Boolean(oneTimeCode||captcha)||(!password&&!username&&/security code|verification code|verify (?:it'?s|your)|验证码|安全验证|短信验证|邮箱验证|确认是您本人|confirm your identity/i.test(text));
      const passkey=!password&&/passkey|安全密钥|通行密钥/i.test(text);
      let phase='UNKNOWN';
      if(sellerHub||signedInLink)phase='ONLINE';
      else if(passwordError)phase='ERROR';
      else if(securityPage||passkey)phase='VERIFICATION';
      else if(password)phase='PASSWORD';
      else if(username)phase='USERNAME';
      else if(lowerUrl.includes('signin')||lowerUrl.includes('login'))phase='OFFLINE';
      return {phase,url,errorMessage:passwordError?'eBay提示密码不正确':''};
    })()`,true) as Promise<{phase:'ONLINE'|'ERROR'|'VERIFICATION'|'PASSWORD'|'USERNAME'|'OFFLINE'|'UNKNOWN';url:string;errorMessage:string}>
  }

  private async submitEbayLoginStep(view:WebContentsView,username:string,password:string,phase:'USERNAME'|'PASSWORD') {
    return view.webContents.executeJavaScript(`(() => {
      const visible=element=>Boolean(element&&element.getClientRects().length&&!element.disabled);
      const first=selectors=>selectors.map(selector=>[...document.querySelectorAll(selector)].find(visible)).find(Boolean);
      const setValue=(element,value)=>{if(!element||!value)return false;const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')?.set;setter?.call(element,value);element.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));element.dispatchEvent(new Event('change',{bubbles:true}));element.dispatchEvent(new Event('blur',{bubbles:true}));return true};
      const usernameInput=first(['#userid','input[name="userid"]','input[autocomplete="username"]','input[type="email"]','input[type="text"]']);
      const passwordInput=first(['#pass','input[name="pass"]','input[autocomplete="current-password"]','input[type="password"]']);
      const usernameFilled=${JSON.stringify(phase)}==='USERNAME'&&setValue(usernameInput,${JSON.stringify(username)});
      const passwordFilled=${JSON.stringify(phase)}==='PASSWORD'&&setValue(passwordInput,${JSON.stringify(password)});
      if(passwordFilled){const keep=first(['#kmsi-checkbox','input[name*="keep" i][type="checkbox"]','input[id*="keep" i][type="checkbox"]']);if(keep&&!keep.checked)keep.click()}
      const buttons=[...document.querySelectorAll('button,input[type="submit"]')].filter(visible);
      const label=element=>((element.textContent||element.value||element.getAttribute('aria-label')||'').replace(/\\s+/g,' ').trim());
      const action=${JSON.stringify(phase)}==='PASSWORD'
        ? first(['#sgnBt','button[name="sgnBt"]','button[type="submit"]','input[type="submit"]'])||buttons.find(element=>/^(sign in|log in|login|登录|登入)$/i.test(label(element)))
        : first(['#signin-continue-btn','button[name="signin-continue-btn"]','button[type="submit"]','input[type="submit"]'])||buttons.find(element=>/^(continue|next|继续|下一步)$/i.test(label(element)));
      let submitted=false;
      if(action&&(usernameFilled||passwordFilled)){action.click();submitted=true}
      return {usernameFilled,passwordFilled,submitted,url:location.href};
    })()`,true) as Promise<{usernameFilled:boolean;passwordFilled:boolean;submitted:boolean;url:string}>
  }

  async ensureEbayLogin(accountId:string,username:string,password:string,allowAutoLogin:boolean):Promise<EbayLoginResult> {
    const activeTab=this.detailTabs.get(this.activeTabId)
    const view=(activeTab?.scopeId===accountId?activeTab:this.detailTabs.get(`login-${accountId}`))?.view
    if(!view||view.webContents.isDestroyed())throw new Error('eBay店铺浏览器尚未初始化')
    const runVersion=this.activationVersion
    const active=()=>this.browserVisible&&this.attached===view&&runVersion===this.activationVersion
    const result=(status:EbayLoginResult['status'],message:string,url:string,autoLoginAttempted=false):EbayLoginResult=>({status,message,url,autoLoginAttempted})
    let state=await this.inspectEbayLogin(view)
    if(state.phase==='ONLINE')return result('ONLINE','eBay会话有效，已直接进入店铺',state.url)
    if(state.phase==='VERIFICATION')return result('VERIFICATION_REQUIRED','需要人工完成eBay验证，完成后将自动继续',state.url)
    if(state.phase==='ERROR')return result('ERROR',state.errorMessage||'eBay登录失败',state.url)
    if(!allowAutoLogin)return result('OFFLINE','eBay会话已失效；请开启“会话失效时允许安全自动填写”',state.url)
    if(!username||!password)return result('CREDENTIALS_REQUIRED','请先保存完整的eBay登录凭据',state.url)
    const recent=this.ebayAutoLoginAttemptedAt.get(accountId)||0
    let usernameSubmitted=false
    let passwordSubmitted=false
    for(let attempt=0;attempt<40;attempt+=1) {
      if(!active())return result('OFFLINE','已停止过期的eBay登录任务',view.webContents.getURL(),passwordSubmitted)
      state=await this.inspectEbayLogin(view)
      if(state.phase==='ONLINE')return result('ONLINE',passwordSubmitted?'自动登录成功，已进入eBay店铺':'已恢复原有eBay登录会话',state.url,passwordSubmitted)
      if(state.phase==='VERIFICATION')return result('VERIFICATION_REQUIRED','凭据已填写，请人工完成验证；完成后将自动继续',state.url,passwordSubmitted)
      if(state.phase==='ERROR')return result('ERROR',state.errorMessage||'eBay登录失败，请检查凭据',state.url,passwordSubmitted)
      if(state.phase==='USERNAME'&&!usernameSubmitted) {
        const action=await this.submitEbayLoginStep(view,username,password,'USERNAME')
        usernameSubmitted=action.submitted
      } else if(state.phase==='PASSWORD'&&!passwordSubmitted) {
        if(Date.now()-recent<5*60_000)return result('OFFLINE','5分钟内已尝试过自动登录，为避免触发eBay保护暂不重复提交',state.url)
        const action=await this.submitEbayLoginStep(view,username,password,'PASSWORD')
        passwordSubmitted=action.submitted
        if(passwordSubmitted)this.ebayAutoLoginAttemptedAt.set(accountId,Date.now())
      }
      await this.sleep(500)
    }
    state=await this.inspectEbayLogin(view)
    return result(passwordSubmitted?'OFFLINE':'ERROR',passwordSubmitted?'已提交eBay登录，但尚未确认成功，系统不会重复提交':'未能识别当前eBay登录页面',state.url,passwordSubmitted)
  }

  async readEbayStoreCategories(accountId:string):Promise<EbayStoreCategory[]> {
    const base=this.detailTabs.get(`login-${accountId}`)
    if(!base||base.view.webContents.isDestroyed())throw new Error('请先打开当前eBay店铺并完成登录')
    const view=new WebContentsView({webPreferences:{partition:`persist:login:${accountId}`,nodeIntegration:false,contextIsolation:true,sandbox:true}})
    view.setBackgroundColor('#ffffff')
    view.webContents.setUserAgent(base.view.webContents.getUserAgent())
    try {
      await view.webContents.loadURL('https://www.ebay.com/sh/str/category')
      let ready=false
      for(let attempt=0;attempt<40;attempt+=1) {
        const state=await view.webContents.executeJavaScript(`(() => {
          const text=(document.body?.innerText||'').replace(/\\s+/g,' ');
          const url=location.href.toLowerCase();
          const table=[...document.querySelectorAll('table')].find(node=>/类别编号|category number/i.test(node.innerText||''));
          const login=Boolean(document.querySelector('#userid,#pass,input[type="password"]'))||/signin|login/.test(url);
          const verification=/captcha|security check|verification code|验证码|安全验证|确认是您本人/i.test(text+' '+url);
          return {table:Boolean(table),login,verification};
        })()`,true) as {table:boolean;login:boolean;verification:boolean}
        if(state.verification)throw new Error('eBay要求安全验证，请先在店铺采集浏览器中完成人工验证')
        if(state.login)throw new Error('eBay登录会话已失效，请先返回店铺采集完成登录')
        if(state.table){ready=true;break}
        await this.sleep(500)
      }
      if(!ready)throw new Error('未识别到eBay店铺类别表格，请确认页面已正常加载')
      await view.webContents.executeJavaScript(`(() => { const button=[...document.querySelectorAll('button,a')].find(node=>/展开所有类别|expand all categor/i.test((node.textContent||'').trim()));if(button)button.click(); })()`)
      await this.sleep(800)
      const parsed=await view.webContents.executeJavaScript(`(() => {
        const text=(document.body?.innerText||'').replace(/\\s+/g,' ');
        const countMatch=text.match(/已创建类别[：:]\\s*(\\d+)|created categor(?:y|ies)[^\\d]*(\\d+)/i);
        const expected=Number(countMatch?.[1]||countMatch?.[2]||0);
        const table=[...document.querySelectorAll('table')].find(node=>/类别编号|category number/i.test(node.innerText||''));
        if(!table)return {expected,rows:[]};
        const headers=[...table.querySelectorAll('thead th, tr:first-child th')].map(node=>(node.textContent||'').replace(/\\s+/g,' ').trim());
        const index=(pattern,fallback)=>{const found=headers.findIndex(value=>pattern.test(value));return found>=0?found:fallback};
        const nameIndex=index(/类别(?!编号)|category(?! number| id)/i,1),levelIndex=index(/级别|level/i,2),childIndex=index(/子类别|subcategor/i,3),listingIndex=index(/物品刊登|listing/i,4),idIndex=index(/类别编号|category (?:number|id)/i,5);
        const number=value=>Number(String(value||'').replace(/[^\\d]/g,''))||0;
        const rows=[...table.querySelectorAll('tbody tr, tr')].slice(1).map((row,sortOrder)=>{const cells=[...row.querySelectorAll('td,th')].map(cell=>(cell.textContent||'').replace(/\\s+/g,' ').trim());return {categoryId:(cells[idIndex]||'').replace(/\\D/g,''),name:cells[nameIndex]||'',level:Math.max(1,number(cells[levelIndex])),childCount:number(cells[childIndex]),listingCount:number(cells[listingIndex]),sortOrder}}).filter(row=>/^\\d{5,}$/.test(row.categoryId)&&row.name);
        return {expected,rows};
      })()`,true) as {expected:number;rows:Array<{categoryId:string;name:string;level:number;childCount:number;listingCount:number;sortOrder:number}>}
      const unique=new Set(parsed.rows.map(item=>item.categoryId))
      if(!parsed.expected)throw new Error('无法确认eBay线上类别总数，已取消本次同步')
      if(parsed.rows.length!==parsed.expected||unique.size!==parsed.expected)throw new Error(`eBay目录读取不完整：线上${parsed.expected}个，当前读取${unique.size}个；已保留原目录`)
      const stack:Array<{categoryId:string}> = []
      const syncedAt=new Date().toISOString()
      return parsed.rows.map(item=>{
        const parentCategoryId=item.level>1?(stack[item.level-2]?.categoryId||''):''
        stack[item.level-1]=item
        stack.length=item.level
        return {storeId:accountId.replace(/^ebay:/,''),categoryId:item.categoryId,name:item.name,parentCategoryId,level:item.level,childCount:item.childCount,listingCount:item.listingCount,sortOrder:item.sortOrder,status:'ACTIVE' as const,syncedAt}
      })
    } finally {
      if(!view.webContents.isDestroyed())view.webContents.close()
    }
  }

  private async ebayStoreIdentityFromView(view:WebContentsView):Promise<{storeUrl:string;sellerId:string}> {
    if(view.webContents.isDestroyed())return {storeUrl:'',sellerId:''}
    try {
      return await view.webContents.executeJavaScript(`(() => {
        const canonical=value=>String(value||'').match(/^https:\\/\\/(?:www\\.)?ebay\\.com\\/str\\/[^/?#]+/i)?.[0]||'';
        const links=[...document.querySelectorAll('a[href]')].map(node=>node.href).filter(Boolean);
        const sources=[location.href,document.querySelector('link[rel="canonical"]')?.href,document.querySelector('meta[property="og:url"]')?.content,...links];
        let storeUrl=sources.map(canonical).find(Boolean)||'';
        if(!storeUrl){
          const html=document.documentElement?.innerHTML||'';
          const match=html.match(/https:\\\\?\\/\\\\?\\/(?:www\\.)?ebay\\.com\\\\?\\/str\\\\?\\/[^"'\\\\/?#<]+/i);
          if(match)storeUrl=canonical(match[0].replace(/\\\\\\//g,'/'));
        }
        const sellerLink=links.find(value=>/https:\\/\\/(?:www\\.)?ebay\\.com\\/usr\\/[^/?#]+/i.test(value));
        const sellerId=decodeURIComponent(sellerLink?.match(/\\/usr\\/([^/?#]+)/i)?.[1]||'');
        return {storeUrl,sellerId};
      })()`,true) as {storeUrl:string;sellerId:string}
    } catch { return {storeUrl:'',sellerId:''} }
  }

  private async loadEbayStoreIdentity(view:WebContentsView,url:string,expectedSellerId='') {
    try { await view.webContents.loadURL(url) } catch { return {storeUrl:'',sellerId:''} }
    for(let attempt=0;attempt<30;attempt+=1) {
      const state=await view.webContents.executeJavaScript(`(() => {
        const text=(document.body?.innerText||'').replace(/\\s+/g,' ').slice(0,30000);
        const url=location.href.toLowerCase();
        const login=Boolean(document.querySelector('#userid,#pass,input[type="password"]'))||/signin|login/.test(url);
        const verification=/captcha|security check|verification code|验证码|安全验证|确认是您本人/i.test(text+' '+url);
        const missing=/page not found|we looked everywhere|该页面不存在|找不到页面/i.test(text);
        return {login,verification,missing,ready:document.readyState==='complete'};
      })()`,true) as {login:boolean;verification:boolean;missing:boolean;ready:boolean}
      if(state.verification)throw new Error('安全验证：eBay要求人工验证，请前往“店铺采集”完成验证后重试')
      if(state.login)throw new Error('登录检查：eBay会话已失效，请前往“店铺采集”恢复登录后重试')
      if(state.missing)return {storeUrl:'',sellerId:''}
      const identity=await this.ebayStoreIdentityFromView(view)
      if(identity.storeUrl) {
        if(expectedSellerId&&identity.sellerId&&identity.sellerId.toLowerCase()!==expectedSellerId.toLowerCase())throw new Error(`店铺身份校验：当前公开店铺属于 ${identity.sellerId}，与已绑定卖家 ${expectedSellerId} 不一致`)
        return identity
      }
      if(state.ready&&attempt>=5)break
      await this.sleep(300)
    }
    return {storeUrl:'',sellerId:''}
  }

  async readEbayDirectoryProducts(accountId:string,categories:EbayStoreCategory[],options:{publicStoreUrl?:string;sellerId?:string;loginUsername?:string;listingUrls?:string[];waitIfPaused?:()=>Promise<void>;onProgress?:(input:{stage:'STORE'|'CATEGORY'|'PAGE';message:string;categoryId:string;categoryName:string;categoryIndex:number;categoryCount:number;expected:number;found:number})=>void|Promise<void>;onCategoryComplete?:(scan:EbayDirectoryProductScanCategory,products:EbayCollectedProduct[],storeUrl:string)=>void|Promise<void>}={}):Promise<{products:EbayCollectedProduct[];categories:EbayDirectoryProductScanCategory[];errors:string[];storeUrl:string;sellerId:string}> {
    const base=this.detailTabs.get(`login-${accountId}`)
    if(!base||base.view.webContents.isDestroyed())throw new Error('请先打开当前eBay店铺并完成登录')
    if(!categories.length)throw new Error('请选择至少一个有商品的店铺目录')
    let identity={storeUrl:'',sellerId:''}
    for(const tab of this.detailTabs.values()) {
      if(tab.scopeId!==accountId)continue
      identity=await this.ebayStoreIdentityFromView(tab.view)
      if(identity.storeUrl)break
    }
    const view=new WebContentsView({webPreferences:{partition:`persist:login:${accountId}`,nodeIntegration:false,contextIsolation:true,sandbox:true}})
    view.setBackgroundColor('#ffffff')
    view.webContents.setUserAgent(base.view.webContents.getUserAgent())
    try {
      const expectedSellerId=options.sellerId&&options.sellerId!=='待同步'?options.sellerId:''
      if(!identity.storeUrl&&options.publicStoreUrl)identity=await this.loadEbayStoreIdentity(view,options.publicStoreUrl,expectedSellerId)
      if(!identity.storeUrl)identity=await this.loadEbayStoreIdentity(view,'https://www.ebay.com/sh/ovw',expectedSellerId)
      if(!identity.storeUrl) {
        const itemUrl=await view.webContents.executeJavaScript(`([...document.querySelectorAll('a[href*="/itm/"]')].map(node=>node.href).find(Boolean)||'')`,true) as string
        if(itemUrl)identity=await this.loadEbayStoreIdentity(view,itemUrl,expectedSellerId)
      }
      const identifiers=[expectedSellerId,options.loginUsername&&!options.loginUsername.includes('@')?options.loginUsername:''].filter(Boolean)
      for(const identifier of identifiers) {
        if(identity.storeUrl)break
        identity=await this.loadEbayStoreIdentity(view,`https://www.ebay.com/usr/${encodeURIComponent(identifier)}`,expectedSellerId)
      }
      for(const listingUrl of options.listingUrls||[]) {
        if(identity.storeUrl)break
        identity=await this.loadEbayStoreIdentity(view,listingUrl,expectedSellerId)
      }
      for(const identifier of identifiers) {
        if(identity.storeUrl)break
        identity=await this.loadEbayStoreIdentity(view,`https://www.ebay.com/str/${encodeURIComponent(identifier)}`,expectedSellerId)
      }
      if(!identity.storeUrl)throw new Error('店铺定位：系统已检查 Seller Hub、卖家资料和现有商品，但仍未识别到公开店铺主页。请在同步窗口填写形如 https://www.ebay.com/str/店铺名 的地址后重试')
      const storeUrl=identity.storeUrl
      await options.onProgress?.({stage:'STORE',message:'店铺身份验证完成，开始逐目录读取',categoryId:'',categoryName:'',categoryIndex:0,categoryCount:categories.length,expected:0,found:0})
      const products=new Map<string,EbayCollectedProduct>()
      const errors:string[]=[]
      const categoryResults:EbayDirectoryProductScanCategory[]=[]
      const targets=[...categories].filter(item=>item.status==='ACTIVE'&&item.listingCount>0).sort((left,right)=>right.level-left.level||left.sortOrder-right.sortOrder)
      for(let categoryIndex=0;categoryIndex<targets.length;categoryIndex+=1) {
        const category=targets[categoryIndex]
        await options.waitIfPaused?.()
        await options.onProgress?.({stage:'CATEGORY',message:`正在读取目录：${category.name}`,categoryId:category.categoryId,categoryName:category.name,categoryIndex:categoryIndex+1,categoryCount:targets.length,expected:category.listingCount,found:0})
        const expectedPages=Math.max(1,Math.ceil(category.listingCount/60))
        const maxPages=Math.min(30,expectedPages+2)
        let categoryFound=0
        let categoryError=''
        const categoryListingIds=new Set<string>()
        for(let page=1;page<=maxPages;page+=1) {
          await options.waitIfPaused?.()
          const url=new URL(storeUrl)
          url.searchParams.set('_sacat','0')
          url.searchParams.set('store_cat',category.categoryId)
          if(page>1)url.searchParams.set('_pgn',String(page))
          try {
            await view.webContents.loadURL(url.toString())
            for(let step=0;step<5;step+=1) {
              await view.webContents.executeJavaScript(`window.scrollTo(0,Math.max(document.body.scrollHeight,document.documentElement.scrollHeight))`,true)
              await this.sleep(350)
            }
            const snapshot=await view.webContents.executeJavaScript(`(() => {
              const bodyText=(document.body?.innerText||'').replace(/\\s+/g,' ');
              const pageUrl=location.href.toLowerCase();
              if(/captcha|security check|verification code|验证码|安全验证|确认是您本人/i.test(bodyText+' '+pageUrl))return {issue:'eBay要求安全验证，请在店铺浏览器完成验证后重试',products:[]};
              if(/too many requests|access denied|temporarily blocked|unusual traffic|访问频繁|请求过多|稍后再试/i.test(bodyText))return {issue:'eBay检测到访问频繁，任务已自动暂停，请稍后继续',products:[]};
              if(document.querySelector('#userid,#pass,input[type="password"]')||/signin|login/.test(pageUrl))return {issue:'eBay登录会话已失效，请重新登录后重试',products:[]};
              const clean=value=>(value||'').replace(/\\s+/g,' ').trim();
              const normalize=raw=>{try{const value=new URL(raw,location.href);const match=value.pathname.match(/\\/itm\\/(?:[^/]+\\/)?(\\d+)/);return match?{url:value.origin+'/itm/'+match[1],listingId:match[1]}:null}catch{return null}};
              const grouped=new Map();
              for(const anchor of document.querySelectorAll('a[href*="/itm/"]')) {
                const normalized=normalize(anchor.href);if(!normalized)continue;
                const card=anchor.closest('article.str-item-card,li.s-item,article,li,[data-testid*="item"],div[class*="item-card"],div[class*="listing"]')||anchor.parentElement;
                if(!card)continue;
                const image=anchor.querySelector('img')||card.querySelector('img');
                const titleCandidates=[clean(anchor.textContent),clean(anchor.getAttribute('title')),clean(image?.getAttribute('alt')),clean(card.querySelector('h1,h2,h3,[class*="title"]')?.textContent)].filter(value=>value&&value.length>3&&!/^(shop now|view item|sponsored)$/i.test(value));
                const title=titleCandidates.sort((a,b)=>b.length-a.length)[0]||'';
                const imageUrl=[image?.currentSrc,image?.getAttribute?.('src'),image?.getAttribute?.('data-src')].find(value=>/^https?:\\/\\//i.test(value||'')&&!/(placeholder|loading|blank|transparent)/i.test(value||''))||'';
                const text=clean(card.textContent);const priceText=text.match(/(?:US\\s*)?\\$\\s*[\\d,.]+|(?:RMB|USD|CNY|GBP|EUR)\\s*[\\d,.]+|[\\d,.]+\\s*(?:RMB|USD|CNY|GBP|EUR)/i)?.[0]||'';
                const currency=/GBP|£/i.test(priceText)?'GBP':/EUR|€/i.test(priceText)?'EUR':/RMB/i.test(priceText)?'RMB':/CNY|¥|￥/i.test(priceText)?'CNY':'USD';
                const price=priceText.replace(/[^0-9.,-]/g,'').replace(/,/g,'');
                const previous=grouped.get(normalized.listingId);
                const candidate={...normalized,title,imageUrl,price,currency};
                const score=item=>item.title.length+(item.imageUrl?30:0)+(item.price?15:0);
                if(!previous||score(candidate)>score(previous))grouped.set(normalized.listingId,candidate);
              }
              return {issue:'',products:[...grouped.values()]};
            })()`,true) as {issue:string;products:Array<{url:string;listingId:string;title:string;imageUrl:string;price:string;currency:string}>}
            if(snapshot.issue)throw new Error(snapshot.issue)
            let added=0
            for(const product of snapshot.products) {
              if(!product.title)continue
              categoryListingIds.add(product.listingId)
              if(products.has(product.listingId))continue
              products.set(product.listingId,{...product,originalTitle:product.title,translatedTitle:'',originalTitleVerified:true,titleSource:'EBAY_STORE_LINK',categoryId:category.categoryId,categoryName:category.name})
              added+=1
            }
            categoryFound=categoryListingIds.size
            await options.onProgress?.({stage:'PAGE',message:`${category.name}：第 ${page} 页，已识别 ${categoryFound}/${category.listingCount}`,categoryId:category.categoryId,categoryName:category.name,categoryIndex:categoryIndex+1,categoryCount:targets.length,expected:category.listingCount,found:categoryFound})
            if(!snapshot.products.length||(!added&&page>1)||categoryFound>=category.listingCount)break
            await this.sleep(550+Math.floor(Math.random()*650))
          } catch(error) {
            categoryError=error instanceof Error?error.message:String(error)
            errors.push(`${category.name}：${categoryError}`)
            break
          }
        }
        const complete=!categoryError&&categoryFound>=category.listingCount
        if(!complete&&!categoryError) {
          categoryError=`读取不完整：目录显示 ${category.listingCount} 个，实际识别 ${categoryFound} 个；已跳过下架判断`
          errors.push(`${category.name}：${categoryError}`)
        }
        const scan={categoryId:category.categoryId,categoryName:category.name,expected:category.listingCount,found:categoryFound,complete,listingIds:[...categoryListingIds],error:categoryError}
        categoryResults.push(scan)
        await options.onCategoryComplete?.(scan,[...products.values()].filter(item=>item.categoryId===category.categoryId),storeUrl)
        if(categoryError&&/验证|登录会话|访问频繁|too many requests|access denied|blocked/i.test(categoryError))throw new Error(categoryError)
        if(categoryIndex<targets.length-1)await this.sleep(800+Math.floor(Math.random()*900))
      }
      if(!products.size&&errors.length)throw new Error(errors[0])
      if(!products.size)throw new Error('所选目录未读取到商品，请确认目录中存在在线商品')
      return {products:[...products.values()],categories:categoryResults,errors,storeUrl,sellerId:identity.sellerId}
    } finally {
      if(!view.webContents.isDestroyed())view.webContents.close()
    }
  }

  private async inspectGigaCloudLogin(view:WebContentsView):Promise<{status:SupplyActivationResult['loginStatus'];message:string;url:string;loginUrl:string}> {
    return view.webContents.executeJavaScript(`(() => {
      const url=location.href;const text=(document.body?.innerText||'').replace(/\\s+/g,' ').slice(0,30000);
      const visible=element=>element&&element.getClientRects().length>0&&!element.disabled;
      const password=[...document.querySelectorAll('input[type="password"],input[autocomplete="current-password"]')].find(visible);
      const verification=/captcha|verify|security check|verification code|验证码|安全验证|邮箱验证|短信验证|访问频繁|too many requests/i.test(text+' '+url)||[...document.querySelectorAll('[class*="captcha" i],[class*="verify" i],input[placeholder*="code" i]')].some(visible);
      const online=/log\\s*out|sign\\s*out|my\\s+account|my\\s+orders|account\\s+center|我的账户|退出登录|订单中心/i.test(text)||Boolean(document.querySelector('a[href*="account/logout" i],a[href*="account/account" i],a[href*="account/order" i]'));
      const loginLinks=[...document.querySelectorAll('a[href],button')].filter(visible).map(element=>({text:(element.textContent||'').trim(),href:element instanceof HTMLAnchorElement?element.href:''}));
      const loginLink=loginLinks.find(item=>/log\\s*in|sign\\s*in|登录/i.test(item.text)&&item.href.toLowerCase().startsWith('https://'));
      const lowerUrl=url.toLowerCase();const offline=Boolean(password)||lowerUrl.includes('route=account/login')||lowerUrl.includes('/login')||lowerUrl.includes('/signin')||/supplier fulfilled retailing|join now|sign\\s*in|log\\s*in/i.test(text);
      if(verification)return{status:'VERIFICATION_REQUIRED',message:'需要人工完成验证码或安全验证',url,loginUrl:loginLink?.href||''};
      if(online)return{status:'ONLINE',message:'大健云仓会话有效，无需重复登录',url,loginUrl:''};
      if(offline)return{status:'OFFLINE',message:'检测到大健云仓登录状态已失效',url,loginUrl:loginLink?.href||''};
      return{status:'UNKNOWN',message:'暂时无法确认登录状态，未执行自动登录',url,loginUrl:loginLink?.href||''};
    })()`) as Promise<{status:SupplyActivationResult['loginStatus'];message:string;url:string;loginUrl:string}>
  }

  async ensureGigaCloudLogin(username:string,password:string,allowAutoLogin:boolean,activationVersion:number):Promise<SupplyActivationResult | null> {
    const view=this.supplyViews.get('GIGACLOUD')
    if(!view||view.webContents.isDestroyed())throw new Error('大健云仓浏览器尚未初始化')
    if(!this.isActivationCurrent(activationVersion,'GIGACLOUD'))return null
    let state=await this.inspectGigaCloudLogin(view)
    for(let attempt=0;attempt<6;attempt+=1) {
      await this.sleep(1000)
      if(!this.isActivationCurrent(activationVersion,'GIGACLOUD'))return null
      state=await this.inspectGigaCloudLogin(view)
      const cookies=await view.webContents.session.cookies.get({url:'https://www.gigab2b.com/'})
      const hasStoredSession=cookies.some(cookie=>cookie.name==='login_flag'&&Boolean(cookie.value))&&cookies.some(cookie=>cookie.name==='OCSESSID'&&Boolean(cookie.value))
      const lowerUrl=state.url.toLowerCase(),explicitLoginPage=lowerUrl.includes('route=account/login')||lowerUrl.includes('/login')||lowerUrl.includes('/signin')
      if(state.status==='ONLINE'||(hasStoredSession&&!explicitLoginPage&&state.status!=='VERIFICATION_REQUIRED'))return{platformCode:'GIGACLOUD',loginStatus:'ONLINE',message:'已恢复原有登录会话，未重复登录',url:state.url,autoLoginAttempted:false}
      if(state.status==='VERIFICATION_REQUIRED')return{platformCode:'GIGACLOUD',loginStatus:state.status,message:state.message,url:state.url,autoLoginAttempted:false}
    }
    if(state.status==='ONLINE'||state.status==='VERIFICATION_REQUIRED'||state.status==='UNKNOWN'||!allowAutoLogin||!username||!password) {
      const message=!allowAutoLogin&&state.status==='OFFLINE'?'登录已失效；自动填写未开启，请人工登录':!password&&state.status==='OFFLINE'?'登录已失效；请先保存登录凭据':state.message
      return{platformCode:'GIGACLOUD',loginStatus:state.status,message,url:state.url,autoLoginAttempted:false}
    }
    const now=Date.now()
    if(now-this.gigaAutoLoginAttemptedAt<5*60_000)return{platformCode:'GIGACLOUD',loginStatus:'OFFLINE',message:'近期已尝试自动登录，为避免触发平台保护暂不重复提交',url:state.url,autoLoginAttempted:false}
    this.gigaAutoLoginAttemptedAt=now
    let loginUrl=state.loginUrl
    try { const target=new URL(loginUrl);if(target.protocol!=='https:'||!(target.hostname==='gigab2b.com'||target.hostname.endsWith('.gigab2b.com')))loginUrl='' } catch { loginUrl='' }
    if(!loginUrl)loginUrl='https://www.gigab2b.com/index.php?route=account/login'
    if(!this.isActivationCurrent(activationVersion,'GIGACLOUD'))return null
    const hasPasswordInput=await view.webContents.executeJavaScript(`Boolean(document.querySelector('input[type="password"]'))`) as boolean
    if(!hasPasswordInput)await view.webContents.loadURL(loginUrl)
    if(!this.isActivationCurrent(activationVersion,'GIGACLOUD'))return null
    const filled=await this.fillActiveLogin(username,password,true)
    if(filled.verificationRequired)return{platformCode:'GIGACLOUD',loginStatus:'VERIFICATION_REQUIRED',message:'已填写凭据，当前需要人工完成安全验证',url:view.webContents.getURL(),autoLoginAttempted:true}
    if(!filled.usernameFilled||!filled.passwordFilled)return{platformCode:'GIGACLOUD',loginStatus:'UNKNOWN',message:'登录页面已打开，但未识别到完整账号密码输入框',url:view.webContents.getURL(),autoLoginAttempted:true}
    for(let attempt=0;attempt<8;attempt+=1) {
      await this.sleep(1000)
      if(!this.isActivationCurrent(activationVersion,'GIGACLOUD'))return null
      state=await this.inspectGigaCloudLogin(view)
      if(state.status==='ONLINE'||state.status==='VERIFICATION_REQUIRED')break
    }
    return{platformCode:'GIGACLOUD',loginStatus:state.status,message:state.status==='ONLINE'?'自动登录成功，大健云仓会话已恢复':state.status==='VERIFICATION_REQUIRED'?'已提交凭据，需要人工完成安全验证':'已提交登录，请等待页面响应；系统不会重复提交',url:state.url,autoLoginAttempted:true}
  }

  private async configureNetworkAndLoad(platform: Platform, view: WebContentsView) {
    const contents = view.webContents
    if (!contents || contents.isDestroyed()) return
    if (platform === 'ozon') {
      await contents.session.setProxy({ mode: 'direct' })
      if (contents.isDestroyed()) return
      await contents.session.closeAllConnections()
    }
    const home = platform === '1688' && this.supplyPlatformCode === 'GIGACLOUD'
      ? 'https://www.gigab2b.com/index.php?route=common/home'
      : HOME[platform]
    if (!contents.isDestroyed()) await contents.loadURL(home)
  }

  private isAllowedUrl(platform: Platform, rawUrl: string) {
    try {
      const { protocol, hostname } = new URL(rawUrl)
      if (!['http:', 'https:'].includes(protocol)) return false
      if (platform === 'web') return true
      return platform === 'ozon'
        ? this.marketplaceDomains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
        : [
            '1688.com', 'alicdn.com',
            'pinduoduo.com', 'yangkeduo.com',
            'yiwugo.com', 'yiwugou.com', 'yiwugocn.com',
            'gigab2b.com'
          ].some(domain => hostname === domain || hostname.endsWith(`.${domain}`))
    } catch {
      return false
    }
  }

  show(platform: Platform) {
    this.browserVisible = true
    const view = this.get(platform)
    this.attachView(view)
    this.active = platform
    if (platform === 'web') {
      const tab = [...this.detailTabs.values()].find(item => item.view === view)
      if (tab) this.activeTabId = tab.id
    } else {
      this.activeTabId = `home-${platform}`
      if (platform === 'ozon') this.marketplaceTabVisible = true
    }
    this.emitState(platform)
    this.emitTabs()
  }

  hide() {
    this.browserVisible = false
    this.activationVersion += 1
    if (this.attached) {
      this.window.contentView.removeChildView(this.attached)
      this.attached = null
    }
  }

  setBounds(bounds: BrowserBounds) {
    this.bounds = {
      x: Math.max(0, Math.round(bounds.x)),
      y: Math.max(0, Math.round(bounds.y)),
      width: Math.max(320, Math.round(bounds.width)),
      height: Math.max(240, Math.round(bounds.height))
    }
    this.attached?.setBounds(this.bounds)
  }

  navigate(platform: Platform, rawUrl: string) {
    const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`
    const currentTab=platform==='web'?this.detailTabs.get(this.activeTabId):undefined
    const allowed=currentTab?.domains?.length
      ? (()=>{try{const target=new URL(url);return target.protocol==='https:'&&currentTab.domains!.some(domain=>target.hostname===domain||target.hostname.endsWith(`.${domain}`))}catch{return false}})()
      : this.isAllowedUrl(platform,url)
    if (!allowed) throw new Error('当前标签只允许访问对应平台域名')
    if (platform === 'web') {
      const tab = this.detailTabs.get(this.activeTabId)
      if (tab?.generic) {
        try { tab.title = new URL(url).hostname.replace(/^www\./, '') || '新标签页' } catch { tab.title = '新标签页' }
        this.emitTabs()
      }
    }
    return this.getCurrentView(platform).webContents.loadURL(url)
  }

  goBack(platform: Platform) {
    const navigation = this.getCurrentView(platform).webContents.navigationHistory
    if (navigation.canGoBack()) navigation.goBack()
  }

  goForward(platform: Platform) {
    const navigation = this.getCurrentView(platform).webContents.navigationHistory
    if (navigation.canGoForward()) navigation.goForward()
  }

  reload(platform: Platform) {
    this.getCurrentView(platform).webContents.reload()
  }

  async openTab(platform: Platform, url: string, initialTitle?: string) {
    if (this.visibleTabCount() >= 8) throw new Error('最多同时打开8个浏览标签，请先关闭不需要的标签')
    if (!this.isAllowedUrl(platform, url)) throw new Error('链接不属于当前平台，已阻止打开')
    const id = crypto.randomUUID()
    const view = new WebContentsView({
      webPreferences: {
        partition: platform === 'ozon' ? this.marketplacePartition : platform === 'web' ? 'persist:web-general' : `persist:${platform}`,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true
      }
    })
    view.setBackgroundColor('#ffffff')
    const cleanUserAgent = view.webContents.getUserAgent().replace(/\sElectron\/[^\s]+/g, '')
    if (platform === 'ozon') {
      view.webContents.session.setUserAgent(cleanUserAgent, 'ru-RU,ru;q=0.9,en;q=0.8')
      await view.webContents.session.setProxy({ mode: 'direct' })
      await view.webContents.session.closeAllConnections()
    } else {
      view.webContents.setUserAgent(cleanUserAgent)
    }

    const tab: DetailTab = { id, platform, title: initialTitle || (platform === 'ozon' ? 'Ozon 详情' : platform === 'web' ? '新标签页' : '1688 搜款'), view, generic: platform === 'web' }
    this.detailTabs.set(id, tab)
    view.webContents.setWindowOpenHandler(({ url: nextUrl }) => {
      if (this.isAllowedUrl(platform, nextUrl)) void view.webContents.loadURL(nextUrl)
      return { action: 'deny' }
    })
    view.webContents.on('will-navigate', (event, nextUrl) => {
      if (!this.isAllowedUrl(platform, nextUrl)) event.preventDefault()
    })
    const emit = () => {
      if (this.activeTabId === id) this.emitState(platform)
    }
    view.webContents.on('did-navigate', (_event, url) => {
      if (url !== 'about:blank' && tab.title === '新标签页') {
        try { tab.title = new URL(url).hostname.replace(/^www\./, '') || tab.title } catch { /* 保留现有标题 */ }
      }
      emit()
    })
    view.webContents.on('did-navigate-in-page', () => { emit(); if (this.builtInCollectorActive) void this.injectBuiltInCollector(view).catch(() => undefined) })
    view.webContents.on('did-start-loading', emit)
    view.webContents.on('dom-ready', () => { if (this.builtInCollectorActive) void this.injectBuiltInCollector(view).catch(() => undefined) })
    view.webContents.on('did-stop-loading', () => { emit(); if (this.builtInCollectorActive) void this.injectBuiltInCollector(view).catch(() => undefined) })
    view.webContents.on('page-title-updated', (_event, title) => {
      tab.title = title || tab.title
      emit()
      this.emitTabs()
    })
    this.active = platform
    this.activeTabId = id
    this.attachView(view)
    this.emitTabs()
    await view.webContents.loadURL(url)
    return id
  }

  async newTab() {
    if (this.visibleTabCount() >= 8) throw new Error('最多同时打开8个浏览标签，请先关闭不需要的标签')
    const id = crypto.randomUUID()
    const view = new WebContentsView({ webPreferences: { partition: 'persist:web-general', nodeIntegration: false, contextIsolation: true, sandbox: true } })
    view.setBackgroundColor('#ffffff')
    view.webContents.setUserAgent(view.webContents.getUserAgent().replace(/\sElectron\/[^\s]+/g, '').replace(/\scross-border-sourcing-desktop\/[^\s]+/g, ''))
    const tab: DetailTab = { id, platform: 'web', title: '新标签页', view, generic: true }
    this.detailTabs.set(id, tab)
    view.webContents.setWindowOpenHandler(({ url }) => { if (this.isAllowedUrl('web', url)) void view.webContents.loadURL(url); return { action: 'deny' } })
    view.webContents.on('will-navigate', (event, url) => { if (!this.isAllowedUrl('web', url)) event.preventDefault() })
    const emit = () => { if (this.activeTabId === id) this.emitState('web'); this.emitTabs() }
    view.webContents.on('did-navigate', (_event, url) => {
      if (url !== 'about:blank' && tab.title === '新标签页') {
        try { tab.title = new URL(url).hostname.replace(/^www\./, '') || tab.title } catch { /* 保留现有标题 */ }
      }
      emit()
    })
    view.webContents.on('did-navigate-in-page', () => { emit(); if (this.builtInCollectorActive) void this.injectBuiltInCollector(view).catch(() => undefined) })
    view.webContents.on('did-start-loading', () => this.emitState('web'))
    view.webContents.on('dom-ready', () => { if (this.builtInCollectorActive) void this.injectBuiltInCollector(view).catch(() => undefined) })
    view.webContents.on('did-stop-loading', () => { emit(); if (this.builtInCollectorActive) void this.injectBuiltInCollector(view).catch(() => undefined) })
    view.webContents.on('page-title-updated', (_event, title) => { tab.title = title || tab.title; emit() })
    this.active = 'web'
    this.activeTabId = id
    this.attachView(view)
    await view.webContents.loadURL('about:blank')
    this.emitState('web')
    this.emitTabs()
    return id
  }

  switchTab(tabId: string) {
    if (tabId === 'home-ozon') return this.show('ozon')
    if (tabId === 'home-1688') return this.show('1688')
    const tab = this.detailTabs.get(tabId)
    if (!tab) return
    this.active = tab.platform
    this.activeTabId = tab.id
    if(tab.domains)this.credentialDomains=tab.domains
    this.attachView(tab.view)
    this.emitState(tab.platform)
    this.emitTabs()
  }

  closeTab(tabId: string) {
    if (tabId === 'home-ozon') {
      this.marketplaceTabVisible = false
      if (this.activeTabId === tabId) this.show('1688')
      else this.emitTabs()
      return
    }
    const tab = this.detailTabs.get(tabId)
    if (!tab) return
    const wasActive = this.activeTabId === tabId
    if (this.attached === tab.view) {
      this.window.contentView.removeChildView(tab.view)
      this.attached = null
    }
    this.detailTabs.delete(tabId)
    tab.view.webContents.close()
    if (wasActive&&tab.scopeId) {
      const fallback=[...this.detailTabs.values()].find(item=>item.scopeId===tab.scopeId)
      if(fallback)this.switchTab(fallback.id)
      else this.showVisibleHome()
    }
    else if (wasActive) this.showVisibleHome()
    else this.emitTabs()
  }

  async extractTranslationTexts(limit = 80): Promise<Array<{ id: string; text: string }>> {
    const contents = this.attached?.webContents
    if (!contents) return []
    return contents.executeJavaScript(String.raw`(() => {
      const result = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      const nodes = [];
      while (walker.nextNode() && nodes.length < ${Math.max(1,Math.min(limit,200))}) {
        const node = walker.currentNode;
        const parent = node.parentElement;
        if (!parent || parent.closest('script,style,noscript,textarea,input,select,option,code,pre,[data-codex-translated]')) continue;
        const text = (node.nodeValue || '').replace(/\s+/g,' ').trim();
        if (text.length < 2 || text.length > 320) continue;
        if (!/[A-Za-zА-Яа-яЁёÀ-ÿĀ-ž\u0600-\u06ff\u3040-\u30ff]/.test(text)) continue;
        if (/^(https?:\/\/|www\.)/i.test(text) || /^[\d\s.,:%+\-/$€¥₽£]+$/.test(text)) continue;
        const style = getComputedStyle(parent);
        const rect = parent.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || rect.width === 0 || rect.height === 0) continue;
        nodes.push({node,text});
      }
      for (const item of nodes) {
        const wrapper = document.createElement('span');
        const id = 'ct-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
        wrapper.dataset.codexTranslated = id;
        wrapper.dataset.codexOriginal = item.text;
        wrapper.textContent = item.text;
        item.node.replaceWith(wrapper);
        result.push({id,text:item.text});
      }
      return result;
    })()`)
  }

  async applyTranslations(items: Array<{ id: string; translated: string }>, mode: 'BILINGUAL'|'CHINESE') {
    const contents = this.attached?.webContents
    if (!contents || !items.length) return
    await contents.executeJavaScript(`(() => {
      const items = ${JSON.stringify(items)};
      const mode = ${JSON.stringify(mode)};
      if (!document.getElementById('codex-translation-style')) {
        const style = document.createElement('style'); style.id='codex-translation-style';
        style.textContent='[data-codex-translation]{display:block!important;margin:2px 0!important;padding:2px 5px!important;color:#075955!important;background:rgba(223,246,244,.92)!important;border-radius:4px!important;font-size:.82em!important;line-height:1.35!important;font-weight:500!important;}';
        document.head.appendChild(style);
      }
      for (const item of items) {
        const wrapper = document.querySelector('[data-codex-translated="'+item.id+'"]');
        if (!wrapper) continue;
        wrapper.dataset.codexTranslation = item.translated;
        const original = wrapper.dataset.codexOriginal || wrapper.textContent || '';
        wrapper.textContent = mode === 'CHINESE' ? item.translated : original;
        if (mode === 'BILINGUAL') { const translation=document.createElement('small'); translation.dataset.codexTranslation=''; translation.textContent=item.translated; wrapper.appendChild(translation); }
      }
    })()`)
  }

  async setTranslationMode(mode: 'BILINGUAL'|'CHINESE') {
    const contents = this.attached?.webContents
    if (!contents) return
    await contents.executeJavaScript(`(() => { for (const wrapper of document.querySelectorAll('[data-codex-translated]')) { const original=wrapper.dataset.codexOriginal||''; const translated=wrapper.dataset.codexTranslation||original; wrapper.textContent=${JSON.stringify(mode)}==='CHINESE'?translated:original; if (${JSON.stringify(mode)}==='BILINGUAL') { const small=document.createElement('small'); small.dataset.codexTranslation=''; small.textContent=translated; wrapper.appendChild(small); } } })()`)
  }

  async restoreTranslations() {
    const contents = this.attached?.webContents
    if (!contents) return
    await contents.executeJavaScript(`(() => { for (const wrapper of [...document.querySelectorAll('[data-codex-translated]')]) wrapper.replaceWith(document.createTextNode(wrapper.dataset.codexOriginal||wrapper.textContent||'')); document.getElementById('codex-translation-style')?.remove(); })()`)
  }

  async collectOzonList(
    keyword: string,
    maxProducts: number,
    task: SelectionTask,
    onProgress: (message: string, collected: number) => void
  ): Promise<CollectedOzonProduct[]> {
    const view = this.get('ozon')
    this.show('ozon')
    const searchUrl = `https://www.ozon.ru/search/?text=${encodeURIComponent(keyword)}`
    onProgress(`正在打开 Ozon 搜索：${keyword}`, 0)
    await view.webContents.loadURL(searchUrl)
    const startedAt=Date.now()

    for (let index = 0; index < 6; index += 1) {
      await this.protectCollectionStep(view,task,index,onProgress,startedAt)
      await view.webContents.executeJavaScript('window.scrollBy(0, Math.max(700, window.innerHeight * 0.8))')
      onProgress(`正在加载商品列表（${index + 1}/6）`, 0)
    }

    const products = await view.webContents.executeJavaScript(`(() => {
      const seen = new Set();
      const result = [];
      const anchors = [...document.querySelectorAll('a[href*="/product/"]')];
      for (const anchor of anchors) {
        const url = new URL(anchor.getAttribute('href'), location.origin).href.split('?')[0];
        if (seen.has(url)) continue;
        const card = anchor.closest('.tile-root') || anchor;
        const image = card.querySelector('a[href*="/product/"] img') || card.querySelector('img');
        const text = (card.innerText || '').trim();
        const linkedTitles = [...card.querySelectorAll('a[href*="/product/"]')]
          .map(link => (link.innerText || link.getAttribute('title') || '').trim())
          .filter(Boolean)
          .sort((left, right) => right.length - left.length);
        const title = (linkedTitles[0] || image?.alt || text.split('\\n').find(line => line.length > 12) || '').trim();
        const priceMatches = [...text.matchAll(/[\\d\\s ]+₽/g)].map(match => match[0].trim());
        const productId = url.match(/-(\\d+)\\/$/)?.[1] || '';
        if (!title) continue;
        seen.add(url);
        result.push({
          productId,
          url,
          title,
          priceText: priceMatches[0] || '',
          originalPriceText: priceMatches[1] || '',
          imageUrl: image?.currentSrc || image?.src || '',
          brand: '',
          attributeCount: null
        });
        if (result.length >= ${Math.max(1, Math.min(maxProducts, 500))}) break;
      }
      return result;
    })()` ) as CollectedOzonProduct[]

    onProgress(`Ozon 列表采集完成，共 ${products.length} 个商品`, products.length)
    return products
  }

  async collect1688List(
    startUrl: string,
    task: SelectionTask,
    onProgress: (message: string, collected: number) => void
  ): Promise<CollectedSupplyProduct[]> {
    const view = this.get('1688')
    this.show('1688')
    onProgress('正在打开1688搜索结果', 0)
    if (view.webContents.getURL() !== startUrl) await view.webContents.loadURL(startUrl)
    const startedAt = Date.now()
    const scrollRounds = Math.max(4, Math.min(10, Math.ceil(task.maxProducts / 10)))
    for (let index = 0; index < scrollRounds; index += 1) {
      await this.protectCollectionStep(view,task,index,onProgress,startedAt)
      await view.webContents.executeJavaScript('window.scrollBy(0, Math.max(800, window.innerHeight * 0.85))')
      onProgress(`正在加载1688商品（${index + 1}/${scrollRounds}）`, 0)
    }
    const rawProducts = await view.webContents.executeJavaScript(String.raw`(() => {
      const result = [];
      const seen = new Set();
      const anchors = [...document.querySelectorAll('a[href*="offer/"], a[href*="offerId="]')];
      for (const anchor of anchors) {
        const href = anchor.href || anchor.getAttribute('href');
        if (!href) continue;
        const absoluteUrl = new URL(href, location.href).href;
        const productId = absoluteUrl.match(/offer\/(\d+)\.html?/)?.[1] || absoluteUrl.match(/[?&]offerId=(\d+)/)?.[1] || '';
        if (!productId) continue;
        const url = absoluteUrl.includes('/offer/') ? absoluteUrl.split('?')[0] : 'https://detail.1688.com/offer/' + productId + '.html';
        if (seen.has(url)) continue;
        let card = anchor.closest('[class*="offer-card"], [class*="offer-item"], [class*="card"], [class*="item"]');
        if (!card || (card.innerText || '').length < 15) card = anchor.parentElement?.parentElement?.parentElement || anchor;
        const image = card.querySelector('img') || anchor.querySelector('img');
        const styledImage = [...card.querySelectorAll('*')].map(node => getComputedStyle(node).backgroundImage)
          .find(value => value && value !== 'none' && value.includes('url(')) || '';
        const backgroundImageUrl = styledImage.match(/url\(["']?(.*?)["']?\)/)?.[1] || '';
        const text = (card.innerText || anchor.innerText || '').replace(/\s+/g, ' ').trim();
        const candidates = [anchor.getAttribute('title'), image?.alt, anchor.getAttribute('aria-label'), anchor.innerText, text]
          .filter(Boolean).map(value => value.trim()).filter(value => value.length > 4);
        const title = candidates.sort((a,b) => b.length - a.length)[0] || text.slice(0, 80);
        if (!title) continue;
        const priceText = text.match(/(?:¥|￥)\s*[\d.]+/)?.[0] || text.match(/[\d.]+\s*元/)?.[0] || '';
        const salesText = text.match(/[\d.]+\s*万\+?件|[\d]+\+?件|成交[^ ]{0,12}/)?.[0] || '';
        const supplierName = [...card.querySelectorAll('a,span')].map(node => (node.innerText || '').trim())
          .find(value => /公司|工厂|商行|经营部|旗舰店|品类店铺/.test(value) && value.length < 40) || '';
        seen.add(url);
        result.push({ productId, url, title, imageUrl: image?.currentSrc || image?.src || backgroundImageUrl, priceText, salesText, supplierName, text });
        if (result.length >= ${Math.max(1, Math.min(task.maxProducts, 300))}) break;
      }
      return result;
    })()` ) as Array<{ productId: string; url: string; title: string; imageUrl: string; priceText: string; salesText: string; supplierName: string; text: string }>

    const parseSales = (value: string) => {
      const number = Number(value.match(/[\d.]+/)?.[0] || 0)
      return value.includes('万') ? number * 10000 : number
    }
    const products = rawProducts.map(raw => {
      const text = raw.text
      const sales = parseSales(raw.salesText)
      const returnMatch = text.match(/回头率\s*([\d.]+)%/)
      const returnRate = returnMatch ? Number(returnMatch[1]) : null
      const rankMatch = text.match(/品类店铺\s*TOP\s*(\d+)/i)
      const categoryTopRank = rankMatch ? Number(rankMatch[1]) : null
      const supplierBadges = [text.includes('超级工厂') ? 'SUPER_FACTORY' : '', text.includes('源头旗舰') ? 'SOURCE_FLAGSHIP' : '', categoryTopRank !== null ? 'CATEGORY_TOP' : ''].filter(Boolean)
      const serviceMatch = text.match(/综合服务\s*([0-5](?:\.[0-9])?)/)
      const starMatch = text.match(/综合服务\s*(★+)/)
      const serviceRating = serviceMatch ? Number(serviceMatch[1]) : starMatch ? starMatch[1].length : null
      const serviceDetails: Record<string, number> = {}
      for (const [code, label] of [['purchaseConsult','采购咨询'],['returns','退换体验'],['qualityExperience','品质体验'],['dispute','纠纷解决'],['logistics','物流时效']] as const) {
        const match = text.match(new RegExp(`${label}\\s*([0-5](?:\\.[0-9])?)`))
        if (match) serviceDetails[code] = Number(match[1])
      }
      const qualificationScore = supplierBadges.includes('SUPER_FACTORY') ? 100 : supplierBadges.includes('SOURCE_FLAGSHIP') ? 95 : categoryTopRank !== null ? Math.max(45, 100 - (categoryTopRank - 1) * 3) : 40
      const rankScore = categoryTopRank === null ? 55 : categoryTopRank <= 1 ? 100 : categoryTopRank <= 3 ? 95 : categoryTopRank <= 10 ? 85 : categoryTopRank <= 20 ? 70 : categoryTopRank <= 50 ? 55 : 40
      const returnScore = returnRate === null ? 60 : returnRate >= 70 ? 100 : returnRate >= 50 ? 90 : returnRate >= 40 ? 80 : returnRate >= 30 ? 65 : returnRate >= 20 ? 45 : 25
      const salesScore = sales >= 100000 ? 100 : sales >= 50000 ? 90 : sales >= 10000 ? 80 : sales >= 5000 ? 65 : sales >= 1000 ? 50 : sales > 0 ? 30 : 45
      const serviceScore = serviceRating === null ? 65 : serviceRating >= 5 ? 100 : serviceRating >= 4.8 ? 95 : serviceRating >= 4.5 ? 85 : serviceRating >= 4 ? 70 : serviceRating >= 3.5 ? 50 : 25
      const dimensionScores: Record<string, number> = {
        supplier_badge: qualificationScore,
        category_rank: rankScore,
        return_rate: returnScore,
        network_sales: salesScore,
        service_rating: serviceScore
      }
      const weights: Record<string, Record<string, number>> = {
        BALANCED: { supplier_badge: 25, category_rank: 15, return_rate: 20, network_sales: 20, service_rating: 20 },
        QUALITY_FIRST: { supplier_badge: 35, category_rank: 10, return_rate: 15, network_sales: 15, service_rating: 25 },
        SALES_FIRST: { supplier_badge: 15, category_rank: 10, return_rate: 25, network_sales: 35, service_rating: 15 },
        SUPPLY_FIRST: { supplier_badge: 10, category_rank: 30, return_rate: 15, network_sales: 25, service_rating: 20 },
        LOW_RISK: { supplier_badge: 15, category_rank: 5, return_rate: 35, network_sales: 20, service_rating: 25 }
      }
      const activeWeights = weights[task.selectionRulePreset] || weights.BALANCED
      const score = Math.round(Object.entries(activeWeights).reduce((sum, [code, weight]) => sum + dimensionScores[code] * weight, 0) / 100)
      const badgePass = !task.requiredSupplierBadges?.length || supplierBadges.some(badge => task.requiredSupplierBadges.includes(badge))
      const rankPass = categoryTopRank === null || categoryTopRank <= (task.maxCategoryTopRank || 20)
      const returnPass = returnRate === null || returnRate >= (task.minimumReturnRate || 0)
      const salesPass = !sales || sales >= (task.minimumNetworkSales || 0)
      const servicePass = serviceRating === null || serviceRating >= (task.minimumServiceRating || 0)
      const selected = badgePass && rankPass && returnPass && salesPass && servicePass && score >= task.minimumSelectionScore
      const grade: CollectedSupplyProduct['grade'] = !selected ? 'REJECTED' : score >= 80 ? 'A' : score >= 65 ? 'B' : 'C'
      const dataCompleteness = Math.round([supplierBadges.length > 0, categoryTopRank !== null, returnRate !== null, sales > 0, serviceRating !== null].filter(Boolean).length / 5 * 100)
      const strengths = [supplierBadges.includes('SUPER_FACTORY') ? '超级工厂' : '', supplierBadges.includes('SOURCE_FLAGSHIP') ? '源头旗舰' : '', categoryTopRank !== null && categoryTopRank <= 20 ? `品类TOP${categoryTopRank}` : '', returnRate !== null && returnRate >= 50 ? `回头率${returnRate}%` : '', sales >= 10000 ? `全网销量${raw.salesText}` : '', serviceRating !== null && serviceRating >= 4.5 ? `综合服务${serviceRating}星` : ''].filter(Boolean).slice(0, 3)
      const riskFlags = [!badgePass ? '供应商资质未达标' : '', !rankPass ? '品类排名未达标' : '', !returnPass ? '回头率未达标' : '', !salesPass ? '全网销量未达标' : '', !servicePass ? '综合服务未达标' : '', serviceDetails.qualityExperience !== undefined && serviceDetails.qualityExperience < 3.5 ? '品质体验偏低' : '', serviceRating === null ? '综合服务待补采' : ''].filter(Boolean)
      const rejectionReason = riskFlags[0] || `综合得分低于${task.minimumSelectionScore}`
      return { platformCode: '1688' as const, productId: raw.productId, url: raw.url, title: raw.title, imageUrl: raw.imageUrl, priceText: raw.priceText, salesText: raw.salesText, supplierName: raw.supplierName, supplierBadges, categoryTopRank, returnRate, networkSalesCount: sales || null, serviceRating, serviceDetails, dataCompleteness, score, grade, dimensionScores, recommendation: selected ? strengths.join('、') || '达到当前入选要求' : rejectionReason, riskFlags, selected }
    }).sort((a, b) => b.score - a.score)
    onProgress(`已解析${products.length}个商品，AI优选入选${products.filter(item => item.selected).length}个`, products.length)
    return products
  }

  async collectGigaList(
    startUrl: string,
    task: SelectionTask,
    onProgress: (message: string, collected: number) => void
  ): Promise<CollectedSupplyProduct[]> {
    const view = this.get('1688')
    this.show('1688')
    onProgress('正在打开大健云仓产品页面', 0)
    if (startUrl && view.webContents.getURL() !== startUrl) await view.webContents.loadURL(startUrl)
    const startedAt = Date.now()
    const scrollRounds = Math.max(2, Math.min(task.maxPages || 4, 8))
    for (let index = 0; index < scrollRounds; index += 1) {
      await this.protectCollectionStep(view,task,index,onProgress,startedAt)
      await view.webContents.executeJavaScript('window.scrollBy(0, Math.max(700, window.innerHeight * 0.8))')
      onProgress(`正在加载大健云仓商品（${index + 1}/${scrollRounds}）`, 0)
    }
    const rawProducts = await view.webContents.executeJavaScript(String.raw`(() => {
      const result = [], seen = new Set();
      const knownCategoryPaths=${JSON.stringify(GIGA_CATEGORY_PATHS)};
      const categoryIdsOf = rawUrl => { try { const parsed=new URL(rawUrl,location.href);return (parsed.searchParams.get('path')||parsed.searchParams.get('product_category_id')||parsed.searchParams.get('category_id')||'').split(/[_>,\-]+/).filter(value=>/^\d+$/.test(value)); } catch { return []; } };
      const categoryAnchors=[...document.querySelectorAll('a[href]')].map(node=>({node,ids:categoryIdsOf(node.href||'')})).filter(item=>item.ids.length);
      const rawPageIds=(categoryIdsOf(location.href).length?categoryIdsOf(location.href):(categoryAnchors.map(item=>item.ids).sort((a,b)=>b.length-a.length)[0]||[])).slice(0,3);
      const knownPagePath=[...rawPageIds].reverse().map(id=>knownCategoryPaths[id]).find(Boolean);
      const pageIds=knownPagePath?knownPagePath.map(item=>item.id):rawPageIds;
      const namesById=new Map(categoryAnchors.map(item=>[item.ids[item.ids.length-1],(item.node.textContent||'').replace(/\s+/g,' ').trim()]));
      const categoryLevel=index=>pageIds[index]?{id:pageIds[index],name:knownPagePath?.[index]?.name||namesById.get(pageIds[index])||''}:undefined;
      const sourceCategory={platformCode:'GIGACLOUD',catalogVersion:${JSON.stringify(GIGA_CATALOG_VERSION)},level1:categoryLevel(0),level2:categoryLevel(1),level3:categoryLevel(2),pathIds:pageIds,pathNames:pageIds.map((id,index)=>knownPagePath?.[index]?.name||namesById.get(id)||'').filter(Boolean),capturedFrom:categoryAnchors.length?'BREADCRUMB':'PAGE_CONTEXT',status:knownPagePath||pageIds.length>=3?'EXACT':pageIds.length?'PARTIAL':'NEEDS_REVIEW',capturedAt:new Date().toISOString()};
      const anchors = [...document.querySelectorAll('a[href*="route=product/product"][href*="product_id="]')];
      for (const anchor of anchors) {
        const href = anchor.href || anchor.getAttribute('href');
        if (!href) continue;
        const url = new URL(href, location.href).href;
        const productId = new URL(url).searchParams.get('product_id') || '';
        if (!productId || seen.has(productId)) continue;
        let card = anchor.closest('[class*="product-item"], [class*="product-card"], [class*="goods-item"], [class*="card"]');
        if (!card || (card.innerText || '').length < 20) card = anchor.parentElement?.parentElement?.parentElement || anchor;
        const image = anchor.querySelector('img') || card.querySelector('img');
        const text = (card.innerText || anchor.innerText || '').replace(/\s+/g, ' ').trim();
        const title = anchor.getAttribute('title') || image?.alt || anchor.innerText.trim() || text.slice(0, 120);
        const priceText = text.match(/\$\s*[\d,.]+(?:\s*-\s*\$?\s*[\d,.]+)?\s*\/件?/)?.[0] || text.match(/\$\s*[\d,.]+(?:\s*-\s*\$?\s*[\d,.]+)?/)?.[0] || '';
        const stockText = text.match(/可售库存\s*\d+/)?.[0] || '';
        const sellableInventory = Number(stockText.match(/[\d,]+/)?.[0]?.replace(/,/g,'') || 0) || null;
        const shippingFeeText = text.match(/(?:Shipping(?:\s*Fee)?|物流费)\s*[:：]?\s*((?:US)?\$\s*[\d,.]+(?:\s*-\s*(?:US)?\$?\s*[\d,.]+)?(?:\s*\/件)?)/i)?.[1] || '';
        const promotionText = text.match(/\d+(?:\.\d+)?%\s*OFF/i)?.[0] || '';
        const supplierName = [...card.querySelectorAll('[title],a,span')].map(node => node.getAttribute('title') || node.textContent || '').map(value => value.trim()).find(value => value && value.length < 60 && /Furniture|Home|Garden|Supply|Seller|家具|家居|公司/.test(value)) || '';
        const gigaIndex = Number(text.match(/GIGA Index:\s*([\d.]+)/i)?.[1] || 0) || null;
        seen.add(productId);
        const productIds=categoryIdsOf(url).slice(0,3);const productCategory=productIds.length>=pageIds.length&&productIds.length?{...sourceCategory,pathIds:productIds,level1:{id:productIds[0],name:namesById.get(productIds[0])||''},level2:productIds[1]?{id:productIds[1],name:namesById.get(productIds[1])||''}:undefined,level3:productIds[2]?{id:productIds[2],name:namesById.get(productIds[2])||''}:undefined,pathNames:productIds.map(id=>namesById.get(id)||'').filter(Boolean),capturedFrom:'PRODUCT_URL',status:productIds.length>=3?'EXACT':'PARTIAL'}:sourceCategory;
        result.push({productId,url,title,imageUrl:image?.currentSrc || image?.src || '',priceText,salesText:stockText,shippingFeeText,sellableInventory,promotionText,supplierName,gigaIndex,text,sourceCategory:productCategory});
        if (result.length >= ${Math.max(1, Math.min(task.maxProducts, 300))}) break;
      }
      return result;
    })()` ) as Array<{productId:string;url:string;title:string;imageUrl:string;priceText:string;salesText:string;shippingFeeText:string;sellableInventory:number|null;promotionText:string;supplierName:string;gigaIndex:number|null;text:string;sourceCategory:CollectedSupplyProduct['sourceCategory']}>
    const products = rawProducts.map(raw => {
      const score = raw.gigaIndex === null ? 0 : Math.round(raw.gigaIndex)
      const selected = raw.gigaIndex !== null && score >= task.minimumSelectionScore
      const sellerFilterText = ({ ANY:'不限', NEW:'新Seller', GE90:'≥90', GE80:'≥80', GE70:'≥70', GE60:'≥60', LT60:'＜60' } as const)[task.gigaSellerIndexFilter || 'GE80']
      const returnRateFilterText = ({ ANY:'不限', LOW:'低', MEDIUM:'中', HIGH:'高' } as const)[task.gigaReturnRateFilter || 'LOW']
      const dimensionScores = { inventory:raw.sellableInventory !== null ? Math.min(100,Math.round(45+Math.log10(Math.max(1,raw.sellableInventory))*18)) : 0, logistics:raw.shippingFeeText ? 70 : 0, supplier:raw.gigaIndex === null ? 0 : score }
      const riskFlags = [!raw.priceText ? '价格待补采' : '', !raw.salesText ? '库存待补采' : '', !raw.gigaIndex ? 'GIGA Index待补采' : '', raw.sourceCategory?.status !== 'EXACT' ? '类目待核实' : ''].filter(Boolean)
      return { platformCode:'GIGACLOUD' as const, productId:raw.productId, url:raw.url, title:raw.title, imageUrl:raw.imageUrl, priceText:raw.priceText, salesText:raw.salesText, shippingFeeText:raw.shippingFeeText, sellableInventory:raw.sellableInventory, promotionText:raw.promotionText, gigaIndex:raw.gigaIndex, supplierName:raw.supplierName, supplierBadges:raw.gigaIndex !== null ? ['GIGA_INDEX'] : [], categoryTopRank:null, returnRate:null, networkSalesCount:null, serviceRating:null, serviceDetails:{}, dataCompleteness:Math.round([raw.imageUrl,raw.priceText,raw.shippingFeeText,raw.sellableInventory !== null,raw.gigaIndex !== null,raw.sourceCategory?.pathIds.length].filter(Boolean).length / 6 * 100), score, grade:(!selected ? 'REJECTED' : score >= 80 ? 'A' : score >= 65 ? 'B' : 'C') as CollectedSupplyProduct['grade'], dimensionScores, recommendation:raw.gigaIndex === null ? 'GIGA Index待补采，暂不评分' : selected ? `GIGA Index ${raw.gigaIndex} · 筛选${sellerFilterText} · 店铺退货率${returnRateFilterText}` : `GIGA Index低于${task.minimumSelectionScore}`, riskFlags, selected, sourceCategory:raw.sourceCategory }
    }).sort((a,b)=>b.score-a.score)
    onProgress(`大健云仓采集完成，共${products.length}个商品`, products.length)
    return products
  }

  getState(platform: Platform): BrowserState {
    const contents = this.getCurrentView(platform).webContents
    return {
      platform,
      url: contents.getURL(),
      title: contents.getTitle(),
      loading: contents.isLoading(),
      canGoBack: contents.navigationHistory.canGoBack(),
      canGoForward: contents.navigationHistory.canGoForward()
    }
  }

  private emitState(platform: Platform) {
    if (platform !== this.active) return
    this.shellContents.send('browser:state', this.getState(platform))
  }

  private emitTabs() {
    const tabs: BrowserTab[] = [
      ...(this.supplyTabVisible ? [{ id: 'home-1688', platform: '1688' as const, title: this.supplyTitle, closable: false, active: this.activeTabId === 'home-1688' }] : []),
      ...(this.marketplaceTabVisible ? [{ id: 'home-ozon', platform: 'ozon' as const, title: this.marketplaceTitle, closable: false, active: this.activeTabId === 'home-ozon' }] : []),
      ...[...this.detailTabs.values()].map(tab => ({
        id: tab.id,
        platform: tab.platform,
        title: tab.title,
        faviconUrl: tab.faviconUrl,
        siteLogoUrl: tab.siteLogoUrl,
        closable: tab.closable ?? true,
        active: this.activeTabId === tab.id,
        generic: tab.generic,
        scopeId: tab.scopeId
      }))
    ]
    this.shellContents.send('browser:tabs', tabs)
  }

  private attachView(view: WebContentsView) {
    if (!this.browserVisible) return
    if (this.attached === view) {
      view.setBounds(this.bounds)
      return
    }
    if (this.attached) this.window.contentView.removeChildView(this.attached)
    this.window.contentView.addChildView(view)
    this.attached = view
    view.setBounds(this.bounds)
  }

  private isActivationCurrent(activationVersion:number,platformCode:'1688'|'GIGACLOUD') {
    return activationVersion===this.activationVersion&&platformCode===this.supplyPlatformCode
  }

  private getCurrentView(platform: Platform) {
    if (this.active === platform && this.attached) return this.attached
    return this.get(platform)
  }

  private get(platform: Platform) {
    if (platform === 'web') {
      const activeTab = this.detailTabs.get(this.activeTabId)
      if (activeTab?.platform === 'web') return activeTab.view
      const tab = [...this.detailTabs.values()].find(item => item.platform === 'web')
      if (tab) return tab.view
      throw new Error('通用网页标签不存在')
    }
    const view = this.views.get(platform)
    return view || this.createView(platform)
  }

  private visibleTabCount() {
    return Number(this.supplyTabVisible) + Number(this.marketplaceTabVisible) + this.detailTabs.size
  }

  private closeDetailTabs() {
    const tabs = [...this.detailTabs.values()]
    this.detailTabs.clear()
    this.credentialDomains = []
    for (const tab of tabs) {
      if (this.attached === tab.view) {
        this.window.contentView.removeChildView(tab.view)
        this.attached = null
      }
      tab.view.webContents.close()
    }
  }

  private showVisibleHome() {
    if (this.marketplaceTabVisible) this.show('ozon')
    else this.show('1688')
  }
}
