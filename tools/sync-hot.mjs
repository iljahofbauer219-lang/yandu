/**
 * 热更新同步：构建最新 main/renderer 产物并拷贝到 ~/yandu-hot，重启 App 即生效（bootloader 外置加载）。
 * 用法：npm run hot:sync（构建+同步+清除 disabled 标记）；npm run hot:off [--purge]（写 disabled 标记回退内置 / 删除整个 hot 目录）。
 * 边界：Electron 版本、原生依赖或 bootloader 自身变更仍需一次全量 dist:mac 打包；本脚本只覆盖日常业务代码。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOT = process.env.YANDU_HOT_DIR || path.join(os.homedir(), 'yandu-hot')
const args = process.argv.slice(2)

if (args.includes('--off')) {
  if (args.includes('--purge')) {
    fs.rmSync(HOT, { recursive: true, force: true })
    console.log(`[hot:off] 已删除 hot 目录 ${HOT}；重启 App 回退内置代码`)
  } else {
    fs.mkdirSync(HOT, { recursive: true })
    fs.writeFileSync(path.join(HOT, 'disabled'), new Date().toISOString())
    console.log(`[hot:off] 已写 disabled 标记 ${HOT}/disabled；重启 App 回退内置代码（hot:sync 可恢复）`)
  }
  process.exit(0)
}

const started = Date.now()
const build = spawnSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
if (build.status !== 0) {
  console.error('[hot:sync] 构建失败，未同步')
  process.exit(1)
}

// hot:sync 即启用：移除 disabled 标记后整目录替换，避免残留旧文件
fs.rmSync(path.join(HOT, 'disabled'), { force: true })
for (const dir of ['main-dist', 'renderer']) fs.rmSync(path.join(HOT, dir), { recursive: true, force: true })
fs.mkdirSync(HOT, { recursive: true })
fs.cpSync(path.join(root, 'dist', 'main'), path.join(HOT, 'main-dist'), { recursive: true })
fs.cpSync(path.join(root, 'dist', 'renderer'), path.join(HOT, 'renderer'), { recursive: true })
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
fs.writeFileSync(path.join(HOT, 'version.json'), JSON.stringify({ version: pkg.version, builtAt: new Date().toISOString() }, null, 2))
console.log(`[hot:sync] 完成，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s → ${HOT}；重启 App 生效`)
