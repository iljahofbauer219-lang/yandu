/**
 * 优选产品卡片 vs 采集候选卡片 视觉 parity 验收（真实 Electron + Playwright）。
 * fixture 复用 fixture-seed-preferred-exclusion.cjs（3 候选 + 1 优选）。
 * 断言两 Tab 卡片度量一致：网格列轨 280/gap 14、卡宽 280、图区 280、body padding 13、
 * 标题 13px/21px 两行不裁切、价格 19px、标签 10px、按钮 38px、卡片整体不裁切。
 *
 * 运行：先 vite build + tsc -p tsconfig.main.json，再 node tools/verify-selection-card-parity.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const { spawnSync } = require('node:child_process')

const ARTIFACTS = path.resolve(__dirname, '../artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const ownerProfile = {
  id: 'sp-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'sp-org', name: '卡片parity验收组织' }, roles: [], permissions: 'ALL', stores: null
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

// 在渲染进程内读取卡片度量（selection / candidate 两套选择器）
const MEASURE_FN = (kind) => {
  const sel = kind === 'selection'
    ? { grid: '.selection-grid', card: '.selection-card', img: '.selection-image', body: '.selection-card-body', tag: '.selection-tags span', btn: '.selection-decisions button' }
    : { grid: '.product-grid', card: '.product-grid .candidate-product-card', img: '.product-image', body: '.product-info', tag: '.product-tags span', btn: '.product-actions button' }
  const grid = document.querySelector(sel.grid)
  const card = document.querySelector(sel.card)
  if (!grid || !card) return null
  const img = card.querySelector(sel.img)
  const body = card.querySelector(sel.body)
  const title = body.querySelector('b')
  const price = body.querySelector('strong')
  const tag = card.querySelector(sel.tag)
  const btn = card.querySelector(sel.btn)
  const cs = getComputedStyle(grid)
  const cardRect = card.getBoundingClientRect()
  const btnRect = btn ? btn.getBoundingClientRect() : null
  return {
    track: cs.gridTemplateColumns.split(' ')[0],
    gap: cs.columnGap,
    cardWidth: Math.round(cardRect.width),
    imgHeight: Math.round(img.getBoundingClientRect().height),
    bodyPadding: getComputedStyle(body).paddingTop,
    titleSize: getComputedStyle(title).fontSize,
    titleLineHeight: getComputedStyle(title).lineHeight,
    titleBoxHeight: title.clientHeight,
    priceSize: getComputedStyle(price).fontSize,
    tagSize: tag ? getComputedStyle(tag).fontSize : null,
    btnHeight: btn ? getComputedStyle(btn).height : null,
    cardClipped: card.scrollHeight > card.clientHeight + 1,
    actionsInside: btnRect ? btnRect.bottom <= cardRect.bottom + 1 : false
  }
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'selection-parity-'))
  const dbPath = path.join(userDataDir, 'sourcing-data.sqlite')

  const seed = spawnSync(executablePath, [path.resolve(__dirname, 'fixture-seed-preferred-exclusion.cjs'), dbPath, 'extra'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8'
  })
  if (seed.status !== 0) {
    console.error('fixture 种子失败：', seed.stdout, seed.stderr)
    process.exit(1)
  }

  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: path.resolve(__dirname, '..'), env: { ...process.env, CODEX_UI_TEST: '1' } })
  let failures = 0
  const assert = (name, cond) => { if (cond) console.log(`  ✔ ${name}`); else { failures += 1; console.error(`  ✘ ${name}`) } }
  try {
    const pageErrors = []
    const page = await app.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    await page.route('**/api/**', async route => {
      const p = new URL(route.request().url()).pathname
      if (p === '/api/auth/me') return route.fulfill(json(ownerProfile))
      return route.continue()
    })
    await page.evaluate(({ profile }) => {
      localStorage.setItem('sourcing.server-url:v1', 'https://selection-parity-mock.invalid')
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'sp-owner', refreshToken: 'sp-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile })
    await page.reload()
    await page.waitForTimeout(1200)

    const flowNav = page.locator('.selection-module-nav.warehouse-flow-nav')
    await page.locator('.sidebar').getByRole('button', { name: '货盘采集', exact: true }).click()
    await page.waitForSelector('.ai-collect-grid', { timeout: 8000 })
    await page.locator('.ai-collect-card', { hasText: '大健云仓' }).click()
    await page.waitForTimeout(800)

    // ── 优选产品 Tab 度量 ──
    console.log('优选产品卡片度量')
    await flowNav.getByRole('button', { name: /优选产品/ }).click()
    await page.waitForSelector('.selection-workbench .selection-card', { timeout: 8000 })
    await page.waitForTimeout(500)
    const selectionMetrics = await page.evaluate(MEASURE_FN, 'selection')
    await page.screenshot({ path: path.join(ARTIFACTS, 'selection-parity-01-selection.png') })

    // ── 采集候选 Tab 度量 ──
    console.log('采集候选卡片度量')
    await flowNav.getByRole('button', { name: '采集侯选' }).click()
    await page.waitForSelector('.candidate-catalog-main .candidate-product-card', { timeout: 8000 })
    await page.waitForTimeout(500)
    const candidateMetrics = await page.evaluate(MEASURE_FN, 'candidate')
    await page.screenshot({ path: path.join(ARTIFACTS, 'selection-parity-02-candidates.png') })

    if (!selectionMetrics || !candidateMetrics) throw new Error('度量读取失败：卡片未渲染')
    console.log('  selection =', JSON.stringify(selectionMetrics))
    console.log('  candidate =', JSON.stringify(candidateMetrics))

    console.log('parity 断言')
    for (const [key, label] of [['track', '网格列轨'], ['gap', '网格间距'], ['cardWidth', '卡片宽度'], ['imgHeight', '图片区高度'], ['bodyPadding', 'body 内边距'], ['titleSize', '标题字号'], ['titleLineHeight', '标题行高'], ['priceSize', '价格字号'], ['tagSize', '标签字号'], ['btnHeight', '按钮高度']]) {
      assert(`${label}两 Tab 一致（${selectionMetrics[key]}）`, selectionMetrics[key] === candidateMetrics[key])
    }
    assert('列轨为 280px', selectionMetrics.track === '280px' && candidateMetrics.track === '280px')
    assert('间距为 14px', selectionMetrics.gap === '14px' && candidateMetrics.gap === '14px')
    assert('卡宽 280', selectionMetrics.cardWidth === 280 && candidateMetrics.cardWidth === 280)
    assert('图片区 280', selectionMetrics.imgHeight === 280 && candidateMetrics.imgHeight === 280)
    assert('body 上内边距与候选基线一致（12px）', selectionMetrics.bodyPadding === '12px' && candidateMetrics.bodyPadding === '12px')
    assert('标题 13px/21px', selectionMetrics.titleSize === '13px' && selectionMetrics.titleLineHeight === '21px')
    assert('标题两行盒高 42 不裁切', selectionMetrics.titleBoxHeight === 42 && candidateMetrics.titleBoxHeight === 42)
    assert('价格 19px', selectionMetrics.priceSize === '19px' && candidateMetrics.priceSize === '19px')
    assert('标签 10px', selectionMetrics.tagSize === '10px' && candidateMetrics.tagSize === '10px')
    assert('按钮 38px', selectionMetrics.btnHeight === '38px' && candidateMetrics.btnHeight === '38px')
    assert('优选卡片整体不裁切且按钮可见', selectionMetrics.cardClipped === false && selectionMetrics.actionsInside === true)
    assert('候选卡片整体不裁切且按钮可见', candidateMetrics.cardClipped === false && candidateMetrics.actionsInside === true)
    assert('渲染进程无未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error(pageErrors.join('\n'))

    // ── 多视口重叠/裁切审计（两 Tab 全部卡片） ──
    console.log('多视口重叠/裁切审计')
    const AUDIT_FN = (kind) => {
      const sel = kind === 'selection'
        ? { card: '.selection-card', btn: '.selection-decisions button', tags: '.selection-tags' }
        : { card: '.product-grid .candidate-product-card', btn: '.product-actions button', tags: '.product-tags' }
      const cards = [...document.querySelectorAll(sel.card)]
      const rects = cards.map(c => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } })
      let overlap = false
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j]
        if (a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1) overlap = true
      }
      return {
        count: cards.length,
        overlap,
        anyClipped: cards.some(c => c.scrollHeight > c.clientHeight + 1),
        anyBtnOutside: cards.some(c => { const b = c.querySelector(sel.btn); if (!b) return false; return b.getBoundingClientRect().bottom > c.getBoundingClientRect().bottom + 1 }),
        anyTagsOverflow: cards.some(c => { const t = c.querySelector(sel.tags); return t ? t.scrollWidth > t.clientWidth + 1 : false }),
        diag: cards.slice(0, 1).map(c => { const b = c.querySelector(kind === 'selection' ? '.selection-card-body' : '.product-info'); const i = c.querySelector(kind === 'selection' ? '.selection-image' : '.product-image'); return { cardClient: c.clientHeight, cardScroll: c.scrollHeight, bodyClient: b ? b.clientHeight : -1, bodyScroll: b ? b.scrollHeight : -1, imgClient: i ? i.clientHeight : -1 } })
      }
    }
    for (const vp of [{ width: 1600, height: 900 }, { width: 1200, height: 800 }, { width: 900, height: 900 }]) {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.waitForTimeout(400)
      await flowNav.getByRole('button', { name: /优选产品/ }).click()
      await page.waitForTimeout(400)
      const sAudit = await page.evaluate(AUDIT_FN, 'selection')
      await flowNav.getByRole('button', { name: '采集侯选' }).click()
      await page.waitForTimeout(400)
      const cAudit = await page.evaluate(AUDIT_FN, 'candidate')
      console.log(`  audit selection@${vp.width} =`, JSON.stringify(sAudit), ` candidate@${vp.width} =`, JSON.stringify(cAudit))
      assert(`优选产品@${vp.width} 三卡无重叠/无裁切/按钮可见/标签不溢出`, sAudit.count === 3 && !sAudit.overlap && !sAudit.anyClipped && !sAudit.anyBtnOutside && !sAudit.anyTagsOverflow)
      assert(`采集候选@${vp.width} 三卡无重叠/无裁切/按钮可见/标签不溢出`, cAudit.count === 3 && !cAudit.overlap && !cAudit.anyClipped && !cAudit.anyBtnOutside && !cAudit.anyTagsOverflow)
      if (vp.width === 900) await page.screenshot({ path: path.join(ARTIFACTS, 'selection-parity-03-narrow.png') })
    }
    await page.setViewportSize({ width: 1280, height: 900 })
  } finally {
    await app.close()
  }
  console.log(failures === 0 ? 'VERIFY_OK 全部断言通过' : `VERIFY_FAILED ${failures} 项断言失败`)
  process.exit(failures === 0 ? 0 : 1)
})()
