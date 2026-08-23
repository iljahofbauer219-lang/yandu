import React from 'react'
import ReactDOM from 'react-dom/client'
import EbayImageStagePanel from '../../src/renderer/EbayImageStagePanel'
import '../../src/renderer/ui/tokens.css'
import '../../src/renderer/ui/components.css'
import '../../src/renderer/styles.css'
import '../../src/renderer/ebay-image-stage-panel.css'
import '../../src/renderer/theme-dark.css'
import './preview.css'

const image = (label: string, color: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><rect width="600" height="600" fill="${color}"/><rect x="120" y="145" width="360" height="310" rx="28" fill="white" stroke="#567" stroke-width="8"/><text x="300" y="315" text-anchor="middle" font-family="sans-serif" font-size="38" fill="#234">${label}</text></svg>`)}`

function Preview() {
  const [dark, setDark] = React.useState(false)
  React.useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : ''
  }, [dark])

  return <main className="stage3-preview">
    <header>
      <div><h1>eBay AI 优化 · 图片生成试点</h1><p>真实组件与生产样式验收页</p></div>
      <button className="yd-button" type="button" onClick={() => setDark(value => !value)}>{dark ? '切换浅色' : '切换深色'}</button>
    </header>
    <EbayImageStagePanel
      sourceImages={[image('原主图', '#e1f8f6'), image('侧面图', '#eff6ff'), image('细节图', '#fff7e4')]}
      sourceLabels={['原主图', '侧面', '材质细节']}
      title="Jersey Display Frame Case UV-Resistant Sports"
      description="Wall mounted display frame with clear viewing panel."
      itemSpecifics={[{ name: 'Material', value: 'Wood and acrylic' }]}
      imageModels={[{ id: 'preview-model', name: '预览模型', description: '主图与场景生成', strengths: '主图 白底 保真 场景' }]}
      externalBusy=""
      onAllStagesConfirmed={() => undefined}
      onNaturalizeComplete={() => undefined}
    />
  </main>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Preview />)
