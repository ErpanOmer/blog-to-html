import express from 'express'
import { Ollama } from 'ollama'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import multer from 'multer'
import mammoth from 'mammoth'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000
const isDevelopment = process.env.NODE_ENV === 'development'

// Middleware
app.use(express.json())

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

// Load system prompt
const SYSTEM_PROMPT = fs.readFileSync('./prompt.txt', 'utf8')

// Initialize Ollama client
const ollama = new Ollama({
  host: process.env.OLLAMA_HOST || 'https://ollama.com',
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
// Extract text content from Google Docs
async function fetchGoogleDocsContent(url) {
  // Convert Google Docs URL to export URL
  const docIdMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/)
  if (!docIdMatch) {
    throw new Error('Invalid Google Docs URL')
  }

  const docId = docIdMatch[1]
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=md`

  const response = await fetch(exportUrl)
  if (!response.ok) {
    throw new Error('Failed to fetch Google Docs content. Make sure the document is publicly accessible and supports Markdown export.')
  }

  // Convert response to text
  return await response.text()
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

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`)
  if (isDevelopment) {
    console.log(`📝 Development mode: Frontend runs on http://localhost:5173`)
    console.log(`🔗 API available at http://localhost:${PORT}/api`)
  } else {
    console.log(`🌐 Production mode: Serving static files from web/dist`)
  }
})
