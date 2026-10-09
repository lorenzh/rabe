import type { RabeItem, RabeItemKind } from '../../model'

// The terminal's own color: plain text and background use it, so the pane
// follows the person's theme. Every other color is 0x00RRGGBB from the mockups.
export const DEFAULT = 0x01000000

export const C = {
  text: DEFAULT,
  bg: DEFAULT,
  dim: 0x8a8a8a,
  bright: 0xf2efe8,
  orange: 0xd97757,
  yellow: 0xe5c07b,
  green: 0x7fb069,
  red: 0xe06c75,
  blue: 0x61afef,
  purple: 0xc678dd,
  cyan: 0x56b6c2,
  grey: 0xd4d4d4,
  // backgrounds
  selected: 0x3a2a20,
  focusBg: 0xb8d4f5,
  focusFg: 0x14345e,
  panel: 0x2a2622,
  raised: 0x222120,
  rule: 0x3a3a37,
} as const

export type Style = { fg?: number; bg?: number }

export const CHIP = {
  agent: { fg: C.orange, bg: 0x3a2a20 },
  codex: { fg: C.cyan, bg: 0x1f2e30 },
  workflow: { fg: C.green, bg: 0x223022 },
  shell: { fg: C.yellow, bg: 0x33301e },
  monitor: { fg: C.blue, bg: 0x1e2a36 },
  cron: { fg: C.purple, bg: 0x2e2236 },
  failed: { fg: C.red, bg: 0x3a2224 },
  done: { fg: C.green, bg: 0x223022 },
  cost: { fg: C.grey, bg: 0x262626 },
} as const satisfies Record<RabeItemKind | 'failed' | 'done' | 'cost', Required<Style>>

const RUNNING: Record<RabeItemKind, number> = {
  agent: C.yellow,
  codex: C.cyan,
  workflow: C.green,
  shell: C.yellow,
  monitor: C.blue,
  cron: C.purple,
}

// The glyph color of an item: its kind while it runs, else its end.
export function tone(item: RabeItem): number {
  if (item.status === 'failed') return C.red
  if (item.status === 'done') return C.green
  if (item.status === 'stopped') return C.dim

  return RUNNING[item.kind]
}
