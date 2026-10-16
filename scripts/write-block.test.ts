import { expect, test } from 'claude-code/testing'

import { block } from './write-block'

const src = (body: string) =>
  `async function write() {\n${body}\n}\nasync function forget() {\n  return 1\n}\n`

test('trailing and block comments do not change a block', () => {
  const plain = block(src('  const next = commit(value, change)'))
  expect(block(src('  const next = commit(value, change) // apply the cap'))).toBe(plain)
  expect(block(src('  /* apply the cap */\n  const next = commit(value, change)'))).toBe(plain)
  expect(block(src('  /*\n   * apply\n   */\n  const next = commit(value, change)'))).toBe(plain)
})

test('a double slash inside a string stays', () => {
  const a = block(src("  const url = 'http://x' // note"))
  expect(a).toContain("'http://x'")
  expect(block(src("  const url = 'http://y'"))).not.toBe(a)
})

test('real code changes still differ', () => {
  expect(block(src('  const next = commit(value, change)'))).not.toBe(
    block(src('  const next = commit(value, other)')),
  )
})
