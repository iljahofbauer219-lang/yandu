import { buildImageProductionTasks, cloneImageStylePreset, IMAGE_STYLE_CONTRACTS, IMAGE_STYLE_PRESETS, imageStyleTaskPrompt } from '../src/shared/imageProduction'

function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message)}
const ids=Object.keys(IMAGE_STYLE_PRESETS) as Array<keyof typeof IMAGE_STYLE_PRESETS>
assert(ids.length===4,'必须保留4套视觉模板')
assert(new Set(ids.map(id=>IMAGE_STYLE_PRESETS[id].presetName)).size===4,'4套模板名称必须唯一')
const markers=new Set<string>()
for(const id of ids){
  const preset=cloneImageStylePreset(id),contract=IMAGE_STYLE_CONTRACTS[id]
  assert(contract.requiredCues.length>=4,`${id}必须至少有4个必须特征`)
  assert(contract.forbiddenCues.length>=4,`${id}必须至少有4个禁止特征`)
  const tasks=buildImageProductionTasks({plan:'full',productName:'Test Product',sku:'STYLE-001',platform:'Ozon',language:'俄语',sourceContext:'confirmed facts',styleLock:preset})
  assert(tasks.every(task=>task.prompt.includes(`STYLE CONTRACT ${id}`)),`${id}合同必须进入全部任务`)
  assert(tasks.every(task=>contract.requiredCues.every(cue=>task.prompt.includes(cue))),`${id}全部必须特征应进入Prompt`)
  assert(tasks.every(task=>contract.forbiddenCues.every(cue=>task.prompt.includes(cue))),`${id}全部禁止特征应进入Prompt`)
  assert(tasks.find(task=>task.code==='H01')!.prompt.includes('TASK OVERRIDE FOR PLATFORM HERO'),`${id}平台首图必须使用收敛版规则`)
  markers.add(imageStyleTaskPrompt(preset,tasks.find(task=>task.code==='D06')!))
}
assert(markers.size===4,'4套任务级视觉合同必须实质不同')
console.log(JSON.stringify({presets:ids.map(id=>IMAGE_STYLE_PRESETS[id].presetName),requiredAndForbidden:true,taskAware:true,heroOverride:true,distinctContracts:markers.size},null,2))
