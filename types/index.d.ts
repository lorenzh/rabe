export type RabeItemKind = 'agent' | 'workflow' | 'codex' | 'shell' | 'monitor' | 'cron'

export type RabeItemStatus = 'running' | 'idle' | 'done' | 'failed' | 'stopped'

export type RabeTokens = { input: number; output: number; cached?: number }

// How a file changed: an Edit or Write call, a write guessed from a shell
// command line, or a Codex file change. Absent: an Edit or Write.
export type RabeEditVia = 'edit' | 'write' | 'shell' | 'codex'

export type RabeEdit = {
  path: string
  at: number
  via?: RabeEditVia
  change?: 'add' | 'update' | 'delete'
}

// A Bash call of an agent that ran the Codex plugin's companion script
// (`task`, `review`, `adversarial-review`): when it started and returned, its
// command line (cut), and the job or thread its output named.
export type RabeCodexCall = {
  at: number
  command: 'task' | 'review' | 'adversarial-review'
  text: string
  endedAt?: number
  jobId?: string
  threadId?: string
}

// The recorded diff of one file operation, kept in `rabe.diffs` by editor id
// (an item id or `main`). `lines` carry `@@` hunk headers and lines that start
// with `+`, `-` or a space; they are cut at 200 lines and 8192 code units
// (`isTruncated`), and emptied when the retained total is over 262144 code
// units (`isEvicted`). `added` and `removed` count the whole change.
export type RabeDiff = {
  path: string
  at: number
  lines: string[]
  added: number
  removed: number
  hunks: number
  note?: 'too-large' | 'unchanged'
  isTruncated?: true
  isEvicted?: true
}

export type RabeAgentDetail = {
  agentId: string
  isTeammate?: true
  name?: string
  type?: string
  model?: string
  description?: string
  prompt?: string
  transcriptPath?: string
  cwd?: string
  worktreePath?: string
  worktreeBranch?: string
  workflowPhase?: string
  workflowIndex?: number
  toolCount?: number
  lastTool?: string
  lastToolAt?: number
  edits?: RabeEdit[]
  codexCalls?: RabeCodexCall[]
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
  stopError?: string
  logPath?: string
  sessionPath?: string
  sessionUpdatedAt?: number
  isSessionMissing?: boolean
  isSessionPartial?: boolean
  commandCount?: number
  steps?: RabeCodexStep[]
  edits?: RabeEdit[]
}

export type RabeShellDetail = {
  command: string
  taskId?: string
  outputPath?: string
  // The file a detached `codex exec -o` writes when it ends.
  resultPath?: string
  exitCode?: number
  port?: number
  // When Rabe found the port; orders the Effects tab's ports found since the open.
  portAt?: number
  // Set when the command is a direct `codex exec`: what its flags name.
  // A field the flags do not give (or give with an expansion) is missing.
  codex?: { model?: string; effort?: string; sandbox?: string }
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
  isDeleted?: boolean
  lastFiredAt?: number
  fireCount?: number
  fireId?: string
  turnEnded?: 'answered' | 'stopped' | 'error' | 'refused'
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

export type RabeLine = { at: number; text: string }

export type RabeLines = {
  seen: number
  lines: RabeLine[]
  cursor?: RabeFileCursor
  ended?: 'done' | 'failed' | 'stopped'
  exitCode?: number
  port?: number
}

// Item ids per list (a group of the Items tab, `cost`, `timeline`) in the
// order the pane showed them when it opened.
export type RabeOrder = Record<string, string[]>

export type RabePrevious = {
  // What `claude --resume` takes; absent in summaries before Rabe 0.4.
  sessionId?: string
  endedAt: number
  startedAt?: number
  counts: Partial<Record<RabeItemKind, number>>
  tokens: number
  usd?: number
  failedIds: string[]
}

// A git worktree from `git worktree list --porcelain`: the first one listed
// is the main worktree (`isMain`); bare entries are left out.
export type RabeWorktree = {
  path: string
  branch?: string
  isDetached?: boolean
  isMain?: boolean
}

// The Timeline tab's window for the open pane: `base` hours from the option
// `timelineHours`, `hours` the step shown now (0: the whole session) and
// `since` its start in ms (0: none). `since` stays put while the pane is
// open, so no row folds away under the focus.
export type RabeWindow = { base: number; hours: number; since: number }

export type RabeFileCursor = {
  size: number
  mtimeMs: number
  offset: number
  identity?: string
  partial: boolean
  isDiscarding?: boolean
}

export type RabeRollout = {
  model?: string
  effort?: string
  sandbox?: string
  prompt?: string
  tokens?: RabeTokens
  requests: { model?: string; input: number; cached: number; write: number; output: number }[]
  commandCount: number
  steps: RabeCodexStep[]
  edits?: RabeEdit[]
  checks?: { path: string; from: number; to: number }[]
  // The diffs of this parse only; the source records them and never keeps them here.
  diffs?: RabeDiff[]
}

export type RabeRolloutCursor = {
  out: RabeRollout
  total: string
  base?: Record<string, unknown>
  isResumed: boolean
  at?: number
  pending: Record<string, number>
}

// The last poll of one source (`agents`, `codex`, `shells`, `monitors`,
// `worktrees`): when it ran, how long it took (rounded to 100 ms), the files
// and text it read, unchanged files skipped, its failures, and the last
// failure's fixed category. Written only when a value changes.
export type RabeDiag = {
  at: number
  ms: number
  files: number
  chars: number
  bytes: number
  skipped: number
  errors: number
  lastError?: string
}

declare module 'claude-code' {
  interface PluginState {
    rabe: {
      items: RabeItem[]
      cronTranscript: string
      cronTurn: { promptId?: string; turnId?: string; fireId?: string }
      agentFiles: Record<
        string,
        {
          path: string
          size: number
          mtimeMs: number
          data: Partial<RabeAgentDetail>
          before?: Record<string, unknown>
        }
      >
      codexFiles: Record<string, { size: number; mtimeMs: number; data: Record<string, unknown> }>
      rollouts: Record<
        string,
        {
          path: string
          cursor: RabeFileCursor
          parser: RabeRolloutCursor
          usd: number
          isUnpriced: boolean
          hasRequests: boolean
          hasSkipped: boolean
          until?: number
          since?: number
        }
      >
      tab: RabeTab
      turns: Record<string, RabeTurn[]>
      lines: Record<string, RabeLines>
      query: string
      folded: string[]
      selected: string
      // The selected row of each tab other than Items, by tab; absent: the
      // tab's first row. Items keeps `selected`, so a tab visit leaves it.
      picked: Record<string, string>
      open: string
      // The tab and row id the open detail came from, for Back (one level).
      // Absent: Back goes to Items. Null after Back and when the pane closes.
      openFrom: { tab: RabeTab; id: string } | null
      order: RabeOrder
      // The files the main session changed (no agent), newest last.
      edits: RabeEdit[]
      // Bounded diffs of recorded file operations, by editor id (item id or
      // `main`), oldest first. Content: see docs/architecture/diffs.md.
      diffs: Record<string, RabeDiff[]>
      // The ids of ended items the person removed from the views this session.
      removed: string[]
      // The repository's git worktrees; absent without git.
      worktrees: RabeWorktree[]
      window: RabeWindow
      // The last poll of each source, by source name, for `/rabe-diag`.
      diag: Record<string, RabeDiag>
      // Successful actions from the pane, for the next main-session prompt.
      actions: string[]
    }
  }
}
