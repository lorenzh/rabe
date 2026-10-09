import { expect, test } from 'claude-code/testing'

import type { RabeItem } from '../../model'
import { cell, lines } from '../cells/grid'
import { C, CHIP } from '../cells/palette'
import { ALL, ci, dev, explore, flow, gridOf, NOW, verify } from '../fixtures'
import { NO_SELECTION, type Size } from '../view'
import { bandView } from './band'

const SIZE: Size = { columns: 100, rows: 10, surface: 'terminal', hasInput: false }
const model = (items = ALL) => ({ items, turns: {}, lines: {}, now: NOW })

// The column where `text` starts in row `y`: every cell holds one character.
const at = (shown: string[], y: number, text: string) => shown[y]?.indexOf(text) ?? -1

test('the band is one line of count chips under an empty row, failed first', () => {
  const { grid } = gridOf(bandView(model(), { ...SIZE, columns: 120 }, NO_SELECTION))
  const shown = lines(grid)
  expect(grid.rows).toBe(2)
  expect(shown[0]?.trim()).toBe('')
  expect(shown[1]).toBe(
    ' ✗ 1 failed   ◐ 2 claude   ◐ 1 codex   ⧉ 1 workflow   ▶ 1 shell   ◉ 1 monitor   ⟳ 1 cron  ≈ $0.25 · 91k tok',
  )
  expect(cell(grid, at(shown, 1, '▶'), 1).slice(1)).toEqual([CHIP.shell.fg, CHIP.shell.bg])
  expect(cell(grid, at(shown, 1, '≈'), 1)[1]).toBe(C.bright)
  expect(cell(grid, at(shown, 1, '91k'), 1)[1]).toBe(C.dim)
})

test('the band drops the empty row when maxRows leaves room for one row only', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const [rows, drawn] of [
      [1, 1],
      [2, 2],
      [3, 2],
    ] as const) {
      const { grid } = gridOf(
        bandView(model(), { ...SIZE, columns: 120, rows, surface }, NO_SELECTION),
      )
      const shown = lines(grid)
      expect(grid.rows).toBe(drawn)
      expect(shown.at(-1)).toContain('◐ 2 claude')
      expect(shown.at(-1)).toContain('≈ $0.25')
    }
  }
})

test('the band shows the session cost when Rabe knows it', () => {
  const shown = lines(
    gridOf(bandView({ ...model(), usd: 0.41 }, { ...SIZE, columns: 120 }, NO_SELECTION)).grid,
  )
  expect(shown[1]).toContain('≈ $0.41 · 91k tok')
})

test('shells and monitors an agent started count with the others', () => {
  const mine = {
    ...dev,
    id: 'shell:m',
    title: 'bun test',
    parentId: explore.id,
    detail: { command: 'bun test' },
  } as RabeItem
  const theirs = { ...ci, id: 'monitor:w', title: 'tail build.log', parentId: verify.id }
  const items = [mine, dev, theirs, ci, explore, verify, flow]
  const shown = lines(gridOf(bandView(model(items), SIZE, NO_SELECTION)).grid)
  expect(shown[1]).toContain('▶ 2 shells   ◉ 2 monitors')
})
