const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
app.setPath('userData', '/tmp/yd-verify-getapp-' + Date.now())
const opened = []
app.whenReady().then(async () => {
  ipcMain.handle('server-config:get', async () => 'http://114.55.149.192')
  ipcMain.handle('app:check-update', async () => ({ current: '1.0.8', latest: '1.0.8', isLatest: true, error: '' }))
  ipcMain.handle('app:open-download', async () => { opened.push('open-download'); return true })
  const w = new BrowserWindow({
    width: 900, height: 820, show: false,
    webPreferences: {
      preload: '/Users/zyc/Desktop/砚都跨境/dist/main/preload/preload.js',
      contextIsolation: true, nodeIntegration: false, sandbox: true
    }
  })
  await w.loadFile('/Users/zyc/Desktop/砚都跨境/dist/renderer/index.html')
  await new Promise(r => setTimeout(r, 1500))
  const getText = await w.webContents.executeJavaScript(`document.querySelector('.auth-get-app') ? document.querySelector('.auth-get-app').textContent : 'MISSING'`)
  const icon = await w.webContents.executeJavaScript(`(() => { const el = document.querySelector('.brand-mark--link'); return el ? el.tagName + '|' + el.title : 'MISSING' })()`)
  console.log('GET_APP_TEXT=' + getText)
  console.log('ICON=' + icon)
  await w.webContents.executeJavaScript(`document.querySelector('.auth-get-app').click()`)
  await new Promise(r => setTimeout(r, 500))
  console.log('IPC_OPEN_DOWNLOAD=' + JSON.stringify(opened))
  const img = await w.webContents.capturePage()
  fs.writeFileSync('/Users/zyc/Desktop/砚都跨境/tmp-verify/47-getapp-link.png', img.toPNG())
  console.log('SHOT_OK')
  app.exit(0)
}).catch(e => { console.error('ERR', e); app.exit(1) })
