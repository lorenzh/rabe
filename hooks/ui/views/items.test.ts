import { expect, test } from 'claude-code/testing'
import type { RabeItem, RabeItemOf } from '../../model'
import { cell, lines } from '../cells/grid'
import { C, DEFAULT } from '../cells/palette'
import { ALL, ci, dev, explore, flow, gridOf, lint, NOW, verify } from '../fixtures'
import { grouped } from '../lists'
import { type Drawn, isPress, NO_SELECTION, rowKeys, type Size } from '../view'
import { itemsView } from './items'

const WIDE: Size = { columns: 100, rows: 24, surface: 'terminal', hasInput: true }
const NARROW: Size = { ...WIDE, columns: 80, rows: 12 }
const DESKTOP: Size = { ...WIDE, surface: 'desktop' }
const model = { items: ALL, turns: {}, lines: {}, now: NOW }

const at = (shown: string[], y: number, text: string) => shown[y]?.indexOf(text) ?? -1
const keys = (buttons: { key: string; label: string }[]) => buttons.map(one => one.label)

test('at 90 columns and more the list and the selected item sit side by side', () => {
  const { grid } = gridOf(itemsView(model, WIDE, NO_SELECTION))
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

test('the selected row has a marker and a background; the other names are dim', () => {
  const { grid } = gridOf(itemsView(model, WIDE, { ...NO_SELECTION, selected: dev.id }))
  const shown = lines(grid)
  const y = shown.findIndex(line => line.startsWith('▌▶ bun run dev :5173'))
  expect(cell(grid, 0, y)).toEqual(['▌'.codePointAt(0), C.orange, C.selected])
  expect(cell(grid, 3, y).slice(1)).toEqual([DEFAULT, C.selected])
  expect(cell(grid, at(shown, y, ':5173'), y)[1]).toBe(C.blue)
  expect(cell(grid, at(shown, y, '≥ 40m'), y)[1]).toBe(DEFAULT)
  const other = shown.findIndex(line => line.startsWith(' ◐ verify:db.ts'))
  expect(cell(grid, 3, other).slice(1)).toEqual([C.dim, DEFAULT])
  expect(cell(grid, at(shown, other, '40s'), other)[1]).toBe(C.dim)
})

const presses = (drawn: Drawn) =>
  drawn.nodes.flatMap(node => ('spans' in node ? node.spans.filter(isPress) : []))

test('each row is a plain Button keyed by its item that opens it; the selected one takes the focus', () => {
  const drawn = itemsView(model, WIDE, { ...NO_SELECTION, selected: explore.id })
  const rows = presses(drawn).filter(one => one.key.startsWith('row:'))
  expect(rows.map(one => one.key)).toContain(`row:${dev.id}`)
  const own = rows.find(one => one.key === `row:${explore.id}`)
  expect(own).toMatchObject({ label: 'Explore verifyToken', autoFocus: true })
  expect(own?.action).toEqual({ type: 'open', id: explore.id })
  expect(own?.dim).toBeUndefined()
  expect(rows.filter(one => one.autoFocus)).toHaveLength(1)
  expect(rows.find(one => one.key === `row:${dev.id}`)?.dim).toBe(true)
  expect(keys(drawn.buttons)).toEqual(['x: stop', 'g: stop group', 's: search'])
  expect(drawn.buttons.map(one => one.hotkey)).toEqual(['x', 'g', 's'])
})

test('a group header is a Button that folds it; with nothing selected the first row has the focus', () => {
  const drawn = itemsView(model, WIDE, NO_SELECTION)
  const list = presses(drawn)
  expect(list[0]).toMatchObject({ key: 'group-failed', label: 'FAILED' })
  expect(list[0]?.action).toEqual({ type: 'fold', group: 'failed' })
  expect(list.find(one => one.autoFocus)?.key).toBe(`row:${lint.id}`)
})

test('the detail beside the list has no Buttons, so the arrows walk the list alone', () => {
  const drawn = itemsView(model, WIDE, { ...NO_SELECTION, selected: flow.id })
  expect(rowKeys(drawn)).toEqual(
    grouped(ALL).flatMap(group => group.items.map(item => `row:${item.id}`)),
  )
})

test('below 90 columns the list fills the width, drops the gaps and ends with one summary line', () => {
  const { grid, buttons } = gridOf(
    itemsView(model, NARROW, { ...NO_SELECTION, selected: explore.id }),
  )
  const shown = lines(grid)
  const end = shown.length - 1
  expect(shown.every(line => !line.includes('│'))).toBe(true)
  expect(shown.slice(0, end).some(line => line === '')).toBe(false)
  expect(shown[end]).toBe('◐ Explore verifyToken · opus-5-5 · ≈ $0.16 · 36k in · running')
  expect(cell(grid, 0, end).slice(1)).toEqual([C.yellow, C.panel])
  expect(cell(grid, 79, end)[2]).toBe(C.panel)
  expect(cell(grid, at(shown, end, '≈'), end)[1]).toBe(C.bright)
  expect(keys(buttons)).toEqual(['x: stop', 'g: stop group', 's'])
})

test('below 90 columns a list that fits keeps the gaps between groups', () => {
  const { grid } = gridOf(itemsView(model, { ...NARROW, rows: 30 }, NO_SELECTION))
  expect(lines(grid)[2]).toBe('')
})

test('the list is never cut: a pane taller than its body scrolls, and the desktop draws the same', () => {
  const short = lines(gridOf(itemsView(model, { ...NARROW, rows: 4 }, NO_SELECTION)).grid)
  expect(short.some(line => line.includes('⟳ /babysit-prs'))).toBe(true)
  const desk = lines(gridOf(itemsView(model, DESKTOP, NO_SELECTION)).grid)
  expect(desk).toEqual(lines(gridOf(itemsView(model, WIDE, NO_SELECTION)).grid))
})

test('a folded group shows its header only', () => {
  const { grid } = gridOf(itemsView(model, NARROW, { ...NO_SELECTION, folded: ['failed'] }))
  expect(lines(grid).slice(0, 2)).toEqual([
    '▸ FAILED 1',
    '▾ AGENTS 4 claude · 1 codex · 1 workflow',
  ])
})

test('a workflow agent stays out of a group stop', () => {
  const other = {
    ...verify,
    id: 'agent:w2',
    title: 'verify:api.ts',
    detail: { agentId: 'w2', workflowPhase: 'Verify' },
  } as RabeItem
  const m = { items: [flow, verify, other, explore], turns: {}, lines: {}, now: NOW }
  const { buttons } = gridOf(itemsView(m, WIDE, { ...NO_SELECTION, selected: explore.id }))
  const group = buttons.find(b => b.key === 'stop-group')?.action
  expect(group).toMatchObject({ type: 'stop' })
  expect(group?.type === 'stop' ? group.ids : []).not.toContain(verify.id)
  expect(group?.type === 'stop' ? group.ids : []).not.toContain(other.id)
})

const mine: RabeItem = {
  ...(dev as RabeItemOf<'shell'>),
  id: 'shell:m',
  title: 'bun test',
  parentId: explore.id,
  detail: { command: 'bun test', taskId: 'm' },
}
const theirs: RabeItem = { ...ci, id: 'monitor:w', title: 'tail build.log', parentId: verify.id }
const lost: RabeItem = {
  ...(dev as RabeItemOf<'shell'>),
  id: 'shell:l',
  title: 'make',
  parentId: 'agent:gone',
  detail: { command: 'make', taskId: 'l' },
}
const families = { ...model, items: [mine, dev, theirs, lost, ci, explore, flow, verify] }

test('shells and monitors of an agent sit indented under a header with its glyph and name', () => {
  const drawn = itemsView(families, { ...NARROW, rows: 40 }, { ...NO_SELECTION, selected: mine.id })
  const { grid } = gridOf(drawn)
  const shown = lines(grid)
  const from = shown.findIndex(line => line.startsWith('▾ SHELLS'))
  expect(shown.slice(from, from + 6).map(line => line.slice(0, 40).trimEnd())).toEqual([
    '▾ SHELLS 3 running',
    ' ▶ bun run dev :5173',
    ' ◐ Explore verifyToken',
    '▌  ▶ bun test',
    ' ◐ agent n/a',
    '   ▶ make',
  ])
  const head = from + 2
  expect(cell(grid, 1, head)[1]).toBe(C.yellow)
  expect(cell(grid, 3, head)[1]).toBe(C.dim)
  expect(shown).toContain(' ◐ review-changes › verify:db.ts')
  expect(rowKeys(drawn).slice(3)).toEqual([
    `row:${dev.id}`,
    `row:${mine.id}`,
    `row:${lost.id}`,
    `row:${ci.id}`,
    `row:${theirs.id}`,
  ])
  expect(presses(drawn).find(one => one.autoFocus)?.key).toBe(`row:${mine.id}`)
})

test('with nothing selected the first row drawn has the focus, also when agents regroup a list', () => {
  const m = { ...model, items: [mine, dev, explore] }
  const drawn = itemsView(m, NARROW, NO_SELECTION)
  expect(presses(drawn).find(one => one.autoFocus)?.key).toBe(rowKeys(drawn)[0])
  const shells = itemsView({ ...model, items: [mine, dev] }, NARROW, NO_SELECTION)
  expect(rowKeys(shells)).toEqual([`row:${dev.id}`, `row:${mine.id}`])
  expect(presses(shells).find(one => one.autoFocus)?.key).toBe(`row:${dev.id}`)
})

test('a workflow agent or a run offers g: stop run on the list', () => {
  for (const selected of [verify.id, flow.id]) {
    const { buttons } = itemsView(model, WIDE, { ...NO_SELECTION, selected })
    const run = buttons.find(one => one.hotkey === 'g')
    expect(run).toMatchObject({ key: 'stop-run', label: 'g: stop run' })
    expect(run?.action).toEqual({ type: 'stop', ids: [flow.id] })
    expect(buttons.find(one => one.hotkey === 'x')).toBeUndefined()
  }
})
