---
kind: external_dependency
name: DeepSeek AI 指令解析服务
slug: deepseek
category: external_dependency
category_hints:
    - vendor_identity
    - auth_protocol
scope:
    - '**'
source_files:
    - src/main/services/DeepSeekCommandService.ts
    - .env.example
---

### DeepSeek 自然语言理解服务
- 角色：将用户的中文自然语言转换为结构化的采集指令，支持中英文混合输入
- 集成点：通过 HTTP API 调用 `/chat/completions` 端点，使用 Bearer Token 认证
- 配置方式：设置 `DEEPSEEK_API_KEY`，默认模型为 `deepseek-v4-flash`，基础 URL 为 `https://api.deepseek.com`
- 功能范围：仅负责理解 `collect`、`status`、`help` 或 `unknown` 动作，不直接操作浏览器或数据库
- 安全机制：平台、数量和关键词经过本地白名单及范围校验后才执行
- 降级策略：当 AI 指令理解失败时，回退到正则表达式解析标准格式指令