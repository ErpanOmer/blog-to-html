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

// Middleware
app.use(express.json())
app.use(express.static(path.join(__dirname, 'web/dist')))

// Multer configuration for file uploads
const storage = multer.memoryStorage()
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      file.originalname.endsWith('.docx')) {
      cb(null, true)
    } else {
      cb(new Error('Only .docx files are allowed'))
    }
  }
})

// Load system prompt
const SYSTEM_PROMPT = fs.readFileSync('./prompt.txt', 'utf8')

// Initialize Ollama client
const ollama = new Ollama({
  host: 'https://ollama.com',
  headers: {
    Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
  },
})

const MODEL = 'qwen3-coder:480b-cloud'

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
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=docx`

  const response = await fetch(exportUrl)
  if (!response.ok) {
    throw new Error('Failed to fetch Google Docs content. Make sure the document is publicly accessible.')
  }

  return await response.text()
}

// Extract text from DOCX file
async function extractDocxContent(buffer) {
  const result = await mammoth.extractRawText({ buffer })
  return result.value
}

// SSE endpoint for streaming conversion
app.post('/api/convert', async (req, res) => {
  try {
    const { content, sourceType, url } = req.body

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
      model: MODEL,
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

    const content = await extractDocxContent(req.file.buffer)
    res.json({ content })

  } catch (error) {
    console.error('Upload error:', error)
    res.status(500).json({ error: error.message })
  }
})

// Serve React app for any other routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'web/dist/index.html'))
})

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`)
})
