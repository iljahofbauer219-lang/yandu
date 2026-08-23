import assert from 'node:assert/strict'
import { importProductUrl, validatePublicProductUrl } from '../src/main/services/ImageSourceService'

async function main() {
  await assert.rejects(() => validatePublicProductUrl('file:///tmp/product.png'), /http/)
  await assert.rejects(() => validatePublicProductUrl('http://127.0.0.1/product.png'), /内网/)
  await assert.rejects(() => validatePublicProductUrl('http://localhost/product.png'), /内网/)

  const direct = await importProductUrl('https://httpbin.org/image/png')
  assert.equal(direct.sourceKind, 'URL')
  assert.equal(direct.images.length, 1)
  assert.match(direct.imageUrl, /^data:image\/png;base64,/)
  assert.equal(direct.images[0].mimeType, 'image/png')

  const webpage = await importProductUrl('https://ogp.me/')
  assert.equal(webpage.sourceLabel, '产品网址')
  assert.ok(webpage.title.length > 0)
  assert.ok(webpage.images.length >= 1)
  assert.ok((webpage.evidence?.length || 0) >= 2)

  const alibaba=await importProductUrl('https://detail.1688.com/offer/677442502491.html')
  assert.equal(alibaba.productId,'677442502491')
  assert.match(alibaba.title,/宠物尿垫/)
  assert.ok(alibaba.images.length>=5)

  console.log(JSON.stringify({ blockedFileProtocol:true, blockedLoopback:true, directImage:true, mimeType:direct.images[0].mimeType, webpage:{title:webpage.title,images:webpage.images.length,evidence:webpage.evidence?.length||0},alibaba1688:{productId:alibaba.productId,title:alibaba.title,images:alibaba.images.length} }, null, 2))
}

void main().catch(error=>{console.error(error);process.exitCode=1})
