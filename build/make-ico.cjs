// 由 512x512 PNG 生成多尺寸 icon.ico（仅依赖 Node 内置 zlib）
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

function crc32(buf) {
  let table = crc32.table
  if (!table) {
    table = crc32.table = new Int32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c
    }
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function makePng(size, rawRgba) {
  // rawRgba: size*size*4 bytes RGBA，需加 filter 字节 0
  const scan = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    scan[y * (size * 4 + 1)] = 0
    rawRgba.copy(scan, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6 // RGBA8
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(scan)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

// 解析源 PNG（无压缩 RGBA 直读：用 zlib inflate 全部 IDAT）
function parsePng(buf) {
  let pos = 8
  let width = 0, height = 0
  const idats = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4) }
    if (type === 'IDAT') idats.push(data)
    pos += 12 + len
  }
  const raw = zlib.inflateSync(Buffer.concat(idats))
  // 解 filter（支持 0-4 全部类型）
  const bpp = 4, stride = width * bpp
  const out = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
    const cur = out.subarray(y * stride, (y + 1) * stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0
      const b = prev ? prev[x] : 0
      const c = prev && x >= bpp ? prev[x - bpp] : 0
      let v = line[x]
      switch (f) {
        case 1: v = (v + a) & 0xff; break
        case 2: v = (v + b) & 0xff; break
        case 3: v = (v + ((a + b) >> 1)) & 0xff; break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
          v = (v + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
          break
        }
      }
      cur[x] = v
    }
  }
  return { width, height, rgba: out }
}

function resample(src, srcSize, dstSize) {
  // 简单双线性缩放
  const out = Buffer.alloc(dstSize * dstSize * 4)
  const scale = srcSize / dstSize
  for (let y = 0; y < dstSize; y++) {
    for (let x = 0; x < dstSize; x++) {
      const sx = Math.min(srcSize - 1, x * scale)
      const sy = Math.min(srcSize - 1, y * scale)
      const x0 = Math.floor(sx), y0 = Math.floor(sy)
      const x1 = Math.min(srcSize - 1, x0 + 1), y1 = Math.min(srcSize - 1, y0 + 1)
      const fx = sx - x0, fy = sy - y0
      for (let ch = 0; ch < 4; ch++) {
        const v00 = src.rgba[(y0 * srcSize + x0) * 4 + ch]
        const v01 = src.rgba[(y0 * srcSize + x1) * 4 + ch]
        const v10 = src.rgba[(y1 * srcSize + x0) * 4 + ch]
        const v11 = src.rgba[(y1 * srcSize + x1) * 4 + ch]
        const top = v00 + (v01 - v00) * fx
        const bot = v10 + (v11 - v10) * fx
        out[(y * dstSize + x) * 4 + ch] = Math.round(top + (bot - top) * fy)
      }
    }
  }
  return out
}

const srcPath = path.join(__dirname, 'icon.png')
const src = parsePng(fs.readFileSync(srcPath))
console.log(`源 PNG: ${src.width}x${src.height}`)

const sizes = [256, 64, 48, 32, 16]
const pngs = sizes.map(s => makePng(s, resample(src, src.width, s)))

// ICO 头
const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type = icon
header.writeUInt16LE(sizes.length, 4)
const entries = []
let offset = 6 + sizes.length * 16
for (let i = 0; i < sizes.length; i++) {
  const e = Buffer.alloc(16)
  e[0] = sizes[i] >= 256 ? 0 : sizes[i]
  e[1] = sizes[i] >= 256 ? 0 : sizes[i]
  e.writeUInt16LE(1, 4) // planes
  e.writeUInt16LE(32, 6) // bpp
  e.writeUInt32LE(pngs[i].length, 8)
  e.writeUInt32LE(offset, 12)
  offset += pngs[i].length
  entries.push(e)
}
const ico = Buffer.concat([header, ...entries, ...pngs])
const outPath = path.join(__dirname, 'icon.ico')
fs.writeFileSync(outPath, ico)
console.log(`已生成 ${outPath}（${ico.length} 字节，${sizes.join('/')}px）`)
