# 砚都跨境采集助手

## 功能一：大健云仓商品采集（连接桌面端）

1. 保持“砚都跨境”桌面应用运行。
2. 在 Chrome 地址栏打开 `chrome://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择本目录 `browser-extension`。
4. 在桌面应用的“大健云仓 > AI采集 > 02 采集入口”复制 6 位配对码，在扩展弹窗中完成配对。
5. 在大健云仓使用平台自身的筛选条件。列表页可逐个点击“＋ 采集”，详情页可点击右下角“＋ 采集此产品”。
6. 采集结果会去重写入“采集候选 > 大健云仓”，采集来源显示为“Chrome采集插件”。

## 功能二：1688 商品一键 AI 选品分析

1. 打开任意 1688 商品详情页（`detail.1688.com/offer/...`）。
2. 点击扩展图标，在「AI 选品分析」区域点击「提取并分析」。
3. 扩展自动提取当前商品的标题、价格、规格属性、图片等信息，调用 MaxKB「选品分析师」智能体（v0.3.0+），约 20-60 秒后返回完整评估报告（商品摘要 → 市场分析 → 合规分析 → 毛利测算与综合建议）。

**首次使用需配置**：展开弹窗底部「MaxKB 设置」，填写服务地址、Application ID、Secret Token（默认已填服务地址与 Application ID，仅 Token 需要填入），点击保存。

> 说明：1688 详情页从服务器（阿里云 IP）抓取会被平台风控拦截，因此改为在用户浏览器中提取商品信息（用户浏览器为真实网络环境，不受影响），再调用智能体分析。

## 技术说明

- 版本 0.3.0（MV3）：服务地址与智能体调用从 RAGFlow（8090）切到 MaxKB v2.10.5-lts CE（8080）；默认智能体为 sourcing 选品分析师（MAXKB_SOURCING_APPLICATION_ID + secret_key）。
- 阶段 3.6 切换：
  - `service-worker.js`：`ANALYZE_1688` 改走 `/chat/api/{application_id}/chat/completions` + Bearer secret_key；新增 `MAXKB_SAVE / MAXKB_STATUS`。
  - `manifest.json`：`host_permissions` 增加 `http://114.55.149.192:8080/*`；保留 8090 用于 30 天回退期。
  - `popup.html` / `popup.js`：设置区改名为「MaxKB 设置」，新增 `maxkbAppId` 输入框。
- 采集功能（大健云仓）继续走桌面端 17321 API，与 MaxKB 切换无关。
- 端到端验证脚本：`tools/verify-extension-1688.cjs`（Playwright 加载扩展 + 真实 1688 页面提取 + 智能体调用）。
