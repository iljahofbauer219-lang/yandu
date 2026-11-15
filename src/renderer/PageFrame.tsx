import { createContext, ReactNode, useContext } from 'react'
import { createPortal } from 'react-dom'
import { pageFrameClassName } from './pageKeepAlive'

/**
 * 栏目保活容器：切走只隐藏，不卸载，页面内的页签、选中项、滚动位置和进行中任务都原样保留。
 * 可见态用 display:contents 对布局完全透明，隐藏态整棵子树脱离渲染。
 */
export function PageFrame({ show, children }: { show: boolean; children: ReactNode }) {
  return <PageVisibilityContext.Provider value={show}><div className={pageFrameClassName(show)}>{children}</div></PageVisibilityContext.Provider>
}

// 栏目是否可见：脱离保活容器（App 级弹窗、登录门等）的旧代码按可见处理，默认值即 true。
export const PageVisibilityContext = createContext(true)

// 栏目内挂到 document.body 的模态：隐藏栏目只藏得住自己的子树，藏不住 body 上的门户，
// 故随可见性一起卸载；切回栏目时弹窗状态还在，会原样重新出现。
export function PagePortal({ children }: { children: ReactNode }) {
  const visible = useContext(PageVisibilityContext)
  return visible ? createPortal(<>{children}</>, document.body) : null
}
