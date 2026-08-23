const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const root = path.resolve(__dirname, '..')
const outputDir = path.join(root, 'output/playwright/stage7-amazon-live-source')
fs.mkdirSync(outputDir, { recursive: true })
const keywords = ['waterless pet shampoo', 'no rinse pet cleanser', 'waterless pet body wash']

;(async () => {
  const executablePath = path.join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  // 不抢占用户正在使用的桌面实例；只复制已保存的加密配置到隔离验收实例。
  const sourceConfig = path.join(os.homedir(), 'Library/Application Support/cross-border-sourcing-desktop/amazon-data-source.json')
  if (!fs.existsSync(sourceConfig)) throw new Error('当前用户 Amazon 数据源配置不存在')
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage7-amazon-live-probe-'))
  fs.copyFileSync(sourceConfig, path.join(userDataDir, 'amazon-data-source.json'))
  fs.chmodSync(path.join(userDataDir, 'amazon-data-source.json'), 0o600)
  const app = await electron.launch({
    executablePath,
    args: [`--user-data-dir=${userDataDir}`, '.'],
    cwd: root,
    env: { ...process.env, CODEX_UI_TEST: '1', ELECTRON_RUN_AS_NODE: '', NODE_OPTIONS: '' }
  })
  try {
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    const settings = await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.get())
    const connection = await page.evaluate(() => window.desktop.aiEmployee.amazonDataSource.test())
    const searches = []
    for (const keyword of keywords) {
      const search = await page.evaluate(value => window.desktop.aiEmployee.amazonDataSource.search(value), keyword)
      searches.push({
        keyword,
        error: search.error || '',
        count: search.samples?.length || 0,
        meta: search.meta || null,
        preview: (search.samples || []).slice(0, 2).map(item => ({ asin: item.asin, title: item.title, price: item.price, rating: item.rating, reviews: item.reviews, sponsored: item.sponsored, page: item.page, source: item.source }))
      })
    }
    const browserSamples = await page.evaluate(value => window.desktop.aiEmployee.amazonMarketStats(value), keywords[0])
    const cachedSearch = await page.evaluate(value => window.desktop.aiEmployee.amazonDataSource.search(value), keywords[0])
    const report = {
      checkedAt: new Date().toISOString(),
      settings,
      connection,
      searches,
      browserFallback: {
        keyword: keywords[0],
        count: browserSamples?.length || 0,
        preview: (browserSamples || []).slice(0, 2).map(item => ({ asin: item.asin, title: item.title, price: item.price, rating: item.rating, reviews: item.reviews, source: item.source }))
      },
      cachedMeta: cachedSearch.meta || null
    }
    fs.writeFileSync(path.join(outputDir, 'live-probe.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    if (!settings.configured) process.exitCode = 2
    else if (!connection.ok || report.searches.some(item => !item.count || item.meta?.source !== 'api')) process.exitCode = 3
    else if (!report.cachedMeta?.cacheHit) process.exitCode = 4
    else if (report.searches.some(search => search.preview.some(item => /&(?:amp|quot|apos|lt|gt|nbsp|#\d+|#x[\da-f]+);/i.test(item.title)))) process.exitCode = 5
  } finally {
    await app.close()
  }
})().catch(error => { console.error(error); process.exit(1) })
