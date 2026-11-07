// 实机验收「出图即转存 / 出片即转存」：直连正在运行的桌面应用（CDP），走真实生成链路，
// 断言渲染器拿到的地址已是指向自有服务器 /ai-assets/ 的永久地址，并核对画面里的实际字节来源。
// 用法：node tools/verify-ai-asset-live.cjs [--skip-video] [--timeout-ms 1500000]
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(path.resolve(__dirname, '../server/node_modules/playwright-core'))

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'artifacts/ai-asset-live')
const CDP = process.env.CDP_URL || 'http://127.0.0.1:9222'
const SERVER = 'http://114.55.149.192'
const REFERENCE_IMAGES = [1, 2, 3, 4].map(index => `${SERVER}/product-pages/VvvHDTiUXSyXlHDm/assets/${String(index).padStart(2, '0')}.jpg`)
const skipVideo = process.argv.includes('--skip-video')
// --single-ref：出片只用 1 张参照图。方舟多图文生视频要求 image content 带 role（见 ArkVideoService.createTask），
// 单图是当前已验证可通过的参数形状，用于隔离「出片即转存」与方舟多图参数缺陷。
const singleRef = process.argv.includes('--single-ref')
const timeoutIndex = process.argv.indexOf('--timeout-ms')
const VIDEO_TIMEOUT_MS = timeoutIndex > -1 ? Number(process.argv[timeoutIndex + 1]) : 1_500_000

const report = {
  startedAt: new Date().toISOString(),
  mode: `实机直连正在运行的桌面应用（CDP 9222，真实 userData / 真实登录会话 / 真实服务商出图）${singleRef ? ' · 出片单参照图（--single-ref）' : ' · 出片多参照图'}`,
  server: SERVER,
  session: null,
  image: null,
  video: null,
  network: [],
  verdict: [],
  screenshots: []
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
function check(name, ok, detail) {
  report.verdict.push({ name, ok: Boolean(ok), detail: detail === undefined ? undefined : detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` :: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

async function pollWindow(page, globalName, deadlineMs, label) {
  const started = Date.now()
  let lastLog = 0
  for (;;) {
    const state = await page.evaluate(name => window[name] ?? null, globalName)
    if (state && (state.state === 'done' || state.state === 'error')) return state
    if (Date.now() - started > deadlineMs) throw new Error(`${label} 超时（${Math.round(deadlineMs / 1000)}秒）`)
    if (Date.now() - lastLog > 20_000) {
      lastLog = Date.now()
      const progress = state && state.progress ? state.progress : null
      console.log(`  …${label} 进行中 ${Math.round((Date.now() - started) / 1000)}s ${progress ? JSON.stringify(progress) : ''}`)
    }
    await sleep(2_000)
  }
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.connectOverCDP(CDP)
  const context = browser.contexts()[0]
  const page = context.pages().find(item => /renderer\/index\.html/.test(item.url()))
  if (!page) throw new Error('未找到应用渲染器页面（应用是否在跑？）')

  page.on('response', async response => {
    try {
      const url = new URL(response.url())
      if (!/\/ai-assets\//.test(url.pathname)) return
      const headers = response.headers()
      report.network.push({
        at: new Date().toISOString(),
        url: response.url(),
        status: response.status(),
        contentType: headers['content-type'] || null,
        contentLength: headers['content-length'] || null,
        cacheControl: headers['cache-control'] || null,
        server: headers['server'] || null,
        securityHeaders: {
          'content-security-policy': headers['content-security-policy'] || null,
          'x-content-type-options': headers['x-content-type-options'] || null
        }
      })
    } catch { /* 非 HTTP 目标忽略 */ }
  })

  // 0) 会话：本机应用自己的刷新令牌换新访问令牌（旋转只发生在用户自己的实例内）
  report.session = await page.evaluate(async () => {
    const stored = key => localStorage.getItem(key)
    const tokens = JSON.parse(stored('sourcing.auth.tokens:v1') || 'null')
    const decode = token => JSON.parse(atob(token.split('.')[1]))
    const before = decode(tokens.accessToken)
    const base = (stored('sourcing.server-url:v1') || '').replace(/\/+$/, '')
    let refreshed = false
    if (before.exp * 1000 - Date.now() < 60 * 60 * 1000) {
      const response = await fetch(`${base}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken })
      })
      if (!response.ok) throw new Error(`会话刷新失败 HTTP ${response.status}`)
      const payload = await response.json()
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify(payload.tokens))
      refreshed = true
    }
    const after = decode(JSON.parse(localStorage.getItem('sourcing.auth.tokens:v1')).accessToken)
    return {
      serverUrl: base,
      refreshed,
      account: JSON.parse(stored('sourcing.auth.profile:v1') || 'null')?.email,
      org: JSON.parse(stored('sourcing.auth.profile:v1') || 'null')?.org?.name,
      accessTokenExpiresAt: new Date(after.exp * 1000).toISOString(),
      profilePermissions: (() => { const p = JSON.parse(stored('sourcing.auth.profile:v1') || 'null'); return p ? (p.permissions === 'ALL' ? 'ALL' : p.permissions) : null })()
    }
  })
  check('实机会话可用（访问令牌在有效期内）', new Date(report.session.accessTokenExpiresAt).getTime() > Date.now(), report.session)

  // 1) 出图：真实服务商出图 → 主进程当刻转存 → 渲染器只应看到 /ai-assets/ 永久地址
  await page.evaluate(ref => {
    window.__imageRun = { state: 'running' }
    void (async () => {
      try {
        const accessToken = JSON.parse(localStorage.getItem('sourcing.auth.tokens:v1')).accessToken
        const models = await window.desktop.image.models()
        const chosen = models.models.find(model => model.id === 'wan2.7-image')
          || models.models.find(model => model.id === 'wan2.7-image-pro')
          || models.models.find(model => model.maxReferenceImages > 0)
        if (!chosen) throw new Error('没有可用的生图模型（服务商未连通）')
        const prompt = '电商商品主图：保持参照图中商品的真实结构、材质与颜色，纯净浅灰背景，均匀柔光，无文字、无水印、无边框，1:1 构图，商品居中占画面约八成。'
        const result = await window.desktop.image.generate(
          { model: chosen.id, prompt, referenceImageUrl: ref[0], referenceImageUrls: [ref[0]], size: '1K', count: 1 },
          accessToken
        )
        window.__imageRun = { state: 'done', modelId: chosen.id, modelName: chosen.name, modelCount: models.models.length, result }
      } catch (error) {
        window.__imageRun = { state: 'error', message: String(error && error.message || error) }
      }
    })()
  }, REFERENCE_IMAGES)
  const imageRun = await pollWindow(page, '__imageRun', 300_000, '出图')
  if (imageRun.state === 'error') check('出图成功', false, imageRun.message)
  else {
    report.image = { ...imageRun, result: undefined, urls: imageRun.result.imageUrls, notice: imageRun.result.notice || null, providerTaskId: imageRun.result.taskId || null }
    check('出图成功并返回地址', (imageRun.result.imageUrls || []).length > 0, { model: imageRun.modelId, urls: imageRun.result.imageUrls, notice: report.image.notice })
    const permanent = (imageRun.result.imageUrls || []).every(url => url.startsWith(`${SERVER}/ai-assets/`))
    check('出图当刻已转存：地址全部指向自有服务器 /ai-assets/', permanent, imageRun.result.imageUrls)
    check('转存无中文告警', !report.image.notice, report.image.notice || '无')

    // 画面证据：把返回地址真放进 <img>，读 naturalWidth 与实际字节
    const imgEvidence = await page.evaluate(async url => {
      document.title = 'ai-asset-live'
      let host = document.getElementById('yandu-ai-asset-probe')
      if (host) host.remove()
      host = document.createElement('div')
      host.id = 'yandu-ai-asset-probe'
      host.setAttribute('style', 'position:fixed;inset:0;z-index:999999;background:#fff;padding:24px;box-sizing:border-box;font:14px/1.5 -apple-system,sans-serif')
      const caption = document.createElement('div')
      caption.textContent = `实机取证 · AI 出图当刻转存自有服务器 · ${url}`
      caption.setAttribute('style', 'margin-bottom:12px;color:#1d1d1f')
      const img = document.createElement('img')
      img.setAttribute('style', 'max-width:520px;max-height:70vh;border:1px solid #d2d2d7')
      img.src = url
      host.appendChild(caption)
      host.appendChild(img)
      document.body.appendChild(host)
      const loaded = await new Promise(resolve => {
        img.onload = () => resolve('loaded')
        img.onerror = () => resolve('error')
        setTimeout(() => resolve('timeout'), 30_000)
      })
      const entry = performance.getEntriesByType('resource').filter(item => item.name === url).pop()
      return {
        load: loaded,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        currentSrc: img.currentSrc,
        rendered: img.getBoundingClientRect(),
        resource: entry ? {
          responseStatus: entry.responseStatus ?? null,
          contentType: entry.contentType || null,
          encodedBodySize: entry.encodedBodySize,
          transferSize: entry.transferSize,
          duration: Math.round(entry.duration)
        } : null
      }
    }, imageRun.result.imageUrls[0])
    report.image.dom = imgEvidence
    check('渲染器 <img> 实际出图（无破图）', imgEvidence.load === 'loaded' && imgEvidence.naturalWidth > 0, imgEvidence)
    await page.screenshot({ path: path.join(OUT, '01-出图即转存.png') })
    report.screenshots.push(path.join(OUT, '01-出图即转存.png'))
  }

  // 2) 出片：方舟 15 秒视频 → 本机合成 → 出片当刻转存 → video.serverUrl
  if (!skipVideo) {
    await page.evaluate(refs => {
      window.__videoRun = { state: 'running' }
      void (async () => {
        try {
          const accessToken = JSON.parse(localStorage.getItem('sourcing.auth.tokens:v1')).accessToken
          window.__videoRun.step = '方舟能力在线检测'
          let config = await window.desktop.ebay.checkVideoStudioCapabilities()
          const modelId = config.model
          let capability = config.videoModels.find(item => item.id === modelId)
          if (capability && capability.status !== 'CALLABLE') {
            window.__videoRun.step = `视频模型真实生成验证 ${modelId}`
            config = await window.desktop.ebay.verifyVideoStudioCapability({ id: modelId, kind: 'VIDEO', imageUrl: refs[0] })
            capability = config.videoModels.find(item => item.id === modelId)
          }
          window.__videoRun.config = { connected: config.connected, model: config.model, checkMessage: config.checkMessage }
          window.__videoRun.capability = capability
          const callableText = config.textModels.filter(item => item.configured).find(item => item.status === 'CALLABLE')
          let textCapability = callableText
          if (!textCapability) {
            const candidate = config.textModels.find(item => item.configured)
            if (!candidate) throw new Error('没有已配置的字幕与文案模型，无法出片')
            window.__videoRun.step = `文案模型真实推理验证 ${candidate.id}`
            config = await window.desktop.ebay.verifyVideoStudioCapability({ id: candidate.id, kind: 'TEXT' })
            textCapability = config.textModels.find(item => item.id === candidate.id)
          }
          if (!textCapability || textCapability.status !== 'CALLABLE') {
            throw new Error(`文案模型 ${textCapability ? `${textCapability.id}（${textCapability.message}）` : '未列出'} 未通过真实推理验证`)
          }
          window.__videoRun.textCapability = textCapability
          const request = {
            listingId: 'AI-ASSET-LIVE-VERIFY',
            videoModelId: modelId,
            textModelId: textCapability.id,
            title: 'Foldable Phone Stand Aluminium Desk Holder',
            description: 'Adjustable aluminium alloy phone and tablet stand, foldable, non-slip, works with 4-13 inch devices.',
            chineseDescription: '可折叠铝合金手机平板支架，角度可调，防滑垫，适配 4-13 英寸设备。',
            imageUrls: refs,
            additionalImageUrls: [],
            additionalText: '只使用参照图中的铝合金支架本体，不虚构包装与配件。',
            subtitleMode: 'ENGLISH',
            voiceMode: 'NONE',
            voiceStyle: 'NATURAL_FEMALE',
            voiceSpeed: 1,
            narrationText: '',
            storyboard: []
          }
          window.__videoRun.step = '15 秒视频生成'
          const stop = window.desktop.ebay.onVideoStudioProgress(progress => { window.__videoRun.progress = progress })
          const project = await window.desktop.ebay.generateVideoStudio(request, accessToken)
          stop()
          window.__videoRun = { state: 'done', project, listingId: request.listingId, config: window.__videoRun.config, capability: window.__videoRun.capability, textCapability: window.__videoRun.textCapability }
        } catch (error) {
          window.__videoRun = { state: 'error', message: String(error && error.message || error), step: window.__videoRun.step }
        }
      })()
    }, singleRef ? [imageRun.result.imageUrls[0]] : [imageRun.result.imageUrls[0], ...REFERENCE_IMAGES.slice(1)])
    const videoRun = await pollWindow(page, '__videoRun', VIDEO_TIMEOUT_MS, '出片')
    if (videoRun.state === 'error') check('出片成功', false, { step: videoRun.step, message: videoRun.message })
    else {
      const video = videoRun.project.video || null
      report.video = {
        capability: videoRun.capability,
        textCapability: videoRun.textCapability,
        studio: videoRun.config,
        projectId: videoRun.project.id,
        status: videoRun.project.status,
        model: videoRun.project.model,
        textModelId: videoRun.project.textModelId,
        sourceImageCount: videoRun.project.sourceImageCount,
        clipCount: (videoRun.project.clipPaths || []).length,
        video: video && {
          fileName: video.fileName,
          durationSeconds: video.durationSeconds,
          width: video.width,
          height: video.height,
          filePath: video.filePath,
          serverUrl: video.serverUrl || null,
          providerUrl: video.videoUrl || null,
          message: video.message || null
        }
      }
      check('15 秒视频出片完成', video && video.status === 'READY', { status: videoRun.project.status, message: video && video.message })
      check('出片当刻已转存：video.serverUrl 指向自有服务器 /ai-assets/',
        Boolean(video && video.serverUrl) && String(video.serverUrl).startsWith(`${SERVER}/ai-assets/`),
        video && video.serverUrl)
      if (video && video.serverUrl) {
        const videoEvidence = await page.evaluate(async url => {
          let host = document.getElementById('yandu-ai-asset-probe')
          if (host) host.remove()
          host = document.createElement('div')
          host.id = 'yandu-ai-asset-probe'
          host.setAttribute('style', 'position:fixed;inset:0;z-index:999999;background:#1d1d1f;padding:24px;box-sizing:border-box;font:14px/1.5 -apple-system,sans-serif;color:#f5f5f7')
          const caption = document.createElement('div')
          caption.textContent = `实机取证 · AI 出片当刻转存自有服务器 · ${url}`
          host.appendChild(caption)
          const el = document.createElement('video')
          el.src = url
          el.muted = true
          el.controls = true
          el.preload = 'auto'
          el.setAttribute('style', 'width:min(760px,90%);margin-top:12px;background:#000')
          host.appendChild(el)
          document.body.appendChild(host)
          const ready = await new Promise(resolve => {
            el.onloadeddata = () => resolve('loadeddata')
            el.onerror = () => resolve('error')
            setTimeout(() => resolve('timeout'), 40_000)
          })
          try { el.currentTime = 1.5; await new Promise(resolve => { el.onseeked = resolve; setTimeout(resolve, 8_000) }); await el.play(); await new Promise(resolve => setTimeout(resolve, 600)); el.pause() } catch { /* 预览失败不影响地址取证 */ }
          const entry = performance.getEntriesByType('resource').filter(item => item.name === url).pop()
          return {
            ready,
            videoWidth: el.videoWidth,
            videoHeight: el.videoHeight,
            durationSeconds: Number.isFinite(el.duration) ? Math.round(el.duration * 10) / 10 : null,
            playedSeconds: Math.round(el.currentTime * 10) / 10,
            currentSrc: el.currentSrc,
            resource: entry ? { responseStatus: entry.responseStatus ?? null, encodedBodySize: entry.encodedBodySize, transferSize: entry.transferSize } : null
          }
        }, video.serverUrl)
        report.video.dom = videoEvidence
        check('渲染器 <video> 实际可播（无破图）', videoEvidence.ready === 'loadeddata' && videoEvidence.videoWidth > 0, videoEvidence)
        await page.screenshot({ path: path.join(OUT, '02-出片即转存.png') })
        report.screenshots.push(path.join(OUT, '02-出片即转存.png'))
      }
    }
  }

  // 3) 清理取证浮层
  await page.evaluate(() => { const host = document.getElementById('yandu-ai-asset-probe'); if (host) host.remove() })

  report.finishedAt = new Date().toISOString()
  report.aiAssetRequests = report.network
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  const failed = report.verdict.filter(row => !row.ok)
  console.log(`\n报告：${path.join(OUT, 'report.json')}`)
  console.log(`结论：${failed.length ? `${failed.length} 项未通过` : '全部通过'}`)
  await browser.close()
  process.exit(failed.length ? 1 : 0)
})().catch(error => {
  console.error('VERIFY_FAILED', error && error.message || error)
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ ...report, error: String(error && error.stack || error) }, null, 2), 'utf8')
  process.exit(1)
})
