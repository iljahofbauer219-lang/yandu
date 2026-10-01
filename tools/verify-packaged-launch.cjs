/**
 * 打包版启动验收：直跑 release/mac/砚都跨境.app 内二进制（临时 userData，不污染真实数据，
 * 且按 main.ts 约定自动豁免单实例守卫），确认窗口创建、登录页/主壳渲染、渲染进程无未捕获异常。
 * 截图落 artifacts/packaged-launch-01.png。
 *
 * 运行：node tools/verify-packaged-launch.cjs
 */
const { _electron: electron } = require('../server/node_modules/playwright-core')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const APP_BIN = path.resolve(__dirname, '../release/mac/砚都跨境.app/Contents/MacOS/砚都跨境')
const ARTIFACTS = path.resolve(__dirname, '../artifacts')
fs.mkdirSync(ARTIFACTS, { recursive: true })

;(async () => {
  if (!fs.existsSync(APP_BIN)) {
    console.error(`FAIL 未找到打包二进制：${APP_BIN}`)
    process.exit(1)
  }
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-launch-'))
  const stderrChunks = []
  const app = await electron.launch({
    executablePath: APP_BIN,
    args: [`--user-data-dir=${userDataDir}`],
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' }
  })
  let failures = 0
  const assert = (name, cond) => { if (cond) console.log(`  ✔ ${name}`); else { failures += 1; console.error(`  ✘ ${name}`) } }
  try {
    app.process().stderr?.on('data', chunk => stderrChunks.push(chunk.toString()))
    const page = await app.firstWindow()
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    const landed = await Promise.race([
      page.waitForSelector('.auth-screen', { timeout: 20000 }).then(() => 'login').catch(() => null),
      page.waitForSelector('.app-shell', { timeout: 20000 }).then(() => 'shell').catch(() => null)
    ])
    assert('打包版窗口创建并渲染登录页/主壳', landed === 'login' || landed === 'shell')
    console.log(`  · 落地状态：${landed || 'none'} · 标题：${await page.title()}`)
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(ARTIFACTS, 'packaged-launch-01.png') })
    assert('渲染进程无未捕获异常', pageErrors.length === 0)
    const stderrAll = stderrChunks.join('')
    const guardExit = stderrAll.includes('[instance-guard]')
    assert('主进程未触发单实例守卫退出', !guardExit)
    if (pageErrors.length) console.error('pageErrors:', pageErrors.slice(0, 5))
    if (guardExit) console.error(stderrAll.split('\n').filter(line => line.includes('[instance-guard]')).slice(0, 5).join('\n'))
  } catch (error) {
    failures += 1
    console.error('验收中断：', error)
    const tail = stderrChunks.join('').split('\n').slice(-20).join('\n')
    if (tail.trim()) console.error('stderr tail:\n' + tail)
  } finally {
    await app.close().catch(() => {})
  }
  console.log(failures === 0 ? 'PASS 打包版启动验收通过' : `FAIL ${failures} 项未通过`)
  process.exit(failures === 0 ? 0 : 1)
})()
