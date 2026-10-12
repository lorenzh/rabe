import { expect, test } from 'claude-code/testing'

import { dev } from './fixtures'
import { follow, type Geometry, NO_PIN } from './pin'

const geo: Geometry = { above: 4, rows: 10, total: 50, focus: [0, 1], heads: 5 }

test('a new view starts at the top and brings the selected row into view', () => {
  expect(follow(NO_PIN, geo, 'a', dev.id)).toEqual({ top: 0, scope: 'a', followed: dev.id })
  expect(follow(NO_PIN, { ...geo, focus: [30, 1] }, 'a', 'x').top).toBe(21)
})

test('a redraw keeps the scroll; a new selected row moves it just enough', () => {
  const pin = { top: 12, scope: 'a', followed: 'x' }
  expect(follow(pin, { ...geo, focus: [3, 1] }, 'a', 'x').top).toBe(12)
  expect(follow(pin, { ...geo, focus: [3, 1] }, 'a', 'y').top).toBe(3)
  expect(follow(pin, { ...geo, focus: [30, 1] }, 'a', 'y').top).toBe(21)
})

test('the scroll stays inside the body', () => {
  expect(follow({ top: 99, scope: 'a', followed: 'x' }, geo, 'a', 'x').top).toBe(40)
  expect(follow({ top: -3, scope: 'a', followed: 'x' }, geo, 'a', 'x').top).toBe(0)
})
