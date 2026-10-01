/**
 * “采集候选排除已优选”验收 fixture：向指定 sqlite 写入最小数据集。
 * 数据：大健云仓 3 个候选商品（u1/u2/u3），其中 u1 已进入优选产品（selection_records）。
 * 运行方式（需 node:sqlite）：ELECTRON_RUN_AS_NODE=1 <Electron> tools/fixture-seed-preferred-exclusion.cjs <sqlite-path>
 */
const { DatabaseSync } = require('node:sqlite')

const dbPath = process.argv[2]
if (!dbPath) {
  console.error('usage: fixture-seed-preferred-exclusion.cjs <sqlite-path>')
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
const now = new Date().toISOString()
const seedMode = process.argv[3]

db.exec(`
CREATE TABLE IF NOT EXISTS selection_tasks (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  stage TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supply_candidates (
  task_id TEXT NOT NULL,
  url TEXT NOT NULL,
  payload TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  selected INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (task_id, url)
);
CREATE TABLE IF NOT EXISTS candidate_collection_runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  candidate_area TEXT NOT NULL,
  platform_code TEXT NOT NULL,
  collection_method TEXT NOT NULL,
  source_entry TEXT NOT NULL DEFAULT '',
  requested_count INTEGER NOT NULL DEFAULT 0,
  collected_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  selected_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS candidate_collection_records (
  candidate_area TEXT NOT NULL,
  candidate_key TEXT NOT NULL,
  collection_run_id TEXT NOT NULL,
  platform_code TEXT NOT NULL,
  collection_method TEXT NOT NULL,
  source_entry TEXT NOT NULL DEFAULT '',
  source_rank INTEGER NOT NULL DEFAULT 0,
  collected_at TEXT NOT NULL,
  PRIMARY KEY (collection_run_id, candidate_area, candidate_key)
);
CREATE TABLE IF NOT EXISTS selection_records (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  ozon_url TEXT NOT NULL,
  comparison_id TEXT,
  decision TEXT NOT NULL DEFAULT 'PENDING',
  reason TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supply_warehouse_products (
  id TEXT PRIMARY KEY,
  warehouse_code TEXT NOT NULL,
  selection_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  product_id TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  price_text TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '未分类',
  subcategory TEXT NOT NULL DEFAULT '待人工分类',
  tertiary_category TEXT NOT NULL DEFAULT '待细分',
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(warehouse_code, source_url)
);
`)

const task = {
  id: 'task-fixture-giga', name: '大健云仓 fixture 采集任务', selectionMode: 'FORWARD_SUPPLY',
  supplyPlatforms: ['GIGACLOUD'], collectionMethod: 'KEYWORD', keyword: 'bed frame', maxProducts: 10
}

if (seedMode !== 'methods') {
const products = [
  { productId: '1070409', url: 'https://www.gigab2b.com/fixture/u1', title: 'FIXTURE Alpha Gaming Loft Bed 1070409', price: '$158.94' },
  { productId: '861654', url: 'https://www.gigab2b.com/fixture/u2', title: 'FIXTURE Beta Twin Bunk Bed 861654', price: '$115.00-$130.00' },
  { productId: '1125049', url: 'https://www.gigab2b.com/fixture/u3', title: 'FIXTURE Gamma Daybed Trundle 1125049', price: '$199.00-$209.00' }
]
db.prepare('INSERT INTO selection_tasks (id, payload, stage, created_at) VALUES (?, ?, ?, ?)')
  .run(task.id, JSON.stringify(task), 'SUPPLY_LIST_COMPLETED', now)

products.forEach((item, index) => {
  const payload = {
    platformCode: 'GIGACLOUD', productId: item.productId, url: item.url, title: item.title,
    imageUrl: '', priceText: item.price, shippingFeeText: '', supplierName: 'FIXTURE Seller',
    salesText: '', sellableInventory: 100, supplierBadges: ['GIGA_INDEX'], gigaIndex: 94 - index * 2,
    score: 94 - index * 2, selected: 0, recommendation: 'fixture 候选', riskFlags: [], promotionText: ''
  }
  db.prepare('INSERT INTO supply_candidates (task_id, url, payload, score, selected, sort_order, deleted_at) VALUES (?, ?, ?, ?, 0, ?, NULL)')
    .run(task.id, item.url, JSON.stringify(payload), payload.score, index)
  db.prepare('INSERT INTO candidate_collection_records (candidate_area, candidate_key, collection_run_id, platform_code, collection_method, source_entry, source_rank, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('SUPPLY', `GIGACLOUD:${item.url}`, 'run-fixture-giga', 'GIGACLOUD', 'KEYWORD', 'bed frame', index, now)
})

db.prepare(`INSERT INTO candidate_collection_runs (id, task_id, candidate_area, platform_code, collection_method, source_entry, requested_count, collected_count, new_count, updated_count, selected_count, status, started_at, completed_at)
  VALUES (?, ?, ?, ?, ?, ?, 3, 3, 3, 0, 0, ?, ?, ?)`)
  .run('run-fixture-giga', task.id, 'SUPPLY', 'GIGACLOUD', 'KEYWORD', 'bed frame', 'COMPLETED', now, now)

const preferred = products[0]
const selection = {
  id: 'sel-fixture-1', taskId: task.id, sourceArea: 'SUPPLY', sourceUrl: preferred.url,
  productId: preferred.productId, platformCode: 'GIGACLOUD', title: preferred.title, imageUrl: '',
  priceText: preferred.price, score: 94, category: '家具', subcategory: '卧室家具', tertiaryCategory: '床架及底座',
  decision: 'PENDING', reason: '已进入选品库，待结合利润和风险完成决策。', recommendation: '待完成供应链比价',
  riskFlags: [], updatedAt: now
}
db.prepare('INSERT INTO selection_records (id, task_id, ozon_url, comparison_id, decision, reason, payload, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)')
  .run(selection.id, task.id, preferred.url, selection.decision, selection.reason, JSON.stringify(selection), now)
}

// extra/stocked 模式：追加 3 候选（u4/u5/u6）并将 u4/u5 置为已优选；stocked 模式额外将 u4 决策 APPROVED 并写入正式入库
const extraProducts = [
  { productId: '2001001', url: 'https://www.gigab2b.com/fixture/u4', title: 'FIXTURE Delta Storage Bed 2001001', price: '$88.00-$99.00' },
  { productId: '2001002', url: 'https://www.gigab2b.com/fixture/u5', title: 'FIXTURE Epsilon Canopy Bed 2001002', price: '$210.00-$260.00' },
  { productId: '2001003', url: 'https://www.gigab2b.com/fixture/u6', title: 'FIXTURE Zeta Loft Bed with Desk 2001003', price: '$132.50-$148.00' }
]
if (seedMode === 'extra' || seedMode === 'stocked') {
  extraProducts.forEach((item, index) => {
    const payload = {
      platformCode: 'GIGACLOUD', productId: item.productId, url: item.url, title: item.title,
      imageUrl: '', priceText: item.price, shippingFeeText: '', supplierName: 'FIXTURE Seller',
      salesText: '', sellableInventory: 80, supplierBadges: ['GIGA_INDEX'], gigaIndex: 88 - index * 2,
      score: 88 - index * 2, selected: 0, recommendation: 'fixture 候选', riskFlags: [], promotionText: ''
    }
    db.prepare('INSERT INTO supply_candidates (task_id, url, payload, score, selected, sort_order, deleted_at) VALUES (?, ?, ?, ?, 0, ?, NULL)')
      .run(task.id, item.url, JSON.stringify(payload), payload.score, 3 + index)
    db.prepare('INSERT INTO candidate_collection_records (candidate_area, candidate_key, collection_run_id, platform_code, collection_method, source_entry, source_rank, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('SUPPLY', `GIGACLOUD:${item.url}`, 'run-fixture-giga', 'GIGACLOUD', 'KEYWORD', 'bed frame', 3 + index, now)
  })
  extraProducts.slice(0, 2).forEach((item, index) => {
    const item2 = { id: `sel-fixture-${index + 2}`, taskId: task.id, sourceArea: 'SUPPLY', sourceUrl: item.url, productId: item.productId, platformCode: 'GIGACLOUD', title: item.title, imageUrl: '', priceText: item.price, score: 88 - index * 2, category: '家具', subcategory: '卧室家具', tertiaryCategory: '床架及底座', decision: 'PENDING', reason: '已进入选品库，待结合利润和风险完成决策。', recommendation: '待完成供应链比价', riskFlags: [], updatedAt: now }
    db.prepare('INSERT INTO selection_records (id, task_id, ozon_url, comparison_id, decision, reason, payload, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)')
      .run(item2.id, task.id, item.url, item2.decision, item2.reason, JSON.stringify(item2), now)
  })
}

if (seedMode === 'stocked') {
  const stocked = extraProducts[0]
  db.prepare(`UPDATE selection_records SET decision = 'APPROVED', payload = json_set(payload, '$.decision', 'APPROVED'), updated_at = ? WHERE id = 'sel-fixture-2'`).run(now)
  db.prepare(`INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`)
    .run('wh-fixture-1', 'GIGACLOUD', 'sel-fixture-2', stocked.url, stocked.productId, stocked.title, '', stocked.price, 'FIXTURE Seller', '家具', '卧室家具', '床架及底座', '{}', now, now)
}

// sourcing 模式：3 个 1688 候选（p1/p2/p3）+ p1 的 SUPPLY 选品记录，供 1688 AI比价页排除验收
if (seedMode === 'sourcing') {
  const pProducts = [
    { productId: '700001', url: 'https://detail.1688.com/fixture/p1', title: 'FIXTURE 1688 Alpha Sofa Bed 700001', price: '¥88.00' },
    { productId: '700002', url: 'https://detail.1688.com/fixture/p2', title: 'FIXTURE 1688 Beta Bunk Bed 700002', price: '¥126.00' },
    { productId: '700003', url: 'https://detail.1688.com/fixture/p3', title: 'FIXTURE 1688 Gamma Daybed 700003', price: '¥199.00' }
  ]
  const task1688 = { id: 'task-fixture-1688', name: '1688 fixture 采集任务', selectionMode: 'FORWARD_SUPPLY', supplyPlatforms: ['1688'], collectionMethod: 'KEYWORD', keyword: 'bed', maxProducts: 6 }
  db.prepare('INSERT INTO selection_tasks (id, payload, stage, created_at) VALUES (?, ?, ?, ?)').run(task1688.id, JSON.stringify(task1688), 'SUPPLY_LIST_COMPLETED', now)
  db.prepare('INSERT INTO candidate_collection_runs (id, task_id, candidate_area, platform_code, collection_method, source_entry, requested_count, collected_count, new_count, updated_count, selected_count, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, 3, 3, 3, 0, 0, ?, ?, ?)')
    .run('run-fixture-1688', task1688.id, 'SUPPLY', '1688', 'KEYWORD', 'bed', 'COMPLETED', now, now)
  pProducts.forEach((item, index) => {
    const payload = {
      platformCode: '1688', productId: item.productId, url: item.url, title: item.title,
      imageUrl: '', priceText: item.price, shippingFeeText: '', supplierName: 'FIXTURE 1688 Seller',
      salesText: '月销 100', sellableInventory: 50, supplierBadges: [], gigaIndex: null,
      score: 80 - index * 2, selected: 0, recommendation: 'fixture 候选', riskFlags: [], promotionText: '',
      dataCompleteness: 86 - index * 3, grade: 'A'
    }
    db.prepare('INSERT INTO supply_candidates (task_id, url, payload, score, selected, sort_order, deleted_at) VALUES (?, ?, ?, ?, 0, ?, NULL)')
      .run(task1688.id, item.url, JSON.stringify(payload), payload.score, index)
    db.prepare('INSERT INTO candidate_collection_records (candidate_area, candidate_key, collection_run_id, platform_code, collection_method, source_entry, source_rank, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('SUPPLY', `1688:${item.url}`, 'run-fixture-1688', '1688', 'KEYWORD', 'bed', index, now)
  })
  const p1 = pProducts[0]
  const sel1688 = { id: 'sel-fixture-1688-1', taskId: task1688.id, sourceArea: 'SUPPLY', sourceUrl: p1.url, productId: p1.productId, platformCode: '1688', title: p1.title, imageUrl: '', priceText: p1.price, score: 80, category: '家具', subcategory: '卧室家具', tertiaryCategory: '床架及底座', decision: 'PENDING', reason: '已进入选品库，待结合利润和风险完成决策。', recommendation: '待完成供应链比价', riskFlags: [], updatedAt: now }
  db.prepare('INSERT INTO selection_records (id, task_id, ozon_url, comparison_id, decision, reason, payload, updated_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)')
    .run(sel1688.id, task1688.id, p1.url, sel1688.decision, sel1688.reason, JSON.stringify(sel1688), now)
}

// methods 模式：KEYWORD 任务 2 候选 + PRODUCT_URL 任务 2 候选 + 1 个无溯源记录候选（验证启动回填/迁移）
if (seedMode === 'methods') {
  const mProducts = [
    { taskId: 'task-method-kw', productId: '900001', url: 'https://www.gigab2b.com/fixture/m1', title: 'FIXTURE KW One 900001', price: '$60.00-$72.00' },
    { taskId: 'task-method-kw', productId: '900002', url: 'https://www.gigab2b.com/fixture/m2', title: 'FIXTURE KW Two 900002', price: '$84.00-$96.00' },
    { taskId: 'task-method-url', productId: '900003', url: 'https://www.gigab2b.com/fixture/m3', title: 'FIXTURE URL Three 900003', price: '$120.00-$138.00' },
    { taskId: 'task-method-url', productId: '900004', url: 'https://www.gigab2b.com/fixture/m4', title: 'FIXTURE URL Four 900004', price: '$150.00-$166.00' },
    { taskId: 'task-method-url', productId: '900005', url: 'https://www.gigab2b.com/fixture/m5', title: 'FIXTURE URL Five Legacy 900005', price: '$180.00-$199.00' }
  ]
  const taskKw = { id: 'task-method-kw', name: 'methods 关键词任务', selectionMode: 'FORWARD_SUPPLY', supplyPlatforms: ['GIGACLOUD'], collectionMethod: 'KEYWORD', keyword: 'bed kw', maxProducts: 4 }
  const taskUrl = { id: 'task-method-url', name: 'methods 单链接任务', selectionMode: 'FORWARD_SUPPLY', supplyPlatforms: ['GIGACLOUD'], collectionMethod: 'PRODUCT_URL', keyword: '', sourceUrl: 'https://www.gigab2b.com/offer/link-b', maxProducts: 4 }
  db.prepare('INSERT INTO selection_tasks (id, payload, stage, created_at) VALUES (?, ?, ?, ?)').run(taskKw.id, JSON.stringify(taskKw), 'SUPPLY_LIST_COMPLETED', now)
  db.prepare('INSERT INTO selection_tasks (id, payload, stage, created_at) VALUES (?, ?, ?, ?)').run(taskUrl.id, JSON.stringify(taskUrl), 'SUPPLY_LIST_COMPLETED', now)
  db.prepare('INSERT INTO candidate_collection_runs (id, task_id, candidate_area, platform_code, collection_method, source_entry, requested_count, collected_count, new_count, updated_count, selected_count, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, 2, 2, 2, 0, 0, ?, ?, ?)').run('run-method-kw', taskKw.id, 'SUPPLY', 'GIGACLOUD', 'KEYWORD', 'bed kw', 'COMPLETED', now, now)
  db.prepare('INSERT INTO candidate_collection_runs (id, task_id, candidate_area, platform_code, collection_method, source_entry, requested_count, collected_count, new_count, updated_count, selected_count, status, started_at, completed_at) VALUES (?, ?, ?, ?, ?, ?, 3, 3, 3, 0, 0, ?, ?, ?)').run('run-method-url', taskUrl.id, 'SUPPLY', 'GIGACLOUD', 'PRODUCT_URL', taskUrl.sourceUrl, 'COMPLETED', now, now)
  mProducts.forEach((item, index) => {
    const payload = {
      platformCode: 'GIGACLOUD', productId: item.productId, url: item.url, title: item.title,
      imageUrl: '', priceText: item.price, shippingFeeText: '', supplierName: 'FIXTURE Seller',
      salesText: '', sellableInventory: 60, supplierBadges: ['GIGA_INDEX'], gigaIndex: 90 - index,
      score: 90 - index, selected: 0, recommendation: 'fixture 候选', riskFlags: [], promotionText: ''
    }
    db.prepare('INSERT INTO supply_candidates (task_id, url, payload, score, selected, sort_order, deleted_at) VALUES (?, ?, ?, ?, 0, ?, NULL)')
      .run(item.taskId, item.url, JSON.stringify(payload), payload.score, index)
    if (item.productId !== '900005') {
      const isKw = item.taskId === 'task-method-kw'
      db.prepare('INSERT INTO candidate_collection_records (candidate_area, candidate_key, collection_run_id, platform_code, collection_method, source_entry, source_rank, collected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run('SUPPLY', `GIGACLOUD:${item.url}`, isKw ? 'run-method-kw' : 'run-method-url', 'GIGACLOUD', isKw ? 'KEYWORD' : 'PRODUCT_URL', isKw ? 'bed kw' : taskUrl.sourceUrl, index, now)
    }
  })
}

db.close()
console.log('FIXTURE_SEEDED', dbPath)
