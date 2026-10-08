import type { On } from 'claude-code'

export type Source = (on: On) => void

export function sources(_on: On): void {}
