/**
 * 登录超时兜底端到端验收（真实 Electron 渲染进程 + Playwright）。
 * 用「TCP 接受连接但永不响应」的黑洞服务模拟半死中央服务器：
 * 登录页点击登录 → ≤16s 出现「服务器无响应」可读错误且按钮恢复可点（不再无限转圈）。
 *
 * 运行：node tools/verify-login-timeout.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const net = require('node:net')

const ARTIFACTS = path.resolve(__dirname, '../artifacts/login-timeout')
fs.mkdirSync(ARTIFACTS, { recursive: true })

;(async () => {
  // 半死服务器：接受 TCP 连接、永不回复字节
  const blackhole = net.createServer(() => {})
  await new Promise(resolve => blackhole.listen(0, '127.0.0.1', resolve))
  const port = blackhole.address().port

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-timeout-'))
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: path.resolve(__dirname, '..'), env: { ...process.env, CODEX_UI_TEST: '1', YANDU_HOT_DIR: path.join(userDataDir, 'no-hot') } })
  let failures = 0
  const assert = (name, cond) => { if (cond) console.log(`  ✔ ${name}`); else { failures += 1; console.error(`  ✘ ${name}`) } }
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.evaluate(({ serverUrl }) => {
      localStorage.setItem('sourcing.server-url:v1', serverUrl)
    }, { serverUrl: `http://127.0.0.1:${port}` })
    await page.reload()
    await page.waitForSelector('.auth-card', { timeout: 15000 })

    const inputs = page.locator('.auth-card input')
    await inputs.nth(0).fill('13426964913')
    await page.locator('.auth-card input[placeholder="登录密码"]').fill('whatever123')
    const submit = page.locator('.auth-card button[type="submit"]')
    assert('登录按钮存在', await submit.count() === 1)

    const started = Date.now()
    await submit.click()
    await page.getByText('服务器无响应', { exact: false }).waitFor({ timeout: 25000 })
    const elapsed = Date.now() - started
    assert(`点击登录后 ≤16s 显示可读错误（实测 ${(elapsed / 1000).toFixed(1)}s）`, elapsed <= 16000)
    assert('错误文案为语义化提示', (await page.locator('.auth-error').innerText()).includes('服务器无响应，请检查网络或稍后重试'))
    assert('登录按钮恢复可点', await submit.isEnabled())
    await page.screenshot({ path: path.join(ARTIFACTS, 'login-timeout-error.png') })
  } catch (error) {
    failures += 1
    console.error('[verify-login-timeout] 异常：', error)
  } finally {
    console.log(`\n[verify-login-timeout] 失败 ${failures} 项；截图输出 → ${ARTIFACTS}`)
    await app.close()
    blackhole.close()
    process.exit(failures === 0 ? 0 : 1)
  }
})()
