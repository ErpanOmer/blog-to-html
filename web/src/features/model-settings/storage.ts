import { useMemo, useState } from 'react'

import type { ModelProfile, StoredModelSettingsV1 } from './types'

export const MODEL_SETTINGS_STORAGE_KEY = 'blog-to-html.model-settings.v1'

const EMPTY_SETTINGS: StoredModelSettingsV1 = { version: 1, activeProfileId: null, profiles: [] }

function isStringRecord(value: unknown): value is Record<string, string> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((item) => typeof item === 'string')
}

function isProfile(value: unknown): value is ModelProfile {
  if (!value || typeof value !== 'object') return false
  const profile = value as Partial<ModelProfile>
  return typeof profile.id === 'string' && typeof profile.name === 'string' &&
    typeof profile.selectedModel === 'string' && Array.isArray(profile.models) &&
    profile.models.every((model) => typeof model === 'string') && Boolean(profile.provider) &&
    ['openai-compatible', 'anthropic-compatible'].includes(profile.provider?.protocol || '') &&
    typeof profile.provider?.baseUrl === 'string' && typeof profile.provider?.apiKey === 'string' &&
    isStringRecord(profile.provider?.headers)
}

export function loadModelSettings(storage: Pick<Storage, 'getItem'> = localStorage): StoredModelSettingsV1 {
  try {
    const raw = storage.getItem(MODEL_SETTINGS_STORAGE_KEY)
    if (!raw) return { ...EMPTY_SETTINGS, profiles: [] }
    const parsed = JSON.parse(raw) as Partial<StoredModelSettingsV1>
    if (parsed.version !== 1 || !Array.isArray(parsed.profiles) || !parsed.profiles.every(isProfile)) {
      return { ...EMPTY_SETTINGS, profiles: [] }
    }
    const activeProfileId = parsed.profiles.some((profile) => profile.id === parsed.activeProfileId)
      ? parsed.activeProfileId || null
      : parsed.profiles[0]?.id || null
    return { version: 1, activeProfileId, profiles: parsed.profiles }
  } catch {
    return { ...EMPTY_SETTINGS, profiles: [] }
  }
}

export function saveModelSettings(settings: StoredModelSettingsV1, storage: Pick<Storage, 'setItem'> = localStorage) {
  storage.setItem(MODEL_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

export function useModelSettings() {
  const [settings, setSettingsState] = useState<StoredModelSettingsV1>(() => loadModelSettings())

  const commit = (next: StoredModelSettingsV1) => {
    setSettingsState(next)
    saveModelSettings(next)
  }

  const activeProfile = useMemo(
    () => settings.profiles.find((profile) => profile.id === settings.activeProfileId) || null,
    [settings],
  )

  const upsertProfile = (profile: ModelProfile, makeActive = true) => {
    const exists = settings.profiles.some((item) => item.id === profile.id)
    const profiles = exists
      ? settings.profiles.map((item) => item.id === profile.id ? profile : item)
      : [...settings.profiles, profile]
    commit({ version: 1, profiles, activeProfileId: makeActive ? profile.id : settings.activeProfileId || profile.id })
  }

  const deleteProfile = (id: string) => {
    const profiles = settings.profiles.filter((profile) => profile.id !== id)
    const activeProfileId = settings.activeProfileId === id
      ? profiles[0]?.id || null
      : settings.activeProfileId
    commit({ version: 1, profiles, activeProfileId })
  }

  const setActiveProfileId = (id: string) => {
    if (settings.profiles.some((profile) => profile.id === id)) commit({ ...settings, activeProfileId: id })
  }

  const setSelectedModel = (model: string) => {
    if (!activeProfile) return
    upsertProfile({ ...activeProfile, selectedModel: model }, true)
  }

  const clearAll = () => commit({ version: 1, activeProfileId: null, profiles: [] })

  return {
    settings,
    activeProfile,
    upsertProfile,
    deleteProfile,
    setActiveProfileId,
    setSelectedModel,
    clearAll,
  }
}
