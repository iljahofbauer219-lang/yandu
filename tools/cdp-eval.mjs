// Evaluate an async expression in the running Electron renderer via CDP (no focus needed).
// Usage: node tools/cdp-eval.mjs <expressionFile> [--timeout ms]
import { readFileSync } from 'node:fs'

const port = process.env.CDP_PORT || '9225'
const file = process.argv[2]
const timeoutArg = process.argv.indexOf('--timeout')
const timeout = timeoutArg > -1 ? Number(process.argv[timeoutArg + 1]) : 180000
if (!file) { console.error('usage: node tools/cdp-eval.mjs <expressionFile> [--timeout ms]'); process.exit(2) }

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = list.find(t => t.type === 'page' && /yandu-hot\/renderer|index\.html/.test(t.url))
if (!page) { console.error('renderer page target not found'); process.exit(1) }

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('ws connect failed')) })

let id = 0
const pending = new Map()
ws.onmessage = event => {
  const msg = JSON.parse(event.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
}
const send = (method, params) => new Promise(resolve => {
  const next = ++id
  pending.set(next, resolve)
  ws.send(JSON.stringify({ id: next, method, params }))
})

await send('Runtime.enable')
const expression = readFileSync(file, 'utf8')
const result = await Promise.race([
  send('Runtime.evaluate', { expression: `(async()=>{${expression}})()`, awaitPromise: true, returnByValue: true }),
  new Promise(resolve => setTimeout(() => resolve({ error: { message: `timeout after ${timeout}ms` } }), timeout))
])
ws.close()

if (result.error) { console.error('CDP error:', JSON.stringify(result.error)); process.exit(1) }
const payload = result.result || {}
if (payload.exceptionDetails) {
  console.error('PAGE EXCEPTION:', payload.exceptionDetails.exception?.description || JSON.stringify(payload.exceptionDetails))
  process.exit(1)
}
const value = payload.result?.value
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2))
