import type { ProviderConnection } from './types'

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`)
  return data as T
}

export async function discoverProviderModels(provider: ProviderConnection) {
  const data = await postJson<{ models: string[] }>('/api/models/discover', { provider })
  return data.models
}

export async function testProviderConnection(provider: ProviderConnection, model: string) {
  return postJson<{ ok: true }>('/api/providers/test', { provider, model })
}
