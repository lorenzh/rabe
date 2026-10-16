import type { RabeGrouping, RabeMainUsage } from '../../types'
import type { RabeItem } from '../model'
import { isWorker, shown, spendBy, stable, withForwarder } from './lists'

// A row of the Cost tab's model and harness groupings. `tokens` is -1 when no
// member's tokens are known; `isPartial` when only some are (the total then
// leaves the others out); `costUsd` is undefined when one member's is.
export type GroupRow = {
  id: string
  title: string
  tokens: number
  isPartial?: boolean
  costUsd?: number
  // Workers in the row; absent on a main-session row (its steps are partial).
  count?: number
}

function mainRow(by: RabeGrouping, model: string, one: RabeMainUsage): GroupRow {
  return {
    id: `by:${by}:main:${model}`,
    title: `main session · ${model.replace(/^claude-/, '')}`,
    isPartial: true,
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
    title: 'main session',
    isPartial: true,
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
  const workers = shown(items)
    .filter(isWorker)
    .map(item => withForwarder(item, items))
  const modelOf = (item: RabeItem) =>
    item.kind === 'agent' || item.kind === 'codex' ? item.detail.model : undefined
  const keyOf = (item: RabeItem) => (by === 'harness' ? item.kind : (modelOf(item) ?? ''))
  const titleOf = (key: string) =>
    by === 'harness'
      ? key === 'codex'
        ? 'Codex'
        : 'Claude Code'
      : key
        ? key.replace(/^claude-/, '')
        : 'model n/a'
  const rows: GroupRow[] = [...spendBy(workers, keyOf)].map(([key, sum]) => ({
    id: `by:${by}:${key || 'n/a'}`,
    title: titleOf(key),
    tokens: sum.known ? sum.input + sum.output : -1,
    isPartial: sum.known > 0 && sum.unknown > 0,
    costUsd: sum.usd,
    count: sum.known + sum.unknown,
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
