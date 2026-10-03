import fs from 'node:fs'
import path from 'node:path'

export function resolveMacUpdaterZipPath(cacheDir: string): string | null {
  const pendingDir = path.join(cacheDir, 'pending')
  const updateInfoPath = path.join(pendingDir, 'update-info.json')
  if (fs.existsSync(updateInfoPath)) {
    try {
      const info = JSON.parse(fs.readFileSync(updateInfoPath, 'utf8')) as { fileName?: unknown }
      if (typeof info.fileName === 'string' && path.basename(info.fileName) === info.fileName && info.fileName.endsWith('.zip')) {
        const pendingZip = path.join(pendingDir, info.fileName)
        if (fs.existsSync(pendingZip)) return pendingZip
      }
    } catch {}
  }

  const direct = path.join(cacheDir, 'update.zip')
  return fs.existsSync(direct) ? direct : null
}
