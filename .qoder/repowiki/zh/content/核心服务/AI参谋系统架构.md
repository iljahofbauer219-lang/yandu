# AI参谋系统架构

<cite>
**本文引用的文件**
- [package.json](file://package.json)
- [src/main/main.ts](file://src/main/main.ts)
- [src/main/advisor/AdvisorRuntime.ts](file://src/main/advisor/AdvisorRuntime.ts)
- [src/main/advisor/linduoServerClient.ts](file://src/main/advisor/linduoServerClient.ts)
- [src/main/services/linduoHttp.ts](file://src/main/services/linduoHttp.ts)
- [server/src/modules/linduo/chat-routes.ts](file://server/src/modules/linduo/chat-routes.ts)
- [server/src/modules/linduo/chat-service.ts](file://server/src/modules/linduo/chat-service.ts)
- [src/main/advisor/SessionStore.ts](file://src/main/advisor/SessionStore.ts)
- [src/main/advisor/AttachmentService.ts](file://src/main/advisor/AttachmentService.ts)
- [src/main/advisor/MultimodalVision.ts](file://src/main/advisor/MultimodalVision.ts)
- [server/src/app.ts](file://server/src/app.ts)
- [server/src/config.ts](file://server/src/config.ts)
- [src/shared/advisor.ts](file://src/shared/advisor.ts)
- [src/shared/contracts.ts](file://src/shared/contracts.ts)
- [src/renderer/App.tsx](file://src/renderer/App.tsx)
- [src/renderer/OnlineAdvisorExperience.tsx](file://src/renderer/OnlineAdvisorExperience.tsx)
</cite>

## 更新摘要
**所做更改**
- 新增Linduo模型HTTP/SSE管道集成章节，替代直接Codex调用
- 更新AI参谋运行时组件分析，包含Linduo流式聊天、SSE事件解析和信号处理
- 增强服务器端路由和服务层，支持认证、授权和流式响应
- 更新架构图表以反映新的Linduo模型请求路由流程
- 新增错误处理和超时控制机制说明
- 增强文档处理能力，支持Linduo模型的专用消息格式

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考量](#性能考量)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本仓库是一个面向跨境电商的桌面端应用与配套后端服务，围绕"选品、素材生成、合规校验、刊登优化、AI参谋"等能力构建。整体采用 Electron 主进程 + Web 渲染层 + Fastify 后端服务的分层架构：
- 主进程负责浏览器工作区、本地资源管理、第三方服务集成（图像、翻译、视频、eBay 等）、任务编排与 IPC 通信。
- 渲染层提供多模块 UI（团队工作台、AI参谋、AI采集、AI美工、AI视频、AI员工等）。
- 后端服务提供认证、权限、数据持久化、媒体存储、AI 网关路由、合规引擎、eBay 业务接口等。

该文档从系统架构、组件关系、数据流、处理逻辑、集成点、错误处理与性能特性等方面展开，帮助读者快速理解并定位关键实现。

## 项目结构
- 根目录包含 Electron 工程配置、脚本、工具集、测试与产物目录。
- src/main 为主进程代码，涵盖应用初始化、服务装配、IPC 路由、浏览器工作区、数据库访问、AI 参谋运行时等。
- src/renderer 为 React 渲染层，组织页面与状态，调用主进程与后端 API。
- server 为 Fastify 后端，统一注册路由、鉴权、错误处理、健康检查与跨域策略。
- shared 定义前后端共享的类型契约，保证类型一致性与可维护性。

```mermaid
graph TB
subgraph "桌面端(Electron)"
Main["主进程<br/>main.ts"]
Renderer["渲染层<br/>App.tsx"]
Advisor["AI参谋运行时<br/>AdvisorRuntime.ts"]
LinduoClient["Linduo客户端<br/>linduoServerClient.ts"]
SessionStore["会话存储<br/>SessionStore.ts"]
AttachmentService["附件服务<br/>AttachmentService.ts"]
MultimodalVision["多模态视觉<br/>MultimodalVision.ts"]
end
subgraph "后端(Fastify)"
App["应用入口<br/>app.ts"]
Config["配置中心<br/>config.ts"]
ChatRoutes["聊天路由<br/>chat-routes.ts"]
ChatService["聊天服务<br/>chat-service.ts"]
end
subgraph "共享契约"
Contracts["类型契约<br/>advisor.ts, contracts.ts"]
end
Renderer --> Main
Renderer --> App
Main --> App
Main --> Advisor
Advisor --> LinduoClient
Advisor --> SessionStore
Advisor --> AttachmentService
Advisor --> MultimodalVision
LinduoClient --> ChatRoutes
ChatRoutes --> ChatService
Renderer -.-> Contracts
Main -.-> Contracts
App -.-> Contracts
```

**图表来源**
- [src/main/main.ts:1-120](file://src/main/main.ts#L1-L120)
- [src/main/advisor/AdvisorRuntime.ts:1789-2049](file://src/main/advisor/AdvisorRuntime.ts#L1789-L2049)
- [src/main/advisor/linduoServerClient.ts:165-213](file://src/main/advisor/linduoServerClient.ts#L165-L213)
- [server/src/modules/linduo/chat-routes.ts:55-142](file://server/src/modules/linduo/chat-routes.ts#L55-L142)
- [server/src/modules/linduo/chat-service.ts:49-197](file://server/src/modules/linduo/chat-service.ts#L49-L197)
- [src/main/advisor/SessionStore.ts:124-138](file://src/main/advisor/SessionStore.ts#L124-L138)
- [src/main/advisor/AttachmentService.ts:356-423](file://src/main/advisor/AttachmentService.ts#L356-L423)
- [src/main/advisor/MultimodalVision.ts:19-33](file://src/main/advisor/MultimodalVision.ts#L19-L33)
- [server/src/app.ts:21-70](file://server/src/app.ts#L21-L70)
- [server/src/config.ts:9-37](file://server/src/config.ts#L9-L37)
- [src/shared/advisor.ts:118-123](file://src/shared/advisor.ts#L118-L123)

章节来源
- [package.json:1-50](file://package.json#L1-L50)
- [src/main/main.ts:1-120](file://src/main/main.ts#L1-L120)
- [server/src/app.ts:21-70](file://server/src/app.ts#L21-L70)

## 核心组件
- 主进程应用入口：初始化各类服务（图像、翻译、eBay、知识库守卫、RAGFlow 等），注册 IPC 通道，管理浏览器工作区与本地数据。
- AI参谋运行时：封装与 Codex app-server 的交互，处理会话、分支、审批策略、活动事件、任务状态与使用量统计，**新增Linduo模型HTTP/SSE管道集成**。
- Linduo HTTP客户端：**新增**专门用于Linduo模型请求的HTTP客户端，支持SSE流式响应和错误分类。
- 会话存储：管理任务持久化、线程映射、分支管理，**新增支持providerId跟踪的智能分支管理**。
- 附件服务：**新增文档处理能力**，支持PDF、DOCX、RTF、TXT、MD等格式的文本提取和保存。
- 多模态视觉：**增强图像识别能力**，支持通过Codex vision-sidecar进行图片描述和OCR识别。
- 后端应用：基于 Fastify，统一注册路由、JWT 鉴权、CORS、错误处理器与健康检查；按模块划分路由前缀。
- Linduo聊天服务：**新增**专门的聊天服务，处理OpenAI兼容协议的流式响应。
- 配置中心：集中读取环境变量，暴露端口、数据库、媒体存储、AI 网关密钥等配置项。
- 共享契约：定义平台、市场账户、eBay 商品详情、优化草稿、发布任务、视频工作室、内容优化、标题审计等类型。

章节来源
- [src/main/main.ts:102-118](file://src/main/main.ts#L102-L118)
- [src/main/advisor/AdvisorRuntime.ts:1789-2049](file://src/main/advisor/AdvisorRuntime.ts#L1789-L2049)
- [src/main/advisor/linduoServerClient.ts:165-213](file://src/main/advisor/linduoServerClient.ts#L165-L213)
- [server/src/modules/linduo/chat-service.ts:49-197](file://server/src/modules/linduo/chat-service.ts#L49-L197)
- [src/main/advisor/SessionStore.ts:124-138](file://src/main/advisor/SessionStore.ts#L124-L138)
- [src/main/advisor/AttachmentService.ts:356-423](file://src/main/advisor/AttachmentService.ts#L356-L423)
- [src/main/advisor/MultimodalVision.ts:19-33](file://src/main/advisor/MultimodalVision.ts#L19-L33)
- [server/src/app.ts:21-70](file://server/src/app.ts#L21-L70)
- [server/src/config.ts:9-37](file://server/src/config.ts#L9-L37)
- [src/shared/contracts.ts:73-180](file://src/shared/contracts.ts#L73-L180)

## 架构总览
系统由三层组成：
- 渲染层：React 页面与状态管理，通过 IPC 与主进程交互，并通过 HTTP 调用后端 API。
- 主进程：承载浏览器工作区、本地文件系统、外部服务集成、AI参谋运行时、任务调度与数据持久化。
- 后端服务：提供 RESTful API，统一鉴权、错误处理、媒体存储、AI 网关路由、合规引擎与 eBay 业务接口。

```mermaid
sequenceDiagram
participant UI as "渲染层(App.tsx)"
participant Main as "主进程(main.ts)"
participant Advisor as "AI参谋(AdvisorRuntime.ts)"
participant LinduoClient as "Linduo客户端(linduoServerClient.ts)"
participant ChatRoutes as "聊天路由(chat-routes.ts)"
participant ChatService as "聊天服务(chat-service.ts)"
participant Server as "后端(app.ts)"
participant DB as "数据库"
UI->>Main : IPC 调用(如打开eBay店铺/下载商品图片)
Main->>Server : HTTP 请求(认证/数据/媒体/AI路由)
Server-->>DB : 读写数据/迁移/导入
Main->>Advisor : 启动/发送消息/审批/停止
Advisor->>LinduoClient : 发起Linduo聊天请求
LinduoClient->>ChatRoutes : POST /api/linduo/chat
ChatRoutes->>ChatService : 创建服务实例
ChatService->>ChatService : 流式处理OpenAI协议
ChatService-->>ChatRoutes : SSE事件(delta/done/error)
ChatRoutes-->>LinduoClient : text/event-stream
LinduoClient-->>Advisor : 解析SSE事件
Advisor-->>Main : emitActivity/taskStatus/delta
Main-->>UI : 推送事件(活动/状态/增量文本)
alt Linduo模型选择
Advisor->>Advisor : executeLinduoTurn()
Advisor->>LinduoClient : streamLinduoChat()
else Codex模型选择
Advisor->>Advisor : runCodexTurn()
end
```

**图表来源**
- [src/main/main.ts:298-384](file://src/main/main.ts#L298-L384)
- [src/main/advisor/AdvisorRuntime.ts:1789-2049](file://src/main/advisor/AdvisorRuntime.ts#L1789-L2049)
- [src/main/advisor/linduoServerClient.ts:165-213](file://src/main/advisor/linduoServerClient.ts#L165-L213)
- [server/src/modules/linduo/chat-routes.ts:55-142](file://server/src/modules/linduo/chat-routes.ts#L55-L142)
- [server/src/modules/linduo/chat-service.ts:49-197](file://server/src/modules/linduo/chat-service.ts#L49-L197)
- [server/src/app.ts:21-70](file://server/src/app.ts#L21-L70)

## 详细组件分析

### 主进程应用入口（main.ts）
- 职责：
  - 初始化各类服务实例（图像、翻译、eBay、知识库守卫、RAGFlow、视频服务等）。
  - 管理浏览器工作区（打开 eBay 店铺、新建标签页、读取商品详情、下载图片、准备修订资料）。
  - 处理本地产品快照、媒体上传、尺寸检测、格式校验、完整性评估。
  - 构建发布任务、合规校验、图片检查、Seller Hub 预填与人工确认流程。
  - 注册 IPC 通道，向渲染层暴露能力（如 eBAY 相关操作、视频生成、报告导出等）。
- 关键流程示例（eBay 本地产品下载与快照）：
  - 解析 listingId -> 读取详情页 -> 合并价格与描述 -> 下载图片（并发限制）-> 计算完整性与哈希 -> 保存快照。
- 错误处理：
  - 对网络失败、图片格式不支持、尺寸不达标、大小超限等进行阻断或警告。
  - 在 Seller Hub 未打开时自动引导登录并重试。

```mermaid
flowchart TD
Start(["开始"]) --> Parse["解析listingId"]
Parse --> ReadDetails["读取商品详情"]
ReadDetails --> MergeCore{"是否可获取原价/描述?"}
MergeCore --> |是| DownloadImages["并发下载图片"]
MergeCore --> |否| Fallback["沿用本地缓存字段"]
DownloadImages --> Validate["校验格式/尺寸/大小"]
Validate --> Compute["计算完整性/缺失字段/内容哈希"]
Compute --> Save["保存本地产品快照"]
Fallback --> Save
Save --> End(["结束"])
```

**图表来源**
- [src/main/main.ts:412-491](file://src/main/main.ts#L412-L491)
- [src/main/main.ts:529-569](file://src/main/main.ts#L529-L569)

章节来源
- [src/main/main.ts:216-257](file://src/main/main.ts#L216-L257)
- [src/main/main.ts:298-384](file://src/main/main.ts#L298-L384)
- [src/main/main.ts:412-491](file://src/main/main.ts#L412-L491)
- [src/main/main.ts:529-569](file://src/main/main.ts#L529-L569)

### AI参谋运行时（AdvisorRuntime.ts）
- 职责：
  - 管理模型配置与权限模式（ask/agent/fullAccess）。
  - 连接 Codex app-server，处理会话、分支、回合、计划、命令执行、文件变更等事件。
  - 实现审批策略：命令执行与文件修改需根据策略自动批准或请求用户确认。
  - 维护任务状态、使用量统计、事件持久化、中断与清理。
  - 探针式连接 harness 网关，用于在线执行器可用性展示。
  - **新增Linduo模型HTTP/SSE管道集成**：当检测到Linduo模型时，绕过Codex app-server，直接通过HTTP/SSE与后端服务通信。
  - **新增ModelProfile-based effort参数处理**：每个模型配置包含effort字段，替代硬编码的推理深度设置。
  - **新增线程上下文恢复和自动回退机制**：当Codex app-server重启或线程丢失时，自动创建新线程并通知UI。
  - **增强文档处理能力**：集成AttachmentService进行文档文本提取和多模态视觉分析。
- 关键流程示例（发送消息与审批）：
  - 接收 IPC 消息 -> 校验参数 -> 启动/恢复线程 -> 发送消息 -> 监听通知 -> 更新状态 -> 持久化事件。
  - 当需要执行命令或修改文件时，依据策略决定是否自动批准或弹出审批。
  - **新增**：当thread/resume失败时，自动调用clearStoredThreadId清除失效的线程映射，然后重新thread/start创建新线程。
  - **新增**：检测当前分支的providerId与目标模型的providerId，如果不一致则自动fork创建新分支。
  - **新增**：处理文档附件，通过extractDocumentText提取纯文本内容。
  - **新增**：调用describeAttachments进行图像识别和分析。
  - **新增**：executeLinduoTurn函数处理Linduo模型请求，通过HTTP/SSE管道与后端通信。

```mermaid
sequenceDiagram
participant UI as "渲染层"
participant Main as "主进程"
participant Advisor as "AI参谋"
participant LinduoClient as "Linduo客户端"
participant ChatRoutes as "聊天路由"
participant ChatService as "聊天服务"
UI->>Main : IPC advisor : chat : send
Main->>Advisor : runCodexTurn(request)
alt Linduo模型检测
Advisor->>Advisor : 检测modelProfile.providerId === "linduo_proxy"
Advisor->>Advisor : executeLinduoTurn()
Advisor->>LinduoClient : streamLinduoChat()
LinduoClient->>ChatRoutes : POST /api/linduo/chat
ChatRoutes->>ChatService : 创建服务实例
ChatService-->>ChatRoutes : SSE事件流
ChatRoutes-->>LinduoClient : text/event-stream
LinduoClient-->>Advisor : 解析delta/done/error事件
Advisor-->>Main : emitActivity/taskStatus/delta
else Codex模型路径
Advisor->>Main : 传统Codex流程
end
Main-->>UI : 推送事件(活动/状态/增量文本)
```

**图表来源**
- [src/main/advisor/AdvisorRuntime.ts:1789-2049](file://src/main/advisor/AdvisorRuntime.ts#L1789-L2049)
- [src/main/advisor/linduoServerClient.ts:165-213](file://src/main/advisor/linduoServerClient.ts#L165-L213)
- [server/src/modules/linduo/chat-routes.ts:55-142](file://server/src/modules/linduo/chat-routes.ts#L55-L142)
- [server/src/modules/linduo/chat-service.ts:49-197](file://server/src/modules/linduo/chat-service.ts#L49-L197)

章节来源
- [src/main/advisor/AdvisorRuntime.ts:165-219](file://src/main/advisor/AdvisorRuntime.ts#L165-L219)
- [src/main/advisor/AdvisorRuntime.ts:1789-2049](file://src/main/advisor/AdvisorRuntime.ts#L1789-L2049)
- [src/main/advisor/AdvisorRuntime.ts:861-915](file://src/main/advisor/AdvisorRuntime.ts#L861-L915)
- [src/main/advisor/AdvisorRuntime.ts:1097-1334](file://src/main/advisor/AdvisorRuntime.ts#L1097-L1334)

### Linduo HTTP客户端（linduoServerClient.ts）
- 职责：
  - **新增**专门用于Linduo模型请求的HTTP客户端。
  - 强制限定服务器地址为本机回环，防止JWT泄漏到外部主机。
  - 提供流式聊天功能，返回未消费的Response供caller读取SSE流。
  - 统一的错误分类和处理，包括认证失败、模型不存在、速率限制等。
  - 超时控制和AbortSignal合并，避免长时间等待。
- 关键功能：
  - getLinduoChatModelsFromServer：获取当前用户可用的Linduo聊天模型列表。
  - streamLinduoChat：发起流式聊天调用，返回Response对象。
  - resolveServerBaseUrl：解析并验证服务器基础URL。
  - classifyHttpError：分类HTTP错误码并生成标准化错误信息。

```mermaid
flowchart TD
Request["Linduo聊天请求"] --> ResolveBase["解析服务器地址"]
ResolveBase --> AuthCheck{"检查认证令牌"}
AuthCheck --> |有效| CreateRequest["创建HTTP请求"]
AuthCheck --> |无效| ThrowError["抛出ADVISOR_SIGNED_OUT错误"]
CreateRequest --> FetchCall["发起fetch调用"]
FetchCall --> ResponseCheck{"检查响应状态"}
ResponseCheck --> |200 OK| ReturnResponse["返回Response对象"]
ResponseCheck --> |401/403| ClassifyAuth["分类认证错误"]
ResponseCheck --> |404| ClassifyNotFound["分类模型不存在"]
ResponseCheck --> |429| ClassifyRateLimit["分类速率限制"]
ResponseCheck --> |5xx| ClassifyUpstream["分类上游错误"]
ReturnResponse --> SSEStream["SSE流式读取"]
SSEStream --> EventParse["解析SSE事件"]
EventParse --> EmitEvents["发射delta/done/error事件"]
```

**图表来源**
- [src/main/advisor/linduoServerClient.ts:165-213](file://src/main/advisor/linduoServerClient.ts#L165-L213)
- [src/main/advisor/linduoServerClient.ts:29-50](file://src/main/advisor/linduoServerClient.ts#L29-L50)
- [src/main/advisor/linduoServerClient.ts:78-106](file://src/main/advisor/linduoServerClient.ts#L78-L106)

**章节来源**
- [src/main/advisor/linduoServerClient.ts:1-213](file://src/main/advisor/linduoServerClient.ts#L1-L213)

### 聊天路由（chat-routes.ts）
- 职责：
  - **新增**Linduo聊天补全SSE端点，处理POST /api/linduo/chat请求。
  - 实现认证中间件，确保用户已登录。
  - 模型白名单校验和用户授权检查。
  - SSE响应处理，实时推送聊天事件。
  - 客户端断开检测和优雅关闭。
- 关键功能：
  - linduoChatRoutes：注册聊天路由和处理函数。
  - sseHeaders：设置SSE响应头，禁用缓存和代理缓冲。
  - writeSseEvent：写入SSE事件到响应流。
  - userCanUseModel：检查用户是否有权限使用指定模型。

```mermaid
flowchart TD
Request["POST /api/linduo/chat"] --> Authenticate["认证中间件"]
Authenticate --> ParseBody["解析请求体"]
ParseBody --> CheckModel{"检查模型存在性"}
CheckModel --> |不存在| SendError["发送LINDUO_MODEL_NOT_FOUND"]
CheckModel --> |存在| CheckEnabled{"检查模型启用状态"}
CheckEnabled --> |禁用| SendDisabled["发送LINDUO_MODEL_DISABLED"]
CheckEnabled --> |启用| CheckGrant{"检查用户授权"}
CheckGrant --> |无授权| SendNotGranted["发送LINDUO_MODEL_NOT_GRANTED"]
CheckGrant --> |有授权| CreateService["创建聊天服务"]
CreateService --> HijackResponse["劫持响应流"]
HijackResponse --> WriteHeaders["写入SSE响应头"]
WriteHeaders --> StreamChat["流式处理聊天"]
StreamChat --> ForEachEvent["迭代事件流"]
ForEachEvent --> WriteEvent["写入SSE事件"]
WriteEvent --> NextEvent{"更多事件?"}
NextEvent --> |是| ForEachEvent
NextEvent --> |否| EndStream["结束流式响应"]
```

**图表来源**
- [server/src/modules/linduo/chat-routes.ts:55-142](file://server/src/modules/linduo/chat-routes.ts#L55-L142)
- [server/src/modules/linduo/chat-routes.ts:41-53](file://server/src/modules/linduo/chat-routes.ts#L41-L53)

**章节来源**
- [server/src/modules/linduo/chat-routes.ts:1-142](file://server/src/modules/linduo/chat-routes.ts#L1-L142)

### 聊天服务（chat-service.ts）
- 职责：
  - **新增**零度API聊天补全服务，处理OpenAI兼容协议的流式响应。
  - 实现M1范围：仅纯文本对话，不传tools字段，不处理vision message。
  - SSE流式解析，将OpenAI的SSE事件转换为内部事件格式。
  - 错误处理：包括密钥缺失、密钥无效、模型不存在、速率限制等。
  - 使用量统计：追踪prompt tokens、completion tokens和total tokens。
- 关键功能：
  - LinduoChatService类：聊天服务的主要实现。
  - streamChat：异步生成器方法，处理流式聊天。
  - fromConfig：从配置创建服务实例。
  - softDisableModel：软禁用不存在的模型。

```mermaid
flowchart TD
Start["开始流式聊天"] --> BuildBody["构建请求体"]
BuildBody --> SetTimeout["设置超时信号"]
SetTimeout --> FetchCall["发起HTTP请求"]
FetchCall --> StatusCheck{"检查响应状态"}
StatusCheck --> |401/403| YieldKeyInvalid["yield LINDUO_KEY_INVALID"]
StatusCheck --> |404| SoftDisable["软禁用模型"]
StatusCheck --> |429| YieldRateLimited["yield LINDUO_RATE_LIMITED"]
StatusCheck --> |其他错误| YieldUpstreamError["yield LINDUO_UPSTREAM_ERROR"]
StatusCheck --> |200 OK| ReadStream["读取响应流"]
ReadStream --> ParseSSE["解析SSE事件"]
ParseSSE --> DeltaEvent{"delta事件?"}
DeltaEvent --> |是| YieldDelta["yield delta事件"]
DeltaEvent --> |否| DoneEvent{"done事件?"}
DoneEvent --> |是| YieldDone["yield done事件"]
DoneEvent --> |否| ErrorEvent{"error事件?"}
ErrorEvent --> |是| YieldError["yield error事件"]
ErrorEvent --> |否| Continue["继续读取"]
Continue --> ParseSSE
```

**图表来源**
- [server/src/modules/linduo/chat-service.ts:49-197](file://server/src/modules/linduo/chat-service.ts#L49-L197)
- [server/src/modules/linduo/chat-service.ts:20-29](file://server/src/modules/linduo/chat-service.ts#L20-L29)

**章节来源**
- [server/src/modules/linduo/chat-service.ts:1-197](file://server/src/modules/linduo/chat-service.ts#L1-L197)

### 会话存储（SessionStore.ts）
- 职责：
  - 管理任务持久化、线程映射、分支管理、事件记录。
  - 提供任务创建、查询、更新、删除等CRUD操作。
  - **新增clearStoredThreadId函数**：处理Codex app-server重启后线程映射丢失的场景。
  - **新增支持providerId跟踪的分支管理**：每个分支现在可以跟踪其关联的模型提供商。
- 关键功能：
  - setStoredThreadId：保存线程ID到任务和当前活跃分支。
  - clearStoredThreadId：清除失效的线程映射，支持线程恢复失败后的清理。
  - createStoredBranch：创建新分支并关联线程ID，**新增支持providerId和model参数**。
  - selectStoredBranch：切换活跃分支并更新线程映射。
  - recoverInterruptedTasks：应用重启时恢复中断的任务状态。

**章节来源**
- [src/main/advisor/SessionStore.ts:113-138](file://src/main/advisor/SessionStore.ts#L113-L138)
- [src/main/advisor/SessionStore.ts:140-177](file://src/main/advisor/SessionStore.ts#L140-L177)
- [src/main/advisor/SessionStore.ts:248-262](file://src/main/advisor/SessionStore.ts#L248-L262)

### 附件服务（AttachmentService.ts）
- 职责：
  - **新增文档处理能力**：支持PDF、DOCX、DOC、RTF、TXT、MD等格式的文档保存和文本提取。
  - 管理图片附件的保存、预览、缩略图生成。
  - 提供附件会话的克隆、删除、列表查询等功能。
  - 集成多模态视觉分析，支持图像OCR和属性识别。
- 关键功能：
  - saveIncomingDocuments：保存文档文件，验证格式和大小限制。
  - extractDocumentText：从各种文档格式中提取纯文本内容。
  - analyzeSession：对附件进行视觉分析，生成结构化数据。
  - cloneAttachmentSession：复制图片和文档到新的会话。
  - removeAttachment：安全删除附件文件。

```mermaid
flowchart TD
Upload["上传文档"] --> Validate["验证格式/大小"]
Validate --> Save["保存到会话目录"]
Save --> Extract["提取文本内容"]
Extract --> OCR["可选OCR识别"]
OCR --> Store["存储分析结果"]
Store --> Manifest["更新manifest.json"]
Manifest --> Ready["附件可用"]
```

**图表来源**
- [src/main/advisor/AttachmentService.ts:356-423](file://src/main/advisor/AttachmentService.ts#L356-L423)
- [src/main/advisor/AttachmentService.ts:252-298](file://src/main/advisor/AttachmentService.ts#L252-L298)

**章节来源**
- [src/main/advisor/AttachmentService.ts:356-423](file://src/main/advisor/AttachmentService.ts#L356-L423)
- [src/main/advisor/AttachmentService.ts:252-298](file://src/main/advisor/AttachmentService.ts#L252-L298)
- [src/main/advisor/AttachmentService.ts:87-131](file://src/main/advisor/AttachmentService.ts#L87-L131)

### 多模态视觉（MultimodalVision.ts）
- 职责：
  - **增强图像识别能力**：通过Codex vision-sidecar进行图片描述和OCR识别。
  - 过滤和处理附件，区分图片和文档类型。
  - 调用外部视觉模型进行分析，支持超时控制和错误处理。
  - 生成结构化的视觉分析结果，包括OCR文本、标注框、产品属性等。
- 关键功能：
  - describeAttachments：批量处理附件，跳过文档类型，仅处理图片。
  - describeAttachment：对单个图片进行视觉分析，调用Codex二进制文件。
  - runCodexVision：执行外部视觉模型进程，处理输出和错误。

```mermaid
flowchart TD
Input["输入附件"] --> Filter["过滤文档类型"]
Filter --> Vision["调用vision-sidecar"]
Vision --> Process["处理输出结果"]
Process --> Result["生成结构化结果"]
Result --> Output["返回分析结果"]
```

**图表来源**
- [src/main/advisor/MultimodalVision.ts:19-33](file://src/main/advisor/MultimodalVision.ts#L19-L33)
- [src/main/advisor/MultimodalVision.ts:35-96](file://src/main/advisor/MultimodalVision.ts#L35-L96)

**章节来源**
- [src/main/advisor/MultimodalVision.ts:19-33](file://src/main/advisor/MultimodalVision.ts#L19-L33)
- [src/main/advisor/MultimodalVision.ts:35-96](file://src/main/advisor/MultimodalVision.ts#L35-L96)
- [src/main/advisor/MultimodalVision.ts:98-146](file://src/main/advisor/MultimodalVision.ts#L98-L146)

### 后端应用（app.ts）
- 职责：
  - 创建 Fastify 应用，注册 CORS、JWT、认证插件。
  - 全局错误处理器：区分 Zod 校验错误、自定义 HttpError、客户端错误与服务器内部错误。
  - 注册各模块路由（认证、成员、角色、商店、审计、仪表板、采集、合规、eBay、媒体、AI、Codex Harness）。
  - 提供健康检查端点。
- 关键点：
  - 错误处理顺序严格，确保已注册路由捕获正确的错误处理器。
  - 公共媒体下载路由支持 HMAC 签名授权。

```mermaid
flowchart TD
Init["初始化Fastify"] --> Register["注册CORS/JWT/认证插件"]
Register --> ErrorHandle["设置全局错误处理器"]
ErrorHandle --> Health["注册/health"]
Health --> Routes["注册各模块路由"]
Routes --> Public["注册公共媒体下载"]
Public --> Ready["应用就绪"]
```

**图表来源**
- [server/src/app.ts:21-70](file://server/src/app.ts#L21-L70)

**章节来源**
- [server/src/app.ts:21-70](file://server/src/app.ts#L21-L70)

### 配置中心（config.ts）
- 职责：
  - 集中读取环境变量，暴露端口、数据库 URL、JWT 密钥、令牌 TTL、CORS 源、媒体存储驱动与路径、OSS 配置、AI 网关密钥与模型等。
- 关键点：
  - 默认值与安全提示（开发用 JWT 密钥需替换）。
  - 媒体存储支持本地与 OSS 两种驱动，生产环境建议使用 OSS。

**章节来源**
- [server/src/config.ts:9-37](file://server/src/config.ts#L9-L37)

### 共享契约（advisor.ts, contracts.ts）
- 职责：
  - 定义平台、市场账户、eBay 商品详情、本地产品快照、优化草稿、发布任务、视频工作室、内容优化、标题审计、视觉规则等类型。
  - **新增threadReset事件类型**：用于通知UI线程上下文已重置。
  - **新增附件类型区分**：支持image和document两种附件类型的标识。
  - **新增Linduo聊天事件类型**：支持linduo_delta、linduo_done、linduo_error事件。
- 关键点：
  - 强类型约束前后端数据一致性。
  - 覆盖 eBay 刊登全流程（标题优化、内容分段、翻译、故事板、视频生成、合规校验、发布任务）。
  - 定义AdvisorChatEvent联合类型，包含threadReset事件和Linduo事件。

**章节来源**
- [src/shared/advisor.ts:118-123](file://src/shared/advisor.ts#L118-L123)
- [src/shared/contracts.ts:73-180](file://src/shared/contracts.ts#L73-L180)
- [src/shared/contracts.ts:439-555](file://src/shared/contracts.ts#L439-L555)
- [src/shared/contracts.ts:557-716](file://src/shared/contracts.ts#L557-L716)

### 渲染层（App.tsx）
- 职责：
  - 组织多模块页面（团队工作台、AI参谋、AI采集、AI美工、AI视频、AI员工等）。
  - 管理主题、权限、浏览器状态、任务进度、候选商品、仓库产品、比价数据、工作流计数等。
  - 与主进程 IPC 交互（浏览器、任务、系统能力），与后端 API 交互（市场平台配置、工作流等）。
- 关键点：
  - 权限控制：一级菜单与页面级权限判断。
  - 本地存储：偏好设置、选择记录、利润假设等。
  - 错误提示：加载失败、网络异常、功能不可用时的降级与提示。
  - **新增**：处理threadReset事件，向用户展示一次性提示说明上下文已重置。
  - **新增**：处理Linduo模型的专用事件类型（linduo_delta、linduo_done、linduo_error）。

**章节来源**
- [src/renderer/App.tsx:30-45](file://src/renderer/App.tsx#L30-L45)
- [src/renderer/App.tsx:609-732](file://src/renderer/App.tsx#L609-L732)

### Linduo模型HTTP/SSE管道（新增）
- 职责：
  - **新增**完整的Linduo模型请求处理链路，替代直接的Codex调用。
  - **SSE事件解析**：实现标准的Server-Sent Events协议解析，支持delta、done、error事件类型。
  - **信号处理**：集成AbortController和AbortSignal，支持请求取消和超时控制。
  - **消息渲染系统集成**：将Linduo事件转换为内部ChatEvent格式，与现有UI系统无缝集成。
  - **认证和授权**：通过JWT令牌进行身份验证，检查用户对模型的访问权限。
  - **错误分类**：标准化的错误处理，包括认证失败、模型不存在、速率限制等场景。
- 关键流程：
  - executeLinduoTurn函数处理Linduo模型请求，绕过Codex app-server。
  - streamLinduoChat发起HTTP请求，建立SSE连接。
  - 实时解析SSE事件流，逐个发射delta文本片段。
  - 处理完成事件，更新使用量统计和任务状态。
  - 错误情况下发送error事件，保持用户体验一致性。

```mermaid
flowchart TD
UserMessage["用户消息"] --> ModelCheck{"模型类型检查"}
ModelCheck --> |Linduo模型| ExecuteLinduo["executeLinduoTurn()"]
ModelCheck --> |Codex模型| ExecuteCodex["runCodexTurn()"]
ExecuteLinduo --> CreateContext["创建RunContext"]
CreateContext --> BuildMessages["构建messages数组"]
BuildMessages --> StreamChat["streamLinduoChat()"]
StreamChat --> SSEStream["SSE流式响应"]
SSEStream --> ParseEvents["解析SSE事件"]
ParseEvents --> DeltaEvent{"delta事件?"}
DeltaEvent --> |是| EmitDelta["emit linduo_delta"]
DeltaEvent --> |否| DoneEvent{"done事件?"}
DoneEvent --> |是| EmitDone["emit linduo_done"]
DoneEvent --> |否| ErrorEvent{"error事件?"}
ErrorEvent --> |是| EmitError["emit linduo_error"]
ErrorEvent --> |否| Continue["继续读取"]
Continue --> ParseEvents
EmitDelta --> UpdateUI["更新UI显示"]
EmitDone --> UpdateUsage["更新使用量统计"]
EmitError --> HandleError["处理错误状态"]
UpdateUI --> NextChunk["下一个数据块"]
NextChunk --> ParseEvents
```

**图表来源**
- [src/main/advisor/AdvisorRuntime.ts:1789-2049](file://src/main/advisor/AdvisorRuntime.ts#L1789-L2049)
- [src/main/advisor/linduoServerClient.ts:165-213](file://src/main/advisor/linduoServerClient.ts#L165-L213)
- [server/src/modules/linduo/chat-routes.ts:55-142](file://server/src/modules/linduo/chat-routes.ts#L55-L142)
- [server/src/modules/linduo/chat-service.ts:49-197](file://server/src/modules/linduo/chat-service.ts#L49-L197)

**章节来源**
- [src/main/advisor/AdvisorRuntime.ts:1789-2049](file://src/main/advisor/AdvisorRuntime.ts#L1789-L2049)
- [src/main/advisor/linduoServerClient.ts:1-213](file://src/main/advisor/linduoServerClient.ts#L1-L213)
- [server/src/modules/linduo/chat-routes.ts:1-142](file://server/src/modules/linduo/chat-routes.ts#L1-L142)
- [server/src/modules/linduo/chat-service.ts:1-197](file://server/src/modules/linduo/chat-service.ts#L1-L197)

### 线程恢复与自动回退机制（新增）
- 职责：
  - **线程丢失检测**：当Codex app-server重启或被清理时，检测原线程无法恢复的情况。
  - **自动回退处理**：自动清除失效的线程映射并创建新线程。
  - **用户友好提示**：通过threadReset事件向用户解释上下文重置的原因。
  - **历史数据保留**：确保历史消息仍可访问，仅影响后续对话。
- 关键流程：
  - 尝试thread/resume恢复现有线程。
  - 如果失败，调用clearStoredThreadId清除失效映射。
  - 使用thread/start创建新线程。
  - 发送threadReset事件，包含具体原因信息。

**章节来源**
- [src/main/advisor/AdvisorRuntime.ts:909-964](file://src/main/advisor/AdvisorRuntime.ts#L909-L964)
- [src/main/advisor/SessionStore.ts:124-138](file://src/main/advisor/SessionStore.ts#L124-L138)

## 依赖关系分析
- 主进程依赖：
  - 浏览器工作区（Electron BrowserWindow/WebContentsView）。
  - 数据库访问（Prisma/SQLite/PostgreSQL）。
  - 第三方服务（图像、翻译、视频、eBay、知识库守卫、RAGFlow）。
  - AI参谋运行时（Codex app-server、harness 网关探针）。
  - **新增**：会话存储（SessionStore）用于线程映射持久化和智能分支管理。
  - **新增**：附件服务（AttachmentService）用于文档和图片处理。
  - **新增**：多模态视觉（MultimodalVision）用于图像识别分析。
  - **新增**：Linduo HTTP客户端（linduoServerClient）用于Linduo模型请求。
- 后端依赖：
  - Fastify、CORS、JWT、Zod、Prisma。
  - 媒体存储（本地/OSS）。
  - 各模块路由（认证、成员、角色、商店、审计、仪表板、采集、合规、eBay、媒体、AI、Codex Harness）。
  - **新增**：Linduo聊天路由和服务（chat-routes、chat-service）。
- 渲染层依赖：
  - React、Vite、样式与组件库。
  - IPC 与 HTTP 客户端。

```mermaid
graph LR
Renderer["渲染层"] --> Main["主进程"]
Renderer --> Server["后端服务"]
Main --> Advisor["AI参谋运行时"]
Main --> SessionStore["会话存储"]
Main --> AttachmentService["附件服务"]
Main --> MultimodalVision["多模态视觉"]
Advisor --> SessionStore
Advisor --> AttachmentService
Advisor --> Services["第三方服务"]
Advisor --> LinduoClient["Linduo客户端"]
AttachmentService --> MultimodalVision
LinduoClient --> ChatRoutes["聊天路由"]
ChatRoutes --> ChatService["聊天服务"]
Server --> DB["数据库"]
Server --> Media["媒体存储"]
Advisor --> AppServer["Codex app-server"]
Advisor -.-> ProviderSwitch["智能provider切换"]
ProviderSwitch -.-> BranchManagement["分支管理"]
```

**图表来源**
- [src/main/main.ts:102-118](file://src/main/main.ts#L102-L118)
- [src/main/advisor/AdvisorRuntime.ts:1789-2049](file://src/main/advisor/AdvisorRuntime.ts#L1789-L2049)
- [src/main/advisor/linduoServerClient.ts:165-213](file://src/main/advisor/linduoServerClient.ts#L165-L213)
- [server/src/modules/linduo/chat-routes.ts:55-142](file://server/src/modules/linduo/chat-routes.ts#L55-L142)
- [server/src/modules/linduo/chat-service.ts:49-197](file://server/src/modules/linduo/chat-service.ts#L49-L197)
- [src/main/advisor/SessionStore.ts:124-138](file://src/main/advisor/SessionStore.ts#L124-L138)
- [src/main/advisor/AttachmentService.ts:356-423](file://src/main/advisor/AttachmentService.ts#L356-L423)
- [src/main/advisor/MultimodalVision.ts:19-33](file://src/main/advisor/MultimodalVision.ts#L19-L33)
- [server/src/app.ts:21-70](file://server/src/app.ts#L21-L70)

**章节来源**
- [src/main/main.ts:102-118](file://src/main/main.ts#L102-L118)
- [server/src/app.ts:21-70](file://server/src/app.ts#L21-L70)
- [src/main/advisor/AdvisorRuntime.ts:1789-2049](file://src/main/advisor/AdvisorRuntime.ts#L1789-L2049)

## 性能考量
- 并发下载：图片下载采用并发限制（最多 6 张），避免阻塞与资源耗尽。
- 缓存策略：Amazon 数据源与汇率缓存减少重复请求。
- 错误快速失败：网络超时、格式不支持、尺寸不达标立即阻断，减少无效处理。
- 审批策略：AI参谋运行时对命令与文件修改进行最小权限控制，降低误操作风险。
- 媒体存储：生产环境建议使用 OSS 直读，减少带宽与延迟。
- **新增**：线程恢复失败时的自动回退机制，避免长时间等待和用户体验下降。
- **新增**：智能provider切换避免model_not_found错误，提升系统稳定性。
- **新增**：ModelProfile-based effort参数优化推理性能，避免不兼容的推理深度设置。
- **新增**：文档处理采用异步提取，避免阻塞主线程。
- **新增**：多模态视觉分析支持超时控制（180秒），防止长时间等待。
- **新增**：Linduo HTTP请求使用AbortSignal合并，支持120秒超时控制。
- **新增**：SSE流式响应避免内存累积，实时处理数据块。
- **新增**：服务器端禁用代理缓冲，确保事件实时到达客户端。

[本节为通用指导，无需特定文件引用]

## 故障排查指南
- 后端错误：
  - 校验错误：ZodError 返回 400，包含字段路径与消息。
  - 业务错误：HttpError 返回对应状态码与错误码。
  - 内部错误：记录日志并返回 500。
- 主进程错误：
  - 浏览器未初始化：提示先打开 eBay 店铺。
  - 图片下载失败：记录原因并跳过，继续其他图片。
  - 尺寸/格式不达标：阻断并提示。
- AI参谋运行时：
  - 连接失败：harness 模式不可用，回退到本地执行器。
  - 审批超时：取消待处理审批，清理上下文进程。
  - 协议错误：终止所有活跃请求，记录失败原因。
  - **新增**：线程恢复失败：自动清除失效的线程映射并创建新线程，向UI发送threadReset事件。
  - **新增**：provider切换失败：检查ModelProfile配置和Codex app-server支持情况。
- **新增**：Linduo HTTP客户端错误：
  - ADVISOR_SIGNED_OUT：未配置YANDU_USER_JWT或认证失败。
  - LINDUO_MODEL_NOT_FOUND：模型不在白名单中。
  - LINDUO_RATE_LIMITED：触发速率限制。
  - LINDUO_UPSTREAM_ERROR：上游服务错误或网络异常。
- **新增**：SSE流处理问题：
  - 流中断：检查网络连接和服务器状态。
  - 事件解析失败：验证SSE格式和数据完整性。
  - 超时错误：检查120秒超时配置和网络延迟。
- **新增**：线程上下文丢失场景：
  - 症状：用户收到"上下文已断开"提示，对话从新线程开始。
  - 原因：Codex app-server重启或被清理，导致原线程无法恢复。
  - 处理：系统自动调用clearStoredThreadId清除失效映射，重新thread/start创建新线程。
  - 影响：历史消息仍可读，但后续对话将在新线程中进行。
- **新增**：provider锁定问题：
  - 症状：切换模型时报错"model_not_found"。
  - 原因：Codex线程绑定了特定的provider，无法直接使用其他provider的模型。
  - 处理：系统自动创建新分支并绑定新provider，避免provider锁定。
  - 影响：用户无感知切换，系统自动处理分支管理。
- **新增**：文档处理问题：
  - 症状：文档无法提取文本或格式不支持。
  - 原因：文件格式不在支持列表中，或文件损坏。
  - 处理：检查文件格式扩展名，验证文件完整性。
  - 影响：文档将跳过处理，不影响其他附件的处理。
- **新增**：多模态视觉分析失败：
  - 症状：图像识别失败或超时。
  - 原因：Codex vision-sidecar不可用，或图像处理超时。
  - 处理：检查外部进程状态，重试或降级到本地分析。
  - 影响：图像分析结果可能不完整，但不影响主要功能。

**章节来源**
- [server/src/app.ts:31-51](file://server/src/app.ts#L31-L51)
- [src/main/main.ts:312-384](file://src/main/main.ts#L312-L384)
- [src/main/main.ts:412-491](file://src/main/main.ts#L412-L491)
- [src/main/advisor/AdvisorRuntime.ts:707-736](file://src/main/advisor/AdvisorRuntime.ts#L707-L736)
- [src/main/advisor/AdvisorRuntime.ts:1789-2049](file://src/main/advisor/AdvisorRuntime.ts#L1789-L2049)
- [src/main/advisor/linduoServerClient.ts:78-106](file://src/main/advisor/linduoServerClient.ts#L78-L106)
- [src/main/advisor/SessionStore.ts:124-138](file://src/main/advisor/SessionStore.ts#L124-L138)
- [src/main/advisor/AttachmentService.ts:356-423](file://src/main/advisor/AttachmentService.ts#L356-L423)
- [src/main/advisor/MultimodalVision.ts:98-146](file://src/main/advisor/MultimodalVision.ts#L98-L146)

## 结论
本系统以 Electron 主进程为核心，结合 React 渲染层与 Fastify 后端服务，构建了完整的跨境电商选品与素材工作流。AI参谋运行时提供了安全的自动化执行与审批机制，**新增的Linduo模型HTTP/SSE管道集成显著提升了系统的灵活性和可扩展性**。通过绕过Codex app-server直接调用后端服务，实现了更高效的模型请求处理。SSE流式响应、信号处理、错误分类和认证授权机制确保了系统的稳定性和安全性。**新增的智能模型提供商切换、自动分叉机制、ModelProfile-based effort参数处理、增强的文档处理能力和多模态视觉分析进一步提升了系统的健壮性和用户体验**。后端服务统一了鉴权、错误处理与模块化路由。通过共享契约确保前后端类型一致，提升了可维护性与扩展性。建议在生产环境中启用 OSS 媒体存储、替换开发密钥、完善监控与日志，以提升稳定性与性能。

[本节为总结，无需特定文件引用]

## 附录
- 环境变量参考：
  - PORT、DATABASE_URL、JWT_SECRET、ACCESS_TOKEN_TTL、REFRESH_TOKEN_TTL_DAYS、CORS_ORIGIN。
  - MEDIA_DRIVER、MEDIA_LOCAL_DIR、MEDIA_PUBLIC_BASE_URL、MEDIA_SIGNING_SECRET。
  - OSS_BUCKET、OSS_ENDPOINT、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET。
  - BAILIAN_API_KEY、BAILIAN_BASE_URL、BAILIAN_VISION_MODEL。
  - ARK_API_KEY、ARK_BASE_URL、ARK_VIDEO_MODEL。
  - OPENAI_IMAGE_API_KEY、OPENAI_IMAGE_BASE_URL。
  - DEEPSEEK_API_KEY、DEEPSEEK_BASE_URL、DEEPSEEK_MODEL。
  - **新增**：LINDUO_SERVER_BASE_URL：Linduo服务端基础URL，强制限定为本机回环。
  - **新增**：LINDUO_API_KEY：Linduo模型API密钥。
  - **新增**：LINDUO_BASE_URL：Linduo模型基础URL。
  - **新增**：YANDU_USER_JWT：用户JWT令牌，用于Linduo服务认证。

**章节来源**
- [server/src/config.ts:9-37](file://server/src/config.ts#L9-L37)
- [src/main/advisor/linduoServerClient.ts:29-50](file://src/main/advisor/linduoServerClient.ts#L29-L50)
- [src/main/advisor/linduoServerClient.ts:68-76](file://src/main/advisor/linduoServerClient.ts#L68-L76)