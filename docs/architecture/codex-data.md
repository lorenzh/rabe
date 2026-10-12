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

`advanceRollout` keeps the parser settings, totals and pending calls between chunks.
`MAX_EDITS` comes from `agent-items.ts`. Agents and Codex share the limit of 100 edits. Codex also uses it for shell checks.

`Check` stays private. Only the pure module exports `CodexJob`, `CodexSession`, `Rollout` and `RolloutCursor`.
The source re-exports only `advanceRollout`, `codexItem`, `jobEnd` and `parseRollout` for existing tests.
