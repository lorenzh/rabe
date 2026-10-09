import type { AgentSpawnInput, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { RabeItem, RabeTurn } from '../model'
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

type Held = { items?: RabeItem[]; turns?: Record<string, RabeTurn[]> }

function watch(on: On): Held {
  const held: Held = {}
  on('state.set', async (_$, e, next) => {
    if (e.plugin === 'rabe' && e.key === 'items') held.items = e.value as RabeItem[]
    if (e.plugin === 'rabe' && e.key === 'turns') held.turns = e.value as Held['turns']

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
    detail: { runId: 'wf_1', transcriptDir: '/s/subagents/workflows/wf_1' },
  }
  const child = { ...agent, parentId: 'workflow:wf_1' }
  expect(metaPath(child, [run])).toBe('/s/subagents/workflows/wf_1/agent-a1.meta.json')
  expect(metaPath(agent, [run])).toBeUndefined()
})

test('the agent transcript sits in the session folder unless the hook names it', () => {
  expect(agentTranscript('/p/s1.jsonl', 'a1')).toBe('/p/s1/subagents/agent-a1.jsonl')
  expect(agentTranscript('/p/s1/subagents/agent-a1.jsonl', 'a1')).toBe(
    '/p/s1/subagents/agent-a1.jsonl',
  )
  expect(agentTranscript('', 'a1')).toBeUndefined()
})

test('turns keep the newest per item and drop items that are gone', () => {
  let turns: Record<string, RabeTurn[]> = { 'agent:gone': [turn(1)] }
  for (let index = 1; index <= 32; index++)
    turns = addTurn(turns, 'agent:a1', turn(index), ['agent:a1'])
  expect(Object.keys(turns)).toEqual(['agent:a1'])
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

test('a long answer is kept cut with an ellipsis', async ($, on) => {
  const held = engine(on, 'a1')
  // biome-ignore lint/correctness/useYield: the engine's stand-in answers without chunks
  on('turn.step', async function* (_$, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'word '.repeat(100),
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
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'm', messageCount: 1, agentId: 'a1' })
  for await (const _ of stream);
  const text = held.turns?.['agent:a1']?.[0]?.text ?? ''
  expect(text.length).toBe(300)
  expect(text.endsWith('…')).toBe(true)
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

test('subagent start sets the transcript and a worktree outside the session folder', async ($, on) => {
  const held = engine(on, 'a1')
  on('session.cwd', async () => ({ value: '/repo' }))
  await $.agent.spawn(SPAWN)
  await $.classic.SubagentStart({
    agent_id: 'a1',
    agent_type: 'general-purpose',
    cwd: '/repo/.claude/worktrees/a1',
    transcript_path: '/p/s1.jsonl',
  })
  expect(held.items?.[0]?.detail).toMatchObject({
    transcriptPath: '/p/s1/subagents/agent-a1.jsonl',
    worktreePath: '/repo/.claude/worktrees/a1',
    cwd: '/repo/.claude/worktrees/a1',
  })
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
  await $.agent.spawn(SPAWN)
  expect(held.items).toHaveLength(1)
  expect(held.items?.[0]).toMatchObject({
    title: 'verify:db.ts',
    detail: { agentId: 'a1', transcriptPath: '/p/s1/subagents/agent-a1.jsonl', cwd: '/repo' },
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
      { id: 'a1', description: 'migrate logger', type: 'Explore', status: 'running' as const },
      { id: 'a2', description: 'plan', type: 'Plan', status: 'completed' as const, parentId: 'a1' },
    ],
  }))
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
  await clock.advance(3000)

  const list = held.items ?? []
  expect(list.map(one => [one.id, one.status, one.parentId])).toEqual([
    ['agent:a1', 'running', undefined],
    ['agent:a2', 'done', 'agent:a1'],
  ])
  expect(list[0]?.detail).toMatchObject({ worktreePath: '/wt/a1', worktreeBranch: 'wt-a1' })
})
