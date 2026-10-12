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

See [Sources](sources.md) for behaviour and [the module map](../architecture.md) for sizes.

The source re-exports only `addTurn`, `agentTranscript`, `metaPatch`, `metaPath` and `toolSummary` for existing tests.
Only the pure module exports `changedFile` and `ranBash`.
