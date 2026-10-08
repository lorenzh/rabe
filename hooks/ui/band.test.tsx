import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { RabeItem } from '../model'
import { ALL, dev, NOW, screen } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const

const BAND = {
  plugin: 'rabe',
  component: 'AbovePrompt',
  requestId: 'band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

function holdItems(on: On, items: RabeItem[]) {
  mock.clock(on, { now: NOW })
  on('state.get', async (_$, e, next) =>
    e.plugin === 'rabe' && e.key === 'items' ? { value: { value: items, version: 1 } } : next(e),
  )
}

test('the band draws nothing while nothing runs on every surface', async ($, on) => {
  holdItems(on, [{ ...dev, status: 'done', endedAt: NOW }])
  on('ui.render', { component: 'AbovePrompt' }, async () => ({
    type: 'Box',
    props: { key: 'engine' },
  }))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...BAND } as never)
    expect(await ui.find({ key: 'engine' })).toBeDefined()
    expect(await screen(ui)).toEqual([])
    await ui.unmount()
  }
})

test('the band draws one row per kind, failed first, then the cost on every surface', async ($, on) => {
  holdItems(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...BAND } as never)
    const shown = await screen(ui)
    expect(shown[0]).toMatch(/^ ✗ failed 1 +bun run lint exit 2$/)
    expect(shown).toContain(' ◐ claude 2  Explore verifyToken 1m · verify:db.ts 40s')
    expect(shown).toContain(' ▶ shells 1  bun run dev :5173')
    expect(shown).toContain(' ◉ watch 1   CI run #482')
    expect(shown.at(-1)).toBe(' $ cost      91k tok ≈ $0.25 · top: Explore verifyToken 41k')
    await ui.unmount()
  }
})

test('the band is a Raster exactly as wide as the band body on the terminal', async ($, on) => {
  holdItems(on, ALL)
  const ui = await $.ui.mount({ surface: 'terminal', ...BAND } as never)
  const raster = await ui.find({ type: 'Raster' })
  expect(raster?.props.columns).toBe(120)
  expect(raster?.props.rows).toBe(8)
  await ui.unmount()
})

test('a narrow band, as beside an open pane, draws no empty line on every surface', async ($, on) => {
  holdItems(on, ALL)
  for (const surface of SURFACES) {
    const props = { ...BAND.props, bodyColumns: 24 }
    const ui = await $.ui.mount({ surface, ...BAND, props } as never)
    const shown = await screen(ui)
    expect(shown.length).toBeGreaterThan(0)
    for (const line of shown) {
      expect(line.trim()).not.toBe('')
      expect(line.length).toBeLessThanOrEqual(24)
    }
    await ui.unmount()
  }
})

test('a short band collapses to one line on every surface', async ($, on) => {
  holdItems(on, ALL)
  for (const surface of SURFACES) {
    const props = { ...BAND.props, maxRows: 3 }
    const ui = await $.ui.mount({ surface, ...BAND, props } as never)
    const shown = await screen(ui)
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatch(/^◐ 3 agents \(2 claude, 1 codex\) · ▶ 1 shell · ✗ 1 failed/)
    await ui.unmount()
  }
})
