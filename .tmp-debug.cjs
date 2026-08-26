const fs = require('fs')
const html = fs.readFileSync('/Users/zyc/Desktop/砚都跨境/.tmp-amz123-kd.html', 'utf-8')
const ulRe = /<ul[^>]+data-sdk-position="([^"]+)"[^>]*>([\s\S]*?)<\/ul>/g
let m
let count = 0
const regions = []
while ((m = ulRe.exec(html)) !== null) {
  count++
  regions.push(m[1])
}
console.log('总 ul 数:', count)
console.log('各 region:', regions)
