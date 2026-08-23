const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const url = process.argv[2]
const domain = process.argv[3] || 'web'
if (!url) throw new Error('缺少 YouTube URL')

;(async () => {
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource2skill-official-'))
  const sourceSettings = path.join(os.homedir(), 'Library/Application Support/cross-border-sourcing-desktop/resource2skill-settings.json')
  fs.copyFileSync(sourceSettings, path.join(userDataDir, 'resource2skill-settings.json'))
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const settings = await page.evaluate(() => window.desktop.system.resource2SkillModelSettings())
    if (!settings.configured) throw new Error('正式应用未配置 API Key')
    const result = await page.evaluate(({ url, domain }) => window.desktop.system.resource2SkillOfficialAnalyze({ url, domain }), { url, domain })
    console.log(JSON.stringify({ passed: true, id: result.id, name: result.name, domain, sourceTaskId: result.sourceTaskId, contentLength: result.content.length }, null, 2))
  } finally {
    await app.close()
  }
})().catch(error => { console.error(`OFFICIAL DISTILL FAILED: ${error.message}`); process.exit(1) })
