import type { RabeDiff } from '../types'
import { pathKey } from './model'

export const MAX_DIFF_LINES = 200
export const MAX_DIFF_UNITS = 8192
export const MAX_TOTAL_UNITS = 262144
// Diffs kept per editor; the same limit as its edits.
const MAX_PER_EDITOR = 100

type Counted = Pick<RabeDiff, 'lines' | 'added' | 'removed' | 'hunks' | 'isTruncated'>

// The first lines of `all` within the line and unit limits. Units count a line
// break per line; the last line that fits is cut.
function bounded(all: string[]): Pick<RabeDiff, 'lines' | 'isTruncated'> {
  const lines: string[] = []
  let units = 0
  for (const line of all) {
    const room = MAX_DIFF_UNITS - units - 1
    if (lines.length >= MAX_DIFF_LINES || room <= 0) return { lines, isTruncated: true }
    const kept = line.length > room ? line.slice(0, room) : line
    lines.push(kept)
    units += kept.length + 1
    if (kept.length < line.length) return { lines, isTruncated: true }
  }

  return { lines }
}

function done(path: string, at: number, counted: Counted, note?: RabeDiff['note']): RabeDiff {
  return { path, at, ...counted, ...(note && { note }) }
}

const isHunk = (value: unknown): value is { lines: string[] } =>
  typeof value === 'object' &&
  value !== null &&
  Array.isArray((value as { lines?: unknown }).lines) &&
  (value as { lines: unknown[] }).lines.every(line => typeof line === 'string')

// A diff from the hunks of an Edit or Write result or of `bashEditDiff`.
export function fromHunks(path: string, at: number, hunks: unknown): RabeDiff | undefined {
  if (!Array.isArray(hunks) || !hunks.every(isHunk)) return undefined
  const all: string[] = []
  let added = 0
  let removed = 0
  for (const hunk of hunks as {
    oldStart?: number
    oldLines?: number
    newStart?: number
    newLines?: number
    lines: string[]
  }[]) {
    all.push(
      `@@ -${hunk.oldStart ?? 0},${hunk.oldLines ?? 0} +${hunk.newStart ?? 0},${hunk.newLines ?? 0} @@`,
    )
    for (const line of hunk.lines) {
      all.push(line)
      if (line.startsWith('+')) added += 1
      else if (line.startsWith('-')) removed += 1
    }
  }

  return done(path, at, { ...bounded(all), added, removed, hunks: hunks.length })
}

// A new file: the content as added lines.
export function fromContent(path: string, at: number, content: string): RabeDiff {
  const rows = content === '' ? [] : content.replace(/\r?\n$/, '').split(/\r?\n/)
  const head = `@@ -0,0 +1,${rows.length} @@`

  return done(path, at, {
    ...bounded([head, ...rows.map(row => `+${row}`)]),
    added: rows.length,
    removed: 0,
    hunks: 1,
  })
}

// A Codex `unified_diff`: its `---` and `+++` file headers are left out.
export function fromUnified(path: string, at: number, text: string): RabeDiff {
  const all: string[] = []
  let added = 0
  let removed = 0
  let hunks = 0
  let inHunk = false
  for (const line of text.replace(/\r?\n$/, '').split(/\r?\n/)) {
    if (line.startsWith('@@')) {
      inHunk = true
      hunks += 1
    } else if (!inHunk) continue
    else if (line.startsWith('+')) added += 1
    else if (line.startsWith('-')) removed += 1
    all.push(line)
  }

  return done(path, at, { ...bounded(all), added, removed, hunks })
}

// The diff an Edit or Write result carries; none when it has no usable shape.
export function fromToolResult(path: string, at: number, result: unknown): RabeDiff | undefined {
  if (typeof result !== 'object' || result === null) return undefined
  const one = result as {
    type?: unknown
    content?: unknown
    originalFile?: unknown
    structuredPatch?: unknown
  }
  if (one.type === 'create' && typeof one.content === 'string') {
    return fromContent(path, at, one.content)
  }
  const patch = fromHunks(path, at, one.structuredPatch)
  if (!patch || patch.hunks > 0) return patch
  // An empty patch: too large to diff (no original), else nothing changed.
  const note = one.originalFile === null ? 'too-large' : 'unchanged'

  return { ...patch, note }
}

const units = (diff: RabeDiff) => diff.lines.reduce((sum, line) => sum + line.length + 1, 0)

// The diffs of every editor after `added` joined `editor`'s list: an operation
// already there (same path and time) is not added twice, each list keeps its
// newest, and the oldest diffs over the total limit lose their lines (the
// entry stays, marked `isEvicted`).
export function keep(
  all: Record<string, RabeDiff[]>,
  editor: string,
  added: RabeDiff[],
): Record<string, RabeDiff[]> {
  const own = all[editor] ?? []
  const fresh = added.filter(
    one => !own.some(old => old.at === one.at && pathKey(old.path) === pathKey(one.path)),
  )
  if (fresh.length === 0) return all
  const next = { ...all, [editor]: [...own, ...fresh].slice(-MAX_PER_EDITOR) }
  const entries = Object.entries(next).flatMap(([id, list]) =>
    list.map((diff, index) => ({ id, index, diff })),
  )
  let total = entries.reduce((sum, one) => sum + units(one.diff), 0)
  if (total <= MAX_TOTAL_UNITS) return next
  for (const { id, index, diff } of entries.toSorted((a, b) => a.diff.at - b.diff.at)) {
    if (total <= MAX_TOTAL_UNITS) break
    if (diff.lines.length === 0) continue
    total -= units(diff)
    const list = [...(next[id] as RabeDiff[])]
    list[index] = { ...diff, lines: [], isEvicted: true }
    next[id] = list
  }

  return next
}

// The latest diff of `path` that `editor` recorded at time `at`.
export function recorded(
  all: Record<string, RabeDiff[]> | undefined,
  editor: string,
  path: string,
  at: number,
): RabeDiff | undefined {
  return all?.[editor]?.findLast(one => one.at === at && pathKey(one.path) === pathKey(path))
}
