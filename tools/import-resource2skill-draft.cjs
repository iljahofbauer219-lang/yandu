const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')

const source = path.resolve(process.argv[2] || '')
if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw new Error(`SKILL.md 不存在: ${source}`)
const content = fs.readFileSync(source, 'utf8')
const name = (content.match(/^name:\s*(.+)$/m)?.[1] || path.basename(source, '.md')).trim()
if (!/^[\w-]+$/.test(name)) throw new Error(`Skill 名称不安全: ${name}`)
const userData = path.join(os.homedir(), 'Library/Application Support/cross-border-sourcing-desktop')
const libraryPath = path.join(userData, 'resource2skill-library.json')
const now = new Date().toISOString()
const id = `import-${crypto.createHash('sha1').update(source).digest('hex').slice(0, 12)}`
let items = []
try { items = JSON.parse(fs.readFileSync(libraryPath, 'utf8')) } catch {}
const existing = items.find(item => item.id === id)
const draft = {
  id,
  sourceTaskId: 'youtube:https://www.youtube.com/watch?v=sKFhK0z1aCw',
  name,
  content,
  createdAt: existing?.createdAt || now,
  updatedAt: now,
}
fs.mkdirSync(userData, { recursive: true })
const next = [draft, ...items.filter(item => item.id !== id && item.name !== name)].slice(0, 100)
const temp = `${libraryPath}.${process.pid}.tmp`
fs.writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600 })
fs.renameSync(temp, libraryPath)
const skillDir = path.join(userData, 'resource2skill-library', name)
fs.mkdirSync(skillDir, { recursive: true })
fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content, { mode: 0o600 })
console.log(JSON.stringify({ imported: true, id, name, libraryPath, skillPath: path.join(skillDir, 'SKILL.md') }, null, 2))
