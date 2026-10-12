import { expect, test } from 'claude-code/testing'
import { asPrevious, clipText, toastText } from './pane-data'

test('pane data keeps clipboard lines and migrates old summaries without failed titles', () => {
  expect(clipText('a\n\t\u001b\u202e')).toBe('a\n\t??')
  expect(toastText('a\n\t\u001b\u202e')).toBe('a ??')
  expect(asPrevious({ endedAt: 1, counts: {}, failed: ['private title'], tokens: 2 })).toEqual({
    endedAt: 1,
    startedAt: undefined,
    counts: {},
    tokens: 2,
    usd: undefined,
    failedIds: [],
  })
  expect(asPrevious({ endedAt: 1 })).toBe(undefined)
})
