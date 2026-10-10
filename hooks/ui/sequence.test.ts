import { expect, test } from 'claude-code/testing'

import { sequence } from './sequence'

test('queued focus work runs in order and continues after a failure', async () => {
  const seen: number[] = []
  let release!: () => void
  const gate = new Promise<void>(resolve => {
    release = resolve
  })
  const first = sequence(async () => {
    await gate
    seen.push(1)
    throw new Error('focus failed')
  })
  const second = sequence(async () => {
    seen.push(2)
  })
  release()
  await expect(first).rejects.toThrow('focus failed')
  await second
  expect(seen).toEqual([1, 2])
})
