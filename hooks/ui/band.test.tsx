import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { RabeItem } from '../model'
import { ALL, dev, NOW } from './fixtures'

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
    expect(await ui.findAll({ type: 'Text' })).toHaveLength(0)
    await ui.unmount()
  }
})

test('the band draws one row per kind with names and times on every surface', async ($, on) => {
  holdItems(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...BAND } as never)
    expect(await ui.find({ type: 'Text', text: 'claude 2' })).toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: 'Explore verifyToken 1m · verify:db.ts 40s' }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'bun run dev :5173' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'failed 1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '91k tok ≈ $0.25' })).toBeDefined()
    await ui.unmount()
  }
})

test('a short band collapses to one line on every surface', async ($, on) => {
  holdItems(on, ALL)
  for (const surface of SURFACES) {
    const props = { ...BAND.props, maxRows: 3 }
    const ui = await $.ui.mount({ surface, ...BAND, props } as never)
    expect(
      await ui.find({ type: 'Text', text: '◐ 3 agents (2 claude, 1 codex) · ▶ 1 shell' }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'claude 2' })).toBeUndefined()
    await ui.unmount()
  }
})
