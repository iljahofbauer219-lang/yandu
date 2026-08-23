# 阶段 9：1.0.12 打包应用与持久化终验

验收日期：2026-08-10

## 结论

完成率：100%（18/18）

阶段 9 已通过。macOS 与 Windows 1.0.12 安装产物均已重新生成；macOS 打包应用已从真实可执行文件启动，报告、文档操作、提示词回填、关闭重启后的数据恢复均完成终验。

验收中发现并修复了一个真实缺陷：历史会话恢复时，标题归一化没有读取该会话保存的人工确认产品名，导致“宠物免洗擦浴精华”被重新改成 1688 原始长标题。修复后，首次报告与工作档案恢复后的报告标题保持一致。

## 安装产物

- macOS：`release/YanduCrossBorder-1.0.12-x64.dmg`，约 146 MB。
- Windows：`release/YanduCrossBorder-Setup-1.0.12.exe`，约 131 MB。
- macOS SHA-256：`8bc9101980b52b195898ea2c6db6e3dc2936fa49794ee3e4ac871bad71384edc`。
- Windows SHA-256：`57144e9cb286b86563ba944639ed2b586b5e27d404218982a1637edb4a0a78d9`。
- `latest-mac.yml` 与 `latest.yml` 均为 1.0.12，文件名、大小和 SHA-512 已随最终重打包更新。

## 验收项

1. `package.json` 与打包应用版本均为 1.0.12：通过。
2. macOS x64 DMG 生成：通过。
3. Windows x64 NSIS EXE 生成：通过。
4. macOS/Windows 自动更新清单更新：通过。
5. DMG 可只读挂载，内含 1.0.12 应用与 Applications 安装链接：通过。
6. macOS `app.asar` 包含最终资源 `index-DbjvYqXb.js`、`index-ChUd0jgO.css`：通过。
7. Windows `app.asar` 包含相同最终资源：通过。
8. 打包应用实际状态为 `isPackaged=true`，运行路径为 `app.asar`：通过。
9. 首次正式报告标题保持“宠物免洗擦浴精华 · Amazon美国站选品分析报告”：通过。
10. 回复操作栏显示“复制回答 / 转为文档编辑 / 更多”：通过。
11. “转为文档编辑”生成编辑区，修改后显示自动保存：通过。
12. Word 下载调用可执行：通过。
13. 基于报告生成 4 条内容相关提问建议，点击可回填输入框：通过。
14. 关闭并重启后，已提取商品事实仍保存：通过。
15. 关闭并重启后，可从工作档案恢复正式报告：通过。
16. 历史报告恢复后仍使用人工确认产品名：通过。
17. 关闭并重启后，文档人工编辑内容可重新打开：通过。
18. TypeScript、生产构建、选品静态回归、Amazon 完整性回归全部通过：通过。

## 回归结果

- 打包应用 UI 与持久化：15/15 通过。
- 商品提取、身份、证据、单位经济及历史标题：62/62 通过。
- Amazon 完整性与降级规则：34/34 通过。
- TypeScript 主进程与渲染层检查：通过。
- Vite 生产构建：通过，最终 JS 为 `index-DbjvYqXb.js`。
- macOS DMG 挂载检查：通过。
- `git diff --check`（本阶段相关已跟踪文件）：通过。

## 证据文件

- `stage9-packaged-ui-report.json`：打包应用 15 项自动验收结果。
- `01-packaged-report-actions.png`：打包应用回复操作栏。
- `02-packaged-document-edit.png`：文档编辑、下载与提问建议。
- `03-packaged-restart-restored.png`：关闭重启并从工作档案恢复后的文档编辑内容。
- `tools/verify-packaged-production-stage9.cjs`：可重复执行的打包应用验收脚本。

## 已知边界

- macOS 包明确配置为不签名；其他 Mac 首次打开时可能出现系统安全提示。
- 当前主机为 macOS，因此 Windows 安装器已完成构建、PE/NSIS 格式检查和包内资源核验，但没有在真实 Windows 主机上执行安装与界面点击。
- 本次持久化验证使用隔离临时用户目录，不改动现有用户登录、历史对话和商品提取数据。
