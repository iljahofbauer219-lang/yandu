export function shouldAutoEnterGigaLogin(page: string, activeWarehouse: string): boolean {
  return page === 'tasks' && activeWarehouse === 'GIGACLOUD'
}

export function shouldActivateSupplyView(hasLiveView: boolean, currentSupplyPlatformCode: string): boolean {
  return !hasLiveView || currentSupplyPlatformCode !== 'GIGACLOUD'
}
