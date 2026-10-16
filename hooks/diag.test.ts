import { expect, test } from 'claude-code/testing'

import { diag, diagText } from './diag'
import { collect, fault, mergeDiag, shorten, skipped, tally } from './loop'
import { core, files, memoryState } from './testing'

test('diagnostic errors contain fixed categories only', () => {
  for (const [error, category] of [
    [new Error("ENOENT: open '/home/lena/private-token.json'"), 'not found'],
    [{ code: 'EACCES', message: 'private prompt' }, 'permission denied'],
    ['ETIMEDOUT private token', 'timeout'],
    ['read exceeds 4 MiB private.json', 'too large'],
    ['tail exited with code 17: private prompt', 'exit code 17'],
    [new SyntaxError('secret prompt'), 'parse error'],
    ['Denied by policy: private prompt', 'refused'],
    ['private prompt token.json', 'other'],
    ['not found', 'not found'],
  ])
    expect(shorten(error)).toBe(category)
})

test('collect records duration, reads, UTF-8 bytes, skips and errors per named poll', async () => {
  let t = 0
  const { stats } = await collect(
    [
      {
        name: 'one',
        run: async () => {
          tally('ré😀')
          skipped()
          fault(new Error("open '/home/lena/missing.json'"))
          return undefined
        },
      },
      {
        name: 'two',
        run: async () => {
          throw new Error('failed /home/lena/p/x.out')
        },
      },
      { run: async () => undefined },
    ],
    [],
    1000,
    false,
    async () => (t += 250),
  )
  expect(stats.one).toMatchObject({
    at: 1000,
    ms: 250,
    files: 1,
    chars: 4,
    bytes: 7,
    skipped: 1,
    errors: 1,
  })
  expect(stats.one?.lastError).toBe('other')
  expect(stats.two).toMatchObject({ errors: 1, lastError: 'other' })
  expect(Object.keys(stats)).toEqual(['one', 'two'])
})

test('mergeDiag keeps the same record while only the time of the poll moves', () => {
  const held = { a: { at: 1, ms: 200, files: 1, chars: 5, bytes: 5, skipped: 0, errors: 0 } }
  expect(
    mergeDiag(held, { a: { at: 9, ms: 230, files: 1, chars: 5, bytes: 5, skipped: 0, errors: 0 } }),
  ).toBe(held)
  expect(
    mergeDiag(held, { a: { at: 9, ms: 230, files: 2, chars: 5, bytes: 5, skipped: 0, errors: 0 } })
      .a?.files,
  ).toBe(2)
  expect(mergeDiag(held, { a: { ...held.a, bytes: 6 } }).a?.bytes).toBe(6)
  expect(mergeDiag(held, { a: { ...held.a, skipped: 1 } }).a?.skipped).toBe(1)
})

test('the report has counts and versions and no titles, prompts or full paths', () => {
  const text = diagText({
    rabe: '0.6.0',
    claude: '2.1.296',
    options: { pricesFile: '/home/lena/prices.csv', timelineHours: 4 },
    diag: {
      shells: {
        at: 1,
        ms: 100,
        files: 2,
        chars: 90,
        bytes: 94,
        skipped: 3,
        errors: 1,
        lastError: "open '/home/lena/a/b.out'",
      },
    },
    items: [
      {
        id: 'shell:1',
        kind: 'shell',
        title: 'deploy secret-project',
        status: 'running',
        seenAt: 1,
        detail: { command: 'rm -rf /home/lena' },
      },
    ],
  })
  expect(text).toContain('Rabe 0.6.0, Claude Code 2.1.296')
  expect(text).toContain('pricesFile: set')
  expect(text).toContain('shell running 1')
  expect(text).toContain(
    '- shells: 100 ms, 2 files, 90 chars, 94 bytes, 3 skipped, 1 errors, last error: other',
  )
  for (const secret of ['lena', 'secret-project', 'rm -rf']) expect(text).not.toContain(secret)
  expect(text).toContain(
    '- agents: no poll recorded (not due, inactive session, or hook unavailable)',
  )
  for (const name of ['codex', 'monitors', 'worktrees'])
    expect(text).toContain(`- ${name}: no poll recorded`)
  expect(text).toContain('crons, workflows: event sources, no polls')
})

test('/rabe-diag prints the stored records', async ($, on) => {
  const state = memoryState(on)
  core(on)
  files(on, { '/p/.claude-plugin/plugin.json': '{"version":"1.2.3"}' })
  state['rabe.diag'] = {
    value: { agents: { at: 1, ms: 300, files: 4, chars: 100, bytes: 100, skipped: 2, errors: 0 } },
    version: 1,
  }
  diag(on, { timelineHours: 4, other: 'x' })
  const answer = await $.command.run({ command: 'rabe-diag', args: '' } as never)
  expect(answer.text).toContain(
    '- agents: 300 ms, 4 files, 100 chars, 100 bytes, 2 skipped, 0 errors',
  )
  expect(answer.text).toContain('timelineHours: 4')
  expect(answer.text).not.toContain('other')
})

test('/rabe-diag runs during a turn', async ($, on) => {
  memoryState(on)
  const registered: unknown[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  diag(on, {})
  await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never)
  expect(registered).toContainEqual(expect.objectContaining({ name: 'rabe-diag', immediate: true }))
})

test('/rabe-diag is registered in a non-interactive session', async ($, on) => {
  memoryState(on)
  const registered: unknown[] = []
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => {
    registered.push(e)
    return { value: { command: e.name } }
  })
  diag(on, {})
  await $.session.start({ cwd: '/repo', surface: null, isInteractive: false } as never)
  expect(registered).toContainEqual(expect.objectContaining({ name: 'rabe-diag' }))
})

test('/rabe:report-bug keeps its text and context and gets the diagnostics', async ($, on) => {
  memoryState(on)
  core(on)
  files(on, { '/p/.claude-plugin/plugin.json': '{"version":"1.2.3"}' })
  on('command.run', async () => ({ text: 'draft', context: ['asked'] }) as never)
  diag(on, {})
  const answer = await $.command.run({ command: 'rabe:report-bug', args: 'x' } as never)
  expect(answer.text).toBe('draft')
  expect(answer.context?.[0]).toBe('asked')
  expect(answer.context?.[1]).toContain('Rabe diagnostics:\nRabe ')
})

for (const broken of [
  null,
  [],
  'private prompt',
  { agents: null },
  { agents: { ms: 'secret', lastError: 'token.json' } },
]) {
  test(`diagnostics ignore malformed restored records ${JSON.stringify(broken)}`, () => {
    const text = diagText({
      rabe: '0.7.0',
      claude: '2.1.296',
      options: {},
      items: [],
      diag: broken as never,
    })
    for (const secret of ['private prompt', 'secret', 'token.json', 'undefined', 'null'])
      expect(text).not.toContain(secret)
  })
}

test('diagnostics allow only known option values, item counts and numeric versions', () => {
  const text = diagText({
    rabe: 'private-version',
    claude: 'private-version',
    options: {
      timelineHours: 'private-option',
      hideBuiltinTasks: 'private-option',
      custom: 'private-option',
      pricesFile: '/private.csv',
    },
    items: [{ kind: 'private-kind', status: 'private-status' }] as never,
    diag: {},
  })
  expect(text).not.toContain('private')
})

for (const failure of ['refused', 'thrown']) {
  test(`diagnostics keep the start result when registration is ${failure}`, async ($, on) => {
    memoryState(on)
    on('session.start', async (_$, e) => ({ cwd: e.cwd }))
    on('command.register', async () => {
      if (failure === 'thrown') throw new Error('private reason')
      return { deny: 'private reason' }
    })
    diag(on, {})
    expect(
      await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true } as never),
    ).toMatchObject({ cwd: '/repo' })
  })
}

for (const command of ['rabe-diag', 'rabe:report-bug']) {
  test(`${command} returns fixed text when the diagnostics read fails`, async ($, on) => {
    on('state.get', { plugin: 'rabe', key: 'diag' }, async () => ({ deny: 'private reason' }))
    core(on)
    on('command.run', async () => ({ text: 'draft', context: ['asked'] }) as never)
    diag(on, {})
    const answer = await $.command.run({ command, args: '' } as never)
    if (command === 'rabe-diag') expect(answer.text).toBe('diagnostics unavailable')
    else expect(answer.context).toContain('Rabe diagnostics:\ndiagnostics unavailable')
  })
}

test('diagnostics catch thrown registration and report calls', async () => {
  const hooks: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  diag(
    ((
      event: string,
      matcher: { command?: string },
      handler: (...args: unknown[]) => Promise<unknown>,
    ) => {
      hooks[matcher.command ?? event] = handler
    }) as never,
    {},
  )
  const engine = {
    command: {
      register: async () => {
        throw new Error('private reason')
      },
    },
    state: {
      get: async () => {
        throw new Error('private reason')
      },
    },
  }
  const started = { cwd: '/repo' }
  expect(await hooks['session.start']?.(engine, {}, async () => started)).toBe(started)
  expect(await hooks['rabe-diag']?.(engine)).toEqual({ text: 'diagnostics unavailable' })
})
