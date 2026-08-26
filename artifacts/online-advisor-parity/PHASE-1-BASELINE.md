# 在线参谋 100% 功能迁移：第一阶段基线

基线日期：2026-08-03  
源项目：`/Users/zyc/Desktop/DeepSeek智能体`  
目标模块：`/Users/zyc/Desktop/砚都跨境/src/renderer/OnlineAdvisor.tsx` 及 `src/main/advisor/`  

## 1. 第一阶段完成标准

- 以源项目源码和既有验收报告为准，不以截图或目标模块现状反推需求。
- 每项用户可见功能都有唯一编号、源证据、目标现状和后续验收动作。
- 状态只允许：`已具备`、`部分具备`、`仅后端`、`缺失`、`容器适配`。
- `部分具备`、`仅后端`、`缺失`均不计入最终 100% 完成。
- 独立应用外壳允许改造成砚都跨境内嵌模块，但行为能力不得减少。
- 第一阶段只建立基线，不修改功能实现或迁移用户数据。

## 2. 证据优先级

1. 源项目当前源码：`src/App.tsx`、`electron/*.ts`。
2. 源项目阶段验收报告：`baseline/*REPORT.md`。
3. 已打包源应用：`/Users/zyc/Desktop/DeepSeek Codex.app`。
4. 目标项目源码和实际 Electron 界面。

## 3. 状态定义

| 状态 | 定义 | 后续要求 |
|---|---|---|
| 已具备 | 目标界面存在且完整调用目标后端 | 仍需端到端回归 |
| 部分具备 | 有入口或实现，但行为、信息或保护不完整 | 补齐至源项目等价 |
| 仅后端 | 主进程或共享类型已有能力，当前界面不可操作 | 接通 preload、类型和 UI |
| 缺失 | 目标端没有等价能力 | 从源项目迁移 |
| 容器适配 | 独立应用外壳改为砚都跨境模块外壳 | 验证替代行为，不要求复制品牌窗口 |

## 4. 功能基线矩阵

### A. 应用框架与连接状态

| ID | 源功能 | 源证据 | 当前状态 | 目标证据/差距 | 最终验收动作 |
|---|---|---|---|---|---|
| A-01 | 顶部显示当前项目名称和完整路径 | `src/App.tsx:188-203, 991-1025` | 部分具备 | `OnlineAdvisor.tsx:294-301` 只显示末级目录，完整路径仅 title | 名称、完整路径、当前任务同时可辨认 |
| A-02 | 显示执行引擎连接状态和详细来源 | `src/App.tsx:991-1025` | 已具备 | 顶部显示连接状态，详情在 title | 启动、断网、代理异常三种状态实测 |
| A-03 | 当前任务标题和任务实际模型 | `src/App.tsx:196-203, 1265-1295` | 部分具备 | 有任务标题；历史任务实际模型未在标题区呈现 | 打开历史任务后显示其真实模型且不改变新任务偏好 |
| A-04 | 独立 DeepSeek Codex 窗口和品牌 | `electron/main.ts:172-194` | 容器适配 | 已替换为砚都跨境 → AI参谋 → 在线参谋 | 模块可独立进入、退出，不破坏主应用导航 |
| A-05 | app-server 和代理随应用启动、退出清理 | `electron/main.ts`, `electron/proxyManager.ts` | 已具备 | `AdvisorRuntime.ts` 与主应用 shutdown 已接入 | 启停、异常退出、无残留进程实测 |

### B. 项目管理与搜索

| ID | 源功能 | 源证据 | 当前状态 | 目标证据/差距 | 最终验收动作 |
|---|---|---|---|---|---|
| B-01 | 选择或创建项目目录 | `src/App.tsx:536-559` | 已具备 | 顶部“工作区”调用 `selectProject` | 选择、新建、取消三种路径实测 |
| B-02 | 历史任务按完整 workspacePath 分组 | `src/App.tsx:204-242` | 缺失 | 当前历史为单层列表 | 多项目任务无遗漏、无重复地分组 |
| B-03 | 项目展开/折叠 | `src/App.tsx:460-477` | 缺失 | 无项目节点 | 手动展开折叠并保持任务顺序 |
| B-04 | 项目展开状态跨重载保存 | `PROJECT-GROUPING-PHASE-1-REPORT.md:7-14` | 缺失 | 无对应偏好 | 重启后恢复展开状态 |
| B-05 | 显示项目名称、完整路径和任务数量 | `src/App.tsx:1096-1170` | 缺失 | 无项目分组头 | 同名目录可通过完整路径区分 |
| B-06 | 在指定项目中创建新任务 | `src/App.tsx:545-595, 1128-1147` | 部分具备 | 可切换工作区后新建，但无项目菜单入口 | 项目菜单一键新建且工作区正确 |
| B-07 | 在访达中显示项目 | `src/App.tsx:1148-1157` | 仅后端 | `revealProject` 已暴露，UI未调用 | Finder 定位真实目录 |
| B-08 | 修改项目显示名称，不改磁盘目录 | `src/App.tsx:479-487` | 缺失 | 无项目别名状态 | 改名、重启保持、磁盘目录不变 |
| B-09 | 隐藏项目但保留数据 | `src/App.tsx:488-495` | 缺失 | 无隐藏项目状态 | 隐藏后不显示，数据文件仍存在 |
| B-10 | 恢复隐藏项目和隐藏任务 | `src/App.tsx:524-529, 1088-1093` | 缺失 | 无恢复入口 | 任一隐藏项存在时显示恢复入口并完整恢复 |
| B-11 | 搜索项目显示名称和完整路径 | `src/App.tsx:221-242, 1045-1085` | 缺失 | 无搜索 | 关键字匹配项目并自动展开 |
| B-12 | 搜索任务标题和用户原始需求正文 | `SEARCH-PHASE-5-REPORT.md:7-15` | 缺失 | 无搜索 | 不搜索终端日志；隐藏项不出现在结果中 |
| B-13 | 搜索清空、Escape关闭和无结果提示 | `src/App.tsx:1058-1085` | 缺失 | 无搜索 | 三项键盘/空状态交互实测 |

### C. 会话与任务记录

| ID | 源功能 | 源证据 | 当前状态 | 目标证据/差距 | 最终验收动作 |
|---|---|---|---|---|---|
| C-01 | 启动时加载最近任务 | `PHASE-5-REPORT.md:9-16` | 已具备 | `OnlineAdvisor.tsx:126-147` | 重启后任务数量和排序一致 |
| C-02 | 点击历史任务恢复消息、活动和附件 | `src/App.tsx:357-458` | 部分具备 | 可恢复消息和附件；分支、编辑、完整状态未恢复到 UI | 对比源任务全部事件和附件 |
| C-03 | 历史条目显示状态和执行时间 | `PHASE-5-REPORT.md:78-82` | 部分具备 | 显示状态和更新时间，不显示执行时长 | 完成/失败/停止及执行时长均显示 |
| C-04 | 重命名任务 | `src/App.tsx:496-507` | 已具备 | 历史菜单已有重命名 | 改名、重启、导出文件名实测 |
| C-05 | 导出脱敏 Markdown 报告 | `src/App.tsx:531-535` | 已具备 | 历史菜单已有导出 | 检查内容、权限和密钥脱敏 |
| C-06 | 当前任务固定导出入口和结果提示 | `src/App.tsx:1238-1245` | 缺失 | 只有历史项菜单，无固定按钮和成功提示 | 当前任务一键导出并显示路径/结果 |
| C-07 | 隐藏任务但不删除记录 | `src/App.tsx:508-515` | 缺失 | 无隐藏动作 | 隐藏、恢复、文件仍存在 |
| C-08 | 永久删除并二次确认 | `src/App.tsx:516-523` | 已具备 | 当前有确认和删除 | 已完成任务及附件目录被删除 |
| C-09 | 运行中/待审批任务禁止删除 | `PROJECT-TASK-MANAGEMENT-PHASE-4-REPORT.md:23-26` | 部分具备 | UI未明确禁用；需验证后端保护 | 运行和待审批状态均无法删除 |
| C-10 | 异常退出任务恢复为 stopped 并记录原因 | `PHASE-5-REPORT.md:9-16` | 仅后端 | `SessionStore` 已保留恢复逻辑，UI未专项验证 | 强制退出后状态和原因可见 |
| C-11 | 保存模型、权限、项目、时间、用量、失败原因 | `PHASE-5-REPORT.md:9-16, 48-54` | 仅后端 | 存储结构保留，当前 UI只展示一部分 | 导出报告与源任务字段逐项比较 |

### D. 对话、编辑与分支

| ID | 源功能 | 源证据 | 当前状态 | 目标证据/差距 | 最终验收动作 |
|---|---|---|---|---|---|
| D-01 | 流式显示助手回答 | `PHASE-1-REPORT.md:9-16` | 已具备 | `OnlineAdvisor.tsx:151-177` | 真实模型逐段输出 |
| D-02 | 停止当前任务 | `src/App.tsx:854-871` | 已具备 | 输入区运行时显示停止 | 中断回合并清理后台进程 |
| D-03 | 运行中补充要求（steer） | `src/App.tsx:644-659` | 仅后端 | `steerChat` 已暴露，UI提交逻辑不调用 | 运行中提交补充要求并留存事件 |
| D-04 | 编辑历史用户消息 | `src/App.tsx:749-847, 1320-1385` | 缺失 | 无编辑入口和状态 | 编辑文本与附件后重新执行 |
| D-05 | 编辑消息生成新分支 | `src/App.tsx:791-847` | 缺失 | Store有分支数据，UI/bridge未闭环 | 原版本不变，新分支独立运行 |
| D-06 | 选择并恢复消息分支 | `src/App.tsx:848-852, 1435-1480` | 仅后端 | 主进程有 `advisor:sessions:select-branch`，共享API/preload/UI缺失 | 在原版本和编辑版本之间切换 |
| D-07 | 编辑分支克隆原附件 | `src/App.tsx:734-747` | 仅后端 | 主进程有 `advisor:images:clone`，共享API/preload/UI缺失 | 新分支附件数量和内容一致 |
| D-08 | 复制用户/助手消息并显示“已复制” | `src/App.tsx:184-185, 1412-1427` | 缺失 | 无复制交互 | 点击复制、剪贴板内容、状态复原 |
| D-09 | 历史任务使用自身模型，新任务保持偏好模型 | `MODEL-PICKER-PHASE-3-REPORT.md:7-14` | 部分具备 | 请求记录模型，但历史界面未完整区分展示 | 切换偏好后打开旧任务验证模型不变 |

### E. 图片与附件

| ID | 源功能 | 源证据 | 当前状态 | 目标证据/差距 | 最终验收动作 |
|---|---|---|---|---|---|
| E-01 | 点击选择多张图片 | `src/App.tsx:873-921` | 已具备 | “＋”按钮调用 `selectImages` | 多选、取消、格式限制实测 |
| E-02 | 拖放图片 | `src/App.tsx:976-980, 1489-1500` | 缺失 | composer无 drag/drop | 拖入多图、拖入非图片、视觉反馈 |
| E-03 | 从剪贴板粘贴图片 | `src/App.tsx:982-989, 1597` | 缺失 | textarea无 onPaste | 截图粘贴并生成附件 |
| E-04 | 图片缩略图预览 | `src/App.tsx:923-975` | 仅后端 | `previewImage` 已暴露，UI只显示缩略图 | 点击打开大图、前后切换、关闭 |
| E-05 | 删除草稿附件 | `src/App.tsx:898-921` | 已具备 | 当前缩略图有删除按钮 | 删除单张和最后一张状态正确 |
| E-06 | 编辑消息时删除和重新上传附件 | `src/App.tsx:749-789` | 缺失 | 无消息编辑 | 编辑态附件完整操作 |
| E-07 | 新建任务清理未提交附件会话 | `UI-SIMPLIFICATION-PHASE-5-REPORT.md:9-18` | 已具备 | `newConversation` 调用 discard | 草稿目录无残留 |
| E-08 | 原图、缩略图、manifest和分析报告隔离保存 | `PHASE-4-REPORT.md:9-19` | 已具备 | AttachmentService基本同源移植 | 文件数量、权限、目录隔离实测 |
| E-09 | 图片分析失败不阻断文本任务 | `PHASE-4-REPORT.md:91-99` | 仅后端 | AdvisorRuntime保留视觉降级，UI无专项错误呈现 | 注入失败适配器后文本仍完成 |
| E-10 | 图片错误单独提示 | `src/App.tsx:152-156` | 部分具备 | 统一 notice，缺少图片专用错误状态 | 图片错误不覆盖聊天/导出错误 |

### F. 执行过程与状态语义

| ID | 源功能 | 源证据 | 当前状态 | 目标证据/差距 | 最终验收动作 |
|---|---|---|---|---|---|
| F-01 | 结构化显示计划、命令、文件、视觉和状态事件 | `src/App.tsx:2090-2140` | 已具备 | 当前 activities 可展开 | 每种事件至少一个真实样本 |
| F-02 | 执行过程默认折叠，最终回答为主层级 | `UI-SIMPLIFICATION-PHASE-2-REPORT.md:9-17` | 已具备 | 当前使用 details 折叠 | 完成任务默认折叠 |
| F-03 | 折叠状态显示警告/错误数量 | `src/App.tsx:2090-2135` | 缺失 | 当前只显示活动总数 | 警告和错误计数独立可见 |
| F-04 | 任务失败时执行过程自动展开 | `UI-SIMPLIFICATION-PHASE-2-REPORT.md:9-17` | 缺失 | details无受控自动展开 | 终止失败后自动显示关键错误 |
| F-05 | 任务状态与单个步骤失败分离 | `UI-SIMPLIFICATION-PHASE-1-REPORT.md:9-16` | 部分具备 | 后端语义保留，目标UI未覆盖所有状态 | 普通命令失败后模型继续且任务不误标失败 |
| F-06 | waitingApproval显示待处理数量 | `UI-SIMPLIFICATION-PHASE-1-REPORT.md:9-16` | 部分具备 | 状态标签可接收数量，界面审批卡逐项铺开 | 多审批时标题、数量和状态一致 |
| F-07 | 完整命令、输出、Diff和决定可审计 | `PHASE-5-REPORT.md:35-54` | 部分具备 | activities显示detail，但恢复/导出/UI覆盖需核对 | UI和导出报告均不丢字段 |

### G. 审批与权限

| ID | 源功能 | 源证据 | 当前状态 | 目标证据/差距 | 最终验收动作 |
|---|---|---|---|---|---|
| G-01 | 审批队列按顺序处理并显示数量 | `src/App.tsx:1501-1516` | 部分具备 | 当前把所有审批卡同时渲染，无队列摘要 | 多审批只操作当前项并显示剩余数 |
| G-02 | 首屏显示类型、命令/变更摘要 | `UI-SIMPLIFICATION-PHASE-3-REPORT.md:9-16` | 部分具备 | 有标题和原因，缺少统一摘要函数 | 命令和文件审批摘要可辨认 |
| G-03 | 详情显示目录、原因、完整命令和Diff | `src/App.tsx:1517-1532` | 已具备 | 当前 detail/diff 可展开，但cwd显示需核对 | 命令与文件审批各实测一次 |
| G-04 | 拒绝、批准、本任务允许 | `src/App.tsx:1533-1561` | 已具备 | 三种按钮已接入 | 三种决定逐项验证且写入记录 |
| G-05 | 审批后恢复运行，停止时取消待审批 | `PHASE-3-REPORT.md:81-89` | 仅后端 | Runtime保留逻辑，当前UI未专项验收 | 等待时停止，确认无目标操作和残留进程 |
| G-06 | 工作区外路径明确提示并单独批准 | `UI-SIMPLIFICATION-PHASE-1-REPORT.md:9-16` | 仅后端 | Runtime保留预检，UI依赖活动和审批显示 | 项目外只读拒绝/本任务记住/继续实测 |
| G-07 | 完全访问权限启用前二次确认 | `src/App.tsx:602-615` | 缺失 | 当前原生下拉直接切换 fullAccess | 显示风险说明，取消后保持原权限 |
| G-08 | 删除、发布、系统修改等高风险策略 | `DEFAULT-APPROVAL-POLICY-REPORT.md:16-55` | 已具备 | ApprovalPolicy同源移植 | 策略测试用例全部通过 |

### H. 个性化与本地记忆

| ID | 源功能 | 源证据 | 当前状态 | 目标证据/差距 | 最终验收动作 |
|---|---|---|---|---|---|
| H-01 | 务实、简洁、友好、专业四种回复风格 | `src/App.tsx:1767-1820` | 仅后端 | 类型和设置存储支持 personality，当前设置窗无选择器 | 四种风格保存并实际影响新任务提示 |
| H-02 | 全局自定义指令 | `src/App.tsx:1821-1831` | 已具备 | 当前设置窗有自定义要求 | 保存、重启、注入回合实测 |
| H-03 | 项目记忆开关 | `src/App.tsx:1832-1859` | 已具备 | 当前设置窗有记忆开关 | 关闭后不检索，开启后恢复 |
| H-04 | 工具记忆独立开关 | `src/App.tsx:1860-1877` | 仅后端 | settings含 toolMemoryEnabled，当前UI无入口 | 关闭项目记忆时自动禁用工具记忆 |
| H-05 | 记忆数量固定显示 | `src/App.tsx:1247-1262` | 已具备 | 侧栏按钮显示记忆状态/数量 | 数量与存储实际记录一致 |
| H-06 | 重置记忆基线但不删除历史 | `src/App.tsx:1878-1890` | 已具备 | 当前有清空记忆按钮 | 重置时间更新、历史文件不变 |
| H-07 | 个性化设置保存提示、取消和滚动适配 | `PERSONALIZATION-MEMORY-REPORT.md:17-24` | 部分具备 | 有保存/关闭，缺少完整设置和专项响应式验收 | 默认及900×650窗口完整可操作 |

### I. 输入区与模型选择

| ID | 源功能 | 源证据 | 当前状态 | 目标证据/差距 | 最终验收动作 |
|---|---|---|---|---|---|
| I-01 | 输入框按内容自动增高，最大140px | `UI-SIMPLIFICATION-PHASE-5-REPORT.md:9-18` | 缺失 | 当前 textarea 固定 rows=1，CSS仅max-height | 单行、多行、超长内容实测 |
| I-02 | Enter发送、Shift+Enter换行 | `src/App.tsx:1597-1610` | 已具备 | 当前键盘处理一致 | 输入法组合、空输入、换行实测 |
| I-03 | 圆形发送按钮与运行时停止按钮 | `src/App.tsx:1729-1755` | 已具备 | 当前同位置切换 | 运行开始/结束/失败状态切换 |
| I-04 | 添加图片按钮和拖放/粘贴提示 | `src/App.tsx:1600-1625` | 部分具备 | 有“＋”，无“图片”文字及拖放粘贴提示 | 入口含义和支持方式清晰可见 |
| I-05 | 模型菜单显示选中状态和速度/能力提示 | `src/App.tsx:1675-1728` | 部分具备 | 当前为原生select，仅显示全名 | 自定义菜单显示模型说明和选中态 |
| I-06 | 模型偏好跨重载保存 | `MODEL-PICKER-PHASE-3-REPORT.md:7-14` | 已具备 | localStorage已保存 | 重启后偏好不变 |
| I-07 | 任务运行期间禁用模型切换 | `MODEL-PICKER-PHASE-3-REPORT.md:7-14` | 缺失 | 当前select运行时仍可切换 | 运行中控件禁用，任务模型不可中途改变 |
| I-08 | Escape关闭模型/权限菜单 | `src/App.tsx:1627-1728` | 部分具备 | 使用原生select，无等价受控菜单 | 自定义菜单Escape行为实测 |
| I-09 | 权限菜单显示完整说明和当前选中态 | `src/App.tsx:1627-1674` | 部分具备 | 原生select只有名称 | 三档影响范围在菜单中清楚展示 |
| I-10 | 模型和权限位于输入框底栏 | `MODEL-PICKER-PHASE-3-REPORT.md:7-14` | 已具备 | 当前已移至底栏 | 默认及紧凑窗口不遮挡发送按钮 |
| I-11 | 900×650紧凑窗口无横向溢出 | 多份 `*-REPORT.md` 的界面验收 | 部分具备 | CSS有单一980px规则，尚无完整功能态验收 | 空白、长消息、审批、附件、菜单五态截图 |

### J. 模型、数据兼容与安全

| ID | 源功能 | 源证据 | 当前状态 | 目标证据/差距 | 最终验收动作 |
|---|---|---|---|---|---|
| J-01 | DeepSeek V4 Flash / Pro | `PHASE-1-REPORT.md:9-16` | 已具备 | 两个模型已在目标列表 | 两模型真实回复、工具、停止 |
| J-02 | ChatGPT模型扩展 | 目标新增要求 | 已具备 | `OpenAI ChatGPT Latest`已配置；账户无credits | 充值后完成相同工具闭环 |
| J-03 | 原历史会话数据迁移 | `~/Library/Application Support/DeepSeek Codex/sessions` | 缺失 | 目标使用新的应用数据目录 | 任务总数、字段、状态逐项一致 |
| J-04 | 原附件数据迁移 | `~/Library/Application Support/DeepSeek Codex/attachments` | 缺失 | 目标新目录没有一次性迁移 | 会话附件数、哈希、预览逐项一致 |
| J-05 | 原个性化和记忆配置迁移 | `~/Library/Application Support/DeepSeek Codex/personalization.json` | 缺失 | 目标新目录独立 | 设置、记忆数量、resetAt一致 |
| J-06 | 项目别名、隐藏项、展开态、模型和权限偏好迁移 | 源 `App.tsx:160-185` localStorage键 | 缺失 | 当前目标使用不同renderer origin/键 | 迁移后所有偏好可见且可恢复 |
| J-07 | 迁移只复制，不删除源数据 | 第一阶段方案约束 | 缺失 | 尚未实施迁移 | 迁移前后源目录哈希不变 |
| J-08 | API Key不进入渲染进程和前端构建 | `PHASE-1-REPORT.md:14-17` | 已具备 | 密钥仅主进程环境读取 | 源码和dist密钥扫描为0 |
| J-09 | contextIsolation、sandbox、nodeIntegration关闭 | `PHASE-1-REPORT.md:14-17` | 已具备 | 主WebContentsView安全设置保留 | Electron配置静态和运行时检查 |
| J-10 | 导出和持久化统一脱敏 | `PHASE-5-REPORT.md:67-74` | 已具备 | SessionStore同源移植 | 注入测试凭据后JSON和Markdown均脱敏 |

## 5. IPC覆盖基线

源前端实际调用24个API方法。目标UI共调用20个Advisor API，其中17个与源API等价，另外3个是目标新增的`models`、`getDefaultProject`、`getSession`；源API另有5个已暴露但未被目标UI调用，2个主进程已有但未进入目标共享API/preload。

### 目标UI已调用

源API等价调用：`deleteSession`、`discardImages`、`exportSession`、`getConnectionStatus`、`getPersonalization`、`listImages`、`listSessions`、`onChatEvent`、`removeImage`、`renameSession`、`resetMemory`、`resolveApproval`、`savePersonalization`、`selectImages`、`selectProject`、`sendChat`、`stopChat`。目标新增调用：`models`、`getDefaultProject`、`getSession`。

### 已暴露但目标UI未调用

`analyzeImages`、`previewImage`、`revealProject`、`saveImages`、`steerChat`。

### 主进程已有但目标共享API/preload缺失

- `selectBranch` → `advisor:sessions:select-branch`
- `cloneImages` → `advisor:images:clone`

## 6. 源报告追踪

以下报告中的功能已全部映射到矩阵编号：

| 源报告 | 覆盖矩阵 |
|---|---|
| `PHASE-0-REPORT.md` | A、J |
| `PHASE-1-REPORT.md` | A、D、I、J |
| `PHASE-2-REPORT.md` | A、D、F、J |
| `PHASE-3-REPORT.md` | F、G |
| `PHASE-4-REPORT.md` | E、J |
| `PHASE-5-REPORT.md` | C、F、J |
| `PHASE-6-REPORT.md` | A、C、I、J |
| `DEFAULT-APPROVAL-POLICY-REPORT.md` | G |
| `PERSONALIZATION-MEMORY-REPORT.md` | H、J |
| `PROJECT-GROUPING-PHASE-1-REPORT.md` | B |
| `SIDEBAR-PHASE-2-REPORT.md` | B、C、H |
| `MODEL-PICKER-PHASE-3-REPORT.md` | A、D、I |
| `PROJECT-TASK-MANAGEMENT-PHASE-4-REPORT.md` | B、C |
| `SEARCH-PHASE-5-REPORT.md` | B |
| `UI-SIMPLIFICATION-PHASE-1-REPORT.md` | F、G |
| `UI-SIMPLIFICATION-PHASE-2-REPORT.md` | F |
| `UI-SIMPLIFICATION-PHASE-3-REPORT.md` | G |
| `UI-SIMPLIFICATION-PHASE-4-REPORT.md` | A、B、C |
| `UI-SIMPLIFICATION-PHASE-5-REPORT.md` | E、I |

## 7. 后续阶段闸门

第二阶段开始前必须遵守：

1. 不删除或覆盖 `/Users/zyc/Desktop/DeepSeek智能体` 和旧应用数据。
2. 每个实现提交必须关联一个或多个矩阵ID。
3. 只有“目标界面可操作 + 后端真实执行 + 重启可恢复”才能改为`已具备`。
4. 单纯存在IPC、类型或按钮不算完成。
5. 每阶段结束重新统计状态；最终不得存在`部分具备`、`仅后端`或`缺失`。

## 8. 第一阶段验收记录

- [x] 基线文件可读取。
- [x] 所有91个矩阵行都有合法ID、状态、源证据和验收动作。
- [x] 91个ID无重复。
- [x] 五种状态之外没有未分类值。
- [x] 源前端24个API调用全部归类。
- [x] 19份源验收报告全部映射。
- [x] 源项目未因本阶段审计被修改；目标项目只新增本基线文档。
