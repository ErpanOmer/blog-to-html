import express from 'express'
import { Ollama } from 'ollama'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import multer from 'multer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000
const isDevelopment = process.env.NODE_ENV === 'development'

// Middleware
app.use(express.json({ limit: '5mb' }))

// Only serve static files in production mode
// In development, frontend runs on port 5173 with Vite dev server
if (!isDevelopment) {
  app.use(express.static(path.join(__dirname, 'web/dist')))
}

// Multer configuration for file uploads
const storage = multer.memoryStorage()
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/markdown' ||
      file.mimetype === 'text/x-markdown' ||
      file.originalname.endsWith('.md')) {
      cb(null, true)
    } else {
      cb(new Error('Only .md files are allowed'))
    }
  }
})

// Load system prompt (fail fast if missing)
if (!fs.existsSync('./prompt.txt')) {
  console.error('❌ prompt.txt 不存在，无法启动')
  process.exit(1)
}
const SYSTEM_PROMPT = fs.readFileSync('./prompt.txt', 'utf8')

// Warn if using cloud Ollama without API key
const ollamaHost = process.env.OLLAMA_HOST || 'https://ollama.com'
if (ollamaHost.includes('ollama.com') && !process.env.OLLAMA_API_KEY) {
  console.warn('⚠️ 使用云端 Ollama 但未设置 OLLAMA_API_KEY，请求可能返回 401')
}

// Initialize Ollama client
const ollama = new Ollama({
  host: ollamaHost,
  headers: {
    Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
  },
})

const DEFAULT_MODEL = 'qwen3-coder:480b-cloud'

// Validation function to check HTML output
function validateHtmlOutput(html) {
  const errors = []

  // Check for forbidden tags
  if (/<html[\s>]/i.test(html)) errors.push('Contains forbidden <html> tag')
  if (/<head[\s>]/i.test(html)) errors.push('Contains forbidden <head> tag')
  if (/<body[\s>]/i.test(html)) errors.push('Contains forbidden <body> tag')
  if (/```/.test(html)) errors.push('Contains code fence markers (```)')

  // Check for proper structure
  if (!/<section/i.test(html)) errors.push('Missing <section> tags for content blocks')
  if (!/<h2/i.test(html) && !/<h3/i.test(html)) errors.push('Missing heading tags (h2/h3)')

  return {
    valid: errors.length === 0,
    errors
  }
}

// Extract text content from Google Docs
async function fetchGoogleDocsContent(url) {
  // Convert Google Docs URL to export URL
  const docIdMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/)
  if (!docIdMatch) {
    throw new Error('Invalid Google Docs URL')
  }

  const docId = docIdMatch[1]
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=md`

  let response
  try {
    response = await fetch(exportUrl, { signal: AbortSignal.timeout(15000) })
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error('访问 Google Docs 超时，请检查网络连接')
    }
    throw new Error('无法访问 Google Docs：' + (err.message || '网络错误'))
  }

  if (!response.ok) {
    throw new Error('无法访问 Google Docs，请确认文档已设为「任何知道链接的人可查看」')
  }

  // 校验 Content-Type，避免把登录页 HTML 当作 markdown
  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()

  // Google 导出 md 时 Content-Type 可能是 text/markdown 或 text/plain；
  // 若返回 text/html 且内容像登录页，说明文档未公开
  if (contentType.includes('text/html') && /<form[^>]*login|accounts\.google\.com\/ServiceLogin/i.test(text)) {
    throw new Error('该 Google Docs 需要登录访问，请将文档权限设为「任何知道链接的人可查看」')
  }

  return text
}

// Extract content from Markdown file upload
function readMarkdownContent(buffer) {
  return buffer.toString('utf8')
}

// Models endpoint
app.get('/api/models', async (req, res) => {
  try {
    const response = await ollama.list()

    // Remote might return models in a different format or might not have list()
    // Local Ollama returns { models: [{ name, ... }, ...] }
    const modelList = response.models?.map(m => m.name) || []
    res.json({ models: modelList, response })
  } catch (error) {
    console.error('Fetch models error:', error)
    // If list() fails (e.g. on some remote hosts), return a default list or empty
    res.json({ models: [DEFAULT_MODEL] })
  }
})

// SSE endpoint for streaming conversion
app.post('/api/convert', async (req, res) => {
  try {
    const { content, sourceType, url, model } = req.body

    let inputContent = content

    // If Google Docs URL provided, fetch content
    if (sourceType === 'googledocs' && url) {
      inputContent = await fetchGoogleDocsContent(url)
    }

    if (!inputContent || inputContent.trim().length === 0) {
      return res.status(400).json({ error: 'No content provided' })
    }

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    let fullOutput = ''

    // Stream response from Ollama
    const response = await ollama.chat({
      model: model || DEFAULT_MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: inputContent },
      ],
      stream: true,
    })

    for await (const part of response) {
      const chunk = part?.message?.content ?? ''
      fullOutput += chunk

      // Send chunk to client
      res.write(`data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`)
    }

    // Validate output
    const validation = validateHtmlOutput(fullOutput)
    res.write(`data: ${JSON.stringify({ type: 'validation', ...validation })}\n\n`)
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`)
    res.end()

  } catch (error) {
    console.error('Conversion error:', error)
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`)
    res.end()
  }
})

// File upload endpoint
app.post('/api/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' })
    }

    const content = readMarkdownContent(req.file.buffer)
    res.json({ content })

  } catch (error) {
    console.error('Upload error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Serve React app for any other routes (production only)
if (!isDevelopment) {
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'web/dist/index.html'))
  })
}

// Global error-handling middleware (must be last, after all routes)
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err)

  // Multer errors (file size, unexpected field, etc.)
  if (err instanceof multer.MulterError) {
    let msg = err.message
    if (err.code === 'LIMIT_FILE_SIZE') {
      msg = '文件过大，最大支持 10MB'
    }
    return res.status(400).json({ error: msg })
  }

  // fileFilter rejection (non-.md files)
  if (err?.message?.includes('Only .md files')) {
    return res.status(400).json({ error: err.message })
  }

  // JSON body too large
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({ error: '请求体过大，最大支持 5MB' })
  }

  // JSON parse errors
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体格式错误' })
  }

  res.status(500).json({ error: err?.message || '服务器内部错误' })
})

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`)
  if (isDevelopment) {
    console.log(`📝 Development mode: Frontend runs on http://localhost:5173`)
    console.log(`🔗 API available at http://localhost:${PORT}/api`)
  } else {
    console.log(`🌐 Production mode: Serving static files from web/dist`)
  }
})
