import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { MODEL_SETTINGS_STORAGE_KEY } from './features/model-settings/storage'
import { DEFAULT_GENERATION_SETTINGS, type StoredModelSettingsV1 } from './features/model-settings/types'

const configuredSettings: StoredModelSettingsV1 = {
  version: 1,
  activeProfileId: 'profile-1',
  profiles: [{
    id: 'profile-1',
    name: 'My DeepSeek',
    provider: {
      protocol: 'openai-compatible',
      baseUrl: 'https://api.deepseek.example/v1',
      apiKey: 'browser-secret',
      headers: { 'X-Tenant': 'local' },
    },
    models: ['deepseek-test'],
    selectedModel: 'deepseek-test',
    generation: { ...DEFAULT_GENERATION_SETTINGS },
  }],
}

describe('App model settings', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn())
  })

  it('opens model setup automatically on first use', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: '模型 API 设置' })).toBeInTheDocument()
    expect(screen.getByText('选择配置模板')).toBeInTheDocument()
  })

  it('creates a DeepSeek preset and persists its models locally', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /DeepSeek（OpenAI）/ }))
    await user.click(screen.getByRole('button', { name: /保存并设为当前/ }))

    const stored = JSON.parse(localStorage.getItem(MODEL_SETTINGS_STORAGE_KEY) || '{}') as StoredModelSettingsV1
    expect(stored.profiles).toHaveLength(1)
    expect(stored.profiles[0]?.provider.baseUrl).toBe('https://api.deepseek.com')
    expect(stored.profiles[0]?.models).toEqual(['deepseek-v4-flash', 'deepseek-v4-pro'])
    expect(stored.activeProfileId).toBe(stored.profiles[0]?.id)
  })

  it('sends the active provider snapshot and selected model when converting', async () => {
    localStorage.setItem(MODEL_SETTINGS_STORAGE_KEY, JSON.stringify(configuredSettings))
    let capturedInit: RequestInit | undefined
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) !== '/api/convert') throw new Error(`Unexpected URL: ${String(url)}`)
      capturedInit = init
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"type":"chunk","content":"<section><h2>OK</h2></section>"}\n\ndata: {"type":"validation","valid":true,"errors":[]}\n\ndata: {"type":"done"}\n\n'))
          controller.close()
        },
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<App />)
    fireEvent.change(screen.getByLabelText('Google Docs 链接'), { target: { value: 'https://docs.google.com/document/d/test/edit' } })
    await userEvent.click(screen.getByRole('button', { name: /立即转换/ }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const body = JSON.parse(String(capturedInit?.body))
    expect(body.model).toBe('deepseek-test')
    expect(body.provider).toEqual(configuredSettings.profiles[0]?.provider)
    expect(body.generation).toEqual(DEFAULT_GENERATION_SETTINGS)
    await waitFor(() => expect(screen.getByText(/生成完成/)).toBeInTheDocument())
  })

  it('shows an explicit error instead of success when the model reports truncation', async () => {
    localStorage.setItem(MODEL_SETTINGS_STORAGE_KEY, JSON.stringify(configuredSettings))
    vi.stubGlobal('fetch', vi.fn(async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode([
            'data: {"type":"chunk","content":"<section><h2>Incomplete"}',
            'data: {"type":"finish","finishReason":"length","truncated":true,"continuationsUsed":2,"message":"模型输出达到长度上限，结果不完整"}',
            'data: {"type":"validation","valid":false,"errors":["标签未闭合"]}',
            'data: {"type":"done"}',
            '',
          ].join('\n\n')))
          controller.close()
        },
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }))

    render(<App />)
    fireEvent.change(screen.getByLabelText('Google Docs 链接'), {
      target: { value: 'https://docs.google.com/document/d/test/edit' },
    })
    await userEvent.click(screen.getByRole('button', { name: /立即转换/ }))

    await waitFor(() => expect(screen.getByText('模型输出达到长度上限，结果不完整')).toBeInTheDocument())
    expect(screen.queryByText(/生成完成/)).not.toBeInTheDocument()
  })
})
