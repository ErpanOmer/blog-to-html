import { Ollama } from "ollama";
import fs from 'fs'

const SYSTEM_PROMPT = fs.readFileSync('./prompt.txt', 'utf8')
const INPUT = fs.readFileSync('./input.txt', 'utf8')

const ollama = new Ollama({
  host: "https://ollama.com",
  headers: {
    Authorization: `Bearer ${process.env.OLLAMA_API_KEY}`,
  },
})

const model = 'qwen3-coder:480b-cloud'

const response = await ollama.chat({
  model,
  messages: [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: INPUT },
  ],
  stream: true,
})

const outStream = fs.createWriteStream('./output.html', { flags: 'w' })
for await (const part of response) {
  const content = part?.message?.content ?? ''
  process.stdout.write(content)
  outStream.write(content)
}

outStream.end()
