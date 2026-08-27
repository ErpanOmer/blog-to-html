import express from 'express'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import multer from 'multer'
import { fetchGoogleDocsContent } from './server/google-docs.js'
import { getBackendPort, getFrontendPort } from './server/ports.js'
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

export function estimateTokenCount(text) {
  let cjkCharacters = 0
  let otherCharacters = 0
  for (const character of String(text || '')) {
    if (/[\u2e80-\u9fff\uac00-\ud7af\u3040-\u30ff]/u.test(character)) cjkCharacters += 1
    else if (!/\s/u.test(character)) otherCharacters += 1
  }
  return Math.ceil(cjkCharacters * 1.1 + otherCharacters / 4) + 16
}

function mergeUsage(total, usage) {
  for (const key of ['inputTokens', 'outputTokens', 'totalTokens']) {
    const value = usage?.[key]
    if (Number.isFinite(value)) total[key] = (total[key] || 0) + value
  }
  return total
}

const CONTINUATION_PROMPT = [
  '上一段 HTML 因输出长度上限而中断。',
  '请从上一段的最后一个字符之后精确续写，只输出尚未生成的 HTML。',
  '不要重复已有内容，不要添加解释、注释或代码围栏，并补全所有未闭合标签。',
].join('')

export function createApp({ isDevelopment = process.env.NODE_ENV === 'development' } = {}) {
  const app = express()
  app.use(express.json({ limit: '15mb' }))

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

      const initialEstimatedInputTokens = estimateTokenCount(SYSTEM_PROMPT) + estimateTokenCount(inputContent)
      const initialAvailableOutputTokens = request.generation.contextWindowTokens - initialEstimatedInputTokens - 256
      if (initialAvailableOutputTokens < 256) {
        throw new PublicError(
          400,
          'context_window_exceeded',
          `预计输入约 ${initialEstimatedInputTokens.toLocaleString()} token，已接近或超过配置的 ${request.generation.contextWindowTokens.toLocaleString()} token 上下文窗口。请改用更大上下文模型，或拆分文档后再转换`,
        )
      }

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
        const totalUsage = {}
        let finishReason = 'other'
        let rawFinishReason
        let continuationsUsed = 0
        let contextBudgetExhausted = false
        let messages

        sendSse(res, {
          type: 'budget',
          estimatedInputTokens: initialEstimatedInputTokens,
          contextWindowTokens: request.generation.contextWindowTokens,
          requestedMaxOutputTokens: request.generation.maxOutputTokens,
          effectiveMaxOutputTokens: Math.min(request.generation.maxOutputTokens, initialAvailableOutputTokens),
        })

        for (let round = 0; round <= request.generation.continuationRounds; round += 1) {
          const estimatedRoundInputTokens = round === 0
            ? initialEstimatedInputTokens
            : estimateTokenCount(SYSTEM_PROMPT) +
              estimateTokenCount(inputContent) +
              estimateTokenCount(fullOutput) +
              estimateTokenCount(CONTINUATION_PROMPT)
          const availableOutputTokens = request.generation.contextWindowTokens - estimatedRoundInputTokens - 256
          if (availableOutputTokens < 256) {
            contextBudgetExhausted = true
            break
          }

          const maxOutputTokens = Math.min(request.generation.maxOutputTokens, availableOutputTokens)
          if (round > 0) {
            continuationsUsed += 1
            messages = [
              { role: 'user', content: inputContent },
              { role: 'assistant', content: fullOutput },
              { role: 'user', content: CONTINUATION_PROMPT },
            ]
            sendSse(res, {
              type: 'progress',
              message: `检测到输出达到长度上限，正在自动续写（${continuationsUsed}/${request.generation.continuationRounds}）…`,
            })
          }

          const result = streamConversion(
            request.provider,
            request.model,
            SYSTEM_PROMPT,
            inputContent,
            {
              signal: controller.signal,
              maxOutputTokens,
              messages,
            },
          )
          for await (const chunk of result.textStream) {
            fullOutput += chunk
            sendSse(res, { type: 'chunk', content: chunk })
          }

          finishReason = await result.finishReason
          rawFinishReason = await result.rawFinishReason
          mergeUsage(totalUsage, await result.totalUsage)
          const warnings = await result.warnings
          if (warnings?.length) {
            sendSse(res, {
              type: 'warning',
              message: warnings.map((warning) => warning.message || String(warning)).join('；'),
            })
          }
          if (finishReason !== 'length') break
        }

        const truncated = finishReason === 'length' || contextBudgetExhausted
        const truncationMessage = contextBudgetExhausted
          ? '自动续写已停止：输入与已有输出已用尽配置的上下文窗口。请改用更大上下文模型或拆分文档'
          : truncated
            ? `模型在达到输出长度上限后仍未完成；已使用 ${continuationsUsed} 次自动续写。请提高“单次最大输出”或“自动续写次数”`
            : undefined

        sendSse(res, {
          type: 'finish',
          finishReason,
          rawFinishReason,
          truncated,
          message: truncationMessage,
          continuationsUsed,
          usage: totalUsage,
        })
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
      return res.status(413).json({ error: '请求体过大，最大支持 15MB' })
    }
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: '请求体 JSON 格式错误' })
    return res.status(500).json({ error: '服务器内部错误' })
  })

  return app
}

export function startServer() {
  const port = getBackendPort()
  const isDevelopment = process.env.NODE_ENV === 'development'
  return createApp({ isDevelopment }).listen(port, () => {
    console.log(`🚀 Server running at http://localhost:${port}`)
    if (isDevelopment) {
      console.log(`📑 Frontend development server: http://localhost:${getFrontendPort()}`)
      console.log(`🔗 API: http://localhost:${port}/api`)
    }
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) startServer()
