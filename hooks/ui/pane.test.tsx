import type { On, UiFocusInput } from 'claude-code'
import { expect, type Mounted, mock, test } from 'claude-code/testing'

import type { RabeLines, RabePrevious, RabeTurn } from '../../types'
import type { RabeItem, RabeItemOf } from '../model'
import {
  ALL,
  babysit,
  dev,
  explore,
  flow,
  lint,
  NOW,
  plan,
  review,
  screen,
  verify,
} from './fixtures'
import { orderOf, previousOf } from './lists'

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
  on('ui.focus', { requestId: 'rabe' }, async (_$, e, next) =>
    e.origin.kind === 'person' ? {} : next(e),
  )
  on('ui.toast', async (_$, e) => {
    sets.toasts = [...((sets.toasts as string[] | undefined) ?? []), e.text]
    return { value: undefined }
  })

  return sets
}

// The person moves the ring (Tab or an arrow), which arms the pane's stops;
// the list's x and g arm only on a live row.
async function arm(
  $: { ui: { focus: (e: UiFocusInput) => Promise<unknown> } },
  element = 'tab-items',
) {
  await $.ui.focus({
    component: 'Pane',
    requestId: 'rabe',
    plugin: 'rabe',
    element,
    origin: { kind: 'person' },
  })
}

function opening(on: On, isOpen: boolean) {
  on('state.get', async () => ({ value: { value: undefined, version: 0 } }))
  const opens: unknown[] = []
  on('ui.open', async (_$, e) => {
    opens.push(e)
    return { value: { isPlaced: true as const } }
  })
  const pane = { id: 'rabe', title: 'Rabe', isShown: true, isFocused: false, isPlaced: true }
  on('ui.panes', async () => ({ value: isOpen ? [pane] : [] }))

  return opens
}

test('/rabe opens the pane so that Esc closes it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const opens = opening(on, true)
  await $.command.run({ command: 'rabe', args: '' } as never)
  await clock.advance(2000)
  expect(opens).toHaveLength(2)
  for (const one of opens) expect(one).toMatchObject({ id: 'rabe', closeOnEscape: true })
})

test('a pane closed before the focus call stays closed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const opens = opening(on, false)
  await $.command.run({ command: 'rabe', args: '' } as never)
  await clock.advance(2000)
  expect(opens).toHaveLength(1)
})

test('a row gone while the pane is open keeps its slot until /rabe opens it anew', async ($, on) => {
  const other = { ...dev, id: 'shell:other', title: 'other' }
  const items = [dev, other]
  hold(on, items)
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  const draw = async () => {
    const ui = await $.ui.mount({ surface: 'terminal', ...PANE } as never)
    const shown = await screen(ui)
    const slot = await ui.find({ type: 'Button', key: `row:${other.id}` })
    await ui.unmount()
    return { shown, slot }
  }
  await draw()
  items.pop()
  const gone = await draw()
  expect(gone.shown).toContain(' gone other')
  expect(gone.slot?.props).toMatchObject({ label: 'other', dimColor: true })
  await $.command.run({ command: 'rabe', args: '' } as never)
  expect((await draw()).slot).toBeUndefined()
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
    if (surface === 'terminal') expect(shown[0]).toBe(' Items 0  Cost  Effects  Timeline')
    expect(shown).toContain(' Nothing runs in the background.')
    expect(shown).toContain(' tab to select · esc close')
    expect(await ui.find({ type: 'Button', key: 'tab-cost' })).toBeDefined()
    await ui.unmount()
  }
})

test('the tabs are plain Buttons with hotkeys, the same on every surface; a wide pane names the keys', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...WIDE } as never)
    expect((await screen(ui))[0]).toMatch(/^ Items 10 {4}Cost {4}Effects {4}Timeline +1-4 switch$/)
    const items = await ui.find({ type: 'Button', key: 'tab-items' })
    expect(items?.props).toMatchObject({ label: 'Items 10', plain: true, hotkey: '1' })
    expect(items?.props.dimColor).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'tab-cost' }))?.props.dimColor).toBe(true)
    await ui.unmount()
  }
})

test('the pane draws rows of Text and plain Buttons, no Raster, and keeps the hint at the bottom', async ($, on) => {
  hold(on, ALL)
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE } as never)
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  const row = await ui.find({ type: 'Button', key: `row:${dev.id}` })
  expect(row?.props).toMatchObject({ label: 'bun run dev', plain: true, dimColor: true })
  expect(await ui.find({ type: 'Box', key: `line:row:${dev.id}` })).toBeDefined()
  const shown = await screen(ui)
  expect(shown.at(-1)).toBe(' ↑↓ move · enter open · esc close')
  const controls = (await ui.findAll({ type: 'Button' })).filter(one => !one.props.plain)
  expect(shown.slice(2, 2 + controls.length)).toEqual(controls.map(one => one.props.label))
  await ui.unmount()
})

test('the items tab groups items, failed first, with status words, the same on every surface', async ($, on) => {
  hold(on, ALL)
  const seen: string[][] = []
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const shown = (await screen(ui)).map(line => line.trim())
    expect(shown).toContain('▾ FAILED 1')
    expect(shown).toContain('▾ AGENTS 4 claude · 1 codex · 1 workflow')
    expect(shown.some(line => /^▌✗ bun run lint exit 2 +failed 2m ago$/.test(line))).toBe(true)
    expect(shown.some(line => /^▶ bun run dev :5173 +≥ 40m$/.test(line))).toBe(true)
    expect(shown).toContain('↑↓ move · enter open · esc close')
    seen.push(shown)
    await ui.unmount()
  }
  expect(seen[1]).toEqual(seen[0])
})

test('enter on a row opens it, and b goes back to the list', async ($, on) => {
  const state = hold(on, ALL)
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE } as never)
  await ui.press({ key: `row:${dev.id}` })
  expect(state).toMatchObject({ open: dev.id, selected: dev.id, tab: 'items' })
  expect((await ui.find({ type: 'Button', key: 'back' }))?.props.autoFocus).toBe(true)
  await ui.press({ key: 'back' })
  expect(state.open).toBe('')
  await ui.unmount()
})

test('a shell shows the lines its source read on every surface', async ($, on) => {
  hold(on, ALL, { open: lint.id })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const shown = await screen(ui)
    expect(shown.some(line => /^✗ shell · bun run lint +failed · exit 2$/.test(line))).toBe(true)
    expect(shown).toContain(' 42:5 error Unexpected any')
    expect(shown).toContain(' b back · esc close')
    expect((await ui.find({ type: 'Button', key: `copy:${lint.id}` }))?.props.label).toBe(
      'c: copy command',
    )
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
    expect(shown).toContain('1  ● Searching the middleware.')
    expect(shown).toContain('     ⎿ Grep verifyToken')
    expect(await ui.find({ type: 'Button', key: `message-agent:${explore.id}` })).toBeDefined()
    expect(await ui.find({ type: 'Input', key: `message:${explore.id}` })).toBeDefined()
    await ui.unmount()
  }
})

test('a codex job shows its steps from the item on every surface', async ($, on) => {
  hold(on, ALL, { open: review.id })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const shown = await screen(ui)
    expect(shown).toContain('  Review middleware/auth.ts for token-expiry bugs.')
    expect(shown).toContain('● Reading the diff.')
    expect(shown).toContain('  thinking: Diff first.')
    expect(shown.some(line => /^ {2}\$ git diff +✓ exit 0 · 1 line$/.test(line))).toBe(true)
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
    const run = await ui.find({ type: 'Button', key: `stop-run:${flow.id}` })
    expect(run?.props.label).toBe('g: stop run')
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
  await arm($, `row:${dev.id}`)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: 'stop' })
    await ui.unmount()
  }
  expect(stopped).toEqual(['bg_2', 'bg_2'])
})

test('a long list draws every row, and the selected row takes the focus', async ($, on) => {
  const many = Array.from(
    { length: 350 },
    (_, n): RabeItem => ({
      ...(dev as RabeItemOf<'shell'>),
      id: `shell:many${n + 1}`,
      title: `shell ${n + 1}`,
      detail: { command: `shell ${n + 1}`, taskId: `many${n + 1}` },
    }),
  )
  hold(on, many, { selected: 'shell:many350' })
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE } as never)
  const rows = (await ui.findAll({ type: 'Button' })).filter(one => one.key?.startsWith('row:'))
  expect(rows).toHaveLength(350)
  expect(rows.filter(one => one.props.autoFocus).map(one => one.key)).toEqual(['row:shell:many350'])
  await ui.unmount()
})

test('a wide terminal pane shows the selected item beside the list', async ($, on) => {
  hold(on, ALL, { selected: review.id })
  const ui = await $.ui.mount({ surface: 'terminal', ...WIDE } as never)
  const shown = await screen(ui)
  expect(shown.some(line => /│ ◐ codex · review auth\.ts +running$/.test(line))).toBe(true)
  expect(shown.some(line => /│ ● Reading the diff\.$/.test(line))).toBe(true)
  await ui.unmount()
})

test('a narrow pane puts a one-line summary under the list and short key labels', async ($, on) => {
  hold(on, ALL, { selected: review.id })
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE } as never)
  const shown = await screen(ui)
  expect(shown).toContain('◐ review auth.ts · gpt-6.1-sol · ≈ $0.09 · 25k in · running')
  const buttons = (await ui.findAll({ type: 'Button' })).filter(one => !one.props.plain)
  expect(buttons.map(one => one.props.label)).toEqual(['s', 'x: stop', 'g: stop group'])
  await ui.unmount()
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

test('a group header folds on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: 'group-shells' })
    expect((await screen(ui)).map(line => line.trim())).toContain('▸ SHELLS 1 running')
    expect(await ui.find({ type: 'Button', key: `row:${dev.id}` })).toBeUndefined()
    await ui.press({ key: 'group-shells' })
    await ui.unmount()
  }
})

const yesterday = new Date(2026, 9, 7, 17, 40).getTime()
const PREVIOUS: RabePrevious = {
  endedAt: yesterday,
  counts: { agent: 6 },
  tokens: 800_000,
  failed: [],
}

const USAGE = { startedAt: NOW - 3_600_000, context: {}, rateLimits: [], cost: { usd: 0.41 } }

// The session's cost and folder, and a store that holds the previous session.
function session(on: On): Record<string, unknown> {
  const store: Record<string, unknown> = { 'previous:/p': PREVIOUS }
  on('session.usage', async () => ({ value: USAGE }) as never)
  on('session.cwd', async () => ({ value: '/p' }))
  on('session.end', async (_$, e) => ({ sessionId: e.sessionId }))
  on('store.get', async (_$, e) => ({ value: store[e.key] }))
  on('store.set', async (_$, e) => {
    store[e.key] = e.value
    return { value: undefined }
  })

  return store
}

test('cost, effects and timeline tabs draw their sections on every surface', async ($, on) => {
  hold(on, ALL)
  session(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: 'tab-cost' })
    let shown = await screen(ui)
    expect(shown.some(line => line.includes('≈ $0.41 session  claude $0.16'))).toBe(true)
    expect(shown.some(line => /◐ Explore verifyToken .* 41k +\$0\.16 +1m$/.test(line))).toBe(true)
    expect(shown).toContain(' ↑↓ move · enter open · esc close')
    expect(await ui.find({ type: 'Button', key: `row:${explore.id}` })).toBeDefined()
    await ui.press({ key: 'tab-effects' })
    shown = await screen(ui)
    expect(shown).toContain('WORKTREES 1  from agent metadata, running agents included')
    expect(shown).toContain('  :5173  bun run dev')
    expect((await ui.find({ type: 'Button', key: 'row:ssh:5173' }))?.props).toMatchObject({
      plain: true,
      hotkey: 'c',
    })
    await ui.press({ key: 'tab-timeline' })
    shown = await screen(ui)
    expect(shown).toContain('WHEN DID THINGS RUN?  this session, last 40 min')
    expect(shown.some(line => /└─ ⧉ review-changes \(workflow\)/.test(line))).toBe(true)
    expect(shown.some(line => line.includes('this project · ended yesterday 17:40'))).toBe(true)
    await ui.press({ key: 'tab-items' })
    await ui.unmount()
  }
})

test('enter on a cost row opens that item in the items tab', async ($, on) => {
  const state = hold(on, ALL, { tab: 'cost' })
  session(on)
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE } as never)
  await ui.press({ key: `row:${explore.id}` })
  expect(state).toMatchObject({ tab: 'items', open: explore.id, selected: explore.id })
  await ui.unmount()
})

test('enter on a timeline row opens that item on every surface', async ($, on) => {
  const state = hold(on, ALL)
  session(on)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: 'tab-timeline' })
    await ui.press({ key: `row:${babysit.id}` })
    expect(state).toMatchObject({ tab: 'items', open: babysit.id, selected: babysit.id })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

const edited: RabeItem = {
  ...(plan as RabeItemOf<'agent'>),
  detail: { ...(plan as RabeItemOf<'agent'>).detail, edits: [{ path: '/repo/src/a.ts', at: NOW }] },
}

test('an effects file row opens its editor and the ssh line copies, on every surface', async ($, on) => {
  const state = hold(
    on,
    ALL.map(item => (item.id === plan.id ? edited : item)),
  )
  session(on)
  const copies: string[] = []
  on('ui.copy', async (_$, e) => {
    copies.push(e.text)
    return { value: { isCopied: true as const } }
  })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: 'tab-effects' })
    await ui.press({ key: 'row:ssh:5173' })
    await ui.press({ key: 'row:file:/repo/src/a.ts' })
    expect(state).toMatchObject({ tab: 'items', open: plan.id, selected: plan.id })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
  const ssh = 'ssh -L 5173:localhost:5173 <your-host>'
  expect(copies).toEqual([ssh, ssh])
  expect(state.toasts).toContain(`Copied: ${ssh}`)
})

test('moving the focus onto a cost or effects row selects it on every surface', async ($, on) => {
  const state = hold(
    on,
    ALL.map(item => (item.id === plan.id ? edited : item)),
  )
  session(on)
  on('ui.focus', async () => ({}))
  const focus = (element: string) =>
    $.ui.focus({
      component: 'Pane',
      requestId: 'rabe',
      plugin: 'rabe',
      element,
      origin: { kind: 'person' },
    })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: 'tab-cost' })
    await focus(`row:${review.id}`)
    expect(state.selected).toBe(review.id)
    expect((await ui.find({ type: 'Button', key: `row:${review.id}` }))?.props.dimColor).toBeFalsy()
    await ui.press({ key: 'tab-effects' })
    await focus('row:file:/repo/src/a.ts')
    expect(state.selected).toBe('file:/repo/src/a.ts')
    const row = await ui.find({ type: 'Button', key: 'row:file:/repo/src/a.ts' })
    expect(row?.props).toMatchObject({ autoFocus: true })
    expect(row?.props.dimColor).toBeFalsy()
    await ui.unmount()
  }
})

test('the session end keeps a summary for the next session in this project', async ($, on) => {
  hold(on, ALL)
  const store = session(on)
  await $.session.end({ reason: 'exit', sessionId: 's1' } as never)
  expect(store['previous:/p']).toEqual(
    previousOf(ALL, NOW, { startedAt: USAGE.startedAt, usd: USAGE.cost.usd }),
  )
})

test('a session without background work keeps the previous summary', async ($, on) => {
  hold(on, [])
  const store = session(on)
  await $.session.end({ reason: 'clear', sessionId: 's1' } as never)
  expect(store['previous:/p']).toBe(PREVIOUS)
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
    const copy = await ui.find({ type: 'Button', key: `copy:${wakeup.id}` })
    expect(copy?.props.label).toBe('c: copy prompt')
    expect(await ui.find({ type: 'Button', key: `delete:${wakeup.id}` })).toBeUndefined()
    await ui.unmount()
  }
})

test('a cron job offers delete on every surface', async ($, on) => {
  hold(on, [wakeup, babysit], { open: babysit.id })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    expect(await ui.find({ type: 'Button', key: `delete:${babysit.id}` })).toBeDefined()
    await ui.unmount()
  }
})

const focus = (element: string) =>
  ({
    component: 'Pane',
    requestId: 'rabe',
    plugin: 'rabe',
    element,
    origin: { kind: 'person' },
  }) as const

test('moving the focus onto a row selects it, and the detail beside the list follows on every surface', async ($, on) => {
  const state = hold(on, ALL)
  on('ui.focus', async () => ({}))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...WIDE } as never)
    await $.ui.focus(focus(`row:${dev.id}`))
    expect(state.selected).toBe(dev.id)
    const shown = await screen(ui)
    expect(shown.some(line => /│ ▶ shell · bun run dev +running$/.test(line))).toBe(true)
    expect((await ui.find({ type: 'Button', key: `row:${dev.id}` }))?.props.autoFocus).toBe(true)
    await $.ui.focus(focus(`row:${lint.id}`))
    await ui.unmount()
  }
})

const child: RabeItem = {
  ...(dev as RabeItemOf<'shell'>),
  id: 'shell:m',
  title: 'bun test',
  parentId: explore.id,
  detail: { command: 'bun test', taskId: 'm' },
}

test('the shells of an agent sit under its name on every surface, and their row opens them', async ($, on) => {
  const state = hold(on, [...ALL, child])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const shown = await screen(ui)
    const at = shown.indexOf(' ◐ Explore verifyToken')
    expect(at).toBeGreaterThan(0)
    expect(shown[at + 1]).toMatch(/^[ ▌] {2}▶ bun test +≥ 40m$/)
    await ui.press({ key: `row:${child.id}` })
    expect(state).toMatchObject({ open: child.id, selected: child.id })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('g on a workflow agent stops its run on every surface', async ($, on) => {
  hold(on, ALL, { selected: verify.id })
  const stopped: unknown[] = []
  on('tool.call', async (_$, e, next) => {
    if (e.tool !== 'TaskStop') return next(e)
    stopped.push(e.task_id)
    return { result: {}, text: 'stopped' }
  })
  await arm($, `row:${verify.id}`)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    expect((await ui.find({ type: 'Button', key: 'stop-group' }))?.props).toMatchObject({
      label: 'g: stop run',
      hotkey: 'g',
    })
    const x = await ui.find({ type: 'Button', key: 'stop' })
    expect([x?.props.dimColor, x?.props.hotkey]).toEqual([true, undefined])
    expect(await screen(ui)).toContain(' ↑↓ move · enter open · g stop run · esc close')
    await ui.press({ key: 'stop-group' })
    await ui.unmount()
  }
  expect(stopped).toEqual(['wf_task', 'wf_task'])
})

test('x stops a codex job through /rabe-stop on every surface', async ($, on) => {
  const sets = hold(on, ALL, { open: review.id })
  const runs: string[] = []
  on('command.run', { command: 'rabe-stop' }, async (_$, e) => {
    runs.push(e.args)
    return { text: `Stopped codex ${review.title}` }
  })
  await arm($)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const stop = await ui.find({ type: 'Button', key: `stop:${review.id}` })
    expect(stop?.props.label).toBe('x: stop')
    await ui.press({ key: `stop:${review.id}` })
    await ui.unmount()
  }
  expect(runs).toEqual([review.id, review.id])
  expect(sets.toasts).toContain(`Stopped ${review.title}`)
})

test('/rabe sorts the lists once; until the next open they hold that order', async ($, on) => {
  const state = hold(on, ALL)
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))
  await $.command.run({ command: 'rabe', args: '' } as never)
  expect(state.order).toEqual(orderOf(ALL))
})

const ARROW = {
  component: 'Pane',
  requestId: 'rabe',
  offset: 1,
  bodyRows: 10,
  contentRows: 40,
  origin: { kind: 'person' },
} as const

// The pane's arrow hook answers a one-row move without a pointer itself and
// moves the focus (the kit cannot answer a plugin's $.ui.focus, so that call
// is left to the live engine); the rest scrolls on.
test('an arrow key in a pane taller than its body is kept from scrolling; the wheel and pages pass', async ($, on) => {
  hold(on, ALL, { selected: dev.id })
  const passed: number[] = []
  on('ui.scroll', async (_$, e) => {
    passed.push(e.by)
    return {}
  })
  expect(await $.ui.scroll({ ...ARROW, by: 1 })).toEqual({})
  expect(await $.ui.scroll({ ...ARROW, by: -1 })).toEqual({})
  await $.ui.scroll({ ...ARROW, by: 3 })
  await $.ui.scroll({ ...ARROW, by: 1, pointer: { column: 2, row: 4 } })
  expect(passed).toEqual([3, 1])
})

test('an arrow past the last row scrolls the pane on', async ($, on) => {
  hold(on, ALL, { selected: babysit.id })
  const passed: number[] = []
  on('ui.scroll', async (_$, e) => {
    passed.push(e.by)
    return {}
  })
  await $.ui.scroll({ ...ARROW, by: 1 })
  expect(passed).toEqual([1])
})

test('a workflow agent row is a plain Button that opens that agent on every surface', async ($, on) => {
  const state = hold(on, ALL, { open: flow.id, selected: flow.id })
  for (const surface of SURFACES) {
    delete state.open
    delete state.selected
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const row = await ui.find({ type: 'Button', key: `row:${verify.id}` })
    expect(row?.props).toMatchObject({ label: 'verify:db.ts', plain: true, dimColor: true })
    expect((await ui.find({ type: 'Button', key: 'back' }))?.props.autoFocus).toBe(true)
    await ui.press({ key: `row:${verify.id}` })
    expect(state).toMatchObject({ open: verify.id, selected: verify.id })
    expect(await screen(ui)).toContain('Turns n/a: none seen since Rabe loaded.')
    await ui.unmount()
  }
})

test('the focus on a workflow agent row marks it, and b goes back to the run', async ($, on) => {
  const state = hold(on, ALL, { open: flow.id, selected: flow.id })
  on('ui.focus', async () => ({}))
  for (const surface of SURFACES) {
    delete state.open
    delete state.selected
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await $.ui.focus({
      component: 'Pane',
      requestId: 'rabe',
      plugin: 'rabe',
      element: `row:${verify.id}`,
      origin: { kind: 'person' },
    })
    expect(state.selected).toBe(verify.id)
    await ui.redraw()
    expect((await screen(ui)).some(line => line.startsWith('▌◐ verify:db.ts'))).toBe(true)
    await ui.press({ key: 'back' })
    expect(state).toMatchObject({ open: '', selected: flow.id })
    await ui.unmount()
  }
})

// Moving the pane between dock and inline (a resize across 110 columns)
// takes the keys from it; the person did not give them back to the prompt.
test('a pane the terminal moved takes the keys back only if it held them', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const opens = opening(on, true)
  const seat = (placement: 'dock' | 'inline', isFocused: boolean) => ({
    ...WIDE.props,
    placement,
    isFocused,
  })
  const ui = await $.ui.mount({ surface: 'terminal', ...WIDE } as never)
  await ui.redraw(seat('inline', false) as never)
  await clock.advance(2000)
  expect(opens).toEqual([expect.objectContaining({ id: 'rabe', focus: true, closeOnEscape: true })])
  await ui.redraw(seat('dock', false) as never)
  await ui.redraw(seat('dock', true) as never)
  await ui.redraw(seat('dock', false) as never)
  await clock.advance(2000)
  expect(opens).toHaveLength(1)
  await ui.unmount()
})

function stops(on: On): unknown[] {
  const stopped: unknown[] = []
  on('tool.call', async (_$, e, next) => {
    if (e.tool !== 'TaskStop') return next(e)
    stopped.push(e.task_id)
    return { result: {}, text: 'stopped' }
  })
  return stopped
}

// The ring keeps an index the pane cannot see, so a stop acts only once the
// ring is known to sit on a safe element (see arming in docs/architecture.md).
test('the pane opens disarmed: a stop does nothing until the person moves the ring', async ($, on) => {
  hold(on, ALL, { selected: dev.id })
  on('ui.open', async () => ({ value: { isPlaced: true as const } }))
  on('ui.panes', async () => ({ value: [] }))
  const stopped = stops(on)
  await arm($)
  await $.command.run({ command: 'rabe', args: '' } as never)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const x = await ui.find({ type: 'Button', key: 'stop' })
    expect([x?.props.dimColor, x?.props.hotkey]).toEqual([true, undefined])
    await ui.press({ key: 'stop' })
    await ui.unmount()
  }
  expect(stopped).toEqual([])
  await arm($, `row:${dev.id}`)
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE } as never)
  expect((await ui.find({ type: 'Button', key: 'stop' }))?.props.hotkey).toBe('x')
  await ui.press({ key: 'stop' })
  await ui.unmount()
  expect(stopped).toEqual(['bg_2'])
})

test('an open item that is gone disarms the list the view falls back to', async ($, on) => {
  const items = [...ALL]
  hold(on, items, { open: dev.id, selected: explore.id })
  await arm($)
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE } as never)
  expect((await ui.find({ type: 'Button', key: `stop:${dev.id}` }))?.props.hotkey).toBe('x')
  items.splice(items.indexOf(dev), 1)
  await ui.redraw()
  const x = await ui.find({ type: 'Button', key: 'stop' })
  expect([x?.props.dimColor, x?.props.hotkey]).toEqual([true, undefined])
  await arm($, `row:${explore.id}`)
  await ui.redraw()
  expect((await ui.find({ type: 'Button', key: 'stop' }))?.props.hotkey).toBe('x')
  await ui.unmount()
})

// The kit answers no plugin's own $.ui.focus (see feasibility): the landing
// fails, as one another hook refuses does.
test('a change of the view disarms until the ring lands; a failed landing keeps it so', async ($, on) => {
  hold(on, ALL, { selected: dev.id })
  await arm($, `row:${dev.id}`)
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE } as never)
  expect((await ui.find({ type: 'Button', key: 'stop' }))?.props.hotkey).toBe('x')
  await ui.press({ key: 'tab-cost' })
  await ui.press({ key: 'tab-items' })
  const x = await ui.find({ type: 'Button', key: 'stop' })
  expect([x?.props.dimColor, x?.props.hotkey]).toEqual([true, undefined])
  await ui.unmount()
})

test('a selected row that is gone disarms x and g; the next focus by the person re-arms them', async ($, on) => {
  const items = ALL.filter(item => item !== lint)
  hold(on, items, { selected: dev.id })
  await arm($, `row:${dev.id}`)
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE } as never)
  expect((await ui.find({ type: 'Button', key: 'stop' }))?.props.hotkey).toBe('x')
  items.splice(items.indexOf(dev), 1)
  await ui.redraw()
  for (const key of ['stop', 'stop-group']) {
    const one = await ui.find({ type: 'Button', key })
    expect([key, one?.props.hotkey]).toEqual([key, undefined])
  }
  await arm($, `row:${explore.id}`)
  await ui.redraw()
  expect((await ui.find({ type: 'Button', key: 'stop' }))?.props.hotkey).toBe('x')
  await ui.unmount()
})

// GPT review round 7: the selected shell is gone and the list falls back to
// another row. The group header and the gone slot are no choice of a target.
test('a person focus on a gone slot or a group header leaves x and g inert', async ($, on) => {
  const items = ALL.filter(item => item !== lint)
  hold(on, items, { selected: dev.id })
  await arm($, `row:${dev.id}`)
  const ui = await $.ui.mount({ surface: 'terminal', ...PANE } as never)
  expect((await ui.find({ type: 'Button', key: 'stop' }))?.props.hotkey).toBe('x')
  items.splice(items.indexOf(dev), 1)
  await ui.redraw()
  for (const element of ['group-shells', `row:${dev.id}`, 'tab-items']) {
    await arm($, element)
    await ui.redraw()
    for (const key of ['stop', 'stop-group']) {
      const one = await ui.find({ type: 'Button', key })
      expect([element, key, one?.props.hotkey]).toEqual([element, key, undefined])
    }
  }
  await arm($, `row:${explore.id}`)
  await ui.redraw()
  expect((await ui.find({ type: 'Button', key: 'stop' }))?.props.hotkey).toBe('x')
  await ui.unmount()
})
