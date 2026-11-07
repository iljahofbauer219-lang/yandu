/**
 * 视频工作室出片即转存的写回契约：attachVideoServerUrl 把服务器永久地址写进 project.json，
 * 渲染端的 <video src> 才拿得到 http://服务器 地址；本机文件仍是上传 eBay 的源，previewUrl 保留。
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { EbayVideoStudioProject } from '../../../shared/contracts'
import { ArkVideoService } from '../ArkVideoService'

const LISTING_ID = 'listing-attacht-01'
const PROJECT_ID = 'project-attacht-01'

let root: string | undefined

function projectFixture(videoFilePath: string): EbayVideoStudioProject {
  return {
    id: PROJECT_ID, listingId: LISTING_ID, version: 1, status: 'READY', model: 'doubao-seedance-1-0-pro',
    title: '测试商品', sourceImageCount: 3, subtitleMode: 'ENGLISH', voiceMode: 'NONE',
    additionalText: '', narrationText: '', taskIds: [], clipPaths: [],
    video: {
      status: 'READY', fileName: 'ebay-listing-attacht-01-video-v1.mp4', filePath: videoFilePath,
      previewUrl: 'cross-media://ebay/final/ebay-listing-attacht-01-video-v1.mp4',
      durationSeconds: 15, width: 1280, height: 720, imageCount: 3, sizeBytes: 1024,
      generatedAt: new Date('2026-11-07T00:00:00.000Z').toISOString(), message: '已保存到本系统'
    },
    createdAt: new Date('2026-11-07T00:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-11-07T00:00:00.000Z').toISOString()
  }
}

function createVersionDirectory(): { service: ArkVideoService; metadataPath: string; project: EbayVideoStudioProject } {
  root = mkdtempSync(path.join(tmpdir(), 'ark-video-attach-'))
  const versionDirectory = path.join(root, LISTING_ID, '001-project-attacht-01')
  const finalDirectory = path.join(versionDirectory, 'final')
  mkdirSync(finalDirectory, { recursive: true })
  const filePath = path.join(finalDirectory, 'ebay-listing-attacht-01-video-v1.mp4')
  writeFileSync(filePath, 'video-bytes', 'utf8')
  const project = projectFixture(filePath)
  const metadataPath = path.join(versionDirectory, 'project.json')
  writeFileSync(metadataPath, JSON.stringify(project, null, 2), 'utf8')
  return { service: new ArkVideoService('key', 'https://ark.test', 'doubao-seedance-1-0-pro', root), metadataPath, project }
}

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('ArkVideoService.attachVideoServerUrl', () => {
  it('写入 project.json 并返回带服务器地址的项目，本机 previewUrl 保留', () => {
    const { service, metadataPath, project } = createVersionDirectory()
    const serverUrl = 'http://114.55.149.192/ai-assets/abc123/01.mp4'

    const updated = service.attachVideoServerUrl(LISTING_ID, PROJECT_ID, serverUrl)

    expect(updated?.video?.serverUrl).toBe(serverUrl)
    expect(updated?.video?.previewUrl).toBe(project.video!.previewUrl)
    expect(JSON.parse(readFileSync(metadataPath, 'utf8')).video.serverUrl).toBe(serverUrl)
    expect(service.list(LISTING_ID)[0].video?.serverUrl).toBe(serverUrl)
  })

  it('转存后 updatedAt 前进，版本与状态不变', () => {
    const { service, project } = createVersionDirectory()
    const updated = service.attachVideoServerUrl(LISTING_ID, PROJECT_ID, 'http://114.55.149.192/ai-assets/abc/01.mp4')
    expect(Date.parse(updated!.updatedAt)).toBeGreaterThan(Date.parse(project.updatedAt))
    expect(updated!.version).toBe(project.version)
    expect(updated!.status).toBe('READY')
  })

  it('项目或视频文件不存在时返回 null，不抛错也不写盘', () => {
    const { service, metadataPath } = createVersionDirectory()
    const before = readFileSync(metadataPath, 'utf8')

    expect(service.attachVideoServerUrl(LISTING_ID, '另一个项目', 'http://114.55.149.192/ai-assets/abc/01.mp4')).toBeNull()
    expect(service.attachVideoServerUrl('不存在的货盘', PROJECT_ID, 'http://114.55.149.192/ai-assets/abc/01.mp4')).toBeNull()
    expect(readFileSync(metadataPath, 'utf8')).toBe(before)
  })
})
