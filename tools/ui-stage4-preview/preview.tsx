import React from 'react'
import ReactDOM from 'react-dom/client'
import '../../src/renderer/ui/tokens.css'
import '../../src/renderer/ui/components.css'
import '../../src/renderer/styles.css'
import '../../src/renderer/image-studio.css'
import '../../src/renderer/compliance.css'
import '../../src/renderer/compliance-v2.css'
import '../../src/renderer/theme-dark.css'
import '../../src/renderer/ui/phase4.css'
import './preview.css'

const areas = ['目录与仓库', '在线发布', '合规知识库', '在线顾问'] as const

function Preview() {
  const [dark, setDark] = React.useState(false)
  const [area, setArea] = React.useState<(typeof areas)[number]>('目录与仓库')
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : '' }, [dark])
  return <main className="stage4-preview">
    <header><div><h1>第四阶段 · 核心业务页验收</h1><p>统一令牌、最小字号、焦点与响应式检查</p></div><button onClick={() => setDark(v => !v)}>{dark ? '切换浅色' : '切换深色'}</button></header>
    <nav aria-label="验收区域">{areas.map(item => <button key={item} aria-current={area === item ? 'page' : undefined} onClick={() => setArea(item)}>{item}</button>)}</nav>
    {area === '目录与仓库' && <section className="catalog-manager"><div className="catalog-manager-heading"><div><small>PRODUCT CATALOG MANAGEMENT</small><h2>产品目录</h2><p>统一管理三级目录与供应仓商品</p></div><span>本地修改自动保存</span></div><div className="catalog-manager-columns"><section className="catalog-manage-column"><header><b>一级目录</b><button>＋ 新增</button></header><div><article className="active"><button className="catalog-row-main" aria-pressed="true"><b>家居与园艺</b><em>128</em></button><div><button>改名</button><button>移动</button><button>删除</button></div></article></div></section><section className="catalog-manage-column"><header><b>二级目录</b><button>＋ 新增</button></header><div><article><button className="catalog-row-main" aria-pressed="false"><b>家居收纳</b><em>36</em></button></article></div></section><section className="catalog-manage-column wide"><header><b>仓库商品</b><button>同步仓库</button></header><div><p>大健云仓 · 库存 320 · 最近同步 10 分钟前</p><button>查看商品</button></div></section></div></section>}
    {area === '在线发布' && <section className="publishing-page"><div className="publishing-top"><div><small>MARKETPLACE OPERATIONS</small><h2>Ozon 运营工作台</h2><p>选品、素材、店铺和发布记录独立管理</p></div><span>安全测试模式</span></div><div className="publishing-platform-tabs" role="tablist" aria-label="发布平台"><button role="tab" aria-selected="true"><b>Ozon</b><small>俄罗斯及独联体</small><em>已开通</em></button><button role="tab" aria-selected="false"><b>eBay</b><small>全球站点</small><em>待接入</em></button></div><div className="ozon-publish-subnav" role="tablist" aria-label="发布工作区"><button role="tab" aria-selected="true">平台选品库</button><button role="tab" aria-selected="false">发布中心</button><button role="tab" aria-selected="false">审核与异常</button></div><div className="platform-selection-library"><div className="platform-library-heading"><div><b>Ozon 平台选品库</b><small>供应仓与平台资料独立保存</small></div><span>已选 18 个</span></div><p>发布前必须人工确认；未授权时只保存本地草稿。</p><button>从供应仓导入</button></div></section>}
    {area === '合规知识库' && <section className="compliance-page"><header className="compliance-hero"><div><small>COMPLIANCE OPERATIONS CENTER</small><h1>合规知识库</h1><p>官方数据、规则版本、商品档案与发布许可闭环。</p></div></header><nav className="compliance-tabs" aria-label="合规中心栏目"><button aria-current="page">运营总览</button><button>商品档案</button><button>发布许可</button></nav><div className="compliance-alert success" role="status">规则同步完成并已重新检查。</div><div className="compliance-metrics"><article><small>已启用规则</small><b>246</b><span>进入检查引擎</span></article><article><small>待人工审核</small><b>8</b><span>未生效规则</span></article></div></section>}
    {area === '在线顾问' && <section className="advisor-sample"><header><b>砚都跨境在线顾问</b><small>已连接 · 工作区只读检查</small></header><aside><button aria-current="page">新对话</button><button>合规助手</button></aside><article><small>在线顾问</small><h2>今天要处理什么跨境任务？</h2><p>我可以协助分析商品、平台发布和合规风险。</p><textarea aria-label="输入顾问问题" placeholder="输入问题…"/><button>发送</button></article></section>}
  </main>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Preview />)
