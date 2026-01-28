# Blog To HTML

一键将 Google Docs 或 Markdown 文档转换为标准的 HTML 代码。

## 项目概述

Blog To HTML 是一个基于 AI 的文档转换工具，能够智能地将 Google Docs 在线文档或本地 Markdown 文件转换为语义化的 HTML 代码。项目使用 Ollama AI 模型进行智能转换，支持云端和本地模型，提供实时流式输出和代码预览功能。

### 核心特性

- 🚀 **智能转换**: 基于 AI 模型的智能 Markdown 到 HTML 转换
- 🌐 **多源支持**: 支持 Google Docs URL 和本地 Markdown 文件
- ⚡ **实时流式输出**: 转换过程中实时显示生成结果
- 🎨 **代码预览**: 支持代码视图和预览视图切换
- ✅ **HTML 验证**: 自动验证生成的 HTML 代码质量
- ☁️ **云端/本地**: 支持云端 Ollama API 和本地 Ollama 服务
- 📋 **一键复制**: 快速复制生成的 HTML 代码

## 技术栈

### 后端
- **Node.js** + **Express**: 服务器框架
- **Ollama**: AI 模型集成
- **Multer**: 文件上传处理
- **Mammoth**: 文档内容提取

### 前端
- **React 19**: UI 框架
- **TypeScript**: 类型安全
- **Vite**: 构建工具
- **Tailwind CSS**: 样式框架
- **Radix UI**: UI 组件库
- **React Syntax Highlighter**: 代码高亮
- **Prettier**: 代码格式化

## 安装步骤

### 环境要求

- Node.js >= 18.0.0
- npm 或 yarn

### 安装依赖

```bash
# 安装后端依赖
npm install

# 安装前端依赖并构建
npm run build
```

### 配置环境变量

创建 `.env` 文件（可选）：

```env
# Ollama 服务地址（云端或本地）
OLLAMA_HOST=https://ollama.com

# Ollama API 密钥（云端需要）
OLLAMA_API_KEY=your_api_key_here

# 服务器端口（默认 3000）
PORT=3000
```

## 使用方法

### 开发环境（推荐）

项目支持热更新和热重启功能，开发时无需手动重启服务：

```bash
# 启动开发环境（前后端同时运行，支持热更新）
npm run dev
```

开发环境特性：
- 前端代码修改后自动热更新（HMR），无需刷新页面
- 后端代码修改后自动重启服务
- 实时日志显示文件变更和重启状态

详细配置请参考 [DEVELOPMENT.md](./DEVELOPMENT.md)

### 生产环境

```bash
# 先构建前端
npm run build

# 然后启动生产服务器
npm start

# 或使用本地 Ollama 服务
npm run start:local

# 或指定云端服务
npm run start:remote
```

生产环境启动后，访问 http://localhost:3000

**注意**: 生产环境和开发环境的区别：
- **开发环境**: 访问 http://localhost:5173（前端开发服务器）
- **生产环境**: 访问 http://localhost:3000（后端服务器提供静态文件）

详细说明请参考 [DEVELOPMENT.md](./DEVELOPMENT.md)

### 使用示例

#### 1. Google Docs 转换

1. 将 Google Docs 文档设置为「任何人均可查看」
2. 复制文档 URL
3. 在应用中选择「Google Docs」标签
4. 粘贴 URL 并点击「立即转换」

#### 2. Markdown 文件转换

1. 在应用中选择「Markdown 文件」标签
2. 点击上传区域或拖放 .md 文件
3. 选择 AI 模型
4. 点击「立即转换」

#### 3. 查看和复制结果

- 转换完成后，可在「代码」或「预览」视图中查看结果
- 点击「复制」按钮复制 HTML 代码

## 配置说明

### 环境变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `OLLAMA_HOST` | Ollama 服务地址 | `https://ollama.com` |
| `OLLAMA_API_KEY` | Ollama API 密钥 | - |
| `PORT` | 服务器端口 | `3000` |

### Ollama 模型配置

项目默认使用 `qwen3-coder:480b-cloud` 模型。您可以通过 API 接口获取可用模型列表并选择其他模型。

### 端口配置

默认端口为 3000，可通过环境变量 `PORT` 修改。

## 目录结构

```
blog-to-html/
├── server.js              # 后端服务器主文件
├── package.json           # 后端依赖配置
├── prompt.txt             # AI 系统提示词
├── nodemon.json           # 后端热重启配置
├── DEVELOPMENT.md         # 开发环境文档
├── README.md              # 项目说明文档
├── run-local.js           # 本地运行脚本
├── run-cloude.js          # 云端运行脚本
├── web/                   # 前端应用目录
│   ├── src/
│   │   ├── components/    # React 组件
│   │   │   └── ui/       # UI 组件库
│   │   ├── lib/          # 工具函数
│   │   ├── App.tsx       # 主应用组件
│   │   └── main.tsx      # 应用入口
│   ├── public/           # 静态资源
│   ├── package.json      # 前端依赖配置
│   └── vite.config.ts    # Vite 配置
└── .env                  # 环境变量（需自行创建）
```

## API 接口

### 获取可用模型

```http
GET /api/models
```

**响应示例**:
```json
{
  "models": ["qwen3-coder:480b-cloud", "llama3:latest"],
  "response": {...}
}
```

### 转换内容

```http
POST /api/convert
Content-Type: application/json

{
  "sourceType": "googledocs" | "md",
  "url": "https://docs.google.com/document/d/...",  // Google Docs URL
  "content": "# Markdown content",                  // Markdown 内容
  "model": "qwen3-coder:480b-cloud"                // 模型名称
}
```

**响应**: Server-Sent Events (SSE) 流式响应

```json
// 数据块
{"type": "chunk", "content": "<section>"}

// 验证结果
{"type": "validation", "valid": true, "errors": []}

// 完成
{"type": "done"}

// 错误
{"type": "error", "message": "错误信息"}
```

### 上传文件

```http
POST /api/upload
Content-Type: multipart/form-data

file: [Markdown 文件]
```

**响应示例**:
```json
{
  "content": "# Markdown 文件内容"
}
```

## 开发指南

### 开发环境

项目已配置完整的开发环境，支持热更新和热重启功能：

```bash
# 启动开发环境（前后端同时运行）
npm run dev

# 仅启动后端（带热重启）
npm run dev:backend

# 仅启动前端（带 HMR）
npm run dev:frontend
```

详细配置请参考 [DEVELOPMENT.md](./DEVELOPMENT.md)

### 构建前端

```bash
npm run build
```

### 代码规范

- 使用 TypeScript 进行类型检查
- 遵循 ESLint 规则
- 使用 Prettier 格式化代码

## 贡献指南

欢迎贡献代码！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 许可证

本项目采用 ISC 许可证。

## 常见问题

### Q: Google Docs 转换失败怎么办？

A: 请确保文档已设置为「任何人均可查看」，并且文档支持 Markdown 导出。

### Q: 如何使用本地 Ollama 模型？

A: 安装 Ollama 后，使用 `npm run start:local` 启动服务，或设置环境变量 `OLLAMA_HOST=http://localhost:11434`。

### Q: 支持哪些 Markdown 语法？

A: 支持标准 Markdown 语法，包括标题、列表、表格、链接、图片等。具体转换规则请参考 `prompt.txt` 文件。

### Q: 生成的 HTML 代码可以自定义样式吗？

A: 生成的 HTML 代码不包含样式属性，您可以根据需要添加自定义 CSS 样式。

## 联系方式

如有问题或建议，欢迎提交 Issue 或 Pull Request。

---

**Semantic HTML • Precise Transformation • Cloud Ready**
