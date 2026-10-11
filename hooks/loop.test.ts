import { expect, test } from 'claude-code/testing'

import { collect, delayOf, nextStep, pollDue } from './loop'

test('running and changed passes keep the two second pace', () => {
  expect(delayOf(5, true, false)).toEqual({ idle: 0, delay: 2000 })
  expect(delayOf(5, false, true)).toEqual({ idle: 0, delay: 2000 })
})

test('five quiet passes select the ten second idle pace', () => {
  expect(delayOf(3, false, false)).toEqual({ idle: 4, delay: 2000 })
  expect(delayOf(4, false, false)).toEqual({ idle: 5, delay: 10000 })
})

test('a running item wakes an idle loop, otherwise it redraws between fast polls', () => {
  expect(nextStep(1000, 10000, true)).toBe('poll')
  expect(nextStep(1000, 2000, true)).toBe('redraw')
  expect(nextStep(1000, 2000, false)).toBe('skip')
  expect(nextStep(2000, 2000, false)).toBe('poll')
})

test('worktrees keep their ten second gap independently of item polling', () => {
  expect(pollDue({ every: 10000, due: 11000 }, 10000)).toBe(false)
  expect(pollDue({ every: 10000, due: 11000 }, 11000)).toBe(true)
  expect(pollDue({ every: 10000 }, 1000)).toBe(true)
  expect(pollDue({ initial: false }, 1000, true)).toBe(false)
})

test('a failing poll does not stop the others or discard their changes', async () => {
  const polls = [
    {
      run: async () => {
        throw new Error('failed poll')
      },
    },
    {
      run: async () => (items: import('./model').RabeItem[]) => [
        ...items,
        {
          id: 'shell:ok',
          kind: 'shell' as const,
          title: 'ok',
          status: 'running' as const,
          seenAt: 1000,
          detail: { command: 'ok' },
        },
      ],
    },
  ]
  const { change } = await collect(polls, [], 1000)
  expect(change([]).map(item => item.id)).toEqual(['shell:ok'])
})
