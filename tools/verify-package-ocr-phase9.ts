import { applyPackageTextExtraction, normalizeImageProductFacts, validateImageProductFacts } from '../src/shared/imageProduction'
import type { ImagePackageTextExtractionResult } from '../src/shared/contracts'

const base=normalizeImageProductFacts({productName:'宠物训练垫',sku:'PAD-1',source:'真实图片',price:'',referenceImageUrl:'',confirmed:false})
const clean:ImagePackageTextExtractionResult={model:'qa',observations:[{sourceIndex:0,rawText:'M码 50片',fields:{specification:'M码',quantity:'50片'},confidence:95}],conflicts:[],combinedText:'图1：M码 50片',warnings:[],analyzedAt:new Date().toISOString()}
const pending=applyPackageTextExtraction(base,clean),pendingEntry=pending.entries?.find(entry=>entry.key==='packageText')
if(pendingEntry?.status!=='PENDING'||pendingEntry.source!=='OCR')throw new Error('无冲突OCR结果应进入待确认状态并保留OCR来源')

const conflict=applyPackageTextExtraction(base,{...clean,observations:[...clean.observations,{sourceIndex:1,rawText:'L码 40片',fields:{specification:'L码',quantity:'40片'},confidence:94}],conflicts:['specification','quantity'],combinedText:'图1：M码 50片\n图2：L码 40片'}),conflictEntry=conflict.entries?.find(entry=>entry.key==='packageText')
if(conflictEntry?.status!=='CONFLICT')throw new Error('跨图规格冲突必须标记为CONFLICT')
if(!validateImageProductFacts(conflict).some(issue=>issue.includes('包装原文存在冲突')))throw new Error('包装冲突必须阻止事实锁定')
console.log(JSON.stringify({cleanStatus:pendingEntry.status,conflictStatus:conflictEntry.status,conflictBlocked:true,source:pendingEntry.source},null,2))
