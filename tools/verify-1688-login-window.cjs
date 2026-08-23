const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

;(async () => {
  const executablePath = path.resolve(__dirname, '../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yandu-1688-login-window-'))
  const app = await electron.launch({ executablePath, args: [`--user-data-dir=${userDataDir}`, '.'], cwd: path.resolve(__dirname, '..') })
  try {
    const mainPage = await app.firstWindow()
    const mainUrlBefore = mainPage.url()
    const result = await app.evaluate(async ({ BrowserWindow }) => {
      const { createRequire } = process.getBuiltinModule('node:module')
      const localRequire = createRequire(`${process.cwd()}/package.json`)
      const { BrowserWorkspace } = localRequire(`${process.cwd()}/dist/main/main/browser/BrowserWorkspace.js`)
      const holder = { productLoginWindow: null }
      void BrowserWorkspace.prototype.open1688ProductLoginWindow.call(holder, 'https://login.1688.com/')
      const deadline = Date.now() + 8_000
      let loginWindow
      while (Date.now() < deadline) {
        loginWindow = BrowserWindow.getAllWindows().find(window => window.getTitle().includes('1688 登录'))
        if (loginWindow) break
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      if (!loginWindow) throw new Error('未创建1688独立登录窗口')
      const before = {
        title: loginWindow.getTitle(),
        closable: loginWindow.isClosable(),
        minimizable: loginWindow.isMinimizable(),
        partition: loginWindow.webContents.session.storagePath
      }
      loginWindow.close()
      await new Promise(resolve => setTimeout(resolve, 200))
      return { ...before, closed: loginWindow.isDestroyed(), referenceCleared: holder.productLoginWindow === null }
    })
    const mainPagePreserved = !mainPage.isClosed() && mainPage.url() === mainUrlBefore
    if (!result.closable || !result.closed || !result.referenceCleared || !mainPagePreserved) throw new Error(`登录窗口关闭流程不完整：${JSON.stringify({ ...result, mainPagePreserved })}`)
    console.log(JSON.stringify({ ...result, mainPagePreserved }, null, 2))
  } finally {
    await app.close()
  }
})().catch(error => { console.error(error); process.exit(1) })
