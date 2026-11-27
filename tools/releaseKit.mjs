/**
 * 发版纯函数：版本递增、win 交叉构建参数、运行时校验、下载页渲染。
 * 抽成模块是为了让 vitest 能钉住这些判定，避免错了要等发版当天才暴露。
 */
import path from 'node:path'

const SEMVER = /^\d+\.\d+\.\d+$/
const KINDS = ['patch', 'minor', 'major']

export function bumpSemver(version, kind) {
  if (!SEMVER.test(String(version))) throw new Error(`版本号非法：${version}`)
  if (!KINDS.includes(kind)) throw new Error(`递增段位非法：${kind}`)
  const [major, minor, patch] = String(version).split('.').map(Number)
  if (kind === 'major') return `${major + 1}.0.0`
  if (kind === 'minor') return `${major}.${minor + 1}.0`
  return `${major}.${minor}.${patch + 1}`
}

// yml 里 electronDist: node_modules/electron/dist 在 mac 上是 darwin 运行时，
// win 目标必须显式覆盖到真正的 win 运行时，否则 win-unpacked 里没有 electron.exe 可改名
export function winBuildArgs(root, runtimeDir = path.join(root, '.cache', 'electron-win32-x64')) {
  return ['--win', '--x64', '--publish', 'never', `--config.electronDist=${runtimeDir}`]
}

export function verifySha256(expected, actual) {
  const left = String(expected ?? '').trim().toLowerCase()
  const right = String(actual ?? '').trim().toLowerCase()
  return Boolean(left) && left === right
}

export function renderDownloadPage(template, versions) {
  const win = String(versions?.win ?? '')
  const mac = String(versions?.mac ?? '')
  if (!SEMVER.test(win) || !SEMVER.test(mac)) throw new Error(`下载页版本非法：win=${win} mac=${mac}`)
  if (!template.includes('{{WIN_VERSION}}') || !template.includes('{{MAC_VERSION}}')) {
    throw new Error('下载页模板缺少版本占位符')
  }
  const html = template.replaceAll('{{WIN_VERSION}}', win).replaceAll('{{MAC_VERSION}}', mac)
  if (html.includes('{{')) throw new Error('下载页渲染后仍有未替换占位符')
  return html
}