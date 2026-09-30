/**
 * mac 自托管更新安装器沙箱验收（不触碰真实应用）：
 * 1) 正常路径：旧 bundle 备份为 .old-*、新 bundle 就位、日志含 OK；
 * 2)  zip 内无 .app：退出码 6 且原 bundle 不动。
 * 运行：node tools/verify-mac-install-update.cjs
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const SCRIPT = path.resolve(__dirname, '../resources/mac-updater/install-update.sh')
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-updater-verify-'))
let failures = 0
const assert = (name, cond) => { if (cond) console.log(`  ✔ ${name}`); else { failures += 1; console.error(`  ✘ ${name}`) } }

function makeApp(dir, name, marker) {
  const bin = path.join(dir, name, 'Contents', 'MacOS')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nexit 0\n')
  fs.writeFileSync(path.join(dir, name, 'Contents', 'MARKER'), marker)
}

// 正常路径
makeApp(work, 'Fake.app', 'OLD')
const stage = path.join(work, 'stage')
fs.mkdirSync(stage)
makeApp(stage, 'Fake.app', 'NEW')
const zip = path.join(work, 'fake.zip')
let r = spawnSync('ditto', ['-c', '-k', '--keepParent', path.join(stage, 'Fake.app'), zip], { encoding: 'utf8' })
if (r.status !== 0) { console.error('zip 制作失败', r.stderr); process.exit(1) }

const sleeper = spawnSync('sh', ['-c', 'sleep 0.2 & echo $!'], { encoding: 'utf8' })
const waitPid = sleeper.stdout.trim()

r = spawnSync('bash', [SCRIPT, zip, path.join(work, 'Fake.app'), waitPid, 'SKIP_LAUNCH'], { encoding: 'utf8' })
assert('正常路径退出码 0', r.status === 0)
const backups = fs.readdirSync(work).filter(name => name.startsWith('Fake.app.old-'))
assert('旧 bundle 备份为 .old-*', backups.length === 1)
assert('备份保留 OLD 标记', fs.readFileSync(path.join(work, backups[0], 'Contents', 'MARKER'), 'utf8') === 'OLD')
assert('新 bundle 就位且含 NEW 标记', fs.readFileSync(path.join(work, 'Fake.app', 'Contents', 'MARKER'), 'utf8') === 'NEW')
const log = fs.readFileSync(path.join(os.homedir(), 'Library/Logs/yandu-updater/install.log'), 'utf8')
assert('安装日志含 OK 行', log.includes('OK: installed'))

// 异常路径：zip 内无 .app
const badZip = path.join(work, 'bad.zip')
fs.writeFileSync(path.join(work, 'note.txt'), 'x')
r = spawnSync('ditto', ['-c', '-k', path.join(work, 'note.txt'), badZip], { encoding: 'utf8' })
makeApp(work, 'Keep.app', 'KEEP')
r = spawnSync('bash', [SCRIPT, badZip, path.join(work, 'Keep.app'), waitPid, 'SKIP_LAUNCH'], { encoding: 'utf8' })
assert('无 .app 的 zip 退出码 6', r.status === 6)
assert('失败时原 bundle 不动', fs.readFileSync(path.join(work, 'Keep.app', 'Contents', 'MARKER'), 'utf8') === 'KEEP')

fs.rmSync(work, { recursive: true, force: true })
console.log(`\n[verify-mac-install-update] 失败 ${failures} 项`)
process.exit(failures === 0 ? 0 : 1)
