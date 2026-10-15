---
title: Codex data
description: The pure helpers extracted from codex.ts and their boundary with the mod API.
tags: [architecture, modules, codex]
keywords: [codex-data, codex-data.ts, codex.ts, refactor, modules, rollout, parseRollout, advanceRollout, codexItem, MAX_EDITS]
---

# Codex data

`hooks/sources/codex-data.ts` contains pure helpers: Codex job and incremental rollout parsing, plus item construction.
The split keeps parsing and data changes separate from mod API calls.
It changes no behaviour. Only helpers imported by existing tests keep re-exports at the old path.
Production callers import the pure module directly.

`codex.ts` keeps polling, file reads, stat confirmation and cancellation.
The split omits the proposed shared price loader. An imported helper cannot receive `$`.
Each source keeps its own `prices($, file)`. Price parsing and override rules are already shared.

See [Sources](sources.md) for behaviour and [the module map](../architecture.md) for sizes.

`advanceRollout` keeps the parser settings, totals and pending calls between chunks. `rolloutCursor` checks restored parser summaries before the reader reuses them. It checks step kinds and the types of step text, command results, edits and tokens. An invalid summary causes a new rollout read regardless of file changes. Cached polls reapply rollout fields and their accumulated cost after a discarded or failed item write.
`MAX_EDITS` comes from `agent-items.ts`. Agents and Codex share the limit of 100 edits. Codex also uses it for shell checks.

`Check` stays private. Only the pure module exports `CodexJob`, `CodexSession`, `Rollout` and `RolloutCursor`.
The source re-exports only `advanceRollout`, `codexItem`, `jobEnd` and `parseRollout` for existing tests.

For direct `codex exec` runs the module also holds `sessionIdOf` (the one `session id: <uuid>` line of a run's output), `execMeta` (the thread id, start and directory of a rollout's first record, only for `source: "exec"`), and `matchExec` with its window `EXEC_BEFORE_MS` and `EXEC_AFTER_MS` (a run gets a file only when it is the one file that fits the run and no other run fits it). `advanceRollout` records `endedAt` at a `task_complete` and clears it at a `task_started`. `codex.ts` keeps the folder listing, the `head -n 1` reads and the row updates (`pollExec`); see [Sources](sources.md).
