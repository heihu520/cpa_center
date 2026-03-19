# Web 版部署教程

## 一、项目来源说明

当前仓库代码不是从零开始新写，而是基于以下仓库拉取后进行二次开发：

- 源仓库：`https://github.com/Biliniko/cpa-control-center`

本仓库在源代码基础上完成了 Web 化、Docker 化、多连接管理等改造。

---

## 二、当前版本支持的部署形态

当前项目支持两种主要运行方式：

1. **本地直接运行 Web 服务**
2. **使用 Docker / Docker Compose 部署**

如果你要部署到服务器，推荐直接用 **Docker Compose**。

---

## 三、运行前准备

### 1. 后端依赖环境
如果你是本地直接运行，需要：

- Go 1.24+
- Node.js 22+
- npm

如果你用 Docker 部署，只需要：

- Docker
- Docker Compose

### 2. 目标后端
本工具依赖可用的 CPA 管理接口，例如：

- 你自己的 CPA 管理服务
- 已启用管理接口的目标实例

你至少需要：

- `Base URL`
- `Management Token`

---

## 四、本地直接运行（非 Docker）

### 1. 安装前端依赖

```bash
cd frontend
npm install
```

### 2. 构建前端

```bash
npm run build
```

### 3. 回到项目根目录启动 Web 版

```bash
cd ..
go run -tags web .
```

### 4. 访问页面

默认访问：

```text
http://localhost:8080
```

如果你希望指定监听端口，可以设置：

```bash
CPA_WEB_ADDR=0.0.0.0:12350 go run -tags web .
```

或者：

```bash
PORT=12350 go run -tags web .
```

---

## 五、Docker 部署

### 1. 当前 Docker 文件
项目已经包含：

- [Dockerfile](Dockerfile)
- [docker-compose.yml](docker-compose.yml)
- [.dockerignore](.dockerignore)

### 2. 一键构建并启动
在项目根目录执行：

```bash
docker compose up -d --build
```

### 3. 默认访问地址
当前 compose 映射为：

```text
http://localhost:12350
```

含义是：

- 容器内监听：`8080`
- 宿主机暴露：`12350`

### 4. 停止服务

```bash
docker compose down
```

### 5. 查看日志

```bash
docker compose logs -f
```

---

## 六、数据持久化说明

Docker Compose 已配置：

- 容器内数据目录：`/data`
- 宿主机映射目录：`./docker-data`

也就是说，容器重启后以下数据会保留：

- 连接配置
- 当前连接索引
- 每个连接的数据库
- 日志文件
- 导出目录相关数据

### 目录说明
宿主机目录：

```text
./docker-data
```

内部大致结构会类似：

```text
docker-data/
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

---

## 七、环境变量说明

### 1. `CPA_WEB_ADDR`
控制 Web 服务监听地址。

例如：

```bash
CPA_WEB_ADDR=0.0.0.0:8080
```

### 2. `PORT`
如果没有设置 `CPA_WEB_ADDR`，会尝试读取 `PORT`。

例如：

```bash
PORT=12350
```

### 3. `CPA_DATA_DIR`
控制数据目录位置。

例如：

```bash
CPA_DATA_DIR=/data
```

在 Docker 中默认已经配置为：

```text
/data
```

---

## 八、首次使用流程

部署完成后，推荐按下面顺序操作：

1. 打开页面
2. 进入设置页
3. 填写：
   - `Base URL`
   - `Management Token`
4. 点击 **Test & Save**
5. 等待 inventory 同步完成
6. 查看仪表盘与账号列表
7. 再执行扫描
8. 最后根据扫描结果决定是否执行维护

如果你需要多号池管理：

1. 在设置页新增连接
2. 为每个连接填写不同的 URL / Token
3. 保存后通过连接切换器查看各自数据

---

## 九、服务器部署建议

### 推荐部署方式
如果是服务器使用，建议：

- Docker Compose 部署
- 配置反向代理（Nginx / Caddy）
- 只在内网访问，或加登录保护

### 强烈建议
当前 Web 版默认没有应用级登录鉴权。

所以如果部署到公网，建议至少加一层：

- Nginx Basic Auth
或
- Cloudflare Access
或
- 你自己的登录网关

否则任何能访问该页面的人，都能执行扫描、禁用、删除等管理操作。

---

## 十、Nginx 反代示例

如果你要通过 Nginx 暴露到域名，可参考：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:12350;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
}
```

因为项目使用了 SSE：

- `/api/events`

所以建议关闭代理缓冲，避免日志和进度事件延迟。

---

## 十一、升级流程

如果后续你更新了当前仓库代码，推荐升级方式：

```bash
git pull
docker compose up -d --build
```

如果只是重启：

```bash
docker compose restart
```

---

## 十二、常见问题

### 1. 页面空白
通常检查：

- 前端是否已正确 build
- 静态资源 MIME 类型是否正常
- 是否用了旧浏览器缓存

### 2. Docker 启动了但打不开
检查：

```bash
docker compose logs -f
```

并确认访问的是：

```text
http://localhost:12350
```

### 3. 保存配置后刷新还要重新输入 token
当前实现支持：

- 后端保存 token
- 前端刷新后不回显明文
- 页面用 `hasSavedManagementToken` 标识已保存

所以这是“安全隐藏”，不是没保存。

### 4. 扫描统计和额度页数量不一致
当前版本已经修正“quota limited”的判定口径，扫描统计会参考 WHAM quota bucket 结果，而不只依赖 `limit_reached`。

---

## 十三、适合的使用方式

当前版本最适合：

- 单机使用
- 内网服务器部署
- 多连接切换运维
- Docker 持久化运行

如果你后面要继续增强，优先建议补：

- 登录鉴权
- 反向代理
- HTTPS
- 操作审计
