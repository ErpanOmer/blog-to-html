import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, test } from 'node:test'

import { createApp } from '../server.js'
import {
  DEFAULT_GENERATION_SETTINGS,
  conversionRequestSchema,
  discoverModels,
  normalizeProviderError,
  providerConnectionSchema,
  redactSecrets,
  testProvider as verifyProvider,
} from '../server/llm.js'

const openAiProvider = (baseUrl, apiKey = 'test-secret') => ({
  protocol: 'openai-compatible',
  baseUrl,
  apiKey,
  headers: { 'X-Tenant': 'tenant-secret' },
})

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

describe('provider configuration', () => {
  test('rejects unsupported protocols, URL credentials, and transport headers', () => {
    assert.equal(providerConnectionSchema.safeParse({ protocol: 'ollama', baseUrl: 'http://localhost', apiKey: '', headers: {} }).success, false)
    assert.equal(providerConnectionSchema.safeParse({ protocol: 'openai-compatible', baseUrl: 'https://user:pass@example.com/v1', apiKey: '', headers: {} }).success, false)
    assert.equal(providerConnectionSchema.safeParse({ protocol: 'openai-compatible', baseUrl: 'https://example.com/v1', apiKey: '', headers: { Host: 'evil.test' } }).success, false)
  })

  test('redacts API keys and custom header values from provider errors', () => {
    const provider = openAiProvider('https://example.com/v1')
    const redacted = redactSecrets('test-secret and tenant-secret must not leak', provider)
    assert.equal(redacted.includes('test-secret'), false)
    assert.equal(redacted.includes('tenant-secret'), false)
    assert.match(redacted, /\[REDACTED\]/)
  })

  test('normalizes common upstream statuses', () => {
    assert.equal(normalizeProviderError({ status: 401 }, openAiProvider('https://example.com')).code, 'authentication_failed')
    assert.equal(normalizeProviderError({ status: 404 }, openAiProvider('https://example.com')).code, 'not_found')
    assert.equal(normalizeProviderError({ status: 429 }, openAiProvider('https://example.com')).code, 'rate_limited')
  })

  test('defaults and validates generation length settings', () => {
    const baseRequest = {
      sourceType: 'md',
      content: '# Test',
      model: 'test-model',
      provider: openAiProvider('https://example.com/v1'),
    }
    assert.deepEqual(conversionRequestSchema.parse(baseRequest).generation, DEFAULT_GENERATION_SETTINGS)
    assert.equal(conversionRequestSchema.safeParse({
      ...baseRequest,
      generation: {
        contextWindowTokens: 4_096,
        maxOutputTokens: 4_096,
        continuationRounds: 0,
      },
    }).success, false)
  })
})

describe('model discovery', () => {
  test('uses compatible authentication and returns sorted, de-duplicated model ids', async () => {
    let request
    const models = await discoverModels(openAiProvider('https://example.com/v1/'), {
      fetchImpl: async (url, options) => {
        request = { url: String(url), options }
        return new Response(JSON.stringify({ data: [{ id: 'z-model' }, { id: 'a-model' }, { id: 'a-model' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      },
    })
    assert.deepEqual(models, ['a-model', 'z-model'])
    assert.equal(request.url, 'https://example.com/v1/models')
    assert.equal(request.options.headers.Authorization, 'Bearer test-secret')
    assert.equal(request.options.headers['X-Tenant'], 'tenant-secret')
  })

  test('supports Anthropic model list authentication', async () => {
    let headers
    await discoverModels({
      protocol: 'anthropic-compatible',
      baseUrl: 'https://api.anthropic.test/v1',
      apiKey: 'anthropic-key',
      headers: {},
    }, {
      fetchImpl: async (_url, options) => {
        headers = options.headers
        return new Response(JSON.stringify({ data: [{ id: 'claude-test' }] }), { status: 200 })
      },
    })
    assert.equal(headers['x-api-key'], 'anthropic-key')
    assert.equal(headers['anthropic-version'], '2023-06-01')
  })

  test('returns a manual-entry hint when model discovery is unavailable', async () => {
    await assert.rejects(
      discoverModels(openAiProvider('https://example.com/v1'), { fetchImpl: async () => new Response('not found', { status: 404 }) }),
      (error) => error.code === 'model_discovery_unsupported' && /手动添加模型/.test(error.message),
    )
  })
})

describe('compatible provider calls and Express SSE', () => {
  let upstream
  let upstreamPort
  let appServer
  let appPort
  const requests = []

  before(async () => {
    upstream = http.createServer(async (req, res) => {
      let body = ''
      for await (const chunk of req) body += chunk
      const payload = JSON.parse(body || '{}')
      requests.push({ url: req.url, headers: req.headers, body: payload })

      if (req.url === '/v1/chat/completions') {
        const isContinuation = payload.model === 'length-model' &&
          payload.messages?.some((message) => message.role === 'assistant')
        const content = payload.model === 'length-model'
          ? isContinuation ? '<p>continued</p></section>' : '<section><h2>Long</h2>'
          : '<section><h2>Title</h2></section>'
        const finishReason = payload.model === 'length-model' && !isContinuation ? 'length' : 'stop'
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: payload.model, choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: payload.model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model: payload.model, choices: [], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } })}\n\n`)
        res.end('data: [DONE]\n\n')
        return
      }

      if (req.url === '/anthropic/messages') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({
          id: 'msg_test',
          type: 'message',
          role: 'assistant',
          model: 'claude-test',
          content: [{ type: 'text', text: 'OK' }],
          stop_reason: 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 2, output_tokens: 1 },
        }))
        return
      }

      res.writeHead(404).end()
    })
    upstreamPort = await listen(upstream)
    appServer = createApp({ isDevelopment: true }).listen(0, '127.0.0.1')
    appPort = await new Promise((resolve) => appServer.once('listening', () => resolve(appServer.address().port)))
  })

  after(async () => {
    await close(appServer)
    await close(upstream)
  })

  test('calls an Anthropic-compatible Messages endpoint with x-api-key', async () => {
    const result = await verifyProvider({
      protocol: 'anthropic-compatible',
      baseUrl: `http://127.0.0.1:${upstreamPort}/anthropic`,
      apiKey: 'claude-secret',
      headers: {},
    }, 'claude-test')
    assert.deepEqual(result, { ok: true })
    const request = requests.find((item) => item.url === '/anthropic/messages')
    assert.equal(request.headers['x-api-key'], 'claude-secret')
    assert.equal(request.body.model, 'claude-test')
  })

  test('streams conversion chunks, validation, and done through Express', async () => {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'md',
        content: '# Test',
        model: 'fake-model',
        provider: openAiProvider(`http://127.0.0.1:${upstreamPort}/v1`, ''),
      }),
    })
    assert.equal(response.status, 200)
    const text = await response.text()
    const chunkPosition = text.indexOf('"type":"chunk"')
    const validationPosition = text.indexOf('"type":"validation"')
    const donePosition = text.indexOf('"type":"done"')
    assert.ok(chunkPosition >= 0)
    assert.ok(validationPosition > chunkPosition)
    assert.ok(donePosition > validationPosition)
    assert.match(text, /<section>/)
    const request = requests.find((item) => item.url === '/v1/chat/completions')
    assert.equal(request.headers.authorization, undefined)
    assert.equal(request.body.model, 'fake-model')
    assert.equal(request.body.messages[0].role, 'system')
    assert.equal(request.body.max_tokens, 8192)
    assert.match(text, /"type":"finish"/)
    assert.match(text, /"truncated":false/)
  })

  test('automatically continues a response that stops at the output length limit', async () => {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceType: 'md',
        content: '# Long test',
        model: 'length-model',
        provider: openAiProvider(`http://127.0.0.1:${upstreamPort}/v1`, ''),
        generation: {
          contextWindowTokens: 32_000,
          maxOutputTokens: 512,
          continuationRounds: 1,
        },
      }),
    })

    assert.equal(response.status, 200)
    const text = await response.text()
    assert.match(text, /自动续写/)
    assert.match(text, /<section>/)
    assert.match(text, /continued/)
    assert.match(text, /"continuationsUsed":1/)
    assert.match(text, /"truncated":false/)

    const lengthRequests = requests.filter((item) => item.body.model === 'length-model')
    assert.equal(lengthRequests.length, 2)
    assert.equal(lengthRequests[0].body.max_tokens, 512)
    assert.ok(lengthRequests[1].body.messages.some((message) => message.role === 'assistant'))
  })
})
