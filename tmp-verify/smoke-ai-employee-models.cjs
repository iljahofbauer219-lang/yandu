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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-employee-model-verify-'))
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
    await page.waitForTimeout(1200)
    await page.screenshot({ path: shot('aiemp-01-overview.png') })

    // ── 断言 A：「📎 上传」按钮存在且带 data-tip；「+ 快速」已移除 ──
    const uploadBtn = page.locator('button', { hasText: '📎 上传' })
    if (!(await uploadBtn.count())) throw new Error('断言A失败：缺少「📎 上传」按钮')
    const uploadTip = await uploadBtn.first().getAttribute('data-tip')
    if (!uploadTip) throw new Error('断言A失败：「📎 上传」缺少 data-tip')
    checks.push(`A1: 上传按钮存在 data-tip="${uploadTip}"`)
    if (await page.getByText('+ 快速').count()) throw new Error('断言A失败：「+ 快速」仍存在')
    checks.push('A2: 「+ 快速」已不存在')

    // ── 断言 B：模型选择触发按钮 + 向上弹出菜单 + 4 个选项 ──
    const trigger = page.locator('.ai-employee-model-trigger')
    if (!(await trigger.count())) throw new Error('断言B失败：缺少模型选择触发按钮')
    const triggerText = (await trigger.innerText()).trim()
    if (!triggerText.includes('选品智能体（RAGFlow·含知识库）')) throw new Error(`断言B失败：默认文案不符，实际="${triggerText}"`)
    checks.push(`B1: 触发按钮默认文案="${triggerText}"`)

    // 发送按钮在触发按钮左侧（composer-right 内顺序）
    const sendBtn = page.locator('.ai-employee-send-btn')
    const trigBox = await trigger.boundingBox()
    const sendBox = await sendBtn.boundingBox()
    if (!trigBox || !sendBox || trigBox.x >= sendBox.x) throw new Error('断言B失败：模型触发按钮不在发送按钮左侧')
    checks.push('B2: 触发按钮位于发送按钮左侧')

    await trigger.click()
    await page.waitForTimeout(400)
    const menu = page.locator('.ai-employee-model-menu')
    if (!(await menu.count())) throw new Error('断言B失败：点击后菜单未弹出')
    const menuBox = await menu.boundingBox()
    if (!menuBox || menuBox.y + menuBox.height > trigBox.y + 2) throw new Error(`断言B失败：菜单非向上弹出 menu.y=${menuBox?.y} trigger.y=${trigBox.y}`)
    checks.push('B3: 菜单向上弹出')
    await page.screenshot({ path: shot('aiemp-02-model-menu.png') })

    const items = page.locator('.ai-employee-model-menu button')
    const itemCount = await items.count()
    if (itemCount !== 4) throw new Error(`断言B失败：菜单选项数=${itemCount}，期望4`)
    const expected = [
      ['ragflow-agent', '选品智能体（RAGFlow·含知识库）'],
      ['qwen3.6-flash', '通义千问 3.6 Flash'],
      ['qwen-plus', '通义千问 Plus'],
      ['deepseek-chat', 'DeepSeek'],
    ]
    const actualStates = []
    for (let i = 0; i < itemCount; i++) {
      const item = items.nth(i)
      const text = (await item.innerText()).replace(/\s+/g, ' ').trim()
      actualStates.push({ text, disabled: await item.isDisabled() })
    }
    checks.push(`B4: 菜单选项=${JSON.stringify(actualStates)}`)
    // 名称关键字匹配
    const names = actualStates.map(s => s.text)
    for (const [, label] of expected) {
      const kw = label.replace(/（.*）/, '')
      if (!names.some(n => n.includes(kw))) throw new Error(`断言B失败：菜单缺少选项 ${label}，实际=${JSON.stringify(names)}`)
    }
    checks.push('B5: 4个模型选项名称齐备')
    // env 判定：.env.local 含 BAILIAN_API_KEY 与 DEEPSEEK_API_KEY，qwen/deepseek 项应可用
    const unavailable = actualStates.filter(s => s.disabled)
    checks.push(unavailable.length ? `B6-注意: 不可用项=${JSON.stringify(unavailable)}` : 'B6: 所有模型项均可用（.env.local 含 BAILIAN_API_KEY 与 DEEPSEEK_API_KEY）')

    // ── 断言 C：选择非默认模型 → 文案更新；Escape 关闭；重载后持久化 ──
    const target = actualStates.find(s => !s.disabled && !s.text.includes('选品智能体'))
    if (!target) throw new Error('断言C失败：无可用非默认模型可选')
    await page.locator('.ai-employee-model-menu button', { hasText: target.text.split(' ')[0] }).first().click()
    await page.waitForTimeout(400)
    const afterSelect = (await trigger.innerText()).trim()
    const targetKw = target.text.split(' ')[0]
    if (!afterSelect.includes(targetKw)) throw new Error(`断言C失败：选择后触发按钮文案未更新="${afterSelect}"`)
    checks.push(`C1: 选择「${target.text}」后触发按钮文案="${afterSelect}"`)
    const lsModel = await page.evaluate(() => localStorage.getItem('yd.aiEmployee.chatModel'))
    if (!lsModel || lsModel === 'ragflow-agent') throw new Error(`断言C失败：localStorage 未持久化，值=${lsModel}`)
    checks.push(`C2: localStorage[yd.aiEmployee.chatModel]=${lsModel}`)
    await page.screenshot({ path: shot('aiemp-03-model-selected.png') })

    // Escape 关闭
    await trigger.click()
    await page.waitForTimeout(300)
    if (!(await menu.count())) throw new Error('断言C失败：二次点击菜单未打开')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    if (await menu.count()) throw new Error('断言C失败：Escape 未能关闭菜单')
    if ((await trigger.getAttribute('aria-expanded')) !== 'false') throw new Error('断言C失败：Escape 后 aria-expanded 非 false')
    checks.push('C3: Escape 关闭菜单')

    // 重载后持久化
    await page.reload()
    await page.waitForTimeout(2500)
    await page.getByRole('button', { name: 'AI员工' }).click()
    await page.waitForTimeout(1500)
    const persisted = (await page.locator('.ai-employee-model-trigger').innerText()).trim()
    if (!persisted.includes(targetKw)) throw new Error(`断言C失败：重载后模型选择未保持="${persisted}"`)
    checks.push(`C4: 重载后触发按钮文案="${persisted}"（持久化生效）`)
    await page.screenshot({ path: shot('aiemp-04-after-reload.png') })

    // 还原默认模型，避免污染
    await page.locator('.ai-employee-model-trigger').click()
    await page.waitForTimeout(300)
    await page.locator('.ai-employee-model-menu button', { hasText: '选品智能体' }).first().click()
    await page.waitForTimeout(300)

    // ── 断言 D：其余快捷按钮 / 角色 chips / 空输入发送禁用 ──
    for (const label of ['⇩ 提取', 'PPT 生成', '帮我写作', '图像生成', '视频生成']) {
      if (!(await page.getByRole('button', { name: label, exact: false }).count())) throw new Error(`断言D失败：缺少快捷按钮「${label}」`)
      checks.push(`D: 快捷按钮「${label}」存在`)
    }
    for (const agent of ['AI选品师', 'AI合规顾问', 'AI运营助理']) {
      if (!(await page.getByText(agent, { exact: true }).count())) throw new Error(`断言D失败：缺少角色「${agent}」`)
      checks.push(`D: 角色「${agent}」存在`)
    }
    const sendDisabled = await page.locator('.ai-employee-send-btn').isDisabled()
    if (!sendDisabled) throw new Error('断言D失败：输入为空时发送按钮未禁用')
    checks.push('D: 空输入时发送按钮 disabled')
    await page.screenshot({ path: shot('aiemp-05-final.png') })

    // ── 断言 E：上传按钮仅静态断言（原生文件对话框无法自动化，避免阻塞） ──
    checks.push('E: 「📎 上传」存在性+data-tip 已静态断言；未点击（原生文件对话框无法自动化）')

    console.log('ALL CHECKS PASSED')
    console.log(JSON.stringify(checks, null, 2))
  } finally {
    await app.close()
  }
})().catch(error => { console.error('VERIFY FAILED:', error.message); process.exit(1) })
