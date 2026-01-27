import fs from 'fs'
import fetch from 'node-fetch'

const prompt = fs.readFileSync('./prompt.txt', 'utf8')
const input = fs.readFileSync('./input.txt', 'utf8')

const res = await fetch('http://localhost:11434/api/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model: 'qwen2.5-coder:7b',
    system: prompt,
    prompt: input,
    stream: false
  })
})

const data = await res.json()
fs.writeFileSync('./output.html', data.response)
