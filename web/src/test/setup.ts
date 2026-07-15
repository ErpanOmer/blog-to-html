import '@testing-library/jest-dom/vitest'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('ResizeObserver', ResizeObserverMock)
vi.stubGlobal('confirm', vi.fn(() => true))

afterEach(() => {
  cleanup()
  localStorage.clear()
  vi.restoreAllMocks()
})
