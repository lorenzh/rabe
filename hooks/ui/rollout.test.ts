import { expect, test } from 'claude-code/testing'

import { parseCodex } from './rollout'

const record = (type: string, payload: unknown) => JSON.stringify({ type, payload })
const message = (text: string) =>
  record('response_item', {
    type: 'message',
    role: 'assistant',
    content: [{ type: 'output_text', text }],
  })
const done = (command: string, exit: number, output: string) =>
  record('event_msg', {
    type: 'item_completed',
    item: {
      type: 'CommandExecution',
      command: ['/bin/bash', '-lc', command],
      exit_code: exit,
      aggregated_output: output,
    },
  })

const running = [
  record('turn_context', {
    model: 'gpt-6.1-sol',
    effort: 'high',
    sandbox_policy: { type: 'read-only' },
  }),
  record('response_item', { type: 'message', role: 'user', content: [] }),
  message('I will read the diff first.'),
  record('response_item', { type: 'custom_tool_call', call_id: 'c1', input: 'x' }),
  done('git diff main', 0, 'a\nb\n'),
  record('response_item', { type: 'custom_tool_call_output', call_id: 'c1' }),
  record('event_msg', {
    type: 'token_count',
    info: {
      total_token_usage: {
        input_tokens: 25_000,
        output_tokens: 3_000,
        cached_input_tokens: 18_000,
      },
    },
  }),
  message('Running the tests.'),
  done('bun test', 1, 'fail'),
  record('response_item', {
    type: 'custom_tool_call',
    call_id: 'c2',
    input: 'text(await tools.exec_command({cmd:"rg -n \\"redact\\" pkg",max_output_tokens:1}));',
  }),
].join('\n')

test('a rollout file becomes model, tokens and turns with commands', () => {
  expect(parseCodex(running)).toEqual({
    model: 'gpt-6.1-sol',
    effort: 'high',
    sandbox: 'read-only',
    tokens: { input: 25_000, output: 3_000, cached: 18_000 },
    commandCount: 3,
    isComplete: false,
    turns: [
      {
        text: 'I will read the diff first.',
        commands: [{ command: 'git diff main', state: 'ok', exitCode: 0, lines: 2 }],
      },
      {
        text: 'Running the tests.',
        commands: [
          { command: 'bun test', state: 'error', exitCode: 1, lines: 1 },
          { command: 'rg -n "redact" pkg', state: 'running' },
        ],
      },
    ],
  })
})

test('task_complete ends the job with its last message', () => {
  const log = parseCodex(
    [
      message('Done.'),
      record('event_msg', { type: 'task_complete', last_agent_message: 'All good.' }),
    ].join('\n'),
  )
  expect(log.isComplete).toBe(true)
  expect(log.result).toBe('All good.')
})

test('null records and content of the wrong shape are skipped', () => {
  const text = [
    'null',
    '"x"',
    record('response_item', null),
    record('response_item', { type: 'message', role: 'assistant', content: { text: 'odd' } }),
    record('response_item', { type: 'message', role: 'assistant', content: [null] }),
    message('Fine.'),
  ].join('\n')
  expect(parseCodex(text).turns.map(turn => turn.text)).toEqual(['', '', 'Fine.'])
})

test('concurrent commands each stay running until their own output', () => {
  const log = parseCodex(
    [
      message('Two at once.'),
      record('response_item', { type: 'custom_tool_call', call_id: 'c1', input: '{cmd:"ls"}' }),
      record('response_item', { type: 'custom_tool_call', call_id: 'c2', input: '{cmd:"pwd"}' }),
      done('ls', 0, 'a'),
      record('response_item', { type: 'custom_tool_call_output', call_id: 'c1' }),
    ].join('\n'),
  )
  expect(log.turns[0]?.commands).toEqual([
    { command: 'ls', state: 'ok', exitCode: 0, lines: 1 },
    { command: 'pwd', state: 'running' },
  ])
})

test('reasoning summaries go with the turn they come before', () => {
  const log = parseCodex(
    [
      record('response_item', {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: '**Checking verify.ts**' }],
      }),
      record('response_item', { type: 'reasoning', summary: [], encrypted_content: 'x' }),
      message('Found it.'),
    ].join('\n'),
  )
  expect(log.turns).toEqual([
    { text: 'Found it.', reasoning: '**Checking verify.ts**', commands: [] },
  ])
})
