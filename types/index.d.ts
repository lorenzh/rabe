export type RabeItemKind = 'agent' | 'workflow' | 'codex' | 'shell' | 'monitor' | 'cron'

export type RabeItemStatus = 'running' | 'done' | 'failed' | 'stopped'

export type RabeTokens = { input: number; output: number; cached?: number }

export type RabeAgentDetail = {
  agentId: string
  type?: string
  model?: string
  description?: string
  transcriptPath?: string
  worktreePath?: string
  worktreeBranch?: string
  workflowPhase?: string
  workflowIndex?: number
  toolCount?: number
  lastTool?: string
  lastToolAt?: number
}

export type RabeWorkflowDetail = {
  runId: string
  taskId?: string
  scriptPath?: string
  transcriptDir?: string
  phases?: string[]
}

export type RabeCodexStep = {
  kind: 'message' | 'reasoning' | 'command'
  text: string
  exitCode?: number
  lines?: number
  isRunning?: boolean
}

export type RabeCodexDetail = {
  jobId: string
  jobKind?: string
  threadId?: string
  model?: string
  effort?: string
  sandbox?: string
  prompt?: string
  workspaceRoot?: string
  logPath?: string
  sessionPath?: string
  sessionUpdatedAt?: number
  isSessionMissing?: boolean
  isSessionPartial?: boolean
  commandCount?: number
  steps?: RabeCodexStep[]
}

export type RabeShellDetail = {
  command: string
  taskId?: string
  outputPath?: string
  exitCode?: number
  port?: number
}

export type RabeMonitorDetail = {
  command: string
  description?: string
  taskId?: string
  outputPath?: string
  timeoutMs?: number
  isPersistent?: boolean
}

export type RabeCronDetail = {
  jobId: string
  prompt: string
  schedule?: string
  humanSchedule?: string
  scheduledFor?: number
}

export type RabeItemDetails = {
  agent: RabeAgentDetail
  workflow: RabeWorkflowDetail
  codex: RabeCodexDetail
  shell: RabeShellDetail
  monitor: RabeMonitorDetail
  cron: RabeCronDetail
}

export type RabeItemOf<K extends RabeItemKind> = {
  id: string
  kind: K
  title: string
  status: RabeItemStatus
  seenAt: number
  startedAt?: number
  endedAt?: number
  parentId?: string
  tokens?: RabeTokens
  costUsd?: number
  detail: RabeItemDetails[K]
}

export type RabeItem = { [K in RabeItemKind]: RabeItemOf<K> }[RabeItemKind]

export type RabeToolUse = { name: string; summary?: string }

export type RabeTurn = { index: number; at: number; text: string; tools: RabeToolUse[] }

export type RabeTab = 'items' | 'cost' | 'effects' | 'timeline'

declare module 'claude-code' {
  interface PluginState {
    rabe: { items: RabeItem[]; tab: RabeTab; turns: Record<string, RabeTurn[]> }
  }
}
