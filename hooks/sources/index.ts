import type { On } from 'claude-code'

import { codex } from './codex'

export type Source = (on: On) => void

export function sources(on: On): void {
  codex(on)
}
