---
kind: external_dependency
name: FFmpeg 音视频处理库
slug: ffmpeg
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - package.json
    - src/main/services/ArkVideoService.ts
---

### FFmpeg 多媒体处理工具
- 角色：本地音视频编解码、转码、剪辑、字幕处理的核心引擎
- 集成点：通过 `@ffmpeg-installer/ffmpeg` 包自动安装和管理 FFmpeg 二进制文件
- 使用场景：视频片段拼接、SRT 字幕生成、格式转换、质量优化
- 技术实现：通过 Node.js child_process 调用 FFmpeg 命令行工具
- 依赖关系：与火山方舟视频生成服务配合，完成最终的成品视频制作