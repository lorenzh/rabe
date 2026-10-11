import type { On } from 'claude-code'
import type { Pollers } from '../registry'

import { agents } from './agents'
import { codex } from './codex'
import { crons } from './crons'
import { monitors } from './monitors'
import { shells } from './shells'
import { workflows } from './workflows'
import { worktrees } from './worktrees'

export type Source = (on: On) => void

// `file`: the user's price table (option `pricesFile`), '' for none.
export function sources(on: On, file: string, pollers: Pollers): void {
  agents(on, file, pollers)
  workflows(on)
  codex(on, file, pollers)
  shells(on, pollers)
  monitors(on, pollers)
  worktrees(on, pollers)
  crons(on)
}
