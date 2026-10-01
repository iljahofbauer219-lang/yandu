/**
 * ERP 产品详情抽屉（方案 §2 渲染进程 / M2 产品库详情 UI）。
 * 展示：图集（入库后只引本地 local_path）/ 变体 / 尺寸重量 / 关键字段；
 * 操作：触发原图下载队列（非阻塞入队）→ 轮询任务进度 → 全图落盘后状态 collected→downloaded。
 * 断网/裂图：任务 failedUrls 存图片行主键（不存货盘外链），展示时对回图集序号，产品保持 COLLECTED 不误切。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ERP_IMAGE_MODELS,
  ERP_PLATFORMS,
  ERP_STATUS_LABELS,
  chooseErpTitle,
  exportErpBundle,
  fetchDownloadJob,
  fetchErpProduct,
  fetchProductListings,
  generateAiImages,
  generateAiTitles,
  generateProductListings,
  markPublishedErpProduct,
  recalcErpListingPrice,
  selectErpImage,
  triggerDownloadImages,
  updateErpListing,
  type ErpAiTitleOption,
  type ErpDownloadJobView,
  type ErpListingView,
  type ErpProductView
} from './erpApi'

const JOB_STATUS_LABELS: Record<string, string> = {
  PENDING: '排队中',
  RUNNING: '下载中',
  DONE: '已完成',
  PARTIAL: '部分失败',
  FAILED: '失败'
}

interface Props {
  productId: string
  canEdit: boolean
  /** erp.pricing.manage：重算参考价等定价动作专用门禁（与 canEdit 区分，见 server erp/routes.ts） */
  canPricing: boolean
  canViewSource: boolean
  onClose: () => void
  onChanged: () => void
}

export function ProductDetailDrawer({ productId, canEdit, canPricing, canViewSource, onClose, onChanged }: Props) {
  const [product, setProduct] = useState<ErpProductView | null>(null)
  const [job, setJob] = useState<ErpDownloadJobView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pollRef = useRef<number | null>(null)
  // —— P3 AI 加工状态 ——
  const [aiPlatform, setAiPlatform] = useState('ebay')
  const [aiModel, setAiModel] = useState(ERP_IMAGE_MODELS[0]?.id ?? 'qwen-image-edit-plus')
  const [aiBusy, setAiBusy] = useState<'idle' | 'images' | 'titles' | 'select' | 'choose'>('idle')
  const [aiNotice, setAiNotice] = useState('')
  const [titleOptions, setTitleOptions] = useState<ErpAiTitleOption[]>([])
  const [titleCharLimit, setTitleCharLimit] = useState(0)
  // —— P4 定价 / listing / 导出 ——
  const [listings, setListings] = useState<ErpListingView[]>([])
  const [listingBusy, setListingBusy] = useState(false)
  const [listingNotice, setListingNotice] = useState('')
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setProduct(await fetchErpProduct(productId))
      setListings(await fetchProductListings(productId).catch(() => [] as ErpListingView[]))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载产品失败')
    } finally {
      setLoading(false)
    }
  }, [productId])

  useEffect(() => { void load() }, [load])
  useEffect(() => () => { if (pollRef.current) window.clearInterval(pollRef.current) }, [])

  const pollJob = useCallback((jobId: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current)
    pollRef.current = window.setInterval(() => {
      void fetchDownloadJob(jobId).then(latest => {
        setJob(latest)
        if (['DONE', 'PARTIAL', 'FAILED'].includes(latest.status)) {
          if (pollRef.current) window.clearInterval(pollRef.current)
          pollRef.current = null
          setBusy(false)
          void load()
          onChanged()
        }
      }).catch(() => { /* 单次轮询失败忽略 */ })
    }, 800)
  }, [load, onChanged])

  const startDownload = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      const created = await triggerDownloadImages(productId)
      setJob(created)
      pollJob(created.id)
    } catch (reason) {
      setBusy(false)
      setError(reason instanceof Error ? reason.message : '触发下载失败')
    }
  }, [productId, pollJob])

  const runMarkPublished = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      await markPublishedErpProduct(productId)
      await load()
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '标记已发布失败')
    } finally {
      setBusy(false)
    }
  }, [productId, load, onChanged])

  const runGenerateImages = useCallback(async () => {
    setAiBusy('images')
    setAiNotice('')
    setError('')
    try {
      const result = await generateAiImages(productId, { platform: aiPlatform, model: aiModel, count: 2 })
      setAiNotice(`已生成 ${result.generated} 张待选图（模型 ${result.model}），请人工核对产品本体一致性后定稿`)
      await load()
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '图生图失败')
    } finally {
      setAiBusy('idle')
    }
  }, [productId, aiPlatform, aiModel, load, onChanged])

  const runGenerateTitles = useCallback(async () => {
    setAiBusy('titles')
    setAiNotice('')
    setError('')
    try {
      const result = await generateAiTitles(productId, { platform: aiPlatform })
      setTitleOptions(result.options)
      setTitleCharLimit(result.charLimit)
      setAiNotice(`已生成 ${result.options.length} 个风格标题（${aiPlatform} 上限 ${result.charLimit} 字符）`)
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '标题生成失败')
    } finally {
      setAiBusy('idle')
    }
  }, [productId, aiPlatform, load])

  const runSelectImage = useCallback(async (imageId: string, isSelected: boolean) => {
    setAiBusy('select')
    setAiNotice('')
    setError('')
    try {
      const result = await selectErpImage(productId, imageId, isSelected)
      setAiNotice(isSelected ? `已定稿待选图，产品状态：${ERP_STATUS_LABELS[result.productStatus] ?? result.productStatus}` : '已取消定稿')
      await load()
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '定稿失败')
    } finally {
      setAiBusy('idle')
    }
  }, [productId, load, onChanged])

  const runChooseTitle = useCallback(async (title: string) => {
    setAiBusy('choose')
    setAiNotice('')
    setError('')
    try {
      const result = await chooseErpTitle(productId, aiPlatform, title)
      setAiNotice(`已选定标题（${result.charCount} 字符${result.truncated ? '，已截断' : ''}），产品状态：${ERP_STATUS_LABELS[result.productStatus] ?? result.productStatus}`)
      await load()
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '选定标题失败')
    } finally {
      setAiBusy('idle')
    }
  }, [productId, aiPlatform, load, onChanged])

  const images = product?.images ?? []
  const downloadedCount = images.filter(image => image.localPath).length
  const allDownloaded = images.length > 0 && downloadedCount === images.length
  const originalImages = images.filter(image => image.imageType !== 'AI')
  const aiImages = images.filter(image => image.imageType === 'AI')
  const canProcess = canEdit && ['DOWNLOADED', 'PROCESSING', 'READY'].includes(product?.status ?? '')

  const runGenerateListings = useCallback(async () => {
    setListingBusy(true)
    setListingNotice('')
    setError('')
    try {
      const result = await generateProductListings(productId, ERP_PLATFORMS.map(platform => platform.code))
      setListings(result.listings)
      setListingNotice(`已生成 ${result.listings.length} 个平台 listing 版本（含参考价）`)
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '生成 listing 失败')
    } finally {
      setListingBusy(false)
    }
  }, [productId, onChanged])

  const runRecalc = useCallback(async (listingId: string) => {
    setListingBusy(true)
    setListingNotice('')
    setError('')
    try {
      const result = await recalcErpListingPrice(listingId)
      setListingNotice(result.protected
        ? `参考价重算已跳过：该 listing 已手改价（试算价 ${result.breakdown?.price ?? '—'}），如需覆盖请用重算并强制`
        : `已重算参考价：${result.breakdown?.currency ?? ''} ${result.price ?? '—'}`)
      setListings(await fetchProductListings(productId))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '重算失败')
    } finally {
      setListingBusy(false)
    }
  }, [productId])

  const runSaveListing = useCallback(async (listingId: string, patch: { title?: string; price?: number }) => {
    setListingBusy(true)
    setListingNotice('')
    setError('')
    try {
      const updated = await updateErpListing(listingId, patch)
      setListings(await fetchProductListings(productId))
      setListingNotice(patch.price !== undefined ? `已手改价（priceManual），后续重算不会覆盖：${updated.price}` : '已保存 listing')
      setPriceDrafts(drafts => { const next = { ...drafts }; delete next[listingId]; return next })
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败')
    } finally {
      setListingBusy(false)
    }
  }, [productId, onChanged])

  const runExport = useCallback(async () => {
    setListingBusy(true)
    setListingNotice('')
    setError('')
    try {
      const bundle = await exportErpBundle(productId)
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `erp-export-${productId}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      const c = bundle.completeness
      setListingNotice(`导出包已下载·物料${c.complete ? '齐备' : '不齐'}（选定图:${c.hasSelectedImage ? '✓' : '✗'} 标题:${c.allHaveTitle ? '✓' : '✗'} 价:${c.allHavePrice ? '✓' : '✗'} 无外链:${c.noExternalRefs ? '✓' : '✗'}）`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导出失败')
    } finally {
      setListingBusy(false)
    }
  }, [productId])

  return (
    <div className="erp-modal-mask" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="erp-drawer" onClick={event => event.stopPropagation()}>
        <div className="erp-drawer-head">
          <div>
            <h3>{product?.titleOriginal || '产品详情'}</h3>
            {product && (
              <p>
                <em className={`erp-status erp-status-${product.status.toLowerCase()}`}>{ERP_STATUS_LABELS[product.status] ?? product.status}</em>
                {canViewSource && product.sourceProductId && <span className="erp-drawer-sku">货盘SKU：{product.sourceSku || '—'} · 源ID：{product.sourceProductId}</span>}
              </p>
            )}
          </div>
          <button type="button" className="ghost-button" onClick={onClose}>关闭</button>
        </div>

        {error && <div className="erp-banner erp-banner-error">{error}</div>}

        {loading ? (
          <p className="dashboard-empty">加载中…</p>
        ) : product ? (
          <div className="erp-drawer-body">
            <section className="erp-drawer-section">
              <div className="dashboard-section-title"><b>图集</b><small>{downloadedCount}/{images.length} 已入库（本地 local_path）</small></div>
              <div className="erp-image-grid">
                {images.map(image => (
                  <figure key={image.id} className={[image.localPath ? 'is-local' : 'is-external', image.isSelected === 1 ? 'is-selected' : ''].filter(Boolean).join(' ')}>
                    <img src={image.url} alt={image.imageType} loading="lazy" />
                    {image.isSelected === 1 && <span className="erp-selected-badge">✓ 已定稿</span>}
                    <figcaption>
                      <span>{image.imageType === 'AI' ? 'AI待选' : image.imageType}</span>
                      <em className={image.localPath ? 'erp-tag erp-tag-created' : 'erp-tag erp-tag-needs_confirm'}>{image.localPath ? '本地' : '外链'}</em>
                    </figcaption>
                    {canEdit && image.imageType === 'AI' && (
                      <button
                        type="button"
                        className={image.isSelected === 1 ? 'ghost-button erp-mini-btn' : 'primary-button erp-mini-btn'}
                        disabled={aiBusy !== 'idle'}
                        onClick={() => void runSelectImage(image.id, image.isSelected !== 1)}
                      >
                        {image.isSelected === 1 ? '取消定稿' : '定稿'}
                      </button>
                    )}
                  </figure>
                ))}
                {images.length === 0 && <p className="dashboard-empty">该产品暂无图片</p>}
              </div>
              {canEdit && (
                <div className="erp-drawer-actions">
                  <button type="button" className="primary-button" disabled={busy || allDownloaded} onClick={() => void startDownload()}>
                    {busy ? '下载中…' : allDownloaded ? '全图已入库' : `下载原图入库（${images.length - downloadedCount} 张待下载）`}
                  </button>
                  {product?.status === 'READY' && (
                    <button type="button" className="ghost-button" disabled={busy} onClick={() => void runMarkPublished()}>标记已发布</button>
                  )}
                  {job && (
                    <span className={`erp-job-pill erp-job-${job.status.toLowerCase()}`}>
                      {JOB_STATUS_LABELS[job.status] ?? job.status} · {job.done}/{job.total}
                    </span>
                  )}
                </div>
              )}
              {job && job.failedUrls.length > 0 && (
                <div className="erp-banner erp-banner-error">
                  {job.failedUrls.length} 张下载失败（已重试）：
                  <ul className="erp-failed-urls">
                    {job.failedUrls.map((entry, position) => {
                      // failedUrls 存图片行主键（不存货盘外链，见 projection.redactFailedUrls）：对回图集序号展示
                      const index = images.findIndex(image => image.id === entry)
                      const imageType = index >= 0 ? images[index]?.imageType : undefined
                      return (
                        <li key={`${entry}:${position}`}>
                          {index >= 0 ? `第 ${index + 1} 张 · ${imageType === 'AI' ? 'AI待选' : imageType}` : entry}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </section>

            {canProcess && (
              <section className="erp-drawer-section erp-ai-section">
                <div className="dashboard-section-title">
                  <b>AI 加工</b>
                  <small>原图 {originalImages.length} 张 · AI 待选 {aiImages.length} 张 · 以原图为参考图，不替换原图</small>
                </div>

                <div className="erp-ai-controls">
                  <label className="erp-ai-field">
                    <span>目标平台</span>
                    <select value={aiPlatform} onChange={event => setAiPlatform(event.target.value)} disabled={aiBusy !== 'idle'}>
                      {ERP_PLATFORMS.map(platform => <option key={platform.code} value={platform.code}>{platform.label}</option>)}
                    </select>
                  </label>
                  <label className="erp-ai-field">
                    <span>图生图模型</span>
                    <select value={aiModel} onChange={event => setAiModel(event.target.value)} disabled={aiBusy !== 'idle'}>
                      {ERP_IMAGE_MODELS.map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
                    </select>
                  </label>
                </div>

                <div className="erp-drawer-actions">
                  <button type="button" className="primary-button" disabled={aiBusy !== 'idle' || originalImages.length === 0} onClick={() => void runGenerateImages()}>
                    {aiBusy === 'images' ? '生成中…' : '生成候选图（图生图）'}
                  </button>
                  <button type="button" className="ghost-button" disabled={aiBusy !== 'idle'} onClick={() => void runGenerateTitles()}>
                    {aiBusy === 'titles' ? '生成中…' : '生成三风格标题'}
                  </button>
                </div>
                {originalImages.length === 0 && <p className="erp-ai-hint">需先完成原图入库才能以原图为参考图生图（保证产品本体一致性）。</p>}

                {aiNotice && <div className="erp-banner erp-banner-ok">{aiNotice}</div>}

                {titleOptions.length > 0 && (
                  <div className="erp-title-options">
                    <div className="dashboard-section-title"><b>候选标题</b><small>{aiPlatform} 上限 {titleCharLimit} 字符</small></div>
                    {titleOptions.map(option => (
                      <div key={option.style} className="erp-title-option">
                        <div className="erp-title-option-head">
                          <em className="erp-tag erp-tag-created">{option.style}</em>
                          <span className={option.charCount > titleCharLimit ? 'erp-char over' : 'erp-char'}>{option.charCount}/{titleCharLimit}</span>
                          {option.truncated && <span className="erp-char-truncated">已截断</span>}
                        </div>
                        <p className="erp-title-text">{option.title}</p>
                        <button type="button" className="primary-button erp-mini-btn" disabled={aiBusy !== 'idle'} onClick={() => void runChooseTitle(option.title)}>选用此标题</button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            {canProcess && (
              <section className="erp-drawer-section erp-ai-section">
                <div className="dashboard-section-title">
                  <b>定价 / 多平台 listing</b>
                  <small>eBay / Amazon / Ozon 各一版本独立；手改价不被重算覆盖</small>
                </div>
                <div className="erp-drawer-actions">
                  <button type="button" className="primary-button" disabled={listingBusy} onClick={() => void runGenerateListings()}>生成多平台 listing</button>
                  <button type="button" className="ghost-button" disabled={listingBusy || listings.length === 0} onClick={() => void runExport()}>导出包</button>
                </div>
                {listingNotice && <div className="erp-banner erp-banner-info">{listingNotice}</div>}
                {listings.length === 0 ? (
                  <p className="erp-ai-hint">尚未生成 listing，点击上方“生成多平台 listing”按定价规则计算各平台参考价。</p>
                ) : (
                  <div className="erp-listing-list">
                    {listings.map(listing => (
                      <div key={listing.id} className="erp-listing-card">
                        <div className="erp-listing-head">
                          <em className="erp-tag erp-tag-created">{listing.platformCode.toUpperCase()}</em>
                          <span className="erp-listing-price">{listing.price != null ? `${listing.price}` : '未定价'}</span>
                          {listing.priceManual === 1 && <span className="erp-char-truncated">手改价·已保护</span>}
                          <span className="erp-listing-status">{listing.status}</span>
                        </div>
                        <label className="erp-ai-field">
                          <span>标题</span>
                          <input defaultValue={listing.title} placeholder="listing 标题" onBlur={event => { if (event.target.value !== listing.title) void runSaveListing(listing.id, { title: event.target.value }) }} disabled={listingBusy} />
                        </label>
                        <div className="erp-listing-price-row">
                          <label className="erp-ai-field">
                            <span>手改价</span>
                            <input
                              type="number" min="0" step="0.01" placeholder={listing.price != null ? String(listing.price) : '0.00'}
                              value={priceDrafts[listing.id] ?? ''}
                              onChange={event => setPriceDrafts(drafts => ({ ...drafts, [listing.id]: event.target.value }))}
                              disabled={listingBusy}
                            />
                          </label>
                          <button type="button" className="primary-button erp-mini-btn" disabled={listingBusy || !(priceDrafts[listing.id] ?? '').trim()} onClick={() => void runSaveListing(listing.id, { price: Number(priceDrafts[listing.id]) })}>保存手改价</button>
                          {canPricing && <button type="button" className="ghost-button erp-mini-btn" disabled={listingBusy} onClick={() => void runRecalc(listing.id)}>重算参考价</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}

            <section className="erp-drawer-section">
              <div className="dashboard-section-title"><b>关键字段</b></div>
              <dl className="erp-field-list">
                <div><dt>成本价</dt><dd>{product.costPrice != null ? `${product.currency} ${product.costPrice}` : '—'}</dd></div>
                <div><dt>运费</dt><dd>{product.shippingCost != null ? `${product.currency} ${product.shippingCost}` : '—'}</dd></div>
                <div><dt>库存</dt><dd>{product.stockQuantity ?? '—'}</dd></div>
                <div><dt>重量</dt><dd>{product.weight != null ? `${product.weight}` : '—'}</dd></div>
                <div><dt>材质</dt><dd>{product.material || '—'}</dd></div>
                <div><dt>颜色</dt><dd>{product.color || '—'}</dd></div>
                <div><dt>品牌</dt><dd>{product.brand || '—'}</dd></div>
                <div><dt>品类</dt><dd>{product.category || '—'}</dd></div>
              </dl>
            </section>

            {(Array.isArray(product.variants) ? product.variants.length > 0 : false) && (
              <section className="erp-drawer-section">
                <div className="dashboard-section-title"><b>变体</b><small>{product.variants.length} 个</small></div>
                <pre className="erp-variants">{JSON.stringify(product.variants, null, 2)}</pre>
              </section>
            )}

            {canViewSource && product.sourceUrl && (
              <section className="erp-drawer-section">
                <div className="dashboard-section-title"><b>货盘来源</b><small>仅采集角色可见</small></div>
                <p className="erp-source-link">{product.sourceUrl}</p>
              </section>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
