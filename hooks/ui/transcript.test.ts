import { expect, test } from 'claude-code/testing'

import { parseClaude } from './transcript'

const lines = [
  { type: 'user', message: { role: 'user', content: 'Migrate pkg/db to the new logger.' } },
  {
    type: 'assistant',
    message: {
      id: 'm1',
      content: [
        { type: 'text', text: 'The pool uses console.warn.' },
        { type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: 'pkg/db/pool.ts' } },
      ],
    },
  },
  {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false }] },
  },
  {
    type: 'assistant',
    message: {
      id: 'm2',
      content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'bun test\nx' } }],
    },
  },
  {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true }] },
  },
  'not json',
  {
    type: 'assistant',
    message: {
      id: 'm3',
      content: [
        { type: 'thinking', thinking: '' },
        { type: 'text', text: 'Fixing the test.' },
        { type: 'tool_use', id: 't3', name: 'Read', input: { file_path: 'README.md' } },
      ],
    },
  },
]
  .map(line => (typeof line === 'string' ? line : JSON.stringify(line)))
  .join('\n')

test('a transcript becomes the brief and turns of text and tools', () => {
  expect(parseClaude(lines)).toEqual({
    brief: 'Migrate pkg/db to the new logger.',
    toolCount: 3,
    turns: [
      {
        text: 'The pool uses console.warn.',
        tools: [
          { name: 'Edit', target: 'pkg/db/pool.ts', state: 'ok' },
          { name: 'Bash', target: 'bun test', state: 'error' },
        ],
      },
      {
        text: 'Fixing the test.',
        tools: [{ name: 'Read', target: 'README.md', state: 'running' }],
      },
    ],
  })
})

test('an empty transcript has no turns', () => {
  expect(parseClaude('')).toEqual({ toolCount: 0, turns: [] })
})
