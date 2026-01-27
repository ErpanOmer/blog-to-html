import { useState, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import './App.css'

type ValidationResult = {
  valid: boolean
  errors: string[]
}

function App() {
  const [sourceType, setSourceType] = useState<'googledocs' | 'docx'>('googledocs')
  const [googleDocsUrl, setGoogleDocsUrl] = useState('')
  const [docxContent, setDocxContent] = useState('')
  const [docxFileName, setDocxFileName] = useState('')
  const [output, setOutput] = useState('')
  const [isConverting, setIsConverting] = useState(false)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [viewMode, setViewMode] = useState<'code' | 'preview'>('code')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    if (!file.name.endsWith('.docx')) {
      setError('只支持 .docx 格式文件')
      return
    }

    setDocxFileName(file.name)
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
        setDocxContent(data.content)
      }
    } catch (err) {
      setError('文件上传失败')
      console.error(err)
    }
  }

  const handleConvert = useCallback(async () => {
    setIsConverting(true)
    setOutput('')
    setValidation(null)
    setError('')

    try {
      const body = sourceType === 'googledocs'
        ? { sourceType, url: googleDocsUrl }
        : { sourceType, content: docxContent }

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
                setOutput(prev => prev + data.content)
              } else if (data.type === 'validation') {
                setValidation({ valid: data.valid, errors: data.errors })
              } else if (data.type === 'error') {
                setError(data.message)
              }
            } catch {
              // Ignore JSON parse errors
            }
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '转换失败')
    } finally {
      setIsConverting(false)
    }
  }, [sourceType, googleDocsUrl, docxContent])

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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            博客内容转 HTML
          </h1>
          <p className="text-muted-foreground">
            将您的博客内容转换为符合规范的 HTML 代码片段
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {/* Input Section */}
          <Card className="border-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                输入源
              </CardTitle>
              <CardDescription>
                选择您的内容来源
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Tabs value={sourceType} onValueChange={(v) => setSourceType(v as 'googledocs' | 'docx')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="googledocs">Google Docs 链接</TabsTrigger>
                  <TabsTrigger value="docx">DOCX 文件</TabsTrigger>
                </TabsList>

                <TabsContent value="googledocs" className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Google Docs 链接</label>
                    <input
                      type="url"
                      placeholder="https://docs.google.com/document/d/..."
                      value={googleDocsUrl}
                      onChange={(e) => setGoogleDocsUrl(e.target.value)}
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <p className="text-xs text-muted-foreground">
                      请确保文档已设置为「任何人都可以查看」
                    </p>
                  </div>
                </TabsContent>

                <TabsContent value="docx" className="space-y-4">
                  <div
                    className="relative border-2 border-dashed rounded-lg p-8 text-center transition-colors hover:border-primary cursor-pointer"
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".docx"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <div className="space-y-2">
                      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mx-auto text-muted-foreground">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                      <p className="text-sm text-muted-foreground">
                        拖放 .docx 文件到此处，或点击选择
                      </p>
                    </div>
                  </div>
                  {docxFileName && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      已选择: {docxFileName}
                    </div>
                  )}
                  {docxContent && (
                    <Textarea
                      value={docxContent}
                      readOnly
                      className="h-32 text-xs font-mono"
                      placeholder="文档内容将在此显示..."
                    />
                  )}
                </TabsContent>
              </Tabs>

              <Button
                onClick={handleConvert}
                disabled={isConverting || (sourceType === 'googledocs' ? !googleDocsUrl : !docxContent)}
                className="w-full"
                size="lg"
              >
                {isConverting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    转换中...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-2">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    开始转换
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Output Section */}
          <Card className="border-2">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="16 18 22 12 16 6" />
                      <polyline points="8 6 2 12 8 18" />
                    </svg>
                    HTML 输出
                  </CardTitle>
                  <CardDescription>
                    生成的 HTML 代码片段
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setViewMode(viewMode === 'code' ? 'preview' : 'code')}
                  >
                    {viewMode === 'code' ? '预览' : '代码'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopy}
                    disabled={!output}
                  >
                    {copied ? (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        已复制
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                        复制
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <AlertTitle>错误</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              {validation && (
                <Alert variant={validation.valid ? 'default' : 'destructive'}>
                  {validation.valid ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                      <AlertTitle>验证通过</AlertTitle>
                      <AlertDescription>生成的 HTML 符合规范要求</AlertDescription>
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                        <line x1="12" y1="9" x2="12" y2="13" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      <AlertTitle>验证警告</AlertTitle>
                      <AlertDescription>
                        <ul className="list-disc list-inside mt-1 space-y-1">
                          {validation.errors.map((err, i) => (
                            <li key={i}>{err}</li>
                          ))}
                        </ul>
                      </AlertDescription>
                    </>
                  )}
                </Alert>
              )}

              <div className="relative min-h-[400px] rounded-lg border bg-muted/30 overflow-hidden">
                {viewMode === 'code' ? (
                  <pre className="p-4 overflow-auto h-[400px] text-sm font-mono whitespace-pre-wrap break-words">
                    <code>{output || (isConverting ? '正在生成...' : '转换结果将在此显示')}</code>
                  </pre>
                ) : (
                  <div
                    className="p-4 overflow-auto h-[400px] prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: output || '<p class="text-muted-foreground">转换结果预览将在此显示</p>' }}
                  />
                )}

                {isConverting && (
                  <div className="absolute bottom-4 right-4">
                    <div className="flex items-center gap-2 bg-background/80 backdrop-blur px-3 py-1.5 rounded-full text-xs text-muted-foreground">
                      <span className="animate-pulse">●</span>
                      接收中...
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground">
          基于 prompt.txt 规则进行 HTML 转换 • 严格遵循语义化标签规范
        </p>
      </div>
    </div>
  )
}

export default App
