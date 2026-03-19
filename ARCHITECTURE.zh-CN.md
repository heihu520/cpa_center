# 项目架构说明

## 项目来源与二次开发说明

本项目当前仓库代码基于以下开源仓库拉取后进行二次开发与改造：

- 源仓库：`https://github.com/Biliniko/cpa-control-center`

当前版本在源仓库基础上，已进行的主要改造包括：

- 将原本以桌面端为主的运行方式扩展为可在服务器运行的 Web 版本
- 增加多连接（多个 URL / 多个号池）管理能力
- 增加 Docker 部署支持
- 将部分 Wails 运行时能力替换为浏览器 Web Runtime 适配实现
- 对响应式布局、日志事件流、额度统计口径和导出体验进行了修正

---

## 一、整体架构概览

当前项目采用的是 **Go 后端 + Vue 3 前端 + 本地嵌入式静态资源发布** 的结构。

运行形态分为两套：

1. **Desktop 桌面版**
   - 入口：[main.go](main.go)
   - Wails 应用桥接：[app.go](app.go)

2. **Web 服务器版**
   - 入口：[main_web.go](main_web.go)
   - 多连接管理：[root_connections.go](root_connections.go)

核心业务逻辑统一沉淀在：

- [internal/backend/](internal/backend/)

也就是说：

- 桌面版和 Web 版共用同一套后端业务层
- 差异主要在“入口层、事件桥接层、前端运行时适配层”

---

## 二、目录与职责

### 1. Go 入口层

#### [main.go](main.go)
桌面端入口：

- 通过 Wails 启动应用
- 加载前端构建产物
- 调用 [app.go](app.go) 暴露后端能力给桌面端

#### [main_web.go](main_web.go)
Web 端入口：

- 启动 `net/http` 服务
- 提供 `/api/*` JSON 接口
- 提供 `/api/events` SSE 事件流
- 嵌入并分发 `frontend/dist` 静态文件

#### [root_connections.go](root_connections.go)
Web 版多连接管理层：

- 管理 `connections.json`
- 管理当前活动连接
- 为每个连接分配独立数据目录
- 让不同 URL / 号池的数据和任务状态彼此隔离

---

### 2. 业务核心层

#### [internal/backend/backend.go](internal/backend/backend.go)
统一业务门面：

- 设置保存与连接测试
- inventory 同步
- 扫描与维护
- 仪表盘汇总
- 额度快照
- 调度器状态

#### [internal/backend/client.go](internal/backend/client.go)
与 CPA 管理接口交互的客户端层：

- 拉取 auth-files
- 调用管理 API
- 探测 usage
- 执行禁用 / 删除等操作
- 对探测结果做账号状态分类

#### [internal/backend/operations.go](internal/backend/operations.go)
核心任务编排层：

- `RunScan`
- `RunMaintain`
- 单账号 / 批量账号操作
- 导出逻辑

#### [internal/backend/quotas.go](internal/backend/quotas.go)
额度解析与快照聚合层：

- 解析 WHAM usage 结果
- 计算 5h / weekly / code review weekly buckets
- 生成 quota snapshot
- 统一额度耗尽判定口径

#### [internal/backend/store.go](internal/backend/store.go)
本地持久化层：

- SQLite 状态存储
- settings / 当前账号快照 / 扫描历史 / quota snapshot
- 列表分页和聚合统计

---

### 3. 前端层

#### [frontend/src/lib/web-api.ts](frontend/src/lib/web-api.ts)
Web API 调用封装：

- 所有 `/api/*` 请求统一由这里发出
- 前端 store 不直接操作 `fetch`

#### [frontend/src/lib/web-runtime.ts](frontend/src/lib/web-runtime.ts)
Web 版运行时适配层：

- 用 SSE 模拟 Wails 事件机制
- 提供浏览器 Clipboard / Screen / Window 能力适配
- 对高频事件做节流

#### [frontend/src/stores/settings.ts](frontend/src/stores/settings.ts)
设置与连接管理状态：

- 当前连接
- 多连接切换
- 设置加载与保存
- 调度器状态

#### [frontend/src/stores/tasks.ts](frontend/src/stores/tasks.ts)
任务与日志状态：

- 扫描 / 维护 / inventory / quota 进度
- SSE 事件接收
- 连接维度的事件过滤
- 日志缓存

#### [frontend/src/stores/accounts.ts](frontend/src/stores/accounts.ts)
仪表盘和账号列表相关数据：

- dashboard summary
- history
- accounts page
- scan detail

#### [frontend/src/views/](frontend/src/views/)
页面层：

- Dashboard
- Accounts
- Quotas
- Logs
- Settings

---

## 三、当前 Web 架构的优点

### 1. 业务层复用度高
桌面版与 Web 版共用 `internal/backend`，没有分叉出两套核心业务逻辑，这一点是对的。

### 2. 多连接隔离方式正确
当前多连接方案采用：

- 一个根目录
- 一个 `connections.json`
- 每个连接一个独立数据目录

这比把所有连接数据混在一套库里更稳，也更容易迁移和备份。

### 3. 前端职责划分清晰
当前前端已基本形成：

- API 层
- Runtime 层
- Store 层
- View 层

这种分层是合理的，后续继续扩展成本不高。

### 4. 事件流改造成 SSE 是可行的
对当前这种：

- 单机部署
- 后台任务进度推送
- 日志流展示

SSE 足够，而且实现成本低于 WebSocket。

---

## 四、当前架构存在的问题与风险

### 1. Web 层路由函数偏大
[main_web.go](main_web.go) 当前承担了过多职责：

- 路由注册
- 请求解析
- JSON 编解码
- 导出下载
- SSE 处理
- 设置脱敏
- 错误格式化

当前还能维护，但随着接口继续增加，会逐渐变成超大文件。

**建议后续拆分为：**

- `web_handlers_settings.go`
- `web_handlers_accounts.go`
- `web_handlers_tasks.go`
- `web_events.go`
- `web_http.go`

这不是当前必须改，但后续如果继续扩功能，建议尽早拆。

### 2. 多连接管理目前是“单活动连接模型”
当前后端通过 [root_connections.go](root_connections.go) 的 `currentBackendOrOpen()` 只维持一个当前激活连接。

这意味着：

- 同一时刻更像“切换号池”
- 而不是“多个号池并行任务运行”

如果未来想做到：

- A 连接扫描中
- B 连接也能同时维护

那现在这个模型就不够，需要演进为：

- `map[connectionID]*backend.Backend`
- 后端 API 显式接收 `connectionId`

**目前不是 bug，但属于架构边界。**

### 3. Web 版尚未引入鉴权层
当前 Web 版是：

- 打开页面即可操作
- 没有登录
- 没有用户隔离

这对本地单机或内网自用可以接受；
但如果部署到公网或多人共享环境，风险很大。

**建议：**
至少增加一层：

- 反向代理 Basic Auth
或
- 应用级登录鉴权

### 4. SSE 客户端是单全局连接
[frontend/src/lib/web-runtime.ts](frontend/src/lib/web-runtime.ts) 当前为整个页面只维护一条 EventSource。

这本身没问题，但要注意：

- 当前依赖 `connectionId` 在前端做事件过滤
- 如果未来事件量再增大，仍可能需要后端按连接订阅

### 5. 目前缺少专门的运维文档
现有 README 更偏产品说明，缺少：

- Web 版运行方式
- Docker 部署方式
- 数据目录结构
- 二改来源说明

这个问题我在本次补文档时已一并解决。

---

## 五、我对当前架构的结论

### 结论
**当前架构没有明显“推倒重来级别”的问题。**

整体上属于：

- 业务层设计正确
- Web 化改造方向正确
- 多连接实现方式合理
- 仍有进一步工程化整理空间

### 当前最值得保留的点

- `internal/backend` 作为统一业务核心
- 多连接按目录隔离
- 前端 store 分层
- Web Runtime 适配思路

### 当前最值得继续优化的点

1. 拆分 `main_web.go`
2. Web 版增加鉴权
3. 如果未来要并行多池任务，重构为多 backend 常驻模型
4. 增加运维与部署文档

---

## 六、数据与运行模型

### 数据目录
Web 版默认数据目录来源于：

- 环境变量 `CPA_DATA_DIR`
- 否则走系统默认配置目录

每个连接的数据位于：

- `connections/<connection-id>/settings.json`
- `connections/<connection-id>/state.db`
- `connections/<connection-id>/app.log`

连接索引文件：

- `connections.json`

### 事件模型
后端任务事件通过：

- SSE `/api/events`

向前端推送。

事件包含：

- `scan:*`
- `maintain:*`
- `inventory:*`
- `quota:*`
- `task:finished`
- `scheduler:status`
- `account:update`

Web 前端通过 `connectionId` 做当前连接过滤。

---

## 七、适用场景

当前架构适合：

- 单机部署
- 内网部署
- 单用户或少量可信用户共享使用
- 多号池切换式运维

当前不适合直接裸露到公网做多人共享后台，除非补：

- 鉴权
- 权限隔离
- 审计

---

## 八、后续建议优先级

### P1
- 增加 Web 版登录/鉴权
- 拆分 `main_web.go`
- 补系统化部署文档

### P2
- 支持多连接并行任务
- 增加连接级任务面板
- 增加操作审计日志

### P3
- 进一步拆分前端 domain store
- 增加更细粒度的错误告警与健康检查
