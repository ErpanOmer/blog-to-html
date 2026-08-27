# 开发指南

## 本地开发

```bash
npm install
cd web && npm install && cd ..
npm run dev
```

开发模式同时运行：

- Express API：`http://localhost:38471`
- Vite 前端：`http://localhost:38472`
- Vite 将 `/api` 代理到 Express；前端和后端修改均支持热更新。

模型凭证不使用环境变量。打开前端后，在“模型 API 设置”中创建浏览器本地配置。`.env` 仅在需要时用于通用进程变量，例如：

```env
BACKEND_PORT=38471
FRONTEND_PORT=38472
NODE_ENV=development
```

当前 `npm start` 和 nodemon 不主动加载 `.env`，避免将模型凭证绑定到进程。若需要环境变量，请在启动终端中设置，或由进程管理器注入。`BACKEND_PORT` 同时用于 Express 和 Vite 的 `/api` 代理目标，`FRONTEND_PORT` 用于 Vite 页面；两者必须在同一个终端中设置后再启动：

```powershell
$env:BACKEND_PORT = '38471'
$env:FRONTEND_PORT = '38472'
npm run dev
```

默认端口就是上面的冷门端口。若再次与其他程序冲突，只需改成两个不同的 `1024–65535` 整数后重启；旧的 `PORT` 仍可作为后端端口的兼容写法。

## 模型调用架构

```text
浏览器配置档案（Local Storage）
        │ 当前 provider + model
        ▼
Express API
        │ 校验、脱敏、中止传播
        ▼
Vercel AI SDK
        ├── OpenAI-compatible Provider
        └── Anthropic Provider
                │
                ▼
DeepSeek / OpenAI / Claude / Ollama / 自定义代理
```

- `server/llm.js` 是模型协议边界，负责 Zod 校验、Provider 创建、模型发现、最小连接测试、流式生成和错误归一化。
- `server.js` 负责文档输入、SSE 输出、HTML 校验和 Express 生命周期。
- `web/src/features/model-settings` 负责配置档案类型、版本化 Local Storage、设置 UI 和设置 API。
- Base URL 是完整 API 前缀，不能在服务端统一追加 `/v1`。
- 模型发现是可选能力；任何 Provider 都必须允许手动模型 ID。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动前后端开发服务 |
| `npm run dev:backend` | 仅启动 Express + nodemon |
| `npm run dev:frontend` | 仅启动 Vite |
| `npm test` | 后端与本地假上游集成测试 |
| `npm --prefix web test` | 前端 Vitest 测试 |
| `npm --prefix web run lint` | ESLint |
| `npm run build` | 安装并构建前端生产资源 |
| `npm start` | 生产模式启动 Express |

## 增加兼容服务

若服务兼容现有两种协议，只需添加一个前端模板，不应增加新的后端分支：

1. 在模型模板中提供名称、协议和准确 Base URL。
2. 模型 ID 易变时保持模型列表为空，让用户发现或手动输入。
3. 只有协议本身不兼容时，才在模型适配层增加新的 Provider 类型。

## 错误与安全约束

- 后端日志只记录归一化错误代码，不记录上游原始错误对象。
- 新增错误路径时必须通过 `normalizeProviderError` 与 `redactSecrets`。
- 自定义请求头名称和值必须继续经过校验；不要放宽传输层请求头黑名单。
- 本项目允许访问 localhost 和内网地址，因为目标是本机个人工具；改为公网部署前必须增加 SSRF 防护。
- API Key 只存在浏览器 Local Storage 和单次请求内存中，不能写入服务端文件或测试快照。

## 提交前验证

```bash
npm test
npm --prefix web test
node --check server.js
node --check server/llm.js
npm --prefix web run lint
npm --prefix web run build
```
