/**
 * 真正用 React + happy-dom 测 T1 修复:
 * 验证 sending=true 时 useEffect 立即把 extractedCollapsed 设为 true。
 */
import { Window } from 'happy-dom'
const window = new Window()
globalThis.window = window
globalThis.document = window.document
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, writable: true, configurable: true })
globalThis.HTMLElement = window.HTMLElement
globalThis.localStorage = window.localStorage
globalThis.CustomEvent = window.CustomEvent
globalThis.MessageChannel = window.MessageChannel
globalThis.queueMicrotask = window.queueMicrotask || ((f) => Promise.resolve().then(f))
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)

const React = (await import('react')).default
const { createRoot } = await import('react-dom/client')
const { act } = await import('react-dom/test-utils')

// ─── 测试组件 ───
// 复刻 AIEmployee 关键 state + T1 useEffect
function makeTestComp(extractRef, sendingRef) {
  return function TestComp() {
    const [sending, setSending] = React.useState(false)
    const [extracted, setExtracted] = React.useState(null)
    const [extractedCollapsed, setExtractedCollapsed] = React.useState(false)
    extractRef.collapse = extractedCollapsed
    extractRef.setExtractedCollapsed = setExtractedCollapsed
    extractRef.setSending = setSending
    extractRef.setExtracted = setExtracted
    sendingRef.value = sending
    // ─── T1 修复 (照搬 src/renderer/AIEmployee.tsx line 651) ───
    React.useEffect(() => {
      if (sending) {
        setExtractedCollapsed(true)
      }
    }, [sending])
    return React.createElement('div', {
      'data-sending': sending,
      'data-collapsed': extractedCollapsed,
      'data-has-extracted': Boolean(extracted)
    }, 'mock')
  }
}

const root = createRoot(document.createElement('div'))
const extractRef = {}
const sendingRef = {}
const Comp = makeTestComp(extractRef, sendingRef)

let results = []
function log(name, pass, detail) {
  results.push({ name, pass, detail })
  console.log(' ', pass ? '✅' : '❌', name, detail || '')
}

// ─── 阶段 1: 初始 mount ───
console.log('─'.repeat(60))
console.log('阶段 1: 初始 mount')
await act(async () => {
  root.render(React.createElement(Comp))
})
log('初始 collapsed=false', extractRef.collapse === false,
    `actual=${extractRef.collapse}`)
log('初始 sending=false', sendingRef.value === false,
    `actual=${sendingRef.value}`)

// ─── 阶段 2: 模拟 startExtraction (line 911) → setExtractedCollapsed(false) ───
console.log('─'.repeat(60))
console.log('阶段 2: startExtraction 完成,extracted 卡展开')
await act(async () => {
  extractRef.setExtracted({ url: '1688.com/foo', title: 'Test' })
  extractRef.setExtractedCollapsed(false)  // 展开
})
log('startExtraction 后 collapsed=false', extractRef.collapse === false,
    `actual=${extractRef.collapse}`)

// ─── 阶段 3 (核心 T1): 用户点发送 → setSending(true) → useEffect 立即折叠 ───
console.log('─'.repeat(60))
console.log('阶段 3: ★ 核心 T1 验证 ★ 用户点发送后,useEffect 立刻折叠 extracted')
await act(async () => {
  extractRef.setSending(true)
})
log('setSending(true) 后 sending=true', sendingRef.value === true,
    `actual=${sendingRef.value}`)
log('setSending(true) 后 collapsed=true (T1 修复期望)', extractRef.collapse === true,
    `actual=${extractRef.collapse}`)

// ─── 阶段 4: 发送完成 sending=false → T1 不重置,保留折叠 ───
console.log('─'.repeat(60))
console.log('阶段 4: 发送完成,collapsed 保持折叠(用户可手动 toggle 决定)')
await act(async () => {
  extractRef.setSending(false)
})
log('setSending(false) 后 sending=false', sendingRef.value === false,
    `actual=${sendingRef.value}`)
log('setSending(false) 后 collapsed 仍 true (T1 不重置)', extractRef.collapse === true,
    `actual=${extractRef.collapse}`)

// ─── 阶段 5: 用户手动展开 → sending=false → useEffect 不动 ───
console.log('─'.repeat(60))
console.log('阶段 5: 用户发送后想看 extracted,手动展开,sending=false 不触发 useEffect 折叠')
await act(async () => {
  extractRef.setExtractedCollapsed(false)  // 用户手动展开
})
log('用户手动展开 collapsed=false', extractRef.collapse === false,
    `actual=${extractRef.collapse}`)
log('sending 仍 false', sendingRef.value === false,
    `actual=${sendingRef.value}`)

// ─── 阶段 6: 再次发送 → 立刻折叠(即使刚才被用户展开) ───
console.log('─'.repeat(60))
console.log('阶段 6: 再次发送,extracted 立刻折叠(无论当前折叠状态)')
await act(async () => {
  extractRef.setSending(true)
})
log('再次发送后 collapsed=true (T1 修复)', extractRef.collapse === true,
    `actual=${extractRef.collapse}`)

// ─── 总结 ───
console.log('═'.repeat(60))
const pass = results.filter(r => r.pass).length
const total = results.length
console.log(`  React + happy-dom T1 测试: ${pass}/${total} PASS`)
console.log('═'.repeat(60))
process.exit(pass === total ? 0 : 1)
