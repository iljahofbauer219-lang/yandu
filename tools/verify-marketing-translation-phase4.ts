import { createDefaultImageLayout, protectedCommerceTokens, validateImageLayoutDraft, validateMarketingTranslation } from '../src/shared/imageProduction'

function assert(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message)}
const source=['加厚款 M码 33×45cm 50片','适用于宠物日常训练'],russian=['Утолщённые пелёнки, размер M, 33×45cm, 50 шт.','Для ежедневного приучения питомцев']
const tokens=protectedCommerceTokens(source)
assert(tokens.some(token=>token.includes('33')),'尺寸必须被识别为保护内容')
assert(tokens.some(token=>token.includes('50')),'数量必须被识别为保护内容')
assert(validateMarketingTranslation(source,russian,'俄语').length===0,'俄语译文保留数字与单位时必须通过')
assert(validateMarketingTranslation(source,['Утолщённые пелёнки','Для питомцев'],'俄语').some(issue=>issue.includes('受保护内容缺失')),'丢失规格必须被拦截')
assert(validateMarketingTranslation(source,['加厚款','Для питомцев'],'俄语').includes('俄语营销文案中仍包含中文'),'俄语营销文案残留中文必须被拦截')
const draft=createDefaultImageLayout({code:'D02',title:'需求与使用痛点',objective:'展示合理使用需求'}, {productName:'宠物垫'}, {enabled:true,presetId:'CLEAN_COMMERCE',presetName:'平台标准商品图',primaryColor:'#19B8B2',backgroundColor:'#F7F9F9',lighting:'test',composition:'test',mood:'test',typography:'test',version:2},'俄语')
assert(validateImageLayoutDraft(draft).some(issue=>issue.includes('尚未翻译')),'未翻译草稿必须阻止正式排版')
const translated={...draft,headline:'Потребности использования',subheadline:'Покажите реальный сценарий использования',translationStatus:'TRANSLATED' as const,translationIssues:[]}
assert(validateImageLayoutDraft(translated).length===0,'合格俄语排版草稿必须通过')
console.log(JSON.stringify({protectedTokens:tokens,missingTokenBlocked:true,chineseBlocked:true,untranslatedBlocked:true,russianDraftPassed:true},null,2))
