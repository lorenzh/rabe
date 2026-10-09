import { expect, test } from 'claude-code/testing'

import { cell, lines } from '../cells/grid'
import { C, CHIP, DEFAULT } from '../cells/palette'
import { ALL, babysit, dev, explore, gridOf, NOW } from '../fixtures'
import { NO_SELECTION, type Size } from '../view'
import { bandView } from './band'

const SIZE: Size = { columns: 100, rows: 10, surface: 'terminal', hasInput: false }
const model = (items = ALL) => ({ items, turns: {}, lines: {}, now: NOW })

// The column where `text` starts in row `y`: every cell holds one character.
const at = (shown: string[], y: number, text: string) => shown[y]?.indexOf(text) ?? -1

test('each band row starts with a chip in its kind colors, padded to the longest label', () => {
  const { grid } = gridOf(bandView(model(), SIZE, NO_SELECTION))
  const shown = lines(grid)
  expect(grid.columns).toBe(100)
  expect(grid.rows).toBe(8)
  expect(shown[1]).toBe(' ◐ claude 2    Explore verifyToken 1m · verify:db.ts 40s')
  expect(shown[3]).toBe(' ⧉ workflow 1  review-changes · Verify 2/3 · 2 agents')
  expect(cell(grid, 0, 1).slice(1)).toEqual([CHIP.agent.fg, CHIP.agent.bg])
  expect(cell(grid, 13, 1).slice(1)).toEqual([CHIP.agent.fg, CHIP.agent.bg])
  expect(cell(grid, 14, 1)[2]).toBe(DEFAULT)
  expect(cell(grid, 0, 0).slice(1)).toEqual([CHIP.failed.fg, CHIP.failed.bg])
})

test('names are plain, times dim, ports blue and the next cron run bright', () => {
  const { grid } = gridOf(bandView(model([explore, dev, babysit]), SIZE, NO_SELECTION))
  const shown = lines(grid)
  expect(shown[0]).toBe(' ◐ claude 1  Explore verifyToken 1m')
  expect(cell(grid, at(shown, 0, 'Explore'), 0)[1]).toBe(DEFAULT)
  expect(cell(grid, at(shown, 0, '1m'), 0)[1]).toBe(C.dim)
  expect(cell(grid, at(shown, 1, ':5173'), 1)[1]).toBe(C.blue)
  expect(shown[2]).toBe(' ⟳ cron 1    /babysit-prs · next 3:00')
  expect(cell(grid, at(shown, 2, 'next'), 2)[1]).toBe(C.dim)
  expect(cell(grid, at(shown, 2, '3:00'), 2)[1]).toBe(C.bright)
})

test('the cost row puts the dollar amount first and bright, the rest dim', () => {
  const { grid } = gridOf(bandView(model(), SIZE, NO_SELECTION))
  const shown = lines(grid)
  expect(shown[7]).toBe(' $ cost        ≈ $0.25 · 91k tok · top: Explore verifyToken 41k')
  expect(cell(grid, at(shown, 7, '≈'), 7)[1]).toBe(C.bright)
  expect(cell(grid, at(shown, 7, '91k'), 7)[1]).toBe(C.dim)
})

test('the cost row shows the session cost when Rabe knows it', () => {
  const shown = lines(gridOf(bandView({ ...model(), usd: 0.41 }, SIZE, NO_SELECTION)).grid)
  expect(shown[7]).toBe(' $ cost        ≈ $0.41 · 91k tok · top: Explore verifyToken 41k')
})

test('a band taller than maxRows becomes one line of count chips, failed first', () => {
  const { grid } = gridOf(bandView(model(), { ...SIZE, columns: 120, rows: 3 }, NO_SELECTION))
  const shown = lines(grid)
  expect(grid.rows).toBe(1)
  expect(shown[0]).toBe(
    ' ✗ 1 failed   ◐ 2 claude   ◐ 1 codex   ⧉ 1 workflow   ▶ 1 shell   ◉ 1 monitor   ⟳ 1 cron  ≈ $0.25 · 91k tok',
  )
  expect(cell(grid, at(shown, 0, '▶'), 0).slice(1)).toEqual([CHIP.shell.fg, CHIP.shell.bg])
  expect(cell(grid, at(shown, 0, '≈'), 0)[1]).toBe(C.bright)
})
