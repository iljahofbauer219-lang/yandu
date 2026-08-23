const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwd-toggle-'))
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${userDataDir}`, '.'], cwd: path.resolve(__dirname, '..') })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    // 等登录页渲染（未登录 → 登录页）
    await page.waitForSelector('.auth-password-toggle', { timeout: 15000 })
    const input = page.locator('.auth-password-field .yd-field__control input')
    const before = await input.getAttribute('type')
    await page.screenshot({ path: path.resolve(__dirname, '../tmp-verify/30-password-eye-hidden.png') })
    // 点击眼睛图标 → 显示明文
    await page.locator('.auth-password-toggle').click()
    await page.waitForTimeout(300)
    const after = await input.getAttribute('type')
    await page.screenshot({ path: path.resolve(__dirname, '../tmp-verify/31-password-eye-visible.png') })
    // 再点一次 → 恢复密文
    await page.locator('.auth-password-toggle').click()
    await page.waitForTimeout(300)
    const after2 = await input.getAttribute('type')
    const iconLabel = await page.locator('.auth-password-toggle').getAttribute('aria-label')
    console.log(JSON.stringify({ before, after, after2, iconLabel, ok: before === 'password' && after === 'text' && after2 === 'password' }, null, 2))
  } finally {
    await app.close()
  }
})().catch(error => { console.error('VERIFY_FAIL', error); process.exit(1) })
