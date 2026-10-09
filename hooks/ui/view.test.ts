import { expect, test } from 'claude-code/testing'

import { stepRow } from './view'

const KEYS = ['row:a', 'row:b', 'row:c']

test('an arrow steps to the next or previous row and stops at the ends', () => {
  expect(stepRow(KEYS, 'b', 1)).toBe('row:c')
  expect(stepRow(KEYS, 'b', -1)).toBe('row:a')
  expect(stepRow(KEYS, 'c', 1)).toBeUndefined()
  expect(stepRow(KEYS, 'a', -1)).toBeUndefined()
})

test('from no row, down goes to the first and up scrolls on', () => {
  expect(stepRow(KEYS, '', 1)).toBe('row:a')
  expect(stepRow(KEYS, 'gone', -1)).toBeUndefined()
  expect(stepRow([], '', 1)).toBeUndefined()
})
