import { execFileSync } from 'node:child_process'

import { ProxyAgent } from 'undici'

import { PublicError } from './llm.js'

const GOOGLE_DOCS_TIMEOUT_MS = 15_000
const proxyDispatchers = new Map()

function withHttpScheme(value) {
  const proxy = value?.trim()
  if (!proxy) return undefined
  if (/^https?:\/\//i.test(proxy)) return proxy
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(proxy)) return undefined
  return `http://${proxy}`
}

/**
 * Windows stores either one proxy (host:port) or a semicolon-separated list
 * such as "http=host:port;https=host:port". HTTPS destinations normally use
 * the entry named "https", even though that proxy itself is an HTTP endpoint.
 */
export function parseWindowsProxyServer(value) {
  const proxy = value?.trim()
  if (!proxy) return undefined

  if (!proxy.includes('=')) return withHttpScheme(proxy)

  const entries = new Map()
  for (const item of proxy.split(';')) {
    const separator = item.indexOf('=')
    if (separator === -1) continue
    entries.set(item.slice(0, separator).trim().toLowerCase(), item.slice(separator + 1).trim())
  }
  return withHttpScheme(entries.get('https') || entries.get('http'))
}

export function readWindowsProxy({ execFileSyncImpl = execFileSync } = {}) {
  if (process.platform !== 'win32' && execFileSyncImpl === execFileSync) return undefined

  try {
    const output = execFileSyncImpl('reg.exe', [
      'query',
      'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
    ], { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
    const enabled = output.match(/ProxyEnable\s+REG_DWORD\s+0x([\da-f]+)/i)
    const server = output.match(/ProxyServer\s+REG_SZ\s+(.+)$/im)
    if (!enabled || Number.parseInt(enabled[1], 16) === 0 || !server) return undefined
    return parseWindowsProxyServer(server[1])
  } catch {
    return undefined
  }
}

export function getGoogleDocsProxy({ env = process.env, windowsProxy } = {}) {
  const configured = env.GOOGLE_DOCS_PROXY
    || env.HTTPS_PROXY
    || env.https_proxy
    || env.HTTP_PROXY
    || env.http_proxy
  if (configured) return withHttpScheme(configured)
  if (windowsProxy !== undefined) return parseWindowsProxyServer(windowsProxy)
  return readWindowsProxy()
}

function getProxyDispatcher(proxyUrl) {
  if (!proxyDispatchers.has(proxyUrl)) proxyDispatchers.set(proxyUrl, new ProxyAgent(proxyUrl))
  return proxyDispatchers.get(proxyUrl)
}

function networkErrorDetail(error) {
  const code = error?.cause?.code || error?.code
  if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT') return '连接超时'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS 解析失败'
  if (code === 'ECONNREFUSED') return '代理或目标服务器拒绝连接'
  if (code === 'ECONNRESET') return '连接被重置'
  if (typeof code === 'string' && code.startsWith('CERT_')) return 'TLS 证书校验失败'
  return '网络请求失败'
}

export async function fetchGoogleDocsContent(url, {
  fetchImpl = fetch,
  proxyUrl = getGoogleDocsProxy(),
  dispatcherFactory = getProxyDispatcher,
  timeoutMs = GOOGLE_DOCS_TIMEOUT_MS,
} = {}) {
  const docIdMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/)
  if (!docIdMatch) throw new PublicError(400, 'invalid_google_docs_url', 'Google Docs URL 无效')

  const exportUrl = `https://docs.google.com/document/d/${docIdMatch[1]}/export?format=md`
  const options = { signal: AbortSignal.timeout(timeoutMs) }
  if (proxyUrl) options.dispatcher = dispatcherFactory(proxyUrl)

  let response
  try {
    response = await fetchImpl(exportUrl, options)
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new PublicError(504, 'google_docs_timeout', '访问 Google Docs 超时，请检查代理或网络连接')
    }
    const detail = networkErrorDetail(error)
    throw new PublicError(
      502,
      'google_docs_unavailable',
      `无法访问 Google Docs（${detail}），请检查代理；也可设置 GOOGLE_DOCS_PROXY 环境变量`,
    )
  }

  if (!response.ok) {
    throw new PublicError(400, 'google_docs_unavailable', '无法访问 Google Docs，请确认文档已设为“知道链接的任何人可查看”')
  }

  const contentType = response.headers.get('content-type') || ''
  const text = await response.text()
  if (contentType.includes('text/html') && /<form[^>]*login|accounts\.google\.com\/ServiceLogin/i.test(text)) {
    throw new PublicError(400, 'google_docs_private', '该 Google Docs 需要登录，请将权限设为“知道链接的任何人可查看”')
  }
  return text
}
