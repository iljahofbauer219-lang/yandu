import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')
}

describe('货盘删除权限接线', () => {
  it('主进程在删除货盘前强制校验 erp.warehouse.edit', () => {
    const source = readSource('src/main/main.ts')
    expect(source).toMatch(/ipcMain\.handle\('pallet:remove', async \(_event, ids: string\[\], accessToken: string\) => \{[\s\S]*?await requireInboundEditPermission\(accessToken\)[\s\S]*?database\.removePalletItems/)
  })

  it('preload 与渲染器传递 access token 并通过会话重试调用', () => {
    const preload = readSource('src/preload/preload.ts')
    const declarations = readSource('src/renderer/global.d.ts')
    const page = readSource('src/renderer/erp/PalletWarehousePage.tsx')

    expect(preload).toContain("remove: (ids: string[], accessToken: string): Promise<PalletWarehouseItem[]> => ipcRenderer.invoke('pallet:remove', ids, accessToken)")
    expect(declarations).toContain('remove(ids: string[], accessToken: string): Promise<PalletWarehouseItem[]>')
    expect(page).toMatch(/runWithSessionRetry\(token => window\.desktop\.pallet\.remove\(ids, token\)\)/)
  })

  it('无编辑权限时不渲染单件和批量删除入口', () => {
    const page = readSource('src/renderer/erp/PalletWarehousePage.tsx')
    expect(page).toMatch(/canEdit && <button className="danger"[\s\S]*?removeItems/)
    expect(page).toMatch(/canEdit && <button className="candidate-delete"[\s\S]*?removeItems/)
  })
})
