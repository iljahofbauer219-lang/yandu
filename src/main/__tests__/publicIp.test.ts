import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 顶栏 IP chip 出口接线守卫：原先只走 Node https 直连（不跟系统代理），
 * 在「代理在用、直连不通」的机器上芯片长期显示「未知」。改为先 Chromium net.request 后直连回落，
 * 顺序/超时/解析都在 shared/publicIpProbe，这里钉住 main 侧接线本身，防止两路之一被删或顺序被写死。
 */
const mainSource = readFileSync(path.join(__dirname, '..', 'main.ts'), 'utf8')

const slice = (source: string, start: string, end: string) => {
  const from = source.indexOf(start)
  expect(from, `锚点必须存在：${start}`).toBeGreaterThan(-1)
  const to = source.indexOf(end, from + start.length)
  return to === -1 ? source.slice(from) : source.slice(from, to)
}

const probeSource = slice(mainSource, '// 顶栏 IP chip', "ipcMain.handle('app:public-ip'")

describe('app:public-ip 双出口接线', () => {
  it('两条出口都在：Chromium net.request 跟随系统代理，https.get 直连保留为回落', () => {
    expect(probeSource).toContain('net.request(')
    expect(probeSource).toContain('https.get(')
  })

  it('遍历顺序取自 shared 常量，main 不另写一份顺序表', () => {
    expect(mainSource).toContain("from '../shared/publicIpProbe'")
    expect(probeSource).toContain('PUBLIC_IP_TRANSPORTS')
  })

  it('任一路拿到结果即返回，不多打一次直连', () => {
    expect(probeSource).toMatch(/if\s*\(\s*info\s*\)\s*return info/)
  })

  it('两路共用 shared 解析，main 内不再留第二份正则', () => {
    expect(probeSource).toContain('parsePublicIpBody(')
    expect(probeSource).not.toContain('当前 IP')
  })

  it('Chromium 路超时必须 abort，非 200 也回落直连', () => {
    expect(probeSource).toContain('request.abort()')
    expect(probeSource).toMatch(/statusCode\s*!==\s*200/)
  })

  it('每条出口的命中结果落日志，出口 IP 会漂移时靠它而非 IP 值判断走了哪条路', () => {
    expect(probeSource).toContain('[ip-probe]')
    expect(probeSource).toMatch(/console\.log\(`\[ip-probe\] \$\{transport\}/)
  })

  it('缓存与 IPC 口径不变：5 分钟 TTL、成功才写缓存、handler 仍走 fetchPublicIp', () => {
    const handler = slice(mainSource, "ipcMain.handle('app:public-ip'", '// 登录页「检查更新」按钮')
    expect(mainSource).toContain('const PUBLIC_IP_CACHE_TTL_MS = 5 * 60 * 1000')
    expect(handler).toContain('await fetchPublicIp()')
    expect(handler).toContain('if (result) {')
  })
})