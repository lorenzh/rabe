import type { On } from 'claude-code'
import { expect, type Mounted, mock, test } from 'claude-code/testing'

import type { RabeItem } from '../model'
import { ALL, dev, explore, flow, lint, NOW, review } from './fixtures'

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

const FILES: Record<string, string> = {
  '/t/bg_3.output': 'pkg/auth/verify.ts\n 42:5 error Unexpected any\n[exited with code 2]\n',
  '/t/agent-a1.jsonl': [
    { type: 'user', message: { content: 'Find every caller of verifyToken.' } },
    {
      type: 'assistant',
      message: {
        id: 'm1',
        content: [
          { type: 'text', text: 'Searching the middleware.' },
          { type: 'tool_use', id: 't1', name: 'Grep', input: { pattern: 'verifyToken' } },
        ],
      },
    },
  ]
    .map(line => JSON.stringify(line))
    .join('\n'),
  '/c/rollout-1.jsonl': [
    { type: 'turn_context', payload: { model: 'gpt-6.1-sol', effort: 'high' } },
    {
      type: 'response_item',
      payload: { type: 'reasoning', summary: [{ type: 'summary_text', text: 'Diff first.' }] },
    },
    {
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', content: [{ text: 'Reading the diff.' }] },
    },
    {
      type: 'event_msg',
      payload: {
        type: 'item_completed',
        item: {
          type: 'CommandExecution',
          command: ['git diff'],
          exit_code: 0,
          aggregated_output: 'x',
        },
      },
    },
  ]
    .map(line => JSON.stringify(line))
    .join('\n'),
}

function hold(on: On, items: RabeItem[]) {
  mock.clock(on, { now: NOW })
  on('state.get', async (_$, e, next) =>
    e.plugin === 'rabe' && e.key === 'items' ? { value: { value: items, version: 1 } } : next(e),
  )
  on('ui.toast', async () => ({ value: undefined }))
  on('fs.stat', async (_$, e) => ({
    value: {
      kind: 'file' as const,
      size: (FILES[e.path] ?? '').length,
      mtimeMs: NOW,
      isLink: false,
    },
  }))
  on('fs.read', async (_$, e) => {
    const text = FILES[e.path]
    return text === undefined ? { deny: 'ENOENT: no such file' } : { value: text }
  })
}

test('the pane shows the tab row and the empty state on every surface', async ($, on) => {
  hold(on, [])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({
      surface,
      ...PANE,
      props: { ...PROPS, isFocused: false },
    } as never)
    for (const label of ['Items 0', 'Cost', 'Effects', 'Timeline']) {
      expect(await ui.find({ type: 'Button', text: label })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: 'Nothing runs in the background.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'tab to select · esc close' })).toBeDefined()
    await ui.unmount()
  }
})

test('the items tab groups items with failed first and a status word on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const buttons = (await ui.findAll({ type: 'Button' })).map(b => String(b.props.label ?? ''))
    const groups = buttons.filter(label => /^[▾▸] /.test(label))
    expect(groups[0]).toBe('▾ FAILED 1')
    expect(groups[1]).toBe('▾ AGENTS 6  4 claude · 1 codex · 1 workflow')
    expect(
      await ui.find({ type: 'Button', text: /^failed\s+shell\s+bun run lint exit 2\s+2m ago$/ }),
    ).toBeDefined()
    expect(
      await ui.find({ type: 'Button', text: /^running\s+shell\s+bun run dev :5173\s+≥ 40m$/ }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Button', text: '•All 10' })).toBeDefined()
    await ui.unmount()
  }
})

test('a filter and the search narrow the list on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui: Mounted<typeof surface> = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: 'filter-shells' })
    expect(await ui.find({ type: 'Button', text: /bun run dev/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /Explore verifyToken/ })).toBeUndefined()
    await ui.press({ key: 'filter-all' })
    await ui.input({ key: 'search', text: 'verify', kind: 'change' })
    expect(await ui.find({ type: 'Button', text: /Explore verifyToken/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /bun run dev/ })).toBeUndefined()
    await ui.input({ key: 'search', text: '' })
    await ui.unmount()
  }
})

test('a long list draws one page and a more row on every surface', async ($, on) => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    ...dev,
    id: `shell:s${i}`,
    title: `job ${i}`,
  }))
  hold(on, many)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    const rows = await ui.findAll({ type: 'Button', text: /^running/ })
    expect(rows.length).toBeLessThan(30)
    expect(await ui.find({ type: 'Button', text: /^… \d+ more$/ })).toBeDefined()
    await ui.press({ key: 'filter-shells' })
    expect(await ui.find({ type: 'Button', text: /page 1 of \d/ })).toBeDefined()
    await ui.press({ key: 'filter-all' })
    await ui.unmount()
  }
})

test('a group header folds its rows on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: 'group-shells' })
    expect(await ui.find({ type: 'Button', text: '▸ SHELLS 1  1 running' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /bun run dev/ })).toBeUndefined()
    await ui.press({ key: 'group-shells' })
    await ui.unmount()
  }
})

test('enter on a shell row opens its output and back returns on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: `row:${lint.id}` })
    expect(await ui.find({ type: 'Text', text: 'shell · bun run lint' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✗ failed · exit 2' })).toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: 'output · last 3 of 3 lines · newest last' }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '[exited with code 2]' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'copy command' })).toBeDefined()
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Button', text: '▾ FAILED 1' })).toBeDefined()
    await ui.unmount()
  }
})

test('an agent shows its turns from the transcript on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: `row:${explore.id}` })
    expect(await ui.find({ type: 'Text', text: 'Find every caller of verifyToken.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 ● Searching the middleware.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '⎿ Grep verifyToken  ◐ running' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'message agent' })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a codex job shows its turns and commands on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: `row:${review.id}` })
    expect(
      await ui.find({ type: 'Text', text: 'Review middleware/auth.ts for token-expiry bugs.' }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '1 ◆ Reading the diff.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '  thinking: Diff first.' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\$ git diff\s+✓ exit 0 · 1 lines/ })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a missing file shows an error line and n/a on every surface', async ($, on) => {
  const gone: RabeItem = {
    id: dev.id,
    kind: 'shell',
    title: dev.title,
    status: 'running',
    seenAt: dev.seenAt,
    detail: { command: 'bun run dev', outputPath: '/gone' },
  }
  hold(on, [gone])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: `row:${dev.id}` })
    expect(await ui.find({ type: 'Text', text: /^Error Could not read \/gone/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Output n/a.' })).toBeDefined()
    expect(
      await ui.find({ type: 'Text', text: 'started before Rabe loaded · start time not known' }),
    ).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a workflow lists its agents by phase on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: 'filter-agents' })
    await ui.press({ key: `row:${flow.id}` })
    expect(await ui.find({ type: 'Text', text: '✓ Review → ◐ Verify → · Report' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'VERIFY 1 running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'REPORT not started' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'stop run' })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.press({ key: 'filter-all' })
    await ui.unmount()
  }
})

test('stop calls TaskStop with the task id on every surface', async ($, on) => {
  hold(on, ALL)
  const stopped: unknown[] = []
  on('tool.call', async (_$, e, next) => {
    if (e.tool !== 'TaskStop') return next(e)
    stopped.push(e.task_id)
    return { result: {}, text: 'stopped' }
  })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: `row:${dev.id}` })
    await ui.press({ key: 'stop' })
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
  expect(stopped).toEqual(['bg_2', 'bg_2'])
})

test('a wide docked pane shows the selected item beside the list on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...WIDE } as never)
    await ui.press({ key: `row:${review.id}` })
    await ui.press({ key: 'back' })
    expect(await ui.find({ type: 'Text', text: 'codex · review auth.ts' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'live output (tail)' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /^running\s+codex/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a narrow pane puts a one-line summary under the list on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: `row:${review.id}` })
    await ui.press({ key: 'back' })
    expect(
      await ui.find({
        type: 'Text',
        text: 'review auth.ts · model gpt-6.1-sol · effort high · job task-1 · ◐ running',
      }),
    ).toBeDefined()
    await ui.unmount()
  }
})

test('cost, effects and timeline tabs draw their sections on every surface', async ($, on) => {
  hold(on, ALL)
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: 'tab-cost' })
    expect(await ui.find({ type: 'Text', text: 'session total ≈ $0.25' })).toBeDefined()
    expect(
      await ui.find({
        type: 'Button',
        text: /^claude Explore verifyToken\s+41k\s+\$0\.16\s+1m12s$/,
      }),
    ).toBeDefined()
    await ui.press({ key: 'tab-effects' })
    expect(await ui.find({ type: 'Text', text: 'WORKTREES 1' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1 agent shares the main tree/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 agents: tree n\/a/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: ':5173 bun run dev' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /ssh -L 5173:localhost:5173/ })).toBeDefined()
    await ui.press({ key: 'tab-timeline' })
    expect(await ui.find({ type: 'Text', text: 'WHEN DID THINGS RUN?' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /└─ ⧉ workflow review-changes/ })).toBeDefined()
    await ui.press({ key: 'tab-items' })
    await ui.unmount()
  }
})

test('moving the focus onto a row selects it on every surface', async ($, on) => {
  hold(on, ALL)
  on('ui.focus', async () => ({}))
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await $.ui.focus({
      component: 'Pane',
      requestId: 'rabe',
      plugin: 'rabe',
      element: `row:${lint.id}`,
      origin: { kind: 'person' },
    })
    expect(
      await ui.find({ type: 'Text', text: /^bun run lint · command bun run lint/ }),
    ).toBeDefined()
    await ui.unmount()
  }
})

function holdBig(
  on: On,
  item: RabeItem,
  run: { exitCode: number; stdout: string; stderr: string },
) {
  mock.clock(on, { now: NOW })
  on('state.get', async (_$, e, next) =>
    e.plugin === 'rabe' && e.key === 'items' ? { value: { value: [item], version: 1 } } : next(e),
  )
  on('ui.toast', async () => ({ value: undefined }))
  on('fs.stat', async () => ({
    value: { kind: 'file' as const, size: 5 * 1024 * 1024, mtimeMs: NOW, isLink: false },
  }))
  on('process.run', async () => ({ value: run }) as never)
}

const big: RabeItem = {
  id: dev.id,
  kind: 'shell',
  title: dev.title,
  status: 'running',
  seenAt: dev.seenAt,
  detail: { command: 'bun run dev', outputPath: '/big' },
}

test('a file over 4 MiB shows every line tail gives on every surface', async ($, on) => {
  holdBig(on, big, { exitCode: 0, stdout: 'first line\nlast line\n', stderr: '' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: `row:${dev.id}` })
    expect(await ui.find({ type: 'Text', text: 'first line' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Warning The file is over 4 MiB/ })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a failed tail shows an error and n/a on every surface', async ($, on) => {
  holdBig(on, big, { exitCode: 1, stdout: '', stderr: 'tail: /big: No such file' })
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: `row:${dev.id}` })
    expect(
      await ui.find({ type: 'Text', text: /^Error Could not read \/big: tail: \/big: No such/ }),
    ).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Output n/a.' })).toBeDefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

test('a /loop wakeup offers no delete on every surface', async ($, on) => {
  const wakeup: RabeItem = {
    id: 'cron:wakeup-1',
    kind: 'cron',
    title: 'autonomous loop',
    status: 'running',
    seenAt: NOW,
    detail: { jobId: 'wakeup-1', prompt: 'x', scheduledFor: NOW + 60_000 },
  }
  hold(on, [wakeup])
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ surface, ...PANE } as never)
    await ui.press({ key: `row:${wakeup.id}` })
    expect(await ui.find({ type: 'Button', text: 'copy prompt' })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: 'delete job' })).toBeUndefined()
    await ui.press({ key: 'back' })
    await ui.unmount()
  }
})

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
