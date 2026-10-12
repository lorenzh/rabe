import { expect, test } from 'claude-code/testing'
import { listeningPort, processTree } from './ports'

test('the process tree follows parents across process groups and row order', () => {
  expect([...processTree([10], '12 11\n11 10\n10 1\n99 1')]).toEqual([10, 11, 12])
})

for (const [address, owners, port] of [
  ['127.0.0.1:8090', '(("python",pid=12,fd=3))', 8090],
  ['[::]:8765', '(("python",pid=12,fd=3),("sh",pid=10,fd=4))', 8765],
  ['*:4000', '(("python",pid=12,fd=3),("claude",pid=99,fd=4))', undefined],
  ['*:4000', '', undefined],
  ['*:65536', '(("python",pid=12,fd=3))', undefined],
  ['*:0', '(("python",pid=12,fd=3))', undefined],
] as const) {
  test(`a listener needs a valid port and every owner in the tree: ${address} ${owners}`, () => {
    expect(
      listeningPort(
        `LISTEN 0 128 ${address} *:* ${owners ? `users:${owners}` : ''}`,
        new Set([10, 12]),
      ),
    ).toBe(port)
  })
}
