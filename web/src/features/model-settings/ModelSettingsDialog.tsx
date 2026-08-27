import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Copy,
  DatabaseZap,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Plus,
  Save,
  ServerCog,
  Trash2,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { discoverProviderModels, testProviderConnection } from './api'
import {
  DEFAULT_GENERATION_SETTINGS,
  PROFILE_PRESETS,
  createProfileId,
  createProfileFromPreset,
  type ModelProfile,
  type ProfilePreset,
} from './types'

type ModelSettingsDialogProps = {
  open: boolean
  profiles: ModelProfile[]
  activeProfileId: string | null
  onOpenChange: (open: boolean) => void
  onUpsert: (profile: ModelProfile, makeActive?: boolean) => void
  onDelete: (id: string) => void
  onSetActive: (id: string) => void
  onClearAll: () => void
}

function normalizeProfile(profile: ModelProfile): ModelProfile {
  const models = [...new Set(profile.models.map((model) => model.trim()).filter(Boolean))]
  return {
    ...profile,
    name: profile.name.trim(),
    provider: { ...profile.provider, baseUrl: profile.provider.baseUrl.trim() },
    models,
    selectedModel: models.includes(profile.selectedModel) ? profile.selectedModel : models[0] || '',
    generation: { ...DEFAULT_GENERATION_SETTINGS, ...profile.generation },
  }
}

export function ModelSettingsDialog({
  open,
  profiles,
  activeProfileId,
  onOpenChange,
  onUpsert,
  onDelete,
  onSetActive,
  onClearAll,
}: ModelSettingsDialogProps) {
  const [draft, setDraft] = useState<ModelProfile | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [modelInput, setModelInput] = useState('')
  const [busy, setBusy] = useState<'discover' | 'test' | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    if (!open) return
    const selected = profiles.find((profile) => profile.id === activeProfileId) || profiles[0] || null
    setDraft(selected ? structuredClone(selected) : null)
    setShowTemplates(profiles.length === 0)
    setMessage(null)
  }, [open, profiles, activeProfileId])

  const isSavedProfile = useMemo(() => Boolean(draft && profiles.some((profile) => profile.id === draft.id)), [draft, profiles])

  const selectProfile = (profile: ModelProfile) => {
    setDraft(structuredClone(profile))
    setShowTemplates(false)
    setMessage(null)
  }

  const startFromPreset = (preset: ProfilePreset) => {
    setDraft(createProfileFromPreset(preset))
    setShowTemplates(false)
    setMessage(null)
  }

  const updateDraft = (update: Partial<ModelProfile>) => {
    setDraft((current) => current ? { ...current, ...update } : current)
    setMessage(null)
  }

  const updateProvider = (update: Partial<ModelProfile['provider']>) => {
    setDraft((current) => current ? { ...current, provider: { ...current.provider, ...update } } : current)
    setMessage(null)
  }

  const updateGeneration = (update: Partial<ModelProfile['generation']>) => {
    setDraft((current) => current ? {
      ...current,
      generation: { ...current.generation, ...update },
    } : current)
    setMessage(null)
  }

  const addModel = () => {
    if (!draft || !modelInput.trim()) return
    const model = modelInput.trim()
    const models = draft.models.includes(model) ? draft.models : [...draft.models, model]
    updateDraft({ models, selectedModel: draft.selectedModel || model })
    setModelInput('')
  }

  const removeModel = (model: string) => {
    if (!draft) return
    const models = draft.models.filter((item) => item !== model)
    updateDraft({ models, selectedModel: draft.selectedModel === model ? models[0] || '' : draft.selectedModel })
  }

  const updateHeader = (index: number, side: 'name' | 'value', value: string) => {
    if (!draft) return
    const entries = Object.entries(draft.provider.headers)
    if (!entries[index]) return
    entries[index] = side === 'name' ? [value, entries[index][1]] : [entries[index][0], value]
    updateProvider({ headers: Object.fromEntries(entries) })
  }

  const addHeader = () => {
    if (!draft) return
    let name = 'X-Custom-Header'
    let suffix = 2
    while (Object.hasOwn(draft.provider.headers, name)) name = `X-Custom-Header-${suffix++}`
    updateProvider({ headers: { ...draft.provider.headers, [name]: '' } })
  }

  const removeHeader = (index: number) => {
    if (!draft) return
    const entries = Object.entries(draft.provider.headers).filter((_, itemIndex) => itemIndex !== index)
    updateProvider({ headers: Object.fromEntries(entries) })
  }

  const validateDraft = () => {
    if (!draft?.name.trim()) return '请输入配置名称'
    if (!draft.provider.baseUrl.trim()) return '请输入 Base URL'
    try {
      const url = new URL(draft.provider.baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) return 'Base URL 仅支持 http 或 https'
      if (url.username || url.password) return 'Base URL 不能包含用户名或密码'
    } catch {
      return 'Base URL 格式无效'
    }
    if (draft.models.length === 0) return '请获取或手动添加至少一个模型'
    if (!draft.selectedModel) return '请选择默认模型'
    if (!Number.isInteger(draft.generation.contextWindowTokens) ||
      draft.generation.contextWindowTokens < 4_096 ||
      draft.generation.contextWindowTokens > 2_000_000) {
      return '上下文窗口必须是 4,096–2,000,000 之间的整数'
    }
    if (!Number.isInteger(draft.generation.maxOutputTokens) ||
      draft.generation.maxOutputTokens < 256 ||
      draft.generation.maxOutputTokens > 262_144) {
      return '单次最大输出必须是 256–262,144 之间的整数'
    }
    if (draft.generation.maxOutputTokens >= draft.generation.contextWindowTokens) {
      return '单次最大输出必须小于上下文窗口'
    }
    if (!Number.isInteger(draft.generation.continuationRounds) ||
      draft.generation.continuationRounds < 0 ||
      draft.generation.continuationRounds > 5) {
      return '自动续写次数必须是 0–5 之间的整数'
    }
    return null
  }

  const saveDraft = () => {
    if (!draft) return
    const error = validateDraft()
    if (error) return setMessage({ type: 'error', text: error })
    const normalized = normalizeProfile(draft)
    onUpsert(normalized, true)
    setDraft(structuredClone(normalized))
    setMessage({ type: 'success', text: '配置已保存并设为当前配置' })
  }

  const discoverModels = async () => {
    if (!draft?.provider.baseUrl.trim()) return setMessage({ type: 'error', text: '请先填写 Base URL' })
    setBusy('discover')
    setMessage(null)
    try {
      const discovered = await discoverProviderModels(draft.provider)
      const models = [...new Set([...draft.models, ...discovered])]
      updateDraft({ models, selectedModel: draft.selectedModel || models[0] || '' })
      setMessage({ type: 'success', text: `已获取 ${discovered.length} 个模型，保存后生效` })
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : '模型获取失败，请手动添加模型 ID' })
    } finally {
      setBusy(null)
    }
  }

  const testConnection = async () => {
    if (!draft) return
    const error = validateDraft()
    if (error) return setMessage({ type: 'error', text: error })
    setBusy('test')
    setMessage(null)
    try {
      await testProviderConnection(draft.provider, draft.selectedModel)
      setMessage({ type: 'success', text: '连接测试成功' })
    } catch (testError) {
      setMessage({ type: 'error', text: testError instanceof Error ? testError.message : '连接测试失败' })
    } finally {
      setBusy(null)
    }
  }

  const duplicateDraft = () => {
    if (!draft) return
    const copy: ModelProfile = { ...structuredClone(draft), id: createProfileId(), name: `${draft.name} 副本` }
    onUpsert(copy, true)
    setDraft(copy)
    setMessage({ type: 'success', text: '配置已复制' })
  }

  const deleteDraft = () => {
    if (!draft || !isSavedProfile || !window.confirm(`确定删除“${draft.name}”吗？`)) return
    onDelete(draft.id)
    const remaining = profiles.filter((profile) => profile.id !== draft.id)
    setDraft(remaining[0] ? structuredClone(remaining[0]) : null)
    setShowTemplates(remaining.length === 0)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="border-b border-gray-200 px-6 py-5 pr-14 dark:border-white/10">
          <DialogTitle>模型 API 设置</DialogTitle>
          <DialogDescription className="mt-1">保存多个兼容服务，在转换前随时切换配置与模型。</DialogDescription>
        </div>

        <div className="grid min-h-0 flex-1 md:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="flex max-h-52 flex-col border-b border-gray-200 bg-gray-50/80 p-4 dark:border-white/10 dark:bg-black/15 md:max-h-none md:border-b-0 md:border-r">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">配置档案</span>
              <Button type="button" size="icon-xs" variant="ghost" onClick={() => setShowTemplates(true)} title="新建配置">
                <Plus />
              </Button>
            </div>
            <div className="custom-scrollbar flex-1 space-y-2 overflow-auto">
              {profiles.map((profile) => (
                <button
                  type="button"
                  key={profile.id}
                  onClick={() => selectProfile(profile)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                    draft?.id === profile.id
                      ? 'border-blue-300 bg-blue-50 text-blue-900 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-100'
                      : 'border-transparent hover:bg-white dark:hover:bg-white/5',
                  )}
                >
                  <ServerCog className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{profile.name}</span>
                  {profile.id === activeProfileId && <Check className="h-4 w-4 shrink-0 text-emerald-500" />}
                </button>
              ))}
              {profiles.length === 0 && <p className="px-2 py-4 text-sm text-gray-500">尚未保存配置</p>}
            </div>
            {profiles.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-3 text-red-600 hover:text-red-700"
                onClick={() => {
                  if (window.confirm('确定清空全部模型配置和 API Key 吗？')) {
                    onClearAll()
                    setDraft(null)
                    setShowTemplates(true)
                  }
                }}
              >
                <Trash2 /> 清空全部
              </Button>
            )}
          </aside>

          <main className="custom-scrollbar min-h-0 overflow-auto p-5 md:p-6">
            {showTemplates || !draft ? (
              <div>
                <h3 className="mb-1 text-base font-semibold text-gray-900 dark:text-white">选择配置模板</h3>
                <p className="mb-5 text-sm text-gray-500">所有字段创建后都可以修改。</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {PROFILE_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset.id}
                      onClick={() => startFromPreset(preset)}
                      className="rounded-xl border border-gray-200 bg-white p-4 text-left transition hover:border-blue-400 hover:shadow-md dark:border-white/10 dark:bg-white/5"
                    >
                      <div className="mb-2 flex items-center gap-2">
                        <DatabaseZap className="h-4 w-4 text-blue-500" />
                        <span className="font-semibold text-gray-900 dark:text-white">{preset.name}</span>
                      </div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">{preset.description}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); saveDraft() }}>
                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-gray-900 dark:text-white">连接信息</h3>
                      <p className="text-xs text-gray-500">Base URL 是完整 API 前缀，不会自动追加 /v1。</p>
                    </div>
                    <div className="flex gap-2">
                      {isSavedProfile && draft.id !== activeProfileId && (
                        <Button type="button" size="sm" variant="secondary" onClick={() => onSetActive(draft.id)}>设为当前</Button>
                      )}
                      {isSavedProfile && <Button type="button" size="icon-sm" variant="ghost" onClick={duplicateDraft} title="复制"><Copy /></Button>}
                      {isSavedProfile && <Button type="button" size="icon-sm" variant="ghost" onClick={deleteDraft} className="text-red-600" title="删除"><Trash2 /></Button>}
                    </div>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">配置名称</span>
                    <Input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="例如：DeepSeek 主账号" />
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">API 格式</span>
                      <select
                        value={draft.provider.protocol}
                        onChange={(event) => updateProvider({ protocol: event.target.value as ModelProfile['provider']['protocol'] })}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-slate-800"
                      >
                        <option value="openai-compatible">OpenAI Compatible</option>
                        <option value="anthropic-compatible">Anthropic Compatible</option>
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">Base URL</span>
                      <Input value={draft.provider.baseUrl} onChange={(event) => updateProvider({ baseUrl: event.target.value })} placeholder="https://api.example.com/v1" />
                    </label>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="text-sm font-medium">API Key</span>
                    <div className="relative">
                      <KeyRound className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <Input
                        type={showApiKey ? 'text' : 'password'}
                        value={draft.provider.apiKey}
                        onChange={(event) => updateProvider({ apiKey: event.target.value })}
                        className="px-9"
                        placeholder="本地无认证服务可留空"
                        autoComplete="off"
                      />
                      <button type="button" onClick={() => setShowApiKey((value) => !value)} className="absolute right-2 top-1/2 rounded p-1 text-gray-400 hover:text-gray-700 dark:hover:text-white" aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}>
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-amber-600 dark:text-amber-400">密钥以明文保存在当前浏览器本地，请勿在公共电脑使用。</p>
                  </label>
                </section>

                <section className="space-y-3 border-t border-gray-200 pt-5 dark:border-white/10">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold">模型</h3>
                      <p className="text-xs text-gray-500">服务不支持模型发现时，可直接输入模型 ID。</p>
                    </div>
                    <Button type="button" size="sm" variant="secondary" onClick={discoverModels} disabled={busy !== null}>
                      {busy === 'discover' ? <Loader2 className="animate-spin" /> : <DatabaseZap />} 获取模型
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={modelInput}
                      onChange={(event) => setModelInput(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addModel() } }}
                      placeholder="输入模型 ID 后回车"
                    />
                    <Button type="button" variant="outline" onClick={addModel}><Plus /> 添加</Button>
                  </div>
                  <div className="flex min-h-10 flex-wrap gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-black/10">
                    {draft.models.length === 0 && <span className="text-sm text-gray-400">暂无模型</span>}
                    {draft.models.map((model) => (
                      <button
                        type="button"
                        key={model}
                        onClick={() => updateDraft({ selectedModel: model })}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-xs transition-colors',
                          draft.selectedModel === model
                            ? 'border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-200'
                            : 'border-gray-200 bg-white text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300',
                        )}
                      >
                        {model}
                        <X className="h-3 w-3" onClick={(event) => { event.stopPropagation(); removeModel(model) }} />
                      </button>
                    ))}
                  </div>
                </section>

                <section className="space-y-4 border-t border-gray-200 pt-5 dark:border-white/10">
                  <div>
                    <h3 className="text-base font-semibold">生成长度</h3>
                    <p className="text-xs text-gray-500">按当前模型的官方限制填写；设置只控制请求预算，不能放大模型自身的硬上限。</p>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">上下文窗口</span>
                      <Input
                        type="number"
                        min={4096}
                        max={2000000}
                        step={1024}
                        value={draft.generation.contextWindowTokens}
                        onChange={(event) => updateGeneration({ contextWindowTokens: Number(event.target.value) })}
                      />
                      <span className="block text-xs text-gray-500">输入与输出合计 token</span>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">单次最大输出</span>
                      <Input
                        type="number"
                        min={256}
                        max={262144}
                        step={256}
                        value={draft.generation.maxOutputTokens}
                        onChange={(event) => updateGeneration({ maxOutputTokens: Number(event.target.value) })}
                      />
                      <span className="block text-xs text-gray-500">传给模型的 max tokens</span>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-sm font-medium">自动续写次数</span>
                      <Input
                        type="number"
                        min={0}
                        max={5}
                        step={1}
                        value={draft.generation.continuationRounds}
                        onChange={(event) => updateGeneration({ continuationRounds: Number(event.target.value) })}
                      />
                      <span className="block text-xs text-gray-500">因 length 停止时继续</span>
                    </label>
                  </div>
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs leading-relaxed text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                    默认输出 8,192 token，最多自动续写 2 次。提高数值可能增加费用；如果服务端不支持所填上限，请按该模型文档调低。
                  </div>
                </section>

                <section className="space-y-3 border-t border-gray-200 pt-5 dark:border-white/10">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold">自定义请求头</h3>
                      <p className="text-xs text-gray-500">可选。用于代理、租户或非标准认证。</p>
                    </div>
                    <Button type="button" variant="ghost" size="sm" onClick={addHeader}><Plus /> 添加</Button>
                  </div>
                  {Object.entries(draft.provider.headers).map(([name, value], index) => (
                    <div key={`${index}-${name}`} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px] gap-2">
                      <Input value={name} onChange={(event) => updateHeader(index, 'name', event.target.value)} placeholder="Header 名称" />
                      <Input type="password" value={value} onChange={(event) => updateHeader(index, 'value', event.target.value)} placeholder="Header 值" autoComplete="off" />
                      <Button type="button" variant="ghost" size="icon-sm" onClick={() => removeHeader(index)}><X /></Button>
                    </div>
                  ))}
                </section>

                {message && (
                  <div className={cn(
                    'rounded-xl border px-4 py-3 text-sm',
                    message.type === 'success'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
                      : 'border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300',
                  )}>{message.text}</div>
                )}

                <div className="flex flex-col-reverse justify-end gap-2 border-t border-gray-200 pt-5 dark:border-white/10 sm:flex-row">
                  <Button type="button" variant="outline" onClick={testConnection} disabled={busy !== null}>
                    {busy === 'test' ? <Loader2 className="animate-spin" /> : <ServerCog />} 测试连接
                  </Button>
                  <Button type="submit"><Save /> 保存并设为当前</Button>
                </div>
                <p className="text-right text-xs text-gray-400">连接测试会调用当前模型，可能产生极少量费用。</p>
              </form>
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  )
}
