import type { On } from 'claude-code'

import { agents } from './agents'
import { codex } from './codex'
import { crons } from './crons'
import { monitors } from './monitors'
import { shells } from './shells'
import { workflows } from './workflows'

export type Source = (on: On) => void

export function sources(on: On): void {
  agents(on)
  workflows(on)
  codex(on)
  shells(on)
  monitors(on)
  crons(on)
}
