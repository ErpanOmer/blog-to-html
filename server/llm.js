import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { generateText, streamText } from 'ai'
import { z } from 'zod'

const BLOCKED_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])

const headerNamePattern = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/

const headersSchema = z.record(z.string(), z.string()).default({}).superRefine((headers, ctx) => {
  for (const [name, value] of Object.entries(headers)) {
    if (!headerNamePattern.test(name)) {
      ctx.addIssue({ code: 'custom', message: `无效的请求头名称：${name}` })
    }
    if (BLOCKED_HEADERS.has(name.toLowerCase())) {
      ctx.addIssue({ code: 'custom', message: `不允许设置传输层请求头：${name}` })
    }
    if (/\r|\n/.test(value)) {
      ctx.addIssue({ code: 'custom', message: `请求头 ${name} 包含非法换行符` })
    }
  }
})

export const providerConnectionSchema = z.object({
  protocol: z.enum(['openai-compatible', 'anthropic-compatible']),
  baseUrl: z.string().trim().min(1, 'Base URL 不能为空').superRefine((value, ctx) => {
    try {
      const url = new URL(value)
      if (!['http:', 'https:'].includes(url.protocol)) {
        ctx.addIssue({ code: 'custom', message: 'Base URL 仅支持 http 或 https' })
      }
      if (url.username || url.password) {
        ctx.addIssue({ code: 'custom', message: 'Base URL 不能包含用户名或密码' })
      }
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Base URL 格式无效' })
    }
  }),
  apiKey: z.string().default(''),
  headers: headersSchema,
})

export const discoveryRequestSchema = z.object({
  provider: providerConnectionSchema,
})

export const testRequestSchema = z.object({
  provider: providerConnectionSchema,
  model: z.string().trim().min(1, '模型 ID 不能为空'),
})

export const conversionRequestSchema = z.object({
  sourceType: z.enum(['googledocs', 'md']),
  url: z.string().optional(),
  content: z.string().optional(),
  model: z.string().trim().min(1, '模型 ID 不能为空'),
  provider: providerConnectionSchema,
})

export class PublicError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'PublicError'
    this.status = status
    this.code = code
  }
}

function normalizeBaseUrl(value) {
  const url = new URL(value.trim())
  url.pathname = url.pathname.replace(/\/+$/, '')
  return url.toString().replace(/\/$/, '')
}

function buildModelsUrl(baseUrl) {
  const url = new URL(normalizeBaseUrl(baseUrl))
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/models`
  return url
}

function authenticationHeaders(provider) {
  const headers = { Accept: 'application/json' }
  if (provider.protocol === 'openai-compatible' && provider.apiKey) {
    headers.Authorization = `Bearer ${provider.apiKey}`
  }
  if (provider.protocol === 'anthropic-compatible') {
    headers['anthropic-version'] = '2023-06-01'
    if (provider.apiKey) headers['x-api-key'] = provider.apiKey
  }
  return { ...headers, ...provider.headers }
}

export function createLanguageModel(rawProvider, modelId) {
  const provider = providerConnectionSchema.parse(rawProvider)
  const baseURL = normalizeBaseUrl(provider.baseUrl)

  if (provider.protocol === 'anthropic-compatible') {
    const anthropic = createAnthropic({
      baseURL,
      apiKey: provider.apiKey || 'not-required',
      headers: provider.headers,
    })
    return anthropic(modelId)
  }

  const openAICompatible = createOpenAICompatible({
    name: 'custom-openai-compatible',
    baseURL,
    apiKey: provider.apiKey || undefined,
    headers: provider.headers,
    includeUsage: true,
  })
  return openAICompatible(modelId)
}

export async function discoverModels(rawProvider, { signal, fetchImpl = fetch } = {}) {
  const provider = providerConnectionSchema.parse(rawProvider)
  const url = buildModelsUrl(provider.baseUrl)

  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: authenticationHeaders(provider),
      signal: signal || AbortSignal.timeout(15_000),
    })
  } catch (error) {
    throw normalizeProviderError(error, provider)
  }

  if (!response.ok) {
    const responseBody = await response.text().catch(() => '')
    if ([404, 405, 501].includes(response.status)) {
      throw new PublicError(502, 'model_discovery_unsupported', '该服务不支持模型发现，请手动添加模型 ID')
    }
    throw normalizeProviderError({ status: response.status, responseBody }, provider)
  }

  let payload
  try {
    payload = await response.json()
  } catch {
    throw new PublicError(502, 'invalid_response', '模型服务返回了无法解析的模型列表，请手动添加模型 ID')
  }

  const candidates = Array.isArray(payload?.data)
    ? payload.data.map((item) => item?.id)
    : Array.isArray(payload?.models)
      ? payload.models.map((item) => item?.id || item?.name || item?.model)
      : []

  const models = [...new Set(candidates.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))]
    .sort((a, b) => a.localeCompare(b))

  if (models.length === 0) {
    throw new PublicError(502, 'model_discovery_unsupported', '该服务未返回可用模型，请手动添加模型 ID')
  }

  return models
}

export async function testProvider(rawProvider, modelId, { signal } = {}) {
  const provider = providerConnectionSchema.parse(rawProvider)
  try {
    await generateText({
      model: createLanguageModel(provider, modelId),
      prompt: 'Reply with OK.',
      maxOutputTokens: 8,
      abortSignal: signal,
    })
    return { ok: true }
  } catch (error) {
    throw normalizeProviderError(error, provider)
  }
}

export function streamConversion(rawProvider, modelId, systemPrompt, inputContent, { signal } = {}) {
  const provider = providerConnectionSchema.parse(rawProvider)
  try {
    return streamText({
      model: createLanguageModel(provider, modelId),
      system: systemPrompt,
      prompt: inputContent,
      abortSignal: signal,
    })
  } catch (error) {
    throw normalizeProviderError(error, provider)
  }
}

function getStatus(error) {
  const candidates = [
    error?.status,
    error?.statusCode,
    error?.response?.status,
    error?.cause?.status,
    error?.cause?.statusCode,
  ]
  return candidates.find((value) => Number.isInteger(value))
}

function rawErrorText(error) {
  const parts = [
    error?.message,
    error?.responseBody,
    error?.data?.error?.message,
    error?.data?.message,
    error?.cause?.message,
  ]
  return parts.filter((part) => typeof part === 'string' && part.trim()).join(' · ')
}

export function redactSecrets(text, rawProvider) {
  let safeText = String(text || '')
  const provider = rawProvider ? providerConnectionSchema.safeParse(rawProvider) : null
  if (!provider?.success) return safeText.slice(0, 800)

  const secrets = [provider.data.apiKey, ...Object.values(provider.data.headers)]
    .filter((value) => typeof value === 'string' && value.length >= 3)
    .sort((a, b) => b.length - a.length)

  for (const secret of secrets) safeText = safeText.split(secret).join('[REDACTED]')
  return safeText.slice(0, 800)
}

export function normalizeProviderError(error, provider) {
  if (error instanceof PublicError) return error
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return new PublicError(504, 'timeout', error?.name === 'AbortError' ? '模型请求已取消或超时' : '模型请求超时')
  }

  const status = getStatus(error)
  if (status === 401 || status === 403) {
    return new PublicError(status, 'authentication_failed', '模型服务认证失败，请检查 API Key 和自定义请求头')
  }
  if (status === 404) {
    return new PublicError(502, 'not_found', '模型服务未找到对应接口或模型，请检查 Base URL 和模型 ID')
  }
  if (status === 429) {
    return new PublicError(429, 'rate_limited', '模型服务请求过于频繁或额度不足，请稍后重试')
  }

  const detail = redactSecrets(rawErrorText(error), provider)
  if (status && status >= 500) {
    return new PublicError(502, 'upstream_error', `模型服务暂时不可用${detail ? `：${detail}` : ''}`)
  }
  return new PublicError(502, 'provider_error', detail || '无法连接模型服务，请检查 Base URL、网络和模型配置')
}

export function formatValidationError(error) {
  if (!(error instanceof z.ZodError)) return null
  return error.issues.map((issue) => issue.message).join('；')
}
