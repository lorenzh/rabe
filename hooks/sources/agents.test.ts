import type { AgentSpawnInput, AgentStatus, FsStat, On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import type { RabeEdit } from '../../types'
import type { RabeItem, RabeItemOf, RabeTurn } from '../model'
import { MAX_ENDED } from '../registry'
import { core, files, memoryState } from '../testing'
import { addTurn, agentTranscript, metaPatch, metaPath, toolSummary } from './agents'

const SPAWN: AgentSpawnInput = {
  tool_use_id: 'toolu_1',
  prompt: 'Verify the pool',
  description: 'verify:db.ts',
  subagentType: 'general-purpose',
  provider: { plugin: 'engine', tier: 'core' },
  parentModel: 'claude-opus-5-5',
  background: true,
  fork: false,
  workflow: { runId: 'wf_1', agentIndex: 5 },
}

const agent: RabeItem = {
  id: 'agent:a1',
  kind: 'agent',
  title: 'verify:db.ts',
  status: 'running',
  seenAt: 5000,
  startedAt: 5000,
  detail: { agentId: 'a1' },
}

const turn = (index: number): RabeTurn => ({ index, at: index, text: `t${index}`, tools: [] })

type Held = { items?: RabeItem[]; turns?: Record<string, RabeTurn[]>; edits?: RabeEdit[] }

function watch(on: On): Held {
  const held: Held = {}
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'rabe' && e.key === 'items') held.items = e.value as RabeItem[]
    if (e.plugin === 'rabe' && e.key === 'turns') held.turns = e.value as Held['turns']
    if (e.plugin === 'rabe' && e.key === 'edits') held.edits = e.value as RabeEdit[]

    return next(e)
  })

  return held
}

function engine(on: On, agentId: string): Held {
  mock.clock(on, { now: 5000 })
  on('agent.spawn', async () => ({ model: 'claude-opus-5-5', agentId }))
  on('classic.SubagentStart', async () => ({}))
  on('turn.complete', async () => ({ text: '' }))

  return watch(on)
}

test('the tool summary is the first useful argument on one short line', () => {
  expect(toolSummary({ file_path: 'src/db.ts' })).toBe('src/db.ts')
  expect(toolSummary({ command: 'bun test\necho done' })).toBe('bun test')
  expect(toolSummary({ pattern: 'release\\(', path: 'src/' })).toBe('release\\(')
  expect(toolSummary({ command: 'x'.repeat(200) })).toHaveLength(80)
  expect(toolSummary({ command: 'x'.repeat(200) })).toBe(`${'x'.repeat(79)}…`)
  expect(toolSummary({ command: 'x'.repeat(80) })).toBe('x'.repeat(80))
  const long = `/home/me/app/${'deep/'.repeat(20)}a.ts`
  expect(toolSummary({ file_path: long })).toBe(long)
  expect(toolSummary({ other: 1 })).toBeUndefined()
  expect(toolSummary(null)).toBeUndefined()
})

test('the meta file gives worktree, branch and phase, and bad text gives nothing', () => {
  const text = JSON.stringify({
    worktreePath: '/wt/a1',
    worktreeBranch: 'agent-a1',
    workflowPhase: 'Verify',
    agentType: 'workflow-subagent',
    cwd: '/wt/a1',
  })
  expect(metaPatch(text)).toEqual({
    cwd: '/wt/a1',
    worktreePath: '/wt/a1',
    worktreeBranch: 'agent-a1',
    workflowPhase: 'Verify',
  })
  expect(metaPatch('{"spawnDepth":1}')).toEqual({})
  expect(metaPatch('not json')).toBeUndefined()
})

test('the meta path comes from the transcript or the parent workflow folder', () => {
  const withTranscript = {
    ...agent,
    detail: { agentId: 'a1', transcriptPath: '/s/agent-a1.jsonl' },
  }
  expect(metaPath(withTranscript, [])).toBe('/s/agent-a1.meta.json')

  const run: RabeItem = {
    id: 'workflow:wf_1',
    kind: 'workflow',
    title: 'review',
    status: 'running',
    seenAt: 1,
    detail: {
      runId: 'wf_1',
      transcriptDir: '/s/subagents/workflows/wf_1',
      scriptPath: '/s/workflows/scripts/review.js',
    },
  }
  const child = { ...agent, parentId: 'workflow:wf_1' }
  expect(metaPath(child, [run])).toBe('/s/subagents/workflows/wf_1/agent-a1.meta.json')
  const workflowChild = {
    ...child,
    detail: { agentId: 'a1', transcriptPath: '/s/agent-a1.jsonl' },
  }
  expect(metaPath(workflowChild, [run])).toBe('/s/subagents/workflows/wf_1/agent-a1.meta.json')
  const unknownDirectory = { ...run, detail: { runId: 'wf_1' } }
  expect(metaPath(workflowChild, [unknownDirectory])).toBe('/s/agent-a1.meta.json')
  const withoutTranscriptDir = {
    ...run,
    detail: { runId: 'wf_1', scriptPath: '/s/workflows/scripts/review.js' },
  }
  expect(metaPath(child, [withoutTranscriptDir])).toBe(
    '/s/subagents/workflows/wf_1/agent-a1.meta.json',
  )
  expect(metaPath(agent, [run])).toBeUndefined()
})

test('the agent transcript sits in the session folder unless the hook names it', () => {
  expect(agentTranscript('/p/s1.jsonl', 'a1')).toBe('/p/s1/subagents/agent-a1.jsonl')
  expect(agentTranscript('/p/s1/subagents/agent-a1.jsonl', 'a1')).toBe(
    '/p/s1/subagents/agent-a1.jsonl',
  )
  expect(agentTranscript('', 'a1')).toBeUndefined()
})

test('turns keep the newest per item', () => {
  let turns: Record<string, RabeTurn[]> = { 'agent:a2': [turn(1)] }
  for (let index = 1; index <= 32; index++) turns = addTurn(turns, 'agent:a1', turn(index))
  expect(Object.keys(turns)).toEqual(['agent:a2', 'agent:a1'])
  expect(turns['agent:a1']).toHaveLength(30)
  expect(turns['agent:a1']?.[0]?.index).toBe(3)
})

test('a spawn adds a running agent under its workflow', async ($, on) => {
  const held = engine(on, 'a1')
  await $.agent.spawn(SPAWN)
  expect(held.items).toEqual([
    {
      ...agent,
      parentId: 'workflow:wf_1',
      detail: {
        agentId: 'a1',
        type: 'general-purpose',
        model: 'claude-opus-5-5',
        description: 'verify:db.ts',
        prompt: 'Verify the pool',
        workflowIndex: 5,
      },
    },
  ])
})

test('agent answers keep up to 16000 characters and mark a cut', async ($, on) => {
  const held = engine(on, 'a1')
  // biome-ignore lint/correctness/useYield: the engine's stand-in answers without chunks
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'x'.repeat([500, 16000, 16001, 50000][e.index] ?? 0),
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        input_tokens: 1,
        output_tokens: 1,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        model: 'claude-opus-5-5',
      },
    }
  })
  await $.agent.spawn(SPAWN)
  for (const index of [0, 1, 2, 3]) {
    const stream = $.turn.step({ turnId: 't1', index, model: 'm', messageCount: 1, agentId: 'a1' })
    for await (const _ of stream);
  }
  expect(held.turns?.['agent:a1']?.map(turn => turn.text)).toEqual([
    'x'.repeat(500),
    'x'.repeat(16000),
    `${'x'.repeat(15999)}…`,
    `${'x'.repeat(15999)}…`,
  ])
})

test('a spawn from another agent names that agent as parent', async ($, on) => {
  const held = engine(on, 'a2')
  await $.agent.spawn({ ...SPAWN, workflow: undefined, parentAgentId: 'a1' })
  expect(held.items?.[0]?.parentId).toBe('agent:a1')
})

test('a refused spawn adds nothing', async ($, on) => {
  const held = watch(on)
  on('agent.spawn', async () => ({ deny: 'no' }))
  await $.agent.spawn(SPAWN).catch(() => undefined)
  expect(held.items).toBeUndefined()
})

// Another cwd may be a worktree or a plain subfolder; only the meta file or
// git tells, so the start event gives the cwd alone.
test('subagent start sets the transcript and the cwd, never a worktree', async ($, on) => {
  const held = engine(on, 'a1')
  on('session.cwd', async () => ({ value: '/repo' }))
  await $.agent.spawn(SPAWN)
  for (const cwd of ['/repo/.claude/worktrees/a1', '/repo/packages/api']) {
    await $.classic.SubagentStart({
      agent_id: 'a1',
      agent_type: 'general-purpose',
      cwd,
      transcript_path: '/p/s1.jsonl',
    })
    expect(held.items?.[0]?.detail).toMatchObject({
      transcriptPath: '/p/s1/subagents/agent-a1.jsonl',
      cwd,
    })
    expect(held.items?.[0]?.detail).not.toHaveProperty('worktreePath')
  }
})

test('SubagentStart during the spawn keeps the transcript once the spawn adds the item', async ($, on) => {
  const held = watch(on)
  mock.clock(on, { now: 5000 })
  on('session.cwd', async () => ({ value: '/repo' }))
  on('classic.SubagentStart', async () => ({}))
  on('agent.spawn', async () => {
    await $.classic.SubagentStart({
      agent_id: 'a1',
      agent_type: 'general-purpose',
      cwd: '/repo',
      transcript_path: '/p/s1.jsonl',
    })

    return { model: 'claude-opus-5-5', agentId: 'a1' }
  })
  await $.agent.spawn({ ...SPAWN, workflow: undefined })
  expect(held.items).toHaveLength(1)
  expect(held.items?.[0]).toMatchObject({
    title: 'verify:db.ts',
    detail: { agentId: 'a1', transcriptPath: '/p/s1/subagents/agent-a1.jsonl', cwd: '/repo' },
  })
})

test('a workflow spawn moves its transcript into the run directory', async ($, on) => {
  const held = watch(on)
  mock.clock(on, { now: 5000 })
  on('classic.SubagentStart', async () => ({}))
  on('agent.spawn', async () => {
    await $.classic.SubagentStart({
      agent_id: 'a1',
      agent_type: 'workflow-subagent',
      transcript_path: '/p/s1.jsonl',
    })

    return { model: 'claude-opus-5-5', agentId: 'a1' }
  })
  await $.agent.spawn(SPAWN)

  expect(held.items?.[0]).toMatchObject({
    parentId: 'workflow:wf_1',
    detail: { transcriptPath: '/p/s1/subagents/workflows/wf_1/agent-a1.jsonl' },
  })
})

test('a step adds tokens, tools and a turn; the end of the run ends the agent', async ($, on) => {
  const held = engine(on, 'a1')
  // biome-ignore lint/correctness/useYield: the engine's stand-in answers without chunks
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'Reading the pool.',
      toolUses: [{ name: 'Read', input: { file_path: 'src/db.ts' } }],
      stopReason: 'tool_use' as const,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 10,
        model: 'claude-opus-5-5',
      },
    }
  })
  await $.agent.spawn(SPAWN)
  for (let step = 0; step < 2; step++) {
    const stream = $.turn.step({
      turnId: 't1',
      index: step,
      model: 'm',
      messageCount: 1,
      agentId: 'a1',
    })
    for await (const _ of stream);
  }
  await $.turn.complete({
    answer: 'done',
    durationMs: 10,
    isAborted: false,
    turnId: 't1',
    agentId: 'a1',
    reason: 'answer',
  })

  const [item] = held.items ?? []
  expect(item).toMatchObject({
    status: 'done',
    endedAt: 5000,
    tokens: { input: 320, output: 40, cached: 100 },
    detail: { toolCount: 2, lastTool: 'Read', lastToolAt: 5000 },
  })
  expect(held.turns?.['agent:a1']).toEqual([
    {
      index: 1,
      at: 5000,
      text: 'Reading the pool.',
      tools: [{ name: 'Read', summary: 'src/db.ts' }],
    },
    {
      index: 2,
      at: 5000,
      text: 'Reading the pool.',
      tools: [{ name: 'Read', summary: 'src/db.ts' }],
    },
  ])
})

test('an edit the engine ran is kept on its agent; a refused or failed one is not', async ($, on) => {
  const held = engine(on, 'a1')
  on('tool.call', { tool: ['Edit', 'Write'] }, async (_$, e) => {
    if (e.tool === 'Edit' && e.file_path.endsWith('denied.ts')) return { deny: 'no' }
    if (e.tool === 'Write' && e.file_path.endsWith('failed.ts')) {
      return { result: { error: 'x' } as never, isError: true }
    }

    return { result: {} as never }
  })
  await $.agent.spawn(SPAWN)
  const edit = (file_path: string, agentId?: string) =>
    $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b', agentId } as never)
  await edit('/repo/db.ts', 'a1')
  await edit('/repo/denied.ts', 'a1')
  await edit('/repo/main.ts')
  await $.tool.call({
    tool: 'Write',
    file_path: '/repo/failed.ts',
    content: '',
    agentId: 'a1',
  } as never)
  await $.tool.call({
    tool: 'Write',
    file_path: '/repo/new.ts',
    content: '',
    agentId: 'a1',
  } as never)
  const item = held.items?.[0] as RabeItemOf<'agent'>
  expect(item.detail.edits).toEqual([
    { path: '/repo/db.ts', at: 5000, via: 'edit' },
    { path: '/repo/new.ts', at: 5000, via: 'write' },
  ])
  expect(held.edits).toEqual([{ path: '/repo/main.ts', at: 5000, via: 'edit' }])
})

type Disk = Map<string, FsStat>
type Effect = (disk: Disk) => void

const file = (size: number, mtimeMs = 1): FsStat => ({ kind: 'file', size, mtimeMs, isLink: false })
const dir: FsStat = { kind: 'dir', size: 0, mtimeMs: 1, isLink: false }
// A file whose folder the command made unreadable: its stat fails with EACCES.
const LOCKED = file(-1)
// A file a hook hides: its stat is denied with a message that ends in ENOENT.
const SPOOFED = file(-2)
// a file stat may not look at (a folder without x) while the folder still lists it
const UNREAD = file(-3)
const hidden = (stat: FsStat | undefined) => stat === LOCKED || stat === SPOOFED

// A fake shell on a fake disk: each command changes the disk as `effects` says.
// A Bash call the engine ran has a result, no error and is not in the background.
function shell(
  on: On,
  effects: Record<string, Effect> = {},
  results: Record<string, Record<string, unknown>> = {},
): { disk: Disk; stats: string[] } {
  mock.env(on, { HOME: '/home/u' })
  const disk: Disk = new Map([
    ['/tmp', dir],
    ['/home/u', dir],
  ])
  const stats: string[] = []
  on('fs.stat', async (_$, e) => {
    stats.push(e.path)
    const found = disk.get(e.path)
    if (found === SPOOFED) return { deny: `rabe: $.fs.stat: access denied: /work/ENOENT` }
    if (found === UNREAD) return { deny: 'EACCES' }
    if (e.path.includes('locked') || found === LOCKED) return { deny: 'EACCES' }
    if (e.path.includes('hang')) return new Promise<never>(() => {})
    return found ? { value: found } : { deny: 'ENOENT' }
  })
  // a folder exists when it or a path below it is on the disk
  on('fs.list', async (_$, e) => {
    const prefix = e.path === '/' ? '/' : `${e.path}/`
    const below = [...disk].filter(([path]) => path.startsWith(prefix))
    const inside = (path: string) => !path.slice(prefix.length).includes('/')
    if (e.path.includes('locked') || below.some(([path, stat]) => inside(path) && hidden(stat))) {
      return { deny: 'EACCES' }
    }
    if (disk.get(e.path)?.kind === 'file') return { deny: 'ENOTDIR' }
    if (e.path !== '/' && !disk.has(e.path) && below.length === 0) return { deny: 'ENOENT' }
    const names = new Set(below.map(([path]) => path.slice(prefix.length).split('/')[0] as string))
    return {
      value: [...names].map(name => ({
        name,
        kind: 'file' as const,
        size: 0,
        mtimeMs: 0,
        isLink: false,
      })),
    }
  })
  // the runtime answers false for a path it may not look at
  on('fs.exists', async (_$, e) => ({ value: disk.has(e.path) && !hidden(disk.get(e.path)) }))
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    const command = e.tool === 'Bash' ? e.command : ''
    effects[command]?.(disk)
    if (command.includes('fail'))
      return { result: { stdout: '', stderr: 'x', ...results[command] } as never, isError: true }
    if (command.includes('deny')) return { deny: 'no' }
    if (/(?:^|;\s*)serve$/.test(command)) {
      return { result: { stdout: '', stderr: '', backgroundTaskId: 'b1' } as never }
    }

    return {
      result: { stdout: '', stderr: '', interrupted: false, ...results[command] } as never,
    }
  })

  return { disk, stats }
}

const HEREDOC = "cat > ~/.agents/skills/demo/SKILL.md <<'EOF'\n# demo > x\nEOF\nrm /tmp/old.md"

test('host diffs record repeated script edits for the main session and agents without stats', async ($, on) => {
  const held = engine(on, 'a1')
  const command =
    "python3 - <<'EOF'\nfrom pathlib import Path\nPath('server.py').write_text('x')\nEOF"
  const { stats } = shell(
    on,
    {},
    {
      [command]: {
        bashEditDiff: { changedFiles: ['/wt/server.py'], files: [], moreFiles: 0 },
      },
    },
  )
  await $.agent.spawn({ ...SPAWN, workflow: undefined })
  for (let n = 0; n < 5; n++) {
    await $.tool.call({ tool: 'Bash', command } as never)
  }
  await $.tool.call({ tool: 'Bash', command, agentId: 'a1' } as never)
  const edit = { path: '/wt/server.py', at: 5000, via: 'shell' }
  expect(held.edits).toEqual(Array.from({ length: 5 }, () => edit))
  expect(((held.items ?? [])[0] as RabeItemOf<'agent'>).detail.edits).toEqual([edit])
  expect(stats).toEqual([])
})

test('host diff paths merge once with disk candidates and keep known deletions without hunks', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const held = watch(on)
  shell(
    on,
    {
      'touch /tmp/f.txt': disk => disk.set('/tmp/f.txt', file(2)),
    },
    {
      'touch /tmp/f.txt': {
        bashEditDiff: {
          changedFiles: [
            '/tmp/f.txt',
            '/tmp/f.txt',
            '/wt/old.py',
            '/wt/new.py',
            'relative.py',
            null,
            1,
          ],
          files: [
            { filePath: '/wt/old.py', deleted: true, hunks: [{ lines: ['private content'] }] },
            { filePath: '/wt/new.py', created: true, hunks: [] },
          ],
          moreFiles: 0,
        },
      },
    },
  )
  await $.tool.call({ tool: 'Bash', command: 'touch /tmp/f.txt' } as never)
  expect(held.edits).toEqual([
    { path: '/tmp/f.txt', at: 5000, via: 'shell' },
    { path: '/wt/old.py', at: 5000, via: 'shell', change: 'delete' },
    { path: '/wt/new.py', at: 5000, via: 'shell' },
  ])
})

test('unusable host diffs keep the disk fallback and unknown edits cause no state writes', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const held = watch(on)
  let writes = 0
  on('state.set', { plugin: 'rabe', key: 'edits' }, async (_$, e, next) => {
    writes++
    return next(e)
  })
  const diffs = [
    undefined,
    null,
    'bad',
    {},
    { changedFiles: 'bad' },
    ...['shared', 'skipped', 'unavailable'].map(flag => ({
      changedFiles: ['/wt/unknown.py'],
      files: [],
      moreFiles: 0,
      [flag]: true,
    })),
  ]
  const effects: Record<string, Effect> = {}
  const results: Record<string, Record<string, unknown>> = {}
  for (const [n, diff] of diffs.entries()) {
    results[`script-${n}`] = { bashEditDiff: diff }
    results[`touch /tmp/f${n}`] = { bashEditDiff: diff }
    effects[`touch /tmp/f${n}`] = disk => disk.set(`/tmp/f${n}`, file(2))
  }
  shell(on, effects, results)
  for (const n of diffs.keys()) await $.tool.call({ tool: 'Bash', command: `script-${n}` } as never)
  expect(writes).toBe(0)
  for (const n of diffs.keys())
    await $.tool.call({ tool: 'Bash', command: `touch /tmp/f${n}` } as never)
  expect(held.edits).toEqual(diffs.map((_, n) => ({ path: `/tmp/f${n}`, at: 5000, via: 'shell' })))
  expect(writes).toBe(diffs.length)
})

test('host diffs from interrupted, background, refused and failed calls are ignored', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const held = watch(on)
  const bashEditDiff = { changedFiles: ['/wt/server.py'], files: [], moreFiles: 0 }
  shell(
    on,
    {},
    {
      interrupted: { bashEditDiff, interrupted: true },
      background: { bashEditDiff, backgroundTaskId: 'b1' },
      fail: { bashEditDiff },
    },
  )
  for (const command of ['interrupted', 'background', 'deny', 'fail']) {
    await $.tool.call({ tool: 'Bash', command } as never)
  }
  expect(held.edits).toBeUndefined()
})

test('host paths survive a timed-out disk check and accept absolute Windows paths', async ($, on) => {
  const clock = mock.clock(on, { now: 5000 })
  const held = watch(on)
  const changedFiles = ['/wt/server.py', 'C:\\wt\\server.py', '\\\\host\\share\\server.py']
  shell(
    on,
    {},
    {
      'touch /tmp/hang': { bashEditDiff: { changedFiles, files: [null], moreFiles: 0 } },
    },
  )
  const run = $.tool.call({ tool: 'Bash', command: 'touch /tmp/hang' } as never)
  await clock.advance(1000)
  await run
  expect(held.edits?.map(one => one.path)).toEqual(changedFiles)
})

test('OR writes count only when the candidate changed on disk', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const held = watch(on)
  on('session.cwd', async () => ({ value: '/repo' }))
  const { disk } = shell(on, {
    'false || echo x > /tmp/f.txt': one => one.set('/tmp/f.txt', file(2)),
  })
  disk.set('/tmp/kept.txt', file(2))
  await $.tool.call({ tool: 'Bash', command: 'false || echo x > /tmp/f.txt' } as never)
  await $.tool.call({ tool: 'Bash', command: 'true || echo x > /tmp/kept.txt' } as never)
  expect(held.edits).toEqual([{ path: '/tmp/f.txt', at: 5000, via: 'shell' }])
})

test('shell calls read the current folder only for relative candidates', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const held = watch(on)
  let reads = 0
  on('session.cwd', async () => {
    reads++
    return { value: '/repo' }
  })
  shell(on, {
    'touch /tmp/f.txt': one => one.set('/tmp/f.txt', file(2)),
    'cd /known && touch f.txt': one => one.set('/known/f.txt', file(2)),
  })
  for (const command of [
    'true',
    'touch /tmp/f.txt',
    'cd /known && touch f.txt',
    'true || pushd /x; touch rel',
    'true || popd; touch rel',
  ]) {
    await $.tool.call({ tool: 'Bash', command } as never)
  }
  expect(reads).toBe(0)
  expect(held.edits).toEqual([
    { path: '/tmp/f.txt', at: 5000, via: 'shell' },
    { path: '/known/f.txt', at: 5000, via: 'shell' },
  ])
})

test('relative shell writes use the main session current folder', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const held = watch(on)
  let cwd = '/repo'
  on('session.cwd', async () => ({ value: cwd }))
  const { disk } = shell(on, {
    'echo x > f.txt': one => one.set('/repo/f.txt', file(2)),
    'false || echo x > f.txt': one => one.set('/other/f.txt', file(2)),
    'cd "$UNKNOWN"; echo x > skipped.txt': one => one.set('/other/skipped.txt', file(2)),
  })
  disk.set('/repo', dir)
  disk.set('/other', dir)
  await $.tool.call({ tool: 'Bash', command: 'echo x > f.txt' } as never)
  cwd = '/other'
  await $.tool.call({ tool: 'Bash', command: 'false || echo x > f.txt' } as never)
  await $.tool.call({ tool: 'Bash', command: 'true || echo x > f.txt' } as never)
  await $.tool.call({ tool: 'Bash', command: 'cd "$UNKNOWN"; echo x > skipped.txt' } as never)
  expect(held.edits).toEqual([
    { path: '/repo/f.txt', at: 5000, via: 'shell' },
    { path: '/other/f.txt', at: 5000, via: 'shell' },
  ])
})

test('relative shell writes use the agent cwd and never the main folder as a fallback', async ($, on) => {
  const held = engine(on, 'a1')
  on('session.cwd', async () => ({ value: '/repo' }))
  const { disk } = shell(on, {
    'echo x > f.txt': one => one.set('/repo/f.txt', file(2)),
    'echo x > plain.txt': one => one.set('/wt/a1/plain.txt', file(2)),
    'false || echo x > f.txt': one => one.set('/wt/a1/f.txt', file(2)),
  })
  disk.set('/repo', dir)
  disk.set('/wt/a1', dir)
  await $.agent.spawn(SPAWN)
  await $.tool.call({ tool: 'Bash', command: 'echo x > f.txt', agentId: 'a1' } as never)
  expect(((held.items ?? [])[0] as RabeItemOf<'agent'>).detail.edits).toBeUndefined()
  await $.classic.SubagentStart({
    agent_id: 'a1',
    agent_type: 'general-purpose',
    cwd: '/wt/a1',
    transcript_path: '/p/s1.jsonl',
  })
  await $.tool.call({ tool: 'Bash', command: 'echo x > plain.txt', agentId: 'a1' } as never)
  await $.tool.call({ tool: 'Bash', command: 'false || echo x > f.txt', agentId: 'a1' } as never)
  expect(((held.items ?? [])[0] as RabeItemOf<'agent'>).detail.edits).toEqual([
    { path: '/wt/a1/plain.txt', at: 5000, via: 'shell' },
    { path: '/wt/a1/f.txt', at: 5000, via: 'shell' },
  ])
  expect(held.edits).toBeUndefined()
})

test('an unknown main folder skips relative paths but still checks absolute paths', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const held = watch(on)
  on('session.cwd', async () => ({ deny: 'unknown folder' }))
  const { stats } = shell(on, {
    'echo x > f.txt': one => one.set('/repo/f.txt', file(2)),
    'echo x > /tmp/f.txt': one => one.set('/tmp/f.txt', file(2)),
  })
  await $.tool.call({ tool: 'Bash', command: 'echo x > f.txt' } as never)
  expect(stats).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'echo x > /tmp/f.txt' } as never)
  expect(held.edits).toEqual([{ path: '/tmp/f.txt', at: 5000, via: 'shell' }])
})

test('a background teammate writing files through Bash shows them as shell edits', async ($, on) => {
  const held = engine(on, 'a1')
  const { disk } = shell(on, {
    [HEREDOC]: one => {
      one.set('/home/u/.agents/skills/demo/SKILL.md', file(9))
      one.delete('/tmp/old.md')
    },
    'echo x > /tmp/failed.md && fail': one => one.set('/tmp/failed.md', file(2)),
    'echo x > /tmp/denied.md # deny': one => one.set('/tmp/denied.md', file(2)),
    'echo x > /tmp/serve.log; serve': one => one.set('/tmp/serve.log', file(2)),
  })
  disk.set('/tmp/old.md', file(3))
  await $.agent.spawn({ ...SPAWN, workflow: undefined })
  const run = (command: string) => $.tool.call({ tool: 'Bash', command, agentId: 'a1' } as never)
  await run(HEREDOC)
  await run('echo x > /tmp/failed.md && fail')
  await run('echo x > /tmp/denied.md # deny')
  await run('echo x > /tmp/serve.log; serve')
  await run('git status')
  const item = held.items?.[0] as RabeItemOf<'agent'>
  expect(item.detail.edits).toEqual([
    { path: '/home/u/.agents/skills/demo/SKILL.md', at: 5000, via: 'shell' },
    { path: '/tmp/old.md', at: 5000, via: 'shell', change: 'delete' },
  ])
})

test('the disk decides: masked failures, no-op modes, a folder target, multi-file sed', async ($, on) => {
  const held = engine(on, 'a1')
  const { disk } = shell(on, {
    'cp /tmp/src.txt /tmp/out': one => one.set('/tmp/out/src.txt', file(4)),
    "sed -i 'q' /tmp/a /tmp/b": one => one.set('/tmp/a', file(5, 2)),
    'export HOME=/tmp; touch ~/file': one => one.set('/tmp/file', file(0)),
  })
  disk.set('/tmp/src.txt', file(4))
  disk.set('/tmp/out', dir)
  disk.set('/tmp/a', file(5))
  disk.set('/tmp/b', file(5))
  await $.agent.spawn({ ...SPAWN, workflow: undefined })
  const run = (command: string) => $.tool.call({ tool: 'Bash', command, agentId: 'a1' } as never)
  await run('false && touch /tmp/never || true')
  await run('cp /tmp/missing /tmp/copy; true')
  await run('touch -c /tmp/absent')
  await run('rm -f /tmp/absent')
  await run('cp /tmp/src.txt /tmp/out')
  await run("sed -i 'q' /tmp/a /tmp/b")
  await run('export HOME=/tmp; touch ~/file')
  const item = held.items?.[0] as RabeItemOf<'agent'>
  expect(item.detail.edits).toEqual([
    { path: '/tmp/out/src.txt', at: 5000, via: 'shell' },
    { path: '/tmp/a', at: 5000, via: 'shell' },
  ])
})

test('too many candidates, stat errors and slow stats record nothing for those files', async ($, on) => {
  const clock = mock.clock(on, { now: 5000 })
  const held = watch(on)
  const many = Array.from({ length: 21 }, (_, n) => `/tmp/f${n}`).join(' ')
  const { disk, stats } = shell(on, {
    [`touch ${many}`]: one => {
      for (let n = 0; n < 21; n++) one.set(`/tmp/f${n}`, file(0))
    },
    'touch /tmp/locked /tmp/ok': one => one.set('/tmp/ok', file(0)),
    'touch /tmp/hang /tmp/slow': one => one.set('/tmp/slow', file(0)),
    'touch /tmp/private/f; chmod 000 /tmp/private': one => one.set('/tmp/private/f', LOCKED),
  })
  disk.set('/tmp/private/f', file(3))
  await $.tool.call({ tool: 'Bash', command: `touch ${many}` } as never)
  expect(stats).toEqual([])
  await $.tool.call({ tool: 'Bash', command: 'touch /tmp/locked /tmp/ok' } as never)
  const slow = $.tool.call({ tool: 'Bash', command: 'touch /tmp/hang /tmp/slow' } as never)
  await clock.advance(1000)
  await slow
  await $.tool.call({
    tool: 'Bash',
    command: 'touch /tmp/private/f; chmod 000 /tmp/private',
  } as never)
  expect(held.edits).toEqual([{ path: '/tmp/ok', at: 5000, via: 'shell' }])
})

test('a path is missing only when its folder lists without it', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const held = watch(on)
  const { disk } = shell(on, {
    'rm /tmp/hidden/a': one => one.set('/tmp/hidden/a', SPOOFED),
    'rm /tmp/plain; mkdir /tmp/plain; touch /tmp/plain/f': one => {
      one.delete('/tmp/plain')
      one.set('/tmp/plain/f', file(0))
    },
    'touch /tmp/gone': one => one.set('/tmp/gone', file(0)),
    'mkdir -p /tmp/new/deep; touch /tmp/new/deep/f': one => one.set('/tmp/new/deep/f', file(0)),
  })
  disk.set('/tmp/hidden/a', file(3))
  disk.set('/tmp/plain', file(1))
  const run = (command: string) => $.tool.call({ tool: 'Bash', command } as never)
  await run('rm /tmp/hidden/a')
  await run('rm /tmp/plain; mkdir /tmp/plain; touch /tmp/plain/f')
  await run('touch /tmp/gone')
  await run('mkdir -p /tmp/new/deep; touch /tmp/new/deep/f')
  expect(held.edits).toEqual([
    { path: '/tmp/gone', at: 5000, via: 'shell' },
    { path: '/tmp/new/deep/f', at: 5000, via: 'shell' },
  ])
})

test('a name the folder lists in another case is unknown, not missing', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const held = watch(on)
  const { disk } = shell(on, {
    // a case-insensitive disk: report.txt is Report.txt, and stat may no longer look at it
    'chmod 600 /tmp/box; rm /tmp/box/report.txt': one => {
      one.delete('/tmp/box/report.txt')
      one.set('/tmp/box/Report.txt', UNREAD)
    },
  })
  disk.set('/tmp/box/report.txt', file(3))
  await $.tool.call({
    tool: 'Bash',
    command: 'chmod 600 /tmp/box; rm /tmp/box/report.txt',
  } as never)
  expect(held.edits ?? []).toEqual([])
})

test('a name the folder lists in another Unicode form is unknown, not missing', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const held = watch(on)
  const composed = '/tmp/box/caf\u00e9.txt'
  const decomposed = '/tmp/box/cafe\u0301.txt'
  const { disk } = shell(on, {
    // the disk keeps the decomposed name; stat may no longer look at it
    [`chmod 600 /tmp/box; rm ${composed}`]: one => {
      one.delete(composed)
      one.set(decomposed, UNREAD)
    },
  })
  disk.set(composed, file(3))
  await $.tool.call({ tool: 'Bash', command: `chmod 600 /tmp/box; rm ${composed}` } as never)
  expect(held.edits ?? []).toEqual([])
})

test('main session writes and shell writes are kept apart from agents', async ($, on) => {
  const held = engine(on, 'a1')
  shell(on, {
    'echo x >> notes.txt': one => one.set('notes.txt', file(2)),
    'echo x > /tmp/main.md': one => one.set('/tmp/main.md', file(2)),
  })
  on('tool.call', { tool: 'Write' }, async () => ({
    result: { filePath: '/repo/plan.md' } as never,
  }))
  await $.tool.call({ tool: 'Write', file_path: '/repo/plan.md', content: '' } as never)
  await $.tool.call({ tool: 'Bash', command: 'echo x >> notes.txt' } as never)
  await $.tool.call({ tool: 'Bash', command: 'echo x > /tmp/main.md' } as never)
  expect(held.edits).toEqual([
    { path: '/repo/plan.md', at: 5000, via: 'write' },
    { path: '/tmp/main.md', at: 5000, via: 'shell' },
  ])
  expect(held.items ?? []).toEqual([])
})

test('a staged edit or write leaves the file unchanged and is not kept', async ($, on) => {
  const held = engine(on, 'a1')
  on('tool.call', { tool: ['Edit', 'Write'] }, async (_$, e) => {
    const filePath = e.tool === 'Edit' || e.tool === 'Write' ? e.file_path : ''

    return { result: { filePath, staged: filePath.includes('staged') } as never }
  })
  await $.agent.spawn(SPAWN)
  await $.tool.call({
    tool: 'Edit',
    file_path: '/repo/staged.ts',
    old_string: 'a',
    new_string: 'b',
    agentId: 'a1',
  } as never)
  await $.tool.call({
    tool: 'Write',
    file_path: '/repo/staged-new.ts',
    content: '',
    agentId: 'a1',
  } as never)
  await $.tool.call({
    tool: 'Edit',
    file_path: '/repo/db.ts',
    old_string: 'a',
    new_string: 'b',
    agentId: 'a1',
  } as never)
  const item = held.items?.[0] as RabeItemOf<'agent'>
  expect(item.detail.edits).toEqual([{ path: '/repo/db.ts', at: 5000, via: 'edit' }])
})

test('a step of a loop Rabe does not know writes nothing', async ($, on) => {
  const held = watch(on)
  // biome-ignore lint/correctness/useYield: the engine's stand-in answers without chunks
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'x',
      toolUses: [],
      stopReason: null,
      usage: null,
    }
  })
  for await (const _ of $.turn.step({
    turnId: 't',
    index: 0,
    model: 'm',
    messageCount: 1,
    agentId: 'fork',
  }));
  expect(held.items).toBeUndefined()
})

test('the poll adds listed agents and reads the meta file of running ones', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const held = watch(on)
  on('session.start', async () => ({ cwd: '/p' }))
  on('command.register', async () => ({ value: { command: 'rabe' } }))
  on('classic.SubagentStart', async () => ({}))
  on('agent.list', async () => ({
    value: [
      {
        id: 'a1',
        name: 'impl-logger',
        description: 'migrate logger',
        type: 'Explore',
        status: 'running' as const,
      },
      { id: 'a2', description: 'plan', type: 'Plan', status: 'completed' as const, parentId: 'a1' },
    ],
  }))
  on('fs.stat', async () => ({ value: { kind: 'file', size: 100, mtimeMs: 1, isLink: false } }))
  on('fs.read', async (_$, e) =>
    e.path === '/p/s1/subagents/agent-a1.meta.json'
      ? { value: '{"worktreePath":"/wt/a1","worktreeBranch":"wt-a1"}' }
      : { deny: 'missing' },
  )
  on('session.cwd', async () => ({ value: '/p' }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await $.classic.SubagentStart({
    agent_id: 'a1',
    agent_type: 'Explore',
    transcript_path: '/p/s1.jsonl',
  })
  await clock.advance(4000)

  const list = held.items ?? []
  expect(list.map(one => [one.id, one.status, one.parentId])).toEqual([
    ['agent:a1', 'running', undefined],
    ['agent:a2', 'done', 'agent:a1'],
  ])
  expect(list[0]?.detail).toMatchObject({ worktreePath: '/wt/a1', worktreeBranch: 'wt-a1' })
  expect(list[0]).toMatchObject({ title: 'impl-logger', detail: { name: 'impl-logger' } })
})

test('the poll reads phase metadata for workflow agents that already ended', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const workflow: RabeItem = {
    id: 'workflow:wf_1',
    kind: 'workflow',
    title: 'review',
    status: 'done',
    seenAt: 900,
    endedAt: 900,
    detail: { runId: 'wf_1', scriptPath: '/p/workflows/scripts/wf_1.js', phases: ['Draft'] },
  }
  const endedAgent: RabeItem = {
    ...agent,
    status: 'done',
    endedAt: 900,
    parentId: workflow.id,
  }
  state['rabe.items'] = { value: [workflow, endedAgent], version: 1 }
  core(on)
  on('agent.list', async () => ({
    value: [{ id: 'a1', description: 'draft', type: 'workflow-subagent', status: 'completed' }],
  }))
  on('fs.stat', async () => ({ value: { kind: 'file', size: 100, mtimeMs: 1, isLink: false } }))
  on('fs.read', async (_$, e) =>
    e.path === '/p/subagents/workflows/wf_1/agent-a1.meta.json'
      ? { value: '{"workflowPhase":"Draft"}' }
      : { deny: 'missing' },
  )

  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })

  expect(state['rabe.items']?.value).toEqual([
    workflow,
    { ...endedAgent, detail: { ...endedAgent.detail, workflowPhase: 'Draft' } },
  ])
  const written = state['rabe.items']
  await clock.advance(3000)
  expect(state['rabe.items']).toBe(written)
})

test('the poll stops retrying ended workflow agents when the workflow has no phases', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const workflow: RabeItem = {
    id: 'workflow:wf_1',
    kind: 'workflow',
    title: 'review',
    status: 'done',
    seenAt: 900,
    detail: { runId: 'wf_1', scriptPath: '/p/workflows/scripts/wf_1.js', phases: [] },
  }
  state['rabe.items'] = {
    value: [workflow, { ...agent, status: 'done', endedAt: 900, parentId: workflow.id }],
    version: 1,
  }
  core(on)
  on('agent.list', async () => ({ value: [] }))
  const reads: string[] = []
  on('fs.read', async (_$, e) => {
    reads.push(e.path)
    return { deny: 'missing' }
  })

  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await clock.advance(3000)

  expect(reads).toEqual([])
})

function completed(count: number) {
  return Array.from({ length: count }, (_, n) => ({
    id: `a${n}`,
    description: `a${n}`,
    type: 'Explore',
    status: 'completed' as const,
  }))
}

function ended(count: number, from = 0): RabeItem[] {
  return Array.from({ length: count }, (_, n) => ({
    id: `agent:w${n + from}`,
    kind: 'agent',
    title: `w${n + from}`,
    status: 'done',
    seenAt: 10 + n,
    endedAt: 10 + n,
    detail: { agentId: `w${n + from}` },
  }))
}

for (const count of [MAX_ENDED + 1, 1201, 5000]) {
  test(`an unchanged poll of ${count} completed agents writes nothing after the first`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const state = memoryState(on)
    core(on)
    on('agent.list', async () => ({ value: completed(count) }))
    await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
    const first = state['rabe.items']
    expect(first?.version).toBe(1)
    expect(first?.value).toHaveLength(MAX_ENDED)

    await clock.advance(3000)
    await clock.advance(3000)
    expect(state['rabe.items']).toBe(first)
  })
}

test('listed agents Rabe did not watch never push out the history it watched', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  state['rabe.items'] = { value: ended(MAX_ENDED - 50), version: 1 }
  core(on)
  on('agent.list', async () => ({ value: completed(1201) }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  const items = state['rabe.items']?.value as RabeItem[]
  expect(items.slice(0, MAX_ENDED - 50)).toEqual(ended(MAX_ENDED - 50))
  expect(items.slice(MAX_ENDED - 50).map(item => item.id)).toEqual(
    completed(50).map(one => `agent:${one.id}`),
  )
  const first = state['rabe.items']
  await clock.advance(3000)
  expect(state['rabe.items']).toBe(first)
})

test('a poll that ends an agent drops the turns and lines of what the cap pushes out', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const running: RabeItem = { ...agent, id: 'agent:r', detail: { agentId: 'r' } }
  state['rabe.items'] = { value: [...ended(MAX_ENDED), running], version: 1 }
  const lines = { seen: 1, lines: [{ at: 1, text: 'ready' }] }
  state['rabe.lines'] = { value: { 'agent:w0': lines, 'agent:w1': lines }, version: 1 }
  state['rabe.turns'] = { value: { 'agent:w0': [turn(1)], 'agent:w1': [turn(1)] }, version: 1 }
  core(on)
  let listed: { id: string; description: string; type: string; status: AgentStatus }[] = []
  on('agent.list', async () => ({ value: listed }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })

  // The timer's poll ends agent r: the oldest ended agent, w0, leaves with its state.
  listed = [{ id: 'r', description: 'r', type: 'Explore', status: 'completed' }]
  await clock.advance(4000)
  const items = state['rabe.items']?.value as RabeItem[]
  expect(items.some(item => item.id === 'agent:w0')).toBe(false)
  expect(state['rabe.turns']?.value).toEqual({ 'agent:w1': [turn(1)] })
  expect(state['rabe.lines']?.value).toEqual({ 'agent:w1': lines })
})

test('a poll that lists an ended agent as running again puts it back to running', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  const done: RabeItem = { ...agent, status: 'done', endedAt: 900 }
  state['rabe.items'] = { value: [done], version: 1 }
  core(on)
  let status: AgentStatus = 'idle'
  on('agent.list', async () => ({
    value: [{ id: 'a1', description: 'verify:db.ts', type: 'Explore', status }],
  }))
  // A teammate is idle after each turn, which already ended its item.
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  expect(state['rabe.items']?.value).toEqual([done])

  status = 'running'
  await clock.advance(4000)
  expect(state['rabe.items']?.value).toEqual([{ ...agent, status: 'running' }])
})

test('an agent the cap dropped comes back when the list shows it running', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  core(on)
  let listed: { id: string; description: string; type: string; status: AgentStatus }[] =
    completed(5000)
  on('agent.list', async () => ({ value: listed }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  expect(state['rabe.items']?.value).toHaveLength(MAX_ENDED)
  expect(
    ((state['rabe.items']?.value ?? []) as RabeItem[]).some(item => item.id === 'agent:a4000'),
  ).toBe(false)

  listed = listed.map(one => (one.id === 'a4000' ? { ...one, status: 'running' } : one))
  await clock.advance(4000)
  const items = state['rabe.items']?.value as RabeItem[]
  expect(items.find(item => item.id === 'agent:a4000')?.status).toBe('running')
  expect(items).toHaveLength(MAX_ENDED + 1)
})

const PRICES = [
  '# test prices',
  'provider,model,aliases,input,output,cache_read,cache_write_5m',
  'claude,claude-opus-5-5,,4,20,0.2,5',
].join('\n')

// The plugin's own table and the user's files, as fs.read answers them.
function priceFiles(on: On, own: Record<string, string> = {}): string[] {
  const asked: string[] = []
  on('fs.read', async (_$, e, next) => {
    asked.push(e.path)
    if (e.path.endsWith('/data/prices.csv')) return { value: PRICES }
    if (e.path in own) return { value: own[e.path] ?? '' }
    return next(e)
  })

  return asked
}

// The engine's stand-in for a step per model, registered before the test's first call on `$`.
function stepper(on: On, models: string[]) {
  // biome-ignore lint/correctness/useYield: the engine's stand-in answers without chunks
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn' as const,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 10,
        model: models[e.index] ?? '',
      },
    }
  })

  return async ($: Engine) => {
    for (let index = 0; index < models.length; index++) {
      const stream = $.turn.step({
        turnId: 't1',
        index,
        model: 'm',
        messageCount: 1,
        agentId: 'a1',
      })
      for await (const _ of stream);
    }
  }
}

// 100 in at 4, 50 read at 0.2, 10 written at 5, 20 out at 20, per million
const STEP_USD = (100 * 4 + 50 * 0.2 + 10 * 5 + 20 * 20) / 1e6

test('each step adds its price to the agent cost', async ($, on) => {
  const held = engine(on, 'a1')
  const asked = priceFiles(on)
  const run = stepper(on, ['claude-opus-5-5', 'claude-opus-5-5'])
  await $.agent.spawn(SPAWN)
  await run($)
  expect(held.items?.[0]?.costUsd).toBe(2 * STEP_USD)
  expect(asked.every(path => path.endsWith('/data/prices.csv'))).toBe(true)
})

test('a step of a model without a price leaves the agent cost n/a for good', async ($, on) => {
  const held = engine(on, 'a1')
  priceFiles(on)
  const run = stepper(on, ['claude-opus-5-5', 'claude-new-9', 'claude-opus-5-5'])
  await $.agent.spawn(SPAWN)
  await run($)
  expect(held.items?.[0]?.tokens).toMatchObject({ output: 60 })
  expect(held.items?.[0]?.costUsd).toBeUndefined()
})

test('an agent Rabe did not see start has no cost', async ($, on) => {
  const state = memoryState(on)
  mock.clock(on, { now: 5000 })
  priceFiles(on)
  const run = stepper(on, ['claude-opus-5-5'])
  state['rabe.items'] = { value: [{ ...agent, startedAt: undefined }], version: 1 }
  await run($)
  const [item] = state['rabe.items'].value as RabeItem[]
  expect(item?.tokens).toMatchObject({ output: 20 })
  expect(item?.costUsd).toBeUndefined()
})

test(
  "the user's price file comes first",
  { options: { pricesFile: '~/prices.csv' } },
  async ($, on) => {
    const held = engine(on, 'a1')
    mock.env(on, { HOME: '/home/u' })
    priceFiles(on, {
      '/home/u/prices.csv': 'provider,model,input,output\nclaude,claude-opus-5-5,1,1\n',
    })
    const run = stepper(on, ['claude-opus-5-5'])
    await $.agent.spawn(SPAWN)
    await run($)
    expect(held.items?.[0]?.costUsd).toBe(180 / 1e6)
  },
)

test(
  'a price file that cannot be read makes the cost n/a',
  { options: { pricesFile: '/gone.csv' } },
  async ($, on) => {
    const held = engine(on, 'a1')
    priceFiles(on)
    const run = stepper(on, ['claude-opus-5-5'])
    await $.agent.spawn(SPAWN)
    await run($)
    expect(held.items?.[0]?.tokens).toBeDefined()
    expect(held.items?.[0]?.costUsd).toBeUndefined()
  },
)
const COMPANION = 'node "/p/codex/1.0.6/scripts/codex-companion.mjs" task --write'

test("an agent's companion calls keep their start, end and the job or thread they named", async ($, on) => {
  const clock = mock.clock(on, { now: 5000 })
  const state = memoryState(on)
  mock.env(on, { HOME: '/home/u' })
  on('agent.spawn', async () => ({ model: 'claude-sonnet-5-5', agentId: 'f1' }))
  on('tool.call', { tool: 'Bash' }, async (_$, e) => {
    const command = e.tool === 'Bash' ? e.command : ''
    await clock.advance(700)
    if (command.includes('"bg"')) {
      const stdout = 'Codex Task started in the background as task-mg1-ab. Check /codex:status.\n'
      return { result: { stdout, stderr: '', interrupted: false } as never }
    }
    if (command.includes('"long"')) {
      return { result: { stdout: '', stderr: '', backgroundTaskId: 'b7' } as never }
    }
    if (command.includes('"deny"')) return { deny: 'no' }
    if (command.includes('"oops"')) {
      const stderr = '[codex] Thread ready (th-8).\nTurn failed.'
      return { result: { stdout: '', stderr } as never, isError: true }
    }
    const stderr = '[codex] Starting Codex task thread.\n[codex] Thread ready (th-9).\n'
    return { result: { stdout: 'Fixed.', stderr, interrupted: false } as never }
  })
  await $.agent.spawn({ ...SPAWN, workflow: undefined })
  const run = (command: string, agentId?: string) =>
    $.tool.call({ tool: 'Bash', command, ...(agentId && { agentId }) } as never)
  await run(`${COMPANION} "fg"`, 'f1')
  await run(`${COMPANION} "bg"`, 'f1')
  await run(`${COMPANION} "long"`, 'f1')
  await run(`${COMPANION} "deny"`, 'f1')
  await run(`${COMPANION} "oops"`, 'f1')
  await run(`${COMPANION} "main"`)
  await run('git status', 'f1')
  const [item] = (state['rabe.items']?.value ?? []) as RabeItemOf<'agent'>[]
  expect(item?.detail.codexCalls).toEqual([
    { at: 5000, command: 'task', text: `${COMPANION} "fg"`, endedAt: 5700, threadId: 'th-9' },
    { at: 5700, command: 'task', text: `${COMPANION} "bg"`, endedAt: 6400, jobId: 'task-mg1-ab' },
    { at: 6400, command: 'task', text: `${COMPANION} "long"` },
    { at: 7100, command: 'task', text: `${COMPANION} "deny"`, endedAt: 7800 },
    { at: 7800, command: 'task', text: `${COMPANION} "oops"`, endedAt: 8500, threadId: 'th-8' },
  ])
})

declare const console: { log(message: string): void }

test('time unchanged polls of 5000 completed agents', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  core(on)
  const agents = completed(5000)
  let calls = 0
  on('agent.list', async () => {
    calls++
    return { value: agents }
  })
  state['rabe.items'] = {
    value: agents.slice(0, MAX_ENDED).map(info => ({
      id: `agent:${info.id}`,
      kind: 'agent',
      title: info.description,
      status: 'done',
      seenAt: 1000,
      endedAt: 1000,
      detail: { agentId: info.id, type: info.type, description: info.description },
    })),
    version: 1,
  }
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await clock.advance(0)
  const first = state['rabe.items']
  const before = calls
  const started = Date.now()
  for (let n = 0; n < 3; n++) await clock.advance(10000)
  const elapsed = Date.now() - started
  expect(state['rabe.items']).toBe(first)
  expect(calls).toBeGreaterThan(before)
  console.log(
    `5000-agent unchanged poll: ${elapsed / (calls - before)} ms/poll (${calls - before} polls)`,
  )
})

for (const end of ['completed', 'failed', 'killed'] as const) {
  test(`a teammate goes idle, wakes and ends only on ${end}`, async ($, on) => {
    const clock = mock.clock(on, { now: 5000 })
    const state = memoryState(on)
    core(on)
    on('agent.spawn', async () => ({ model: 'm', agentId: 'a1' }))
    on('turn.complete', async () => ({ text: '' }))
    let status: AgentStatus = 'running'
    let canList = false
    on('agent.list', async () =>
      canList
        ? {
            value: [
              {
                id: 'a1',
                type: 'teammate',
                description: 'scout',
                status,
              },
            ],
          }
        : { deny: 'unavailable' },
    )
    await $.agent.spawn({ ...SPAWN, workflow: undefined, isTeammate: true })
    await $.turn.complete({
      agentId: 'a1',
      turnId: 't',
      answer: 'ready',
      reason: 'answer',
      durationMs: 10,
      isAborted: false,
    })
    let item = ((state['rabe.items']?.value ?? []) as RabeItem[])[0]
    expect(item?.status).toBe('idle')
    expect(item?.endedAt).toBeUndefined()
    status = 'idle'
    canList = true
    await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
    const unchanged = state['rabe.items']
    await clock.advance(4000)
    expect(state['rabe.items']).toBe(unchanged)
    status = 'running'
    await clock.advance(4000)
    item = ((state['rabe.items']?.value ?? []) as RabeItem[])[0]
    expect(item?.status).toBe('running')
    expect(item?.startedAt).toBe(5000)
    expect(item?.endedAt).toBeUndefined()
    status = 'idle'
    await clock.advance(4000)
    status = end
    await clock.advance(4000)
    item = ((state['rabe.items']?.value ?? []) as RabeItem[])[0]
    expect(item?.status).toBe({ completed: 'done', failed: 'failed', killed: 'stopped' }[end])
    expect(item?.endedAt).toBe(21000)
  })
}

test('the poll finds an unwatched idle teammate even with a full ended history', async ($, on) => {
  const clock = mock.clock(on, { now: 5000 })
  const state = memoryState(on)
  state['rabe.items'] = { value: ended(MAX_ENDED), version: 1 }
  core(on)
  on('agent.list', async () => ({
    value: [
      {
        id: 'idle',
        type: 'teammate',
        description: 'scout',
        status: 'idle',
        teammateId: 'scout@team',
      },
      { id: 'held', type: 'Explore', description: 'held on work', status: 'waiting' },
    ],
  }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  const items = state['rabe.items']?.value as RabeItem[]
  expect(items).toHaveLength(MAX_ENDED + 2)
  expect(items.find(item => item.id === 'agent:idle')).toMatchObject({
    status: 'idle',
    seenAt: 5000,
  })
  expect(items.find(item => item.id === 'agent:idle')?.endedAt).toBeUndefined()
  expect(items.find(item => item.id === 'agent:held')?.status).toBe('running')
  const unchanged = state['rabe.items']
  await clock.advance(4000)
  expect(state['rabe.items']).toBe(unchanged)
})

for (const initial of ['running', 'done'] as const) {
  test(`a plain subagent reporting idle keeps its ${initial} state`, async ($, on) => {
    const clock = mock.clock(on, { now: 5000 })
    const state = memoryState(on)
    const held: RabeItem = {
      ...agent,
      status: initial,
      ...(initial === 'done' && { endedAt: 900 }),
    }
    state['rabe.items'] = { value: [held], version: 1 }
    core(on)
    on('agent.list', async () => ({
      value: [
        { id: 'a1', type: 'Explore', description: 'verify:db.ts', status: 'idle' },
        { id: 'unwatched', type: 'Explore', description: 'plain', status: 'idle' },
      ],
    }))
    await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
    await clock.advance(4000)
    const items = state['rabe.items']?.value as RabeItem[]
    expect(items.find(item => item.id === held.id)).toEqual(held)
    expect(items.find(item => item.id === 'agent:unwatched')?.status).toBe('running')
    expect(items.some(item => item.status === 'idle')).toBe(false)
  })
}

test('the roster restores an ended teammate to idle and identifies it at turn completion', async ($, on) => {
  mock.clock(on, { now: 5000 })
  const state = memoryState(on)
  state['rabe.items'] = { value: [{ ...agent, status: 'done', endedAt: 900 }], version: 1 }
  core(on)
  on('agent.list', async () => ({
    value: [
      {
        id: 'a1',
        type: 'Explore',
        description: 'verify:db.ts',
        status: 'idle',
        teammateId: 'scout@team',
      },
    ],
  }))
  on('turn.complete', async () => ({ text: '' }))
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  let item = ((state['rabe.items']?.value ?? []) as RabeItem[])[0]
  expect(item?.status).toBe('idle')
  expect(item?.endedAt).toBeUndefined()
  expect(item?.kind === 'agent' && item.detail.isTeammate).toBe(true)
  state['rabe.items'] = { value: [agent], version: 3 }
  await $.turn.complete({
    agentId: 'a1',
    turnId: 't',
    answer: 'ready',
    reason: 'answer',
    durationMs: 10,
    isAborted: false,
  })
  item = ((state['rabe.items']?.value ?? []) as RabeItem[])[0]
  expect(item?.status).toBe('idle')
  expect(item?.endedAt).toBeUndefined()
})

test('a plain subagent that reports idle stays running in the poll and ends on its turn', async ($, on) => {
  const clock = mock.clock(on, { now: 5000 })
  const state = memoryState(on)
  core(on)
  on('agent.spawn', async () => ({ model: 'm', agentId: 'a1' }))
  on('agent.list', async () => ({
    value: [{ id: 'a1', type: 'Explore', description: 'verify:db.ts', status: 'idle' }],
  }))
  on('turn.complete', async () => ({ text: '' }))
  await $.agent.spawn({ ...SPAWN, workflow: undefined })
  await $.session.start({ cwd: '/p', surface: 'terminal', isInteractive: true })
  await clock.advance(4000)
  expect(((state['rabe.items']?.value ?? []) as RabeItem[])[0]?.status).toBe('running')
  await $.turn.complete({
    agentId: 'a1',
    turnId: 't',
    answer: 'ready',
    reason: 'answer',
    durationMs: 10,
    isAborted: false,
  })
  expect(((state['rabe.items']?.value ?? []) as RabeItem[])[0]).toMatchObject({
    status: 'done',
    endedAt: 9000,
  })
})

for (const available of [true, false]) {
  test(`agent metadata is cached and refreshed with inode lookup ${available ? 'available' : 'unavailable'}`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const state = memoryState(on)
    core(on)
    state['rabe.items'] = {
      value: [{ ...agent, detail: { ...agent.detail, transcriptPath: '/s/agent-a1.jsonl' } }],
      version: 1,
    }
    on('agent.list', async () => ({ value: [{ id: 'a1', status: 'running' }] }) as never)
    let text = '{"cwd":"/work/a"}'
    let mtimeMs = 1
    let reads = 0
    let spawns = 0
    on('fs.stat', async () => ({
      value: { kind: 'file', size: text.length, mtimeMs, isLink: false },
    }))
    on('process.run', { argv: 'ls' }, async () => {
      spawns++
      return available
        ? ({ value: { exitCode: 0, stdout: '1 file\n', stderr: '' } } as never)
        : { deny: 'No process host' }
    })
    on('fs.read', async () => {
      reads++
      return { value: text }
    })
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
    const first = state['rabe.agentFiles']
    await clock.advance(4000)
    expect(reads).toBe(1)
    expect(spawns).toBe(0)
    expect(state['rabe.agentFiles']).toBe(first)
    expect(state['rabe.diag']?.value).toMatchObject({
      agents: { files: 0, bytes: 0, skipped: 1, errors: 0 },
    })
    text = '{"cwd":"/work/b"}'
    mtimeMs++
    await clock.advance(4000)
    expect(reads).toBe(2)
    expect(state['rabe.diag']?.value).toMatchObject({
      agents: { files: 1, bytes: text.length, skipped: 0, errors: 0 },
    })
    expect(spawns).toBe(0)
    expect(((state['rabe.items']?.value ?? []) as RabeItem[])[0]?.detail).toMatchObject({
      cwd: '/work/b',
    })
  })
}

for (const status of ['running', 'done'] as const) {
  test(`an unchanged ${status} agent poll keeps newer event metadata`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const state = memoryState(on)
    core(on)
    on('agent.list', async () => ({ value: [] }))
    on('classic.SubagentStart', async () => ({}))
    on('turn.complete', async () => ({ text: '' }))
    const log: string[] = []
    files(on, { '/s/agent-a1.meta.json': '{"cwd":"/old-tree"}' }, log)
    state['rabe.items'] = {
      value: [{ ...agent, detail: { ...agent.detail, transcriptPath: '/s/agent-a1.jsonl' } }],
      version: 1,
    }
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
    if (status === 'done') {
      await $.turn.complete({
        agentId: 'a1',
        turnId: 't',
        answer: '',
        reason: 'answer',
        durationMs: 10,
        isAborted: false,
      })
    }
    await $.classic.SubagentStart({
      agent_id: 'a1',
      agent_type: 'Explore',
      transcript_path: '/s/agent-a1.jsonl',
      cwd: '/newer-tree',
    })
    await clock.advance(4000)
    expect((state['rabe.items']?.value as RabeItem[])?.[0]).toMatchObject({
      status,
      detail: { cwd: '/newer-tree' },
    })
    expect(log).toEqual(['read /s/agent-a1.meta.json'])
  })
}

test('an unchanged agent poll recovers metadata after a failed first publication', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  let reject = true
  on('state.set', { key: 'items' }, async (_$, e, next) => {
    if (reject) {
      reject = false
      return { deny: 'item write failed' }
    }
    return next(e)
  })
  const state = memoryState(on)
  core(on)
  on('agent.list', async () => ({ value: [] }))
  const log: string[] = []
  files(on, { '/s/agent-a1.meta.json': '{"cwd":"/old-tree","worktreeBranch":"agent-a1"}' }, log)
  state['rabe.items'] = {
    value: [{ ...agent, detail: { ...agent.detail, transcriptPath: '/s/agent-a1.jsonl' } }],
    version: 1,
  }
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
  expect((state['rabe.items']?.value as RabeItem[])?.[0]?.detail).not.toHaveProperty('cwd')
  await clock.advance(4000)
  expect((state['rabe.items']?.value as RabeItem[])?.[0]?.detail).toMatchObject({
    cwd: '/old-tree',
    worktreeBranch: 'agent-a1',
  })
  expect(log).toEqual(['read /s/agent-a1.meta.json'])
})

for (const status of ['running', 'done'] as const) {
  test(`an unchanged ${status} agent poll recovers changed metadata after a failed publication`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    let reject = false
    on('state.set', { key: 'items' }, async (_$, e, next) => {
      if (reject) {
        reject = false
        return { deny: 'item write failed' }
      }
      return next(e)
    })
    const state = memoryState(on)
    core(on)
    let completed = false
    on(
      'agent.list',
      async () => ({ value: [{ id: 'a1', status: completed ? 'completed' : 'running' }] }) as never,
    )
    const log: string[] = []
    const metadata = { '/s/agent-a1.meta.json': '{"cwd":"/old-tree"}' }
    files(on, metadata, log)
    state['rabe.items'] = {
      value: [{ ...agent, detail: { ...agent.detail, transcriptPath: '/s/agent-a1.jsonl' } }],
      version: 1,
    }
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
    metadata['/s/agent-a1.meta.json'] = '{"cwd":"/new-tree","worktreeBranch":"agent-a1"}'
    reject = true
    await clock.advance(4000)
    expect((state['rabe.items']?.value as RabeItem[])?.[0]?.detail).toMatchObject({
      cwd: '/old-tree',
    })
    completed = status === 'done'
    await clock.advance(4000)
    expect((state['rabe.items']?.value as RabeItem[])?.[0]).toMatchObject({
      status,
      detail: { cwd: '/new-tree', worktreeBranch: 'agent-a1' },
    })
    expect(state['rabe.agentFiles']?.value).toEqual({
      'agent:a1': {
        path: '/s/agent-a1.meta.json',
        size: metadata['/s/agent-a1.meta.json'].length,
        mtimeMs: 0,
        data: { cwd: '/new-tree', worktreeBranch: 'agent-a1' },
        before: { cwd: '/old-tree' },
      },
    })
    expect(log).toEqual(['read /s/agent-a1.meta.json', 'read /s/agent-a1.meta.json'])
  })

  test(`a changed agent poll keeps newer ${status} event metadata before publication and on replay`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    let paused = false
    on('state.set', { key: 'agentFiles' }, async (_$, e, next) => {
      const result = await next(e)
      if (paused) {
        paused = false
        await $.classic.SubagentStart({
          agent_id: 'a1',
          agent_type: 'Explore',
          transcript_path: '/s/agent-a1.jsonl',
          cwd: '/newer-tree',
        })
        if (status === 'done') {
          await $.turn.complete({
            agentId: 'a1',
            turnId: 't',
            answer: '',
            reason: 'answer',
            durationMs: 10,
            isAborted: false,
          })
        }
      }
      return result
    })
    const state = memoryState(on)
    core(on)
    on('agent.list', async () => ({ value: [] }))
    on('classic.SubagentStart', async () => ({}))
    on('turn.complete', async () => ({ text: '' }))
    const log: string[] = []
    const metadata = { '/s/agent-a1.meta.json': '{"cwd":"/old-tree"}' }
    files(on, metadata, log)
    state['rabe.items'] = {
      value: [{ ...agent, detail: { ...agent.detail, transcriptPath: '/s/agent-a1.jsonl' } }],
      version: 1,
    }
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
    metadata['/s/agent-a1.meta.json'] = '{"cwd":"/new-tree","worktreeBranch":"agent-a1"}'
    paused = true
    await clock.advance(4000)
    expect(paused).toBe(false)
    expect((state['rabe.items']?.value as RabeItem[])?.[0]).toMatchObject({
      status,
      detail: { cwd: '/newer-tree', worktreeBranch: 'agent-a1' },
    })
    await clock.advance(4000)
    expect((state['rabe.items']?.value as RabeItem[])?.[0]).toMatchObject({
      status,
      detail: { cwd: '/newer-tree', worktreeBranch: 'agent-a1' },
    })
    expect(log).toEqual(['read /s/agent-a1.meta.json', 'read /s/agent-a1.meta.json'])
  })
}

test('an agent metadata cache without before fills only missing fields', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  const state = memoryState(on)
  core(on)
  on('agent.list', async () => ({ value: [] }))
  const log: string[] = []
  const text = '{"cwd":"/old-tree","worktreeBranch":"agent-a1"}'
  files(on, { '/s/agent-a1.meta.json': text }, log)
  state['rabe.items'] = {
    value: [
      {
        ...agent,
        detail: { ...agent.detail, transcriptPath: '/s/agent-a1.jsonl', cwd: '/newer-tree' },
      },
    ],
    version: 1,
  }
  state['rabe.agentFiles'] = {
    value: {
      'agent:a1': {
        path: '/s/agent-a1.meta.json',
        size: text.length,
        mtimeMs: 0,
        data: { cwd: '/old-tree', worktreeBranch: 'agent-a1' },
      },
    },
    version: 1,
  }
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
  await clock.advance(4000)
  expect((state['rabe.items']?.value as RabeItem[])?.[0]?.detail).toMatchObject({
    cwd: '/newer-tree',
    worktreeBranch: 'agent-a1',
  })
  expect(log).toEqual([])
})

test('a discarded agent pass replays changed metadata without another read', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  let restart = false
  on('state.set', { key: 'agentFiles' }, async (_$, e, next) => {
    const result = await next(e)
    if (restart) {
      restart = false
      await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
    }
    return result
  })
  const state = memoryState(on)
  core(on)
  on('agent.list', async () => ({ value: [] }))
  const log: string[] = []
  const metadata = { '/s/agent-a1.meta.json': '{"cwd":"/old-tree"}' }
  files(on, metadata, log)
  state['rabe.items'] = {
    value: [{ ...agent, detail: { ...agent.detail, transcriptPath: '/s/agent-a1.jsonl' } }],
    version: 1,
  }
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
  metadata['/s/agent-a1.meta.json'] = '{"cwd":"/new-tree","worktreeBranch":"agent-a1"}'
  restart = true
  await clock.advance(4000)
  expect(restart).toBe(false)
  expect((state['rabe.items']?.value as RabeItem[])?.[0]?.detail).toMatchObject({
    cwd: '/new-tree',
  })
  expect(log).toEqual(['read /s/agent-a1.meta.json', 'read /s/agent-a1.meta.json'])
})

test('a discarded agent pass replays cached metadata without another read', async ($, on) => {
  mock.clock(on, { now: 1000 })
  let restart = true
  on('state.set', { key: 'agentFiles' }, async (_$, e, next) => {
    const result = await next(e)
    if (restart) {
      restart = false
      await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
    }
    return result
  })
  const state = memoryState(on)
  core(on)
  on('agent.list', async () => ({ value: [] }))
  const log: string[] = []
  files(on, { '/s/agent-a1.meta.json': '{"cwd":"/work/a"}' }, log)
  state['rabe.items'] = {
    value: [{ ...agent, detail: { ...agent.detail, transcriptPath: '/s/agent-a1.jsonl' } }],
    version: 1,
  }
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
  expect(restart).toBe(false)
  expect((state['rabe.items']?.value as RabeItem[])?.[0]?.detail).toMatchObject({ cwd: '/work/a' })
  expect(log).toEqual(['read /s/agent-a1.meta.json'])
})

for (const broken of [
  null,
  [],
  'bad',
  { 'agent:a1': { path: '/s/agent-a1.meta.json', size: 17, mtimeMs: 0, data: null } },
  {
    'agent:a1': {
      path: '/s/agent-a1.meta.json',
      size: 17,
      mtimeMs: 0,
      data: { cwd: '/bad' },
      before: null,
    },
  },
]) {
  test(`agents rebuild malformed metadata caches ${JSON.stringify(broken)}`, async ($, on) => {
    const clock = mock.clock(on, { now: 1000 })
    const state = memoryState(on)
    core(on)
    on('agent.list', async () => ({ value: [] }))
    files(on, { '/s/agent-a1.meta.json': '{"cwd":"/work/a"}' })
    state['rabe.items'] = {
      value: [{ ...agent, detail: { ...agent.detail, transcriptPath: '/s/agent-a1.jsonl' } }],
      version: 1,
    }
    state['rabe.agentFiles'] = { value: broken, version: 1 }
    await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
    await clock.advance(4000)
    expect(((state['rabe.items']?.value ?? []) as RabeItem[])[0]?.detail).toMatchObject({
      cwd: '/work/a',
    })
  })
}

test('an agent ending after a discarded pass still gets its cached metadata', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  let reject = true
  on('state.set', { key: 'items' }, async (_$, e, next) => {
    if (reject) {
      reject = false
      return { deny: 'item write failed' }
    }
    return next(e)
  })
  const state = memoryState(on)
  core(on)
  let completed = false
  on(
    'agent.list',
    async () => ({ value: [{ id: 'a1', status: completed ? 'completed' : 'running' }] }) as never,
  )
  files(on, { '/s/agent-a1.meta.json': '{"cwd":"/work/a"}' })
  state['rabe.items'] = {
    value: [{ ...agent, detail: { ...agent.detail, transcriptPath: '/s/agent-a1.jsonl' } }],
    version: 1,
  }
  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: false })
  completed = true
  await clock.advance(4000)
  expect((state['rabe.items']?.value as RabeItem[])?.[0]).toMatchObject({
    status: 'done',
    detail: { cwd: '/work/a' },
  })
})
