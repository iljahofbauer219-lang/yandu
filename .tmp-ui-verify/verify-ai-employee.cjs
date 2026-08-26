const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = '/Users/zyc/Desktop/砚都跨境'

;(async () => {
  const executablePath = path.resolve(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-employee-electron-'))
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' }
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: root, env })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const qaProfile = {
      id: 'ai-employee-qa', email: 'qa@example.test', name: 'AI员工验收', isOwner: true,
      status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null,
      org: { id: 'ai-employee-qa-org', name: '验收组织' }, roles: [], permissions: 'ALL', stores: null
    }
    await page.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(qaProfile) }))
    await page.evaluate(({ profile }) => {
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify({ accessToken: 'ai-employee-qa', refreshToken: 'ai-employee-qa', refreshTokenExpiresAt: '2099-01-01T00:00:00.000Z' }))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { profile: qaProfile })
    await page.reload()
    await page.waitForTimeout(2500)
    if (await page.getByRole('button', { name: '登 录' }).count()) throw new Error('隔离测试会话未能进入主界面')

    // 1. 导航到 AI员工
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.waitForTimeout(800)

    const checks = []

    // 2. 角色卡片
    for (const agent of ['AI选品师', 'AI合规顾问', 'AI运营助理']) {
      if (await page.getByText(agent, { exact: true }).count()) checks.push(`角色卡片:${agent}`)
      else throw new Error(`缺少角色卡片:${agent}`)
    }

    // 3. 欢迎消息 + 提取按钮 + 浏览器空状态 + 发送区
    const requiredTexts = [/提取当前商品/, '1688 商品浏览区', '打开浏览器', /Enter 发送/]
    for (const text of requiredTexts) {
      if (!(await page.getByText(text).count())) throw new Error(`界面缺少:${text}`)
      checks.push(`文本:${text}`)
    }

    // 4. 未打开浏览器时点击提取 → 应给出提示
    await page.getByRole('button', { name: /提取当前商品/ }).click()
    await page.waitForTimeout(1000)
    if (!(await page.getByText(/请先在右侧浏览器打开 1688 商品详情页/).count())) throw new Error('未打开浏览器时提取未给出提示')
    checks.push('提取提示:未打开浏览器')

    // 5. 打开浏览器 → 地址栏出现 1688 地址
    await page.getByRole('button', { name: '打开浏览器' }).first().click()
    await page.waitForTimeout(7000)
    const addressValue = await page.getByPlaceholder(/输入网址/).inputValue()
    if (!/1688\.com/.test(addressValue)) throw new Error(`地址栏未显示1688地址:${addressValue}`)
    checks.push(`浏览器打开+地址:${addressValue.slice(0, 60)}`)

    // 6. 导航输入框地址跳转（模拟输入一个 1688 搜索页）
    await page.getByPlaceholder(/输入网址/).fill('https://www.1688.com/offer_search/-3B8C.html?keywords=%E5%AE%A0%E7%89%A9')
    await page.getByPlaceholder(/输入网址/).press('Enter')
    await page.waitForTimeout(2500)
    const addressAfter = await page.getByPlaceholder(/输入网址/).inputValue()
    checks.push(`导航后地址:${addressAfter.slice(0, 60)}`)

    // 7. 收起浏览器
    await page.getByRole('button', { name: '收起浏览器' }).click()
    await page.waitForTimeout(600)

    // 8. 发送对话（RAGFlow 不可达时应显示错误兜底，不崩溃）
    const textarea = page.locator('.ai-employee-composer textarea')
    await textarea.fill('你好，简单介绍一下你的能力')
    await page.getByRole('button', { name: '发送' }).click()
    await page.waitForTimeout(12000)
    const bubbles = await page.locator('.ai-employee-message .ai-employee-bubble').allTextContents()
    if (!bubbles.some(t => t.includes('你好，简单介绍一下你的能力'))) throw new Error('用户消息未上屏')
    const last = bubbles[bubbles.length - 1]
    if (last === '你好，简单介绍一下你的能力') throw new Error('AI 未返回内容也未显示错误兜底')
    checks.push(`对话回复兜底:${last.replace(/\s+/g, ' ').slice(0, 60)}`)

    // 9. 截图验收
    await page.screenshot({ path: path.resolve(root, '.tmp-ui-verify/out/ai-employee-workbench.png') })
    console.log('ALL CHECKS PASSED:', JSON.stringify(checks, null, 2))
  } finally {
    await app.close()
  }
})().catch(error => { console.error('VERIFY FAILED:', error.message); process.exit(1) })
