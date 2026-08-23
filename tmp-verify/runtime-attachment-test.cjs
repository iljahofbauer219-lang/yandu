// Electron 主进程入口：AI员工附件管线运行时验证（monkey-patch dialog 绕过原生文件框）
const { app, dialog, nativeImage } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')
const iconv = require('iconv-lite')

const ROOT = '/Users/zyc/Desktop/砚都跨境'
const results = []
const check = (name, cond, detail) => results.push({ name, pass: !!cond, ...(detail !== undefined ? { detail } : {}) })

app.whenReady().then(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yd-att-'))

  // 文档样本
  fs.writeFileSync(path.join(dir, 'a.txt'), '产品规格阿尔法')
  fs.writeFileSync(path.join(dir, 'b.txt'), iconv.encode('中文编码测试产品描述', 'gbk'))
  fs.writeFileSync(path.join(dir, 'c.md'), '长'.repeat(15000)) // 15000 字符 > 12000 截断线

  // 不透明小图（无需缩放 → 按 Spec 原样透传 PNG）
  const w = 16, h = 16
  const bm = Buffer.alloc(w * h * 4)
  for (let i = 0; i < bm.length; i += 4) { bm[i] = 255; bm[i + 1] = 0; bm[i + 2] = 0; bm[i + 3] = 255 }
  fs.writeFileSync(path.join(dir, 't.png'), nativeImage.createFromBitmap(bm, { width: w, height: h }).toPNG())

  // 半透明大图 2000x1000（alpha=128 红色）→ 触发缩放至最长边 1280 + 白底合成 + JPEG 重编码
  const bw = 2000, bh = 1000
  const big = Buffer.alloc(bw * bh * 4)
  for (let i = 0; i < big.length; i += 4) { big[i] = 255; big[i + 1] = 0; big[i + 2] = 0; big[i + 3] = 128 }
  fs.writeFileSync(path.join(dir, 'big.png'), nativeImage.createFromBitmap(big, { width: bw, height: bh }).toPNG())

  // 5 张不透明小图（连同 t/big 共 7 张图 → 限额 4，应跳过 3）
  const smallPaths = []
  for (let k = 0; k < 5; k++) {
    const s = Buffer.alloc(8 * 8 * 4)
    for (let i = 0; i < s.length; i += 4) { s[i] = k * 40; s[i + 1] = 60; s[i + 2] = 90; s[i + 3] = 255 }
    const p = path.join(dir, `img${k}.png`)
    fs.writeFileSync(p, nativeImage.createFromBitmap(s, { width: 8, height: 8 }).toPNG())
    smallPaths.push(p)
  }

  dialog.showOpenDialog = async () => ({
    canceled: false,
    filePaths: [
      path.join(dir, 'a.txt'), path.join(dir, 'b.txt'), path.join(dir, 'c.md'),
      path.join(dir, 't.png'), path.join(dir, 'big.png'),
      ...smallPaths
    ]
  })

  const { AiEmployeeChatService } = require(path.join(ROOT, 'dist/main/main/services/AiEmployeeChatService.js'))
  const svc = new AiEmployeeChatService()
  const res = await svc.pickAttachments()

  const byName = n => res.attachments.find(a => a.name === n)
  check('pick ok=true', res.ok === true)

  const a = byName('a.txt')
  check('utf8 txt 提取正确', a && a.text === '产品规格阿尔法')
  const b = byName('b.txt')
  check('gbk txt 解码正确', b && b.text === '中文编码测试产品描述')
  const c = byName('c.md')
  check('md 截断 12000 + truncated 标记', c && c.text.length === 12000 && c.truncated === true, c && c.text.length)

  const t = byName('t.png')
  check('小图无需缩放 → PNG 原样透传', t && t.mimeType === 'image/png' && t.dataUrl.startsWith('data:image/png;base64,'))
  check('透传图 size=原始文件字节数', t && t.size === Buffer.byteLength('x') * 0 + fs.statSync(path.join(dir, 't.png')).size)

  const bigA = byName('big.png')
  if (bigA) {
    check('缩放后重编码为 JPEG', bigA.mimeType === 'image/jpeg' && bigA.dataUrl.startsWith('data:image/jpeg;base64,'))
    check('压缩后 size=实际字节数', bigA.size === Buffer.from(bigA.dataUrl.split(',')[1], 'base64').length)
    const dec = nativeImage.createFromDataURL(bigA.dataUrl)
    const sz = dec.getSize()
    check('大图缩放最长边=1280', Math.max(sz.width, sz.height) === 1280, JSON.stringify(sz))
    // 白底合成验证：toBitmap 返回 RGBA；半透明红 over 白 → 直色约 R=255、G=B≈127。
    // 若为黑底则 G=B≈0；只要 G 明显非零且 R 高即证明非黑底。
    const px = dec.toBitmap()
    const r = px[0], g = px[1], b = px[2] // RGBA
    check('透明图白底合成（非黑底）', r > 150 && g > 100 && b > 100, `RGB=(${r},${g},${b})`)
  } else {
    check('大图缩放最长边=1280', false, 'missing big.png')
  }

  const imgs = res.attachments.filter(x => x.kind === 'image')
  check('图片数量上限 4 生效', imgs.length === 4, `actual=${imgs.length}`)
  const docs = res.attachments.filter(x => x.kind === 'doc')
  check('文档 3 个全部接受', docs.length === 3, `actual=${docs.length}`)
  check('跳过提示含超限原因', /超出大小\/数量限制/.test(res.message || ''), res.message)

  console.log('ATTACHMENT_RUNTIME_RESULTS ' + JSON.stringify(results))
  const allPass = results.every(r => r.pass)
  console.log(allPass ? 'ALL_RUNTIME_CHECKS_PASSED' : 'RUNTIME_CHECKS_FAILED')
  app.exit(allPass ? 0 : 1)
}).catch(err => {
  console.error('FATAL', err)
  app.exit(1)
})
