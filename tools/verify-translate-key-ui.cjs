/**
 * 网页翻译「缺百炼 API Key」修复验收（打包二进制 + 临时 userData + 空 cwd，复现打包态 env 解析）。
 * 覆盖：缺 Key 时友好引导横幅（无 IPC 原始堆栈）+ 「去配置」CTA 落地大模型API Key 页、
 * llm-keys:save 回写 userData/.env.local（打包态可写）、保存后翻译懒读 env 立即生效（无需重启）。
 * 截图落 artifacts/translate-key-01-friendly.png / translate-key-02-after-save.png。
 *
 * 运行：node tools/verify-translate-key-ui.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const APP_BIN = path.resolve(__dirname, '../release/mac/砚都跨境.app/Contents/MacOS/砚都跨境')
const ARTIFACTS = path.resolve(__dirname, '../artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

const ownerProfile = {
  id: 'translate-key-owner', email: 'owner@example.test', name: '老板', isOwner: true,
  status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
  org: { id: 'translate-key-org', name: '翻译验收组织' }, roles: [], permissions: 'ALL', stores: null
}

function json(body) {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body) }
}

async function mockAuth(page) {
  await page.route('**/api/**', async route => {
    const p = new URL(route.request().url()).pathname
    if (p === '/api/auth/me') return route.fulfill(json(ownerProfile))
    return route.continue()
  })
  await page.evaluate(({ profile }) => {
    localStorage.setItem('sourcing.server-url:v1', 'https://translate-mock.invalid')
    localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'translate-key-owner', refreshToken: 'translate-key-owner', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
    localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
  }, { profile: ownerProfile })
  await page.reload()
  await page.waitForTimeout(1200)
}

// 进入采集工作台（tasks 页，含浏览器工作区与翻译入口）
async function openCollectWorkspace(page) {
  await page.locator('.sidebar').getByRole('button', { name: 'AI采集', exact: true }).click()
  await page.waitForSelector('.ai-collect-page', { timeout: 8000 })
  await page.locator('.ai-collect-card', { hasText: '大健云仓' }).first().click()
  await page.waitForSelector('.workspace', { timeout: 8000 })
  await page.waitForTimeout(600)
}

// 地址栏导航到平台白名单内且含文本的页面（tasks 浏览器仅允许对应平台域名），保证翻译有可提取文案
async function navigateToTextPage(page) {
  await page.locator('.address-bar input[aria-label="网页地址"]').fill('https://www.1688.com/')
  await page.locator('.address-bar button.address-go').click()
  await page.waitForTimeout(4000)
}

;(async () => {
  if (!fs.existsSync(APP_BIN)) {
    console.error(`FAIL 未找到打包二进制：${APP_BIN}`)
    process.exit(1)
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-key-userdata-'))
  const emptyCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'translate-key-cwd-'))
  let failures = 0
  const assert = (name, cond) => { if (cond) console.log(`  ✔ ${name}`); else { failures += 1; console.error(`  ✘ ${name}`) } }

  const app = await electron.launch({
    executablePath: APP_BIN,
    args: [`--user-data-dir=${userDataDir}`],
    cwd: emptyCwd,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
  })
  try {
    const pageErrors = []
    const page = await app.firstWindow()
    page.on('pageerror', error => pageErrors.push(error.message))
    page.on('dialog', dialog => dialog.accept())
    await page.waitForLoadState('domcontentloaded')
    await mockAuth(page)

    // 场景 A：缺 Key（userData 无 .env.local、asar 无、cwd 空目录）→ 友好引导
    console.log('场景 A · 缺 Key 友好提示与 CTA')
    await openCollectWorkspace(page)
    await navigateToTextPage(page)
    await page.locator('.translation-trigger').click()
    // 工作区自动加载可能先写入无关错误横幅，需显式等待翻译错误覆盖横幅
    const friendlyBanner = page.locator('.workspace .error', { hasText: '大模型API Key' })
    await friendlyBanner.waitFor({ timeout: 10000 })
    const banner = await friendlyBanner.innerText()
    console.log(`  · 横幅文案：${banner.slice(0, 80)}`)
    assert('错误横幅为友好引导文案（含大模型API Key 路径）', banner.includes('大模型API Key'))
    assert('错误横幅不含 IPC 原始堆栈', !banner.includes('Error invoking remote method'))
    assert('错误横幅含「去配置」CTA 按钮', (await friendlyBanner.locator('button', { hasText: '去配置' }).count()) === 1)
    await page.screenshot({ path: path.join(ARTIFACTS, 'translate-key-01-friendly.png') })

    // CTA 落地大模型API Key 页，且百炼为未配置
    await friendlyBanner.locator('button', { hasText: '去配置' }).click()
    await page.waitForSelector('.llm-keys-page', { timeout: 8000 })
    const bailianCard = await page.locator('.llm-keys-page .llm-key-card', { hasText: '百炼' }).first().innerText().catch(() => '')
    const pendingCount = await page.locator('.llm-keys-page .llm-pending').count()
    assert('CTA 落地大模型API Key 页', true)
    assert('百炼卡片显示未配置', bailianCard.includes('未配置') || pendingCount >= 1)

    // 场景 B：打包态经 llm-keys:save 回写 userData/.env.local
    console.log('场景 B · 打包态保存 Key 写入 userData 且立即生效')
    const saved = await page.evaluate(() => window.desktop.llmKeys.save('bailian', 'sk-test-abcdef123456'))
    assert('llm-keys:save 返回 ok', saved && saved.ok === true)
    const envFile = path.join(userDataDir, '.env.local')
    const envRaw = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : ''
    assert('userData/.env.local 已创建并含 BAILIAN_API_KEY', envRaw.includes('BAILIAN_API_KEY=sk-test-abcdef123456'))
    const list = await page.evaluate(() => window.desktop.llmKeys.list())
    const bailianStatus = (list || []).find(item => item.id === 'bailian')
    assert('llm-keys:list 显示百炼已配置', Boolean(bailianStatus && bailianStatus.configured))

    // 不重启，直接回 tasks 再翻译：懒读 env 应不再报缺 Key（假 Key 预期 401 → 「网页翻译失败」横幅，证明已携带 Key 发起请求）
    await openCollectWorkspace(page)
    await navigateToTextPage(page)
    await page.locator('.translation-trigger').click()
    const reached = await Promise.race([
      page.locator('.workspace .error', { hasText: '网页翻译失败' }).waitFor({ timeout: 25000 }).then(() => 'http-error').catch(() => null),
      page.locator('.translation-trigger.active').waitFor({ timeout: 25000 }).then(() => 'translated').catch(() => null)
    ])
    const bannerAfter = await page.locator('.workspace .error', { hasText: '网页翻译' }).innerText().catch(() => '')
    console.log(`  · 保存后翻译结果：${reached || 'none'} · 横幅：${bannerAfter ? bannerAfter.slice(0, 80) : '（无翻译错误横幅）'}`)
    assert('保存后翻译已携带 Key 发起请求（懒读生效）', reached !== null)
    assert('保存后翻译不再报「未配置百炼」', !bannerAfter.includes('未配置百炼') && !bannerAfter.includes('BAILIAN_KEY_MISSING'))
    assert('保存后横幅已剥离 IPC 信封前缀', !bannerAfter.includes('Error invoking remote method'))
    await page.screenshot({ path: path.join(ARTIFACTS, 'translate-key-02-after-save.png') })

    assert('渲染进程无未捕获异常', pageErrors.length === 0)
    if (pageErrors.length) console.error('pageErrors:', pageErrors.slice(0, 5))
  } catch (error) {
    failures += 1
    console.error('验收中断：', error)
  } finally {
    await app.close().catch(() => {})
  }
  console.log(failures === 0 ? 'PASS 翻译缺 Key 修复验收通过' : `FAIL ${failures} 项未通过`)
  process.exit(failures === 0 ? 0 : 1)
})()
