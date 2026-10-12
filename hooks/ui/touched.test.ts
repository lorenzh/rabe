import { expect, test } from 'claude-code/testing'
import { touched, treeOf } from './touched'

test('effects use the deepest worktree and keep the last write after a deletion', () => {
  const trees = [
    { path: '/repo', isMain: true },
    { path: '/repo/nested', isMain: false },
  ]
  expect(treeOf('/repo/nested/a', trees)).toBe(trees[1])
  const files = touched(
    [],
    [
      { path: '/repo/nested/a', at: 1, change: 'delete' },
      { path: '/repo/nested/a', at: 2, via: 'write' },
    ],
    '/repo',
    trees,
  )
  expect(files[0]?.rel).toBe('a')
  expect(files[0]?.isDeleted).toBe(false)
  expect(files[0]?.edits).toBe(2)
})
