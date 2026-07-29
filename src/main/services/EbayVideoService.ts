import ffmpeg from '@ffmpeg-installer/ffmpeg'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import type { EbayOptimizationDraft, EbayPublishVideoArtifact } from '../../shared/contracts'

const VIDEO_SECONDS=15
const WIDTH=1280
const HEIGHT=720

function runFfmpeg(args:string[]):Promise<string> {
  return new Promise((resolve,reject)=>{
    const child=spawn(ffmpeg.path,args,{stdio:['ignore','ignore','pipe']})
    let diagnostics=''
    child.stderr.on('data',chunk=>{diagnostics+=String(chunk)})
    child.once('error',reject)
    child.once('close',code=>code===0?resolve(diagnostics):reject(new Error(`视频生成失败（ffmpeg ${code}）：${diagnostics.slice(-1200)}`)))
  })
}

function imageExtension(contentType:string,url:string) {
  if(contentType.includes('png'))return '.png'
  if(contentType.includes('webp'))return '.webp'
  if(contentType.includes('gif'))return '.gif'
  if(contentType.includes('jpeg')||contentType.includes('jpg'))return '.jpg'
  const extension=path.extname(new URL(url).pathname).toLowerCase()
  return ['.jpg','.jpeg','.png','.webp','.gif'].includes(extension)?extension:'.jpg'
}

async function downloadImage(url:string,targetBase:string,index:number) {
  const normalized=url.replace(/\/s-l\d+(?=\.[a-z0-9]+(?:\?|$))/i,'/s-l1600')
  const response=await fetch(normalized,{signal:AbortSignal.timeout(20_000),headers:{'User-Agent':'Mozilla/5.0'}})
  if(!response.ok)throw new Error(`图片 ${index+1} 下载失败：HTTP ${response.status}`)
  const buffer=Buffer.from(await response.arrayBuffer())
  if(buffer.length<1024)throw new Error(`图片 ${index+1} 文件异常`)
  const filePath=`${targetBase}-${index+1}${imageExtension(response.headers.get('content-type')||'',normalized)}`
  fs.writeFileSync(filePath,buffer)
  return filePath
}

export class EbayVideoService {
  constructor(private readonly rootDirectory:string) {}

  async generate(draft:EbayOptimizationDraft):Promise<EbayPublishVideoArtifact> {
    const sourceUrls=draft.imageUrls?.length?draft.imageUrls:[draft.imageUrl,...(draft.listing.imageUrls||[]),draft.listing.imageUrl]
      .filter(Boolean)
      .map(url=>url.replace(/\/s-l\d+(?=\.[a-z0-9]+(?:\?|$))/i,'/s-l1600'))
    const unique=[...new Set(sourceUrls)].slice(0,5)
    if(!unique.length)throw new Error('没有可用于视频的 eBay 原商品图片')
    const workDirectory=path.join(this.rootDirectory,'work',`${draft.listingId}-${Date.now()}`)
    fs.mkdirSync(workDirectory,{recursive:true})
    try {
      const downloaded:string[]=[]
      const warnings:string[]=[]
      for(let index=0;index<unique.length;index+=1){
        try{downloaded.push(await downloadImage(unique[index],path.join(workDirectory,'source'),index))}
        catch(error){warnings.push(error instanceof Error?error.message:`图片 ${index+1} 下载失败`)}
      }
      if(!downloaded.length)throw new Error(`原商品图片均无法读取：${warnings.join('；')}`)
      fs.mkdirSync(this.rootDirectory,{recursive:true})
      const fileName=`ebay-${draft.listingId}-${Date.now()}.mp4`
      const filePath=path.join(this.rootDirectory,fileName)
      const shotDuration=VIDEO_SECONDS/downloaded.length
      const args:string[]=[]
      downloaded.forEach(file=>args.push('-loop','1','-t',shotDuration.toFixed(3),'-i',file))
      const filters=downloaded.map((_,index)=>{
        const fadeOut=Math.max(0.4,shotDuration-0.35).toFixed(3)
        return `[${index}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1,fps=30,format=yuv420p,fade=t=in:st=0:d=0.35:color=white,fade=t=out:st=${fadeOut}:d=0.35:color=white[v${index}]`
      })
      const concat=downloaded.map((_,index)=>`[v${index}]`).join('')
      filters.push(`${concat}concat=n=${downloaded.length}:v=1:a=0[outv]`)
      args.push('-filter_complex',filters.join(';'),'-map','[outv]','-t',String(VIDEO_SECONDS),'-an','-c:v','libx264','-preset','medium','-crf','20','-movflags','+faststart','-pix_fmt','yuv420p','-y',filePath)
      await runFfmpeg(args)
      const stat=fs.statSync(filePath)
      return {
        status:'READY',fileName,filePath,previewUrl:`cross-media://ebay/${encodeURIComponent(fileName)}`,
        durationSeconds:VIDEO_SECONDS,width:WIDTH,height:HEIGHT,imageCount:downloaded.length,sizeBytes:stat.size,
        generatedAt:new Date().toISOString(),
        message:`已使用 ${downloaded.length} 张 eBay 原商品图片生成 15 秒视频${warnings.length?`；${warnings.length} 张图片读取失败已跳过`:''}`
      }
    } finally {
      fs.rmSync(workDirectory,{recursive:true,force:true})
    }
  }
}
