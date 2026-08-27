import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import DOMPurify from 'dompurify'
import {
  AlertCircle,
  ArrowRight,
  Check,
  Clock3,
  Code2,
  Copy,
  FileText,
  Globe,
  Square,
  Trash2,
  Upload,
} from 'lucide-react'
import * as prettier from 'prettier/standalone'
import * as htmlParser from 'prettier/plugins/html'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ModelSelector } from '@/features/model-settings/ModelSelector'
import { ModelSettingsDialog } from '@/features/model-settings/ModelSettingsDialog'
import { useModelSettings } from '@/features/model-settings/storage'
import { cn } from '@/lib/utils'
import './App.css'

type ValidationResult = {
  valid: boolean
  errors: string[]
}

type GenerationSummary = {
  finishReason: string
  rawFinishReason?: string
  truncated: boolean
  continuationsUsed: number
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
  }
}

function App() {
  const modelSettings = useModelSettings()
  const [settingsOpen, setSettingsOpen] = useState(() => modelSettings.settings.profiles.length === 0)
  const [sourceType, setSourceType] = useState<'googledocs' | 'md'>('googledocs')
  const [googleDocsUrl, setGoogleDocsUrl] = useState('')
  const [mdContent, setMdContent] = useState('')
  const [mdFileName, setMdFileName] = useState('')
  const [output, setOutput] = useState('')
  const [isConverting, setIsConverting] = useState(false)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [progressMessage, setProgressMessage] = useState('正在生成 HTML...')
  const [generationSummary, setGenerationSummary] = useState<GenerationSummary | null>(null)
  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('code')
  const [timer, setTimer] = useState(0)
  const [lastDuration, setLastDuration] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const convertStartRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (modelSettings.settings.profiles.length === 0) setSettingsOpen(true)
  }, [modelSettings.settings.profiles.length])

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined
    if (isConverting) {
      convertStartRef.current = performance.now()
      setTimer(0.1)
      setLastDuration(null)
      interval = setInterval(() => {
        if (convertStartRef.current !== null) setTimer((performance.now() - convertStartRef.current) / 1000)
      }, 100)
    } else if (convertStartRef.current !== null) {
      const elapsed = Math.max((performance.now() - convertStartRef.current) / 1000, 0.01)
      setTimer(elapsed)
      setLastDuration(elapsed)
      convertStartRef.current = null
    }
    return () => { if (interval) clearInterval(interval) }
  }, [isConverting])

  useEffect(() => {
    if (viewMode === 'code' && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [output, viewMode])

  const uploadFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.md')) {
      setError('仅支持 .md 格式文件')
      return
    }
    setMdFileName(file.name)
    setError('')
    const formData = new FormData()
    formData.append('file', file)
    try {
      const response = await fetch('/api/upload', { method: 'POST', body: formData })
      const data = await response.json() as { content?: string; error?: string }
      if (!response.ok || data.error) throw new Error(data.error || `上传失败 (${response.status})`)
      setMdContent(data.content || '')
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '文件上传失败')
    }
  }

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void uploadFile(file)
  }

  const beautifyCode = async (code: string) => {
    if (!code) return code
    try {
      return await prettier.format(code, { parser: 'html', plugins: [htmlParser], printWidth: 80, tabWidth: 2 })
    } catch {
      return code
    }
  }

  const handleConvert = useCallback(async () => {
    if (isConverting) {
      abortRef.current?.abort()
      return
    }

    const profile = modelSettings.activeProfile
    if (!profile?.selectedModel) {
      setSettingsOpen(true)
      return
    }

    setIsConverting(true)
    setOutput('')
    setValidation(null)
    setError('')
    setNotice('')
    setProgressMessage('正在生成 HTML...')
    setGenerationSummary(null)
    const controller = new AbortController()
    abortRef.current = controller

    try {
      const source = sourceType === 'googledocs'
        ? { sourceType, url: googleDocsUrl }
        : { sourceType, content: mdContent }
      const response = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...source,
          model: profile.selectedModel,
          provider: profile.provider,
          generation: profile.generation,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string }
        throw new Error(data.error || `请求失败 (${response.status})`)
      }
      if (!response.body) throw new Error('流式响应不可用')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullOutput = ''
      let streamError = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const rawLine of lines) {
          const line = rawLine.trimEnd()
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6)) as {
              type: string
              content?: string
              valid?: boolean
              errors?: string[]
              message?: string
              finishReason?: string
              rawFinishReason?: string
              truncated?: boolean
              continuationsUsed?: number
              usage?: GenerationSummary['usage']
              estimatedInputTokens?: number
              contextWindowTokens?: number
              requestedMaxOutputTokens?: number
              effectiveMaxOutputTokens?: number
            }
            if (data.type === 'chunk') {
              fullOutput += data.content || ''
              setOutput(fullOutput)
            } else if (data.type === 'validation') {
              setValidation({ valid: Boolean(data.valid), errors: data.errors || [] })
            } else if (data.type === 'error') {
              streamError = data.message || '转换失败'
              setError(streamError)
            } else if (data.type === 'progress') {
              setProgressMessage(data.message || '正在继续生成 HTML...')
            } else if (data.type === 'warning') {
              setNotice(data.message || '模型服务未完全支持当前生成参数')
            } else if (data.type === 'budget') {
              if ((data.effectiveMaxOutputTokens || 0) < (data.requestedMaxOutputTokens || 0)) {
                setNotice(
                  `预计输入约 ${(data.estimatedInputTokens || 0).toLocaleString()} token；受 ${(data.contextWindowTokens || 0).toLocaleString()} token 上下文窗口限制，本轮最大输出已调整为 ${(data.effectiveMaxOutputTokens || 0).toLocaleString()} token。`,
                )
              }
            } else if (data.type === 'finish') {
              const summary: GenerationSummary = {
                finishReason: data.finishReason || 'other',
                rawFinishReason: data.rawFinishReason,
                truncated: Boolean(data.truncated),
                continuationsUsed: data.continuationsUsed || 0,
                usage: data.usage,
              }
              setGenerationSummary(summary)
              if (summary.truncated) {
                streamError = data.message || '模型输出达到长度上限，结果可能不完整'
                setError(streamError)
              }
            }
          } catch {
            // Ignore an isolated malformed SSE line and continue consuming the stream.
          }
        }
      }

      if (!streamError && fullOutput) setOutput(await beautifyCode(fullOutput))
    } catch (convertError) {
      if (!(convertError instanceof DOMException && convertError.name === 'AbortError')) {
        setError(convertError instanceof Error ? convertError.message : '转换失败')
      }
    } finally {
      abortRef.current = null
      setIsConverting(false)
    }
  }, [googleDocsUrl, isConverting, mdContent, modelSettings.activeProfile, sourceType])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('复制失败，请手动复制')
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void uploadFile(file)
  }

  const hasInput = sourceType === 'googledocs' ? Boolean(googleDocsUrl.trim()) : Boolean(mdContent.trim())
  const hasModel = Boolean(modelSettings.activeProfile?.selectedModel)
  const canConvert = hasInput && hasModel

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-100 via-gray-50 to-white dark:from-slate-950 dark:via-gray-900 dark:to-black">
      <ModelSettingsDialog
        open={settingsOpen}
        profiles={modelSettings.settings.profiles}
        activeProfileId={modelSettings.settings.activeProfileId}
        onOpenChange={setSettingsOpen}
        onUpsert={modelSettings.upsertProfile}
        onDelete={modelSettings.deleteProfile}
        onSetActive={modelSettings.setActiveProfileId}
        onClearAll={modelSettings.clearAll}
      />

      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-[20%] -top-[40%] h-[70%] w-[70%] rounded-full bg-blue-400/10 blur-3xl" />
        <div className="absolute -bottom-[40%] -right-[20%] h-[70%] w-[70%] rounded-full bg-purple-400/10 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gray-800 dark:bg-gray-700">
              <Code2 className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Blog To HTML</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">多模型文档转换工具</p>
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-6">
          <Card className="glass border-0 shadow-xl">
            <CardHeader className="pb-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 shadow-lg shadow-blue-500/25">
                    <FileText className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">输入源</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">选择文档、配置档案与模型</p>
                  </div>
                </div>
                <ModelSelector
                  profiles={modelSettings.settings.profiles}
                  activeProfile={modelSettings.activeProfile}
                  disabled={isConverting}
                  onProfileChange={modelSettings.setActiveProfileId}
                  onModelChange={modelSettings.setSelectedModel}
                  onOpenSettings={() => setSettingsOpen(true)}
                />
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              {!hasModel && (
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="flex w-full items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"
                >
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  <span className="text-sm font-medium">请先配置模型 API 和模型 ID，然后再开始转换。</span>
                </button>
              )}

              <Tabs value={sourceType} onValueChange={(value) => { setSourceType(value as 'googledocs' | 'md'); setError('') }}>
                <TabsList className="grid w-full grid-cols-2 rounded-xl border border-gray-300 bg-gray-200/80 p-1.5 dark:border-gray-700 dark:bg-gray-800/80">
                  <TabsTrigger value="googledocs" className="rounded-lg font-medium"><Globe className="mr-2 h-4 w-4" />Google Docs</TabsTrigger>
                  <TabsTrigger value="md" className="rounded-lg font-medium"><FileText className="mr-2 h-4 w-4" />Markdown 文件</TabsTrigger>
                </TabsList>

                <TabsContent value="googledocs" className="mt-6 space-y-3">
                  <label htmlFor="google-docs-url" className="text-sm font-medium text-gray-700 dark:text-gray-300">Google Docs 链接</label>
                  <div className="relative">
                    <Globe className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
                    <input
                      id="google-docs-url"
                      type="url"
                      value={googleDocsUrl}
                      onChange={(event) => setGoogleDocsUrl(event.target.value)}
                      placeholder="https://docs.google.com/document/d/..."
                      className="h-12 w-full rounded-xl border border-gray-200 bg-white/70 pl-12 pr-4 text-sm outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 dark:border-white/10 dark:bg-white/5"
                    />
                  </div>
                  <p className="text-xs text-gray-500">文档需要设置为“知道链接的任何人可查看”。</p>
                </TabsContent>

                <TabsContent value="md" className="mt-6 space-y-4">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click() }}
                    onDrop={handleDrop}
                    onDragOver={(event) => { event.preventDefault(); setIsDragging(true) }}
                    onDragLeave={(event) => { event.preventDefault(); setIsDragging(false) }}
                    className={cn(
                      'cursor-pointer rounded-xl border-2 border-dashed transition-all',
                      isDragging ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10' : 'border-gray-300 bg-gray-50/50 hover:border-blue-400 dark:border-gray-700 dark:bg-white/5',
                    )}
                  >
                    <input ref={fileInputRef} type="file" accept=".md,text/markdown" onChange={handleFileUpload} className="hidden" />
                    <div className="px-6 py-10 text-center">
                      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 shadow-lg shadow-blue-500/25">
                        <Upload className="h-6 w-6 text-white" />
                      </div>
                      <p className="mb-1 font-medium text-gray-900 dark:text-white">点击或拖拽文件到这里</p>
                      <p className="text-sm text-gray-500">支持最大 10MB 的 .md 文件</p>
                    </div>
                  </div>
                  {mdFileName && (
                    <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/20 dark:bg-emerald-500/10">
                      <div className="flex items-center gap-3 text-sm font-medium text-emerald-800 dark:text-emerald-200"><Check className="h-4 w-4" />{mdFileName}</div>
                      <button type="button" onClick={() => { setMdFileName(''); setMdContent(''); if (fileInputRef.current) fileInputRef.current.value = '' }} className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-200 dark:hover:bg-emerald-500/20"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              <Button
                onClick={handleConvert}
                disabled={!isConverting && !canConvert}
                className={cn(
                  'h-12 w-full rounded-xl text-base font-semibold transition-all duration-300',
                  isConverting
                    ? 'bg-red-500 text-white shadow-lg shadow-red-500/25 hover:bg-red-600'
                    : canConvert
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 text-white shadow-lg shadow-blue-500/25 hover:from-blue-700 hover:to-purple-700'
                      : 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-white/10',
                )}
              >
                {isConverting ? <><Square className="mr-2 h-4 w-4 fill-current" />取消转换</> : !hasModel ? <>请先配置模型</> : <>立即转换<ArrowRight className="ml-2 h-5 w-5" /></>}
              </Button>
            </CardContent>
          </Card>

          <Card className="glass border-0 shadow-xl">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 shadow-lg shadow-purple-500/25"><Code2 className="h-5 w-5 text-white" /></div>
                  <div><h2 className="text-lg font-semibold text-gray-900 dark:text-white">HTML 输出</h2><p className="text-sm text-gray-500 dark:text-gray-400">预览或复制生成的代码</p></div>
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-gray-100 p-1 dark:bg-white/5">
                  <button type="button" onClick={() => setViewMode('code')} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', viewMode === 'code' ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white' : 'text-gray-500')}>代码</button>
                  <button type="button" onClick={() => setViewMode('preview')} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', viewMode === 'preview' ? 'bg-white text-gray-900 shadow-sm dark:bg-white/10 dark:text-white' : 'text-gray-500')}>预览</button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"><AlertCircle className="h-5 w-5 shrink-0" /><p className="text-sm">{error}</p></div>}
              {notice && <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"><AlertCircle className="h-5 w-5 shrink-0" /><p className="text-sm">{notice}</p></div>}
              {isConverting && (
                <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 dark:border-blue-500/20 dark:bg-blue-500/10">
                  <div className="flex items-center gap-3 text-sm font-medium text-blue-700 dark:text-blue-300"><span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" />{progressMessage}</div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-blue-100 px-2.5 py-1 text-xs font-mono text-blue-700 dark:bg-blue-500/20 dark:text-blue-300"><Clock3 className="h-3.5 w-3.5" />{Math.max(timer, 0.1).toFixed(1)}s</div>
                </div>
              )}
              {lastDuration !== null && !isConverting && output && !error && (
                <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
                  <Check className="h-5 w-5" />生成完成，总耗时 {lastDuration.toFixed(2)}s
                  {validation?.valid && <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs dark:bg-emerald-500/20">HTML 验证通过</span>}
                  {generationSummary?.usage?.outputTokens !== undefined && (
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs dark:bg-emerald-500/20">
                      输出 {generationSummary.usage.outputTokens.toLocaleString()} token
                    </span>
                  )}
                  {generationSummary && generationSummary.continuationsUsed > 0 && (
                    <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-xs dark:bg-emerald-500/20">
                      自动续写 {generationSummary.continuationsUsed} 次
                    </span>
                  )}
                </div>
              )}
              {validation && !validation.valid && <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300"><AlertCircle className="mt-0.5 h-5 w-5 shrink-0" /><div><p className="text-sm font-medium">HTML 校验提示</p><p className="mt-1 text-xs">{validation.errors[0]}</p></div></div>}

              <div className="relative overflow-hidden rounded-xl border border-gray-800 bg-[#1e1e1e]">
                <div className="flex items-center justify-between border-b border-gray-800 bg-[#252526] px-4 py-3">
                  <div className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-red-500" /><span className="h-3 w-3 rounded-full bg-yellow-500" /><span className="h-3 w-3 rounded-full bg-green-500" /><span className="ml-3 text-xs font-mono text-gray-400">{viewMode === 'code' ? 'output.html' : 'preview'}</span></div>
                  <Button variant="ghost" size="sm" onClick={handleCopy} disabled={!output} className="h-8 text-gray-400 hover:bg-white/10 hover:text-white">{copied ? <><Check />已复制</> : <><Copy />复制</>}</Button>
                </div>
                {viewMode === 'code' ? (
                  <div ref={scrollRef} className="custom-scrollbar h-[320px] overflow-auto">
                    <SyntaxHighlighter language="html" style={vscDarkPlus} customStyle={{ margin: 0, padding: '1.5rem', fontSize: '13px', backgroundColor: 'transparent', fontFamily: 'var(--font-mono)' }} wrapLines wrapLongLines>{output || '<!-- 等待转换... -->'}</SyntaxHighlighter>
                  </div>
                ) : (
                  <div ref={scrollRef} className="custom-scrollbar h-[320px] overflow-auto bg-white p-6 dark:bg-[#1e1e1e]" dangerouslySetInnerHTML={{ __html: output ? DOMPurify.sanitize(output, { USE_PROFILES: { html: true } }) : '<p style="color:#9ca3af;text-align:center;margin-top:5rem;font-style:italic;font-size:.875rem">预览区域</p>' }} />
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <footer className="mt-8 text-center text-sm text-gray-500 dark:text-gray-400">Blog To HTML · OpenAI / Anthropic Compatible</footer>
      </div>
    </div>
  )
}

export default App
