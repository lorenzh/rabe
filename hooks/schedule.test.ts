import { expect, test } from 'claude-code/testing'

import { nextRun, nextRuns } from './schedule'

const at = (month: number, day: number, hour: number, minute: number) =>
  new Date(2026, month - 1, day, hour, minute).getTime()

test('every five minutes runs at the next multiple of five', () => {
  expect(nextRun('*/5 * * * *', at(10, 8, 10, 52) + 30_000)).toBe(at(10, 8, 10, 55))
  expect(nextRuns('*/5 * * * *', at(10, 8, 10, 55), 3)).toEqual([
    at(10, 8, 11, 0),
    at(10, 8, 11, 5),
    at(10, 8, 11, 10),
  ])
})

test('the next run is always after the given time', () => {
  expect(nextRun('0 9 * * *', at(10, 8, 9, 0))).toBe(at(10, 9, 9, 0))
})

test('lists, ranges and steps in ranges', () => {
  expect(nextRun('7,37 8-10 * * *', at(10, 8, 10, 40))).toBe(at(10, 9, 8, 7))
  expect(nextRun('0 8-18/4 * * *', at(10, 8, 12, 1))).toBe(at(10, 8, 16, 0))
})

test('weekdays: 2026-10-10 is a Saturday, so Monday is next', () => {
  expect(nextRun('0 9 * * 1-5', at(10, 9, 10, 0))).toBe(at(10, 12, 9, 0))
  expect(nextRun('0 9 * * 7', at(10, 9, 10, 0))).toBe(at(10, 11, 9, 0))
})

test('a one-time schedule pins day and month, also into next year', () => {
  expect(nextRun('30 14 28 2 *', at(10, 8, 10, 0))).toBe(new Date(2027, 1, 28, 14, 30).getTime())
})

test('day of month or day of week when both are set', () => {
  expect(nextRun('0 0 1 * 1', at(10, 8, 10, 0))).toBe(at(10, 12, 0, 0))
})

test('an impossible or broken schedule has no next run', () => {
  expect(nextRun('0 0 31 2 *', at(10, 8, 10, 0))).toBeUndefined()
  expect(nextRun('every day', at(10, 8, 10, 0))).toBeUndefined()
  expect(nextRun('61 * * * *', at(10, 8, 10, 0))).toBeUndefined()
  expect(nextRuns('nope', 0, 3)).toEqual([])
})
