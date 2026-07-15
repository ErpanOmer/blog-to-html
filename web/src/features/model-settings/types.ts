export type ApiProtocol = 'openai-compatible' | 'anthropic-compatible'

export type ProviderConnection = {
  protocol: ApiProtocol
  baseUrl: string
  apiKey: string
  headers: Record<string, string>
}

export type ModelProfile = {
  id: string
  name: string
  provider: ProviderConnection
  models: string[]
  selectedModel: string
}

export type StoredModelSettingsV1 = {
  version: 1
  activeProfileId: string | null
  profiles: ModelProfile[]
}

export type ProfilePreset = {
  id: string
  name: string
  description: string
  protocol: ApiProtocol
  baseUrl: string
  models: string[]
}

export const PROFILE_PRESETS: ProfilePreset[] = [
  {
    id: 'deepseek-openai',
    name: 'DeepSeek（OpenAI）',
    description: 'DeepSeek 官方 OpenAI 兼容接口',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'deepseek-anthropic',
    name: 'DeepSeek（Anthropic）',
    description: 'DeepSeek 官方 Anthropic 兼容接口',
    protocol: 'anthropic-compatible',
    baseUrl: 'https://api.deepseek.com/anthropic',
    models: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT 与 OpenAI 官方接口',
    protocol: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    models: [],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 官方 Messages API',
    protocol: 'anthropic-compatible',
    baseUrl: 'https://api.anthropic.com/v1',
    models: [],
  },
  {
    id: 'ollama',
    name: 'Ollama',
    description: '本地 Ollama OpenAI 兼容接口',
    protocol: 'openai-compatible',
    baseUrl: 'http://localhost:11434/v1',
    models: [],
  },
  {
    id: 'custom',
    name: '自定义服务',
    description: '任意 OpenAI 或 Anthropic 兼容服务',
    protocol: 'openai-compatible',
    baseUrl: '',
    models: [],
  },
]

export function createProfileId() {
  return globalThis.crypto?.randomUUID?.() || `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createProfileFromPreset(preset: ProfilePreset): ModelProfile {
  return {
    id: createProfileId(),
    name: preset.name,
    provider: {
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      apiKey: '',
      headers: {},
    },
    models: [...preset.models],
    selectedModel: preset.models[0] || '',
  }
}
