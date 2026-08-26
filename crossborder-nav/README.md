# 砚都跨境 · IP 网址导航

独立部署的网址导航网站，**仿 amz123.com/kd 整站 1:1 复刻**，部署在中央服务器 `http://114.55.149.192:8789/`。

## 板块结构

- 顶部主导航（10 个一级入口）
- 顶部搜索框 + 热门搜索
- 平台大全（12 区域 × 130 平台）
- 站点+专题（约 20 个专题入口）
- 底部 footer

## 数据来源

- **平台数据**：amz123.com/kd 抓取（130 个平台，含 logo/描述/平台首页/平台知识）
- **logo**：抓取后下载到 `public/logos/`，运行时相对路径引用（**不**引 amz123 图床）
- **专题/导航/footer**：amz123 原文 1:1 复刻

> 数据来源参考 amz123.com/kd；本项目为独立部署的导航镜像，不存储任何 amz123 用户数据。

## 开发

```bash
npm install
npm run dev              # vite dev server，http://localhost:5173
npm run build            # 产出 dist/
npm run preview          # vite preview，http://localhost:8789
npm run serve            # http-server dist，http://localhost:8789
```

## 数据抓取（仅桌面端执行，避免阿里云 IP 风控）

```bash
npm run fetch:data       # 抓 amz123.com/kd → src/data/*.ts
npm run fetch:logos      # 下载平台 logo → public/logos/
npm run build:data       # 整合所有 data/*.ts → src/data/index.ts
```

## 部署

```bash
# 本项目已部署到中央服务器：
#   - 静态文件：/opt/www/crossborder-nav/dist/ （nginx 静态托管）
#   - nginx 站点：/etc/nginx/conf.d/crossborder-nav.conf （listen 8789）
# 重新部署 dist：
cd crossborder-nav
npm run build
tar -czf /tmp/crossborder-nav-dist.tar.gz -C dist .
scp /tmp/crossborder-nav-dist.tar.gz root@114.55.149.192:/tmp/
ssh root@114.55.149.192 "rm -rf /opt/www/crossborder-nav/* && \
  tar -xzf /tmp/crossborder-nav-dist.tar.gz -C /opt/www/crossborder-nav/ && \
  find /opt/www/crossborder-nav -name '._*' -delete && \
  rm -f /tmp/crossborder-nav-dist.tar.gz && \
  nginx -s reload"
```

> 阿里云 ECS 安全组需要手动放行 TCP:8789（授权对象 0.0.0.0/0）才能外网访问。

## 未来域名扩展

把 nginx `server_name 114.55.149.192;` 改成 `server_name nav.yourdomain.com;` + 配证书即可，无需改前端代码。

## 桌面应用集成

`砚都跨境` 桌面端在两处接入了本站点：

1. **AI 总部** → 新增 **“跨境导航”** 卡片（权限码 `menu.hq.crossborder`）
   - 点击调用 `window.desktop.system.openExternal('http://114.55.149.192:8789/')`
   - 在系统默认浏览器中打开本 IP 站点
2. **IE 浏览** 入口
   - 首次进入自动加载本 IP 站点（`http://114.55.149.192:8789/`）
   - 后续可通过地址栏自由切换

权限码同步更新：

- 前端：`src/shared/menuPermissionTree.ts`
- 后端：`server/src/modules/rbac/permissions.ts`

