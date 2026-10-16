---
title: Agent items
description: The pure helpers extracted from agents.ts and their boundary with the mod API.
tags: [architecture, modules, agents]
keywords: [agent-items, agent-items.ts, agents.ts, refactor, modules, metadata, transcripts, turns, teammate, idle]
---

# Agent items

`hooks/sources/agent-items.ts` holds pure helpers for agent metadata, transcripts, turns and item updates.
The split keeps parsing and data changes separate from mod API calls.
It changes no behaviour. Only helpers imported by existing tests keep re-exports at the old path.
Production callers import the pure module directly.
`listed` keeps idle teammates alive and preserves plain subagent completion.
The shared `LISTED` table also serves `turn.complete` in `agents.ts`.
`MAX_EDITS` defines the limit of 100 once for agents and Codex.
`codex.ts` and `codex-data.ts` import it from this module.

`agents.ts` keeps hooks, polling, disk checks, price reads and state writes. The pure helpers return updated data only.

The metadata cache keeps parsed fields alongside its file stamp. Its `before` map stores the item's detail values for patched keys at read time. Missing fields remain absent from this JSON-safe map. Both the first publication and later replay compare each current value with its `before` value through `JSON.stringify`. Absent values compare equal. Only matching fields receive the metadata value.

This recovers changed metadata after a discarded or failed item write. It also preserves event values that arrive between the read and publication or before a later poll. Older entries without `before` fill only fields that are `undefined`. Malformed restored maps and cache entries are rebuilt.

See [Sources](sources.md) for behaviour and [the module map](../architecture.md) for sizes.

The source re-exports only `addTurn`, `agentTranscript`, `metaPatch`, `metaPath` and `toolSummary` for existing tests.
Only the pure module exports `changedFile` and `ranBash`.

`withPair`, `pairOf` and `pairsText` keep the model and effort an agent ran with. A `turn.step` records a pair only when a response named its model (`usage.model`); a request without a response records none. The step result carries no effort, so the `effort` is the one the request had when Rabe's hook saw it, and a hook further down the chain may still rewrite it. A pair that differs from the last one is appended to `detail.models`, capped at six. `<synthetic>` is no pair, and a missing `effort` shows `n/a`. Facts show the last pair on the first line and, from two pairs, a wrapped `models` line with all of them; a workflow row shows the last one and drops it when the row is too narrow to keep the agent's button.
