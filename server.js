import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import multer from 'multer'
import {
  PublicError,
  conversionRequestSchema,
  discoverModels,
  discoveryRequestSchema,
  formatValidationError,
  normalizeProviderError,
  streamConversion,
  testProvider,
  testRequestSchema,
} from './server/llm.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const promptPath = path.join(__dirname, 'prompt.txt')

if (!fs.existsSync(promptPath)) {
  console.error('❌ prompt.txt 不存在，无法启动')
  process.exit(1)
}

const SYSTEM_PROMPT = fs.readFileSync(promptPath, 'utf8')

const storage = multer.memoryStorage()
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === 'text/markdown' ||
      file.mimetype === 'text/x-markdown' ||
      file.originalname.toLowerCase().endsWith('.md')
    ) {
      cb(null, true)
    } else {
      cb(new Error('仅支持 .md 文件'))
    }
  },
})

function validateHtmlOutput(html) {
  const errors = []
  if (/<html[\s>]/i.test(html)) errors.push('包含不允许的 <html> 标签')
  if (/<head[\s>]/i.test(html)) errors.push('包含不允许的 <head> 标签')
  if (/<body[\s>]/i.test(html)) errors.push('包含不允许的 <body> 标签')
  if (/```/.test(html)) errors.push('包含代码围栏标记（```）')
  if (!/<section/i.test(html)) errors.push('缺少用于内容区块的 <section> 标签')
  if (!/<h2/i.test(html) && !/<h3/i.test(html)) errors.push('缺少 h2/h3 标题标签')
  return { valid: errors.length === 0, errors }
}

async function fetchGoogleDocsContent(url) {
  const docIdMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/)
  if (!docIdMatch) throw new PublicError(400, 'invalid_google_docs_url', 'Google Docs URL 无效')

  const exportUrl = `https://docs.google.com/document/d/${docIdMatch[1]}/export?format=md`
  let response
  try {
    response = await fetch(exportUrl, { signal: AbortSignal.timeout(15_000) })
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new PublicError(504, 'google_docs_timeout', '访问 Google Docs 超时，请检查网络连接')
    }
    throw new PublicError(502, 'google_docs_unavailable', '无法访问 Google Docs，请检查网络连接')
  }

  if (!response.ok) {
    throw new PublicError(400, 'google_docs_unavailable', '无法访问 Google Docs，请确认文档已设为“知道链接的任何人可查看”')
  }

  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()
  if (contentType.includes('text/html') && /<form[^>]*login|accounts\.google\.com\/ServiceLogin/i.test(text)) {
    throw new PublicError(400, 'google_docs_private', '该 Google Docs 需要登录，请将权限设为“知道链接的任何人可查看”')
  }
  return text
}

function sendSse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}

function parseOrThrow(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new PublicError(400, 'invalid_request', formatValidationError(result.error) || '请求参数无效')
  }
  return result.data
}

function sendPublicError(res, error) {
  const publicError = error instanceof PublicError
    ? error
    : new PublicError(500, 'internal_error', '服务器内部错误')
  return res.status(publicError.status).json({ error: publicError.message, code: publicError.code })
}

export function createApp({ isDevelopment = process.env.NODE_ENV === 'development' } = {}) {
  const app = express()
  app.use(express.json({ limit: '5mb' }))

  if (!isDevelopment) app.use(express.static(path.join(__dirname, 'web/dist')))

  app.post('/api/models/discover', async (req, res) => {
    try {
      const { provider } = parseOrThrow(discoveryRequestSchema, req.body)
      const models = await discoverModels(provider)
      res.json({ models })
    } catch (error) {
      const publicError = error instanceof PublicError ? error : normalizeProviderError(error, req.body?.provider)
      console.error('Model discovery failed:', publicError.code)
      sendPublicError(res, publicError)
    }
  })

  app.post('/api/providers/test', async (req, res) => {
    const controller = new AbortController()
    req.on('aborted', () => controller.abort())
    try {
      const { provider, model } = parseOrThrow(testRequestSchema, req.body)
      await testProvider(provider, model, { signal: controller.signal })
      res.json({ ok: true })
    } catch (error) {
      const publicError = error instanceof PublicError ? error : normalizeProviderError(error, req.body?.provider)
      console.error('Provider test failed:', publicError.code)
      sendPublicError(res, publicError)
    }
  })

  app.post('/api/convert', async (req, res) => {
    let request
    try {
      request = parseOrThrow(conversionRequestSchema, req.body)
      let inputContent = request.content
      if (request.sourceType === 'googledocs') {
        if (!request.url?.trim()) throw new PublicError(400, 'missing_url', '请提供 Google Docs URL')
        inputContent = await fetchGoogleDocsContent(request.url)
      }
      if (!inputContent?.trim()) throw new PublicError(400, 'missing_content', '请提供要转换的文档内容')

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
      res.setHeader('Cache-Control', 'no-cache, no-transform')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders()

      const controller = new AbortController()
      const abortUpstream = () => {
        if (!res.writableEnded) controller.abort()
      }
      req.on('aborted', abortUpstream)
      res.on('close', abortUpstream)

      let fullOutput = ''
      try {
        const result = streamConversion(
          request.provider,
          request.model,
          SYSTEM_PROMPT,
          inputContent,
          { signal: controller.signal },
        )
        for await (const chunk of result.textStream) {
          fullOutput += chunk
          sendSse(res, { type: 'chunk', content: chunk })
        }
        sendSse(res, { type: 'validation', ...validateHtmlOutput(fullOutput) })
        sendSse(res, { type: 'done' })
        res.end()
      } catch (error) {
        if (!res.writableEnded && !controller.signal.aborted) {
          const publicError = normalizeProviderError(error, request.provider)
          console.error('Conversion failed:', publicError.code)
          sendSse(res, { type: 'error', message: publicError.message, code: publicError.code })
          res.end()
        }
      } finally {
        req.off('aborted', abortUpstream)
        res.off('close', abortUpstream)
      }
    } catch (error) {
      const publicError = error instanceof PublicError
        ? error
        : normalizeProviderError(error, request?.provider || req.body?.provider)
      console.error('Conversion setup failed:', publicError.code)
      if (!res.headersSent) sendPublicError(res, publicError)
    }
  })

  app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: '未上传文件' })
    res.json({ content: req.file.buffer.toString('utf8') })
  })

  if (!isDevelopment) {
    app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'web/dist/index.html')))
  }

  app.use((error, _req, res, _next) => {
    console.error('Unhandled request error:', error?.name || 'Error')
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? '文件过大，最大支持 10MB' : error.message
      return res.status(400).json({ error: message })
    }
    if (error?.message === '仅支持 .md 文件') return res.status(400).json({ error: error.message })
    if (error?.type === 'entity.too.large' || error?.status === 413) {
      return res.status(413).json({ error: '请求体过大，最大支持 5MB' })
    }
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: '请求体 JSON 格式错误' })
    return res.status(500).json({ error: '服务器内部错误' })
  })

  return app
}

export function startServer() {
  const port = process.env.PORT || 3000
  const isDevelopment = process.env.NODE_ENV === 'development'
  return createApp({ isDevelopment }).listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`)
    if (isDevelopment) {
      console.log('📑 Frontend development server: http://localhost:5173')
      console.log(`🔗 API: http://localhost:${port}/api`)
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) startServer()
