# Blog To HTML

将 Google Docs 或 Markdown 文档交给任意 OpenAI-compatible / Anthropic-compatible 文本模型，实时转换为语义化 HTML。

## 功能

- Google Docs 链接与本地 Markdown 文件输入
- OpenAI Chat Completions-compatible 与 Anthropic Messages-compatible 两种 API 格式
- DeepSeek、OpenAI、Anthropic、Ollama 和自定义服务模板
- 多个模型配置档案，可在页面中快速切换配置与模型
- 自动发现模型，并支持手动添加不提供 `/models` 接口的模型
- SSE 实时流式输出、取消请求、HTML 校验、代码格式化与预览
- API Key 和配置仅保存在当前浏览器，不写入服务端

## 技术栈

- 后端：Node.js、Express、Vercel AI SDK、Multer、Zod
- 前端：React 19、TypeScript、Vite、Tailwind CSS、Radix UI
- 测试：Node Test Runner、Vitest、Testing Library

## 环境要求

- Node.js 18 或更高版本
- npm

## 安装与启动

```bash
npm install
cd web
npm install
cd ..
```

开发环境：

```bash
npm run dev
```

- 前端：http://localhost:5173
- 后端 API：http://localhost:3000/api

生产环境：

```bash
npm run build
npm start
```

生产页面默认位于 http://localhost:3000。

可选环境变量只有通用服务器配置：

```env
PORT=3000
NODE_ENV=production
```

模型的 Base URL、API Key、模型 ID 和自定义请求头全部在页面的“模型 API 设置”中管理。服务端不再读取任何 `OLLAMA_*` 环境变量。

## 配置模型

首次打开页面时会自动显示设置窗口。选择模板，填写 API Key，获取或手动添加模型，然后保存。

| 服务 | API 格式 | Base URL | 备注 |
| --- | --- | --- | --- |
| DeepSeek | OpenAI Compatible | `https://api.deepseek.com` | 内置当前 DeepSeek 模型 ID，可编辑 |
| DeepSeek | Anthropic Compatible | `https://api.deepseek.com/anthropic` | 使用 Anthropic Messages 格式 |
| OpenAI | OpenAI Compatible | `https://api.openai.com/v1` | 可通过 `/models` 获取模型 |
| Anthropic | Anthropic Compatible | `https://api.anthropic.com/v1` | Claude Messages API |
| Ollama | OpenAI Compatible | `http://localhost:11434/v1` | 本地服务可留空 API Key |
| 其他代理 | 任一兼容格式 | 服务商提供的完整前缀 | 不会自动追加 `/v1` |

### 模型发现与手动模型

“获取模型”会请求配置 Base URL 下的 `/models`。并非所有兼容代理都实现该接口；发现失败不会影响配置保存，可直接输入模型 ID 后点击“添加”。

### 自定义请求头

高级配置支持租户、代理或非标准认证请求头。为避免请求走私，不允许设置 `Host`、`Content-Length`、`Connection`、`Transfer-Encoding` 等传输层请求头。

### 密钥安全

本项目按本机个人工具设计：

- API Key 以明文保存在当前浏览器的 Local Storage。
- 密钥仅在模型发现、连接测试或转换时发送到同源 Express 服务，再由服务端转发至配置的模型地址。
- 服务端不保存、不回传、也不记录 API Key；错误返回会对密钥和自定义头值脱敏。
- 不要在公共电脑使用。清理该站点的浏览器数据会删除全部配置和 API Key。
- 若要部署为公网或多人服务，应先增加登录、用户隔离、服务端密钥库和 SSRF 防护。

## API

### 发现模型

```http
POST /api/models/discover
Content-Type: application/json
```

```json
{
  "provider": {
    "protocol": "openai-compatible",
    "baseUrl": "https://api.example.com/v1",
    "apiKey": "your-key",
    "headers": {}
  }
}
```

成功响应：

```json
{ "models": ["model-a", "model-b"] }
```

### 测试连接

```http
POST /api/providers/test
Content-Type: application/json
```

```json
{
  "provider": {
    "protocol": "anthropic-compatible",
    "baseUrl": "https://api.example.com/v1",
    "apiKey": "your-key",
    "headers": {}
  },
  "model": "model-id"
}
```

该接口会执行一个最多输出少量 token 的真实请求，可能产生极少量费用。

### 转换

```http
POST /api/convert
Content-Type: application/json
```

Google Docs：

```json
{
  "sourceType": "googledocs",
  "url": "https://docs.google.com/document/d/...",
  "model": "model-id",
  "provider": {
    "protocol": "openai-compatible",
    "baseUrl": "https://api.example.com/v1",
    "apiKey": "your-key",
    "headers": {}
  }
}
```

Markdown 使用相同结构，将 `url` 替换为 `content`，并将 `sourceType` 设为 `md`。

响应为 SSE：

```text
data: {"type":"chunk","content":"<section>"}
data: {"type":"validation","valid":true,"errors":[]}
data: {"type":"done"}
```

## 测试

```bash
# 后端适配、模型发现、错误脱敏和 SSE 集成测试
npm test

# 前端设置、持久化和转换请求测试
npm --prefix web test

# 静态检查与生产构建
npm --prefix web run lint
npm --prefix web run build
```

## 项目结构

```text
blog-to-html/
├── server.js                    # Express 入口与业务路由
├── server/llm.js                # 通用模型适配、校验、发现和错误处理
├── tests/llm.test.js            # 后端与 SSE 集成测试
├── prompt.txt                   # 文档转 HTML 系统提示词
└── web/src/
    ├── App.tsx                  # 转换主界面
    └── features/model-settings/ # 模型档案、设置 UI、存储与 API
```

## 支持边界

“任意模型”指提供 OpenAI Chat Completions-compatible 或 Anthropic Messages-compatible 文本生成接口的服务。不兼容这两种协议的专有 API 需要额外编写 Provider。
