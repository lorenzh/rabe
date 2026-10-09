import { expect, test } from 'claude-code/testing'

import { cell, lines } from '../cells/grid'
import { C, DEFAULT } from '../cells/palette'
import { ALL, babysit, dev, explore, lint, NOW } from '../fixtures'
import { NO_SELECTION, type Size } from '../view'
import { itemsView } from './items'

const WIDE: Size = { columns: 100, rows: 24, surface: 'terminal', hasInput: true }
const NARROW: Size = { ...WIDE, columns: 80, rows: 12 }
const DESKTOP: Size = { ...WIDE, surface: 'desktop' }
const model = { items: ALL, turns: {}, lines: {}, now: NOW }

const at = (shown: string[], y: number, text: string) => shown[y]?.indexOf(text) ?? -1
const keys = (buttons: { key: string; label: string }[]) => buttons.map(one => one.label)

test('at 90 columns and more the list and the selected item sit side by side', () => {
  const { grid } = itemsView(model, WIDE, NO_SELECTION)
  const shown = lines(grid)
  expect(grid.columns).toBe(100)
  expect(shown[0]).toMatch(/^▾ FAILED 1 +│ ✗ shell · bun run lint/)
  expect(shown[0]?.[42]).toBe('│')
  expect(shown[1]).toMatch(/^▌✗ bun run lint exit 2 +failed 2m ago │ command bun run lint$/)
  expect(shown[2]?.slice(0, 42).trim()).toBe('')
  expect(shown[3]?.startsWith('▾ AGENTS 4 claude · 1 codex · 1 workflow')).toBe(true)
  expect(cell(grid, 0, 3)[1]).toBe(C.orange)
  expect(cell(grid, at(shown, 3, '4 claude'), 3)[1]).toBe(C.dim)
})

test('the selected row has a marker, a background and a bright name; others stay plain', () => {
  const { grid } = itemsView(model, WIDE, { ...NO_SELECTION, selected: dev.id })
  const shown = lines(grid)
  const y = shown.findIndex(line => line.startsWith('▌▶ bun run dev :5173'))
  expect(cell(grid, 0, y)).toEqual(['▌'.codePointAt(0), C.orange, C.selected])
  expect(cell(grid, 3, y).slice(1)).toEqual([C.bright, C.selected])
  expect(cell(grid, at(shown, y, ':5173'), y)[1]).toBe(C.blue)
  expect(cell(grid, at(shown, y, '≥ 40m'), y)[1]).toBe(DEFAULT)
  const other = shown.findIndex(line => line.startsWith(' ◐ verify:db.ts'))
  expect(cell(grid, 3, other).slice(1)).toEqual([DEFAULT, DEFAULT])
  expect(cell(grid, at(shown, other, '40s'), other)[1]).toBe(C.dim)
})

test('the wide list Buttons name their keys, open has the focus and stop shows for a running item', () => {
  const { buttons } = itemsView(model, WIDE, { ...NO_SELECTION, selected: explore.id })
  expect(keys(buttons)).toEqual([
    'j: down',
    'k: up',
    'open',
    'x: stop',
    'g: stop group',
    's: search',
  ])
  expect(buttons.find(one => one.key === 'open')?.autoFocus).toBe(true)
  expect(buttons.map(one => one.hotkey)).toEqual(['j', 'k', undefined, 'x', 'g', 's'])
})

test('j and k stay bound at the ends of the list, so the keys never fall through to the prompt', () => {
  const last = itemsView(model, WIDE, { ...NO_SELECTION, selected: babysit.id })
  expect(last.buttons.find(one => one.key === 'down')?.action).toEqual({
    type: 'select',
    id: babysit.id,
  })
  const first = itemsView(model, WIDE, { ...NO_SELECTION, selected: lint.id })
  expect(first.buttons.find(one => one.key === 'up')?.action).toEqual({
    type: 'select',
    id: lint.id,
  })
})

test('below 90 columns the list fills the width, drops the gaps and ends with one summary line', () => {
  const { grid, buttons } = itemsView(model, NARROW, { ...NO_SELECTION, selected: explore.id })
  const shown = lines(grid)
  expect(grid.rows).toBe(12)
  expect(shown.every(line => !line.includes('│'))).toBe(true)
  expect(shown.slice(0, 10).some(line => line === '')).toBe(false)
  expect(shown[11]).toBe('◐ Explore verifyToken · opus-5-5 · ≈ $0.16 · 36k in · running')
  expect(cell(grid, 0, 11).slice(1)).toEqual([C.yellow, C.panel])
  expect(cell(grid, 79, 11)[2]).toBe(C.panel)
  expect(cell(grid, at(shown, 11, '≈'), 11)[1]).toBe(C.bright)
  expect(keys(buttons)).toEqual(['j', 'k', 'open', 'x: stop', 'g: stop group', 's'])
})

test('below 90 columns a list that fits keeps the gaps between groups', () => {
  const { grid } = itemsView(model, { ...NARROW, rows: 30 }, NO_SELECTION)
  expect(lines(grid)[2]).toBe('')
})

test('off the terminal each row is plain text the renderer turns into a Button', () => {
  const { grid, buttons, rows } = itemsView(model, DESKTOP, NO_SELECTION)
  const shown = lines(grid)
  expect(shown.slice(0, 4)).toEqual([
    'Failed 1',
    '✗ bun run lint · exit 2 · failed 2m ago',
    'Agents 6',
    '◐ verify:db.ts · 40s',
  ])
  expect(shown).toContain('▶ bun run dev · :5173 · ≥ 40m')
  expect(shown).toContain('⟳ /babysit-prs · next 3:00')
  expect(rows?.[0]).toEqual({ key: 'group-failed', action: { type: 'fold', group: 'failed' } })
  expect(rows?.[1]).toEqual({ key: `row:${lint.id}`, action: { type: 'open', id: lint.id } })
  expect(grid.rows).toBe(shown.length)
  expect(shown.at(-1)).toBe('⟳ /babysit-prs · next 3:00')
  expect(buttons.map(one => one.key)).toEqual(['find'])
})

test('a folded group says so off the terminal', () => {
  const { grid } = itemsView(model, DESKTOP, { ...NO_SELECTION, folded: ['failed'] })
  expect(lines(grid).slice(0, 2)).toEqual(['Failed 1 · folded', 'Agents 6'])
})
