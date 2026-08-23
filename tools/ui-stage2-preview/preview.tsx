import React from 'react'
import ReactDOM from 'react-dom/client'
import { Button, Card, EmptyState, Field, LoadingState, Modal, Notice, StatusBadge } from '../../src/renderer/ui/primitives'
import '../../src/renderer/ui/tokens.css'
import '../../src/renderer/ui/components.css'
import './preview.css'

function Preview() {
  const [dark, setDark] = React.useState(false)
  const [modalOpen, setModalOpen] = React.useState(false)
  React.useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : '' }, [dark])
  return <main className="stage2-preview">
    <header><div><h1>砚都跨境基础组件</h1><p>第二阶段真实组件验收</p></div><Button onClick={() => setDark(value => !value)}>{dark ? '切换浅色' : '切换深色'}</Button></header>
    <Card className="preview-card"><h2>表单与操作</h2><Field label="商品标题" defaultValue="Jersey Display Frame" hint="最多 80 个字符"/><Field label="SKU" error="SKU 已存在，请更换后重试" aria-label="SKU"/><div className="actions"><Button variant="primary">保存商品</Button><Button>取消</Button><Button variant="danger">删除</Button><Button loading>生成中</Button></div></Card>
    <Card className="preview-card"><h2>状态与反馈</h2><div className="badges"><StatusBadge tone="success">✓ 已通过</StatusBadge><StatusBadge tone="warning">! 待复核</StatusBadge><StatusBadge tone="danger">× 已阻断</StatusBadge><StatusBadge tone="info">运行中</StatusBadge></div><Notice tone="success">商品资料已保存。</Notice><Notice tone="warning">还需补充合规文件。</Notice><Notice tone="danger" role="alert">发布被阻断，请修复错误。</Notice></Card>
    <Card className="preview-card"><h2>空状态与加载</h2><div className="state-grid"><EmptyState title="暂无待审核申请" description="新成员提交后会显示在这里。"/><LoadingState label="正在读取商品资料…"/></div></Card>
    <Button onClick={() => setModalOpen(true)}>打开验收对话框</Button>
    <Modal open={modalOpen} title="确认发布" description="发布前请确认商品资料。" onClose={() => setModalOpen(false)} footer={<><Button onClick={() => setModalOpen(false)}>取消</Button><Button variant="primary">确认发布</Button></>}><Notice tone="warning">此操作将创建平台草稿。</Notice></Modal>
  </main>
}

ReactDOM.createRoot(document.getElementById('root')!).render(<Preview/>)
