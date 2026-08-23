import fs from 'node:fs'
import path from 'node:path'
import { EbayImageGroundingService } from '../src/main/services/EbayImageGroundingService'

function loadEnv(file:string){if(!fs.existsSync(file))return;for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){const match=line.match(/^([A-Z0-9_]+)=(.*)$/);if(match&&!process.env[match[1]])process.env[match[1]]=match[2].trim().replace(/^(['"])(.*)\1$/,'$2')}}
loadEnv(path.resolve('.env.local'))
const key=process.env.BAILIAN_API_KEY||''
if(!key)throw new Error('真实OCR验收需要 BAILIAN_API_KEY')
const dir='/Users/zyc/Desktop/ 朱云初/codex/codex学习/参考图片/1',names=['IMG_1172.JPG','IMG_1173.JPG','IMG_1174.JPG','IMG_1175.JPG','IMG_1180.JPG','IMG_1198.JPG','IMG_1200.JPG']
const sourceImages=names.map(name=>`data:image/jpeg;base64,${fs.readFileSync(path.join(dir,name)).toString('base64')}`)
const service=new EbayImageGroundingService(key,process.env.BAILIAN_BASE_URL||'https://dashscope.aliyuncs.com/compatible-mode/v1',process.env.BAILIAN_VISION_MODEL||'qwen3.6-flash')
async function main(){const result=await service.extractPackageText({sourceImages,sourceLabels:names});const output=path.resolve('output/production-acceptance-phase9/package-ocr-real.json');fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,output},null,2))}
void main().catch(error=>{console.error(error);process.exit(1)})
