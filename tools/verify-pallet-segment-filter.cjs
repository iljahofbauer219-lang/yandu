/**
 * 货盘仓库页方法 Tab（含单链接采集）过滤验收（真实 Electron + Playwright，组件内 mock 数据）。
 * mock 分布：KEYWORD 8 / PRODUCT_URL 4 / CATEGORY_URL 2（共 14）。
 * 断言：默认 14 卡且采集方式 3；单链接采集 Tab 恰 4 卡且来源标签均为单链接采集；
 * 关键词搜索 8 卡；类目页采集 2 卡；切回全部 14 卡。
 *
 * 运行：先 vite build，再 node tools/verify-pallet-segment-filter.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const ARTIFACTS = path.resolve(__dirname, '../artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const ownerProfile = {
  id: 'ps-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'ps-org', name: '货盘段过滤验收组织' }, roles: [], permissions: 'ALL', stores: null
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pallet-segment-'))
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
      localStorage.setItem('sourcing.server-url:v1', 'https://pallet-segment-mock.invalid')
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'ps-owner', refreshToken: 'ps-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: ownerProfile })
    await page.reload()
    await page.waitForTimeout(1200)

    await page.locator('.sidebar').getByRole('button', { name: '货盘仓库', exact: true }).click()
    await page.waitForSelector('.candidate-catalog-main', { timeout: 8000 })
    await page.waitForTimeout(500)

    const cards = page.locator('.candidate-catalog-main .product-card')
    const chips = async () => (await page.locator('.candidate-zone-summary').innerText())
    const badge = async () => (await page.locator('.pallet-heading-title-row em').innerText()).trim()
    const segmentBtn = (label) => page.locator('.candidate-view-switch button', { hasText: label })

    console.log('默认与采集方式计数')
    assert('默认 14 卡', await cards.count() === 14)
    const chips0 = await chips()
    assert('当前显示 14 且采集方式 3', chips0.includes('当前显示 14') && chips0.includes('采集方式 3'))
    assert('标题旁徽标默认 14', await badge() === '14')

    console.log('单链接采集 Tab 过滤')
    await segmentBtn('单链接采集').click()
    await page.waitForTimeout(400)
    assert('单链接采集恰 4 卡', await cards.count() === 4)
    const urlSources = await page.locator('.candidate-catalog-main .original-price').allInnerTexts()
    assert('4 卡来源标签均为单链接采集', urlSources.length === 4 && urlSources.every(text => text.includes('单链接采集')))
    assert('当前显示 4', (await chips()).includes('当前显示 4'))
    assert('徽标联动 4', await badge() === '4')
    await page.screenshot({ path: path.join(ARTIFACTS, 'pallet-segment-01.png') })

    console.log('关键词/类目页/全部 Tab')
    await segmentBtn('关键词搜索').click()
    await page.waitForTimeout(400)
    assert('关键词搜索恰 8 卡', await cards.count() === 8)
    assert('徽标联动 8', await badge() === '8')
    const kwSources = await page.locator('.candidate-catalog-main .original-price').allInnerTexts()
    assert('8 卡来源标签均为关键词搜索', kwSources.length === 8 && kwSources.every(text => text.includes('关键词搜索')))
    await segmentBtn('类目页采集').click()
    await page.waitForTimeout(400)
    assert('类目页采集恰 2 卡', await cards.count() === 2)
    assert('徽标联动 2', await badge() === '2')
    await segmentBtn('全部商品').click()
    await page.waitForTimeout(400)
    assert('切回全部商品 14 卡', await cards.count() === 14)
    assert('徽标回落 14', await badge() === '14')

    assert('渲染进程无未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error(pageErrors.join('\n'))
  } finally {
    await app.close()
  }
  console.log(failures === 0 ? 'VERIFY_OK 全部断言通过' : `VERIFY_FAILED ${failures} 项断言失败`)
  process.exit(failures === 0 ? 0 : 1)
})()
