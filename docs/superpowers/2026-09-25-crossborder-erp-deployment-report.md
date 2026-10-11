# 跨境 ERP 生产部署与验证报告

- 日期：2026-09-25；本文时间除另注外均为 UTC。
- 发布版本：`erp-20260925T030825Z`。
- 依据：[分阶段方案](plans/2026-09-24-crossborder-erp-phased-plan.md)、[已更正的本地实现记录](2026-09-25-crossborder-erp-delivery-report.md)。
- 结论：**现有 ERP 服务端能力已部署，选定真实业务链路验证通过；不代表原 P0–P5 全部需求已完成或完整投产。** 真实货盘适配、自动巡盘及可信 HTTPS 仍有缺口。

## 1. 本次实际交付

此前生产 API 没有 ERP 路由，数据库也没有 ERP 表，用户看到的 `Route GET:/api/erp/products ... not found` 属于未上线，不是正常空列表。此前展示的 UI 截图采用 mock 后端，不是生产验证证据；原报告的“全部完成并交付闭环”结论已撤回。

本次完成：
- 构建并切换 `yandu-app`，上线 ERP 路由及其已实现的采集入库、图片下载、AI、定价、listing、通知能力。
- 执行唯一缺失的 ERP 增量迁移，新增 9 张表；补齐既有组织预置角色权限。
- 补充模型访问参考图片所需的公网媒体基址，显式关闭未接通生产抓取器的自动巡盘。
- 真实生产验证 **50 项通过、0 失败、3 项明确未验证**；真实 Electron 联调 **13 项通过、5 张截图**，无 HTTP mock。
- 清理隔离验收数据并停用测试账号，收尾验证 **26 项通过**。
- 未重启 PostgreSQL、MaxKB、RAGFlow 等共享依赖；未创建 Git 提交、未推送；未重新发布桌面安装包。

## 2. 部署前四项检查

| 检查项 | 部署前实测/核查 | 本次处理与结果 |
|---|---|---|
| 已实现但未上线 | 本地 `app.ts` 已注册 ERP；公网与宿主机直连均返回 ERP 404 | 新镜像已运行；未登录 ERP 请求为 401，登录后的列表/详情为 200 |
| 数据库迁移 | PostgreSQL 可连接；生产只有 9 个历史迁移，ERP 表为 0；历史迁移 checksum 与本地一致 | 应用 `20260925000000_add_erp_domain`，现有 10 个已完成迁移、9 张 ERP 表，无回滚记录 |
| 环境变量 | DB、JWT、媒体签名、百炼密钥已存在；缺少 `MEDIA_PUBLIC_BASE_URL` | 保留原凭据，补媒体基址与巡盘关闭开关；当前 local + 默认百炼路径实测通过 |
| 依赖服务 | PostgreSQL 16.14 可用；媒体目录可读写；百炼模型目录返回 200 | 进一步完成真实三标题、图生图、媒体写入及读取，不仅检查模型目录 |

安全检查未报告问题；该结果不是全面安全保证，HTTPS 的已知限制见后文。

### 数据库与权限

ERP 迁移完成于 `2026-09-25T03:09:38.504Z`，新增：
`erp_suppliers`、`erp_products`、`erp_product_images`、`erp_platform_rules`、`erp_pricing_rules`、`erp_listings`、`erp_crawl_logs`、`erp_notifications`、`erp_download_jobs`。

迁移仅新增 ERP 表、索引、外键，不删除既有业务表。随后运行 `migrate-erp-roles`，结果：既有组织 1 个、新建角色 1 个、补齐预置授权记录 44 条。44 条是脚本的预置角色补齐总数，不是新增 44 种 ERP 权限。

没有自动为真实员工分配角色，也没有更改其账号状态。自定义角色和每个真实员工的授权未逐一验收；无权限员工需要由管理员正常分配相应权限。

### 环境配置

| 配置 | 当前部署值/状态 |
|---|---|
| `DATABASE_URL`、`JWT_SECRET` | 继承原配置；存在，鉴权与数据库读写通过；不披露值 |
| `MEDIA_DRIVER` | `local`；未启用 OSS 支路 |
| `MEDIA_LOCAL_DIR` | `/app/data/media`，继续使用 `app_media-data` 卷 |
| `MEDIA_SIGNING_SECRET` | 继承原配置；存在，签名媒体读取通过 |
| `MEDIA_PUBLIC_BASE_URL` | 新增 `http://114.55.149.192`，供当前参考图下载链路使用；仍有明文 HTTP 风险 |
| `BAILIAN_API_KEY` | 继承原配置；真实推理已通过；不披露值 |
| `BAILIAN_BASE_URL` | 未显式配置，使用现有默认 `https://dashscope.aliyuncs.com/compatible-mode/v1` |
| `BAILIAN_VISION_MODEL` | 未显式配置，使用现有默认 `qwen3.6-flash` |
| ERP 图生图模型 | 本次实测 `qwen-image-edit-plus`，一次一张 |
| `ERP_PATROL_ENABLED` | 新增字符串 `false`；复查确认调度器关闭 |
| `TZ` | 未显式配置；本次未改变全局时区，自动早间汇总也未启用 |
| 跨币种汇率 | 本次仅验 USD 同币种；其他币种所需汇率仍须配置和验收 |

预检 JSON 的 `environment` 布尔值仅表示变量存在性。例如 `ERP_PATROL_ENABLED: true` 表示变量存在，**不表示调度开启**；实际值见 `patrol.configuredValue: "false"`。

## 3. 服务状态与访问地址

最终状态复查：`2026-09-25T03:22:08.753Z`，见 [服务、迁移与依赖复查结果](../../artifacts/erp-production/preflight.json)。

| 服务/入口 | 实测状态 | 访问方式 |
|---|---|---|
| `yandu-app` | running，重启计数 0；启动于 03:09:52 UTC | 主机 `127.0.0.1:8787`，Nginx 代理 |
| `yandu-db` | running，重启计数 0；启动时间仍为 09-12，未因本次发布重启 | Docker 内部 `db:5432`，不开放给客户端直连 |
| PostgreSQL | 16.14，数据库 `yandu`，真实迁移及业务读写通过 | 仅应用内部访问 |
| Nginx | systemd active | 现有公网入口 |
| 健康检查 | HTTP 200 | <http://114.55.149.192/health> |
| ERP API | 未登录 HTTP 401；真实登录后已验路径 200，不再 404 | `http://114.55.149.192/api/erp` |
| HTTPS | 严格证书验证失败：`DEPTH_ZERO_SELF_SIGNED_CERT` | `https://114.55.149.192`；不能认定可信 HTTPS 可用 |
| 百炼 | 模型目录 200，三标题与图生图真实调用通过 | 应用服务端调用，不向客户端暴露密钥 |

公网 HTTP 健康/鉴权探测也从本机独立复核过，分别为 200/401。401 是未携带身份时的正确结果，不能单凭它证明业务可用；业务 200 与持久化证据另见 §5。

**访问说明：**用户操作入口仍是桌面端“AI仓库”。本次已从当前源码构建 renderer/main 并用真实 Electron 验证，但没有更新已安装客户端或发布新的安装包。若客户端版本不包含 ERP 页面或桥接代码，仅部署服务器不会补齐它。

鉴于公网证书问题，本次带身份的桌面验证使用 SSH 加密隧道：本机 `127.0.0.1:18787` → 同一生产主机 `127.0.0.1:8787`，不是临时后端。验收后已关闭该隧道与测试客户端；它不是长期可用的用户访问地址。不要将公网 HTTP 作为传输真实账号密码的推荐方案；正式开放前应配置可信证书并重新验收 HTTPS。

## 4. 模块上线清单及边界

| 模块 | 本次部署/验证结果 | 未完成或未覆盖内容 |
|---|---|---|
| M0 地基与权限 | ERP schema、JWT 路由、预置角色补齐上线；真实登录、组织归属、能力接口通过 | 本次主要使用隔离 Owner；COLLECTOR/OPERATOR 投影与越权仍是既有隔离测试证据，未做生产双账号对抗验收 |
| M1 采集 | 供应商/规则相关服务代码、collect API、采集池已部署；人工验收 JSON 真实入库、读回通过 | 真实业务组织尚缺供应商初始化与有效 `crawl_rules`，没有供应商创建 UI/API；真实登录、DOM 单采/批量 20 品未验收。现有 outbox 路径经工作台人工确认上云，不是网页点击即自动上云 |
| M2 仓库与图片 | 原图真实下载任务 DONE、`local_path` 回填、图片 HTTP 字节核验、产品库/详情通过 | worker 仍为 API 进程内执行，未实现进程重启后在途任务恢复；带 Cookie/Referer 的货盘下载及 OSS 未验收 |
| M3 AI 加工 | 百炼三标题、一张参考图图生图、原图保留、AI 图待选、选图选标题后 READY 全部通过 | 本次是自绘无品牌素材；真实商品一致性人工评审、多模型重试、大批量/超时恢复未验收 |
| M4 定价 | eBay/Amazon 规则、计算、重算、手改价保护及读回通过 | 仅 USD 同币种，非跨币种验收；完整前端规则配置页仍有缺口 |
| M5 listing | eBay/Amazon 独立草稿、人工编辑保护、JSON 导出完整性通过 | 导出是 JSON＋短期签名图片 URL，不是离线图片 ZIP；Ozon 未做本次真实业务验收；不包含平台自动刊登，符合一期“不推平台”的边界 |
| M6 巡盘与通知 | 变更/通知接口与页面、手动生成汇总及持久化通过；相关服务代码已发布 | SERVER fetcher / CLIENT dispatcher 未接生产实现，客户端任务下发回传尚缺；自动巡盘和自动早间汇总关闭。非空 diff 的 APPLY/DISMISS、已发布标红没有本次生产验收证据 |

其他限制：
- “立即巡盘”按钮仍会显示，但后端没有生产抓取器；扫描计数或成功回执不能当作抓取成功，不应据此使用生产巡盘。
- 方案要求 00:00–07:00 巡盘窗口；当前调度框架默认按间隔执行，尚未落实该时间窗口。未做真实 10 万品压力/风控测试。
- 没有正常业务链路把 ERP 产品推进 `PUBLISHED`；修改 listing 状态不等于同步修改产品状态。
- 旧“AI采集”卡片仍走既有流程；ERP 入口当前在“AI仓库 → 进入采集工作台”。扩展本地桥、持久离线采集及通知顶栏等方案要求不能由本次部署验收自动推定完成。

## 5. 真实验证证据

### 生产 API：50 项通过

执行窗口 `03:15:15–03:15:43 UTC`。检查包含运行时/fixture 安全检查，并非 50 个独立接口。详见 [完整脱敏结果](../../artifacts/erp-production/verify.json)。

链路：真实注册待审账号 → 精确批准本次账号并迁入隔离组织 → 真实登录 → 真实媒体上传 → collect 入库 → 图片 worker 下载 → 百炼三标题和图生图 → 人工选择接口 → READY → 定价/listing → JSON 导出 → 通知汇总与读回。

- 未启动 `buildApp` 或临时数据库，未注入模型/下载 mock，也未自行签 JWT。
- 采集输入为明确标注的人工 JSON，图片为自绘蓝色容器 PNG；测试供应商明确标记“非真实货盘”，不假冒第三方真实采集。
- 百炼只请求一次三标题和一次一张图，无自动重试；原图与 AI 图都已入库，可真实 HTTP 读取，原图未被替换。
- eBay 三标题均符合 80 字符限制；Amazon 复用已生成标题，不额外计费请求。
- 定价使用成本 10 USD、运费 2 USD，与公式核对；手改 eBay 47.21、Amazon 59.34 后，重算和再生成均不覆盖。
- 导出包含 2 张本地图片和 2 个平台草稿，完整性标志通过；没有执行真实平台发布。
- 变更列表为空；汇总为真实手动调用生成的“0 项变更”，不表示自动巡盘运行过。
- 3 项明确排除：真实货盘 DOM、自动巡盘、平台真实刊登。其余扩展验证边界见模块表。

### 真实客户端：13 项通过，5 张截图

执行窗口 `03:21:13–03:21:21 UTC`。详见 [客户端网络与检查结果](../../artifacts/erp-production/real-ui/report.json)。

独立临时 userData，真实 Electron 主进程/preload/renderer，连接同一生产服务；没有 `page.route` 或替换业务响应。7 条记录的 ERP GET 请求全部 200；2 张图片均完成加载。登录通过真实 API，再将该次真实 token 写入隔离客户端，因此不声称测试了登录表单交互。

| 截图 | 内容及证据边界 |
|---|---|
| [采集池](../../artifacts/erp-production/real-ui/01-pool-real-api.png) | 真实 200 与正常空态，不再出现 Route not found |
| [产品库](../../artifacts/erp-production/real-ui/02-products-real-api.png) | 真实隔离验收商品，已入库、READY 显示“待发布” |
| [图片详情](../../artifacts/erp-production/real-ui/03-product-images-real-api.png) | 原图＋实际百炼生成图，均本地入库；AI 图已定稿 |
| [待确认变更](../../artifacts/erp-production/real-ui/04-changes-real-api.png) | 真实空列表，不伪造变更 |
| [通知中心](../../artifacts/erp-production/real-ui/05-notifications-real-api.png) | 真实手动汇总通知，不是自动巡盘证明 |

这组截图已经逐张查看。窗口测试曾因 macOS `/var`/`/private/var` 同目录别名，以及测试脚本错误使用 `BrowserWindow` 而中止；依据运行证据分别修正为 realpath 比较和实际的 `BaseWindow` API 后全部通过。未改动产品 UI 来迎合测试。

### 数据清理与账号收尾：26 项通过

详见 [收尾结果](../../artifacts/erp-production/cleanup.json)。仅清理精确匹配验收组织、runId、账号及商品的记录：1 个产品及子表、1 个测试供应商、2 条定价规则、2 条平台规则、1 条通知和对应媒体。媒体清理含确定性备用扩展名 key，不代表创建了 14 张图片。

保留测试组织、账号与历史审计以便追溯；账号已 `DISABLED`，6 枚未撤销刷新令牌已撤销，原 access token 再访问 ERP 实测被拒绝（401 `ACCOUNT_DISABLED`）。私有文件中的密码/token 已清空，测试客户端 localStorage 会话项已移除。未更改真实员工或真实业务数据。

截图记录的是清理前的验收状态；截图中的测试商品不会出现在用户自己的组织中，也不会为了展示效果而永久留在生产产品库。

## 6. 发布产物、备份与维护

- 发布目录：`/opt/yandu/releases/erp-20260925T030825Z`。
- 当前镜像：`yandu-erp:erp-20260925T030825Z`。
- 镜像 ID：`sha256:8805a5b6488a6fb21a2092a1199351d95e654b059c285d1c36380afe5f0e3a01`。
- 运行工作目录：`/erp`；入口 `dist/src/index.js`；媒体卷仍挂在 `/app/data/media`。
- 原 Compose：`/opt/yandu/app/docker-compose.yaml`；发布叠加配置：发布目录内 `compose.erp.json`。
- [部署过程记录](../../artifacts/erp-production/erp-20260925T030825Z/deployment.json)。

### 依赖安装修复

仓库 `server/package-lock.json` 含指向本机父目录 `.pnpm` 的 link，不能直接用于独立容器安装。前两次构建失败均发生在迁移/服务切换之前；最终按已有锁文件解析实际直接依赖版本，在隔离构建目录生成可移植锁并运行 `npm ci`。没有让 `npx` 临时升级 Prisma。

实际版本包括 Node 22.23.2、Prisma/client 6.19.3、Fastify 5.10.0、TypeScript 5.7.3。未上传本地 `.env` 或用户数据。部署未使用的 PGlite 测试依赖从部署专用 manifest 排除；仓库原 package/lock 没有因此整体改写。

[实际部署锁文件](../../artifacts/erp-production/erp-20260925T030825Z/deployed-package-lock.json) SHA-256：`4fd5897032ca89170eaa14fef9ab1086f71d2153c17e616efbadeac5ae49ce38`。

### 备份和回滚

受限权限备份目录：`/opt/yandu/releases/erp-20260925T030825Z/backup/`。

| 备份 | 大小/状态 |
|---|---|
| `database.dump` | 25,155,181 字节；`pg_restore --list` 通过，未做完整恢复演练 |
| `media.tar.gz` | 105 字节；原媒体目录快照 |
| `server-config-source.tar.gz` | 235,554 字节；旧服务源码与配置，按敏感配置保护，不公开 |
| 旧镜像 | `yandu-erp:rollback-erp-20260925T030825Z` |

后续重建/启动该版本必须使用两个 Compose 文件，避免仅用旧基础 Compose 意外切回旧版本。下面是服务器上的维护命令，未为本报告再次执行：

```sh
docker compose -p app -f /opt/yandu/app/docker-compose.yaml -f /opt/yandu/releases/erp-20260925T030825Z/compose.erp.json up -d --no-deps --no-build app
```

需要业务镜像回滚时，使用已保留的回滚叠加配置：

```sh
docker compose -p app -f /opt/yandu/app/docker-compose.yaml -f /opt/yandu/releases/erp-20260925T030825Z/compose.rollback.json up -d --no-deps --no-build app
```

镜像回滚保留兼容的 ERP 新增表，不自动用旧备份覆盖生产数据库。未做实际故障回滚演练，不宣称恢复时长已验证。

本次部署脚本具有“生产只有 9 个旧迁移”的首次发布前置断言，已上线后不可盲目整套重跑；后续升级应从当前 10 个迁移状态规划。真实 AI 验收脚本也有防重复收费保护，账号现已停用且 fixture 清理，不能直接重跑旧会话。

## 7. 后续投产前必须补齐

1. 配置可信 HTTPS 证书及域名/入口，复测客户端鉴权和模型媒体读取；不以关闭证书验证代替修复。
2. 为真实业务组织建立供应商与有效规则，实测登录、单品、列表批采和需鉴权的图片下载；确认旧入口与新 ERP 入口的使用边界。
3. 补齐 SERVER/CLIENT 巡盘生产实现、任务回传、夜间窗口及失败恢复，再开启调度并验收非空变更、人工确认、紧急标红和早间自动汇总。
4. 对实际员工完成角色分配与生产双角色权限验收；针对目标币种补汇率、目标模型补商品一致性人工验收。
5. 如需向其他电脑交付，另行完成桌面安装包发布与升级验证。离线 ZIP、持久化队列恢复等不属于本次已经交付的能力。

**最终状态：服务端上线与本次限定范围的真实验证已完成；完整 ERP 业务投产仍有上述明确限制。**
