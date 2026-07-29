import type { EbayImageVisualInspectionReport, EbayImageVisualRuleCode, EbayLocalProductMedia } from '../shared/contracts'
import { useState } from 'react'

type Props={
  media:EbayLocalProductMedia[]
  report:EbayImageVisualInspectionReport|null
  running:boolean
  onReview?:(mediaId:string,rule:EbayImageVisualRuleCode,decision:'PASSED'|'FAILED')=>void
  curations?:Record<string,{enabled:boolean;role:string}>
  roleOptions?:{value:string;label:string}[]
  selectedReferenceUrl?:string
  onRoleChange?:(url:string,role:string)=>void
  onToggleEnabled?:(url:string,nextEnabled:boolean)=>void
  onSelectReference?:(url:string)=>void
}

const statusLabel={PASSED:'通过',FAILED:'需修改',REVIEW:'人工复核'} as const

export function EbayVisualCompliancePanel({media,report,running,onReview=()=>undefined,curations,roleOptions,selectedReferenceUrl,onRoleChange,onToggleEnabled,onSelectReference}:Props) {
  const [expandedIds,setExpandedIds]=useState(new Set<string>())
  const [resultsOpen,setResultsOpen]=useState(false)
  const toggle=(id:string)=>setExpandedIds(prev=>{const next=new Set(prev);next.has(id)?next.delete(id):next.add(id);return next})
  const mediaById=new Map(media.map(item=>[item.id,item]))
  const totalCount=report?.images.length??0
  const expandedCount=expandedIds.size
  return <section className="ebay-visual-compliance">
    <header>
      <div><b>图片视觉规则检查</b><small>仅检查商品一致性、额外边框、附加文字/营销图形和水印；不评价美观与转化率。</small></div>
      <span className={`ebay-visual-auto-status ${running?'checking':report?'checked':'pending'}`}><b>{running?'正在自动检查图片…':report?'✓ 已自动检查图片':'等待自动检查'}</b><small>{report?new Date(report.checkedAt).toLocaleString('zh-CN'):!media.length?'尚未读取原商品图片':'读取本地快照后自动执行'}</small></span>
    </header>
    {!report&&<div className="ebay-visual-empty">系统会在读取本地商品快照后自动逐图检查。无法可靠判断的图片会进入人工复核，不会自动标记为通过。</div>}
    {report&&<>
      <div className={`ebay-visual-summary ${report.status.toLowerCase()}`}><b>{report.message}</b><span>已检查 {report.checkedImageCount} 张 · 通过 {report.passed} · 需修改 {report.failed} · 人工复核 {report.review} · {new Date(report.checkedAt).toLocaleString('zh-CN')}</span></div>
      {totalCount>0?<div className="ebay-visual-collapse"><button type="button" className="ebay-visual-collapse-btn" aria-expanded={resultsOpen} onClick={()=>setResultsOpen(open=>!open)}>{resultsOpen?'收起图片检查结果 ▴':`展开 ${totalCount} 张图片检查结果 ▾`}</button><small>{resultsOpen?'可逐张查看规则证据与人工复核':'默认收起逐张证据，需要时再展开'}</small></div>:null}
      {resultsOpen&&totalCount>0?<div className="ebay-visual-fold-toggle"><button type="button" onClick={()=>setExpandedIds(new Set(expandedCount<totalCount?report.images.map(i=>i.mediaId):[]))}>{expandedCount<totalCount?'展开全部图片详情':'收起全部图片详情'}</button><small>{expandedCount}/{totalCount} 张已展开</small></div>:null}
      {resultsOpen&&<div className="ebay-visual-results">{report.images.map(image=>{
        const source=mediaById.get(image.mediaId)
        const remoteUrl=source?.remoteUrl||''
        const curation=remoteUrl?curations?.[remoteUrl]:undefined
        return <article key={image.mediaId} className={image.status.toLowerCase()}>
          <div className="ebay-visual-image">{source?.remoteUrl?<img src={source.remoteUrl} alt={`第 ${image.sortOrder+1} 张商品图片`}/>:<span>图片 {image.sortOrder+1}</span>}<em>{statusLabel[image.status]}</em></div>
          <div><button type="button" className="ebay-visual-expand-btn" onClick={()=>toggle(image.mediaId)}>{expandedIds.has(image.mediaId)?'收起详情':'展开详情'}</button><b>第 {image.sortOrder+1} 张 · {statusLabel[image.status]}</b><small>{image.summary}</small>{curation&&roleOptions?.length?<div className="ebay-visual-curation"><select aria-label={`第 ${image.sortOrder+1} 张原图用途`} value={curation.role??'UNUSED'} onChange={event=>onRoleChange?.(remoteUrl,event.target.value)}>{roleOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select><button type="button" onClick={()=>onToggleEnabled?.(remoteUrl,!curation.enabled)}>{curation.enabled?'排除':'保留'}</button><button type="button" className={selectedReferenceUrl===remoteUrl?'active':''} disabled={!curation.enabled} onClick={()=>curation.enabled&&onSelectReference?.(remoteUrl)}>{selectedReferenceUrl===remoteUrl?'✓ 当前参考':'设为参考'}</button></div>:null}{expandedIds.has(image.mediaId)?<ul>{image.rules.map(rule=><li key={rule.rule} className={rule.status.toLowerCase()}><span>{rule.label}</span><strong>{statusLabel[rule.status]}</strong><p>{rule.evidence}{rule.confidence?` · 置信度 ${Math.round(rule.confidence*100)}%`:''}</p>{rule.manualReview?<small className="ebay-visual-review-audit">人工{rule.manualReview.decision==='PASSED'?'确认通过':'确认不通过'} · {rule.manualReview.reviewedBy} · {new Date(rule.manualReview.reviewedAt).toLocaleString('zh-CN')} · {rule.manualReview.note}</small>:rule.status==='REVIEW'?<div className="ebay-visual-review-actions"><button type="button" onClick={()=>onReview(image.mediaId,rule.rule,'PASSED')}>确认通过</button><button type="button" className="danger" onClick={()=>onReview(image.mediaId,rule.rule,'FAILED')}>确认不通过</button></div>:null}</li>)}</ul>:null}</div>
        </article>
      })}</div>}
      <footer>模型：{report.model} · 规则集：{report.ruleSetVersion}。视觉模型只提供检查证据，低置信度结论必须人工复核。</footer>
    </>}
  </section>
}
