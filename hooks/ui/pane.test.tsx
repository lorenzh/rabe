import type { On } from 'claude-code'
import { expect, type Mounted, mock, test } from 'claude-code/testing'

import type { RabeLines, RabeTurn } from '../../types'
import type { RabeItem } from '../model'
import { ALL, babysit, dev, explore, flow, lint, NOW, review, screen } from './fixtures'

const SURFACES = ['terminal', 'desktop'] as const

const PROPS = {
  title: 'Rabe',
  isFocused: true,
  bodyColumns: 80,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

const PANE = { plugin: 'rabe', component: 'Pane', requestId: 'rabe', props: PROPS } as const
const WIDE = { ...PANE, props: { ...PROPS, bodyColumns: 140, placement: 'dock' } } as const

const TURNS: Record<string, RabeTurn[]> = {
  [explore.id]: [
    {
      index: 1,
      at: NOW - 30_000,
      text: 'Searching the middleware.',
      tools: [{ name: 'Grep', summary: 'verifyToken' }],
    },
  ],
}

const LINES: Record<string, RabeLines> = {
  [lint.id]: {
    seen: 2,
    lines: [
      { at: NOW - 125_000, text: 'pkg/auth/verify.ts' },
      { at: NOW - 125_000, text: ' 42:5 error Unexpected any' },
    ],
  },
}

type Ui = Record<string, unknown>

// Answers the sources' keys and the seeded UI keys; the kit keeps the rest, so
// a press redraws. Returns what the pane wrote.
function hold(on: On, items: RabeItem[], seeds: Ui = {}): Ui {
  mock.clock(on, { now: NOW })
  const fixed: Ui = { items, turns: TURNS, lines: LINES }
  const sets: Ui = {}
  on('state.get', async (_$, e, next) => {
    if (e.plugin !== 'rabe') return next(e)
    if (e.key in fixed) return { value: { value: fixed[e.key], version: 1 } } as never
    if (e.key in seeds && !(e.key in sets)) {
      return { value: { value: seeds[e.key], version: 1 } } as never
    }
    return next(e)
  })
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'rabe') sets[e.key] = e.value
    return next(e)
  })
  on('ui.toast', async () => ({ value: undefined }))

  return sets
}

test('/rabe opens the pane so that Esc closes it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('state.get', async () => ({ value: { value: undefined, version: 0 } }))
  const opens: unknown[] = []
  on('ui.open', async (_$, e) => {
    opens.push(e)
    return { value: { isPlaced: true as const } }
  })
  await $.command.run({ command: 'rabe', args: '' } as never)
  await clock.advance(2000)
  expect(opens).toHaveLength(2)
  for (const one of opens) expect(one).toMatchObject({ id: 'rabe', closeOnEscape: true })
})

test('the pane shows the tabs and the empty state on every surface', async ($, on) => {
  hold(on, [])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      surface,
      ...PANE,
      props: { ...PROPS, isFocused: false },
    } as never)
    const shown = await screen(ui)
    expect(shown[0]).toMatch(/^ Items 0 {3}Cost {3}Effects {3}Timeline +1-4 switch$/)
    expect(shown).toContain(' Nothing runs in the background.')
    expect(shown).toContain(' tab to select · esc close')
    expect(await ui.find({ type: 'Button', key: 'tab-cost' })).toBeDefined()
    await ui.unmount()
  }
})

test('the pane is a Raster as wide as the body and leaves room for its Buttons', async ($, on) => {
  hold(on, ALL)
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE } as never)
  const raster = await ui.find({ type: 'Raster' })
  expect(raster?.props.columns).toBe(80)
  expect(Number(raster?.props.rows)).toBeLessThan(30)
  expect(Number(raster?.props.rows)).toBeGreaterThan(20)
  await ui.unmount()
})

test('the items tab groups items, failed first, with status words on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const shown = (await screen(ui)).map(line => line.trim())
    expect(shown).toContain('▾ FAILED 1')
    expect(shown).toContain('▾ AGENTS 6  4 claude · 1 codex · 1 workflow')
    expect(shown.some(line => /^▌?✗ bun run lint exit 2 +failed 2m ago$/.test(line))).toBe(true)
    expect(shown.some(line => /^▶ bun run dev :5173 +≥ 40m$/.test(line))).toBe(true)
    expect(shown).toContain('j/k move · enter open · 1-4 switch · esc close')
    await ui.unmount()
  }
})

test('j moves the selection and enter opens the selected item on every surface', async ($, on) => {
  const state = hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const before = state.selected
    await ui.press({ key: 'down' })
    expect(state.selected).toBeDefined()
    expect(state.selected).not.toBe(before)
    expect((await ui.find({ type: 'Button', key: 'open' }))?.props.autoFocus).toBe(true)
    await ui.press({ key: 'open' })
    expect(state.open).toBe(state.selected)
    await ui.press({ key: 'back' })
    expect(state.open).toBe('')
    await ui.unmount()
  }
})

test('a shell shows the lines its source read on every surface', async ($, on) => {
  hold(on, ALL, { open: lint.id })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const shown = await screen(ui)
    expect(shown.some(line => /^✗ shell · bun run lint +failed · exit 2$/.test(line))).toBe(true)
    expect(shown).toContain(' 42:5 error Unexpected any')
    expect(shown).toContain(' b back · esc close')
    expect((await ui.find({ type: 'Button', key: 'copy' }))?.props.label).toBe('c: copy command')
    await ui.unmount()
  }
})

test('a shell without lines says its output is n/a on every surface', async ($, on) => {
  hold(on, ALL, { open: dev.id })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const shown = await screen(ui)
    expect(shown).toContain('Output n/a: no line read yet.')
    expect(shown).toContain('started before Rabe loaded · start time not known')
    await ui.unmount()
  }
})

test('an agent shows its turns from rabe.turns on every surface', async ($, on) => {
  hold(on, ALL, { open: explore.id })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const shown = await screen(ui)
    expect(shown).toContain('1 ● Searching the middleware.')
    expect(shown).toContain('   ⎿ Grep verifyToken')
    expect(await ui.find({ type: 'Button', key: 'message-agent' })).toBeDefined()
    expect(await ui.find({ type: 'Input', key: 'message' })).toBeDefined()
    await ui.unmount()
  }
})

test('a codex job shows its steps from the item on every surface', async ($, on) => {
  hold(on, ALL, { open: review.id })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const shown = await screen(ui)
    expect(shown).toContain('  Review middleware/auth.ts for token-expiry bugs.')
    expect(shown).toContain('◆ Reading the diff.')
    expect(shown).toContain('  thinking: Diff first.')
    expect(shown.some(line => /^ {2}\$ git diff +✓ exit 0 · 1 lines$/.test(line))).toBe(true)
    await ui.unmount()
  }
})

test('a workflow lists its agents by phase on every surface', async ($, on) => {
  hold(on, ALL, { open: flow.id })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const shown = await screen(ui)
    expect(shown).toContain('✓ Review → ◐ Verify → · Report')
    expect(shown).toContain('VERIFY 1 running')
    expect(shown).toContain('REPORT not started')
    expect((await ui.find({ type: 'Button', key: 'stop' }))?.props.label).toBe('g: stop run')
    await ui.unmount()
  }
})

test('stop calls TaskStop with the task id on every surface', async ($, on) => {
  hold(on, ALL, { selected: dev.id })
  const stopped: unknown[] = []
  on('tool.call', async (_$, e, next) => {
    if (e.tool !== 'TaskStop') return next(e)
    stopped.push(e.task_id)
    return { result: {}, text: 'stopped' }
  })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: 'stop' })
    await ui.unmount()
  }
  expect(stopped).toEqual(['bg_2', 'bg_2'])
})

test('a wide terminal pane shows the selected item beside the list', async ($, on) => {
  hold(on, ALL, { selected: review.id })
  const ui = await $.ui.mount({ surface: 'terminal', ...WIDE } as never)
  const shown = await screen(ui)
  expect(shown.some(line => /│ ◐ codex · review auth\.ts +running$/.test(line))).toBe(true)
  expect(shown.some(line => /│ ◆ Reading the diff\.$/.test(line))).toBe(true)
  await ui.unmount()
})

test('a narrow pane, and the desktop, put a one-line summary under the list', async ($, on) => {
  hold(on, ALL, { selected: review.id })
  for (const [surface, props] of [
    ['terminal', PROPS],
    ['desktop', WIDE.props],
  ] as const) {
    const ui = await $.ui.mount({ surface, ...PANE, props } as never)
    const shown = await screen(ui)
    expect(shown).toContain(
      ' review auth.ts · model gpt-6.1-sol · effort high · job task-1 · ◐ running',
    )
    await ui.unmount()
  }
})

test('the search narrows the list on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui: Mounted<typeof surface> = await $.ui.mount({ surface, ...PANE } as never)
    await ui.input({ key: 'search', text: 'verify', kind: 'change' })
    const shown = (await screen(ui)).join('\n')
    expect(shown).toContain('Explore verifyToken')
    expect(shown).not.toContain('bun run dev')
    await ui.input({ key: 'search', text: '' })
    await ui.unmount()
  }
})

test('on the desktop rows are Buttons: a group header folds, an item opens', async ($, on) => {
  const state = hold(on, ALL)
  const ui = await $.ui.mount({ surface: 'desktop', ...PANE } as never)
  await ui.press({ key: 'group-shells' })
  expect(await ui.find({ type: 'Button', text: '▸ SHELLS 1  1 running' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: `row:${dev.id}` })).toBeUndefined()
  await ui.press({ key: `row:${explore.id}` })
  expect(state.open).toBe(explore.id)
  await ui.unmount()
})

test('cost, effects and timeline tabs draw their sections on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: 'tab-cost' })
    let shown = await screen(ui)
    expect(shown).toContain('session total ≈ $0.25')
    expect(shown.some(line => /^◐ claude Explore verifyToken +41k +\$0\.16$/.test(line))).toBe(true)
    await ui.press({ key: 'tab-effects' })
    shown = await screen(ui)
    expect(shown).toContain('WORKTREES 1')
    expect(shown.some(line => /1 agent shares the main tree/.test(line))).toBe(true)
    expect(shown).toContain(':5173 bun run dev')
    expect((await ui.find({ type: 'Button', key: 'port-5173' }))?.props.hotkey).toBe('c')
    await ui.press({ key: 'tab-timeline' })
    shown = await screen(ui)
    expect(shown).toContain('WHEN DID THINGS RUN?')
    expect(shown.some(line => /└─ ⧉ workflow review-changes/.test(line))).toBe(true)
    await ui.press({ key: 'tab-items' })
    await ui.unmount()
  }
})

const wakeup: RabeItem = {
  id: 'cron:wakeup-1',
  kind: 'cron',
  title: 'autonomous loop',
  status: 'running',
  seenAt: NOW,
  detail: { jobId: 'wakeup-1', prompt: 'x', scheduledFor: NOW + 60_000 },
}

test('a /loop wakeup offers copy but no delete on every surface', async ($, on) => {
  hold(on, [wakeup, babysit], { open: wakeup.id })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    expect((await ui.find({ type: 'Button', key: 'copy' }))?.props.label).toBe('c: copy prompt')
    expect(await ui.find({ type: 'Button', key: 'delete' })).toBeUndefined()
    await ui.unmount()
  }
})

test('a cron job offers delete on every surface', async ($, on) => {
  hold(on, [wakeup, babysit], { open: babysit.id })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    expect(await ui.find({ type: 'Button', key: 'delete' })).toBeDefined()
    await ui.unmount()
  }
})

test('moving the focus onto a desktop row selects it', async ($, on) => {
  const state = hold(on, ALL)
  on('ui.focus', async () => ({}))
  const ui = await $.ui.mount({ surface: 'desktop', ...PANE } as never)
  await $.ui.focus({
    component: 'Pane',
    requestId: 'rabe',
    plugin: 'rabe',
    element: `row:${dev.id}`,
    origin: { kind: 'person' },
  })
  expect(state.selected).toBe(dev.id)
  await ui.unmount()
})
