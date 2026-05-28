# 落地页情报台 / Landing Intel Console

私用版落地页产品分析工具：输入 PDP / 活动页链接，自动抓取页面、截图、提取产品信息、促销价格、转化入口、竞品搜索关键词和页面风险。

## 本地运行

复制 `.env.example` 为 `.env`，填入你自己的 key：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek API Key
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
TAVILY_API_KEY=你的 Tavily API Key
```

启动：

```bash
npm install
npm start
```

打开：

```text
http://localhost:3002
```

如果端口被占用：

```bash
PORT=3003 npm start
```

## MVP 部署方案

当前推荐：

```text
GitHub + Render + Clerk + 无数据库 + 内存缓存
```

- GitHub：托管代码
- Render：跑 Node 服务、Playwright 浏览器截图、前端页面
- Clerk：登录鉴权，只允许指定账号访问
- 无数据库：不保存历史报告
- 内存缓存：同 URL / 同搜索短时间复用，减少 API 消耗

## Render 部署步骤

1. 把项目推到 GitHub。
2. 到 Render 新建 Web Service，连接这个 GitHub 仓库。
3. Render 会读取 `render.yaml`，用 Docker 构建。
4. 在 Render Environment Variables 填入：

```bash
DEEPSEEK_API_KEY=你的 DeepSeek Key
TAVILY_API_KEY=你的 Tavily Key
CLERK_PUBLISHABLE_KEY=你的 Clerk Publishable Key
CLERK_SECRET_KEY=你的 Clerk Secret Key
CLERK_AUTHORIZED_PARTIES=https://你的-render域名.onrender.com
```

本地调试 Clerk 时可以写：

```bash
CLERK_AUTHORIZED_PARTIES=http://localhost:3002,https://你的-render域名.onrender.com
```

## Clerk 设置建议

1. 创建 Clerk Application。
2. 关闭开放注册，或只允许指定邮箱登录。
3. 复制 Publishable Key 和 Secret Key 到 Render。
4. 前端会自动显示登录门禁；后端会校验 Clerk token。

如果 `.env` 没有 Clerk key，本地会自动进入免登录开发模式。

## 注意

- Render 免费服务可能休眠，第一次打开会慢。
- Playwright 截图需要 Docker 环境，项目已使用官方 Playwright Docker 镜像。
- `reports/` 只存最新临时报告和截图，不作为数据库使用。
