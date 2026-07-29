import type { EbayListing } from '../../shared/contracts'

const aliases={
  listingId:['itemnumber','itemid','itemnumberid','listingid'],
  sku:['customlabelsku','customlabel','sku'],
  title:['title','itemtitle'],
  price:['currentprice','price','startprice','buyitnowprice'],
  currency:['currency','currencycode'],
  quantity:['availablequantity','quantityavailable','quantity','qty'],
  imageUrl:['pictureurl','imageurl','galleryurl','photoURL','photourl'],
  categoryId:['categoryid','leafcategoryid'],
  categoryName:['categoryname','leafcategoryname','category'],
  marketplaceId:['site','marketplace','marketplaceid','ebaysite'],
  viewUrl:['itemurl','viewitemurl','listingurl','url']
} as const

function normalizeHeader(value:string) {
  return value.normalize('NFKC').trim().toLowerCase().replace(/[^a-z0-9]/g,'')
}

function parseRows(input:string,delimiter:string) {
  const rows:string[][]=[]
  let row:string[]=[],cell='',quoted=false
  for(let index=0;index<input.length;index+=1){
    const char=input[index]
    if(char==='"'){
      if(quoted&&input[index+1]==='"'){cell+='"';index+=1}else quoted=!quoted
    }else if(char===delimiter&&!quoted){row.push(cell);cell=''}
    else if((char==='\n'||char==='\r')&&!quoted){
      if(char==='\r'&&input[index+1]==='\n')index+=1
      row.push(cell);cell=''
      if(row.some(value=>value.trim()))rows.push(row)
      row=[]
    }else cell+=char
  }
  row.push(cell)
  if(row.some(value=>value.trim()))rows.push(row)
  return rows
}

function delimiterFor(firstLine:string) {
  const candidates=[',','\t',';']
  return candidates.sort((left,right)=>firstLine.split(right).length-firstLine.split(left).length)[0]
}

function valueFor(row:string[],headers:string[],names:readonly string[]) {
  const index=headers.findIndex(header=>names.includes(header as never))
  return index>=0?String(row[index]||'').trim():''
}

export function parseEbayListingsReport(content:string,storeId:string,defaultMarketplaceId='EBAY_US') {
  const clean=content.replace(/^\uFEFF/,'')
  const rows=parseRows(clean,delimiterFor(clean.split(/\r?\n/,1)[0]||''))
  if(rows.length<2)throw new Error('eBay Listings 报表没有可导入的商品数据')
  const headers=rows[0].map(normalizeHeader)
  if(!headers.some(header=>aliases.listingId.includes(header as never)))throw new Error('未找到 Item ID / Item number 列，请从 Seller Hub Reports 下载 Listings 报表')
  const errors:string[]=[]
  const listings:EbayListing[]=[]
  rows.slice(1).forEach((row,rowIndex)=>{
    const listingId=valueFor(row,headers,aliases.listingId)
    const title=valueFor(row,headers,aliases.title)
    if(!listingId||!title){errors.push(`第 ${rowIndex+2} 行缺少 ${!listingId?'Item ID':'标题'}`);return}
    const marketplaceId=valueFor(row,headers,aliases.marketplaceId)||defaultMarketplaceId
    const quantityText=valueFor(row,headers,aliases.quantity).replace(/[^0-9.-]/g,'')
    listings.push({
      id:`${storeId}:${marketplaceId}:${listingId}`,storeId,marketplaceId,listingId,
      sku:valueFor(row,headers,aliases.sku),title,price:valueFor(row,headers,aliases.price).replace(/[^0-9.,-]/g,'').replace(/,/g,''),
      currency:valueFor(row,headers,aliases.currency),quantity:Number.isFinite(Number(quantityText))?Math.max(0,Number(quantityText)):0,
      imageUrl:valueFor(row,headers,aliases.imageUrl),categoryId:valueFor(row,headers,aliases.categoryId),categoryName:valueFor(row,headers,aliases.categoryName),
      status:'ACTIVE',viewUrl:valueFor(row,headers,aliases.viewUrl)||`https://www.ebay.com/itm/${encodeURIComponent(listingId)}`,updatedAt:new Date().toISOString()
    })
  })
  if(!listings.length)throw new Error(`eBay Listings 报表导入失败：${errors[0]||'未识别到商品'}`)
  return {listings,errors:errors.slice(0,20),failed:errors.length}
}
