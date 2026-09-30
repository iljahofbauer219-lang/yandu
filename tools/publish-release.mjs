#!/usr/bin/env node
/**
 * 发版发布一键脚本（2026-09-29 根治项 A）。
 *
 * 背景根因：历史上「构建新代码」与「发布到更新源」是分离的手工动作，OSS feed 停在
 * v1.0.11 而客户端已到 v1.0.14，导致自动更新永远查不到新版本、登录页误报「已是最新版本」。
 * 本脚本把 版本校验 → 构建 → 上传 → 回读验证 串成一条命令，缺一不可：
 *   1. 版本校验：feed 任一平台版本 == 当前 package.json 版本即中止（强制先 bump，杜绝同版本号重复发版客户端无感知）；
 *   2. 构建：mac 出 dmg+zip（zip 是 mac electron-updater 静默升级必需，根治项 B）、win 出 nsis exe；
 *   3. 上传：经生产服务器 ossutil（凭据只在服务器 ~/.ossutilconfig，不落本机）；先传安装包/blockmap，**最后**传 latest*.yml，
 *      避免客户端读到 yml 时安装包尚未就位；对象显式 public-read（bucket 为公共读分发源）；
 *   4. 回读验证：feed 版本必须等于本次版本，否则中止并报已上传清单。
 *
 * 用法：
 *   node tools/publish-release.mjs                 # dry-run：只打印将执行的步骤与产物清单
 *   node tools/publish-release.mjs --execute       # 实跑（mac+win）
 *   node tools/publish-release.mjs --execute --platform=mac   # 只发 mac
 *   node tools/publish-release.mjs --execute --skip-build     # 复用 release/ 既有产物（产物版本必须等于 package.json 版本）
 */
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// electron-builder 会 spawn `pnpm` 收集依赖；本机 pnpm 不在 PATH（仅有 ~/Library/pnpm/pnpm11 别名），
// 这里做临时 shim 目录注入 PATH，避免 spawn ENOENT（2026-09-29 实测）。
const pnpmHome = path.join(os.homedir(), 'Library', 'pnpm')
if (!process.env.PATH.split(':').includes(pnpmHome) && !fs.existsSync('/usr/local/bin/pnpm')) {
  const shim = path.join(os.tmpdir(), 'publish-bin-shim')
  fs.mkdirSync(shim, { recursive: true })
  const target = fs.existsSync(path.join(pnpmHome, 'pnpm')) ? path.join(pnpmHome, 'pnpm') : path.join(pnpmHome, 'pnpm11')
  if (fs.existsSync(target)) {
    const link = path.join(shim, 'pnpm')
    try { fs.rmSync(link, { force: true }) } catch { /* ignore */ }
    fs.symlinkSync(target, link)
    process.env.PATH = `${shim}:${process.env.PATH}`
  }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SSH = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', 'root@114.55.149.192']
const BUCKET = 'oss://yandu-download/'
const FEED = 'https://yandu-download.oss-cn-hangzhou.aliyuncs.com/'

const execute = process.argv.includes('--execute')
const platform = (process.argv.find(arg => arg.startsWith('--platform=')) ?? '--platform=all').split('=')[1]
const skipBuild = process.argv.includes('--skip-build')
if (!['mac', 'win', 'all'].includes(platform)) {
  console.error('ABORT: --platform 仅支持 mac|win|all')
  process.exit(1)
}

const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const rel = path.join(ROOT, 'release')

function artifactsFor(target) {
  const list = target === 'mac'
    ? [`YanduCrossBorder-${version}-x64.dmg`, `YanduCrossBorder-${version}-x64.dmg.blockmap`, `YanduCrossBorder-${version}-x64.zip`, `YanduCrossBorder-${version}-x64.zip.blockmap`]
    : [`YanduCrossBorder-Setup-${version}.exe`, `YanduCrossBorder-Setup-${version}.exe.blockmap`]
  return list.filter(name => fs.existsSync(path.join(rel, name)))
}

function feedFileFor(target) {
  return target === 'mac' ? 'latest-mac.yml' : 'latest.yml'
}

const targets = platform === 'all' ? ['mac', 'win'] : [platform]

;(async () => {
  // ── 1. 版本校验 ─────────────────────────────────────────────
  for (const target of targets) {
    const feed = feedFileFor(target)
    let text = ''
    try {
      const response = await fetch(FEED + feed, { signal: AbortSignal.timeout(15000) })
      text = response.ok ? await response.text() : ''
    } catch { /* 源不可达时不阻断：下面上传后回读会兜住 */ }
    const matched = text.match(/^version:\s*(\S+)/m)
    if (matched && matched[1] === version) {
      console.error(`ABORT: ${feed} 已是 v${version}。请先 bump package.json 版本号再发版（同版本号重发客户端无感知）。`)
      process.exit(1)
    }
    console.log(`[check] ${feed} 线上版本=${matched ? matched[1] : '(空)'} → 本次发布 v${version}`)
  }

  // ── 2. 构建 ────────────────────────────────────────────────
  if (!execute) {
    console.log('[dry-run] 未加 --execute：仅预览产物清单，不构建不上传。')
    for (const target of targets) {
      for (const name of [...artifactsFor(target), feedFileFor(target)]) {
        console.log(`  ${fs.existsSync(path.join(rel, name)) ? '✓' : '✗ 缺（构建后产生）'} ${name}`)
      }
    }
    return
  }
  if (!skipBuild) {
    // electron-builder 只打包 dist/，不会自己编译：先发必须先重建 renderer+main，否则发出去的是旧 dist（2026-09-29 实测踩坑）
    console.log('[build] npm run build（vite + tsc main）…')
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' })
    if (targets.includes('mac')) {
      console.log('[build] mac dmg+zip …')
      execFileSync('npx', ['electron-builder', '--mac', '--publish', 'never'], { cwd: ROOT, stdio: 'inherit' })
    }
    if (targets.includes('win')) {
      console.log('[build] win nsis …')
      // macOS 交叉构建 win 在本机历史性地失败（electron.exe 重命名 ENOENT，1.0.11/1.0.14 的 exe 均产自 Windows 机器）；
      // 失败时降级为只发 mac 并显式告警，不让 win 阻断 mac 的更新分发
      try {
        execFileSync('npx', ['electron-builder', '--win', '--publish', 'never'], { cwd: ROOT, stdio: 'inherit' })
      } catch (error) {
        const idx = targets.indexOf('win')
        if (idx >= 0) targets.splice(idx, 1)
        console.error(`[warn] win 构建失败，本次仅发布 mac：${error instanceof Error ? error.message : error}`)
        if (targets.length === 0) {
          console.error('ABORT: 所有平台构建均失败。')
          process.exit(1)
        }
      }
    }
  }

  // ── 2.5 mac zip 重打包（根治项 E 配套）─────────────────────
  // electron-builder 产出的 zip 在 postdist 补签名之前打包 → 包内 app 未签名；
  // Squirrel 签名校验层与自托管安装器的完整性预期都要求签名包。签名完成后以 release/mac 的
  // 已签名 app 重打 zip，回写 latest-mac.yml 的 sha512/size，并移除 zip blockmap（差量基失效，回退全量下载）。
  if (targets.includes('mac')) {
    const signedApp = path.join(rel, 'mac', '砚都跨境.app')
    const zipName = `YanduCrossBorder-${version}-x64.zip`
    const zipPath = path.join(rel, zipName)
    if (fs.existsSync(signedApp) && fs.existsSync(zipPath)) {
      // publish 走 electron-builder 直调，不经过 postdist:mac 的补签名；这里幂等补 ad-hoc 签名后再重打
      console.log('[rezip] 补 ad-hoc 签名 …')
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', signedApp])
      console.log('[rezip] 以签名后 app 重打 mac zip …')
      execFileSync('ditto', ['-c', '-k', '--keepParent', signedApp, zipPath])
      fs.rmSync(path.join(rel, `${zipName}.blockmap`), { force: true })
      const buf = fs.readFileSync(zipPath)
      const sha512 = crypto.createHash('sha512').update(buf).digest('base64')
      const feedLocal = path.join(rel, 'latest-mac.yml')
      let yml = fs.readFileSync(feedLocal, 'utf8')
      const oldSha = yml.match(new RegExp(`url: ${zipName}\\n\\s*sha512: (\\S+)`))?.[1]
      if (!oldSha) {
        console.error(`ABORT: latest-mac.yml 找不到 ${zipName} 的 sha512 条目。`)
        process.exit(1)
      }
      yml = yml.split(oldSha).join(sha512)
      yml = yml.replace(new RegExp(`(url: ${zipName}\\n\\s*sha512: \\S+\\n\\s*size: )\\d+`), `$1${buf.length}`)
      yml = yml.replace(new RegExp(`\\s*- url: ${zipName}\\.blockmap\\n(\\s*sha512: \\S+\\n)?(\\s*size: \\d+\\n)?`), '')
      fs.writeFileSync(feedLocal, yml)
      console.log(`[rezip] 完成：sha512=${sha512.slice(0, 12)}… size=${buf.length}`)
    } else {
      console.error(`[warn] 缺少签名 app 或 zip（${signedApp} / ${zipPath}），跳过重打包；mac 自动更新可能因未签名被拒。`)
    }
  }

  // ── 3. 产物清单校验 ─────────────────────────────────────────
  const uploadPlan = []
  for (const target of targets) {
    const files = artifactsFor(target)
    const mainExt = target === 'mac' ? '.dmg' : '.exe'
    if (!files.some(name => name.endsWith(mainExt))) {
      console.error(`ABORT: release/ 缺少 ${target} 主安装包（v${version}）。先构建或检查 --skip-build 前提。`)
      process.exit(1)
    }
    if (target === 'mac' && !files.some(name => name.endsWith('.zip'))) {
      console.error('ABORT: release/ 缺少 mac zip（electron-updater 在 macOS 静默升级必需）。确认 electron-builder.yml mac target 含 zip 后重构建。')
      process.exit(1)
    }
    const feedLocal = path.join(rel, feedFileFor(target))
    if (!fs.existsSync(feedLocal)) {
      console.error(`ABORT: 缺少 ${feedFileFor(target)}（electron-builder 构建产物）。`)
      process.exit(1)
    }
    const feedText = fs.readFileSync(feedLocal, 'utf8')
    const feedVersion = feedText.match(/^version:\s*(\S+)/m)?.[1]
    if (feedVersion !== version) {
      console.error(`ABORT: ${feedFileFor(target)} 内版本=${feedVersion} 与 package.json=${version} 不一致（陈旧 feed 文件）。`)
      process.exit(1)
    }
    uploadPlan.push({ target, files: [...files, feedFileFor(target)] })
  }
  console.log('[plan] 待上传：')
  for (const group of uploadPlan) for (const name of group.files) console.log(`  - ${name}`)

  // ── 4. 上传（先安装包后 feed） ──────────────────────────────
  const remoteDir = `/tmp/rel-${version}`
  const allFiles = uploadPlan.flatMap(group => group.files)
  execFileSync(SSH[0], [...SSH.slice(1), `mkdir -p ${remoteDir}`], { stdio: 'inherit' })
  execFileSync('scp', ['-o', 'BatchMode=yes', ...allFiles.map(name => path.join(rel, name)), `root@114.55.149.192:${remoteDir}/`], { cwd: rel, stdio: 'inherit' })
  const ordered = [...allFiles.filter(name => !name.startsWith('latest')), ...allFiles.filter(name => name.startsWith('latest'))]
  for (const name of ordered) {
    console.log(`[upload] ${name}`)
    execFileSync(SSH[0], [...SSH.slice(1), `ossutil cp -f --acl public-read ${remoteDir}/${name} ${BUCKET}${name}`], { stdio: 'inherit' })
  }

  // ── 5. 回读验证 ─────────────────────────────────────────────
  for (const target of targets) {
    const feed = feedFileFor(target)
    const response = await fetch(FEED + feed, { signal: AbortSignal.timeout(15000) })
    const text = response.ok ? await response.text() : ''
    const live = text.match(/^version:\s*(\S+)/m)?.[1]
    if (live !== version) {
      console.error(`ABORT: 回读 ${feed} 版本=${live} ≠ ${version}（缓存或上传失败）。`)
      process.exit(1)
    }
    console.log(`[verify] ${feed} = v${live} ✓`)
  }
  console.log(`[done] v${version} 发布完成（${targets.join('+')}）。`)
})().catch(error => {
  console.error('[publish-release] 失败：', error instanceof Error ? error.message : error)
  process.exit(1)
})
