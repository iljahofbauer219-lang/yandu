const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = '/Users/zyc/Desktop/砚都跨境'
const outDir = path.resolve(root, 'tmp-verify')
fs.mkdirSync(outDir, { recursive: true })
const shot = name => path.join(outDir, name)

;(async () => {
  const executablePath = path.resolve(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-employee-model-verify2-'))
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

    const checks = []

    // 进入 AI员工 页面
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.waitForTimeout(1500)
    await page.screenshot({ path: shot('aiemp2-01-overview.png') })

    // ── A：「📎 上传」存在且带 data-tip；「+ 快速」已移除 ──
    const uploadBtn = page.locator('button', { hasText: '📎 上传' })
    if (!(await uploadBtn.count())) throw new Error('A失败：缺少「📎 上传」按钮')
    const uploadTip = await uploadBtn.first().getAttribute('data-tip')
    if (!uploadTip) throw new Error('A失败：「📎 上传」缺少 data-tip')
    checks.push(`A1: 上传按钮存在 data-tip="${uploadTip}"`)
    if (await page.getByText('+ 快速').count()) throw new Error('A失败：「+ 快速」仍存在')
    checks.push('A2: 「+ 快速」已不存在')

    // ── B：触发按钮默认文案 + 菜单 4 项 ──
    const trigger = page.locator('.ai-employee-model-trigger')
    if (!(await trigger.count())) throw new Error('B失败：缺少模型选择触发按钮')
    const triggerText = (await trigger.innerText()).trim()
    if (!triggerText.startsWith('选品智能体（RAGFlow·含知识库）')) throw new Error(`B失败：默认文案不符，实际="${triggerText}"`)
    if (!triggerText.endsWith('▾')) throw new Error(`B失败：默认文案缺少 ▾，实际="${triggerText}"`)
    checks.push(`B1: 触发按钮默认文案="${triggerText}"`)

    await trigger.click()
    await page.waitForTimeout(400)
    const menu = page.locator('.ai-employee-model-menu')
    if (!(await menu.count())) throw new Error('B失败：点击后菜单未弹出')
    await page.screenshot({ path: shot('aiemp2-02-model-menu.png') })
    const items = page.locator('.ai-employee-model-menu button')
    const itemCount = await items.count()
    if (itemCount !== 4) throw new Error(`B失败：菜单选项数=${itemCount}，期望4`)
    const names = []
    for (let i = 0; i < itemCount; i++) {
      const item = items.nth(i)
      names.push({ text: (await item.innerText()).replace(/\s+/g, ' ').trim(), disabled: await item.isDisabled() })
    }
    checks.push(`B2: 菜单4项=${JSON.stringify(names)}`)
    for (const kw of ['选品智能体', '通义千问 3.6 Flash', '通义千问 Plus', 'DeepSeek']) {
      if (!names.some(n => n.text.includes(kw))) throw new Error(`B失败：菜单缺少选项「${kw}」`)
    }
    checks.push('B3: 4个模型选项名称齐备')

    // ── C：显式选择「通义千问 Plus」→ 触发按钮更新；Escape；reload 持久化；还原 ──
    const qwenPlus = names.find(n => n.text.includes('通义千问 Plus'))
    if (!qwenPlus) throw new Error('C失败：找不到「通义千问 Plus」选项')
    if (qwenPlus.disabled) throw new Error('C失败：「通义千问 Plus」不可用（BAILIAN_API_KEY 缺失？）')
    await page.locator('.ai-employee-model-menu button', { hasText: '通义千问 Plus' }).first().click()
    await page.waitForTimeout(400)
    const afterSelect = (await trigger.innerText()).trim()
    if (!afterSelect.includes('通义千问 Plus')) throw new Error(`C失败：选择后触发按钮文案未更新="${afterSelect}"`)
    checks.push(`C1: 选择「通义千问 Plus」后触发按钮文案="${afterSelect}"`)
    const lsModel = await page.evaluate(() => localStorage.getItem('yd.aiEmployee.chatModel'))
    if (lsModel !== 'qwen-plus') throw new Error(`C失败：localStorage 值=${lsModel}，期望 qwen-plus`)
    checks.push(`C2: localStorage[yd.aiEmployee.chatModel]=${lsModel}`)
    await page.screenshot({ path: shot('aiemp2-03-model-selected.png') })

    // Escape 关闭
    await trigger.click()
    await page.waitForTimeout(300)
    if (!(await menu.count())) throw new Error('C失败：二次点击菜单未打开')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    if (await menu.count()) throw new Error('C失败：Escape 未能关闭菜单')
    if ((await trigger.getAttribute('aria-expanded')) !== 'false') throw new Error('C失败：Escape 后 aria-expanded 非 false')
    checks.push('C3: Escape 关闭菜单且 aria-expanded=false')

    // 重载后持久化保持
    await page.reload()
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.waitForTimeout(1500)
    const persisted = (await page.locator('.ai-employee-model-trigger').innerText()).trim()
    if (!persisted.includes('通义千问 Plus')) throw new Error(`C失败：重载后模型选择未保持="${persisted}"`)
    checks.push(`C4: 重载后触发按钮文案="${persisted}"（持久化生效）`)
    await page.screenshot({ path: shot('aiemp2-04-after-reload.png') })

    // 还原默认模型，避免污染
    await page.locator('.ai-employee-model-trigger').click()
    await page.waitForTimeout(300)
    await page.locator('.ai-employee-model-menu button', { hasText: '选品智能体' }).first().click()
    await page.waitForTimeout(400)
    const restored = (await page.locator('.ai-employee-model-trigger').innerText()).trim()
    if (!restored.startsWith('选品智能体（RAGFlow·含知识库）')) throw new Error(`C失败：还原默认模型失败="${restored}"`)
    const lsRestored = await page.evaluate(() => localStorage.getItem('yd.aiEmployee.chatModel'))
    if (lsRestored !== 'ragflow-agent') throw new Error(`C失败：还原后 localStorage=${lsRestored}`)
    checks.push(`C5: 已还原默认模型，localStorage=${lsRestored}`)

    // ── D：空输入发送禁用；快捷按钮与角色 chips ──
    const sendDisabled = await page.locator('.ai-employee-send-btn').isDisabled()
    if (!sendDisabled) throw new Error('D失败：输入为空时发送按钮未禁用')
    checks.push('D1: 空输入时发送按钮 disabled')
    for (const label of ['⇩ 提取', 'PPT 生成', '帮我写作', '图像生成', '视频生成']) {
      if (!(await page.getByRole('button', { name: label, exact: false }).count())) throw new Error(`D失败：缺少快捷按钮「${label}」`)
      checks.push(`D: 快捷按钮「${label}」存在`)
    }
    for (const agent of ['AI选品师', 'AI合规顾问', 'AI运营助理']) {
      if (!(await page.getByText(agent, { exact: true }).count())) throw new Error(`D失败：缺少角色「${agent}」`)
      checks.push(`D: 角色「${agent}」存在`)
    }
    await page.screenshot({ path: shot('aiemp2-05-final.png') })

    // 未点击「📎 上传」（原生文件对话框不在本轮范围）
    checks.push('E: 「📎 上传」仅静态断言存在性+data-tip；未触发原生文件框')

    console.log('ALL CHECKS PASSED')
    console.log(JSON.stringify(checks, null, 2))
  } finally {
    await app.close()
  }
})().catch(error => { console.error('VERIFY FAILED:', error.message); process.exit(1) })
