import { expect, test } from 'claude-code/testing'

import { nextRuns } from './cron'

const at = (h: number, m: number, d = 8) => new Date(2026, 9, d, h, m).getTime()

test('a step schedule runs on the next multiples', () => {
  expect(nextRuns('*/5 * * * *', at(10, 57) + 30_000, 3)).toEqual([
    at(11, 0),
    at(11, 5),
    at(11, 10),
  ])
})

test('lists and ranges pick the named minutes and hours', () => {
  expect(nextRuns('0,30 9-10 * * *', at(10, 31), 2)).toEqual([at(9, 0, 9), at(9, 30, 9)])
})

test('a weekday schedule skips to that day', () => {
  // 2026-10-08 is a Thursday; the next Monday is 2026-10-12
  expect(nextRuns('0 9 * * 1', at(10, 0), 1)).toEqual([at(9, 0, 12)])
})

test('a schedule that does not parse has no runs', () => {
  expect(nextRuns('every day', at(10, 0))).toEqual([])
  expect(nextRuns('61 * * * *', at(10, 0))).toEqual([])
})
