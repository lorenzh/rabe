import type { Register } from 'claude-code'

import { sources } from './sources'
import { band } from './ui/band'
import { pane } from './ui/pane'

export const register: Register = on => {
  sources(on)
  band(on)
  pane(on)
}
