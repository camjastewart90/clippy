import type { ClippyApi } from './index'

declare global {
  interface Window {
    clippy: ClippyApi
  }
}

export {}
