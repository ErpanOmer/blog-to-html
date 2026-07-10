﻿﻿﻿import { useState, useRef, useCallback, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import * as prettier from 'prettier/standalone'
import * as htmlParser from 'prettier/plugins/html'
import {
  Cloud,
  Monitor,
  FileText,
  Globe,
  Upload,
  Copy,
  Check,
  Code2,
  Trash2,
  AlertCircle,
  Clock3,
  ArrowRight,
  Square,
  RefreshCw,
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import DOMPurify from 'dompurify'
import { cn } from '@/lib/utils'
import './App.css'

type ValidationResult = {
  valid: boolean
  errors: string[]
}

const isCloudModel = (modelName: string) => modelName.toLowerCase().includes('cloud')

function App() {
  const [sourceType, setSourceType] = useState<'googledocs' | 'md'>('googledocs')
  const [googleDocsUrl, setGoogleDocsUrl] = useState('')
  const [mdContent, setMdContent] = useState('')
  const [mdFileName, setMdFileName] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [modelsError, setModelsError] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [output, setOutput] = useState('')
  const [isConverting, setIsConverting] = useState(false)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('code')
  const [timer, setTimer] = useState<number>(0)
  const [lastDuration, setLastDuration] = useState<number | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const convertStartRef = useRef<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetchModels()
  }, [])

  // Abort in-flight conversion on unmount
  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined

    if (isConverting) {
      convertStartRef.current = performance.now()
      setTimer(0.1)
      setLastDuration(null)

      interval = setInterval(() => {
        if (convertStartRef.current === null) return
        const elapsed = (performance.now() - convertStartRef.current) / 1000
        setTimer(elapsed)
      }, 100)
    } else if (convertStartRef.current !== null) {
      const elapsed = (performance.now() - convertStartRef.current) / 1000
      const safeElapsed = Math.max(elapsed, 0.01)
      setTimer(safeElapsed)
      setLastDuration(safeElapsed)
      convertStartRef.current = null
    }

    return () => {
      if (interval) clearInterval(interval)
    }
  }, [isConverting])

  useEffect(() => {
    if (viewMode === 'code' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [output, viewMode])

  const fetchModels = async () => {
    setModelsError('')
    try {
      const res = await fetch('/api/models')
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      if (data.models && data.models.length > 0) {
        const sortedModels = [...data.models].sort((a, b) => {
          const aIsCloud = a.toLowerCase().includes('cloud')
          const bIsCloud = b.toLowerCase().includes('cloud')
          if (aIsCloud && !bIsCloud) return 1
          if (!aIsCloud && bIsCloud) return -1
          return 0
        })
        setModels(sortedModels)
        setSelectedModel(sortedModels[0])
      } else {
        setModelsError('后端未返回可用模型')
      }
    } catch (err) {
      console.error('Failed to fetch models:', err)
      setModelsError('模型加载失败，请检查后端服务')
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.md')) {
      setError('仅支持 .md 格式文件')
      return
    }

    setMdFileName(file.name)
    setError('')

    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()
      if (data.error) {
        setError(data.error)
      } else {
        setMdContent(data.content)
      }
    } catch (err) {
      setError('文件上传失败')
      console.error(err)
    }
  }

  const beautifyCode = async (code: string) => {
    if (!code) return code
    try {
      const formatted = await prettier.format(code, {
        parser: 'html',
        plugins: [htmlParser],
        printWidth: 80,
        tabWidth: 2,
      })
      return formatted
    } catch (err) {
      console.error('Beautify failed:', err)
      return code
    }
  }

  const handleConvert = useCallback(async () => {
    // If already converting, this click means "cancel"
    if (isConverting) {
      abortRef.current?.abort()
      return
    }

    setIsConverting(true)
    setOutput('')
    setValidation(null)
    setError('')

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const body =
        sourceType === 'googledocs'
          ? { sourceType, url: googleDocsUrl, model: selectedModel }
          : { sourceType, content: mdContent, model: selectedModel }

      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })

      // Non-2xx: server returned a normal JSON error (not SSE)
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `请求失败 (${res.status})`)
      }

      if (!res.body) {
        throw new Error('流式响应不可用')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      let buffer = ''
      let fullOutput = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'chunk') {
                fullOutput += data.content
                setOutput(fullOutput)
              } else if (data.type === 'validation') {
                setValidation({ valid: data.valid, errors: data.errors })
              } else if (data.type === 'error') {
                setError(data.message)
              }
            } catch {
              // ignore malformed chunks
            }
          }
        }
      }

      const beautiful = await beautifyCode(fullOutput)
      setOutput(beautiful)
    } catch (err) {
      // User-initiated cancel: don't show error
      if (err instanceof DOMException && err.name === 'AbortError') {
        // no-op
      } else {
        setError(err instanceof Error ? err.message : '转换失败')
      }
    } finally {
      abortRef.current = null
      setIsConverting(false)
    }
  }, [isConverting, sourceType, googleDocsUrl, mdContent, selectedModel])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('复制失败，请手动复制')
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file && fileInputRef.current) {
      const dt = new DataTransfer()
      dt.items.add(file)
      fileInputRef.current.files = dt.files
      handleFileUpload({ target: { files: dt.files } } as React.ChangeEvent<HTMLInputElement>)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const canConvert = sourceType === 'googledocs' ? !!googleDocsUrl : !!mdContent

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-100 via-gray-50 to-white dark:from-slate-950 dark:via-gray-900 dark:to-black">
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -left-[20%] w-[70%] h-[70%] rounded-full bg-blue-400/10 blur-3xl" />
        <div className="absolute -bottom-[40%] -right-[20%] w-[70%] h-[70%] rounded-full bg-purple-400/10 blur-3xl" />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gray-800 dark:bg-gray-700 flex items-center justify-center">
              <Code2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-gray-900 dark:text-white">Blog To HTML</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">本地文档转换工具</p>
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-6">
          <Card className="glass shadow-xl border-0">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
                    <FileText className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">输入源</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">选择文档来源并配置参数</p>
                  </div>
                </div>

                {modelsError && models.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 h-11 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20">
                    <span className="text-sm text-red-600 dark:text-red-400 truncate max-w-[220px]">{modelsError}</span>
                    <button
                      onClick={fetchModels}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-red-700 dark:text-red-300 hover:bg-red-100 dark:hover:bg-red-500/20 transition-colors"
                    >
                      <RefreshCw className="w-3 h-3" />
                      重试
                    </button>
                  </div>
                ) : (
                  <Select value={selectedModel} onValueChange={setSelectedModel}>
                    <SelectTrigger className="w-[350px] bg-white/50 dark:bg-white/5 border-gray-200 dark:border-white/10">
                      <SelectValue placeholder="选择模型" />
                    </SelectTrigger>
                    <SelectContent className="z-[100]">
                      {models.length > 0 ? (
                        models.map((m) => (
                          <SelectItem key={m} value={m}>
                            <div className="flex items-center gap-2">
                              {isCloudModel(m) ? (
                                <Cloud className="h-4 w-4 text-blue-500" />
                              ) : (
                                <Monitor className="h-4 w-4 text-emerald-500" />
                              )}
                              <span className="font-mono text-sm">{m}</span>
                            </div>
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="loading" disabled>
                          模型加载中...
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              <Tabs value={sourceType} onValueChange={(v) => { setSourceType(v as 'googledocs' | 'md'); setError('') }}>
                <TabsList className="grid w-full grid-cols-2 bg-gray-200/80 dark:bg-gray-800/80 p-1.5 rounded-xl border border-gray-300 dark:border-gray-700">
                  <TabsTrigger
                    value="googledocs"
                    className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-gray-600 data-[state=active]:shadow-md data-[state=active]:text-gray-900 dark:data-[state=active]:text-white text-gray-600 dark:text-gray-400 transition-all duration-200 font-medium"
                  >
                    <Globe className="w-4 h-4 mr-2" />
                    Google Docs
                  </TabsTrigger>
                  <TabsTrigger
                    value="md"
                    className="rounded-lg data-[state=active]:bg-white dark:data-[state=active]:bg-gray-600 data-[state=active]:shadow-md data-[state=active]:text-gray-900 dark:data-[state=active]:text-white text-gray-600 dark:text-gray-400 transition-all duration-200 font-medium"
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Markdown
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="googledocs" className="mt-6 space-y-4">
                  <div className="relative">
                    <input
                      type="url"
                      placeholder="粘贴 Google Docs 链接..."
                      value={googleDocsUrl}
                      onChange={(e) => { setGoogleDocsUrl(e.target.value); setError('') }}
                      className="w-full px-4 py-3.5 rounded-xl bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all text-gray-900 dark:text-white placeholder:text-gray-400"
                    />
                  </div>
                  <div className="flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-500/10 px-4 py-3 rounded-xl">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <p>请确保该文档权限已设置为“任何知道链接的人可查看”。</p>
                  </div>
                </TabsContent>

                <TabsContent value="md" className="mt-6 space-y-4">
                  <div
                    className={cn(
                      'relative rounded-2xl border-2 border-dashed transition-all duration-200 cursor-pointer overflow-hidden',
                      isDragging
                        ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-500/10'
                        : 'border-gray-300 dark:border-white/20 hover:border-gray-400 dark:hover:border-white/30 bg-gray-50/50 dark:bg-white/5'
                    )}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".md"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <div className="px-6 py-12 text-center">
                      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
                        <Upload className="w-6 h-6 text-white" />
                      </div>
                      <p className="text-base font-medium text-gray-900 dark:text-white mb-1">点击或拖拽文件到这里</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">支持 .md 格式文件</p>
                    </div>
                  </div>

                  {mdFileName && (
                    <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 animate-scale-in">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-sm font-medium text-emerald-900 dark:text-emerald-100">{mdFileName}</span>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setMdFileName('')
                          setMdContent('')
                        }}
                        className="p-1.5 rounded-lg hover:bg-emerald-200 dark:hover:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              <Button
                onClick={handleConvert}
                disabled={!isConverting && !canConvert}
                className={cn(
                  'w-full h-12 text-base font-semibold rounded-xl transition-all duration-300',
                  isConverting
                    ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/25 hover:-translate-y-0.5'
                    : canConvert
                      ? 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5'
                      : 'bg-gray-100 dark:bg-white/10 text-gray-400 cursor-not-allowed'
                )}
              >
                {isConverting ? (
                  <>
                    <Square className="w-4 h-4 mr-2 fill-current" />
                    取消转换
                  </>
                ) : (
                  <>
                    立即转换
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card className="glass shadow-xl border-0">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shadow-lg shadow-purple-500/25">
                    <Code2 className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">HTML 输出</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400">预览或复制生成的代码</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 bg-gray-100 dark:bg-white/5 p-1 rounded-lg">
                  <button
                    onClick={() => setViewMode('code')}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                      viewMode === 'code'
                        ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    )}
                  >
                    代码
                  </button>
                  <button
                    onClick={() => setViewMode('preview')}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                      viewMode === 'preview'
                        ? 'bg-white dark:bg-white/10 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    )}
                  >
                    预览
                  </button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              <div className="space-y-2">
                {error && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300 animate-scale-in">
                    <AlertCircle className="w-5 h-5 flex-shrink-0" />
                    <p className="text-sm">{error}</p>
                  </div>
                )}

                {isConverting && (
                  <div className="flex items-center justify-between px-4 py-3 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 animate-scale-in">
                    <div className="flex items-center gap-3">
                      <svg className="animate-spin h-5 w-5 text-blue-600 dark:text-blue-400" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      <span className="text-sm font-medium text-blue-700 dark:text-blue-300">正在生成 HTML...</span>
                    </div>
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-100 dark:bg-blue-500/20">
                      <Clock3 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span className="text-xs font-mono font-medium text-blue-700 dark:text-blue-300">
                        {Math.max(timer, 0.1).toFixed(1)}s
                      </span>
                    </div>
                  </div>
                )}

                {lastDuration !== null && !isConverting && (
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 animate-scale-in">
                    <Check className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                        生成完成，总耗时 {lastDuration.toFixed(2)}s
                      </span>
                      {validation?.valid && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 dark:bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                          <Check className="w-3.5 h-3.5" />
                          HTML 验证通过
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {validation && !validation.valid && (
                  <div className="flex items-start gap-3 px-4 py-3 rounded-xl border animate-scale-in bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20">
                    <AlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-amber-700 dark:text-amber-300">HTML 校验提示</p>
                      {validation.errors.length > 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">{validation.errors[0]}</p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="relative rounded-xl overflow-hidden bg-[#1e1e1e] border border-gray-800">
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-[#252526]">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-500" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500" />
                      <div className="w-3 h-3 rounded-full bg-green-500" />
                    </div>
                    <span className="ml-3 text-xs text-gray-400 font-mono">{viewMode === 'code' ? 'output.html' : 'preview'}</span>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleCopy}
                    disabled={!output}
                    className="h-8 px-3 text-gray-400 hover:text-white hover:bg-white/10"
                  >
                    {copied ? (
                      <>
                        <Check className="w-4 h-4 mr-1.5" />
                        已复制
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4 mr-1.5" />
                        复制
                      </>
                    )}
                  </Button>
                </div>

                <div className="relative">
                  {viewMode === 'code' ? (
                    <div ref={scrollRef} className="h-[300px] overflow-auto custom-scrollbar">
                      <SyntaxHighlighter
                        language="html"
                        style={vscDarkPlus}
                        customStyle={{
                          margin: 0,
                          padding: '1.5rem',
                          fontSize: '13px',
                          backgroundColor: 'transparent',
                          fontFamily: 'var(--font-mono)',
                        }}
                        wrapLines
                        wrapLongLines
                      >
                        {output || '<!-- 等待转换... -->'}
                      </SyntaxHighlighter>
                    </div>
                  ) : (
                    <div
                      ref={scrollRef}
                      className="h-[300px] overflow-auto custom-scrollbar p-6 bg-white dark:bg-[#1e1e1e]"
                      dangerouslySetInnerHTML={{
                        __html: output
                          ? DOMPurify.sanitize(output, { USE_PROFILES: { html: true } })
                          : '<p class="text-gray-400 text-center mt-20 italic text-sm">预览区域</p>',
                      }}
                    />
                  )}

                  {!output && !isConverting && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1e1e1e]/95">
                      <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center mb-4">
                        <Code2 className="w-8 h-8 text-gray-600" />
                      </div>
                      <p className="text-gray-400 text-sm">转换后的 HTML 代码将显示在这里</p>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <footer className="mt-8 text-center">
          <p className="text-sm text-gray-500 dark:text-gray-400">Blog To HTML · 本地文档转换工具</p>
        </footer>
      </div>
    </div>
  )
}

export default App
