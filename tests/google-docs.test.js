import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import {
  fetchGoogleDocsContent,
  getGoogleDocsProxy,
  parseWindowsProxyServer,
  readWindowsProxy,
} from '../server/google-docs.js'

describe('Google Docs proxy selection', () => {
  test('parses single and protocol-specific Windows proxy values', () => {
    assert.equal(parseWindowsProxyServer('127.0.0.1:7897'), 'http://127.0.0.1:7897')
    assert.equal(
      parseWindowsProxyServer('http=127.0.0.1:8080;https=127.0.0.1:8443'),
      'http://127.0.0.1:8443',
    )
    assert.equal(parseWindowsProxyServer('socks=socks.example:1080'), undefined)
  })

  test('prefers the Google-specific proxy over standard proxy variables', () => {
    assert.equal(getGoogleDocsProxy({
      env: {
        GOOGLE_DOCS_PROXY: 'http://google-proxy.test:7890',
        HTTPS_PROXY: 'http://general-proxy.test:8080',
      },
      windowsProxy: '127.0.0.1:8888',
    }), 'http://google-proxy.test:7890')
  })

  test('reads an enabled Windows user proxy', () => {
    const proxy = readWindowsProxy({
      execFileSyncImpl: () => `
        ProxyEnable    REG_DWORD    0x1
        ProxyServer    REG_SZ       127.0.0.1:7897
      `,
    })
    assert.equal(proxy, 'http://127.0.0.1:7897')
  })
})

describe('Google Docs download', () => {
  test('exports the document as Markdown and uses the selected dispatcher', async () => {
    const dispatcher = { dispatch() {} }
    let request
    const content = await fetchGoogleDocsContent(
      'https://docs.google.com/document/d/doc-123_test/edit?tab=t.0#heading=h.example',
      {
        proxyUrl: 'http://127.0.0.1:7897',
        dispatcherFactory: (proxyUrl) => {
          assert.equal(proxyUrl, 'http://127.0.0.1:7897')
          return dispatcher
        },
        fetchImpl: async (url, options) => {
          request = { url, options }
          return new Response('# Exported document', {
            status: 200,
            headers: { 'Content-Type': 'text/x-markdown; charset=utf-8' },
          })
        },
      },
    )

    assert.equal(content, '# Exported document')
    assert.equal(request.url, 'https://docs.google.com/document/d/doc-123_test/export?format=md')
    assert.equal(request.options.dispatcher, dispatcher)
  })

  test('reports invalid links before making a request', async () => {
    await assert.rejects(
      fetchGoogleDocsContent('https://example.com/not-a-google-doc', {
        fetchImpl: async () => assert.fail('fetch must not be called'),
        proxyUrl: undefined,
      }),
      (error) => error.code === 'invalid_google_docs_url',
    )
  })

  test('provides a proxy hint for connection failures', async () => {
    await assert.rejects(
      fetchGoogleDocsContent('https://docs.google.com/document/d/test/edit', {
        fetchImpl: async () => {
          throw Object.assign(new TypeError('fetch failed'), {
            cause: { code: 'UND_ERR_CONNECT_TIMEOUT' },
          })
        },
        proxyUrl: undefined,
      }),
      (error) => error.code === 'google_docs_unavailable'
        && /连接超时/.test(error.message)
        && /GOOGLE_DOCS_PROXY/.test(error.message),
    )
  })
})
