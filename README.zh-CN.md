# CPA Control Center

[English](./README.md) | [简体中文](./README.zh-CN.md)

一个面向 CPA / Codex auth 池运维的 **Web 控制台**，支持服务器部署、Docker 运行和多连接管理。

## 项目来源

当前仓库不是从零开始编写，而是基于以下源仓库拉取后进行二次开发：

- 源仓库：[`Biliniko/cpa-control-center`](https://github.com/Biliniko/cpa-control-center)

当前仓库在源代码基础上重点做了这些改造：

- 将原本以桌面端为主的使用方式扩展为 **Web 版**
- 支持 **Docker / Docker Compose** 部署
- 支持 **多连接 / 多 URL / 多号池切换管理**
- 将部分 Wails 运行时能力替换为浏览器端 Web Runtime 适配
- 修复了响应式布局、导出体验、额度统计口径、事件流卡顿等问题

## 项目定位

这个项目适合：

- 已经有 CPA 管理接口
- 维护 Codex 为主的 auth 池
- 希望在浏览器里统一做扫描、维护、日志查看和额度管理
- 希望一个后台管理多个 URL / 多个号池

这个项目当前不聚焦：

- OAuth 登录获取账号
- GUI 导入 auth 文件
- 多用户权限系统
- 公网裸露场景下的安全接入体系

## 当前版本核心能力

- Web 控制台，支持服务器运行
- 多连接切换管理
- inventory 同步
- 全量 / 增量扫描
- 维护任务（删除 401、禁用/删除额度耗尽账号、恢复账号）
- Codex quota 工作区
- 实时任务日志与进度
- 扫描历史与详情分页
- CSV / JSON 导出
- 中英文界面
- Docker 部署支持

## 技术栈

### 后端

- Go
- `net/http`
- SQLite
- SSE 事件推送

### 前端

- Vue 3
- TypeScript
- Pinia
- Element Plus
- Vite

### 运行形态

- 桌面版入口仍保留（Wails）
- 当前仓库主推荐运行方式为 **Web / Docker 部署**

## 架构概览

- Web 入口：[main_web.go](main_web.go)
- 多连接管理：[root_connections.go](root_connections.go)
- 核心业务层：[internal/backend/](internal/backend/)
- 前端 API 层：[frontend/src/lib/web-api.ts](frontend/src/lib/web-api.ts)
- 前端事件桥：[frontend/src/lib/web-runtime.ts](frontend/src/lib/web-runtime.ts)
- 设置状态：[frontend/src/stores/settings.ts](frontend/src/stores/settings.ts)
- 任务状态：[frontend/src/stores/tasks.ts](frontend/src/stores/tasks.ts)

更详细的架构说明见：

- [ARCHITECTURE.zh-CN.md](./ARCHITECTURE.zh-CN.md)

## 快速开始

### 方式一：本地直接运行 Web 版

先安装前端依赖并构建：

```bash
cd frontend
npm install
npm run build
```

然后回到项目根目录启动：

```bash
cd ..
go run -tags web .
```

默认访问：

```text
http://localhost:8080
```

如果要自定义端口：

```bash
CPA_WEB_ADDR=0.0.0.0:12350 go run -tags web .
```

或：

```bash
PORT=12350 go run -tags web .
```

### 方式二：Docker 部署

项目已包含：

- [Dockerfile](Dockerfile)
- [docker-compose.yml](docker-compose.yml)
- [.dockerignore](.dockerignore)

直接执行：

```bash
docker compose up -d --build
```

访问：

```text
http://localhost:12350
```

数据默认持久化到：

```text
./docker-data
```

更完整的部署说明见：

- [DEPLOYMENT.zh-CN.md](./DEPLOYMENT.zh-CN.md)

## 首次使用流程

1. 打开设置页
2. 填写 `Base URL` 和 `Management Token`
3. 点击 **Test & Save**
4. 等待 inventory 同步完成
5. 查看仪表盘和账号列表
6. 执行扫描
7. 根据扫描结果决定是否执行维护

如果需要管理多个池子：

1. 在设置页新增连接
2. 为不同连接填写不同的 URL / Token
3. 通过连接切换器查看各自数据

## 状态模型

系统当前统一使用以下状态：

- `Pending`
- `Normal`
- `401 Invalid`
- `Quota Limited`
- `Recovered`
- `Error`

其中：

- `Pending` 表示已同步到本地，但尚未探测
- `Quota Limited` 当前已统一按 quota bucket 结果判定，不再只依赖单一字段

## 数据与目录说明

Web 版数据目录默认来源：

- 优先读取环境变量 `CPA_DATA_DIR`
- 否则使用系统默认配置目录

多连接模式下，每个连接都有独立数据目录，典型结构类似：

```text
connections.json
connections/
  default/
    settings.json
    state.db
    app.log
  conn-xxxx/
    settings.json
    state.db
    app.log
```

## 重要说明

### 1. 当前 Web 版没有登录鉴权

如果你要部署到公网，建议至少在反向代理层加：

- Basic Auth
- Cloudflare Access
- 内网访问控制
- 你自己的登录网关

否则任何能访问页面的人都可以执行扫描、禁用、删除等操作。

### 2. 当前多连接是“切换式”模型

当前是单活动连接模型，适合：

- 在多个号池之间切换查看与操作

但还不是“多个号池并行任务”的架构。

### 3. Docker 是当前推荐部署方式

如果你是服务器使用，建议：

- Docker Compose
- 反向代理
- 内网或加访问保护

## 文档入口

- 架构说明：[ARCHITECTURE.zh-CN.md](./ARCHITECTURE.zh-CN.md)
- 部署教程：[DEPLOYMENT.zh-CN.md](./DEPLOYMENT.zh-CN.md)

## 致谢

- 工作流设计参考了 [`fantasticjoe/cpa-warden`](https://github.com/fantasticjoe/cpa-warden)
- 当前主要面向带管理接口的 CPA 后端使用，例如 [`router-for-me/CLIProxyAPI`](https://github.com/router-for-me/CLIProxyAPI)
