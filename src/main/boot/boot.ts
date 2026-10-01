/**
 * 热更新 bootloader：asar 主进程唯一入口（package.json main 指向本文件编译产物）。
 * 启动时优先加载外置热更新目录 ~/yandu-hot/main-dist 下的最新主进程构建；不存在则回退 asar 内置代码。
 * 本文件极薄且不参与日常开发：bootloader 自身、Electron 版本或原生依赖变更仍需一次全量 dist:mac 打包。
 */
import fs from 'node:fs'
import path from 'node:path'
import nodeModule, { createRequire } from 'node:module'
import { hotFile, hotRoot } from '../hotPaths'

const externalMain = hotFile('main-dist', 'main', 'main.js')

if (externalMain) {
  // 外置代码的第三方包解析回退：外部目录找不到时，锚定内置 main.js 做标准解析
  //（dev 形态锚定仓库 node_modules，打包形态锚定 asar 内扁平 node_modules；
  //  相对路径模块基于外部目录自身解析，整目录拷贝保证完整；electron / node: 内建不受影响）
  const builtinResolve = createRequire(path.resolve(__dirname, '../main.js')).resolve
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ModuleInternal = nodeModule as any
  const originalResolve = ModuleInternal._resolveFilename
  ModuleInternal._resolveFilename = function (request: string, ...args: unknown[]) {
    try {
      return originalResolve.call(this, request, ...args)
    } catch (error) {
      const isRelativeOrBuiltin = typeof request === 'string' && (request.startsWith('.') || path.isAbsolute(request) || request.startsWith('node:'))
      if (isRelativeOrBuiltin) throw error
      return builtinResolve(request)
    }
  }
  let builtAt = 'unknown'
  try {
    builtAt = String(JSON.parse(fs.readFileSync(path.join(hotRoot(), 'version.json'), 'utf8')).builtAt ?? 'unknown')
  } catch { /* version.json 缺失不阻断启动 */ }
  console.log(`[hot] external build loaded: ${externalMain} (builtAt ${builtAt})`)
  require(externalMain)
} else {
  console.log('[hot] builtin build loaded')
  require('../main.js')
}
