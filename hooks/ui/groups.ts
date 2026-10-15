import type { RabeGrouping, RabeMainUsage } from '../../types'
import type { RabeItem } from '../model'
import { shown, stable, tokenSum, withForwarder } from './lists'

// A row of the Cost tab's model and harness groupings. `tokens` is -1 when no
// member's tokens are known; `costUsd` is undefined when one member's is.
export type GroupRow = {
  id: string
  title: string
  tokens: number
  costUsd?: number
  // Workers in the row; absent on a main-session row (its steps are partial).
  count?: number
}

const plus = (a: number | undefined, b: number | undefined) =>
  a === undefined || b === undefined ? undefined : a + b

type Sum = { tokens: number; costUsd?: number; count: number }

function add(sum: Sum | undefined, item: RabeItem): Sum {
  const tok = tokenSum(item)

  return {
    tokens:
      tok >= 0 || (sum && sum.tokens >= 0) ? Math.max(sum?.tokens ?? 0, 0) + Math.max(tok, 0) : -1,
    costUsd: sum ? plus(sum.costUsd, item.costUsd) : item.costUsd,
    count: (sum?.count ?? 0) + 1,
  }
}

function mainRow(by: RabeGrouping, model: string, one: RabeMainUsage): GroupRow {
  return {
    id: `by:${by}:main:${model}`,
    title: `main session (partial) · ${model.replace(/^claude-/, '')}`,
    tokens: one.input + one.output,
    costUsd: one.isUnpriced ? undefined : one.usd,
  }
}

// The main session's models as one row, or none before its first step.
export function mainTotal(
  by: RabeGrouping,
  main: Record<string, RabeMainUsage>,
): GroupRow | undefined {
  const all = Object.values(main)
  if (!all.length) return undefined

  return {
    id: `by:${by}:main`,
    title: 'main session (partial)',
    tokens: all.reduce((n, one) => n + one.input + one.output, 0),
    costUsd: all.some(one => one.isUnpriced)
      ? undefined
      : all.reduce((n, one) => n + (one.usd ?? 0), 0),
  }
}

// The rows of a grouping other than `agent`, by tokens. Every worker counts
// once: a Claude agent that only forwarded to Codex is in its job's row, with
// its spend (`withForwarder`). The main session has its own rows, per model,
// or one row for the harness: it is not an item, and its figures are the steps
// seen since Rabe loaded.
export function groupRows(
  by: Exclude<RabeGrouping, 'agent'>,
  items: RabeItem[],
  main: Record<string, RabeMainUsage> = {},
): GroupRow[] {
  const sums = new Map<string, Sum & { title: string }>()
  for (const item of shown(items)) {
    if (item.kind !== 'agent' && item.kind !== 'codex') continue
    const worker = withForwarder(item, items)
    const model =
      worker.kind === 'agent' || worker.kind === 'codex' ? worker.detail.model : undefined
    const key = by === 'harness' ? item.kind : (model ?? '')
    const title =
      by === 'harness' ? (item.kind === 'codex' ? 'Codex' : 'Claude Code') : (model ?? 'model n/a')
    sums.set(key, { ...add(sums.get(key), worker), title })
  }
  const rows: GroupRow[] = [...sums].map(([key, sum]) => ({
    id: `by:${by}:${key || 'n/a'}`,
    title: sum.title,
    tokens: sum.tokens,
    costUsd: sum.costUsd,
    count: sum.count,
  }))
  const models = Object.entries(main)
  if (by === 'model') rows.push(...models.map(([model, one]) => mainRow(by, model, one)))
  else {
    const total = mainTotal('harness', main)
    if (total) rows.push(total)
  }

  return rows
}

export const byRowTokens = (rows: GroupRow[]): GroupRow[] =>
  rows.toSorted((a, b) => b.tokens - a.tokens)

// The rows as the pane holds them while it is open (`stable`).
export const heldRows = (rows: GroupRow[], held?: readonly string[]): GroupRow[] =>
  stable(rows, held, byRowTokens)

// The ids `orderOf` keeps for a grouping when the pane opens.
export const orderIds = (
  by: Exclude<RabeGrouping, 'agent'>,
  items: RabeItem[],
  main?: Record<string, RabeMainUsage>,
): string[] => byRowTokens(groupRows(by, items, main)).map(row => row.id)
