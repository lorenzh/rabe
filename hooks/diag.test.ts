import { expect, test } from 'claude-code/testing'

import { diag, diagText } from './diag'
import { collect, fault, mergeDiag, shorten, tally } from './loop'
import { core, files, memoryState } from './testing'

test('shorten keeps the last name of a path and cuts long text', () => {
  expect(shorten(new Error("ENOENT: no such file, open '/home/lena/secret/a.json'"))).toBe(
    "ENOENT: no such file, open 'a.json'",
  )
  expect(shorten('x'.repeat(500))).toHaveLength(120)
})

test('shorten rewrites every absolute path, short ones too', () => {
  expect(shorten('EACCES /home/lena')).toBe('EACCES …')
  expect(shorten("EACCES: open '/home/lena'")).toBe("EACCES: open '…'")
  expect(shorten('cannot read ~/x')).toBe('cannot read …')
  expect(shorten('cannot read ~/x/y.json')).toBe('cannot read y.json')
  expect(shorten('open C:\\Users\\lena\\a.json')).toBe('open a.json')
  expect(shorten('open C:\\Users')).toBe('open …')
  const reason = shorten('Denied by policy: keep out of /home/lena/diary now, see /srv')
  expect(reason).toBe('Denied by policy: keep out of … now, see …')
})

test('collect records duration, reads, chars and errors per named poll', async () => {
  let t = 0
  const { stats } = await collect(
    [
      {
        name: 'one',
        run: async () => {
          tally('12345')
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
  expect(stats.one).toMatchObject({ at: 1000, ms: 250, files: 1, chars: 5, errors: 1 })
  expect(stats.one?.lastError).toBe("open 'missing.json'")
  expect(stats.two).toMatchObject({ errors: 1, lastError: 'failed x.out' })
  expect(Object.keys(stats)).toEqual(['one', 'two'])
})

test('mergeDiag keeps the same record while only the time of the poll moves', () => {
  const held = { a: { at: 1, ms: 200, files: 1, chars: 5, errors: 0 } }
  expect(mergeDiag(held, { a: { at: 9, ms: 230, files: 1, chars: 5, errors: 0 } })).toBe(held)
  expect(mergeDiag(held, { a: { at: 9, ms: 230, files: 2, chars: 5, errors: 0 } }).a?.files).toBe(2)
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
  expect(text).toContain("- shells: 100 ms, 2 files, 90 chars, 1 errors, last error: open 'b.out'")
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
    value: { agents: { at: 1, ms: 300, files: 4, chars: 100, errors: 0 } },
    version: 1,
  }
  diag(on, { timelineHours: 4, other: 'x' })
  const answer = await $.command.run({ command: 'rabe-diag', args: '' } as never)
  expect(answer.text).toContain('- agents: 300 ms, 4 files, 100 chars, 0 errors')
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
