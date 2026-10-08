import type { On } from 'claude-code'

import { crons } from './crons'
import { monitors } from './monitors'
import { shells } from './shells'

export type Source = (on: On) => void

export function sources(on: On): void {
  shells(on)
  monitors(on)
  crons(on)
}
