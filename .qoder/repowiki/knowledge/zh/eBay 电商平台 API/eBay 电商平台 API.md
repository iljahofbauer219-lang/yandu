---
kind: external_dependency
name: eBay 电商平台 API
slug: ebay-api
category: external_dependency
category_hints:
    - vendor_identity
    - auth_protocol
scope:
    - '**'
source_files:
    - .env.example
    - src/main/services/EbayService.ts
---

### eBay 官方开放平台
- 角色：提供 eBay 商品发布、优化、报告等核心功能的 API 接口
- 集成点：通过 OAuth 2.0 认证，配置 `EBAY_CLIENT_ID`、`EBAY_CLIENT_SECRET`、`EBAY_RUNAME`
- 环境：支持生产环境，从 eBay Developer Program > Application Keys > Production 获取凭证
- 功能模块：商品合规检查、视频生成、图像识别、报告生成、优化建议
- 认证方式：标准的 eBay OAuth 流程，需要开发者账号和应用密钥
- 用途：跨境电商卖家的商品管理和运营工具集成