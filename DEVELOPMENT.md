# 开发指南

本文档介绍 Blog To HTML 项目的开发环境配置和热更新/热重启功能。

## 开发环境

### 热更新与热重启

项目已配置完整的开发环境，支持前端 HMR（热模块替换）和后端热重启功能。

#### 功能特性

- **前端 HMR**: 修改 `web/` 目录下的代码后，浏览器自动更新，无需刷新页面
- **后端热重启**: 修改 `server.js` 或 `prompt.txt` 后，后端服务自动重启
- **实时日志**: 显示文件变更、重启时间和执行状态
- **并行开发**: 前后端同时运行，提高开发效率

### 快速开始

#### 1. 安装依赖

```bash
# 安装后端依赖
npm install

# 安装前端依赖
cd web
npm install
cd ..
```

#### 2. 配置环境变量

创建 `.env` 文件（可选）：

```env
OLLAMA_HOST=https://ollama.com
OLLAMA_API_KEY=your_api_key_here
PORT=3000
```

#### 3. 启动开发服务器

```bash
# 同时启动前后端开发服务器
npm run dev
```

启动后，您将看到两个终端窗口：

- **Backend (蓝色)**: 后端服务器运行在 http://localhost:3000（仅提供 API）
- **Frontend (绿色)**: 前端开发服务器运行在 http://localhost:5173

**重要**: 在开发环境中，请访问 http://localhost:5173 进行开发，不要访问 http://localhost:3000。

### 开发环境架构

```
浏览器 (http://localhost:5173)
    ↓
前端开发服务器 (Vite HMR)
    ↓ (API 请求代理)
后端服务器 (http://localhost:3000)
    ↓
Ollama API
```

**关键点**:
- 前端运行在 5173 端口，支持 HMR 热更新
- 后端运行在 3000 端口，仅提供 API 接口
- API 请求通过 Vite 代理自动转发到后端
- 开发环境下后端不提供静态文件服务

### 开发命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 同时启动前后端开发服务器（推荐） |
| `npm run dev:backend` | 仅启动后端开发服务器（带热重启） |
| `npm run dev:frontend` | 仅启动前端开发服务器（带 HMR） |
| `npm run build` | 构建生产版本 |
| `npm start` | 启动生产服务器 |

### 独立运行

如果需要单独运行前端或后端：

#### 仅运行前端

```bash
cd web
npm run dev
```

前端将运行在 http://localhost:5173，API 请求会自动代理到 http://localhost:3000。

#### 仅运行后端

```bash
npm run dev:backend
```

后端将运行在 http://localhost:3000。

## 配置说明

### 后端热重启配置

后端使用 `nodemon` 实现热重启，配置文件为 `nodemon.json`：

```json
{
  "watch": ["server.js", "prompt.txt"],
  "ext": "js,txt",
  "ignore": ["node_modules/", "web/", "dist/", ".git/"],
  "delay": "1000",
  "verbose": true
}
```

**监控文件**:
- `server.js`: 后端服务器主文件
- `prompt.txt`: AI 系统提示词

**忽略目录**:
- `node_modules/`: 依赖目录
- `web/`: 前端目录
- `dist/`: 构建输出目录
- `.git/`: Git 目录

**重启延迟**: 1000ms（避免频繁重启）

### 前端 HMR 配置

前端使用 Vite 的 HMR 功能，配置文件为 `web/vite.config.ts`：

```typescript
server: {
  port: 5173,
  strictPort: false,
  host: true,
  hmr: {
    overlay: true,
    protocol: 'ws',
    host: 'localhost',
  },
  watch: {
    usePolling: false,
    interval: 100,
  },
}
```

**HMR 特性**:
- 自动检测文件变更
- 实时更新浏览器
- 保留应用状态
- 错误覆盖层显示

**API 代理**:
- `/api/*` 请求自动代理到 http://localhost:3000
- 支持跨域请求

## 工作流程

### 前端开发流程

1. 修改 `web/src/` 目录下的任意文件
2. Vite 检测到文件变更
3. 自动编译并推送更新到浏览器
4. 浏览器通过 HMR 接收更新
5. 页面自动更新，无需刷新

### 后端开发流程

1. 修改 `server.js` 或 `prompt.txt`
2. Nodemon 检测到文件变更
3. 等待 1 秒（避免频繁重启）
4. 自动重启后端服务
5. 显示重启日志和状态

## 日志输出

### 后端日志

```
🚀 [Backend] Server starting...
🔄 [Backend] Server restarting due to file changes...
👋 [Backend] Server stopped
```

### 前端日志

```
[VITE] hmr update /src/App.tsx
[VITE] hmr invalidate /src/App.tsx
```

## 开发环境 vs 生产环境

### 开发环境

- **访问地址**: http://localhost:5173
- **前端**: Vite 开发服务器，支持 HMR
- **后端**: Express 服务器，仅提供 API
- **静态文件**: 不提供（由 Vite 开发服务器处理）
- **热更新**: 前端 HMR + 后端热重启

### 生产环境

- **访问地址**: http://localhost:3000
- **前端**: 构建后的静态文件（`web/dist`）
- **后端**: Express 服务器，提供 API 和静态文件
- **静态文件**: 提供 `web/dist` 目录
- **热更新**: 不支持

### 环境切换

开发环境通过 `NODE_ENV=development` 环境变量自动识别：

```javascript
// server.js
const isDevelopment = process.env.NODE_ENV === 'development'

if (!isDevelopment) {
  // 仅在生产环境提供静态文件
  app.use(express.static(path.join(__dirname, 'web/dist')))
}
```

## 故障排查

### 问题 1: 访问 http://localhost:3000 看到旧版本界面

**原因**: 开发环境下后端不提供静态文件，如果 `web/dist` 目录存在旧版本文件，可能导致混淆。

**解决方案**:
1. 确保访问 http://localhost:5173（前端开发服务器）
2. 或删除 `web/dist` 目录：`rm -rf web/dist`（Linux/Mac）或 `rmdir /s /q web\dist`（Windows）

### 问题 2: 前端 HMR 不工作

**解决方案**:

1. 检查是否使用 `npm run dev` 启动
2. 确认浏览器控制台是否有错误
3. 尝试清除浏览器缓存
4. 检查防火墙是否阻止 WebSocket 连接

### 问题 2: 后端热重启不工作

**解决方案**:

1. 检查 `nodemon.json` 配置是否正确
2. 确认修改的文件在 `watch` 列表中
3. 查看终端日志确认文件变更是否被检测
4. 尝试手动重启：`npm run dev:backend`

### 问题 3: 端口被占用

**解决方案**:

1. 修改 `web/vite.config.ts` 中的 `port` 配置
2. 修改 `.env` 文件中的 `PORT` 配置
3. 或终止占用端口的进程

### 问题 4: API 请求失败

**解决方案**:

1. 确认后端服务正在运行
2. 检查 API 代理配置是否正确
3. 查看后端日志确认请求是否到达
4. 确认 CORS 配置是否正确

## 性能优化

### 减少重启频率

如果后端重启过于频繁，可以调整 `nodemon.json` 中的 `delay` 参数：

```json
{
  "delay": "2000"
}
```

### 优化文件监控

如果文件监控性能不佳，可以调整 `vite.config.ts` 中的 `watch` 配置：

```typescript
watch: {
  usePolling: true,
  interval: 300,
}
```

## 最佳实践

1. **使用开发命令**: 始终使用 `npm run dev` 启动开发环境
2. **查看日志**: 关注终端日志，了解文件变更和重启状态
3. **及时保存**: 修改代码后及时保存，触发热更新
4. **测试功能**: 热更新后及时测试功能是否正常
5. **清理缓存**: 遇到问题时尝试清理缓存和重启服务

## 生产构建

开发完成后，使用以下命令构建生产版本：

```bash
npm run build
npm start
```

生产环境不支持热更新和热重启。

## 技术栈

- **后端热重启**: Nodemon
- **前端 HMR**: Vite
- **并行运行**: Concurrently
- **开发服务器**: Express + Vite

## 相关文档

- [README.md](./README.md) - 项目概述和使用说明
- [Vite 文档](https://vitejs.dev/) - Vite 官方文档
- [Nodemon 文档](https://nodemon.io/) - Nodemon 官方文档

## 贡献

欢迎提交 Issue 和 Pull Request 来改进开发体验！
