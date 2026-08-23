// 渲染层平台判定：支持 localStorage['qa.platform'] 覆盖，便于 macOS 上验收 Windows 式 UI
export function getUiPlatform(): string {
  try {
    const qa = localStorage.getItem('qa.platform')
    if (qa === 'win32' || qa === 'darwin') return qa
  } catch {
    // ignore
  }
  return window.desktop?.platform || 'darwin'
}
