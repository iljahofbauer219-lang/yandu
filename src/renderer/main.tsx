import React, { Component, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import { SessionGate } from './SessionGate'
import './ui/tokens.css'
import './ui/components.css'
import './styles.css'
import './image-studio.css'
import './compliance.css'
import './compliance-v2.css'
import './compliance-v2-review.css'
import './compliance-gate.css'
import './compliance-phase3.css'
import './compliance-stage8.css'
import './ebay-acceptance-readable.css'
import './ui-readability.css'
import './theme-dark.css'
import './ui/migrations.css'
import './ui/phase4.css'

class RootRenderBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error) { console.error('[renderer] root render failed', error) }
  render() {
    if (!this.state.failed) return this.props.children
    return <main style={{ display: 'grid', minHeight: '100vh', placeItems: 'center', padding: 32, color: '#253433', fontFamily: 'system-ui' }}>
      <section style={{ maxWidth: 560, padding: 28, border: '1px solid #d6dfde', borderRadius: 16, background: '#fff' }}>
        <h2 style={{ marginTop: 0 }}>页面未能加载</h2>
        <p>已阻止界面白屏。请点击“重新加载”；若问题再次出现，系统会保留错误信息用于修复。</p>
        <button type="button" onClick={() => location.reload()}>重新加载</button>
      </section>
    </main>
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><RootRenderBoundary><SessionGate /></RootRenderBoundary></React.StrictMode>
)
