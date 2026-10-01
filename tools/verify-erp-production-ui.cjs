// 真实 Electron → SSH 加密隧道 → 已上线生产 API。没有 HTTP 拦截或 mock。
const { _electron: electron } = require('/Users/zyc/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')
const { execFileSync, spawn } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const ROOT = path.resolve(__dirname, '..')
const OUTPUT = path.join(ROOT, 'artifacts/erp-production/real-ui')
const BASE = 'http://127.0.0.1:18787'
const SSH_OPTIONS = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no']
const report = { checkedAt: new Date().toISOString(), backend: '生产 yandu-app，经 SSH 隧道连接', mock: false, checks: [], network: [], screenshots: [] }
let app, tunnel, page, stage = '初始化'
function record(name, ok) { report.checks.push({ name, ok }); if (!ok) throw new Error('CHECK_FAILED') }
async function shot(name) {
  const target = path.join(OUTPUT, name + '.png')
  await page.screenshot({ path: target })
  report.screenshots.push(target)
}
async function waitForTunnel() {
  for (let i = 0; i < 30; i++) {
    if (tunnel.exitCode !== null) throw new Error('SSH_TUNNEL_FAILED')
    try { const r = await fetch(BASE + '/health', { signal: AbortSignal.timeout(1000) }); if (r.ok) return } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('TUNNEL_NOT_READY')
}
async function openTab(name, pathname) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname === pathname && r.request().method() === 'GET', { timeout: 20000 })
  await page.locator('.warehouse-flow-nav').getByRole('button', { name, exact: true }).click()
  const r = await response
  record(name + '真实请求200', r.status() === 200)
  await page.waitForFunction(() => !document.querySelector('.erp-warehouse-toolbar button[disabled]'))
  record(name + '无路由错误', !(await page.locator('.erp-banner-error').count()))
}
;(async () => {
  fs.mkdirSync(OUTPUT, { recursive: true })
  try {
    stage = '读取隔离验收账号'
    const command = 'docker exec yandu-app node -e ' + "'process.stdout.write(require(\"node:fs\").readFileSync(\"/tmp/erp-deploy-auth.json\",\"utf8\"))'"
    const state = JSON.parse(execFileSync('ssh', [...SSH_OPTIONS, 'root@114.55.149.192', command], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
    if (state.marker !== 'ERP部署验收' || !state.approved || !state.orgId.startsWith('erp-deploy-')) throw new Error('FIXTURE_SCOPE_INVALID')
    stage = '建立生产连接隧道'
    tunnel = spawn('ssh', [...SSH_OPTIONS, '-o', 'ExitOnForwardFailure=yes', '-N', '-L', '127.0.0.1:18787:127.0.0.1:8787', 'root@114.55.149.192'], { stdio: 'ignore' })
    await waitForTunnel()
    stage = '真实登录'
    const loginResponse = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: state.email, password: state.password }), signal: AbortSignal.timeout(15000) })
    const login = await loginResponse.json()
    record('真实登录与隔离组织匹配', loginResponse.status === 200 && login.user?.org?.id === state.orgId && Boolean(login.tokens?.accessToken))
    stage = '启动隔离客户端'
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-production-ui-'))
    app = await electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: ['.', `--user-data-dir=${userDataDir}`], cwd: ROOT })
    const actualDir = await app.evaluate(({ app }) => app.getPath('userData'))
    report.directoryIsolation = { expected: userDataDir, actual: actualDir }
    record('客户端数据与用户日常环境隔离', fs.realpathSync(actualDir) === fs.realpathSync(userDataDir))
    page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    stage = '调整客户端窗口'
    await app.evaluate(({ BaseWindow }) => { const w = BaseWindow.getAllWindows()[0]; w.setSize(1440, 960) })
    page.on('response', response => {
      try { const u = new URL(response.url()); if (u.pathname.startsWith('/api/erp/')) report.network.push({ path: u.pathname, method: response.request().method(), status: response.status() }) } catch {}
    })
    stage = '设置隔离客户端会话'
    await page.evaluate(({ base, tokens, profile }) => {
      localStorage.setItem('sourcing.server-url:v1', base)
      localStorage.setItem('sourcing.auth.tokens:v1', JSON.stringify(tokens))
      localStorage.setItem('sourcing.auth.profile:v1', JSON.stringify(profile))
    }, { base: BASE, tokens: login.tokens, profile: login.user })
    stage = '刷新已登录客户端'
    await page.reload()
    stage = '打开采集池'
    const poolRequest = page.waitForResponse(r => new URL(r.url()).pathname === '/api/erp/products' && r.request().method() === 'GET', { timeout: 30000 })
    await page.getByRole('button', { name: 'AI仓库', exact: true }).first().click({ timeout: 30000 })
    record('采集池真实请求200', (await poolRequest).status() === 200)
    await page.getByText('采集池为空，进入采集工作台开始采集', { exact: true }).waitFor({ timeout: 15000 })
    record('采集池无路由错误', !(await page.locator('.erp-banner-error').count()))
    await shot('01-pool-real-api')
    stage = '产品库'
    await openTab('产品库', '/api/erp/products')
    await page.getByText('Unbranded Blue Storage Cup Deployment Test Fixture', { exact: true }).waitFor({ timeout: 15000 })
    await shot('02-products-real-api')
    stage = '产品详情与图片'
    await page.getByText('Unbranded Blue Storage Cup Deployment Test Fixture', { exact: true }).click()
    await page.locator('.erp-image-grid img').first().waitFor({ timeout: 15000 })
    await page.waitForFunction(() => [...document.querySelectorAll('.erp-image-grid img')].every(img => img.complete && img.naturalWidth > 0), undefined, { timeout: 30000 })
    const imageCount = await page.locator('.erp-image-grid img').count()
    record('已入库图片真实可加载', imageCount >= 1)
    report.imageCount = imageCount
    await shot('03-product-images-real-api')
    await page.locator('.erp-drawer').getByRole('button', { name: '关闭', exact: true }).click()
    stage = '待确认变更'
    await openTab('待确认变更', '/api/erp/changes')
    await shot('04-changes-real-api')
    stage = '通知中心'
    await openTab('通知中心', '/api/erp/notifications')
    await page.locator('.erp-notification').first().waitFor({ timeout: 15000 })
    record('真实汇总通知显示', (await page.locator('.erp-notification').count()) >= 1)
    await shot('05-notifications-real-api')
    record('ERP网络请求无4xx或5xx', report.network.length > 0 && report.network.every(row => row.status < 400))
  } catch (error) {
    report.failure = { stage, type: error.name, callsite: error.stack?.match(/verify-erp-production-ui\.cjs:\d+:\d+/)?.[0], code: ['CHECK_FAILED','SSH_TUNNEL_FAILED','FIXTURE_SCOPE_INVALID','TUNNEL_NOT_READY'].includes(error.message) ? error.message : 'REDACTED_EXECUTION_ERROR' }
    if (page && stage !== '真实登录') { try { await shot('failure') } catch {} }
    process.exitCode = 1
  } finally {
    if (page) await page.evaluate(() => {
      for (const key of ['sourcing.server-url:v1', 'sourcing.auth.tokens:v1', 'sourcing.auth.profile:v1']) localStorage.removeItem(key)
    }).catch(() => {})
    if (app) await app.close().catch(() => {})
    if (tunnel) tunnel.kill('SIGTERM')
    report.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(OUTPUT, 'report.json'), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ passed: report.checks.filter(row => row.ok).length, failed: report.checks.filter(row => !row.ok).length, failure: report.failure, screenshots: report.screenshots, report: path.join(OUTPUT, 'report.json') }, null, 2))
  }
})()
