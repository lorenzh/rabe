---
title: How Rabe is built
description: Overview of Rabe's modules and links to the detailed architecture documents.
tags: [architecture, modules]
keywords: [architecture, module map, overview, CronDelete, isDeleted, shellWrites, writes.ts, changed, beforeBash, afterBash, FileChange, arming, rabe.edits, resume, Raster, View, render, band, pane, register.tsx, poll, scheduler, backoff, $.state, prices.csv, pricesFile, CodexRequest, nextRun, parseWorktrees]
---

# How Rabe is built

Rabe has four parts. Sources watch hooks and files and turn them into items. The registry holds the items in `$.state`. The band and the pane draw the items. `hooks/register.tsx` connects the sources and the views. It owns the shared poll timer. `hooks/loop.ts` holds the pure scheduling rules and collects poll changes. It hands the option `pricesFile` to `sources(on, file, pollers)`. The agents and Codex sources use that file.

```
hooks/
  register.tsx        connects sources and views; owns the shared poll timer
  loop.ts             scheduling rules and ordered poll changes
  model.ts            item types (re-exported from the contract), itemId, mergeItem
  registry.ts         pure list changes: addItem, updateItem, endItem, capEnded, commit, pastEnd, prune
  sources/index.ts    sources(on, file, pollers), which calls each source
  sources/agents.ts   Claude subagents: items, live tokens, turns and workflow phases
  sources/workflows.ts  workflow runs: items, phases and their end
  sources/codex.ts    Codex plugin jobs: items, steps and /rabe-stop
  sources/shells.ts   background shells: items, exit code, port
  sources/monitors.ts monitors: items and their output lines
  sources/crons.ts    cron jobs and /loop wakeups
  sources/worktrees.ts  the repository's git worktrees, for the Effects tab
  tasks.ts            pure: task notifications, task output files, port guess
  writes.ts           pure: the files a shell command line may write, and whether a path changed
  prices.ts           pure: the price table, its lookup and the dollars of a request
  forwarders.ts       pure: the Codex companion calls of agents, and the jobs they started
  schedule.ts         pure: next runs of a cron expression
  testing.ts          test helpers: state in memory, files, core stubs
  ui/band.tsx         the band above the prompt
  ui/pane.tsx         the /rabe command, its pane and actions
  ui/interaction.ts   pure state transitions for focus, held order, regain and arming
  ui/sequence.ts      serializes reserved press landings and focus moves
  ui/builtin.tsx      hides Claude Code's own count of background work
  ui/render.tsx       one renderer: lines as row Boxes of Text and plain Buttons, charts as a Raster
  ui/view.ts          the view contract: Model, Size, Selection, Press, Line, Node, Drawn, View, Action
  ui/cells/           pure cell engine for charts (grid.ts) and the 256-color palette (palette.ts)
  ui/views/           pure views: band, pane frame, items, detail, cost, effects, timeline
  ui/*.ts             pure helpers: lists, facts, format
types/index.d.ts      the state contract: item types and the $.state keys
data/prices.csv       list prices per model, read at run time for the cost estimate (see docs/feasibility/prices.md)
```

The pure [interaction model](architecture/interaction.md) owns focus, held order, regain retries and arming. The pane feeds events and runs its effects.

The details are split by area: [state and items](architecture/state.md), [sources](architecture/sources.md), [prices](architecture/prices.md), [UI](architecture/ui.md), [focus and keys](architecture/focus-and-keys.md), [focus order and arming](architecture/focus-order.md), and [view behavior](architecture/views.md).

## Shared poll loop

`register.tsx` starts one clock timer at session start. Each source binds its own poll callback to `$`. This keeps `$` in the source file for module validation. The loop calls agents, Codex, shells, monitors and worktrees in order. Cron jobs and workflows still use events.

The timer wakes every second. It skips a tick while the previous pass runs. Agents and worktrees refresh once at session start. The other sources first poll after two seconds. Codex and worktrees poll only in interactive sessions.

Each item poll returns a pure `Change`. A source can stage several changes locally before returning their composition. Later sources see the changed items with the ended-item cap applied. The loop composes returned changes in order. Its `write` and `forget` helpers use the same `commit` and `prune` rules as event writes. The write commits the collected list if its version still matches. Otherwise it replays changes against the latest list with a version check. This keeps event writes that arrive during a poll. An unchanged list causes no write. Dropped items lose their lines and turns.

The band and pane read the same published item list. They cannot see a partial item poll. Output history and the worktree list keep their separate state keys. Their readers still skip writes when those values did not change.

While items run, the loop polls every two seconds. Agents keep a minimum three-second gap. The same timer redraws the views each second. After five unchanged passes with no running items, the loop polls every ten seconds. A new running item wakes polling on the next tick. Worktrees refresh at most once every ten seconds. A failed source does not stop the remaining sources.

See [shared poll loop](architecture/loop.md) for scheduling rules, repeated starts and the write path.
