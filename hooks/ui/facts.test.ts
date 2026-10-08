import { expect, test } from 'claude-code/testing'

import { facts, upcoming } from './facts'
import { ALL, babysit, ci, dev, explore, flow, lint, NOW, plan, review, verify } from './fixtures'

test('agent facts show type, model, worktree, spend and start', () => {
  const { title, status, lines } = facts(explore, NOW, ALL)
  expect(title).toBe('claude · Explore verifyToken')
  expect(status).toBe('◐ running')
  expect(lines).toEqual([
    'Explore · opus-5-5 · worktree pkg-db',
    'branch worktree-agent-a1',
    '≈ $0.16 · in / out 36k / 5k · 45% of session',
    'started by main session',
    'ran 10:50:48 → now · 1m12s',
  ])
})

test('missing data shows n/a', () => {
  expect(facts(plan, NOW, ALL).lines).toContain('Plan · n/a · main tree')
  expect(facts(plan, NOW, ALL).lines).toContain('tokens n/a · cost n/a')
  expect(facts(dev, NOW, ALL).lines).toContain('started before Rabe loaded · start time not known')
  expect(facts(verify, NOW, ALL).lines[0]).toBe('n/a · n/a · tree n/a')
})

test('codex facts show model, effort, job and cached tokens', () => {
  expect(facts(review, NOW, ALL).lines.slice(0, 2)).toEqual([
    'model gpt-6.1-sol · effort high · job task-1',
    '≈ $0.09 · in / out 25k / 3k · cached 18k · 31% of session',
  ])
})

test('shell, monitor and cron facts', () => {
  expect(facts(lint, NOW, ALL).status).toBe('✗ failed · exit 2')
  expect(facts(lint, NOW, ALL).lines).toContain('exit code 2')
  expect(facts(ci, NOW, ALL).status).toBe('◉ watching')
  expect(facts(ci, NOW, ALL).lines).toContain('timeout 30m00s · 22m00s left')
  expect(facts(babysit, NOW, ALL).status).toBe('⟳ next in 3:00')
  expect(facts(babysit, NOW, ALL).lines[0]).toBe('schedule */5 * * * * · every 5 minutes')
  expect(upcoming(babysit, NOW)).toEqual(['10:55', '11:00', '11:05', '11:10', '11:15'])
})

test('workflow spend sums its agents', () => {
  expect(facts(flow, NOW, ALL).lines).toContain('cost n/a · in / out 19k / 3k')
})
