const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/identity-editor-visibility')
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-identity-visibility-'))
const packagedExecutable = process.env.PACKAGED_EXECUTABLE || ''
const executablePath = packagedExecutable || path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
const checks = []
const assert = (id, passed, detail) => {
  checks.push({ id, passed: Boolean(passed), detail })
  if (!passed) throw new Error(`${id}: ${detail}`)
}

fs.mkdirSync(outputDir, { recursive: true })

const profile = {
  id: 'identity-visibility', email: 'identity-visibility@example.test', name: '身份表单可见性验收',
  isOwner: true, status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'identity-visibility-org', name: '可见性验收组织' }, roles: [], permissions: 'ALL', stores: null
}

const svg = index => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180"><rect width="240" height="180" fill="#f5d6e8"/><text x="20" y="95" font-size="24">商品图 ${index}</text></svg>`)}`
const images = Array.from({ length: 5 }, (_, index) => svg(index + 1))
const detailParagraph = '品牌 其他 功效 身体除臭 容量 小于200ml 产地 广东 规格30ml一袋 主要下游平台 Amazon。商品为袋装液体免洗擦浴精华，挤出液体后擦拭猫狗身体，无需水洗。'
const ocrParagraph = 'PET WASH FREE SCRUB ESSENCE 30ml White peach flavor cat Romantic Tea Aroma dog 长效留香 抑菌除螨。'
const extractedInfo = {
  url: 'https://detail.1688.com/offer/1006746849261.html', analysisDate: '2026-08-11',
  title: '跨境猫狗通用宠物免洗擦拭精华清洁套装宠物免水洗除臭留香定制',
  price: '¥2.50', seller: '广州宠本生物科技有限公司', moq: '', shipFrom: '', deals: '',
  images,
  imageEvidence: images.map((url, index) => ({ url, role: index === 0 ? '主图' : '详情图', source: index === 0 ? '商品主图区域' : '商品详情区域' })),
  detailText: Array.from({ length: 14 }, () => detailParagraph).join(' '), detailSource: '详情模块DOM',
  imageOcrText: Array.from({ length: 10 }, () => ocrParagraph).join(' '),
  imageOcrWarnings: ['不同参考图存在字段冲突：otherText，必须人工选择正确规格'],
  visualProductForm: '液体精华', visualUseMethod: '免洗擦浴', visualTargetObject: '猫狗', visualConfidence: 95,
  attributes: Array.from({ length: 18 }, (_, index) => `属性${index + 1}：验收长内容`)
}

;(async () => {
  const app = await electron.launch({
    executablePath,
    args: packagedExecutable ? [`--user-data-dir=${userDataDir}`] : ['.', `--user-data-dir=${userDataDir}`],
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) }))
    await page.setViewportSize({ width: 1100, height: 720 })
    await page.evaluate(({ value, info }) => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'identity-visibility', refreshToken: 'identity-visibility', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(value))
      localStorage.setItem('yd.aiEmployee.extractedByConversation:v1', JSON.stringify({
        __draft__: { info, collapsed: false, confirmed: false, updatedAt: new Date().toISOString() }
      }))
    }, { value: profile, info: extractedInfo })
    await page.reload()
    await page.waitForTimeout(700)
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.locator('.ai-crossborder-card.clickable').filter({ hasText: '选品分析师' }).click()

    const extracted = page.locator('.ai-employee-extracted')
    await extracted.getByText('需人工核对', { exact: true }).waitFor()
    await extracted.getByRole('button', { name: '确认并锁定' }).click()
    const editor = extracted.locator('.ai-employee-identity-editor')
    const saveButton = editor.getByRole('button', { name: '保存并锁定身份' })
    await editor.waitFor()
    await saveButton.waitFor()

    const openedLayout = await page.evaluate(() => {
      const card = document.querySelector('.ai-employee-extracted')
      const composer = document.querySelector('.ai-employee-floating-composer')
      const editor = document.querySelector('.ai-employee-identity-editor')
      const save = [...document.querySelectorAll('.ai-employee-identity-editor button')].find(node => node.textContent?.includes('保存并锁定身份'))
      const details = document.querySelector('.ai-employee-extracted dl')
      const rect = node => node?.getBoundingClientRect()
      const cardStyle = card ? getComputedStyle(card) : null
      const composerStyle = composer ? getComputedStyle(composer) : null
      return {
        viewport: { width: innerWidth, height: innerHeight },
        card: rect(card), composer: rect(composer), editor: rect(editor), save: rect(save), details: rect(details),
        cardScrollHeight: card?.scrollHeight || 0, cardClientHeight: card?.clientHeight || 0,
        cardOverflowY: cardStyle?.overflowY || '', composerOverflowY: composerStyle?.overflowY || ''
      }
    })
    assert('long-card-is-independently-scrollable', openedLayout.cardScrollHeight > openedLayout.cardClientHeight && openedLayout.cardOverflowY === 'auto', JSON.stringify(openedLayout))
    assert('identity-editor-precedes-long-details', openedLayout.editor?.top < openedLayout.details?.top, JSON.stringify(openedLayout))
    assert('save-button-visible-in-card', openedLayout.save?.bottom <= openedLayout.card?.bottom && openedLayout.save?.bottom <= openedLayout.viewport.height, JSON.stringify(openedLayout))
    assert('composer-stays-inside-viewport', openedLayout.composer?.top >= 0 && openedLayout.composer?.bottom <= openedLayout.viewport.height, JSON.stringify(openedLayout))
    assert('composer-has-overflow-fallback', openedLayout.composerOverflowY === 'auto', JSON.stringify(openedLayout))
    await page.screenshot({ path: path.join(outputDir, '01-editor-fully-visible.png') })

    await editor.getByRole('textbox', { name: '人工确认产品名称' }).fill('宠物免洗擦浴精华')
    await editor.getByRole('combobox', { name: '人工确认产品形态' }).selectOption({ label: '液体精华' })
    await editor.getByRole('textbox', { name: '人工确认使用方式' }).fill('挤出液体后免洗擦浴')
    await editor.getByRole('textbox', { name: '人工确认适用对象' }).fill('猫狗')
    await editor.getByRole('textbox', { name: '人工确认裁决说明' }).fill('以包装出液口、详情文字和实物形态为准')
    await saveButton.click()
    await extracted.getByText('已确认锁定', { exact: true }).waitFor()

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('yd.aiEmployee.extractedByConversation:v1') || '{}').__draft__)
    assert('manual-identity-click-succeeds', stored?.confirmed === true && stored?.info?.confirmedProductForm === '液体精华', JSON.stringify(stored))
    await extracted.evaluate(node => { node.scrollTop = node.scrollHeight })
    const stickyHeader = await page.evaluate(() => {
      const card = document.querySelector('.ai-employee-extracted')
      const header = card?.querySelector('header')
      const cardRect = card?.getBoundingClientRect()
      const headerRect = header?.getBoundingClientRect()
      return { cardTop: cardRect?.top, headerTop: headerRect?.top, delta: (headerRect?.top || 0) - (cardRect?.top || 0) }
    })
    assert('card-header-remains-sticky', Math.abs(stickyHeader.delta) <= 2, JSON.stringify(stickyHeader))
    await page.screenshot({ path: path.join(outputDir, '02-locked-and-scrollable.png') })

    const expectedAssets = fs.readFileSync(path.join(root, 'dist/renderer/index.html'), 'utf8').match(/(?:src|href)="([^"]+\.(?:js|css))"/g)?.map(value => value.match(/"([^"]+)"/)?.[1]).filter(Boolean) || []
    const loadedAssets = await page.evaluate(() => [...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(element => element.getAttribute('src') || element.getAttribute('href')).filter(Boolean))
    assert('latest-production-assets-loaded', expectedAssets.length === 2 && expectedAssets.every(asset => loadedAssets.includes(asset)), `expected=${expectedAssets.join(',')} loaded=${loadedAssets.join(',')}`)

    const report = { generatedAt: new Date().toISOString(), checks, openedLayout, stickyHeader, expectedAssets, loadedAssets, passed: checks.length, total: checks.length }
    fs.writeFileSync(path.join(outputDir, 'identity-editor-visibility-report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await app.close()
  }
})().catch(error => { console.error(error); process.exit(1) })
