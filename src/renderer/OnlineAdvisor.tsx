import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import OnlineAdvisorExperience from './OnlineAdvisorExperience'
import experienceStyles from './online-advisor-experience.css?inline'
import './online-advisor.css'

export default function OnlineAdvisor() {
  const hostRef = useRef<HTMLDivElement>(null)
  const [mountPoint, setMountPoint] = useState<ShadowRoot | null>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const root = host.shadowRoot ?? host.attachShadow({ mode: 'open' })
    if (!root.querySelector('style[data-online-advisor]')) {
      const style = document.createElement('style')
      style.dataset.onlineAdvisor = 'true'
      style.textContent = experienceStyles
      root.appendChild(style)
    }
    const syncTheme = () => {
      host.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
    }
    syncTheme()
    const themeObserver = new MutationObserver(syncTheme)
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    setMountPoint(root)
    return () => themeObserver.disconnect()
  }, [])

  return (
    <div ref={hostRef} className="online-advisor-host">
      {mountPoint ? createPortal(<OnlineAdvisorExperience />, mountPoint) : null}
    </div>
  )
}
