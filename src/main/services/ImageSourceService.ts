import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { ImportedProductImage, ImportedProductSource } from '../../shared/contracts'

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const maxImageBytes = 15 * 1024 * 1024
const maxHtmlBytes = 5 * 1024 * 1024
const browserUserAgent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const mobileUserAgent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'

function isPrivateAddress(address: string): boolean {
  const normalized = address.replace(/^::ffff:/, '')
  if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:')) return true
  const parts = normalized.split('.').map(Number)
  if (parts.length !== 4 || parts.some(Number.isNaN)) return false
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || parts[0] === 169 && parts[1] === 254 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31 || parts[0] === 192 && parts[1] === 168
}

export async function validatePublicProductUrl(value: string): Promise<URL> {
  let url: URL
  try { url = new URL(value) } catch { throw new Error('请输入完整的 http 或 https 产品网址') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('产品网址只支持 http 或 https')
  if (url.username || url.password) throw new Error('产品网址不能包含账号或密码')
  const hostname = url.hostname.toLocaleLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) throw new Error('不允许读取本机或内网网址')
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true })
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) throw new Error('不允许读取本机或内网网址')
  return url
}

function decoded(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()
}

function metaContent(html: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, 'i')
  ]
  return decoded(patterns.map(pattern => html.match(pattern)?.[1]).find(Boolean) || '')
}

async function publicFetch(start: URL,userAgent=browserUserAgent,cookieHeader=''): Promise<{ response: Response; finalUrl: URL }> {
  let current = start
  for (let redirect = 0; redirect <= 5; redirect += 1) {
    current = await validatePublicProductUrl(current.toString())
    const headers:Record<string,string>={ 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml,image/avif,image/webp,image/png,image/jpeg', 'accept-language':'zh-CN,zh;q=0.9,en;q=0.8' }
    if(cookieHeader&&/(^|\.)1688\.com$/i.test(current.hostname))headers.cookie=cookieHeader
    const response = await fetch(current, { redirect: 'manual', signal: AbortSignal.timeout(15_000), headers })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location) throw new Error('网址重定向缺少目标地址')
      current = new URL(location, current)
      continue
    }
    if (!response.ok) throw new Error(`网址读取失败（HTTP ${response.status}）`)
    return { response, finalUrl: current }
  }
  throw new Error('网址重定向次数过多')
}

async function readLimited(response: Response, limit: number): Promise<Uint8Array> {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > limit) throw new Error('来源内容超过允许大小')
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > limit) throw new Error('来源内容超过允许大小')
  return bytes
}

async function importImage(url: URL, fallbackName: string): Promise<ImportedProductImage> {
  const { response, finalUrl } = await publicFetch(url)
  const mimeType = (response.headers.get('content-type') || '').split(';')[0].toLocaleLowerCase()
  if (!imageTypes.has(mimeType)) throw new Error('读取结果不是受支持的 JPG、PNG 或 WebP 图片')
  const bytes = await readLimited(response, maxImageBytes)
  return { name: decodeURIComponent(finalUrl.pathname.split('/').pop() || fallbackName), dataUrl: `data:${mimeType};base64,${Buffer.from(bytes).toString('base64')}`, source: finalUrl.toString(), mimeType: mimeType as ImportedProductImage['mimeType'] }
}

function embeddedString(html:string,key:string):string {
  const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=html.match(new RegExp(`"${escaped}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`))
  if(!match)return''
  try{return JSON.parse(`"${match[1]}"`)}catch{return decoded(match[1].replace(/\\\//g,'/'))}
}

function embeddedStringArray(html:string,key:string):string[] {
  const escaped=key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=html.match(new RegExp(`"${escaped}"\\s*:\\s*(\\[(?:"(?:\\\\.|[^"\\\\])*"\\s*,?\\s*)+\\])`))
  if(!match)return[]
  try{const values=JSON.parse(match[1]);return Array.isArray(values)?values.map(String).filter(Boolean):[]}catch{return[]}
}

function embeddedNamedImages(html:string):Array<{url:string;name:string}> {
  return [...html.matchAll(/"imageUrl"\s*:\s*"((?:\\.|[^"\\])*)"/g)].flatMap(match=>{try{const url=JSON.parse(`"${match[1]}"`);if(!/\/img\/ibank\//.test(url))return[];const context=html.slice(Math.max(0,(match.index||0)-240),(match.index||0)+600),nameMatch=context.match(/"name"\s*:\s*"((?:\\.|[^"\\])*)"/);return[{url,name:nameMatch?JSON.parse(`"${nameMatch[1]}"`):'SKU规格图'}]}catch{return[]}})
}

function embeddedAttribute(html:string,name:string):string {
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=html.match(new RegExp(`"name"\\s*:\\s*"${escaped}"[\\s\\S]{0,500}?"value"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`))
  if(!match)return''
  try{return JSON.parse(`"${match[1]}"`)}catch{return match[1]}
}

async function importCandidates(candidates:Array<{url:string;name:string;role:ImportedProductImage['role'];sourceType:ImportedProductImage['sourceType'];sourceText?:string}>):Promise<ImportedProductImage[]> {
  const images:ImportedProductImage[]=[]
  for(let offset=0;offset<candidates.length;offset+=6){const batch=candidates.slice(offset,offset+6),results=await Promise.allSettled(batch.map(item=>importImage(new URL(item.url),item.name)));results.forEach((result,index)=>{if(result.status==='fulfilled'){const item=batch[index];images.push({...result.value,id:crypto.randomUUID(),name:item.name,role:item.role,sourceType:item.sourceType,sourceText:item.sourceText})}})}
  return images
}

export async function importProductUrl(value: string,cookieHeader='',prefetchedHtml?:string): Promise<ImportedProductSource> {
  const initialUrl = await validatePublicProductUrl(value.trim())
  const fetched=prefetchedHtml===undefined?await publicFetch(initialUrl,browserUserAgent,cookieHeader):null,response=fetched?.response,finalUrl=fetched?.finalUrl||initialUrl
  const contentType = prefetchedHtml!==undefined?'text/html':(response?.headers.get('content-type') || '').split(';')[0].toLocaleLowerCase()
  if (imageTypes.has(contentType)) {
    const bytes = await readLimited(response!, maxImageBytes)
    const image: ImportedProductImage = { id:crypto.randomUUID(), name: decodeURIComponent(finalUrl.pathname.split('/').pop() || '网络商品图'), dataUrl: `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`, source: finalUrl.toString(), mimeType: contentType as ImportedProductImage['mimeType'], role:'PRIMARY' }
    const title=image.name.replace(/\.[^.]+$/, '') || '网络商品'
    return { sourceKind: 'URL', sourceLabel: '网址图片', sourceUrl: finalUrl.toString(), title, productId: `URL-${Date.now()}`, priceText: '价格待核验', imageUrl: image.dataUrl, images: [image], evidence:[{field:'title',value:title,source:finalUrl.toString()},{field:'imageUrl',value:finalUrl.toString(),source:finalUrl.toString()}] }
  }
  if (contentType !== 'text/html' && contentType !== 'application/xhtml+xml') throw new Error('网址未返回商品页或受支持的图片')
  let html = prefetchedHtml??new TextDecoder().decode(await readLimited(response!, maxHtmlBytes)),pageUrl=finalUrl
  const is1688=/(^|\.)1688\.com$/i.test(finalUrl.hostname),offerId=finalUrl.pathname.match(/offer\/(\d+)/)?.[1]
  if(is1688&&offerId&&!html.includes('offerImgList')){const fallbacks:[[string,string],[string,string],[string,string]]=[[`https://m.1688.com/offer/${offerId}.html`,mobileUserAgent],[`https://detail.1688.com/offer/${offerId}.html?sk=order`,browserUserAgent],[`https://m.1688.com/offer/${offerId}.html?from=pc`,mobileUserAgent]];for(const [fallbackUrl,userAgent] of fallbacks){try{const next=await publicFetch(new URL(fallbackUrl),userAgent,cookieHeader),nextHtml=new TextDecoder().decode(await readLimited(next.response,maxHtmlBytes));if(nextHtml.includes('offerImgList')){html=nextHtml;pageUrl=next.finalUrl;break}}catch{/* 继续尝试下一公开入口 */}}}
  if(is1688&&offerId&&!html.includes('offerImgList'))throw new Error('1688返回了访问验证页，请先在系统内置1688页面完成登录或验证，然后重新读取商品网址')
  const rawTitle = metaContent(html, 'og:title') || (is1688?embeddedString(html,'subject'):'') || decoded(html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '') || '网络商品'
  const galleryValues=is1688?embeddedStringArray(html,'mainImage'):[metaContent(html,'og:image'),metaContent(html,'twitter:image'),...[...html.matchAll(/<img[^>]+(?:src|data-src)=["']([^"']+)["']/gi)].map(match=>decoded(match[1]))].filter(Boolean)
  const skuImages=is1688?embeddedNamedImages(html):[],detailUrl=is1688?embeddedString(html,'detailUrl'):''
  let detailImages:string[]=[]
  if(detailUrl){try{const detail=await publicFetch(new URL(detailUrl),mobileUserAgent,cookieHeader),detailHtml=new TextDecoder().decode(await readLimited(detail.response,maxHtmlBytes));detailImages=[...detailHtml.matchAll(/https?:[^"']+?\.(?:jpe?g|png|webp)/gi)].map(match=>match[0].replace(/\\\//g,'/'));if(process.env.CODEX_IMAGE_SOURCE_DEBUG==='1')console.log('[detail-debug]',JSON.stringify(detailHtml.slice(0,300)))}catch{/* 详情资源失败时仍保留图库与SKU图 */}}
  if(process.env.CODEX_IMAGE_SOURCE_DEBUG==='1')console.log('[image-source-debug]',{htmlBytes:html.length,skuSample:html.slice(Math.max(0,html.indexOf('skuProps')),Math.max(0,html.indexOf('skuProps'))+500),skuImages:skuImages.length,detailUrl,detailImages:detailImages.length})
  const resolve=(url:string)=>{try{return new URL(url,pageUrl).toString()}catch{return''}},seen=new Set<string>(),candidates:Array<{url:string;name:string;role:ImportedProductImage['role'];sourceType:ImportedProductImage['sourceType'];sourceText?:string}>=[]
  const add=(url:string,item:Omit<(typeof candidates)[number],'url'>)=>{const resolved=resolve(url);if(!resolved||seen.has(resolved))return;seen.add(resolved);candidates.push({url:resolved,...item})}
  galleryValues.forEach((url,index)=>add(url,{name:`商品图库-${index+1}`,role:index===0?'PRIMARY':'DETAIL',sourceType:'GALLERY'}))
  skuImages.forEach((item,index)=>add(item.url,{name:`SKU规格-${index+1}`,role:'DETAIL',sourceType:'SKU',sourceText:item.name}))
  detailImages.forEach((url,index)=>add(url,{name:`详情页-${index+1}`,role:'DETAIL',sourceType:'DESCRIPTION'}))
  if (!candidates.length) throw new Error('网页中未找到可读取的商品图片，请改用本地上传')
  const images=await importCandidates(candidates.slice(0,60))
  if(!images.length)throw new Error('网页中的候选图片均无法安全读取')
  const title=rawTitle.slice(0,160)
  const productId=metaContent(html,'product:retailer_item_id')||metaContent(html,'sku')||(is1688?String(finalUrl.pathname.match(/offer\/(\d+)/)?.[1]||''):'')||`URL-${Date.now()}`
  const priceText=metaContent(html,'product:price:amount')||metaContent(html,'og:price:amount')||(is1688?embeddedString(html,'priceDisplay'):'')||'价格待核验'
  const attributeDefinitions=[['brand','品牌'],['material','材质'],['specification','包装数量(片)'],['specification','货号'],['audience','适用对象'],['useScenario','适用场景']] as const
  const pageFacts:Array<{key:string;label:string;value:string;source:string}>=attributeDefinitions.flatMap(([key,label])=>{const extracted=is1688?embeddedAttribute(html,label):'';return extracted?[{key,label,value:extracted,source:finalUrl.toString()}]:[]})
  const skuNames=[...new Set(skuImages.map(item=>item.name).filter(Boolean))]
  if(skuNames.length)pageFacts.push({key:'specification',label:'SKU规格',value:skuNames.join('；'),source:finalUrl.toString()})
  return { sourceKind:'URL',sourceLabel:'产品网址',sourceUrl:finalUrl.toString(),title,productId,priceText,imageUrl:images[0].dataUrl,images,pageFacts,evidence:[{field:'title',value:title,source:finalUrl.toString()},{field:'productId',value:productId,source:finalUrl.toString()},{field:'priceText',value:priceText,source:finalUrl.toString()},...pageFacts.map(item=>({field:'attribute' as const,value:`${item.label}=${item.value}`,source:item.source})),...images.map(image=>({field:image.sourceType==='SKU'?'sku' as const:image.sourceType==='DESCRIPTION'?'description' as const:'imageUrl' as const,value:image.sourceText||image.source,source:image.source}))]}
}
