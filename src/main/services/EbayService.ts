import type { EbayListing } from '../../shared/contracts'

export interface EbayOAuthTokens {
  accessToken:string
  refreshToken:string
  accessTokenExpiresAt:string
  refreshTokenExpiresAt:string
}

const authBase='https://auth.ebay.com/oauth2/authorize'
const tokenUrl='https://api.ebay.com/identity/v1/oauth2/token'
const tradingUrl='https://api.ebay.com/ws/api.dll'
const scope='https://api.ebay.com/oauth/api_scope'

function decodeXml(value:string) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&').trim()
}

function tag(xml:string,name:string) {
  const match=xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))
  return match?decodeXml(match[1]):''
}

function tagCurrency(xml:string,name:string) {
  const match=xml.match(new RegExp(`<${name}(?:\\s[^>]*)?currencyID="([^"]+)"[^>]*>([\\s\\S]*?)<\\/${name}>`,'i'))
  return match?{currency:match[1],value:decodeXml(match[2])}:{currency:'',value:tag(xml,name)}
}

function parseItems(xml:string,storeId:string):EbayListing[] {
  const active=xml.match(/<ActiveList>([\s\S]*?)<\/ActiveList>/i)?.[1]||''
  return [...active.matchAll(/<Item>([\s\S]*?)<\/Item>/gi)].map(match=>{
    const item=match[1]
    const price=tagCurrency(item,'CurrentPrice')
    const listingId=tag(item,'ItemID')
    const marketplaceId=tag(item,'Site')||'eBay'
    return {
      id:`${storeId}:${marketplaceId}:${listingId}`,storeId,marketplaceId,listingId,sku:tag(item,'SKU'),title:tag(item,'Title'),
      price:price.value,currency:price.currency,quantity:Number(tag(item,'QuantityAvailable')||tag(item,'Quantity')||0),
      imageUrl:tag(item,'GalleryURL')||tag(item,'PictureURL'),categoryId:tag(item,'CategoryID'),categoryName:tag(item,'CategoryName'),
      status:'ACTIVE' as const,viewUrl:tag(item,'ViewItemURL')||tag(item,'ViewItemURLForNaturalSearch'),updatedAt:new Date().toISOString()
    }
  }).filter(item=>item.listingId)
}

export class EbayService {
  constructor(private readonly clientId:string,private readonly clientSecret:string,private readonly ruName:string) {}

  configuration() {
    return { environment:'PRODUCTION' as const,configured:Boolean(this.clientId&&this.clientSecret&&this.ruName),marketDataConfigured:false,clientIdConfigured:Boolean(this.clientId),clientSecretConfigured:Boolean(this.clientSecret),ruNameConfigured:Boolean(this.ruName),readOnly:true }
  }

  authorizationUrl(state:string) {
    if(!this.configuration().configured)throw new Error('请先在 .env.local 配置 EBAY_CLIENT_ID、EBAY_CLIENT_SECRET 和 EBAY_RUNAME')
    const query=new URLSearchParams({client_id:this.clientId,redirect_uri:this.ruName,response_type:'code',scope,state})
    return `${authBase}?${query.toString()}`
  }

  private async tokenRequest(parameters:URLSearchParams) {
    const response=await fetch(tokenUrl,{method:'POST',headers:{Authorization:`Basic ${Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'},body:parameters})
    const body=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number;refresh_token_expires_in?:number;error_description?:string;error?:string}
    if(!response.ok||!body.access_token)throw new Error(`eBay正式环境授权失败：${body.error_description||body.error||response.status}`)
    return body
  }

  async exchangeCode(code:string):Promise<EbayOAuthTokens> {
    const body=await this.tokenRequest(new URLSearchParams({grant_type:'authorization_code',code,redirect_uri:this.ruName}))
    if(!body.refresh_token)throw new Error('eBay授权响应未返回 Refresh Token，请重新授权店铺')
    const now=Date.now()
    return {accessToken:body.access_token!,refreshToken:body.refresh_token,accessTokenExpiresAt:new Date(now+(body.expires_in||7200)*1000).toISOString(),refreshTokenExpiresAt:new Date(now+(body.refresh_token_expires_in||47304000)*1000).toISOString()}
  }

  async refreshAccessToken(refreshToken:string) {
    const body=await this.tokenRequest(new URLSearchParams({grant_type:'refresh_token',refresh_token:refreshToken,scope}))
    return {accessToken:body.access_token!,accessTokenExpiresAt:new Date(Date.now()+(body.expires_in||7200)*1000).toISOString()}
  }

  private async tradingCall(accessToken:string,page:number) {
    const request=`<?xml version="1.0" encoding="utf-8"?><GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents"><DetailLevel>ReturnAll</DetailLevel><ActiveList><Include>true</Include><Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList><HideVariations>false</HideVariations></GetMyeBaySellingRequest>`
    const response=await fetch(tradingUrl,{method:'POST',headers:{'X-EBAY-API-CALL-NAME':'GetMyeBaySelling','X-EBAY-API-SITEID':'0','X-EBAY-API-COMPATIBILITY-LEVEL':'1423','X-EBAY-API-IAF-TOKEN':accessToken,'Content-Type':'text/xml'},body:request})
    const xml=await response.text()
    const ack=tag(xml,'Ack')
    if(!response.ok||!['Success','Warning'].includes(ack))throw new Error(`eBay商品同步失败：${tag(xml,'LongMessage')||tag(xml,'ShortMessage')||response.status}`)
    return xml
  }

  async fetchActiveListings(storeId:string,accessToken:string) {
    const first=await this.tradingCall(accessToken,1)
    const pages=Math.max(1,Math.min(125,Number(tag(first,'TotalNumberOfPages')||1)))
    const listings=parseItems(first,storeId)
    for(let page=2;page<=pages;page++)listings.push(...parseItems(await this.tradingCall(accessToken,page),storeId))
    return listings
  }
}
