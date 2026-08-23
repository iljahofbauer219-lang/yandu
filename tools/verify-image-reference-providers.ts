import assert from 'node:assert/strict'
import { VolcImageService } from '../src/main/services/VolcImageService'

async function main(){
  const originalFetch=globalThis.fetch
  let requestBody:Record<string,unknown>={}
  globalThis.fetch=async(_input,init)=>{
    requestBody=JSON.parse(String(init?.body||'{}')) as Record<string,unknown>
    return new Response(JSON.stringify({data:[{url:'https://example.test/generated.png'}]}),{status:200,headers:{'content-type':'application/json'}})
  }
  try{
    const dataUrl='data:image/png;base64,iVBORw0KGgo='
    const service=new VolcImageService('qa-key','https://example.test/api/v3')
    const result=await service.generate({model:'doubao-seedream-5-0-pro-260628',prompt:'test',referenceImageUrls:[dataUrl,'https://example.test/reference.png'],size:'1K',count:1})
    assert.deepEqual(requestBody.image,[dataUrl,'https://example.test/reference.png'])
    assert.equal(result.imageUrls[0],'https://example.test/generated.png')
    console.log(JSON.stringify({dataUrlForwarded:true,httpUrlForwarded:true,referenceCount:(requestBody.image as string[]).length},null,2))
  }finally{globalThis.fetch=originalFetch}
}
void main().catch(error=>{console.error(error);process.exitCode=1})
