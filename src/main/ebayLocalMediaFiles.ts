import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { EbayLocalProductMedia } from '../shared/contracts'

export interface LocalMediaDownloadResult {
  media:EbayLocalProductMedia[]
  failures:string[]
}

const MAX_MEDIA_COUNT=24
const MAX_IMAGE_BYTES=12*1024*1024
const DOWNLOAD_TIMEOUT_MS=15_000
const DOWNLOAD_CONCURRENCY=6

type EbayImageFormat='jpeg'|'png'|'gif'|'tiff'|'bmp'|'webp'|'heic'|'avif'

// 与 main.ts 的 ebayImageFormats 逐键同表（模块测试有正则比对的漂移锁）。本模块放行的类型必须是
// updateEbayLocalProduct 用同一张表能接受的类型，否则「已下载到本地」的图照样被保存校验拒掉。
export const ebayImageFormats:Record<string,{format:EbayImageFormat;extension:string}>={
  'image/jpeg':{format:'jpeg',extension:'jpg'},
  'image/jpg':{format:'jpeg',extension:'jpg'},
  'image/png':{format:'png',extension:'png'},
  'image/gif':{format:'gif',extension:'gif'},
  'image/tiff':{format:'tiff',extension:'tiff'},
  'image/x-tiff':{format:'tiff',extension:'tiff'},
  'image/bmp':{format:'bmp',extension:'bmp'},
  'image/x-ms-bmp':{format:'bmp',extension:'bmp'},
  'image/webp':{format:'webp',extension:'webp'},
  'image/heic':{format:'heic',extension:'heic'},
  'image/heif':{format:'heic',extension:'heic'},
  'image/avif':{format:'avif',extension:'avif'}
}

// 复用已落盘文件时只有扩展名可用，反查回白名单里的规范 mimeType（同一扩展名取首个 MIME，与原表顺序一致）
const imageFormatByExtension:Record<string,{format:EbayImageFormat;mimeType:string}>={}
for(const [mimeType,entry] of Object.entries(ebayImageFormats)) if(!imageFormatByExtension[entry.extension])imageFormatByExtension[entry.extension]={format:entry.format,mimeType}

export function ebayImageFormat(mimeType:string):{format:EbayImageFormat;extension:string}|undefined {
  return ebayImageFormats[mimeType.toLowerCase().split(';')[0]]
}

// 与 main.ts:459 safeLocalSegment 同规则（该函数在 main.ts 内未导出）：只留 [A-Za-z0-9._-]，连续非法字符并成一把 -，首尾去把，空值回落 unknown
function safeLocalSegment(value:string) {
  return value.replace(/[^a-z0-9._-]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,100)||'unknown'
}

function tiffDimensions(buffer:Buffer) {
  if(buffer.length<8)return {width:0,height:0}
  const signature=buffer.toString('ascii',0,2)
  const littleEndian=signature==='II'
  if(!littleEndian&&signature!=='MM')return {width:0,height:0}
  const readUInt16=(offset:number)=>littleEndian?buffer.readUInt16LE(offset):buffer.readUInt16BE(offset)
  const readUInt32=(offset:number)=>littleEndian?buffer.readUInt32LE(offset):buffer.readUInt32BE(offset)
  if(readUInt16(2)!==42)return {width:0,height:0}
  const ifdOffset=readUInt32(4)
  if(ifdOffset+2>buffer.length)return {width:0,height:0}
  const entryCount=readUInt16(ifdOffset)
  let width=0
  let height=0
  for(let index=0;index<entryCount;index+=1) {
    const offset=ifdOffset+2+index*12
    if(offset+12>buffer.length)break
    const tag=readUInt16(offset)
    if(tag!==256&&tag!==257)continue
    const type=readUInt16(offset+2)
    const value=type===3?readUInt16(offset+8):type===4?readUInt32(offset+8):0
    if(tag===256)width=value
    if(tag===257)height=value
  }
  return {width,height}
}

function imageDimensions(buffer:Buffer,format:string) {
  if(format==='png'&&buffer.length>=24)return {width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)}
  if(format==='gif'&&buffer.length>=10)return {width:buffer.readUInt16LE(6),height:buffer.readUInt16LE(8)}
  if(format==='bmp'&&buffer.length>=26)return {width:Math.abs(buffer.readInt32LE(18)),height:Math.abs(buffer.readInt32LE(22))}
  if(format==='tiff')return tiffDimensions(buffer)
  if(format==='webp'&&buffer.length>=30) {
    const chunk=buffer.toString('ascii',12,16)
    if(chunk==='VP8X')return {width:1+buffer.readUIntLE(24,3),height:1+buffer.readUIntLE(27,3)}
    if(chunk==='VP8 '&&buffer.toString('hex',23,26)==='9d012a')return {width:buffer.readUInt16LE(26)&0x3fff,height:buffer.readUInt16LE(28)&0x3fff}
    if(chunk==='VP8L'&&buffer[20]===0x2f){const bits=buffer.readUInt32LE(21);return {width:(bits&0x3fff)+1,height:((bits>>>14)&0x3fff)+1}}
  }
  if((format==='heic'||format==='avif')&&buffer.length>=20) {
    const ispe=buffer.indexOf(Buffer.from('ispe'))
    if(ispe>=0&&ispe+16<=buffer.length)return {width:buffer.readUInt32BE(ispe+8),height:buffer.readUInt32BE(ispe+12)}
  }
  if(format==='jpeg')for(let offset=2;offset+9<buffer.length;){if(buffer[offset]!==0xff){offset+=1;continue}const marker=buffer[offset+1];const size=buffer.readUInt16BE(offset+2);if(marker>=0xc0&&marker<=0xc3)return {width:buffer.readUInt16BE(offset+7),height:buffer.readUInt16BE(offset+5)};if(size<2)break;offset+=2+size}
  return {width:0,height:0}
}

const failedRow=(remoteUrl:string,sortOrder:number):EbayLocalProductMedia=>({id:`ai-opt-${hashOf(remoteUrl)}`,mediaType:'IMAGE',sortOrder,remoteUrl,localPath:'',mimeType:'',width:0,height:0,fileSize:0,sha256:'',downloadStatus:'FAILED'})

function hashOf(url:string) {
  return createHash('sha256').update(url).digest('hex').slice(0,16)
}

function downloadedRow(remoteUrl:string,sortOrder:number,localPath:string,buffer:Buffer,mimeType:string,width:number,height:number):EbayLocalProductMedia {
  return {id:`ai-opt-${hashOf(remoteUrl)}`,mediaType:'IMAGE',sortOrder,remoteUrl,localPath,mimeType,width,height,fileSize:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),downloadStatus:'DOWNLOADED'}
}

/** 已落盘文件的复用读数：只有非空文件、扩展名在白名单内且尺寸读得出才算复用，否则回落重新下载（坏缓存自愈）。 */
function reuseLocalFile(directory:string,hash:string):{buffer:Buffer;localPath:string;mimeType:string;width:number;height:number}|null {
  let names:string[]
  try { names=fs.readdirSync(directory) } catch { return null }
  for(const name of names) {
    const match=/^([0-9a-f]{16})\.([a-z]+)$/.exec(name)
    if(!match||match[1]!==hash)continue
    const entry=imageFormatByExtension[match[2]]
    if(!entry)continue
    const localPath=path.join(directory,name)
    let buffer:Buffer
    try { if(fs.statSync(localPath).size<=0)continue; buffer=fs.readFileSync(localPath) } catch { continue }
    const dimensions=imageDimensions(buffer,entry.format)
    if(!dimensions.width||!dimensions.height)continue
    return {buffer,localPath,mimeType:entry.mimeType,width:dimensions.width,height:dimensions.height}
  }
  return null
}

/**
 * 把远程（AI 优化后转存自有服务器）图片真下载到 <rootDir>/<safeStoreId>/<safeListingId>/ai-opt/<sha256(url)前16位>.<ext>。
 * 每行只如实写两种真实状态：落盘成功=DOWNLOADED+真实 localPath，失败=FAILED+空 localPath 并在 failures 点名第几张；
 * 单张失败绝不抛整批，只有目录不可建这类前置故障才抛。同 URL 已落盘则复用，不重发请求。
 */
export async function downloadUrlsToLocalMedia(urls:string[],input:{storeId:string;listingId:string;rootDir:string;fetchImpl?:typeof fetch}):Promise<LocalMediaDownloadResult> {
  const targets=[...new Set((urls||[]).map(url=>String(url||'').trim()).filter(Boolean))].slice(0,MAX_MEDIA_COUNT)
  const directory=path.join(input.rootDir,safeLocalSegment(input.storeId),safeLocalSegment(input.listingId),'ai-opt')
  fs.mkdirSync(directory,{recursive:true})
  const fetchImpl=input.fetchImpl||globalThis.fetch
  const media:EbayLocalProductMedia[]=new Array(targets.length)
  const failures:string[]=[]
  let nextIndex=0
  const downloadNext=async()=>{
    while(nextIndex<targets.length) {
      const index=nextIndex++
      const remoteUrl=targets[index]
      const hash=hashOf(remoteUrl)
      const reused=reuseLocalFile(directory,hash)
      if(reused) {
        media[index]=downloadedRow(remoteUrl,index,reused.localPath,reused.buffer,reused.mimeType,reused.width,reused.height)
        continue
      }
      try {
        // data: 地址是随草稿带过来的内联图，不发请求、直接解码落盘；发出去的只有 http(s) 远程地址。
        let buffer:Buffer
        let mimeType:string
        if(remoteUrl.startsWith('data:')) {
          const inline=/^data:([^;,]+)(;base64)?,(.*)$/s.exec(remoteUrl)
          if(!inline)throw new Error('图片数据格式无效')
          mimeType=inline[1].toLowerCase()
          buffer=inline[2]?Buffer.from(inline[3],'base64'):Buffer.from(decodeURIComponent(inline[3]))
        } else {
          const response=await fetchImpl(remoteUrl,{signal:AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),headers:{'User-Agent':'Mozilla/5.0'}})
          if(!response.ok)throw new Error(`HTTP ${response.status}`)
          buffer=Buffer.from(await response.arrayBuffer())
          mimeType=(response.headers.get('content-type')||'').split(';')[0].toLowerCase()
        }
        if(!buffer.length)throw new Error('图片内容为空')
        const selected=ebayImageFormat(mimeType)
        if(!selected)throw new Error(`不支持的图片类型：${mimeType||'未知'}`)
        if(buffer.length>MAX_IMAGE_BYTES)throw new Error('单张图片不能超过12MB')
        const dimensions=imageDimensions(buffer,selected.format)
        if(!dimensions.width||!dimensions.height)throw new Error('无法识别图片尺寸')
        const localPath=path.join(directory,`${hash}.${selected.extension}`)
        fs.writeFileSync(localPath,buffer)
        media[index]=downloadedRow(remoteUrl,index,localPath,buffer,mimeType,dimensions.width,dimensions.height)
      } catch(error) {
        const reason=error instanceof Error?error.message:'未知错误'
        failures.push(`第 ${index+1} 张：${reason}`)
        media[index]=failedRow(remoteUrl,index)
      }
    }
  }
  await Promise.all(Array.from({length:Math.min(DOWNLOAD_CONCURRENCY,targets.length)},()=>downloadNext()))
  return {media,failures}
}
