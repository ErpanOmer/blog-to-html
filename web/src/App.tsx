import { useState, useRef, useCallback, useEffect } from 'react'
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
  Sparkles,
  FileText,
  Globe,
  Download,
  Copy,
  Check,
  Code2,
  Trash2,
  AlertCircle
} from 'lucide-react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SectionHeader } from '@/components/ui/section-header'
import { StatusAlert } from '@/components/ui/status-alert'
import './App.css'

type ValidationResult = {
  valid: boolean
  errors: string[]
}

const isCloudModel = (modelName: string) => modelName.toLowerCase().endsWith('cloud')

function App() {
  const [sourceType, setSourceType] = useState<'googledocs' | 'md'>('googledocs')
  const [googleDocsUrl, setGoogleDocsUrl] = useState('')
  const [mdContent, setMdContent] = useState('')
  const [mdFileName, setMdFileName] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [selectedModel, setSelectedModel] = useState('')
  const [output, setOutput] = useState('')
  const [isConverting, setIsConverting] = useState(false)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('code')
  const [timer, setTimer] = useState<number>(0)
  const [lastDuration, setLastDuration] = useState<number | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetchModels()
  }, [])

  useEffect(() => {
    let interval: any
    if (isConverting) {
      const start = Date.now()
      setTimer(0)
      setLastDuration(null)
      interval = setInterval(() => {
        setTimer((Date.now() - start) / 1000)
      }, 100)
    } else if (timer > 0) {
      setLastDuration(timer)
    }
    return () => clearInterval(interval)
  }, [isConverting])

  useEffect(() => {
    // Always scroll the code container and the browser window to the bottom
    // when the output or view mode changes so newly appended chunks are visible.
    if (viewMode === 'code') {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
      // also ensure the overall page scrolls to the bottom for better UX
      // small timeout helps when DOM updates are still settling
      setTimeout(() => {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' })
      }, 50)
    }
  }, [output, viewMode])

  const fetchModels = async () => {
    try {
      const res = await fetch('/api/models')
      const data = await res.json()
      if (data.models && data.models.length > 0) {
        setModels(data.models)
        setSelectedModel(data.models[0])
      }
    } catch (err) {
      console.error('Failed to fetch models:', err)
    }
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.md')) {
      setError('只支持 .md 格式文件')
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
    setIsConverting(true)
    setOutput('')
    setValidation(null)
    setError('')

    try {
      const body = sourceType === 'googledocs'
        ? { sourceType, url: googleDocsUrl, model: selectedModel }
        : { sourceType, content: mdContent, model: selectedModel }

      const res = await fetch('/api/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

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
            }
          }
        }
      }

      const beautiful = await beautifyCode(fullOutput)
      setOutput(beautiful)

    } catch (err) {
      setError(err instanceof Error ? err.message : '转换失败')
    } finally {
      setIsConverting(false)
    }
  }, [sourceType, googleDocsUrl, mdContent, selectedModel])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(output)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('复制失败')
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file && fileInputRef.current) {
      const dt = new DataTransfer()
      dt.items.add(file)
      fileInputRef.current.files = dt.files
      handleFileUpload({ target: { files: dt.files } } as React.ChangeEvent<HTMLInputElement>)
    }
  }, [])

  const modelSelector = (
    <Select value={selectedModel} onValueChange={setSelectedModel}>
      <SelectTrigger className="w-xs bg-transparent border-none h-12 rounded-md text-base">
        <SelectValue placeholder="选择模型" />
      </SelectTrigger>
      <SelectContent>
        {models.length > 0 ? (
          models.map(m => (
            <SelectItem key={m} value={m}>
              <div className="flex items-center gap-2">
                {isCloudModel(m) ? (
                  <Cloud className="h-3.5 w-3.5 text-blue-400" />
                ) : (
                  <Monitor className="h-3.5 w-3.5 text-emerald-400" />
                )}
                <span className="font-mono text-base">{m}</span>
              </div>
            </SelectItem>
          ))
        ) : (
          <SelectItem value="loading" disabled>加载中...</SelectItem>
        )}
      </SelectContent>
    </Select>
  )

  const viewToggleButtons = (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={`rounded-md h-8 px-3 text-base font-bold transition-all ${viewMode === 'code' ? 'bg-primary text-primary-foreground shadow-md' : 'hover:bg-white/5'}`}
        onClick={() => setViewMode('code')}
      >
        代码
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={`rounded-md h-8 px-3 text-base font-bold transition-all ${viewMode === 'preview' ? 'bg-primary text-primary-foreground shadow-md' : 'hover:bg-white/5'}`}
        onClick={() => setViewMode('preview')}
      >
        预览
      </Button>
      <div className="w-px bg-white/10 mx-0.5" />
      <Button
        variant="ghost"
        size="sm"
        className="rounded-md h-8 px-3 text-base font-bold hover:bg-white/5 transition-all text-primary"
        onClick={handleCopy}
        disabled={!output}
      >
        {copied ? <Check className="h-3.5 w-3.5 mr-1" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
        {copied ? '已复制' : '复制'}
      </Button>
    </>
  )

  return (
    <div className="min-h-screen p-4 md:p-6 selection:bg-primary/30">
      <div className="mx-auto max-w-6xl space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
        <header className="text-center space-y-2 pt-2 pb-4">
          <div className="inline-block p-1.5 rounded-xl bg-primary/10 mb-1 animate-glow">
            <Sparkles className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-3xl md:text-4xl font-black tracking-tight text-gradient">
            Blog To HTML
          </h1>
          <p className="text-muted-foreground text-base font-medium max-w-xl mx-auto opacity-80">
            一键将 Google Docs 或 Word 文档 转换为标准的 HTML 代码
          </p>
        </header>

        <div className="grid gap-6 grid-cols-1">
          <Card className="glass-card overflow-hidden border border-white/5">
            <CardHeader className="pb-4 border-b border-white/5 px-6">
              <SectionHeader icon={FileText} title="输入源" iconVariant="blue" actions={modelSelector} />
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              <Tabs value={sourceType} onValueChange={(v) => setSourceType(v as 'googledocs' | 'md')} className="w-full">
                <TabsList className="grid w-full grid-cols-2 p-1 bg-black/20 rounded-lg h-10">
                  <TabsTrigger value="googledocs" className="text-base rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                    <Globe className="h-3.5 w-3.5 mr-1.5" />
                    Google Docs
                  </TabsTrigger>
                  <TabsTrigger value="md" className="text-base rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground transition-all">
                    <FileText className="h-3.5 w-3.5 mr-1.5" />
                    Markdown 文件
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="googledocs" className="mt-4 space-y-3 animate-in slide-in-from-left-1 duration-200">
                  <div className="space-y-2">
                    <div className="relative group">
                      <input
                        type="url"
                        placeholder="粘贴 Google Docs 链接..."
                        value={googleDocsUrl}
                        onChange={(e) => setGoogleDocsUrl(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm transition-all focus:border-primary/50 focus:outline-none focus:ring-2 focus:ring-primary/10"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground italic flex items-center gap-1.5 ml-1">
                      <AlertCircle className="h-3 w-3" />
                      请确保文档已设置为「任何人均可查看」
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="md" className="mt-4 space-y-3 animate-in slide-in-from-right-1 duration-200">
                  <div
                    className="relative border border-dashed border-white/10 rounded-xl p-8 text-center transition-all hover:border-primary/30 hover:bg-primary/5 cursor-pointer group"
                    onDrop={handleDrop}
                    onDragOver={(e) => e.preventDefault()}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".md"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <div className="space-y-3">
                      <div className="p-2.5 rounded-full bg-primary/10 w-fit mx-auto">
                        <Download className="h-6 w-6 text-primary" />
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-sm font-bold">点击或拖放 .md 文件</p>
                      </div>
                    </div>
                  </div>
                  {mdFileName && (
                    <div className="flex items-center justify-between p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Check className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="font-bold text-emerald-400 text-base">{mdFileName}</span>
                      </div>
                      <button
                        onClick={() => { setMdFileName(''); setMdContent(''); }}
                        className="p-1 hover:text-destructive transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </TabsContent>
              </Tabs>

              <Button
                onClick={handleConvert}
                disabled={isConverting || (sourceType === 'googledocs' ? !googleDocsUrl : !mdContent)}
                className="w-full h-11 text-base font-bold rounded-xl transition-all active:scale-[0.98] disabled:opacity-50"
                size="lg"
              >
                {isConverting ? (
                  <div className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>转换中...</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4" />
                    <span>立即转换</span>
                  </div>
                )}
              </Button>
            </CardContent>
          </Card>

          <Card className="glass-card overflow-hidden border border-white/5">
            <CardHeader className="pb-4 border-b border-white/5 px-6">
              <SectionHeader icon={Code2} title="HTML 输出" iconVariant="cyan" actions={viewToggleButtons} />
            </CardHeader>
            <CardContent className="p-6 space-y-4">
              {error && (
                <StatusAlert variant="error" title="错误">
                  {error}
                </StatusAlert>
              )}

              {isConverting && (
                <StatusAlert variant="info" className="animate-in fade-in slide-in-from-top-1 duration-300">
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-1.5">
                      <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span className="text-base font-black">正在生成转换中...</span>
                    </div>
                    <span className="font-mono text-[10px] opacity-70">
                      {timer.toFixed(1)}s
                    </span>
                  </div>
                </StatusAlert>
              )}

              {lastDuration !== null && !isConverting && (
                <StatusAlert variant="cyan" className="animate-in fade-in duration-500">
                  <div className="text-base font-bold text-cyan-400/70 flex items-center gap-2">
                    <Sparkles className="h-3 w-3" />
                    生成完毕，总计耗时 {lastDuration.toFixed(2)}s
                  </div>
                </StatusAlert>
              )}

              {validation && (
                <StatusAlert variant={validation.valid ? 'success' : 'warning'}>
                  <div className="flex items-center gap-1.5">
                    {validation.valid ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                    <span className="text-base font-black">{validation.valid ? '验证通过' : '验证警告'}</span>
                  </div>
                </StatusAlert>
              )}

              <div className="relative rounded-xl border border-white/10 bg-black/40 overflow-hidden shadow-inner font-mono text-sm group">
                {viewMode === 'code' ? (
                  <div
                    ref={scrollRef}
                    className="overflow-y-auto overflow-x-hidden custom-scrollbar transition-all"
                  >
                    <SyntaxHighlighter
                      language="html"
                      style={vscDarkPlus}
                      customStyle={{
                        margin: 0,
                        padding: '1.25rem',
                        fontSize: '1rem',
                        backgroundColor: 'transparent',
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        // ensure lines wrap naturally and avoid horizontal scrollbars
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        overflowWrap: 'anywhere',
                      }}
                      wrapLines={true}
                      wrapLongLines={true}
                    >
                      {output || (isConverting ? '' : '<!-- 代码生成结果 -->')}
                    </SyntaxHighlighter>
                  </div>
                ) : (
                  <div
                    ref={scrollRef}
                    className="p-6 overflow-y-auto overflow-x-hidden custom-scrollbar prose prose-invert prose-sm max-w-none text-foreground bg-white/[0.01]"
                    dangerouslySetInnerHTML={{ __html: output || '<p class="text-muted-foreground italic text-center text-base mt-20">预览区域</p>' }}
                  />
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <footer className="pt-4 pb-8 border-t border-white/5 mt-6 text-center">
          <p className="text-[10px] font-bold text-muted-foreground/40 uppercase tracking-widest">
            Semantic HTML • Precise Transformation • Cloud Ready
          </p>
        </footer>
      </div>
    </div>
  )
}

export default App
