const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const crypto = require('node:crypto')
const { execFileSync } = require('node:child_process')

const videoPath = path.resolve(process.argv[2] || '')
const reportPath = path.resolve(process.argv[3] || '')
for (const file of [videoPath, reportPath]) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new Error(`文件不存在: ${file}`)
}
let report = fs.readFileSync(reportPath, 'utf8')
if (!report.includes('## Transcript') || !report.includes('29:13')) throw new Error('Watch Skill 报告验证失败')
const id = `youtube-${crypto.createHash('sha1').update(videoPath).digest('hex').slice(0, 12)}`
const frameDir = process.argv[4] ? path.resolve(process.argv[4]) : ''
const framePaths = frameDir && fs.existsSync(frameDir) ? fs.readdirSync(frameDir).filter(name=>name.endsWith('.jpg')).sort().map(name=>path.join(frameDir,name)) : []
const ocrBinary = path.resolve('.tools/watch-skill/vision-ocr')
const ocrLines = []
if(fs.existsSync(ocrBinary))for(const frame of framePaths){try{const value=JSON.parse(execFileSync(ocrBinary,[frame],{encoding:'utf8'}));const texts=(value.blocks||[]).map(block=>block.text).filter(Boolean);if(texts.length)ocrLines.push(`- ${path.basename(frame)}: ${texts.join(' | ')}`)}catch{}}
if(ocrLines.length&&!report.includes('## Frame OCR'))report+=`\n\n## Frame OCR\n\n${ocrLines.join('\n')}\n`
const userData = path.join(os.homedir(), 'Library/Application Support/cross-border-sourcing-desktop')
const tasksPath = path.join(userData, 'watch-skill-tasks.json')
let tasks = []
try { tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8')) } catch {}
const existing = tasks.find(task => task.id === id)
const task = {
  id,
  videoPath,
  createdAt: existing?.createdAt || new Date().toISOString(),
  status: 'COMPLETED',
  report,
  framePaths,
}
fs.mkdirSync(userData, { recursive:true })
const temp = `${tasksPath}.${process.pid}.tmp`
fs.writeFileSync(temp, JSON.stringify([task, ...tasks.filter(item => item.id !== id)].slice(0, 20), null, 2), { mode:0o600 })
fs.renameSync(temp, tasksPath)
console.log(JSON.stringify({ imported:true, id, videoPath, reportLength:report.length, frameCount:framePaths.length, ocrLineCount:ocrLines.length, tasksPath }, null, 2))
