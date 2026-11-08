import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { downloadUrlsToLocalMedia, ebayImageFormats } from '../ebayLocalMediaFiles'

// imageDimensions 的 JPEG 分支只读 SOF0（FF C0）里的宽高，故这 17 字节即是一张「尺寸可被识别」的真图：
// [FFD8][FFC0][长度 000D][精度 08][高][宽][组件数 01][id/采样/量化][FFD9]
const jpeg=(width:number,height:number)=>{
  const buffer=Buffer.alloc(17)
  buffer.set([0xff,0xd8,0xff,0xc0,0x00,0x0d,0x08],0)
  buffer.writeUInt16BE(height,7)
  buffer.writeUInt16BE(width,9)
  buffer.set([0x01,0x11,0x00,0xff,0xd9],11)
  return buffer
}

const workspace=()=>fs.mkdtempSync(path.join(os.tmpdir(),'ebay-media-'))
const urlOf=(name:string)=>`https://cdn.example.com/ai-opt/${name}`
const hashOf=(url:string)=>createHash('sha256').update(url).digest('hex').slice(0,16)
const responseOf=(buffer:Buffer,mimeType='image/jpeg',status=200)=>new Response(new Uint8Array(buffer),{status,headers:{'content-type':mimeType}})
const okFetch=(buffer=jpeg(800,1200))=>vi.fn(async()=>responseOf(buffer))

describe('ebayLocalMediaFiles · downloadUrlsToLocalMedia', () => {
  it('AI 出图真落到本地目录并产出 DOWNLOADED 行（文件名按 URL 派生、目录段按 id 清洗）', async () => {
    const rootDir=workspace()
    const url=urlOf('a.jpg')
    const buffer=jpeg(800,1200)
    const fetchImpl=okFetch(buffer)
    const result=await downloadUrlsToLocalMedia([url],{storeId:'s 1',listingId:'L/1',rootDir,fetchImpl})
    expect(result.failures).toEqual([])
    expect(result.media).toHaveLength(1)
    const [media]=result.media
    expect(media.downloadStatus).toBe('DOWNLOADED')
    expect(media.remoteUrl).toBe(url)
    expect(media.mediaType).toBe('IMAGE')
    expect(media.sortOrder).toBe(0)
    expect(media.localPath).toBe(path.join(rootDir,'s-1','L-1','ai-opt',`${hashOf(url)}.jpg`))
    expect(fs.existsSync(media.localPath)).toBe(true)
    expect(fs.readFileSync(media.localPath)).toEqual(buffer)
    expect(media.mimeType).toBe('image/jpeg')
    expect(media.width).toBe(800)
    expect(media.height).toBe(1200)
    expect(media.fileSize).toBe(buffer.length)
    expect(media.sha256).toBe(createHash('sha256').update(buffer).digest('hex'))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('本地目录段与 main.ts 的 safeLocalSegment 同规则（连续非法字符并一段、首尾去把、空回落 unknown）', async () => {
    const rootDir=workspace()
    const result=await downloadUrlsToLocalMedia([urlOf('seg.jpg')],{storeId:'店 1/x',listingId:'',rootDir,fetchImpl:okFetch()})
    expect(path.dirname(result.media[0].localPath)).toBe(path.join(rootDir,'1-x','unknown','ai-opt'))
  })

  it('同 URL 再点一次读已有文件复用，不再发请求', async () => {
    const rootDir=workspace()
    const url=urlOf('reuse.jpg')
    const fetchImpl=okFetch()
    const first=await downloadUrlsToLocalMedia([url],{storeId:'s1',listingId:'L1',rootDir,fetchImpl})
    const second=await downloadUrlsToLocalMedia([url],{storeId:'s1',listingId:'L1',rootDir,fetchImpl})
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(second.media[0].downloadStatus).toBe('DOWNLOADED')
    expect(second.media[0].localPath).toBe(first.media[0].localPath)
    expect(second.media[0].mimeType).toBe('image/jpeg')
    expect(second.media[0].width).toBe(800)
    expect(second.media[0].height).toBe(1200)
    expect(second.media[0].fileSize).toBe(17)
    expect(second.media[0].sha256).toBe(first.media[0].sha256)
    expect(second.media[0].id).toBe(first.media[0].id)
  })

  it('旧文件是零字节时不算已下载，重新拉取覆盖', async () => {
    const rootDir=workspace()
    const url=urlOf('empty.jpg')
    const directory=path.join(rootDir,'s1','L1','ai-opt')
    fs.mkdirSync(directory,{recursive:true})
    fs.writeFileSync(path.join(directory,`${hashOf(url)}.jpg`),'')
    const fetchImpl=okFetch()
    const result=await downloadUrlsToLocalMedia([url],{storeId:'s1',listingId:'L1',rootDir,fetchImpl})
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.media[0].downloadStatus).toBe('DOWNLOADED')
    expect(result.media[0].fileSize).toBe(17)
  })

  it('单张网络失败只标 FAILED 并点名第几张，整批不抛', async () => {
    const rootDir=workspace()
    const bad=urlOf('bad.jpg')
    const fetchImpl=vi.fn(async(input:string)=>input===bad?Promise.reject(new Error('socket hang up')):responseOf(jpeg(800,1200)))
    const result=await downloadUrlsToLocalMedia([urlOf('good.jpg'),bad],{storeId:'s1',listingId:'L1',rootDir,fetchImpl:fetchImpl as unknown as typeof fetch})
    expect(result.media.map(item=>item.downloadStatus)).toEqual(['DOWNLOADED','FAILED'])
    expect(result.media[1].localPath).toBe('')
    expect(result.media[1].remoteUrl).toBe(bad)
    expect(result.media[1].width).toBe(0)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0].startsWith('第 2 张：')).toBe(true)
    expect(result.failures[0]).toContain('socket hang up')
  })

  it('HTTP 非 2xx 记为「HTTP <status>」，空 body 记为「图片内容为空」', async () => {
    const rootDir=workspace()
    const notFound=await downloadUrlsToLocalMedia([urlOf('404.jpg')],{storeId:'s1',listingId:'L1',rootDir,fetchImpl:vi.fn(async()=>new Response('nope',{status:404}))})
    expect(notFound.media[0].downloadStatus).toBe('FAILED')
    expect(notFound.failures).toEqual(['第 1 张：HTTP 404'])
    const blank=await downloadUrlsToLocalMedia([urlOf('blank.jpg')],{storeId:'s1',listingId:'L1',rootDir,fetchImpl:vi.fn(async()=>responseOf(Buffer.alloc(0)))})
    expect(blank.media[0].downloadStatus).toBe('FAILED')
    expect(blank.failures[0]).toContain('图片内容为空')
  })

  it('非图片 content-type 判 FAILED 且不落盘', async () => {
    const rootDir=workspace()
    const url=urlOf('page.html')
    const result=await downloadUrlsToLocalMedia([url],{storeId:'s1',listingId:'L1',rootDir,fetchImpl:vi.fn(async()=>responseOf(Buffer.from('<html>'), 'text/html'))})
    expect(result.media[0].downloadStatus).toBe('FAILED')
    expect(result.media[0].localPath).toBe('')
    expect(result.failures[0]).toContain('不支持的图片类型')
    const directory=path.join(rootDir,'s1','L1','ai-opt')
    expect(fs.existsSync(path.join(directory,`${hashOf(url)}.jpg`))).toBe(false)
    expect(fs.existsSync(directory)?fs.readdirSync(directory):[]).toEqual([])
  })

  it('识别不出尺寸判 FAILED，不落盘', async () => {
    const rootDir=workspace()
    const url=urlOf('nosize.jpg')
    const result=await downloadUrlsToLocalMedia([url],{storeId:'s1',listingId:'L1',rootDir,fetchImpl:okFetch(jpeg(0,0))})
    expect(result.media[0].downloadStatus).toBe('FAILED')
    expect(result.failures[0]).toContain('无法识别图片尺寸')
    const directory=path.join(rootDir,'s1','L1','ai-opt')
    expect(fs.existsSync(directory)?fs.readdirSync(directory):[]).toEqual([])
  })

  it('去重、去空、按输入顺序编号并截到 24 张', async () => {
    const rootDir=workspace()
    const fetchImpl=okFetch()
    const repeated=await downloadUrlsToLocalMedia([urlOf('dup.jpg'),urlOf('dup.jpg'),'',urlOf('other.jpg')],{storeId:'s1',listingId:'L1',rootDir,fetchImpl})
    expect(repeated.media.map(item=>item.remoteUrl)).toEqual([urlOf('dup.jpg'),urlOf('other.jpg')])
    expect(repeated.media.map(item=>item.sortOrder)).toEqual([0,1])
    expect(repeated.media.map(item=>item.id)).toEqual([`ai-opt-${hashOf(urlOf('dup.jpg'))}`,`ai-opt-${hashOf(urlOf('other.jpg'))}`])
    const overflowFetch=okFetch()
    const overflow=await downloadUrlsToLocalMedia(Array.from({length:30},(_,index)=>urlOf(`many-${index}.jpg`)),{storeId:'s1',listingId:'L1',rootDir,fetchImpl:overflowFetch})
    expect(overflow.media).toHaveLength(24)
    expect(overflow.media.map(item=>item.sortOrder)).toEqual(Array.from({length:24},(_,index)=>index))
    expect(overflowFetch).toHaveBeenCalledTimes(24)
  })

  it('并发下载但不超过 6 路', async () => {
    const rootDir=workspace()
    let active=0
    let peak=0
    const fetchImpl=vi.fn(async()=>{
      active+=1
      peak=Math.max(peak,active)
      await new Promise(resolve=>setTimeout(resolve,5))
      active-=1
      return responseOf(jpeg(800,1200))
    })
    const result=await downloadUrlsToLocalMedia(Array.from({length:12},(_,index)=>urlOf(`race-${index}.jpg`)),{storeId:'s1',listingId:'L1',rootDir,fetchImpl})
    expect(result.media).toHaveLength(12)
    expect(result.failures).toEqual([])
    expect(peak).toBeGreaterThan(1)
    expect(peak).toBeLessThanOrEqual(6)
  })

  it('超过 12MB 的单图判 FAILED，不落盘', async () => {
    const rootDir=workspace()
    const url=urlOf('huge.jpg')
    const huge=Buffer.concat([jpeg(800,1200),Buffer.alloc(12*1024*1024,0x7f)])
    const result=await downloadUrlsToLocalMedia([url],{storeId:'s1',listingId:'L1',rootDir,fetchImpl:okFetch(huge)})
    expect(result.media[0].downloadStatus).toBe('FAILED')
    expect(result.failures[0]).toContain('单张图片不能超过12MB')
    const directory=path.join(rootDir,'s1','L1','ai-opt')
    expect(fs.existsSync(path.join(directory,`${hashOf(url)}.jpg`))).toBe(false)
  })

  it('data: 内联图解码落盘、不发请求，第二次照样复用', async () => {
    const rootDir=workspace()
    const buffer=jpeg(800,1200)
    const dataUrl=`data:image/jpeg;base64,${buffer.toString('base64')}`
    const fetchImpl=okFetch()
    const first=await downloadUrlsToLocalMedia([dataUrl],{storeId:'s1',listingId:'L1',rootDir,fetchImpl})
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(first.media[0].downloadStatus).toBe('DOWNLOADED')
    expect(first.media[0].remoteUrl).toBe(dataUrl)
    expect(first.media[0].mimeType).toBe('image/jpeg')
    expect(fs.readFileSync(first.media[0].localPath)).toEqual(buffer)
    const second=await downloadUrlsToLocalMedia([dataUrl],{storeId:'s1',listingId:'L1',rootDir,fetchImpl})
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(second.media[0].localPath).toBe(first.media[0].localPath)
  })

  it('格式白名单与 main.ts 的 ebayImageFormats 逐键同表（本模块放行的类型必须能过主进程保存校验）', () => {
    const mainSource=fs.readFileSync(path.resolve(process.cwd(),'src/main/main.ts'),'utf8')
    const table=/const ebayImageFormats:Record<string,\{format:EbayImageFormat;extension:string\}>=\{([\s\S]*?)\n\}/.exec(mainSource)?.[1]??''
    const mainEntries=[...table.matchAll(/'([^']+)':\{format:'([a-z]+)',extension:'([a-z]+)'\}/g)].map(match=>`${match[1]}=${match[2]}/${match[3]}`)
    expect(mainEntries.length).toBeGreaterThan(8)
    expect(Object.entries(ebayImageFormats).map(([mimeType,entry])=>`${mimeType}=${entry.format}/${entry.extension}`).sort()).toEqual(mainEntries.sort())
  })
})
