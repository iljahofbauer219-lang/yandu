const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const reportPath = path.resolve(process.argv[2] || '')
const domain = process.argv[3] || 'web'
const sourceUrl = process.argv[4] || ''
const outputPath = path.resolve(process.argv[5] || path.join(root, 'output/resource2skill-input/distilled-skill.md'))
if (!fs.existsSync(reportPath)) throw new Error('缺少 Watch Skill 报告')

;(async () => {
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'resource2skill-text-'))
  const sourceSettings = path.join(os.homedir(), 'Library/Application Support/cross-border-sourcing-desktop/resource2skill-settings.json')
  fs.copyFileSync(sourceSettings, path.join(userDataDir, 'resource2skill-settings.json'))
  const app = await electron.launch({ executablePath, args: ['.', `--user-data-dir=${userDataDir}`], cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' } })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const result = await page.evaluate(input => window.desktop.system.resource2SkillTextDistill(input), { reportPath, domain, sourceUrl })
    const name = `icons-of-football-interview-distillation`
    const content = `---\nname: ${name}\ndescription: Distilled from a timestamped Watch Skill report\nresource2skill_domain: ${domain}\nsource: ${sourceUrl}\n---\n\n# ${name}\n\n> 状态：Watch Skill 本地解析 + Resource2Skill Gemini 文本蒸馏。\n\n${result.analysis}\n`
    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    fs.writeFileSync(outputPath, content)
    console.log(JSON.stringify({ passed: true, outputPath, contentLength: content.length }, null, 2))
  } finally { await app.close() }
})().catch(error => { console.error(`TEXT DISTILL FAILED: ${error.message}`); process.exit(1) })
