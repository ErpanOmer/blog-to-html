import { describe, expect, it } from 'vitest'

import { loadModelSettings, MODEL_SETTINGS_STORAGE_KEY, saveModelSettings } from './storage'
import type { StoredModelSettingsV1 } from './types'

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

const validSettings: StoredModelSettingsV1 = {
  version: 1,
  activeProfileId: 'deepseek',
  profiles: [{
    id: 'deepseek',
    name: 'DeepSeek',
    provider: {
      protocol: 'openai-compatible',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'secret',
      headers: {},
    },
    models: ['deepseek-v4-pro'],
    selectedModel: 'deepseek-v4-pro',
  }],
}

describe('model settings storage', () => {
  it('round-trips a versioned profile including the selected model', () => {
    const storage = memoryStorage()
    saveModelSettings(validSettings, storage)
    expect(loadModelSettings(storage)).toEqual(validSettings)
  })

  it('falls back safely when storage is malformed or has an unknown version', () => {
    const malformed = memoryStorage({ [MODEL_SETTINGS_STORAGE_KEY]: '{broken' })
    expect(loadModelSettings(malformed)).toEqual({ version: 1, activeProfileId: null, profiles: [] })

    const future = memoryStorage({ [MODEL_SETTINGS_STORAGE_KEY]: JSON.stringify({ ...validSettings, version: 2 }) })
    expect(loadModelSettings(future)).toEqual({ version: 1, activeProfileId: null, profiles: [] })
  })

  it('selects the first valid profile when the saved active id no longer exists', () => {
    const storage = memoryStorage({
      [MODEL_SETTINGS_STORAGE_KEY]: JSON.stringify({ ...validSettings, activeProfileId: 'missing' }),
    })
    expect(loadModelSettings(storage).activeProfileId).toBe('deepseek')
  })
})
