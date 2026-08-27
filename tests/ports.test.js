import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import {
  DEFAULT_BACKEND_PORT,
  DEFAULT_FRONTEND_PORT,
  getBackendPort,
  getFrontendPort,
} from '../server/ports.js'

describe('local port configuration', () => {
  test('uses the uncommon default ports', () => {
    assert.equal(getBackendPort({}), DEFAULT_BACKEND_PORT)
    assert.equal(getFrontendPort({}), DEFAULT_FRONTEND_PORT)
  })

  test('uses BACKEND_PORT before the legacy PORT setting', () => {
    assert.equal(getBackendPort({ BACKEND_PORT: '43181', PORT: '3000' }), 43181)
    assert.equal(getBackendPort({ PORT: '43181' }), 43181)
    assert.equal(getFrontendPort({ FRONTEND_PORT: '43182' }), 43182)
  })

  test('rejects unsafe or malformed ports', () => {
    assert.throws(() => getBackendPort({ BACKEND_PORT: '5173.5' }), /BACKEND_PORT/)
    assert.throws(() => getFrontendPort({ FRONTEND_PORT: '80' }), /FRONTEND_PORT/)
    assert.throws(() => getFrontendPort({ FRONTEND_PORT: 'abc' }), /FRONTEND_PORT/)
  })
})
