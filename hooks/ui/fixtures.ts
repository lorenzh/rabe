import type { RabeItem } from '../model'

export const NOW = new Date(2026, 9, 8, 10, 52, 0).getTime()

const min = 60_000

export const explore: RabeItem = {
  id: 'agent:a1',
  kind: 'agent',
  title: 'Explore verifyToken',
  status: 'running',
  seenAt: NOW - 2 * min,
  startedAt: NOW - 72_000,
  tokens: { input: 36_000, output: 5_000 },
  costUsd: 0.16,
  detail: {
    agentId: 'a1',
    type: 'Explore',
    model: 'opus-5-5',
    transcriptPath: '/t/agent-a1.jsonl',
    worktreePath: '/repo/.claude/worktrees/pkg-db',
    worktreeBranch: 'worktree-agent-a1',
  },
}

export const plan: RabeItem = {
  id: 'agent:a2',
  kind: 'agent',
  title: 'Plan auth split',
  status: 'done',
  seenAt: NOW - 10 * min,
  startedAt: NOW - 10 * min,
  endedAt: NOW - 6 * min,
  detail: { agentId: 'a2', type: 'Plan' },
}

export const review: RabeItem = {
  id: 'codex:task-1',
  kind: 'codex',
  title: 'review auth.ts',
  status: 'running',
  seenAt: NOW - min,
  startedAt: NOW - 52_000,
  tokens: { input: 25_000, output: 3_000, cached: 18_000 },
  costUsd: 0.09,
  detail: {
    jobId: 'task-1',
    model: 'gpt-6.1-sol',
    effort: 'high',
    prompt: 'Review middleware/auth.ts for token-expiry bugs.',
    sessionPath: '/c/rollout-1.jsonl',
  },
}

export const dev: RabeItem = {
  id: 'shell:bg_2',
  kind: 'shell',
  title: 'bun run dev',
  status: 'running',
  seenAt: NOW - 40 * min,
  detail: { command: 'bun run dev', taskId: 'bg_2', port: 5173, outputPath: '/t/bg_2.output' },
}

export const lint: RabeItem = {
  id: 'shell:bg_3',
  kind: 'shell',
  title: 'bun run lint',
  status: 'failed',
  seenAt: NOW - 3 * min,
  startedAt: NOW - 3 * min,
  endedAt: NOW - 2 * min,
  detail: { command: 'bun run lint', taskId: 'bg_3', exitCode: 2, outputPath: '/t/bg_3.output' },
}

export const ci: RabeItem = {
  id: 'monitor:bg_4',
  kind: 'monitor',
  title: 'CI run #482',
  status: 'running',
  seenAt: NOW - 8 * min,
  startedAt: NOW - 8 * min,
  detail: {
    command: 'gh run watch 482',
    description: 'wait until CI run #482 finishes',
    taskId: 'bg_4',
    timeoutMs: 30 * min,
    isPersistent: false,
  },
}

export const babysit: RabeItem = {
  id: 'cron:c1',
  kind: 'cron',
  title: '/babysit-prs',
  status: 'running',
  seenAt: NOW - 30 * min,
  detail: {
    jobId: 'c1',
    prompt: '/babysit-prs',
    schedule: '*/5 * * * *',
    humanSchedule: 'every 5 minutes',
  },
}

export const flow: RabeItem = {
  id: 'workflow:wf1',
  kind: 'workflow',
  title: 'review-changes',
  status: 'running',
  seenAt: NOW - 6 * min,
  startedAt: NOW - 6 * min,
  detail: { runId: 'wf1', taskId: 'wf_task', phases: ['Review', 'Verify', 'Report'] },
}

export const verify: RabeItem = {
  id: 'agent:w1',
  kind: 'agent',
  title: 'verify:db.ts',
  status: 'running',
  seenAt: NOW - min,
  startedAt: NOW - 40_000,
  parentId: flow.id,
  tokens: { input: 19_000, output: 3_000 },
  detail: { agentId: 'w1', workflowPhase: 'Verify' },
}

export const reviewed: RabeItem = {
  id: 'agent:w0',
  kind: 'agent',
  title: 'review:bugs',
  status: 'done',
  seenAt: NOW - 5 * min,
  startedAt: NOW - 5 * min,
  endedAt: NOW - 3 * min,
  parentId: flow.id,
  detail: { agentId: 'w0', workflowPhase: 'Review' },
}

export const ALL: RabeItem[] = [
  explore,
  plan,
  review,
  dev,
  lint,
  ci,
  babysit,
  flow,
  verify,
  reviewed,
]
