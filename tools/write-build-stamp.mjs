import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(process.cwd())
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const stamp = { version: pkg.version, builtAt: new Date().toISOString() }
fs.mkdirSync(path.join(root, 'dist'), { recursive: true })
fs.writeFileSync(path.join(root, 'dist', 'build-stamp.json'), JSON.stringify(stamp, null, 2))
console.log('[build-stamp]', stamp.version, stamp.builtAt)
