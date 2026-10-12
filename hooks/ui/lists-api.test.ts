import { expect, test } from 'claude-code/testing'
import * as lists from './lists'

test('list implementation helpers stay private', () => {
  for (const name of [
    'GROUPS',
    'groupOf',
    'isForwarder',
    'nest',
    'sortItems',
    'nextRun',
    'byConflict',
  ]) {
    expect(name in lists).toBe(false)
  }
})
