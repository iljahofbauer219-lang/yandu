const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

module.exports = async context => {
  if (context.electronPlatformName !== 'darwin') return
  const projectDir = context.packager.projectDir
  const resources = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
  const tools = path.join(resources, '.tools')
  fs.mkdirSync(tools, { recursive:true })
  for (const name of ['watch-skill','Resource2Skill','python-official-expanded-3119','python-watch-312']) {
    const source=path.join(projectDir,'.tools',name),destination=path.join(tools,name)
    if(!fs.existsSync(source))throw new Error(`Missing packaged runtime source: ${source}`)
    console.log(`[afterPack] copying ${name}`)
    fs.cpSync(source,destination,{recursive:true,dereference:false,filter:value=>!value.includes(`${path.sep}.git${path.sep}`)})
  }
  const links = [
    ['watch-skill/.venv/bin/python', '../../../python-watch-312/bin/python3.12'],
    ['watch-skill/.venv/bin/python3', '../../../python-watch-312/bin/python3.12'],
    ['watch-skill/.venv/bin/python3.12', '../../../python-watch-312/bin/python3.12'],
    ['Resource2Skill/.venv/bin/python', '../../../python-official-expanded-3119/Python_Framework.pkg/Payload/Versions/3.11/bin/python3.11'],
    ['Resource2Skill/.venv/bin/python3', '../../../python-official-expanded-3119/Python_Framework.pkg/Payload/Versions/3.11/bin/python3.11'],
    ['Resource2Skill/.venv/bin/python3.11', '../../../python-official-expanded-3119/Python_Framework.pkg/Payload/Versions/3.11/bin/python3.11'],
  ]
  for (const [relative, target] of links) {
    const link = path.join(tools, relative)
    fs.rmSync(link, { force:true })
    fs.symlinkSync(target, link)
  }
  const ocrBinary=path.join(tools,'watch-skill','vision-ocr')
  execFileSync('xcrun',['swiftc',path.join(projectDir,'src','main','advisor','vision-ocr.swift'),'-o',ocrBinary],{stdio:'inherit'})
  fs.chmodSync(ocrBinary,0o755)
  for(const required of ['watch-skill/.venv/bin/watch-skill','watch-skill/vision-ocr','Resource2Skill/cli.py','python-watch-312/bin/python3.12','python-official-expanded-3119/Python_Framework.pkg/Payload/Versions/3.11/bin/python3.11']){
    if(!fs.existsSync(path.join(tools,required)))throw new Error(`Packaged runtime missing after copy: ${required}`)
  }
  console.log('[afterPack] AI video runtimes copied and verified')
}
