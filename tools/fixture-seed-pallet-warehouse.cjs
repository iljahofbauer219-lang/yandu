/**
 * 货盘仓库真实数据验收 fixture：向指定 sqlite 写入最小数据集。
 * 默认模式：2 条 GIGACLOUD 正式入库商品（supply_warehouse_products）+ 2 条已存放货盘商品（pallet_warehouse_items），
 *   p1 近 7 天内存放（进入新品速递），p2 8 天前存放（不进入新品速递）。
 * review 模式：仅 1 条 GIGACLOUD 正式入库商品（不预存货盘），供「货盘仓库」按钮点击流程验收。
 * 运行方式（需 node:sqlite）：ELECTRON_RUN_AS_NODE=1 <Electron> tools/fixture-seed-pallet-warehouse.cjs <sqlite-path> [review]
 */
const { DatabaseSync } = require('node:sqlite')

const dbPath = process.argv[2]
if (!dbPath) {
  console.error('usage: fixture-seed-pallet-warehouse.cjs <sqlite-path> [review]')
  process.exit(1)
}

const db = new DatabaseSync(dbPath)
const now = new Date().toISOString()
const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString()
const seedMode = process.argv[3] || 'pallet'

db.exec(`
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
CREATE TABLE IF NOT EXISTS pallet_warehouse_items (
  id TEXT PRIMARY KEY,
  warehouse_product_id TEXT NOT NULL UNIQUE,
  warehouse_code TEXT NOT NULL,
  item_code TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  image_url TEXT NOT NULL DEFAULT '',
  price_text TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '未分类',
  subcategory TEXT NOT NULL DEFAULT '待人工分类',
  tertiary_category TEXT NOT NULL DEFAULT '待细分',
  source_url TEXT NOT NULL DEFAULT '',
  stored_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS inbound_processing_items (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  source_id TEXT NOT NULL,
  selection_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'PENDING',
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inbound_origin_source ON inbound_processing_items(origin, source_id);
CREATE TABLE IF NOT EXISTS supply_product_downloads (
  warehouse_product_id TEXT PRIMARY KEY,
  directory TEXT NOT NULL DEFAULT '',
  image_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  detail_path TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DOWNLOADED',
  error TEXT NOT NULL DEFAULT '',
  downloaded_at TEXT NOT NULL,
  page_id TEXT NOT NULL DEFAULT '',
  page_url TEXT NOT NULL DEFAULT ''
);
`)

// 内联 SVG 商品图（离线可加载，天然满足 img.complete 断言）
const fixtureImage = color => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="${color}"/><text x="24" y="164" font-size="30" fill="#666666">FIXTURE</text></svg>`).toString('base64')}`

const insertWarehouse = db.prepare(`INSERT INTO supply_warehouse_products (id, warehouse_code, selection_id, source_url, product_id, title, image_url, price_text, supplier_name, category, subcategory, tertiary_category, status, payload, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', '{}', ?, ?)`)
const insertPallet = db.prepare(`INSERT INTO pallet_warehouse_items (id, warehouse_product_id, warehouse_code, item_code, title, image_url, price_text, category, subcategory, tertiary_category, source_url, stored_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

if (seedMode === 'review' || seedMode === 'review-page') {
  insertWarehouse.run('wh-fixture-r1', 'GIGACLOUD', 'sel-fixture-r1', 'https://www.gigab2b.com/fixture/r1', '400001', 'FIXTURE Review Gamma Loft Bed 400001', fixtureImage('#dbeafe'), '$168.00', 'FIXTURE Seller', '家具', '卧室家具', '高架床', now, now)
  if (seedMode === 'review-page') {
    // 预置服务器详情页档案：供「已生成服务器详情页」提示条与查看页面按钮验收
    db.prepare(`INSERT INTO supply_product_downloads (warehouse_product_id, page_id, page_url, image_count, failed_count, status, error, downloaded_at) VALUES (?, ?, ?, ?, 0, 'DOWNLOADED', '', ?)`)
      .run('wh-fixture-r1', 'wh-fixture-r1', 'https://mock.invalid/product-pages/wh-fixture-r1', 24, now)
  }
} else {
  const products = [
    { id: 'wh-fixture-p1', code: '300001', title: 'FIXTURE Pallet Alpha Loft Bed 300001', price: '$158.94', tertiary: '高架床', color: '#fde68a', storedAt: now },
    { id: 'wh-fixture-p2', code: '300002', title: 'FIXTURE Pallet Beta Bunk Bed 300002', price: '$115.00-$130.00', tertiary: '床架及底座', color: '#bbf7d0', storedAt: eightDaysAgo }
  ]
  for (const item of products) {
    const image = fixtureImage(item.color)
    const sourceUrl = `https://www.gigab2b.com/fixture/${item.code}`
    insertWarehouse.run(item.id, 'GIGACLOUD', `sel-${item.id}`, sourceUrl, item.code, item.title, image, item.price, 'FIXTURE Seller', '家具', '卧室家具', item.tertiary, now, now)
    insertPallet.run(`pallet-${item.id}`, item.id, 'GIGACLOUD', item.code, item.title, image, item.price, '家具', '卧室家具', item.tertiary, sourceUrl, item.storedAt)
    // 闸口 v2：种子行补 CONFIRMED 选品快照对应行（与正式入库行同源 sel-），启动迁移/回填跳过（基线 2 卡不变）
    const snapshot = { platformCode: 'GIGACLOUD', warehouseCode: 'GIGACLOUD', itemCode: item.code, title: item.title, imageUrl: image, priceText: item.price, category: '家具', subcategory: '卧室家具', tertiaryCategory: item.tertiary, sourceUrl, tags: [], collectedAt: item.storedAt }
    db.prepare(`INSERT OR IGNORE INTO inbound_processing_items (id, origin, source_id, selection_id, status, snapshot_json, created_at, updated_at, confirmed_at) VALUES (?, 'SELECTION', ?, ?, 'CONFIRMED', ?, ?, ?, ?)`).run(`inbound-${item.id}`, `sel-${item.id}`, `sel-${item.id}`, JSON.stringify(snapshot), item.storedAt, item.storedAt, item.storedAt)
  }
}

db.close()
console.log('FIXTURE_SEEDED', dbPath, seedMode)
