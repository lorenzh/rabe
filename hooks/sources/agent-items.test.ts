import { expect, test } from 'claude-code/testing'
import { answered, workflowTranscript } from './agent-items'
import * as agents from './agents'

test('agent data keeps background companions open and only relocates generic transcripts', () => {
  expect(answered({ result: { backgroundTaskId: 'bg', stdout: 'private' } }, 10)).toEqual({})
  expect(workflowTranscript('/s/subagents/agent-a.jsonl', 'a', 'run')).toBe(
    '/s/subagents/workflows/run/agent-a.jsonl',
  )
  expect(workflowTranscript('/custom/a.jsonl', 'a', 'run')).toBe('/custom/a.jsonl')
})

test('the agent source only forwards helpers used by legacy tests', () => {
  expect('changedFile' in agents).toBe(false)
  expect('ranBash' in agents).toBe(false)
})
