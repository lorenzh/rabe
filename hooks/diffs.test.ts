import { expect, test } from 'claude-code/testing'

import {
  fromContent,
  fromHunks,
  fromToolResult,
  fromUnified,
  keep,
  MAX_DIFF_LINES,
  MAX_DIFF_UNITS,
  MAX_TOTAL_UNITS,
  recorded,
} from './diffs'

const hunk = { oldStart: 1, oldLines: 2, newStart: 1, newLines: 2, lines: [' a', '-b', '+c'] }

test('hunks count added and removed lines and keep their headers', () => {
  const diff = fromHunks('/r/a.ts', 5, [hunk, hunk])
  expect(diff).toMatchObject({ added: 2, removed: 2, hunks: 2, at: 5 })
  expect(diff?.lines[0]).toBe('@@ -1,2 +1,2 @@')
  expect(fromHunks('/r/a.ts', 5, 'x')).toBeUndefined()
})

test('a diff is cut at 200 lines and 8192 code units and says so', () => {
  const many = fromContent('/r/a', 1, Array.from({ length: 500 }, () => 'x').join('\n'))
  expect(many.lines).toHaveLength(MAX_DIFF_LINES)
  expect(many.isTruncated).toBe(true)
  expect(many.added).toBe(500)
  const wide = fromContent('/r/a', 1, `${'y'.repeat(20000)}\nz`)
  const size = wide.lines.reduce((n, line) => n + line.length + 1, 0)
  expect(size).toBeLessThanOrEqual(MAX_DIFF_UNITS)
  expect(wide.isTruncated).toBe(true)
  expect(fromContent('/r/a', 1, 'a\nb\n').isTruncated).toBeUndefined()
})

test('an empty Write patch is too large without an original, else unchanged', () => {
  const none = { type: 'update', structuredPatch: [], originalFile: null }
  expect(fromToolResult('/r/a', 1, none)?.note).toBe('too-large')
  expect(fromToolResult('/r/a', 1, { ...none, originalFile: 'x' })?.note).toBe('unchanged')
  const made = fromToolResult('/r/a', 1, { type: 'create', content: 'a\nb', structuredPatch: [] })
  expect(made).toMatchObject({ added: 2, removed: 0 })
})

test('a unified diff drops its file headers', () => {
  const diff = fromUnified('/r/a', 1, '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n')
  expect(diff.lines).toEqual(['@@ -1 +1 @@', '-a', '+b'])
  expect(diff).toMatchObject({ added: 1, removed: 1, hunks: 1 })
})

test('keep skips a repeated operation and evicts the oldest over the total limit', () => {
  const big = (at: number) => fromContent('/r/f', at, `${'q'.repeat(3000)}\n`.repeat(2))
  let all: Record<string, ReturnType<typeof big>[]> = {}
  all = keep(all, 'main', [big(1)])
  expect(keep(all, 'main', [big(1)])).toBe(all)
  for (let at = 2; at <= 45; at += 1) all = keep(all, 'main', [big(at)])
  const list = all.main ?? []
  const total = list.reduce((n, d) => n + d.lines.reduce((m, l) => m + l.length + 1, 0), 0)
  expect(total).toBeLessThanOrEqual(MAX_TOTAL_UNITS)
  expect(list[0]).toMatchObject({ isEvicted: true, lines: [], at: 1 })
  expect(list.at(-1)?.isEvicted).toBeUndefined()
  expect(recorded(all, 'main', '/r/f', 45)?.at).toBe(45)
  expect(recorded(all, 'main', '/r/f', 999)).toBeUndefined()
})
